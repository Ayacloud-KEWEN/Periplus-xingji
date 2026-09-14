import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db.js';
import { config } from '../config.js';
import { httpError, parseId } from '../errors.js';
import { wakeGeocoder } from '../geocoder.js';
import { continentOf } from '../continents.js';
import { resolvePlace, specialContinent } from '../special-regions.js';

const router = Router();

const SELECT_COLUMNS = `id, title, description, emoji,
    ST_Y(geom) AS lat, ST_X(geom) AS lng, visited_at, created_at, updated_at, place, place_manual,
    (SELECT COALESCE(json_agg(json_build_object('id', ph.id, 'path', ph.path) ORDER BY ph.sort, ph.id), '[]')
       FROM point_photos ph WHERE ph.point_id = points.id) AS photos`;

const PLACE_FIELDS = ['state', 'city', 'county', 'town'];
const MAX_PHOTOS = 50; // 每个标注最多几张照片

const IMAGE_EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => cb(null, file.mimetype in IMAGE_EXTENSIONS)
});

function toPoint(row) {
    const photos = (row.photos || []).map(photo => ({ id: Number(photo.id), url: `/uploads/${photo.path}` }));
    return {
        id: Number(row.id),
        title: row.title,
        description: row.description,
        emoji: row.emoji,
        lat: row.lat,
        lng: row.lng,
        photos,
        image_url: photos[0]?.url ?? null, // 封面（第一张），旅程列表等只要一张图的地方用
        visited_at: row.visited_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        place: resolvePlace(row.place, row.lat, row.lng, row.place_manual), // 套用特殊地区规则
        place_manual: row.place_manual
    };
}

// 手动填写的所在地区；null 表示恢复自动识别
function parsePlace(input) {
    if (input === null) return null;
    if (typeof input !== 'object') throw httpError(400, 'invalid place');
    const countryCode = String(input.countryCode || '').toLowerCase();
    const continent = continentOf(countryCode) || specialContinent(countryCode); // 也可以选特殊地区
    if (!continent) throw httpError(400, 'invalid countryCode');
    const place = { continent, countryCode, country: null };
    for (const field of PLACE_FIELDS) {
        const value = input[field];
        if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > 100)) {
            throw httpError(400, `invalid ${field}`);
        }
        place[field] = value?.trim() || null;
    }
    place.display = null;
    return place;
}

// 校验请求体；partial 为 true 时只校验出现的字段（用于 PATCH）
function parsePointInput(body, { partial, lenientPlace = false }) {
    const values = {};
    if (!body || typeof body !== 'object') throw httpError(400, 'invalid body');

    if (!partial || body.lat !== undefined || body.lng !== undefined) {
        const lat = Number(body.lat);
        const lng = Number(body.lng);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
            throw httpError(400, 'invalid coordinates');
        }
        values.lat = lat;
        values.lng = lng;
    }

    for (const [key, maxLength] of [['title', 200], ['description', 5000], ['emoji', 16]]) {
        if (body[key] === undefined) continue;
        if (typeof body[key] !== 'string' || body[key].length > maxLength) throw httpError(400, `invalid ${key}`);
        values[key] = body[key];
    }

    if (body.visited_at !== undefined && body.visited_at !== null) {
        const date = new Date(body.visited_at);
        if (Number.isNaN(date.getTime())) throw httpError(400, 'invalid visited_at');
        values.visited_at = date.toISOString();
    }

    if (body.place !== undefined) {
        try {
            values.place = parsePlace(body.place);
            // 默认视为手动填写；从备份导入自动识别过的地区时传 false，以后仍然可以被重新识别覆盖
            values.placeManual = body.place_manual !== false;
        } catch (err) {
            if (!lenientPlace) throw err; // 批量导入时，个别无效的地区信息直接忽略，不影响整批导入
        }
    }
    return values;
}

// 带着地区创建的（比如从备份导入）：手动填写的标记为手动，不再自动识别；
// 自动识别过的（regionAuto）只是把结果一起带过来，place_manual 仍是 false
async function insertPoint(client, values) {
    const place = values.place ? JSON.stringify(values.place) : null;
    const { rows } = await client.query(
        `INSERT INTO points (title, description, emoji, geom, visited_at, place, place_manual, place_checked_at)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), COALESCE($6::timestamptz, now()),
                 $7::jsonb, $7::jsonb IS NOT NULL AND $8, CASE WHEN $7::jsonb IS NULL THEN NULL ELSE now() END)
         RETURNING ${SELECT_COLUMNS}`,
        [values.title ?? '', values.description ?? '', values.emoji ?? '📍', values.lng, values.lat, values.visited_at ?? null,
         place, values.placeManual !== false]
    );
    return toPoint(rows[0]);
}

// 只删除 UPLOAD_DIR 内的文件，防止路径穿越
async function removeImageFile(relativePath) {
    if (!relativePath) return;
    const absolute = path.resolve(config.uploadDir, relativePath);
    if (!absolute.startsWith(config.uploadDir + path.sep)) return;
    await fs.rm(absolute, { force: true });
}

