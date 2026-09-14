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
    geocoderEmail: process.env.GEOCODER_EMAIL || ''
};
