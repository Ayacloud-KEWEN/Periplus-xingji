// 应用设置 / 手动调整：GET、PUT /api/settings/:key
// 目前只有一项：trips（旅程的拆分、合并、改名）
import { Router } from 'express';
import { pool } from '../db.js';
import { httpError } from '../errors.js';

const router = Router();
const KEY = /^[a-z][a-z0-9_-]{0,40}$/;
const MAX_BYTES = 512 * 1024;

router.get('/:key', async (req, res) => {
    if (!KEY.test(req.params.key)) throw httpError(400, 'invalid key');
    const { rows } = await pool.query('SELECT value FROM app_settings WHERE user_id = $1 AND key = $2', [req.user.id, req.params.key]);
    res.json(rows[0]?.value ?? {});
});

router.put('/:key', async (req, res) => {
    if (!KEY.test(req.params.key)) throw httpError(400, 'invalid key');
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw httpError(400, 'object required');
    const value = JSON.stringify(req.body);
    if (value.length > MAX_BYTES) throw httpError(400, 'value too large');
    await pool.query(
        `INSERT INTO app_settings (user_id, key, value) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [req.user.id, req.params.key, value]
    );
    res.json(req.body);
});

export default router;
