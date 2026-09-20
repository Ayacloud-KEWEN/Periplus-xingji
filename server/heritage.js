// 世界遗产匹配：标注落在遗产点（或组合遗产的某个组成部分）的范围内，就算去过
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

const DATA_FILE = path.join(ROOT_DIR, 'server', 'data', 'world-heritage.json');
const KM_PER_DEGREE = 111.2;
const CELL_DEGREES = 1;

let sites = [];
try {
    sites = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).sites;
} catch {
    console.warn('未找到世界遗产数据，运行 npm run build:heritage 生成');
}

// 网格索引：把 5000 多个遗产坐标点按经纬度 1° 分格登记（范围跨格的登记到每个覆盖到的格子）。
// 匹配时每个标注只检查自己所在的格子，1 万个标注的统计从几秒降到几十毫秒。
const cellKey = (row, col) => `${row},${((col % 360) + 360) % 360}`;
const grid = new Map();
for (const site of sites) {
    for (const sitePoint of site.points) {
        const [lat, lng, radiusKm] = sitePoint;
        const dLat = radiusKm / KM_PER_DEGREE;
        const dLng = Math.min(180, radiusKm / (KM_PER_DEGREE * Math.max(0.01, Math.cos(lat * Math.PI / 180))));
        for (let row = Math.floor((lat - dLat) / CELL_DEGREES); row <= Math.floor((lat + dLat) / CELL_DEGREES); row++) {
            for (let col = Math.floor((lng - dLng) / CELL_DEGREES); col <= Math.floor((lng + dLng) / CELL_DEGREES); col++) {
                const key = cellKey(row, col);
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key).push({ site, sitePoint });
            }
        }
    }
}

function distanceKm(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * rad / 2) ** 2
        + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lng2 - lng1) * rad / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
}

export function heritageTotal() {
    return sites.length;
}

// points: [{ id, lat, lng, visited_at }]；返回去过的遗产，按首次到访时间排序
export function matchHeritage(points) {
    const visited = new Map(); // 遗产 id → { site, pins, firstVisit }
    for (const point of points) {
        const candidates = grid.get(cellKey(Math.floor(point.lat / CELL_DEGREES), Math.floor(point.lng / CELL_DEGREES)));
        if (!candidates) continue;
        const matched = new Set(); // 同一处遗产的多个组成部分只算一次
        for (const { site, sitePoint: [lat, lng, radiusKm] } of candidates) {
            if (matched.has(site.id) || distanceKm(point.lat, point.lng, lat, lng) > radiusKm) continue;
            matched.add(site.id);
            let entry = visited.get(site.id);
            if (!entry) {
                entry = { site, pins: [], firstVisit: null };
                visited.set(site.id, entry);
            }
            entry.pins.push(point.id);
            if (!entry.firstVisit || point.visited_at < entry.firstVisit) entry.firstVisit = point.visited_at;
        }
    }
    return [...visited.values()]
        .map(({ site, pins, firstVisit }) => ({
            id: site.id,
            name: site.name,
            countries: site.countries,
            year: site.year,
            pins,
            firstVisit
        }))
        .sort((a, b) => new Date(a.firstVisit) - new Date(b.firstVisit));
}

// 完整名录（给"数据统计"工具页用）：名称、所属国家、列入年份，不含坐标
export function heritageSites() {
    return sites.map(({ id, name, countries, year }) => ({ id, name, countries, year }));
}
