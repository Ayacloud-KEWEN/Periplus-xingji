// 历史疆域图层
import { map } from './map.js';
import { api } from './api.js';
import { t, formatYear, getLanguage } from './i18n.js';
import { escapeHtml, toast, toastError } from './ui.js';
import { openTimebar, closeTimebar, timebarOwner, yearTicks } from './timebar.js';

const ATTRIBUTION = 'Historical data &copy; James Bennett et al., <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>';

let layer = null;
let range = null;
let requestSeq = 0;
let polityNames = null;   // 英文维基百科标题 → { zh, fr }
let namesPromise = null;

// 历史政权的本地化名称，只加载一次（历史地图和"历史上的这里"共用）
export function loadPolityNames() {
    namesPromise ??= api.historyNames()
        .then(names => { polityNames = names || {}; })
        .catch(() => { polityNames = {}; });
    return namesPromise;
}

// Cliopatria 的名称是英文；有中文 / 法文名时用当前语言的
export function polityLabel(name, wiki) {
    const lang = getLanguage();
    return (lang !== 'en' && polityNames?.[wiki]?.[lang]) || name;
}
const yearListeners = new Set();
const closeListeners = new Set();

// 按名称生成固定颜色，同一政权在不同年份颜色一致
function polityColor(name) {
    let hash = 0;
    for (const ch of String(name || '')) hash = (hash * 31 + ch.codePointAt(0)) | 0;
    return `hsl(${Math.abs(hash) % 360}, 65%, 48%)`;
}

function popupHtml({ name, wiki }) {
    const label = polityLabel(name, wiki);
    // 换成本地化名称时，下面附上原来的英文名
    let html = `<h4>${escapeHtml(label)}</h4>${label !== name ? `<p class="muted">${escapeHtml(name)}</p>` : ''}`;
    if (!wiki) return html;
    const english = `https://en.wikipedia.org/wiki/${encodeURIComponent(wiki.replace(/ /g, '_'))}`;
    const lang = getLanguage();
    if (lang === 'en') {
        return html + `<a href="${english}" target="_blank" rel="noopener">${escapeHtml(t('seeWikipedia'))}</a>`;
    }
    const local = `https://${lang}.wikipedia.org/w/index.php?${new URLSearchParams({ search: wiki })}`;
    return html + `<a href="${local}" target="_blank" rel="noopener">${escapeHtml(t('searchInWikipedia', { lang: t('languageName') }))}</a>`
        + ` · <a href="${english}" target="_blank" rel="noopener">${escapeHtml(t('englishWikipedia'))}</a>`;
}

function ensureLayer() {
    if (layer) return;
    // 放在单独的层级里，保证在个人标注和旅行家路线下面
    map.createPane('history');
    map.getPane('history').style.zIndex = 350;
    layer = L.geoJSON(null, {
        pane: 'history',
        renderer: L.canvas({ pane: 'history', padding: 0.5 }), // 上千个多边形用 canvas 比 SVG 流畅得多
        style: (feature) => ({ color: polityColor(feature.properties.name), weight: 1, opacity: 0.8, fillOpacity: 0.18 }),
        onEachFeature: (feature, polygon) => polygon.bindPopup(() => popupHtml(feature.properties))
    });
}

async function showYear(year) {
    yearListeners.forEach(fn => fn(year));
    const seq = ++requestSeq;
    let data;
    try {
        data = await api.history(year);
    } catch (err) {
        if (seq === requestSeq) toastError('', err);
        return;
    }
    // 拖动或播放时可能有多个请求在途，只渲染最后一次请求的结果
    if (seq !== requestSeq || !map.hasLayer(layer)) return;
    layer.clearLayers();
    layer.addData(data);
}

function hideLayer() {
    requestSeq++;
    layer.remove();
    layer.clearLayers();
    map.attributionControl.removeAttribution(ATTRIBUTION);
    closeListeners.forEach(fn => fn());
}

export async function enableHistory({ year } = {}) {
    if (!range) {
        try {
            range = await api.historyRange();
        } catch (err) {
            toastError('', err);
            return false;
        }
    }
    if (!range.count) {
        range = null;
        toast(t('historyUnavailable'), { type: 'error' });
        return false;
    }

    loadPolityNames();
    ensureLayer();
    if (!map.hasLayer(layer)) {
        layer.addTo(map);
        map.attributionControl.addAttribution(ATTRIBUTION);
    }
    const max = Math.min(range.max, new Date().getFullYear());
    openTimebar('history', {
        min: range.min,
        max,
        value: year ?? max,
        step: 1,
        playStep: 10,
        skipZero: true,
        pxPerStep: 3,
        // 刻度上的年份要短：公元前写成"前500"，公元后只写数字（没有公元 0 年，0 的位置写 1）
        ticks: yearTicks(year => (year < 0 ? t('yearBCShort', { year: -year }) : String(year || 1))),
        format: formatYear,
        onChange: showYear,
        onClose: hideLayer
    });
    return true;
}

export function disableHistory() {
    closeTimebar('history');
}

export function isHistoryActive() {
    return timebarOwner() === 'history';
}

export function onHistoryYear(fn) {
    yearListeners.add(fn);
}

export function onHistoryClose(fn) {
    closeListeners.add(fn);
}
