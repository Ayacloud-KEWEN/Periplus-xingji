// "数据统计"三个名录页共用的外壳：三语切换、标签栏、搜索和筛选、概览条。
// 每个页面只负责自己的数据和条目怎么画，其余都在这里。

export const LANGS = ['zh', 'en', 'fr'];

// 三个页面之间切换用的标签
const TABS = [
    { id: 'countries', href: 'countries.html', label: { zh: '国家和地区', en: 'Countries', fr: 'Pays' } },
    { id: 'tcc', href: 'tcc.html', label: { zh: 'TCC 名单', en: 'TCC List', fr: 'Liste TCC' } },
    { id: 'heritage', href: 'heritage.html', label: { zh: '世界遗产', en: 'World Heritage', fr: 'Patrimoine mondial' } }
];

export const SHELL = {
    title: { zh: '数据统计', en: 'Travel Stats', fr: 'Statistiques' },
    back: { zh: '‹ 返回地图', en: '‹ Back to map', fr: '‹ Retour à la carte' },
    all: { zh: '全部', en: 'All', fr: 'Tous' },
    visited: { zh: '已去过', en: 'Visited', fr: 'Visités' },
    todo: { zh: '还没去', en: 'Not yet', fr: 'Pas encore' },
    pins: { zh: '{count} 个标注', en: '{count} pins', fr: '{count} points' },
    pinsOne: { zh: '{count} 个标注', en: '{count} pin', fr: '{count} point' },
    since: { zh: '{year} 年起', en: 'since {year}', fr: 'depuis {year}' },
    noMatch: { zh: '没有符合条件的条目', en: 'Nothing matches', fr: 'Aucun résultat' },
    loading: { zh: '正在读取…', en: 'Loading…', fr: 'Chargement…' },
    loadError: {
        zh: '读不到数据，请确认地图服务正在运行。',
        en: 'Could not load the data — check that the map server is running.',
        fr: "Impossible de charger les données — vérifiez que le serveur est démarré."
    }
};

export const fill = (text, params = {}) =>
    String(text).replace(/\{(\w+)\}/g, (match, key) => (key in params ? params[key] : match));

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

// 三个页面和工具箱共用同一个语言设置
export function pickLang() {
    const saved = localStorage.getItem('preferredLanguage');
    if (LANGS.includes(saved)) return saved;
    const browser = (navigator.language || 'en').split('-')[0];
    return LANGS.includes(browser) ? browser : 'en';
}

// 多语言名称对象 → 当前语言的名称；缺失时按英、法、中依次退回
export const localized = (names, lang) =>
    names?.[lang] || names?.en || names?.fr || names?.zh || '';

// 当前语言之外的另外两种写法，用来显示在副标题里；和主名称重复的去掉
export function otherNames(names, lang) {
    const primary = localized(names, lang);
    return LANGS.filter(code => code !== lang)
        .map(code => names?.[code])
        .filter(name => name && name !== primary);
}

// "3 个标注 · 2019 年起"
export function pinsMeta(hit, lang) {
    if (!hit) return '';
    const count = hit.pins.length;
    return [
        fill(SHELL[count === 1 ? 'pinsOne' : 'pins'][lang], { count }),
        hit.firstVisit ? fill(SHELL.since[lang], { year: new Date(hit.firstVisit).getFullYear() }) : ''
    ].filter(Boolean).join(' · ');
}

// 页面骨架：标题、返回、语言、标签栏、概览、筛选、列表、页脚
export function buildShell(activeTab) {
    document.body.innerHTML = `
        <div class="container">
            <header>
                <h1 id="page-title"></h1>
                <div class="header-actions">
                    <a class="back-link" id="back-link" href="/"></a>
                    <select id="language-selector" aria-label="Language">
                        <option value="zh">简体中文</option>
                        <option value="en">English</option>
                        <option value="fr">Français</option>
                    </select>
                </div>
            </header>
            <nav class="tabs" id="tabs"></nav>
            <section class="summary">
                <div class="score"><strong id="score-value">–</strong><span id="score-label"></span></div>
                <div class="bar"><i id="bar-fill" style="width:0"></i><b id="bar-goal" hidden></b></div>
                <p id="summary-note"></p>
            </section>
            <div class="filters">
                <input id="search" type="search" autocomplete="off">
                <div class="chips">
                    <button type="button" class="chip" data-filter="all" aria-pressed="true"></button>
                    <button type="button" class="chip" data-filter="visited" aria-pressed="false"></button>
                    <button type="button" class="chip" data-filter="todo" aria-pressed="false"></button>
                </div>
            </div>
            <main id="list"></main>
            <footer id="footer"></footer>
        </div>`;
    document.body.dataset.tab = activeTab;
}

