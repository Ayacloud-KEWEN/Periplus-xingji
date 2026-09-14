import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../db.js';
import { ROOT_DIR } from '../config.js';
import { httpError } from '../errors.js';

const router = Router();

// 历史政权的中文、法文名称（按英文维基百科标题查），由 npm run build:polity-names 生成
let polityNames = {};
try {
    polityNames = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'server', 'data', 'polity-names.json'), 'utf8')).names;
} catch { /* 没有这份数据时只显示英文名 */ }

// 前端加载一次，用来把历史地图弹窗和"历史上的这里"里的政权名换成当前语言
router.get('/names', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(polityNames);
});

// 这个坐标在历史上先后属于哪些政权
router.get('/at', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw httpError(400, 'invalid coordinates');
    }
    const { rows } = await pool.query(
        `SELECT polity_name, wikipedia_url, start_year, end_year
         FROM historical_territories
         WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
         ORDER BY start_year, end_year`,
        [lng, lat]
    );
    // Cliopatria 把同一个政权按疆域变化切成很多段，同一个政权还有好几种写法（比如 "Chu" 和 "(Chu)"）。
    // 按维基百科标题（没有就按名称）把时间相连或重叠的合并成一段
    const spans = [];
    const lastByKey = new Map();
    for (const row of rows) {
        const key = row.wikipedia_url || row.polity_name;
        const last = lastByKey.get(key);
        if (last && row.start_year <= last.end + 1) {
            last.end = Math.max(last.end, row.end_year);
            continue;
        }
        const span = { name: row.polity_name, wiki: row.wikipedia_url, start: row.start_year, end: row.end_year };
        spans.push(span);
        lastByKey.set(key, span);
    }
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(spans);
});

// 疆域数据导入后不会变化，按年份缓存序列化结果，树莓派上拖动滑块也能秒回
const cache = new Map();
const CACHE_MAX_ENTRIES = 300;

router.get('/', async (req, res) => {
    const year = Number.parseInt(req.query.year, 10);
    if (!Number.isInteger(year) || year < -10000 || year > 3000) throw httpError(400, 'invalid year');

    let body = cache.get(year);
    if (!body) {
        const { rows } = await pool.query(
            `SELECT COALESCE(json_agg(json_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(COALESCE(geom_simple, geom), 4)::json,
                        'properties', json_build_object('name', polity_name, 'wiki', wikipedia_url)
                    )), '[]'::json) AS features
             FROM historical_territories
             WHERE start_year <= $1 AND end_year >= $1`,
            [year]
        );
        body = JSON.stringify({ type: 'FeatureCollection', features: rows[0].features });
        cache.set(year, body);
        if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
    }

    res.set('Cache-Control', 'public, max-age=604800');
    res.type('application/json').send(body);
});

// 数据覆盖的年份范围，前端用来设置滑块
router.get('/range', async (req, res) => {
    const { rows } = await pool.query(
        'SELECT min(start_year) AS min, max(end_year) AS max, count(*)::int AS count FROM historical_territories'
    );
    res.json(rows[0]);
});

export default router;
