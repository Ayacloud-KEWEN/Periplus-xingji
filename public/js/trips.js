// 我的旅程：按到访时间把标注自动分成一次次旅行，点开一次旅程在地图上画出路线
import { map, fitOptions } from './map.js';
import { getPins, focusPin } from './pins.js';
import { settings, saveSettings } from './settings.js';
import { t, getLanguage, formatDate, regionName } from './i18n.js';
import { escapeHtml, fragment, panel, toastError } from './ui.js';
import { createRoute } from './route.js';
import { api } from './api.js';

const DAY = 24 * 60 * 60 * 1000;
const GAP_OPTIONS = [1, 3, 7];
const SAME_SPOT_KM = 0.3;      // 相邻两个标注离得很近（同一处拍了好几张照片）就合并成一站
const ROUTE_COLOR = '#c8893b';

let activeRoute = null;
let activeKey = null;
let openedKey = null;          // 面板里正在看的旅程；null 表示列表

// 手动调整：以"每段旅程的第一个标注"为锚点记录，自动分组变了也不会错位。
//   breaks：从这个标注起，强制开始新的一段
//   joins： 这个标注前面的间隔不算分界（和上一段合并）
//   names： 给某一段起的名字
// 存在服务端（/api/settings/trips），换设备也保持一致
let overrides = { breaks: [], joins: [], names: {} };
let overridesLoaded = false;

async function loadOverrides() {
    if (overridesLoaded) return;
    try {
        const saved = await api.getSettings('trips');
        overrides = {
            breaks: Array.isArray(saved.breaks) ? saved.breaks : [],
            joins: Array.isArray(saved.joins) ? saved.joins : [],
            names: saved.names && typeof saved.names === 'object' ? saved.names : {}
        };
    } catch {
        // 读不到就先按自动分组显示，不影响查看
    }
    overridesLoaded = true;
}

// 从备份导入了手动调整后调用：丢掉内存里的旧数据重新读取，否则下次改名会把旧的写回去
export async function reloadTripOverrides() {
    overridesLoaded = false;
    await loadOverrides();
    if (panel.id === 'trips') panel.refresh();
}

async function saveOverrides() {
    try {
        await api.saveSettings('trips', overrides);
    } catch (err) {
        toastError(t('saveFailed'), err);
    }
}

function distanceKm(a, b) {
    const rad = Math.PI / 180;
    const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2
        + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
}

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
// 本地日期的序号，用来算"相隔几天"。按日期而不是按小时：19 日早上到 22 日上午是相隔 3 天，不是 73 小时
const dayNumber = (date) => Math.round(startOfDay(date).getTime() / DAY);

// 地名：优先用市，没有就用省，再没有就用国家
function placeLabel(pin) {
    const place = pin.place;
    if (!place || !place.countryCode) return null;
    return place.city || place.state || regionName(place.countryCode, place.country);
}

function dateRange(start, end) {
    const format = new Intl.DateTimeFormat(getLanguage(), { year: 'numeric', month: 'short', day: 'numeric' });
    try {
        return format.formatRange(start, end);
    } catch {
        return `${formatDate(start)} – ${formatDate(end)}`;
    }
}

function describeTrip(pins) {
    const stops = [];
    for (const pin of pins) {
        const last = stops.at(-1);
        if (last && distanceKm(last, pin) < SAME_SPOT_KM) {
            last.pins.push(pin);
            continue;
        }
        stops.push({ lat: pin.lat, lng: pin.lng, pins: [pin] });
    }
    let km = 0;
    for (let i = 1; i < stops.length; i++) km += distanceKm(stops[i - 1], stops[i]);

    const start = new Date(pins[0].visited_at);
    const end = new Date(pins.at(-1).visited_at);
    // 标题用出现最多的三个地名
    const counts = new Map();
    for (const pin of pins) {
        const label = placeLabel(pin);
        if (label) counts.set(label, (counts.get(label) || 0) + 1);
    }
    return {
        key: String(pins[0].id), // 以第一个标注为锚点：改名、合并都挂在它上面
        name: overrides.names[pins[0].id] || null,
        pins,
        stops,
        start,
        end,
        days: Math.round((startOfDay(end) - startOfDay(start)) / DAY) + 1,
        km: Math.round(km),
        places: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label]) => label),
        cover: pins.find(pin => pin.image_url)?.image_url || null
    };
}

