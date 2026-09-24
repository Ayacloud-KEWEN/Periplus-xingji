// 生成世界遗产数据：npm run build:heritage
// 数据来自 Wikidata（CC0 协议），写入 server/data/world-heritage.json。
// 联合国教科文组织每年更新一次名录，更新后重新运行本脚本即可。
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT_DIR } from '../server/config.js';

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'Periplus/2.0 (self-hosted personal map; build-heritage script; https://github.com/Ayacloud-KEWEN/Periplus-xingji)';
const OUTPUT = path.join(ROOT_DIR, 'server', 'data', 'world-heritage.json');

// 已知的坐标错误：Wikidata 上这些坐标明显不对，在这里更正。写在脚本里而不是改生成好的
// 数据文件，重新生成时才不会被覆盖回去。
// 按"遗产编号 + 原坐标"匹配（坐标取小数点后 5 位，和写进文件的精度一致）；to 为 null 表示丢掉这个点。
// 上游改对之后规则会匹配不上，生成时会提示"没用上"，那时候删掉这条即可。
const COORD_FIXES = [
    {
        id: '932', name: 'Jurisdiction of Saint-Emilion',
        from: [44.89472, 0.15528], to: [44.89472, -0.15528],
        why: '经度符号反了：实际在西经 0.155°，记成了东经，位置偏东约 24 公里'
    },
    {
        id: '1660', name: 'Viking Age Ring Fortresses',
        from: [55.3764, 13.1472], to: null,
        why: '这是瑞典特雷勒堡的同名环形要塞，和丹麦这处遗产的五座要塞无关（丹麦的特雷勒堡在西兰岛）'
    },
    {
        id: '102', name: "Qal'at Bani Hammad",
        from: [51.53333, 64.43889], to: null,
        why: '这个点落在哈萨克斯坦，离阿尔及利亚的遗产 5000 多公里，而且半径 25 公里，会把无关的标注算成去过'
    }
];

const usedFixes = new Set();

// 已知的国家记录不全：这几处是跨国遗产，Wikidata 只记了其中一部分国家（1393 干脆没有 P17）。
// 只影响「世界遗产」页面按国家分组，不影响"去过没去过"的判定——那个只看坐标。
const COUNTRY_FIXES = {
    '1314': ['nl'],  // 瓦登海：官方是德国 + 荷兰 + 丹麦
    '1555': ['nl'],  // 慈善聚居地：官方是比利时 + 荷兰
    '1631': ['nl'],  // 下日耳曼界墙：官方是德国 + 荷兰
    '1393': ['il']   // 迦密山人类演化遗址：Wikidata 上没有记国家
};

// 更正一处遗产的坐标点；points 是 [[纬度, 经度, 半径], ...]
function applyFixes(id, points) {
    const fixes = COORD_FIXES.filter(fix => fix.id === id);
    if (!fixes.length) return points;
    const result = [];
    for (const point of points) {
        const fix = fixes.find(candidate => candidate.from[0] === point[0] && candidate.from[1] === point[1]);
        if (!fix) {
            result.push(point);
            continue;
        }
        usedFixes.add(fix);
        if (fix.to) result.push([fix.to[0], fix.to[1], point[2]]);
        console.log(`  更正 ${id} ${fix.name}：${fix.to ? `${point[0]}, ${point[1]} → ${fix.to[0]}, ${fix.to[1]}` : `丢掉 ${point[0]}, ${point[1]}`}（${fix.why}）`);
    }
    return result;
}

