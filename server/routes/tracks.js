// GPX 轨迹：列出、导入、删除
//   GET    /api/tracks        所有轨迹（几何是简化过的，用于显示）
//   POST   /api/tracks        导入一条（前端解析好 GPX 后提交）
//   DELETE /api/tracks/:id
import { Router } from 'express';
import { pool } from '../db.js';
import { httpError, parseId } from '../errors.js';

const router = Router();

const SPORTS = ['running', 'hiking', 'walking', 'cycling', 'swimming', 'other'];
const MAX_POINTS = 200000;       // 一条轨迹最多几个点
// 显示用的简化容差，约 1 米：2400 个点的跑步轨迹简化成 200 个（2 KB），放大到最高级别也看不出差别。
// 在读取时才简化，不存下来：以后调整这个值，已经导入的轨迹也跟着变
const SIMPLIFY_TOLERANCE = 0.00001;

function toTrack(row) {
    return {
        id: Number(row.id),
        name: row.name,
        sport: row.sport,
        started_at: row.started_at,
        ended_at: row.ended_at,
        distance_m: row.distance_m,
        ascent_m: row.ascent_m,
        geometry: row.geometry ?? null,
        pace_profile: row.pace_profile ?? null
    };
}

// 配速剖面：[[[经度, 纬度, 速度], ...], ...]，数据不对就当作没有，不影响导入
function parsePaceProfile(input) {
    if (!Array.isArray(input)) return null;
    const segments = input
        .filter(Array.isArray)
        .map(segment => segment
            .filter(point => Array.isArray(point) && point.length >= 3 && point.every(value => Number.isFinite(Number(value))))
            .map(([lng, lat, speed]) => [Number(Number(lng).toFixed(6)), Number(Number(lat).toFixed(6)), Number(Number(speed).toFixed(2))]))
        .filter(segment => segment.length >= 2);
    const total = segments.reduce((sum, segment) => sum + segment.length, 0);
    return segments.length && total <= 20000 ? segments : null;
}

// 前端提交的是 [[[lng, lat], ...], ...]：每段一个数组
function parseSegments(input) {
    if (!Array.isArray(input) || input.length === 0) throw httpError(400, 'segments required');
    let total = 0;
    const segments = [];
    for (const segment of input) {
        if (!Array.isArray(segment)) throw httpError(400, 'invalid segment');
        const points = segment.filter(point => Array.isArray(point) && point.length >= 2
            && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))
            && Math.abs(Number(point[1])) <= 90 && Math.abs(Number(point[0])) <= 180);
        total += points.length;
        if (total > MAX_POINTS) throw httpError(400, 'too many points');
        if (points.length >= 2) segments.push(points.map(([lng, lat]) => [Number(lng), Number(lat)]));
    }
    if (!segments.length) throw httpError(400, 'no usable points');
    return segments;
}

router.get('/', async (req, res) => {
    const { rows } = await pool.query(
        `SELECT id, name, sport, started_at, ended_at, distance_m, ascent_m, pace_profile,
                ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, $1), 5)::json AS geometry
         FROM tracks WHERE user_id = $2 ORDER BY started_at DESC`,
        [SIMPLIFY_TOLERANCE, req.user.id]
    );
    res.json(rows.map(toTrack));
});

router.post('/', async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object') throw httpError(400, 'invalid body');
    const started = new Date(body.started_at);
    if (Number.isNaN(started.getTime())) throw httpError(400, 'invalid started_at');
    const ended = body.ended_at ? new Date(body.ended_at) : null;
    if (ended && Number.isNaN(ended.getTime())) throw httpError(400, 'invalid ended_at');
    if (typeof body.name !== 'string' || body.name.length > 200) throw httpError(400, 'invalid name');
    const sport = SPORTS.includes(body.sport) ? body.sport : 'other';
    const segments = parseSegments(body.segments);
    const profile = parsePaceProfile(body.pace_profile);
    const geojson = JSON.stringify({ type: 'MultiLineString', coordinates: segments });

    const { rows } = await pool.query(
        `INSERT INTO tracks (name, sport, started_at, ended_at, distance_m, ascent_m, geom, pace_profile, user_id)
         SELECT $1, $2, $3::timestamptz, $4::timestamptz, $5, $6, g, $8::jsonb, $9
         FROM (SELECT ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326)) AS g) s
         ON CONFLICT (user_id, started_at) DO UPDATE
             SET pace_profile = EXCLUDED.pace_profile
             WHERE tracks.pace_profile IS NULL AND EXCLUDED.pace_profile IS NOT NULL
         RETURNING id, name, sport, started_at, ended_at, distance_m, ascent_m, pace_profile,
                   (xmax <> 0) AS updated,
                   ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.00001), 5)::json AS geometry`,
        [body.name.trim(), sport, started.toISOString(), ended?.toISOString() ?? null,
         Number(body.distance_m) || 0, Number.isFinite(Number(body.ascent_m)) ? Number(body.ascent_m) : null, geojson,
         // 没有配速数据时要存真正的 NULL：存成 jsonb 的 'null' 的话，
         // 下次重新导入就不会认为"缺数据"，也就补不上了
         profile ? JSON.stringify(profile) : null, req.user.id]
    );
    // 已经导入过、也没有新数据可补：告诉前端跳过了，不当作错误
    if (!rows.length) return res.status(200).json({ duplicate: true });
    // xmax <> 0 表示这次是更新了已有的那条（补上了配速数据）
    if (rows[0].updated) return res.status(200).json({ ...toTrack(rows[0]), updated: true });
    res.status(201).json(toTrack(rows[0]));
});

router.delete('/:id', async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM tracks WHERE id = $1 AND user_id = $2', [parseId(req.params.id), req.user.id]);
    if (!rowCount) throw httpError(404, 'track not found');
    res.status(204).end();
});

export default router;