// 按到访时间排序，相邻两个标注的日期相差超过 gapDays 天就开始新的一次旅程；
// 手动拆分（breaks）和手动合并（joins）优先于这个规则。
// 至少要有 2 个不同的地点才算旅程（同一处拍的几张照片不算）
export function buildTrips(pins, gapDays, manual = overrides) {
    const breaks = new Set(manual.breaks);
    const joins = new Set(manual.joins);
    const sorted = pins
        .filter(pin => Number.isFinite(new Date(pin.visited_at).getTime()))
        .sort((a, b) => new Date(a.visited_at) - new Date(b.visited_at) || a.id - b.id);
    const groups = [];
    let current = null;
    for (const pin of sorted) {
        const day = dayNumber(new Date(pin.visited_at));
        const farApart = current && day - current.lastDay > gapDays;
        if (!current || breaks.has(pin.id) || (farApart && !joins.has(pin.id))) {
            current = { pins: [], lastDay: day };
            groups.push(current);
        }
        current.pins.push(pin);
        current.lastDay = day;
    }
    return groups
        .filter(group => group.pins.length >= 2)
        .map(group => describeTrip(group.pins))
        .filter(trip => trip.stops.length >= 2)
        .reverse();
}

export function tripTitle(trip) {
    return trip.name || trip.places.join(' · ') || dateRange(trip.start, trip.end);
}

// ---------- 手动调整 ----------

const unique = (list) => [...new Set(list)];

async function applyChange(change) {
    change();
    await saveOverrides();
    clearTrip();
    panel.refresh();
}

// 和上一段合并：取消这一段开头的分界
function mergeWithPrevious(trip) {
    return applyChange(() => {
        const id = Number(trip.key);
        overrides.breaks = overrides.breaks.filter(pinId => pinId !== id);
        overrides.joins = unique([...overrides.joins, id]);
        delete overrides.names[id]; // 这一段不再单独存在，名字跟着去掉
        openedKey = null;
    });
}

// 从某个站点拆分：这个标注开始算新的一段
function splitAt(pinId) {
    return applyChange(() => {
        overrides.joins = overrides.joins.filter(id => id !== pinId);
        overrides.breaks = unique([...overrides.breaks, pinId]);
        openedKey = String(pinId); // 直接看拆出来的后半段
    });
}

function renameTrip(trip, name) {
    return applyChange(() => {
        const id = Number(trip.key);
        if (name.trim()) overrides.names[id] = name.trim().slice(0, 100);
        else delete overrides.names[id];
    });
}

// 恢复自动分组：去掉与这一段有关的所有手动调整
function resetTrip(trip) {
    return applyChange(() => {
        const ids = new Set(trip.pins.map(pin => pin.id));
        overrides.breaks = overrides.breaks.filter(id => !ids.has(id));
        overrides.joins = overrides.joins.filter(id => !ids.has(id));
        for (const id of ids) delete overrides.names[id];
        openedKey = null;
    });
}

export function clearTrip() {
    activeRoute?.remove();
    activeRoute = null;
    activeKey = null;
}

function showTrip(trip) {
    clearTrip();
    activeRoute = createRoute(trip.stops.map(stop => ({
        lat: stop.lat,
        lng: stop.lng,
        tooltip: () => escapeHtml(stop.pins[0].title),
        onClick: () => focusPin(stop.pins[0].id)
    })), ROUTE_COLOR);
    activeKey = trip.key;
    map.fitBounds(activeRoute.bounds, fitOptions(15));
}

// ---------- 面板 ----------

function renderList(trips) {
    const gap = settings.tripGapDays;
    const totalKm = trips.reduce((sum, trip) => sum + trip.km, 0);
    const gapButtons = GAP_OPTIONS
        .map(days => `<button type="button" data-gap="${days}" class="${days === gap ? 'active' : ''}">${escapeHtml(t('tripGapDays', { days }))}</button>`)
        .join('');
    const items = trips.map(trip => `
        <button class="list-button trip-item ${trip.key === activeKey ? 'active' : ''}" data-key="${escapeHtml(trip.key)}">
            ${trip.cover
                ? `<img class="trip-cover" src="${escapeHtml(trip.cover)}" alt="" loading="lazy">`
                : '<span class="icon"><svg><use href="#i-trips"/></svg></span>'}
            <span class="main">
                <strong>${escapeHtml(tripTitle(trip))}</strong>
                <small>${escapeHtml(dateRange(trip.start, trip.end))}</small>
                <small>${escapeHtml(t('tripStats', { days: trip.days, stops: trip.stops.length, km: trip.km.toLocaleString() }))}</small>
            </span>
        </button>`).join('');

    return fragment(`
        <div class="row"><span>${escapeHtml(t('tripGap'))}</span><div class="segmented" data-segment="gap">${gapButtons}</div></div>
        <p class="muted">${escapeHtml(t('tripsHint', { days: gap }))}</p>
        ${trips.length
            ? `<p><strong>${escapeHtml(t('tripsSummary', { count: trips.length, km: totalKm.toLocaleString() }))}</strong></p>${items}`
            : `<p class="muted">${escapeHtml(t('tripsNone'))}</p>`}
        ${activeKey ? `<div class="actions"><button class="btn" data-act="clear"><svg><use href="#i-x"/></svg>${escapeHtml(t('tripClear'))}</button></div>` : ''}`);
}

