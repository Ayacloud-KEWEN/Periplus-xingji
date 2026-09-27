// 用 UNESCO 官方名录校对世界遗产数据：npm run check:heritage
//
// 我们分发的数据来自 Wikidata（CC0），坐标时有缺漏或错误。UNESCO 官网的联合供稿里
// 有组成部分级别的坐标，准确得多，但它的条款要求"转载需事先书面授权、不得修改内容"，
// 所以官方数据**只在本机用来比对，不写进仓库、不参与分发**：
// 下载的 XML 放在系统临时目录，本脚本只输出"哪里对不上"和建议怎么改。
// 你自己判断之后，把要改的写进 scripts/build-heritage.js 的 COORD_FIXES / EXTRA_POINTS
// （单个坐标是事实，不受版权保护；请只按需摘取少量，不要整份搬运）。
//
// 用法：
//   npm run check:heritage            比对，输出每类前 20 条
//   npm run check:heritage -- --all   全部输出
//   npm run check:heritage -- --refresh 强制重新下载（默认缓存一天）
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ROOT_DIR } from '../server/config.js';

const LIST_URL = 'https://whc.unesco.org/en/list/xml/';
const USER_AGENT = 'Periplus/2.0 (self-hosted personal map; data check; https://github.com/Ayacloud-KEWEN/Periplus-xingji)';
const CACHE = path.join(os.tmpdir(), 'periplus-whc-list.xml');
const CACHE_MS = 24 * 60 * 60 * 1000;
const OURS = path.join(ROOT_DIR, 'server', 'data', 'world-heritage.json');

const args = process.argv.slice(2);
const showAll = args.includes('--all');
const LIMIT = showAll ? Infinity : 20;

function km(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * rad / 2) ** 2
        + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lng2 - lng1) * rad / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
}

// 官方 XML 里的名称带 HTML 实体和 <em> 标签
function clean(value) {
    return String(value || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&#x([0-9a-f]+);/gi, (m, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .trim();
}

const tag = (block, name) => {
    const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
    return match ? clean(match[1].replace(/<!\[CDATA\[|\]\]>/g, '')) : null;
};

async function officialList() {
    let cached = null;
    try {
        const stat = await fs.stat(CACHE);
        if (!args.includes('--refresh') && Date.now() - stat.mtimeMs < CACHE_MS) cached = await fs.readFile(CACHE, 'utf8');
    } catch { /* 没有缓存就下载 */ }

    if (!cached) {
        console.log('正在下载 UNESCO 官方名录…');
        const response = await fetch(LIST_URL, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(`UNESCO ${response.status}`);
        cached = await response.text();
        await fs.writeFile(CACHE, cached);
        console.log(`已缓存到 ${CACHE}（一天内不再重复下载）`);
    } else {
        console.log(`用的是缓存 ${CACHE}（加 --refresh 可强制更新）`);
    }

    const sites = [];
    for (const [, row] of cached.matchAll(/<row>([\s\S]*?)<\/row>/g)) {
        const geo = /<geolocations>([\s\S]*?)<\/geolocations>/.exec(row)?.[1] || '';
        const points = [...geo.matchAll(/<poi>([\s\S]*?)<\/poi>/g)]
            .map(([, poi]) => [Number(tag(poi, 'latitude')), Number(tag(poi, 'longitude'))])
            // 缺坐标的 poi 会写成 0,0（非洲外海），去掉
            .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0));
        sites.push({
            id: tag(row, 'id_number'),
            name: tag(row, 'site'),
            states: tag(row, 'states'),
            year: tag(row, 'date_inscribed'),
            points
        });
    }
    return sites;
}

// 输出可以直接粘进 build-heritage.js 的片段
function snippet(id, name, points) {
    const rows = points.map(([lat, lng]) => `        { lat: ${lat}, lng: ${lng}, km: 2, what: '' },`).join('\n');
    return `    // ${name}\n    '${id}': [\n${rows}\n    ],`;
}

function section(title, lines) {
    console.log(`\n${'─'.repeat(72)}\n${title}\n`);
    if (!lines.length) return console.log('  （没有）');
    for (const line of lines.slice(0, LIMIT)) console.log(line);
    if (lines.length > LIMIT) console.log(`  …… 还有 ${lines.length - LIMIT} 条，加 --all 全部看`);
}

