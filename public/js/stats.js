// 足迹统计面板：顶部是各级数量，中间是"大洲 → 国家 → 省 → 市 → 县 → 镇"的层级树，最后是世界遗产和 TCC 名单
import { api } from './api.js';
import { map, fitOptions } from './map.js';
import { getPins } from './pins.js';
import { t, lookup, localized, regionName as countryName, getLanguage } from './i18n.js';
import { escapeHtml, fragment, panel, toastError } from './ui.js';

const LEVEL_LABELS = {
    continent: 'statContinents',
    country: 'statCountries',
    state: 'statStates',
    city: 'statCities',
    county: 'statCounties',
    town: 'statTowns'
};
const POLL_MS = 5000;
// 联合国教科文组织官网：遗产编号就是网址的一部分。中文和法文有对应的语言版本，其他语言用英文
const UNESCO_LANGS = { zh: 'zh', fr: 'fr' };
const SHARED_GROUP = '*shared*'; // 跨国遗产的分组代码，不会和真实的国家代码冲突
const unescoUrl = (id) => `https://whc.unesco.org/${UNESCO_LANGS[getLanguage()] || 'en'}/list/${id}/`;
const TCC_URL = '/pages/tcc.html'; // 工具页：330 条三语名单，去过的会高亮；官网链接在那个页面的页脚

let data = null;
let pollTimer = null;
let nodeIndex = new Map();                     // 节点 key → 节点，定位按钮靠它找到对应的标注
const openNodes = new Set();                   // 展开的树节点，刷新时保持
const openSections = new Set(['heritage']); // 展开过的小节和国家分组（都默认收起）

function nodeName(node) {
    if (node.level === 'continent') return lookup('continents', node.code) || node.code;
    if (node.level === 'country') return countryName(node.code, node.name);
    return node.name;
}

// 地图跳到这些标注：一个就直接飞过去，多个就缩放到能全部看到
function showPins(ids) {
    const wanted = new Set(ids); // 用 Set 查找：5 万个标注时，数组 includes 逐个比对要好几秒
    const pins = getPins().filter(pin => wanted.has(pin.id));
    if (pins.length === 1) map.flyTo([pins[0].lat, pins[0].lng], Math.max(map.getZoom(), 14));
    else if (pins.length > 1) map.fitBounds(pins.map(pin => [pin.lat, pin.lng]), fitOptions(14));
}

// 服务端只在路径的最后一个节点上给出标注 id，这里把下级的汇总上来
function pinsOf(node) {
    return [...node.pins, ...node.children.flatMap(pinsOf)];
}

function allKeys(nodes, keys = []) {
    for (const node of nodes) {
        if (node.children.length) {
            keys.push(node.key);
            allKeys(node.children, keys);
        }
    }
    return keys;
}

// ---------- 渲染 ----------

// 收起的节点先不生成下级，展开时再生成（见 render 里的 toggle 处理）。
// 标注很多时树有上万个节点，全部放进页面会让面板打开要好几秒
function treeHtml(nodes, depth) {
    return nodes.map(node => {
        nodeIndex.set(node.key, node);
        const key = escapeHtml(node.key);
        const name = `<span class="tree-name">${escapeHtml(nodeName(node))}</span>`;
        const count = `<span class="stat-count" title="${escapeHtml(t('statPins', { count: node.count }))}">${node.count}</span>`;
        const locate = `<button type="button" class="tree-locate" data-node="${key}" title="${escapeHtml(t('showOnMap'))}"><svg><use href="#i-locate"/></svg></button>`;

        if (!node.children.length) {
            return `<div class="tree-row tree-leaf depth-${depth}" data-node="${key}"><span class="tree-caret"></span>${name}${count}${locate}</div>`;
        }
        // 下一级的数量，比如"3 个省 / 州"
        const childLevel = node.children[0].level;
        const meta = t('treeChildren', { count: node.children.length, label: t(LEVEL_LABELS[childLevel]) });
        const open = openNodes.has(node.key);
        return `<details class="tree-node" data-key="${key}" data-depth="${depth}" ${open ? 'open' : ''}>
            <summary class="tree-row depth-${depth}"><span class="tree-caret"></span>${name}<span class="tree-meta">${escapeHtml(meta)}</span>${count}${locate}</summary>
            <div class="tree-children">${open ? treeHtml(node.children, depth + 1) : ''}</div>
        </details>`;
    }).join('');
}

// 世界遗产按国家分组；跨国的遗产单独归到"多国共有"一组
function heritageGroups(visited) {
    const groups = new Map(); // 国家代码（跨国的用 SHARED） → 遗产
    for (const site of visited) {
        const key = site.countries.length > 1 ? SHARED_GROUP : (site.countries[0] || '');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(site);
    }
    return [...groups.entries()]
        .map(([code, sites]) => ({
            code,
            name: code === SHARED_GROUP ? t('heritageShared') : (countryName(code) || code),
            sites
        }))
        // 多的排前面；"多国共有"放最后
        .sort((a, b) => (a.code === SHARED_GROUP) - (b.code === SHARED_GROUP)
            || b.sites.length - a.sites.length
            || a.name.localeCompare(b.name, getLanguage()));
}

