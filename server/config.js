import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 固定读取项目根目录的 .env，不受启动目录影响
dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

export const config = {
    host: process.env.HOST || '0.0.0.0',
    port: Number(process.env.PORT) || 8080,
    databaseUrl: process.env.DATABASE_URL || 'postgres://mapweb:mapweb@localhost:5432/mapweb',
    uploadDir: path.resolve(ROOT_DIR, process.env.UPLOAD_DIR || './data/uploads'),
    maptilerKey: process.env.MAPTILER_KEY || '',
    // 足迹统计需要把标注坐标发给 OpenStreetMap Nominatim 查询所在行政区；设为 off 则不发送
    geocoder: (process.env.GEOCODER || 'on').toLowerCase() !== 'off',
    geocoderEmail: process.env.GEOCODER_EMAIL || '',
    // 多用户版：信任哪些反向代理的 X-Forwarded-*。默认只信本机（Caddy / nginx 和本服务在同一台机器上）
    trustProxy: process.env.TRUST_PROXY || 'loopback',
    // 第一次启动时自动创建的管理员（只在还没有任何账户时生效）
    adminUsername: process.env.ADMIN_USERNAME || '',
    adminPassword: process.env.ADMIN_PASSWORD || ''
};