// 标签栏上的 "19 / 330"：数据到了才显示
export function renderTabs(activeTab, lang, scores = {}) {
    document.getElementById('tabs').innerHTML = TABS.map(tab => {
        const score = scores[tab.id];
        return `<a href="${tab.href}" ${tab.id === activeTab ? 'aria-current="page"' : ''}>
            ${escapeHtml(tab.label[lang])}${score ? `<small>${escapeHtml(score)}</small>` : ''}
        </a>`;
    }).join('');
}

// 顶部概览：大数字、进度条、说明。goal 是进度条上的参考线（比如 TCC 的 100）
export function renderSummary({ done, total, label, note, goal }) {
    document.getElementById('score-value').textContent = done;
    document.getElementById('score-label').textContent = label;
    document.getElementById('bar-fill').style.width = total ? `${Math.min(100, (done / total) * 100)}%` : '0';
    const marker = document.getElementById('bar-goal');
    marker.hidden = !goal || goal >= total;
    if (!marker.hidden) marker.style.left = `${(goal / total) * 100}%`;
    document.getElementById('summary-note').textContent = note || '';
}

// 一个分组（大洲 / TCC 分区 / 国家）
export function zoneHtml({ title, subtitle, done, total, body }) {
    return `<section class="zone">
        <div class="zone-head">
            <h2>${escapeHtml(title)}</h2>
            ${subtitle ? `<em>${escapeHtml(subtitle)}</em>` : ''}
            <span class="zone-score"><b>${done}</b> / ${total}</span>
        </div>
        <div class="grid${body.wide ? ' wide' : ''}">${body.html}</div>
    </section>`;
}

// 把语言切换、搜索、筛选按钮接起来；状态变化时调用 onChange
export function wireControls(state, onChange) {
    const selector = document.getElementById('language-selector');
    selector.value = state.lang;
    selector.addEventListener('change', (event) => {
        state.lang = event.target.value;
        localStorage.setItem('preferredLanguage', state.lang);
        onChange();
    });
    document.getElementById('search').addEventListener('input', (event) => {
        state.keyword = event.target.value.trim().toLowerCase();
        onChange();
    });
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            state.filter = chip.dataset.filter;
            onChange();
        });
    });
}

// 每次重画都要更新的固定文案
export function renderChrome(state, pageTitle, searchPlaceholder) {
    document.documentElement.lang = state.lang;
    document.title = `${SHELL.title[state.lang]} · ${pageTitle[state.lang]}`;
    document.getElementById('page-title').textContent = SHELL.title[state.lang];
    document.getElementById('back-link').textContent = SHELL.back[state.lang];
    document.getElementById('search').placeholder = searchPlaceholder[state.lang];
    document.querySelectorAll('.chip').forEach(chip => {
        chip.textContent = SHELL[chip.dataset.filter === 'all' ? 'all' : chip.dataset.filter][state.lang];
        chip.setAttribute('aria-pressed', String(chip.dataset.filter === state.filter));
    });
}

// 筛选条件：已去过 / 还没去 + 关键词（比对给出的所有名称，所以中文界面下也能用英文名搜）
export function makeFilter(state, isVisited, namesOf) {
    return (entry) => {
        if (state.filter === 'visited' && !isVisited(entry)) return false;
        if (state.filter === 'todo' && isVisited(entry)) return false;
        if (!state.keyword) return true;
        return namesOf(entry).some(name => String(name).toLowerCase().includes(state.keyword));
    };
}