router.get('/', async (req, res) => {
    // ?ids=1,2,3：只取这几个标注（前端新建标注后，用它刷新后台查到的所在地区）
    if (req.query.ids !== undefined) {
        const ids = String(req.query.ids).split(',').filter(Boolean).slice(0, 1000).map(parseId);
        const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM points WHERE id = ANY($1::bigint[])`, [ids]);
        return res.json(rows.map(toPoint));
    }
    const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM points ORDER BY visited_at`);
    res.json(rows.map(toPoint));
});

router.post('/', async (req, res) => {
    const point = await insertPoint(pool, parsePointInput(req.body, { partial: false }));
    wakeGeocoder();
    res.status(201).json(point);
});

// 批量导入（JSON 导入时使用），在一个事务里完成
router.post('/batch', async (req, res) => {
    if (!Array.isArray(req.body) || req.body.length === 0 || req.body.length > 5000) {
        throw httpError(400, 'body must be an array of 1-5000 points');
    }
    const inputs = req.body.map(item => parsePointInput(item, { partial: false, lenientPlace: true }));
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const created = [];
        for (const values of inputs) created.push(await insertPoint(client, values));
        await client.query('COMMIT');
        wakeGeocoder();
        res.status(201).json(created);
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
});

router.patch('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const values = parsePointInput(req.body, { partial: true });

    const sets = [];
    const params = [];
    for (const key of ['title', 'description', 'emoji', 'visited_at']) {
        if (values[key] === undefined) continue;
        params.push(values[key]);
        sets.push(`${key} = $${params.length}`);
    }
    if (values.lat !== undefined) {
        params.push(values.lng, values.lat);
        sets.push(`geom = ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)`);
    }
    const resetPlace = values.place === null || (values.lat !== undefined && !values.place);
    if (values.place) {
        // 手动修改的所在地区：以后不会被自动识别覆盖
        params.push(JSON.stringify(values.place));
        sets.push(`place = $${params.length}`, 'place_manual = true', 'place_checked_at = now()');
    } else if (resetPlace) {
        // 恢复自动识别，或者位置变了：清空所在地区，后台重新查询
        sets.push('place = NULL', 'place_checked_at = NULL', 'place_manual = false');
    }
    if (sets.length === 0) throw httpError(400, 'nothing to update');

    params.push(id);
    const { rows } = await pool.query(
        `UPDATE points SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING ${SELECT_COLUMNS}`,
        params
    );
    if (rows.length === 0) throw httpError(404, 'point not found');
    if (resetPlace) wakeGeocoder();
    res.json(toPoint(rows[0]));
});

async function selectPoint(id) {
    const { rows } = await pool.query(`SELECT ${SELECT_COLUMNS} FROM points WHERE id = $1`, [id]);
    if (rows.length === 0) throw httpError(404, 'point not found');
    return toPoint(rows[0]);
}

// 添加一张照片，排在最后
router.post('/:id/photos', upload.single('image'), async (req, res) => {
    const id = parseId(req.params.id);
    if (!req.file) throw httpError(400, 'image required (jpeg/png/webp/gif)');

    const { rows: existing } = await pool.query(
        'SELECT (SELECT count(*) FROM point_photos WHERE point_id = $1)::int AS count FROM points WHERE id = $1', [id]);
    if (existing.length === 0) throw httpError(404, 'point not found');
    if (existing[0].count >= MAX_PHOTOS) throw httpError(400, `at most ${MAX_PHOTOS} photos per point`);

    const now = new Date();
    const relativePath = path.posix.join(
        String(now.getFullYear()),
        String(now.getMonth() + 1).padStart(2, '0'),
        `${id}-${crypto.randomUUID()}.${IMAGE_EXTENSIONS[req.file.mimetype]}`
    );
    const absolutePath = path.join(config.uploadDir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, req.file.buffer);

    try {
        await pool.query(
            `INSERT INTO point_photos (point_id, path, sort)
             VALUES ($1, $2, COALESCE((SELECT max(sort) + 1 FROM point_photos WHERE point_id = $1), 0))`,
            [id, relativePath]
        );
    } catch (err) {
        await removeImageFile(relativePath); // 标注刚好被删掉等情况，不留下孤立的文件
        throw err;
    }
    await pool.query('UPDATE points SET updated_at = now() WHERE id = $1', [id]);
    res.json(await selectPoint(id));
});

router.delete('/:id/photos/:photoId', async (req, res) => {
    const id = parseId(req.params.id);
    const photoId = parseId(req.params.photoId);
    const { rows } = await pool.query(
        'DELETE FROM point_photos WHERE id = $1 AND point_id = $2 RETURNING path', [photoId, id]);
    if (rows.length === 0) throw httpError(404, 'photo not found');
    await pool.query('UPDATE points SET updated_at = now() WHERE id = $1', [id]);
    await removeImageFile(rows[0].path);
    res.json(await selectPoint(id));
});

router.delete('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    // 照片记录会随标注级联删除，文件要先查出来自己删
    const { rows: photos } = await pool.query('SELECT path FROM point_photos WHERE point_id = $1', [id]);
    const { rowCount } = await pool.query('DELETE FROM points WHERE id = $1', [id]);
    if (rowCount === 0) throw httpError(404, 'point not found');
    for (const photo of photos) await removeImageFile(photo.path);
    res.status(204).end();
});

export default router;