// 正式列入且未被除名的世界遗产（P757 = 世界遗产编号，P1435 = 遗产认定，Q9259 = 世界遗产）
const SITES_QUERY = `
SELECT ?item ?whs ?coord ?area ?country ?year ?en ?zh ?zhHans ?zhCn ?fr WHERE {
  ?item wdt:P757 ?whs .
  FILTER(!CONTAINS(?whs, "-"))
  ?item p:P1435 ?designation .
  ?designation ps:P1435 wd:Q9259 .
  FILTER NOT EXISTS { ?designation pq:P582 ?removed }
  OPTIONAL { ?designation pq:P580 ?inscribed . BIND(YEAR(?inscribed) AS ?year) }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item p:P2046/psn:P2046/wikibase:quantityAmount ?area }
  OPTIONAL { ?item wdt:P17 ?country }
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

// 国家条目 → ISO 3166-1 代码。单独查是因为并进主查询会让主查询超时；
// 两句分开也比一句里套 OPTIONAL + COALESCE 快得多（那样写在负载高的时候会 504）。
const countryCodeQuery = (items) => `
SELECT ?c ?cc WHERE {
  VALUES ?c { ${items.map(id => `wd:${id}`).join(' ')} }
  ?c wdt:P297 ?cc .
}`;

// 上一句查不到代码的再往上找一层：Wikidata 上"荷兰"(Q55) 的 P297 被标成了废弃等级，
// wdt: 取不到，代码挂在"荷兰王国"(Q29999) 上（英格兰 → 英国 也是这个情况）。
const parentCodeQuery = (items) => `
SELECT ?c ?cc WHERE {
  VALUES ?c { ${items.map(id => `wd:${id}`).join(' ')} }
  ?c wdt:P17 ?parent .
  ?parent wdt:P297 ?cc .
}`;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Wikidata 的公共端点经常限流（429）或超时（502 / 504），等一会儿重试就好，不必让整个生成失败
async function query(sparql, attempt = 1) {
    const MAX_ATTEMPTS = 5;
    let response;
    try {
        response = await fetch(`${ENDPOINT}?format=json&query=${encodeURIComponent(sparql)}`, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' }
        });
    } catch (err) {
        if (attempt >= MAX_ATTEMPTS) throw err;
        console.warn(`  请求失败（${err.message}），${attempt * 30} 秒后重试（第 ${attempt} 次）`);
        await sleep(attempt * 30000);
        return query(sparql, attempt + 1);
    }
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
        const wait = Number(response.headers.get('retry-after')) * 1000 || attempt * 30000;
        console.warn(`  Wikidata ${response.status}，${Math.round(wait / 1000)} 秒后重试（第 ${attempt} 次）`);
        await sleep(wait);
        return query(sparql, attempt + 1);
    }
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

    console.log('正在解析国家代码...');
    const countryItems = [...new Set(siteRows.map(row => row.country?.value?.split('/').pop()).filter(Boolean))];
    const countryCodes = new Map();
    const collect = (rows) => {
        for (const row of rows) countryCodes.set(row.c.value.split('/').pop(), row.cc.value.toLowerCase());
    };
    collect(await query(countryCodeQuery(countryItems)));
    const noDirectCode = countryItems.filter(id => !countryCodes.has(id));
    if (noDirectCode.length) collect(await query(parentCodeQuery(noDirectCode)));
    const missingCode = countryItems.filter(id => !countryCodes.has(id));
    if (missingCode.length) console.warn(`提示：${missingCode.length} 个国家条目没有 ISO 代码（${missingCode.join(' ')}）`);

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
        const code = countryCodes.get(row.country?.value?.split('/').pop());
        if (code) site.countries.add(code);
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
        const fixed = applyFixes(site.id, points);
        if (!fixed.length) continue;
        output.push({
            id: site.id,
            name: Object.fromEntries(Object.entries(site.name).filter(([, value]) => value)),
            countries: [...new Set([...site.countries, ...(COUNTRY_FIXES[site.id] || [])])].sort(),
            year: site.year,
            points: fixed
        });
    }
    output.sort((a, b) => Number.parseInt(a.id, 10) - Number.parseInt(b.id, 10) || a.id.localeCompare(b.id));

    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify({
        source: 'Wikidata (CC0), https://www.wikidata.org',
        generatedAt: new Date().toISOString(),
        sites: output
    }));

    // 更正规则没用上，多半是上游已经改对了，提示一下好把规则删掉
    for (const fix of COORD_FIXES) {
        if (!usedFixes.has(fix)) console.warn(`提示：${fix.id} ${fix.name} 的坐标更正没用上，可能 Wikidata 已经改对，可以从 COORD_FIXES 里删掉`);
    }

    const withoutCoords = [...sites.values()].filter(site => !site.coords.size && !components.has(site.id)).length;
    console.log(`完成：${output.length} 处遗产（其中 ${output.filter(s => s.name.zh).length} 处有中文名），`
        + `${componentCount} 个组成部分，${withoutCoords} 处缺少坐标已跳过`);
    console.log(`已写入 ${OUTPUT}`);
}

main().catch((err) => {
    console.error('生成失败:', err.message);
    process.exitCode = 1;
});