async function main() {
    const official = await officialList();
    const ours = JSON.parse(await fs.readFile(OURS, 'utf8'));
    const ourById = new Map(ours.sites.map(site => [site.id, site]));
    const officialById = new Map(official.map(site => [site.id, site]));

    console.log(`\nUNESCO 官方：${official.length} 处，${official.reduce((sum, s) => sum + s.points.length, 0)} 个坐标点`);
    console.log(`本地数据：  ${ours.sites.length} 处，${ours.sites.reduce((sum, s) => sum + s.points.length, 0)} 个坐标点`);

    const missing = [];     // 官方有、我们没有
    const uncovered = [];   // 官方的点全都落在我们的判定范围外
    const partial = [];     // 只罩住了一部分组成部分
    const stray = [];       // 我们有、但离所有官方点都很远的点，疑似坏数据
    let missingPoints = 0;

    for (const site of official) {
        if (!site.points.length) continue;
        const mine = ourById.get(site.id);
        if (!mine) {
            missing.push({ site, why: '本地名录里没有这处遗产（多半是 Wikidata 上没有坐标，生成时被跳过）' });
            continue;
        }
        const outside = site.points.filter(([lat, lng]) => !mine.points.some(([a, b, r]) => km(lat, lng, a, b) <= r));
        if (!outside.length) continue;
        missingPoints += outside.length;
        const nearest = Math.min(...outside.flatMap(([lat, lng]) => mine.points.map(([a, b, r]) => km(lat, lng, a, b) - r)));
        (outside.length === site.points.length ? uncovered : partial).push({ site, mine, outside, nearest });
    }

    for (const mine of ours.sites) {
        const site = officialById.get(mine.id);
        if (!site?.points.length) continue;
        for (const [lat, lng, radius] of mine.points) {
            const nearest = Math.min(...site.points.map(([a, b]) => km(lat, lng, a, b)));
            // 离官方所有点都在 50 公里以外：多半是 Wikidata 上串进来的坏坐标
            if (nearest > 50) stray.push({ mine, site, point: [lat, lng, radius], nearest });
        }
    }

    const onlyOurs = ours.sites.filter(site => !officialById.has(site.id));

    uncovered.sort((a, b) => b.nearest - a.nearest);
    partial.sort((a, b) => b.outside.length - a.outside.length);
    stray.sort((a, b) => b.nearest - a.nearest);

    section(`① 官方有、本地没有的遗产：${missing.length} 处（去过也不会被算上）`,
        missing.map(({ site }) => `  ${site.id} ${site.name}（${site.states}，${site.year} 年）— 官方 ${site.points.length} 个坐标点`));

    section(`② 官方的坐标全都落在判定范围外：${uncovered.length} 处（去过也不会被算上）`,
        uncovered.map(({ site, mine, nearest }) =>
            `  ${site.id} ${site.name} — 官方 ${site.points.length} 点 / 本地 ${mine.points.length} 点，最近的还差 ${nearest.toFixed(1)} km`));

    section(`③ 只罩住了一部分：${partial.length} 处，合计漏掉 ${missingPoints - uncovered.reduce((n, x) => n + x.outside.length, 0)} 个组成部分`,
        partial.map(({ site, mine, outside }) =>
            `  ${site.id} ${site.name} — 官方 ${site.points.length} 点，漏 ${outside.length} 个（本地 ${mine.points.length} 点）`));

    // 官方只给一个中心点、而本地有多个组成部分时，这里会误报，所以把两边的点数一并列出来好判断
    section(`④ 疑似坏坐标：本地某个点离官方所有点都超过 50 km，共 ${stray.length} 个`
        + '\n   （官方点数远少于本地时多半是误报：官方只给了中心点，本地列的是各组成部分）',
        stray.map(({ mine, site, point, nearest }) =>
            `  ${mine.id} ${site.name} — 本地的点 ${point[0]}, ${point[1]}（半径 ${point[2]} km）离官方最近的点 ${nearest.toFixed(0)} km`
            + `｜官方 ${site.points.length} 点 / 本地 ${mine.points.length} 点`));

    section(`⑤ 本地有、官方名录里没有：${onlyOurs.length} 处（可能已除名或编号对不上）`,
        onlyOurs.map(site => `  ${site.id} ${site.name.zh || site.name.en}`));

    if (missing.length || uncovered.length) {
        console.log(`\n${'─'.repeat(72)}\n可以粘进 scripts/build-heritage.js 的 EXTRA_POINTS（① 和 ② 的前 ${Math.min(LIMIT, missing.length + uncovered.length)} 处，`
            + `半径先填 2 km，请按实际范围调整，what 填组成部分名称）：\n`);
        for (const { site } of [...missing, ...uncovered].slice(0, LIMIT)) console.log(snippet(site.id, site.name, site.points));
    }

    console.log(`\n${'─'.repeat(72)}`);
    console.log('提醒：UNESCO 的数据只用于本机比对，不要整份写进仓库——它的条款要求转载需事先书面授权、且不得修改内容。');
    console.log('按需摘取少量坐标作为更正是可以的（单个坐标是事实，不受版权保护）。');
}

main().catch((err) => {
    console.error('校对失败:', err.message);
    process.exitCode = 1;
});
