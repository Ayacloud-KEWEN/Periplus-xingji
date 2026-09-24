// 多用户：密码、会话、登录检查。
// 密码用 Node 自带的 scrypt 加盐散列，不引入新依赖；会话令牌只在 Cookie 里存原文，数据库里存 SHA-256，
// 数据库泄露也拿不到能直接用的令牌。
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './db.js';
import { httpError } from './errors.js';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

export const SESSION_COOKIE = 'pp_sid';
const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export const USERNAME = /^[a-zA-Z0-9_.-]{2,32}$/;
export const MIN_PASSWORD = 8;

export async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password, salt, KEY_LENGTH, SCRYPT);
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
    const [scheme, N, r, p, salt, key] = String(stored).split('$');
    if (scheme !== 'scrypt' || !key) return false;
    const expected = Buffer.from(key, 'base64');
    const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(actual, expected);
}

// 用户名不存在时也算一次散列，响应时间不泄露"有没有这个用户"
const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'));
export function verifyDummy(password) {
    return verifyPassword(password, DUMMY_HASH);
}

export function validatePassword(password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > 200) {
        throw httpError(400, `password must be ${MIN_PASSWORD}-200 characters`);
    }
}

export const hashToken = (value) => sha256(String(value));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export async function createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    await pool.query(
        `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3 * interval '1 day')`,
        [sha256(token), userId, SESSION_DAYS]
    );
    // 顺手清掉过期的会话，不单独跑定时任务
    await pool.query('DELETE FROM sessions WHERE expires_at < now()');
    return token;
}

export async function deleteSession(token) {
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

export function sessionCookie(req, token, maxAgeMs = SESSION_DAYS * DAY_MS) {
    // 经 HTTPS 反向代理访问时加 Secure（需要 trust proxy 认出 X-Forwarded-Proto）
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${req.secure ? '; Secure' : ''}`;
}

function readCookie(req, name) {
    for (const part of String(req.headers.cookie || '').split(';')) {
        const index = part.indexOf('=');
        if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
    }
    return null;
}

export function sessionToken(req) {
    return readCookie(req, SESSION_COOKIE);
}

// 找到当前用户，挂在 req.user 上；没登录的 req.user 为 null
export async function loadUser(req, res, next) {
    req.user = null;
    const token = sessionToken(req);
    if (!token) return next();
    const { rows } = await pool.query(
        `SELECT u.id, u.username, u.is_admin, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [sha256(token)]
    );
    if (!rows.length) return next();
    const row = rows[0];
    req.user = { id: Number(row.id), username: row.username, isAdmin: row.is_admin };
    // 滑动续期：剩下不到一半时延长，经常用的人不会被登出
    if (new Date(row.expires_at) - Date.now() < SESSION_DAYS * DAY_MS / 2) {
        await pool.query(`UPDATE sessions SET expires_at = now() + $2 * interval '1 day' WHERE token_hash = $1`,
            [sha256(token), SESSION_DAYS]);
        res.append('Set-Cookie', sessionCookie(req, token));
    }
    next();
}

export function requireUser(req, res, next) {
    if (!req.user) throw httpError(401, 'login required');
    next();
}

export function requireAdmin(req, res, next) {
    if (!req.user?.isAdmin) throw httpError(403, 'admin only');
    next();
}

// 跨站请求防护：SameSite=Lax 已经挡住了跨站 POST 带 Cookie，再核对一次 Origin 作为第二道
export function checkOrigin(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin) {
        let host = null;
        try { host = new URL(origin).host; } catch { /* 格式不对当作不匹配 */ }
        if (host !== req.headers.host) throw httpError(403, 'cross-origin request');
    }
    next();
}

// 登录失败限流：同一 IP 15 分钟内失败 10 次后暂停登录。只存在内存里，重启清零，够用
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const failures = new Map(); // ip → { count, since }

export function loginBlocked(ip) {
    const entry = failures.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.since > FAIL_WINDOW_MS) {
        failures.delete(ip);
        return false;
    }
    return entry.count >= MAX_FAILS;
}

export function recordLoginFailure(ip) {
    const entry = failures.get(ip);
    if (!entry || Date.now() - entry.since > FAIL_WINDOW_MS) failures.set(ip, { count: 1, since: Date.now() });
    else entry.count++;
}

export function clearLoginFailures(ip) {
    failures.delete(ip);
}

// 单用户版升级上来的数据（user_id 为空）归给最早的管理员。没有管理员时先不动，等建了再归
export async function adoptOrphanData() {
    const { rows } = await pool.query('SELECT id FROM users WHERE is_admin ORDER BY id LIMIT 1');
    if (!rows.length) return 0;
    const owner = rows[0].id;
    let total = 0;
    for (const table of ['points', 'tracks', 'app_settings']) {
        const { rowCount } = await pool.query(`UPDATE ${table} SET user_id = $1 WHERE user_id IS NULL`, [owner]);
        total += rowCount;
    }
    return total;
}

export async function createUser(username, password, isAdmin = false) {
    if (typeof username !== 'string' || !USERNAME.test(username)) {
        throw httpError(400, 'username: 2-32 letters, digits, _ . -');
    }
    validatePassword(password);
    const { rows } = await pool.query(
        `INSERT INTO users (username, password_hash, is_admin) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING id, username, is_admin, created_at`,
        [username, await hashPassword(password), Boolean(isAdmin)]
    );
    if (!rows.length) throw httpError(409, 'username already exists');
    return rows[0];
}
