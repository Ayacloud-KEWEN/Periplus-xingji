import express from 'express';
import compression from 'compression';
import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, ROOT_DIR } from './config.js';
import { pool } from './db.js';
import pointsRouter from './routes/points.js';
import historyRouter from './routes/history.js';
import statsRouter from './routes/stats.js';
import listsRouter from './routes/lists.js';
import regionsRouter from './routes/regions.js';
import backupRouter from './routes/backup.js';
import tracksRouter from './routes/tracks.js';
import settingsRouter from './routes/settings.js';
import authRouter from './routes/auth.js';
import { loadUser, requireUser, checkOrigin, adoptOrphanData, createUser } from './auth.js';
import { startGeocoder, stopGeocoder } from './geocoder.js';
import { COUNTRY_CODES } from './continents.js';
import { specialRegions } from './special-regions.js';

const app = express();
app.disable('x-powered-by');
// 部署在 VPS 上一般前面有 Caddy / nginx 做 HTTPS：信任本机的反向代理，req.secure、req.ip 才对
app.set('trust proxy', config.trustProxy);
app.use(compression());
app.use(express.json({ limit: '25mb' })); // 一条 GPX 轨迹可能有好几万个点

// --- API ---
app.get('/api/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
});

app.use('/api', checkOrigin, loadUser);
app.use('/api/auth', authRouter);
// 以下全部要登录
app.use('/api', requireUser);

app.get('/api/config', (req, res) => {
    res.json({ maptilerKey: config.maptilerKey });
});

// 国家 / 地区代码，以及 config/special-regions.json 里的特殊地区
app.get('/api/countries', (req, res) => {
    res.json({ codes: COUNTRY_CODES, special: specialRegions() });
});

app.use('/api/points', pointsRouter);
app.use('/api/history', historyRouter);
app.use('/api/stats', statsRouter);
app.use('/api/lists', listsRouter);
app.use('/api/regions', regionsRouter);
app.use('/api/backup', backupRouter);
app.use('/api/tracks', tracksRouter);
app.use('/api/settings', settingsRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

// --- 静态文件 ---
// 照片只给主人看：按路径查它属于哪个标注、标注属于谁。
// 文件名唯一且不会被修改，可以长期缓存，但只能是 private（不让中间的代理缓存给别人）
app.use('/uploads', loadUser, async (req, res, next) => {
    if (!req.user) return res.status(401).end();
    const relativePath = decodeURIComponent(req.path.replace(/^\//, ''));
    const { rows } = await pool.query(
        `SELECT 1 FROM point_photos ph JOIN points p ON p.id = ph.point_id
         WHERE ph.path = $1 AND p.user_id = $2 LIMIT 1`, [relativePath, req.user.id]);
    if (!rows.length) return res.status(404).end();
    next();
}, express.static(config.uploadDir, {
    index: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
}));

const vendorDir = path.join(ROOT_DIR, 'public', 'vendor') + path.sep;
app.use(express.static(path.join(ROOT_DIR, 'public'), {
    setHeaders(res, filePath) {
        // 第三方库版本固定，缓存 30 天；自己的代码每次用 ETag 校验，改完刷新即生效
        res.setHeader('Cache-Control', filePath.startsWith(vendorDir) ? 'public, max-age=2592000' : 'no-cache');
    }
}));

// --- 错误处理（Express 5 会把 async 路由里抛出的错误传到这里）---
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
    }
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'internal error' : err.message });
});

// 启动时应用数据库结构（脚本可重复执行），升级代码后不用再手动运行 db:init
try {
    await pool.query(await fs.readFile(path.join(ROOT_DIR, 'db', 'schema.sql'), 'utf8'));
} catch (err) {
    console.error('数据库结构更新失败:', err.message);
}
await fs.mkdir(config.uploadDir, { recursive: true });

// 第一次启动还没有任何账户：可以用 ADMIN_USERNAME / ADMIN_PASSWORD 自动建一个管理员，
// 否则提示用 npm run user 建
const { rows: [{ count: userCount }] } = await pool.query('SELECT count(*)::int AS count FROM users');
if (userCount === 0 && config.adminUsername && config.adminPassword) {
    await createUser(config.adminUsername, config.adminPassword, true);
    console.log(`已创建管理员账户 ${config.adminUsername}，登录后请尽快修改密码，并从 .env 删掉 ADMIN_PASSWORD`);
} else if (userCount === 0) {
    console.warn('还没有任何账户，请运行 npm run user -- add <用户名> --admin 创建管理员');
}
// 单用户版升级上来的数据归给最早的管理员
const adopted = await adoptOrphanData();
if (adopted) console.log(`已把 ${adopted} 条原有数据归到最早的管理员名下`);

const server = app.listen(config.port, config.host, () => {
    console.log(`Periplus · 行纪 已启动: http://${config.host}:${config.port}`);
    startGeocoder();
});

function shutdown() {
    stopGeocoder();
    server.close(() => pool.end().then(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
