// 登录和账户管理
//   POST   /api/auth/login        { username, password }
//   POST   /api/auth/logout
//   GET    /api/auth/me
//   POST   /api/auth/password     { current, password }  改自己的密码
// 以下只有管理员能用（没有公开注册，账户都由管理员建）：
//   GET    /api/auth/users
//   POST   /api/auth/users        { username, password, isAdmin }
//   PATCH  /api/auth/users/:id    { password?, isAdmin? }
//   DELETE /api/auth/users/:id    连同这个用户的全部数据和照片
import { Router } from 'express';
import { pool } from '../db.js';
import { httpError, parseId } from '../errors.js';
import {
    createSession, deleteSession, sessionCookie, sessionToken, verifyPassword, verifyDummy, hashPassword,
    validatePassword, requireUser, requireAdmin, loginBlocked, recordLoginFailure, clearLoginFailures,
    createUser, hashToken
} from '../auth.js';
import { removeImageFile } from './points.js';

const router = Router();

const toUser = (row) => ({
    id: Number(row.id), username: row.username, isAdmin: row.is_admin, createdAt: row.created_at,
    ...(row.points !== undefined ? { points: Number(row.points), tracks: Number(row.tracks) } : {})
});

router.post('/login', async (req, res) => {
    if (loginBlocked(req.ip)) throw httpError(429, 'too many attempts, try again later');
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 200) {
        throw httpError(400, 'username and password required');
    }
    const { rows } = await pool.query(
        'SELECT id, username, is_admin, password_hash FROM users WHERE lower(username) = lower($1)', [username.trim()]);
    const ok = rows.length ? await verifyPassword(password, rows[0].password_hash) : (await verifyDummy(password), false);
    if (!ok) {
        recordLoginFailure(req.ip);
        throw httpError(401, 'invalid username or password');
    }
    clearLoginFailures(req.ip);
    const token = await createSession(rows[0].id);
    res.setHeader('Set-Cookie', sessionCookie(req, token));
    res.json(toUser(rows[0]));
});

router.post('/logout', async (req, res) => {
    await deleteSession(sessionToken(req));
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    res.status(204).end();
});

router.get('/me', requireUser, (req, res) => {
    res.json(req.user);
});

router.post('/password', requireUser, async (req, res) => {
    const { current, password } = req.body || {};
    validatePassword(password);
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (typeof current !== 'string' || !(await verifyPassword(current, rows[0].password_hash))) {
        throw httpError(403, 'current password is wrong');
    }
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(password), req.user.id]);
    // 其他设备上的登录一并失效，只留当前这个
    await pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user.id, hashToken(sessionToken(req))]);
    res.status(204).end();
});

// ---------- 管理员 ----------

router.get('/users', requireAdmin, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT u.id, u.username, u.is_admin, u.created_at,
                (SELECT count(*) FROM points p WHERE p.user_id = u.id) AS points,
                (SELECT count(*) FROM tracks t WHERE t.user_id = u.id) AS tracks
         FROM users u ORDER BY u.id`);
    res.json(rows.map(toUser));
});

router.post('/users', requireAdmin, async (req, res) => {
    const { username, password, isAdmin } = req.body || {};
    const user = await createUser(username, password, isAdmin === true);
    res.status(201).json(toUser(user));
});

router.patch('/users/:id', requireAdmin, async (req, res) => {
    const id = parseId(req.params.id);
    const { password, isAdmin } = req.body || {};
    if (password === undefined && isAdmin === undefined) throw httpError(400, 'nothing to update');
    if (isAdmin !== undefined) {
        if (typeof isAdmin !== 'boolean') throw httpError(400, 'invalid isAdmin');
        if (id === req.user.id && !isAdmin) throw httpError(400, 'cannot remove your own admin role');
        await pool.query('UPDATE users SET is_admin = $1 WHERE id = $2', [isAdmin, id]);
    }
    if (password !== undefined) {
        validatePassword(password);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(password), id]);
        // 管理员重设了密码，这个用户所有设备都要重新登录
        if (id !== req.user.id) await pool.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    }
    const { rows } = await pool.query('SELECT id, username, is_admin, created_at FROM users WHERE id = $1', [id]);
    if (!rows.length) throw httpError(404, 'user not found');
    res.json(toUser(rows[0]));
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
    const id = parseId(req.params.id);
    if (id === req.user.id) throw httpError(400, 'cannot delete yourself');
    // 标注、照片记录、轨迹、设置、会话都随用户级联删除；照片文件要先查出来自己删
    const { rows: photos } = await pool.query(
        'SELECT ph.path FROM point_photos ph JOIN points p ON p.id = ph.point_id WHERE p.user_id = $1', [id]);
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (!rowCount) throw httpError(404, 'user not found');
    for (const photo of photos) await removeImageFile(photo.path);
    res.status(204).end();
});

export default router;