function heritageHtml(heritage) {
    const siteHtml = (site) => {
        const countries = site.countries.map(code => countryName(code)).join('、');
        const sub = [site.year ? t('statInscribed', { year: site.year }) : '', countries].filter(Boolean).join(' · ');
        // 链接放在按钮外面：按钮本身是"在地图上显示"，链接是打开官网的介绍
        return `<div class="stat-row">
            <button type="button" class="stat-item" data-pins="${site.pins.join(',')}">
                <span class="main"><strong>${escapeHtml(localized(site.name) || site.id)}</strong><small>${escapeHtml(sub)}</small></span>
                <span class="stat-count" title="${escapeHtml(t('statPins', { count: site.pins.length }))}">${site.pins.length}</span>
            </button>
            <a class="stat-link" href="${escapeHtml(unescoUrl(site.id))}" target="_blank" rel="noopener"
               title="${escapeHtml(t('heritageInfo'))}" aria-label="${escapeHtml(t('heritageInfo'))}"><svg><use href="#i-external"/></svg></a>
        </div>`;
    };

    const groups = heritageGroups(heritage.visited).map(group => {
        const key = `heritage:${group.code}`;
        return `<details class="stat-group" data-section="${escapeHtml(key)}" ${openSections.has(key) ? 'open' : ''}>
            <summary><span class="tree-caret"></span><span class="main">${escapeHtml(group.name)}</span><span class="stat-count">${group.sites.length}</span></summary>
            <div>${group.sites.map(siteHtml).join('')}</div>
        </details>`;
    }).join('');

    const list = heritage.visited.length ? groups : `<p class="muted">${escapeHtml(t('statNone'))}</p>`;
    return `<details class="stat-section" data-section="heritage" ${openSections.has('heritage') ? 'open' : ''}>
        <summary><span>${escapeHtml(t('statHeritage'))}</span><span class="stat-count">${heritage.visited.length}</span></summary>
        <div class="stat-list">${list}</div>
        <p class="stat-all-link"><a href="/pages/heritage.html" target="_blank" rel="noopener">${escapeHtml(t('heritageAll'))}<svg><use href="#i-external"/></svg></a></p>
    </details>`;
}

// TCC 名单：按名单自己的分区（太平洋、欧洲与地中海……）分组，只列去过的
function tccHtml(tcc) {
    const regionHtml = (region) => `<div class="stat-row">
        <button type="button" class="stat-item" data-pins="${region.pins.join(',')}">
            <span class="main"><strong>${escapeHtml(localized(region.name) || region.code)}</strong></span>
            <span class="stat-count" title="${escapeHtml(t('statPins', { count: region.pins.length }))}">${region.pins.length}</span>
        </button>
    </div>`;

    const groups = tcc.zones.map(zone => {
        const regions = tcc.visited.filter(region => region.zone === zone.code);
        if (!regions.length) return ''; // 没去过的分区不占地方
        const key = `tcc:${zone.code}`;
        return `<details class="stat-group" data-section="${escapeHtml(key)}" ${openSections.has(key) ? 'open' : ''}>
            <summary><span class="tree-caret"></span><span class="main">${escapeHtml(localized(zone.name) || zone.code)}</span>
                <span class="stat-count">${escapeHtml(t('tccZoneCount', { visited: regions.length, total: zone.total }))}</span></summary>
            <div>${regions.map(regionHtml).join('')}</div>
        </details>`;
    }).join('');

    const list = tcc.visited.length ? groups : `<p class="muted">${escapeHtml(t('statNone'))}</p>`;
    // 还没写细分规则的条目会被漏掉，说清楚，免得数字看起来偏小像是出了错
    const pending = tcc.total - tcc.matchable;
    return `<details class="stat-section" data-section="tcc" ${openSections.has('tcc') ? 'open' : ''}>
        <summary><span>${escapeHtml(t('statTcc'))}</span><span class="stat-count">${tcc.visited.length} / ${tcc.total}</span></summary>
        <div class="stat-list">${list}</div>
        ${pending ? `<p class="muted">${escapeHtml(t('tccPending', { count: pending }))}</p>` : ''}
        <p class="stat-all-link"><a href="${escapeHtml(TCC_URL)}" target="_blank" rel="noopener">${escapeHtml(t('tccAll'))}<svg><use href="#i-external"/></svg></a></p>
    </details>`;
}