function renderTrip(trip, hasPrevious) {
    const stops = trip.stops.map((stop, i) => {
        const pin = stop.pins[0];
        const label = placeLabel(pin);
        const more = stop.pins.length > 1 ? ` <span class="muted">+${stop.pins.length - 1}</span>` : '';
        // 第一站不能"从这里拆分"：拆了等于没拆
        const split = i === 0 ? '' : `<button type="button" class="trip-split" data-split="${pin.id}" title="${escapeHtml(t('tripSplitHere'))}" aria-label="${escapeHtml(t('tripSplitHere'))}"><svg><use href="#i-split"/></svg></button>`;
        return `<div class="trip-stop">
            <button type="button" class="stat-item" data-pin="${pin.id}">
                <span class="trip-stop-num">${i + 1}</span>
                <span class="main"><strong>${escapeHtml(pin.title)}${more}</strong>
                    <small>${escapeHtml(formatDate(pin.visited_at, { withTime: true }))}${label ? ` · ${escapeHtml(label)}` : ''}</small></span>
            </button>${split}
        </div>`;
    }).join('');
    const tripId = Number(trip.key);
    const edited = overrides.names[tripId] !== undefined
        || trip.pins.some(pin => overrides.breaks.includes(pin.id) || overrides.joins.includes(pin.id));

    return fragment(`
        <button type="button" class="link-btn" data-act="back">‹ ${escapeHtml(t('tripBack'))}</button>
        ${trip.cover ? `<img class="pin-photo" src="${escapeHtml(trip.cover)}" alt="">` : ''}
        <div class="pin-meta">
            <span>${escapeHtml(dateRange(trip.start, trip.end))}</span>
            <span>${escapeHtml(t('tripStats', { days: trip.days, stops: trip.stops.length, km: trip.km.toLocaleString() }))}</span>
        </div>
        <label class="field"><span>${escapeHtml(t('tripName'))}</span>
            <input class="input" data-name maxlength="100" value="${escapeHtml(trip.name || '')}" placeholder="${escapeHtml(tripTitle(trip))}"></label>
        <div class="trip-tools">
            <button type="button" class="btn btn-ghost" data-act="merge" ${hasPrevious ? '' : 'disabled'}>${escapeHtml(t('tripMergePrevious'))}</button>
            ${edited ? `<button type="button" class="btn btn-ghost" data-act="reset">${escapeHtml(t('tripResetAuto'))}</button>` : ''}
        </div>
        <p class="muted small">${escapeHtml(t('tripSplitHint'))}</p>
        <div class="stat-list trip-stops">${stops}</div>
        <div class="actions"><button class="btn" data-act="clear"><svg><use href="#i-x"/></svg>${escapeHtml(t('tripClear'))}</button></div>`);
}

function render() {
    const trips = buildTrips(getPins(), settings.tripGapDays);
    const trip = openedKey && trips.find(candidate => candidate.key === openedKey);
    if (!trip) openedKey = null;
    // 列表按时间倒序，所以"上一段"（更早的）在数组里排在后面
    const index = trip ? trips.indexOf(trip) : -1;
    const body = trip ? renderTrip(trip, index >= 0 && index < trips.length - 1) : renderList(trips);

    body.querySelectorAll('[data-gap]').forEach(button => {
        button.addEventListener('click', () => {
            settings.tripGapDays = Number(button.dataset.gap);
            saveSettings();
            clearTrip();
            panel.refresh();
        });
    });
    body.querySelectorAll('.trip-item').forEach(button => {
        button.addEventListener('click', () => {
            const selected = trips.find(candidate => candidate.key === button.dataset.key);
            showTrip(selected);
            openedKey = selected.key;
            panel.refresh();
        });
    });
    body.querySelectorAll('[data-pin]').forEach(button => {
        button.addEventListener('click', () => focusPin(Number(button.dataset.pin)));
    });
    body.querySelector('[data-act="back"]')?.addEventListener('click', () => {
        openedKey = null;
        panel.refresh();
    });
    body.querySelectorAll('[data-split]').forEach(button => {
        button.addEventListener('click', () => splitAt(Number(button.dataset.split)));
    });
    body.querySelector('[data-act="merge"]')?.addEventListener('click', () => mergeWithPrevious(trip));
    body.querySelector('[data-act="reset"]')?.addEventListener('click', () => resetTrip(trip));
    const nameInput = body.querySelector('[data-name]');
    nameInput?.addEventListener('change', () => renameTrip(trip, nameInput.value));
    nameInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') nameInput.blur(); // 回车保存（触发 change）
    });
    body.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
        clearTrip();
        openedKey = null;
        panel.refresh();
    });
    return { title: trip ? tripTitle(trip) : t('trips'), body };
}

export async function openTripsPanel() {
    panel.open('trips', render);
    await loadOverrides(); // 读到手动调整后再刷新一次
    if (panel.id === 'trips') panel.refresh();
}
