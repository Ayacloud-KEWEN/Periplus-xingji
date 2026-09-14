// 生成世界遗产数据：npm run build:heritage
// 数据来自 Wikidata（CC0 协议），写入 server/data/world-heritage.json。
// 联合国教科文组织每年更新一次名录，更新后重新运行本脚本即可。
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT_DIR } from '../server/config.js';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'Periplus/2.0 (self-hosted personal map; build-heritage script; https://github.com/Ayacloud-KEWEN/Periplus-xingji)';
const OUTPUT = path.join(ROOT_DIR, 'server', 'data', 'world-heritage.json');

// 正式列入且未被除名的世界遗产（P757 = 世界遗产编号，P1435 = 遗产认定，Q9259 = 世界遗产）
const SITES_QUERY = `
SELECT ?item ?whs ?coord ?area ?cc ?year ?en ?zh ?zhHans ?zhCn ?fr WHERE {
  ?item wdt:P757 ?whs .
  FILTER(!CONTAINS(?whs, "-"))
  ?item p:P1435 ?designation .
  ?designation ps:P1435 wd:Q9259 .
  FILTER NOT EXISTS { ?designation pq:P582 ?removed }
  OPTIONAL { ?designation pq:P580 ?inscribed . BIND(YEAR(?inscribed) AS ?year) }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item p:P2046/psn:P2046/wikibase:quantityAmount ?area }
  OPTIONAL { ?item wdt:P17/wdt:P297 ?cc }
  OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?item rdfs:label ?zh FILTER(LANG(?zh) = "zh") }
  OPTIONAL { ?item rdfs:label ?zhHans FILTER(LANG(?zhHans) = "zh-hans") }
  OPTIONAL { ?item rdfs:label ?zhCn FILTER(LANG(?zhCn) = "zh-cn") }
  OPTIONAL { ?item rdfs:label ?fr FILTER(LANG(?fr) = "fr") }
}`;

// 组合遗产的组成部分（编号形如 1335-012），用来匹配分布在多处的遗产
const COMPONENTS_QUERY = `
SELECT ?whs ?coord ?area WHERE {
  ?item wdt:P757 ?whs ; wdt:P625 ?coord .
  FILTER(CONTAINS(?whs, "-"))
  OPTIONAL { ?item p:P2046/psn:P2046/wikibase:quantityAmount ?area }
}`;

async function query(sparql) {
    const response = await fetch(`${ENDPOINT}?format=json&query=${encodeURIComponent(sparql)}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' }
    });
    if (!response.ok) throw new Error(`Wikidata ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return (await response.json()).results.bindings;
}

// "1004bis"、"1305rev" → "1004"、"1305"
function baseId(whs) {
    return /^\d+/.exec(whs)?.[0] || whs;
}

// "Point(经度 纬度)" → [纬度, 经度]
function parsePoint(wkt) {
    const match = /^Point\(([-\d.eE]+) ([-\d.eE]+)\)$/.exec(wkt || '');
    return match ? [Number(match[2]), Number(match[1])] : null;
}

// 匹配半径（公里）：按面积换算成等面积圆的半径，再加 0.5 公里余量。
// 城市里的遗产往往相距只有一两公里，半径定得太宽会把附近的遗产也算进来。
function radiusKm(areaM2, fallback) {
    if (!areaM2 || areaM2 <= 0) return fallback;
    const radius = Math.sqrt(areaM2 / Math.PI) / 1000 + 0.5;
    return Math.min(25, Math.max(0.8, radius));
}

const round = (value, digits) => Number(value.toFixed(digits));

async function main() {
    console.log('正在查询世界遗产...');
    const siteRows = await query(SITES_QUERY);
    console.log('正在查询组合遗产的组成部分...');
    const componentRows = await query(COMPONENTS_QUERY);

    // 扩展（bis、ter）和边界修订（rev）在 Wikidata 里是单独的条目，这里合并到同一处遗产，
    // 名称优先用不带后缀的主条目
    const sites = new Map();
    for (const row of siteRows) {
        const id = baseId(row.whs.value);
        const isPrimary = row.whs.value === id;
        if (!sites.has(id)) sites.set(id, { id, name: {}, countries: new Set(), year: null, area: 0, coords: new Map() });
        const site = sites.get(id);
        const setName = (lang, value) => {
            if (value && (isPrimary || !site.name[lang])) site.name[lang] = value;
        };
        setName('en', row.en?.value);
        setName('zh', row.zhHans?.value || row.zhCn?.value || row.zh?.value); // 优先简体，"zh" 标签常常是繁体
        setName('fr', row.fr?.value);
        if (row.cc) site.countries.add(row.cc.value.toLowerCase());
        if (row.year) site.year = site.year ? Math.min(site.year, Number(row.year.value)) : Number(row.year.value);
        if (row.area) site.area = Math.max(site.area, Number(row.area.value));
        const point = parsePoint(row.coord?.value);
        if (point) site.coords.set(point.join(','), point);
    }

    let componentCount = 0;
    const components = new Map();
    for (const row of componentRows) {
        const siteId = baseId(row.whs.value.split('-')[0]);
        const point = parsePoint(row.coord.value);
        if (!point || !sites.has(siteId)) continue;
        const key = point.join(',');
        if (!components.has(siteId)) components.set(siteId, new Map());
        const existing = components.get(siteId).get(key);
        components.get(siteId).set(key, { point, area: Math.max(existing?.area || 0, Number(row.area?.value || 0)) });
    }

    const output = [];
    for (const site of sites.values()) {
        const parts = components.get(site.id);
        // 没有面积数据时：整处遗产默认 2 公里，组合遗产的单个组成部分默认 1 公里。
        // 组合遗产的面积是所有组成部分的总和，按它算出的半径会罩住中心点周围一大片，
        // 所以有组成部分时，中心点只用默认的 2 公里
        const siteRadius = parts?.size ? 2 : radiusKm(site.area, 2);
        const points = [...site.coords.values()].map(([lat, lng]) => [round(lat, 5), round(lng, 5), round(siteRadius, 1)]);
        for (const { point: [lat, lng], area } of parts?.values() || []) {
            points.push([round(lat, 5), round(lng, 5), round(radiusKm(area, 1), 1)]);
            componentCount++;
        }
        if (!points.length) continue;
        output.push({
            id: site.id,
            name: Object.fromEntries(Object.entries(site.name).filter(([, value]) => value)),
            countries: [...site.countries].sort(),
            year: site.year,
            points
        });
    }
    output.sort((a, b) => Number.parseInt(a.id, 10) - Number.parseInt(b.id, 10) || a.id.localeCompare(b.id));

    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify({
        source: 'Wikidata (CC0), https://www.wikidata.org',
        generatedAt: new Date().toISOString(),
        sites: output
    }));

    const withoutCoords = [...sites.values()].filter(site => !site.coords.size && !components.has(site.id)).length;
    console.log(`完成：${output.length} 处遗产（其中 ${output.filter(s => s.name.zh).length} 处有中文名），`
        + `${componentCount} 个组成部分，${withoutCoords} 处缺少坐标已跳过`);
    console.log(`已写入 ${OUTPUT}`);
}

main().catch((err) => {
    console.error('生成失败:', err.message);
    process.exitCode = 1;
});