function noticeHtml({ totals, geocoder }) {
    if (!geocoder.enabled) return `<p class="stat-notice">${escapeHtml(t('statGeocoderOff'))}</p>`;
    if (!totals.pending) return '';
    const done = totals.pins - totals.pending;
    const percent = totals.pins ? Math.round((done / totals.pins) * 100) : 0;
    return `<div class="stat-notice">
        <div>${escapeHtml(t('statGeocoding', { done, total: totals.pins }))}</div>
        <div class="progress"><span style="width:${percent}%"></span></div>
        ${geocoder.lastError ? `<small>${escapeHtml(t('statGeocoderError') + geocoder.lastError)}</small>` : ''}
    </div>`;
}

function render() {
    const { totals, counts, tree, heritage, tcc } = data;
    nodeIndex = new Map();

    // 一排数字方块：方块上用短名称，完整名称和总数放在悬停提示里
    const tile = (key, value, label, suffix = '') => `
        <div class="stat-tile" title="${escapeHtml(`${label} ${value}${suffix}`)}"><strong>${value}</strong><span>${escapeHtml(lookup('tileLabels', key) || label)}</span></div>`;
    const tiles = [
        tile('continent', counts.continent, t('statContinents'), ' / 7'),
        ...['country', 'state', 'city', 'county', 'town'].map(level => tile(level, counts[level], t(LEVEL_LABELS[level]))),
        tile('heritage', heritage.visited.length, t('statHeritage'), ` / ${heritage.total}`),
        tile('tcc', tcc.visited.length, t('statTcc'), ` / ${tcc.total}`)
    ];

    const body = fragment(`
        ${noticeHtml(data)}
        <div class="stat-grid">${tiles.join('')}</div>
        ${totals.unlocated ? `<p class="muted">${escapeHtml(t('statUnlocated', { count: totals.unlocated }))}</p>` : ''}
        <section class="stat-block">
            <div class="stat-block-header">
                <h3 class="section-title">${escapeHtml(t('statFootprint'))}</h3>
                <span><button type="button" class="link-btn" data-act="expand">${escapeHtml(t('expandAll'))}</button>
                    · <button type="button" class="link-btn" data-act="collapse">${escapeHtml(t('collapseAll'))}</button></span>
            </div>
            <div class="tree">${tree.length ? treeHtml(tree, 0) : `<p class="muted">${escapeHtml(t('statNone'))}</p>`}</div>
        </section>
        ${heritageHtml(heritage)}
        ${tccHtml(tcc)}
        <p class="stat-footer">${escapeHtml(t('statSources'))}</p>`);

    // 世界遗产列表：点一项就定位
    body.querySelectorAll('.stat-item[data-pins]').forEach(button => {
        button.addEventListener('click', () => showPins(button.dataset.pins.split(',').map(Number)));
    });

    // 树的事件统一在树上处理，展开时新生成的节点不用再单独绑定
    const treeEl = body.querySelector('.tree');
    treeEl.addEventListener('click', (e) => {
        // 定位按钮在 <summary> 里，要阻止它顺带展开或收起节点；叶子节点点整行就定位
        const target = e.target.closest('[data-node]');
        if (!target) return;
        e.preventDefault();
        e.stopPropagation();
        const node = nodeIndex.get(target.dataset.node);
        if (node) showPins(pinsOf(node));
    });
    // toggle 事件不冒泡，只能在捕获阶段统一监听
    treeEl.addEventListener('toggle', (e) => {
        const details = e.target;
        if (!details.matches?.('details.tree-node')) return;
        const key = details.dataset.key;
        if (!details.open) {
            openNodes.delete(key);
            return;
        }
        openNodes.add(key);
        const container = details.querySelector(':scope > .tree-children');
        if (!container.hasChildNodes()) {
            container.innerHTML = treeHtml(nodeIndex.get(key).children, Number(details.dataset.depth) + 1);
        }
    }, true);
    body.querySelectorAll('details[data-section]').forEach(details => {
        details.addEventListener('toggle', () => {
            if (details.open) openSections.add(details.dataset.section);
            else openSections.delete(details.dataset.section);
        });
    });
    body.querySelector('[data-act="expand"]').addEventListener('click', () => {
        allKeys(tree).forEach(key => openNodes.add(key));
        panel.refresh();
    });
    body.querySelector('[data-act="collapse"]').addEventListener('click', () => {
        openNodes.clear();
        panel.refresh();
    });
    return { title: t('stats'), body };
}

// 后台还在查询行政区时，面板开着就每 5 秒刷新一次进度
function schedulePoll() {
    clearTimeout(pollTimer);
    if (!data.geocoder.enabled || !data.totals.pending || data.geocoder.lastError) return;
    pollTimer = setTimeout(async () => {
        if (panel.id !== 'stats') return;
        try {
            data = await api.stats();
            panel.refresh();
        } catch { /* 下一轮再试 */ }
        schedulePoll();
    }, POLL_MS);
}

export async function openStatsPanel() {
    try {
        data = await api.stats();
    } catch (err) {
        return toastError('', err);
    }
    panel.open('stats', render, { onClose: () => clearTimeout(pollTimer) });
    schedulePoll();
}
