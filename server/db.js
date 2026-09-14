import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 5 // 树莓派上单用户，连接数不需要多
});

pool.on('error', (err) => {
    console.error('PostgreSQL 连接池错误:', err);
});
