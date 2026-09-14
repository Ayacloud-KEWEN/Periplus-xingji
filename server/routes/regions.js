// 点亮地图：现代行政区边界，以及每个区域里有多少个标注
//   GET /api/regions?level=0              所有国家和地区
//   GET /api/regions?level=1&country=cn,jp 指定国家的所有省 / 州
//
// 标注属于哪个国家，和足迹统计用同一个来源（逆地理编码结果 + 特殊地区规则），两边的国家数才对得上；
// 还没识别出来的标注（或关闭了逆地理编码）才按坐标落在哪个国家边界里算。
// 省 / 州按坐标匹配，但只在标注所属国家的省里找；海边、港口、小岛上的标注常常落在简化过的
// 海岸线外面，这时算作 50 公里内最近的那个省。
import { Router } from 'express';
import { pool } from '../db.js';
import { httpError } from '../errors.js';
import { resolvePlace } from '../special-regions.js';

const router = Router();
const CODE = /^[a-z][a-z0-9-]{1,30}$/;
const NEAREST_DEGREES = 0.5; // 约 50 公里：坐标不在任何边界里时，往外找多远

// 每个标注所属的国家代码；place 为 {}（海上等查不到的地方）的不计，和足迹统计一致
async function pinCountries() {
    const { rows } = await pool.query(
        `SELECT p.id, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lng, p.visited_at, p.place, p.place_manual,
                CASE WHEN p.place IS NULL THEN COALESCE(
                    (SELECT r.code FROM admin_regions r WHERE r.level = 0 AND ST_Intersects(r.geom, p.geom) LIMIT 1),
                    (SELECT r.code FROM admin_regions r WHERE r.level = 0 AND ST_DWithin(r.geom, p.geom, $1)
                     ORDER BY r.geom <-> p.geom LIMIT 1)
                ) END AS spatial
         FROM points p`,
        [NEAREST_DEGREES]
    );
    return rows.map(row => ({
        id: row.id,
        visitedAt: row.visited_at,
        country: row.place ? resolvePlace(row.place, row.lat, row.lng, row.place_manual)?.countryCode || null : row.spatial
    })).filter(pin => pin.country);
}

function tally(counts, code, visitedAt) {
    const entry = counts.get(code) || { pins: 0, firstVisit: null };
    entry.pins++;
    if (!entry.firstVisit || visitedAt < entry.firstVisit) entry.firstVisit = visitedAt;
    counts.set(code, entry);
}

router.get('/', async (req, res) => {
    const level = req.query.level === '1' ? 1 : 0;
    let countries = null;
    if (level === 1) {
        countries = String(req.query.country || '').toLowerCase().split(',').filter(Boolean);
        if (!countries.length || countries.length > 300 || !countries.every(code => CODE.test(code))) {
            throw httpError(400, 'country required');
        }
    }

    const pins = await pinCountries();
    const counts = new Map(); // 区域代码 → { pins, firstVisit }
    if (level === 0) {
        for (const pin of pins) tally(counts, pin.country, pin.visitedAt);
    } else {
        const wanted = pins.filter(pin => countries.includes(pin.country));
        const { rows } = await pool.query(
            `SELECT w.id, COALESCE(
                    (SELECT r.code FROM admin_regions r
                     WHERE r.level = 1 AND r.country = w.country AND ST_Intersects(r.geom, p.geom) LIMIT 1),
                    (SELECT r.code FROM admin_regions r
                     WHERE r.level = 1 AND r.country = w.country AND ST_DWithin(r.geom, p.geom, $3)
                     ORDER BY r.geom <-> p.geom LIMIT 1)
                ) AS code
             FROM unnest($1::bigint[], $2::text[]) AS w(id, country)
             JOIN points p ON p.id = w.id`,
            [wanted.map(pin => pin.id), wanted.map(pin => pin.country), NEAREST_DEGREES]
        );
        const byId = new Map(wanted.map(pin => [String(pin.id), pin]));
        for (const row of rows) if (row.code) tally(counts, row.code, byId.get(String(row.id)).visitedAt);
    }

    const { rows } = await pool.query(
        `SELECT code, country, names, ST_AsGeoJSON(COALESCE(geom_simple, geom), 3)::json AS geometry
         FROM admin_regions WHERE level = $1 AND ($2::text[] IS NULL OR country = ANY($2))`,
        [level, countries]
    );
    res.json({
        type: 'FeatureCollection',
        features: rows.map(row => ({
            type: 'Feature',
            geometry: row.geometry,
            properties: {
                code: row.code, country: row.country, names: row.names,
                pins: counts.get(row.code)?.pins ?? 0, firstVisit: counts.get(row.code)?.firstVisit ?? null
            }
        }))
    });
});

export default router;
