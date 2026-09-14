// 创建数据库表结构（可重复执行）：npm run db:init
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT_DIR } from '../server/config.js';
import { pool } from '../server/db.js';

const sql = await fs.readFile(path.join(ROOT_DIR, 'db', 'schema.sql'), 'utf8');

try {
    await pool.query(sql);
    console.log('数据库表结构已就绪');
} catch (err) {
    console.error('初始化失败:', err.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
