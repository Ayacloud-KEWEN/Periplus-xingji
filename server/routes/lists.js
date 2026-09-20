// "数据统计"工具页要的完整名录：TCC 名单和世界遗产名录，都带上"你去过哪些"。
// 统计面板（/api/stats）只返回去过的那些，这里要的是整份名录，所以单独开接口。
//   GET /api/lists/countries 全部国家和地区代码（含大洲）
//   GET /api/lists/tcc       TCC 的 330 个国家和地区
//   GET /api/lists/heritage  世界遗产全部 1263 处
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { pool } from '../db.js';
import { resolvePlace } from '../special-regions.js';
import { matchTcc, tccMeta, tccRegions } from '../tcc.js';
import { heritageSites, heritageTotal, matchHeritage } from '../heritage.js';
import { COUNTRY_CODES, continentOf } from '../continents.js';
import { specialRegions } from '../special-regions.js';
import { ROOT_DIR } from '../config.js';

// 有哪些代码有国旗文件：单独分出来的地区（北塞浦路斯、索马里兰）没有，页面上留空位
let flagCodes = new Set();
try {
    flagCodes = new Set(fs.readdirSync(path.join(ROOT_DIR, 'public', 'vendor', 'flags'))
        .filter(file => file.endsWith('.svg'))
        .map(file => file.replace('.svg', '')));
} catch (err) {
    console.warn('国旗目录读取失败，数据统计页不显示国旗:', err.message);
}

const router = Router();

// 所有标注，套用过特殊地区规则；两个名录的匹配都从这里取
async function locatedPoints() {
    const { rows } = await pool.query(
        `SELECT id, ST_Y(geom) AS lat, ST_X(geom) AS lng, visited_at, place, place_manual FROM points`
    );
    return rows.map(point => {
        const place = resolvePlace(point.place, point.lat, point.lng, point.place_manual);
        return {
            id: Number(point.id), lat: point.lat, lng: point.lng, visited_at: point.visited_at,
            visitedAt: point.visited_at, countryCode: place?.countryCode || null, state: place?.state || null
        };
    });
}

// 去过的国家 / 地区：和统计面板的"国家和地区"数用同一套判定
function visitedCountries(points) {
    const visited = new Map();
    for (const point of points) {
        if (!point.countryCode) continue;
        let entry = visited.get(point.countryCode);
        if (!entry) {
            entry = { code: point.countryCode, pins: [], firstVisit: null };
            visited.set(point.countryCode, entry);
        }
        entry.pins.push(point.id);
        if (!entry.firstVisit || point.visitedAt < entry.firstVisit) entry.firstVisit = point.visitedAt;
    }
    return [...visited.values()];
}

router.get('/countries', async (req, res) => {
    const specials = specialRegions();
    const specialByCode = new Map(specials.map(region => [region.code, region]));
    // 特殊地区的代码有的本来就是 ISO 代码（留尼汪 re、西撒哈拉 eh），去重后统一带上大洲和名称
    const codes = [...new Set([...COUNTRY_CODES, ...specials.map(region => region.code)])];
    const countries = codes.map(code => {
        const special = specialByCode.get(code);
        return {
            code,
            continent: special?.continent || continentOf(code) || '',
            flag: flagCodes.has(code),
            // 有 ISO 代码的让前端用浏览器内置的地区名称表，只有特殊地区要带名称过去
            name: special && !COUNTRY_CODES.includes(code) ? special.name : null
        };
    }).sort((a, b) => a.code.localeCompare(b.code));

    res.json({ total: countries.length, countries, visited: visitedCountries(await locatedPoints()) });
});

router.get('/tcc', async (req, res) => {
    const points = await locatedPoints();
    res.json({
        ...tccMeta(),
        regions: tccRegions(),
        visited: matchTcc(points.filter(point => point.countryCode))
    });
});

router.get('/heritage', async (req, res) => {
    const points = await locatedPoints();
    res.json({
        total: heritageTotal(),
        sites: heritageSites(),
        // 遗产按坐标匹配，没识别出国家的标注（海上、还没查）照样参与
        visited: matchHeritage(points)
    });
});

export default router;
