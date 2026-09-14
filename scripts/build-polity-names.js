// 生成历史政权的中文、法文名称：npm run build:polity-names（需要先导入历史疆域）
// Cliopatria 的政权名称只有英文，但每条都带英文维基百科标题：
//   1. 用英文维基百科 API 解析重定向，拿到对应的 Wikidata 条目
//   2. 从 Wikidata 取中文（优先简体）和法文标签
// 结果写入 server/data/polity-names.json，历史地图和"历史上的这里"用它显示本地化名称。
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT_DIR } from '../server/config.js';
import { pool } from '../server/db.js';

// 维基媒体要求 User-Agent 里带联系方式，否则更容易被限流
const USER_AGENT = 'Periplus/2.0 (self-hosted personal map; https://github.com/Ayacloud-KEWEN/Periplus-xingji)';
const OUTPUT = path.join(ROOT_DIR, 'server', 'data', 'polity-names.json');
const CHUNK = 50;                  // 两个 API 每次最多 50 个
const REQUEST_INTERVAL_MS = 1000;  // 每秒最多 1 次：间隔 0.2 秒时十几次请求后就会收到 429
const MAX_RETRIES = 5;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(url, attempt = 1) {
    await sleep(REQUEST_INTERVAL_MS);
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    // 被限流或服务器故障：按对方给的 Retry-After（没有就按次数递增）等待后重试
    if ((response.status === 429 || response.status >= 500) && attempt <= MAX_RETRIES) {
        const waitMs = (Number(response.headers.get('retry-after')) || 5 * attempt) * 1000;
        console.log(`\n请求被拒绝（${response.status}），${waitMs / 1000} 秒后重试（第 ${attempt} 次）...`);
        await sleep(waitMs);
        return getJson(url, attempt + 1);
    }
    if (!response.ok) throw new Error(`${response.status} ${url.slice(0, 120)}`);
    return response.json();
}

function chunks(list, size) {
    const result = [];
    for (let i = 0; i < list.length; i += size) result.push(list.slice(i, i + size));
    return result;
}

// 英文维基百科标题 → Wikidata 条目 id（自动跟随标题规范化和重定向）
async function resolveItems(titles) {
    const itemByTitle = new Map();
    for (const batch of chunks(titles, CHUNK)) {
        const params = new URLSearchParams({
            action: 'query', format: 'json', formatversion: '2', redirects: '1',
            prop: 'pageprops', ppprop: 'wikibase_item', titles: batch.join('|')
        });
        const { query } = await getJson(`https://en.wikipedia.org/w/api.php?${params}`);
        const step = new Map();
        for (const { from, to } of [...(query.normalized || []), ...(query.redirects || [])]) step.set(from, to);
        const itemByPage = new Map((query.pages || []).map(page => [page.title, page.pageprops?.wikibase_item]));
        for (const title of batch) {
            let current = title;
            for (let hops = 0; step.has(current) && hops < 3; hops++) current = step.get(current);
            const item = itemByPage.get(current);
            if (item) itemByTitle.set(title, item);
        }
        process.stdout.write(`\r解析维基百科标题：${itemByTitle.size} / ${titles.length}`);
    }
    console.log();
    return itemByTitle;
}

// Wikidata 条目 → { zh, fr }
async function fetchLabels(items) {
    const labels = new Map();
    for (const batch of chunks([...new Set(items)], CHUNK)) {
        const params = new URLSearchParams({
            action: 'wbgetentities', format: 'json', props: 'labels',
            languages: 'zh-hans|zh-cn|zh|fr', ids: batch.join('|')
        });
        const { entities } = await getJson(`https://www.wikidata.org/w/api.php?${params}`);
        for (const [id, entity] of Object.entries(entities || {})) {
            const l = entity.labels || {};
            labels.set(id, {
                zh: (l['zh-hans'] || l['zh-cn'] || l.zh)?.value,
                fr: l.fr?.value
            });
        }
        process.stdout.write(`\r获取名称：${labels.size} / ${new Set(items).size}`);
    }
    console.log();
    return labels;
}

async function main() {
    const { rows } = await pool.query(
        'SELECT DISTINCT wikipedia_url AS title FROM historical_territories WHERE wikipedia_url IS NOT NULL ORDER BY 1'
    );
    const titles = rows.map(row => row.title);
    if (!titles.length) throw new Error('historical_territories 里没有数据，请先运行 npm run import:history');

    const itemByTitle = await resolveItems(titles);
    const labels = await fetchLabels([...itemByTitle.values()]);

    const names = {};
    for (const [title, item] of itemByTitle) {
        const label = labels.get(item);
        if (label?.zh || label?.fr) names[title] = Object.fromEntries(Object.entries(label).filter(([, v]) => v));
    }
    await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
    await fs.writeFile(OUTPUT, JSON.stringify({
        source: 'Wikipedia / Wikidata (CC0), https://www.wikidata.org',
        generatedAt: new Date().toISOString(),
        names
    }));
    const zh = Object.values(names).filter(n => n.zh).length;
    console.log(`完成：${titles.length} 个标题，${Object.keys(names).length} 个找到名称（中文 ${zh} 个）`);
    console.log(`已写入 ${OUTPUT}`);
}

try {
    await main();
} catch (err) {
    console.error('\n生成失败:', err.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
