// 壮游面板：历史旅行家路线（data/travelers/）和著名徒步路线（data/trails/）
import { map, fitOptions } from './map.js';
import { t, localized, formatYear } from './i18n.js';
import { escapeHtml, fragment, panel, toast, toastError } from './ui.js';
import { enableHistory, onHistoryYear, onHistoryClose } from './history.js';
import { createRoute } from './route.js';

// 两个目录共用同一套加载和画法；徒步路线没有年份，所以不联动历史时间轴
const SECTIONS = [
    { kind: 'travelers', title: 'journeysTravelers', intro: 'journeysIntro' },
    { kind: 'trails', title: 'journeysTrails', intro: 'trailsIntro' }
];

const cache = new Map();
const indexes = new Map();
const openSections = new Set(['travelers']); // 面板刷新后保留折叠状态
let active = null; // { key, route }

async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return response.json();
}

async function loadRoute(kind, id) {
    const key = `${kind}/${id}`;
    if (!cache.has(key)) cache.set(key, await fetchJson(`data/${kind}/${encodeURIComponent(id)}.json`));
    return cache.get(key);
}

function stopYear(location) {
    const year = Number.parseInt(location.year, 10);
    if (Number.isInteger(year)) return year;
    const fromDate = location.date ? new Date(location.date).getFullYear() : NaN;
    return Number.isNaN(fromDate) ? null : fromDate;
}

function subtitle(data) {
    if (data.stats) return localized(data.stats);
    const { start, end } = data.timePeriod || {};
    return Number.isInteger(start) && Number.isInteger(end) ? `${formatYear(start)} – ${formatYear(end)}` : '';
}

function stopPopup(location, year) {
    const when = year !== null ? `<p><strong>${escapeHtml(t('time'))}:</strong> ${escapeHtml(formatYear(year))}</p>`
        : location.date ? `<p><strong>${escapeHtml(t('time'))}:</strong> ${escapeHtml(location.date)}</p>` : '';
    return `<h4>${escapeHtml(localized(location.name))}</h4>
        ${when}
        ${location.description ? `<p>${escapeHtml(localized(location.description))}</p>` : ''}
        ${location.duration ? `<p><strong>${escapeHtml(t('duration'))}:</strong> ${escapeHtml(localized(location.duration))}</p>` : ''}`;
}

// 只显示在该年份之前到过的站点，以及两端都已到过的路段
// （有的路线年份不是按顺序递增的，比如郑和七次下西洋合并成一条，只看终点会出现"从空中伸出来"的线）
function filterByYear(year) {
    active?.route.show(stop => stop.year === null || stop.year <= year);
}

onHistoryYear(filterByYear);
onHistoryClose(() => filterByYear(Infinity)); // 关闭历史地图后仍显示完整路线

export function clearJourney() {
    if (!active) return;
    active.route.remove();
    active = null;
}

async function showJourney(kind, id) {
    let data;
    try {
        data = await loadRoute(kind, id);
    } catch (err) {
        return toastError(t('loadJourneyFailed'), err);
    }
    clearJourney();

    const stops = data.locations.map(location => {
        const year = stopYear(location);
        return {
            lat: location.lat,
            lng: location.lng,
            year,
            tooltip: () => escapeHtml(localized(location.name)) + (year !== null ? ` · ${escapeHtml(formatYear(year))}` : ''),
            popup: () => stopPopup(location, year)
        };
    });
    const route = createRoute(stops, data.color || '#c8893b');
    active = { key: `${kind}/${id}`, route };
    map.fitBounds(route.bounds, fitOptions());

    const years = stops.map(stop => stop.year).filter(year => year !== null);
    if (years.length) {
        const endYear = Math.max(...years);
        await enableHistory({ year: endYear });
        toast(`${localized(data.traveler)} · ${t('journeyCompletedIn')} ${formatYear(endYear)} · ${localized(data.historicalContext)}`, { duration: 6000 });
    } else {
        toast(`${localized(data.name ?? data.traveler)} · ${subtitle(data)}`, { duration: 5000 });
    }
    if (panel.id === 'journeys') panel.refresh();
}

function renderItem(kind, id, data) {
    return `
        <button class="list-button ${active?.key === `${kind}/${id}` ? 'active' : ''}" data-kind="${kind}" data-id="${escapeHtml(id)}">
            <span class="icon" style="color:${escapeHtml(data.color || '#c8893b')}"><svg><use href="#i-route"/></svg></span>
            <span class="main">
                <strong>${escapeHtml(localized(data.name ?? data.traveler))}</strong>
                <small>${escapeHtml(subtitle(data))}</small>
                <small>${escapeHtml(localized(data.description))}</small>
            </span>
        </button>`;
}

function renderPanel(sections) {
    const html = sections.map(({ kind, title, intro, items }) => `
        <details class="route-section" data-section="${kind}" ${openSections.has(kind) ? 'open' : ''}>
            <summary><span>${escapeHtml(t(title))}</span><span class="badge">${items.length}</span></summary>
            <p class="muted">${escapeHtml(t(intro))}</p>
            ${items.map(({ id, data }) => renderItem(kind, id, data)).join('')}
        </details>`).join('');
    const body = fragment(`
        ${html}
        ${active ? `<div class="actions"><button class="btn" data-act="clear"><svg><use href="#i-x"/></svg>${escapeHtml(t('clearJourney'))}</button></div>` : ''}`);

    body.querySelectorAll('details[data-section]').forEach(details => {
        details.addEventListener('toggle', () => {
            if (details.open) openSections.add(details.dataset.section);
            else openSections.delete(details.dataset.section);
        });
    });
    body.querySelectorAll('[data-id]').forEach(button => {
        button.addEventListener('click', () => showJourney(button.dataset.kind, button.dataset.id));
    });
    body.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
        clearJourney();
        panel.refresh();
    });
    return { title: t('journeys'), body };
}

async function loadSection(section) {
    if (!indexes.has(section.kind)) indexes.set(section.kind, await fetchJson(`data/${section.kind}/index.json`));
    const items = await Promise.all(indexes.get(section.kind).map(async id => ({ id, data: await loadRoute(section.kind, id) })));
    return { ...section, items };
}

export async function openJourneysPanel() {
    let sections;
    try {
        sections = await Promise.all(SECTIONS.map(loadSection));
    } catch (err) {
        return toastError(t('loadJourneyFailed'), err);
    }
    panel.open('journeys', () => renderPanel(sections));
}
