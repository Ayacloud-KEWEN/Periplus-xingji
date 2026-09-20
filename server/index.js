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
import { startGeocoder, stopGeocoder } from './geocoder.js';
import { COUNTRY_CODES } from './continents.js';
import { specialRegions } from './special-regions.js';

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '25mb' })); // 一条 GPX 轨迹可能有好几万个点

// --- API ---
app.get('/api/config', (req, res) => {
    res.json({ maptilerKey: config.maptilerKey });
});

// 国家 / 地区代码，以及 config/special-regions.json 里的特殊地区
app.get('/api/countries', (req, res) => {
    res.json({ codes: COUNTRY_CODES, special: specialRegions() });
});

app.get('/api/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
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
// 上传的图片文件名唯一且不会被修改，可以长期缓存
app.use('/uploads', express.static(config.uploadDir, { maxAge: '365d', immutable: true, index: false }));

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
