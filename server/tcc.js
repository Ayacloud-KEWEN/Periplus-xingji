// Travelers' Century Club（TCC）名单统计：标注落在名单里的哪一条，就算去过。
// 名单和匹配规则写在 server/data/tcc-regions.json。
//
// 和"国家数"不是一回事：TCC 把一些大国里离本土较远的部分单独计数（夏威夷、西西里、桑给巴尔……）。
// 所以匹配分两层：先看标注属于哪个国家 / 地区代码，再用 when 里的条件（省名或经纬度框）分出是哪一条。
// 同一个国家下带 when 的条目先判，都不命中才归到这个国家的默认条目（比如"美国本土""意大利"）。
// 没有规则能分出来的条目（南极洲那几个相互重叠的领地声索）不参与匹配，只出现在分母里，
// 所以"已去过 / 330"只会偏小，不会虚高。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';

const DATA_FILE = path.join(ROOT_DIR, 'server', 'data', 'tcc-regions.json');

let data = { zones: [], regions: [], version: '', source: '' };
try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (err) {
    console.warn('TCC 名单读取失败，本次不统计:', err.message);
}

const normalized = (value) => String(value || '').trim().toLowerCase();

// 国家 / 地区代码 → 该国下的名单条目。代码和逆地理编码结果一致，特殊地区规则的代码（north-cyprus 等）也在内。
// 带 when 的排在前面，保证"先具体后默认"
const byCountry = new Map();
for (const region of data.regions) {
    for (const code of region.countryCodes || []) {
        if (!byCountry.has(code.toLowerCase())) byCountry.set(code.toLowerCase(), []);
        byCountry.get(code.toLowerCase()).push(region);
    }
}
for (const regions of byCountry.values()) regions.sort((a, b) => (a.when ? 0 : 1) - (b.when ? 0 : 1));

const zoneOrder = new Map(data.zones.map((zone, index) => [zone.code, index]));

// 一条 when 规则里的条件都要满足；bbox 是 [西经度, 南纬度, 东经度, 北纬度]
function ruleMatches(rule, point) {
    if (rule.stateNames && !rule.stateNames.map(normalized).includes(normalized(point.state))) return false;
    if (rule.bbox) {
        const [west, south, east, north] = rule.bbox;
        if (!(point.lng >= west && point.lng <= east && point.lat >= south && point.lat <= north)) return false;
    }
    return true;
}

function regionOf(point) {
    const candidates = byCountry.get(normalized(point.countryCode));
    if (!candidates) return null;
    for (const region of candidates) {
        if (!region.when) return region;                        // 这个国家的默认条目
        if (region.when.some(rule => ruleMatches(rule, point))) return region;
    }
    return null; // 国家里只有细分条目，一条也没对上（比如印尼：TCC 没有"印尼"这个整体条目）
}

export function tccMeta() {
    const matchable = new Set();
    for (const regions of byCountry.values()) for (const region of regions) matchable.add(region.code);
    return {
        total: data.regions.length,
        matchable: matchable.size,
        version: data.version,
        source: data.source,
        zones: data.zones.map(zone => ({
            ...zone,
            total: data.regions.filter(region => region.zone === zone.code).length
        }))
    };
}

// points: [{ id, countryCode, state, lat, lng, visitedAt }]；返回去过的名单条目，按分区、首次到访时间排序
export function matchTcc(points) {
    const visited = new Map(); // 条目 code → { region, pins, firstVisit }
    for (const point of points) {
        const region = regionOf(point);
        if (!region) continue;
        let entry = visited.get(region.code);
        if (!entry) {
            entry = { region, pins: [], firstVisit: null };
            visited.set(region.code, entry);
        }
        entry.pins.push(point.id);
        if (!entry.firstVisit || point.visitedAt < entry.firstVisit) entry.firstVisit = point.visitedAt;
    }
    return [...visited.values()]
        .map(({ region, pins, firstVisit }) => ({
            code: region.code,
            zone: region.zone,
            name: region.name,
            pins,
            firstVisit
        }))
        .sort((a, b) => zoneOrder.get(a.zone) - zoneOrder.get(b.zone)
            || new Date(a.firstVisit) - new Date(b.firstVisit));
}

// 完整名单（给"TCC 完整名单"工具页用）：三语名称和分区，不含匹配规则
export function tccRegions() {
    return data.regions.map(({ code, zone, name, pending }) => ({ code, zone, name, pending: !!pending }));
}
