// GPX 轨迹：导入、在地图上画线（普通 / 热力 / 配速三种画法）、详情、个人纪录、重复路线
import { map, fitOptions } from './map.js';
import { api } from './api.js';
import { getPins, focusPin } from './pins.js';
import { t, formatDate, getLanguage } from './i18n.js';
import { escapeHtml, fragment, panel, toast, toastError, confirmDialog } from './ui.js';
import { parseGpx } from './gpx.js';

// 每种运动一个颜色，和应用的暖色调保持一致
const SPORT_COLORS = {
    running: '#c8893b',
    hiking: '#3f7d5a',
    walking: '#8a6bb1',
    cycling: '#3b6fa8',
    swimming: '#2a9d9f',
    other: '#7a6a5c'
};

// 配速色带：从慢到快五档
const PACE_COLORS = ['#b8503a', '#d98032', '#e0b13a', '#7fa84a', '#2f7d4f'];
const HEAT_COLOR = '#c8893b';
const PHOTO_WINDOW_MS = 30 * 60 * 1000; // 轨迹前后半小时内拍的照片也算这次活动的
const PHOTO_NEAR_KM = 0.25;             // 时间对不上时，离轨迹这么近也算

let active = false;
let layer = null;
let renderer = null;   // 只建一个 canvas 反复用，和点亮地图一样
let tracks = [];
let selectedId = null;
let openedId = null;   // 面板里正在看的轨迹；null 表示列表
let mode = 'normal';   // normal | heat | pace
let dateFilter = null; // 个人时间轴：只显示这个时间之前开始的轨迹

const sportLabel = (sport) => t(`sport_${sport}`);
const trackOf = (id) => tracks.find(track => track.id === id);
const colorOf = (track) => SPORT_COLORS[track.sport] || SPORT_COLORS.other;

export function isTracksActive() {
    return active;
}

const visible = (track) => dateFilter === null || new Date(track.started_at).getTime() <= dateFilter;

// 个人时间轴用：保证轨迹已经读过，好把轨迹的日期也算进时间轴的范围
export async function ensureTracks() {
    if (!tracks.length) await loadTracks().catch(() => { /* 读不到就只按标注算范围 */ });
    return tracks;
}

export function trackTimes() {
    return tracks.map(track => new Date(track.started_at).getTime()).filter(Number.isFinite);
}

// 个人时间轴拖动时调用：轨迹跟着标注一起按时间过滤
export function setTracksDateFilter(timestamp) {
    if (dateFilter === timestamp) return;
    dateFilter = timestamp;
    if (active) drawLayer();
    if (panel.id === 'tracks') panel.refresh();
}

function notify() {
    document.dispatchEvent(new CustomEvent('trackschange'));
}

// ---------- 数值格式 ----------

function formatDistance(meters) {
    return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}

function durationOf(track) {
    if (!track.ended_at) return null;
    return (new Date(track.ended_at) - new Date(track.started_at)) / 1000;
}

const mmss = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

// 跑步、徒步看配速（每公里几分几秒），骑行看时速，游泳看每 100 米几分几秒
function formatPace(track) {
    const seconds = durationOf(track);
    if (!seconds || track.distance_m < 100) return null;
    if (track.sport === 'cycling') return `${(track.distance_m / 1000 / (seconds / 3600)).toFixed(1)} km/h`;
    if (track.sport === 'swimming') return `${mmss(seconds / (track.distance_m / 100))} /100m`;
    return `${mmss(seconds / (track.distance_m / 1000))} /km`;
}

// 比较快慢用的统一指标：每公里多少秒（越小越快）
function secondsPerKm(track) {
    const seconds = durationOf(track);
    if (!seconds || track.distance_m < 500) return null;
    return seconds / (track.distance_m / 1000);
}

function trackMeta(track) {
    return [
        formatDistance(track.distance_m),
        formatDuration(durationOf(track)),
        formatPace(track),
        track.ascent_m ? `↑ ${Math.round(track.ascent_m)} m` : null
    ].filter(Boolean).join(' · ');
}

function distanceKm(a, b) {
    const rad = Math.PI / 180;
    const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2
        + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
}

// 简化之后，只有一段的轨迹会变成 LineString，多段的才是 MultiLineString，
// 这里统一成"段的数组"，免得下面每处都判断一次
function segmentsOf(track) {
    const geometry = track.geometry;
    if (!geometry?.coordinates?.length) return [];
    return geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
}

// 轨迹的第一个点和最后一个点（[经度, 纬度]）
function endpoints(track) {
    const segments = segmentsOf(track);
    if (!segments.length) return null;
    return { start: segments[0][0], end: segments.at(-1).at(-1) };
}

// ---------- 地图图层 ----------

// 配速色带：用这条轨迹自己的速度分布分档，快慢不同的运动之间互不影响
function paceScale(profile) {
    const speeds = profile.flat().map(point => point[2]).filter(speed => speed > 0).sort((a, b) => a - b);
    if (speeds.length < 4) return null;
    const at = (ratio) => speeds[Math.min(speeds.length - 1, Math.floor(speeds.length * ratio))];
    const low = at(0.1);
    const high = at(0.9);
    if (!(high > low)) return null;
    return (speed) => {
        const ratio = (speed - low) / (high - low);
        const index = Math.round(ratio * (PACE_COLORS.length - 1));
        return PACE_COLORS[Math.max(0, Math.min(PACE_COLORS.length - 1, index))];
    };
}

function paceLayers(track) {
    const scale = paceScale(track.pace_profile);
    if (!scale) return [];
    const lines = [];
    for (const segment of track.pace_profile) {
        for (let i = 1; i < segment.length; i++) {
            const [lng, lat, speed] = segment[i];
            const previous = segment[i - 1];
            lines.push(L.polyline([[previous[1], previous[0]], [lat, lng]], {
                pane: 'tracks', renderer, color: scale(speed), weight: 4, opacity: 0.95
            }));
        }
    }
    return lines;
}

function drawLayer() {
    layer?.remove();
    if (!map.getPane('tracks')) {
        map.createPane('tracks');
        map.getPane('tracks').style.zIndex = 370; // 在点亮地图（360）之上、标注之下
    }
    renderer ??= L.canvas({ pane: 'tracks', padding: 0.5 });

    // 看某一条的详情时只画这一条，否则在常走的路线上和别的轨迹叠在一起分不出来；回到列表再显示全部
    const shown = openedId
        ? tracks.filter(track => track.id === openedId && track.geometry)
        : tracks.filter(track => track.geometry && visible(track));
    const parts = [];
    for (const track of shown) {
        // 配速模式：有速度数据的画成色带；没有的（早先导入的，或 GPX 里没有时间）仍画单色
        if (mode === 'pace' && track.pace_profile) {
            parts.push(...paceLayers(track));
            continue;
        }
        const selected = track.id === selectedId;
        const style = mode === 'heat'
            // 热力：所有轨迹同色半透明，重叠处自然更深，常走的路线一眼看出来
            ? { color: HEAT_COLOR, weight: 5, opacity: 0.18 }
            : { color: colorOf(track), weight: selected ? 5 : 3, opacity: selected ? 1 : 0.85 };
        const line = L.geoJSON(track.geometry, { pane: 'tracks', renderer, style: () => style });
        line.bindTooltip(`${escapeHtml(track.name || sportLabel(track.sport))} · ${escapeHtml(trackMeta(track))}`, { sticky: true });
        line.on('click', (e) => {
            L.DomEvent.stopPropagation(e); // 别让地图的点击事件把它当成"添加标注"
            openTrack(track.id);
        });
        parts.push(line);
    }
    layer = L.layerGroup(parts).addTo(map);
}

function boundsOf(track) {
    return L.geoJSON(track.geometry).getBounds();
}

function openTrack(id) {
    selectedId = id;
    openedId = id;
    drawLayer();
    const track = trackOf(id);
    if (track?.geometry) map.fitBounds(boundsOf(track), fitOptions(16));
    panel.open('tracks', render);
}

// ---------- 导入 ----------

export async function importTracks(files) {
    const list = [...files];
    if (!list.length) return;
    const status = toast('', { duration: 0 });
    let added = 0;
    let skipped = 0;
    let updated = 0; // 已经有这条轨迹，但这次补上了配速数据

    for (const [index, file] of list.entries()) {
        status.update(t('importingTrack', { current: index + 1, total: list.length, name: file.name }));
        try {
            const parsed = parseGpx(await file.text(), file.name);
            const result = await api.createTrack({
                name: parsed.name,
                sport: parsed.sport,
                // 少数工具导出的 GPX 没有时间戳，用文件的修改时间兜底
                started_at: parsed.startedAt || new Date(file.lastModified).toISOString(),
                ended_at: parsed.endedAt,
                distance_m: parsed.distance,
                ascent_m: parsed.ascent,
                segments: parsed.segments,
                pace_profile: parsed.paceProfile
            });
            if (result.duplicate) skipped++;
            else if (result.updated) updated++;
            else added++;
        } catch (err) {
            toastError(`${file.name}: `, err);
        }
    }
    status.close();

    const summary = [
        added ? t('tracksImported', { count: added }) : '',
        updated ? t('tracksPaceAdded', { count: updated }) : '',
        skipped ? t('tracksSkipped', { count: skipped }) : ''
    ].filter(Boolean).join(' · ');
    if (summary) toast(summary, { duration: 5000 });

    if (added || updated) {
        await loadTracks();
        active = true;
        openedId = null;
        drawLayer();
        notify();
        const bounds = layer?.getBounds?.();
        if (bounds?.isValid()) map.fitBounds(bounds, fitOptions(16));
        panel.open('tracks', render);
    }
}

async function loadTracks() {
    tracks = await api.tracks();
}

// 从备份导入轨迹后调用：图层开着就重画，面板开着就刷新
export async function reloadTracks() {
    if (!active && panel.id !== 'tracks') return;
    await loadTracks();
    if (active) drawLayer();
    if (panel.id === 'tracks') panel.refresh();
}

async function deleteTrack(track) {
    if (!(await confirmDialog(t('confirmDeleteTrack', { name: track.name || sportLabel(track.sport) })))) return;
    try {
        await api.deleteTrack(track.id);
        tracks = tracks.filter(item => item.id !== track.id);
        if (selectedId === track.id) selectedId = null;
        if (openedId === track.id) openedId = null;
        drawLayer();
        panel.refresh();
        toast(t('deleted'));
    } catch (err) {
        toastError(t('deleteFailed'), err);
    }
}

// ---------- 每年里程 ----------

// 每年一根横条，长度按当年里程占最多的那年的比例；条上按运动类型分段
function yearlyChart(byYear) {
    const years = [...byYear.entries()]
        .map(([year, list]) => ({
            year,
            km: list.reduce((sum, track) => sum + track.distance_m, 0) / 1000,
            bySport: [...list.reduce((sports, track) => sports.set(track.sport, (sports.get(track.sport) || 0) + track.distance_m), new Map())]
                .sort((a, b) => b[1] - a[1])
        }))
        .sort((a, b) => b.year - a.year);
    const max = Math.max(...years.map(entry => entry.km), 0);
    if (!max) return '';

    const rows = years.map(entry => {
        const segments = entry.bySport.map(([sport, meters]) => {
            const width = (meters / 1000) / max * 100;
            return `<i style="width:${width.toFixed(1)}%;background:${SPORT_COLORS[sport] || SPORT_COLORS.other}" title="${escapeHtml(`${sportLabel(sport)} ${(meters / 1000).toFixed(1)} km`)}"></i>`;
        }).join('');
        return `<div class="year-row">
            <span class="year-label">${entry.year}</span>
            <span class="year-bar">${segments}</span>
            <span class="year-km">${escapeHtml(entry.km.toFixed(0))} km</span>
        </div>`;
    }).join('');

    return `<details class="stat-group" open><summary><span class="tree-caret"></span><span class="main">${escapeHtml(t('tracksYearly'))}</span>
        <span class="stat-count">${escapeHtml(years.reduce((sum, entry) => sum + entry.km, 0).toFixed(0))} km</span></summary>
        <div class="year-chart">${rows}</div></details>`;
}

// ---------- 个人纪录 ----------

function records(list) {
    if (!list.length) return [];
    const rows = [];
    const best = (label, pick, format) => {
        let winner = null;
        for (const track of list) {
            const value = pick(track);
            if (!Number.isFinite(value)) continue;
            if (!winner || value > pick(winner)) winner = track;
        }
        if (winner) rows.push({ label, value: format(pick(winner)), track: winner });
    };

    best(t('recordLongest'), track => track.distance_m, value => formatDistance(value));
    best(t('recordDuration'), track => durationOf(track), value => formatDuration(value));
    best(t('recordAscent'), track => track.ascent_m || 0, value => `${Math.round(value)} m`);

    // 最快配速按运动分开：跑步和骑行没法比
    for (const sport of [...new Set(list.map(track => track.sport))]) {
        const fastest = list.filter(track => track.sport === sport && secondsPerKm(track) !== null)
            .sort((a, b) => secondsPerKm(a) - secondsPerKm(b))[0];
        if (fastest) rows.push({ label: t('recordFastest', { sport: sportLabel(sport) }), value: formatPace(fastest), track: fastest });
    }

    // 里程最多的一个月
    const months = new Map();
    for (const track of list) {
        const date = new Date(track.started_at);
        months.set(`${date.getFullYear()}-${date.getMonth()}`, (months.get(`${date.getFullYear()}-${date.getMonth()}`) || 0) + track.distance_m);
    }
    const top = [...months.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
        const [year, month] = top[0].split('-').map(Number);
        const name = new Intl.DateTimeFormat(getLanguage(), { year: 'numeric', month: 'long' }).format(new Date(year, month, 1));
        rows.push({ label: t('recordMonth'), value: `${name} · ${formatDistance(top[1])}` });
    }

    // 连续活动天数：按本地日期去重后数最长的一串（26 小时的余量是为了避开夏令时）
    const days = [...new Set(list.map(track => {
        const date = new Date(track.started_at);
        return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    }))].sort((a, b) => a - b);
    if (days.length) {
        let streak = 1;
        let longest = 1;
        for (let i = 1; i < days.length; i++) {
            streak = days[i] - days[i - 1] <= 26 * 3600 * 1000 ? streak + 1 : 1;
            longest = Math.max(longest, streak);
        }
        rows.push({ label: t('recordStreak'), value: t('recordStreakDays', { days: longest }) });
    }
    return rows;
}

function recordsHtml(list) {
    const rows = records(list);
    if (!rows.length) return '';
    const items = rows.map(row => (row.track
        ? `<button type="button" class="review-line record-line" data-open="${row.track.id}"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></button>`
        : `<div class="review-line"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></div>`)).join('');
    return `<details class="stat-group"><summary><span class="tree-caret"></span><span class="main">${escapeHtml(t('tracksRecords'))}</span>
        <span class="stat-count">${rows.length}</span></summary><div>${items}</div></details>`;
}

// ---------- 重复路线 ----------

// 同一种运动、起终点都在 300 米内、距离相差 10% 以内，算同一条路线
function repeatGroups(list) {
    const groups = [];
    for (const track of list) {
        const ends = endpoints(track);
        if (!ends || !track.distance_m) continue;
        const group = groups.find(candidate => candidate.sport === track.sport
            && Math.abs(candidate.distance - track.distance_m) / candidate.distance < 0.1
            && distanceKm(candidate.start, ends.start) < 0.3
            && distanceKm(candidate.end, ends.end) < 0.3);
        if (group) group.tracks.push(track);
        else groups.push({ sport: track.sport, distance: track.distance_m, start: ends.start, end: ends.end, tracks: [track] });
    }
    return groups.filter(group => group.tracks.length >= 2).sort((a, b) => b.tracks.length - a.tracks.length);
}

function repeatsHtml(list) {
    const groups = repeatGroups(list);
    if (!groups.length) return '';
    const items = groups.map(group => {
        const sorted = [...group.tracks].sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
        const best = group.tracks.filter(track => secondsPerKm(track) !== null)
            .sort((a, b) => secondsPerKm(a) - secondsPerKm(b))[0];
        const rows = sorted.map(track => {
            const perKm = secondsPerKm(track);
            let delta = '';
            if (best && track.id === best.id) delta = '★';
            else if (best && perKm !== null) delta = `+${mmss(perKm - secondsPerKm(best))}`;
            return `<button type="button" class="stat-item" data-open="${track.id}">
                <span class="main"><strong>${escapeHtml(formatDate(track.started_at))}</strong>
                    <small>${escapeHtml([formatDuration(durationOf(track)), formatPace(track)].filter(Boolean).join(' · '))}</small></span>
                <span class="stat-count ${track.id === best?.id ? 'best' : ''}">${escapeHtml(delta)}</span>
            </button>`;
        }).join('');
        const name = group.tracks.map(track => track.name).find(Boolean) || sportLabel(group.sport);
        return `<details class="stat-group"><summary><span class="tree-caret"></span>
            <span class="main">${escapeHtml(name)} · ${escapeHtml(formatDistance(group.distance))}</span>
            <span class="stat-count">${group.tracks.length}</span></summary><div>${rows}</div></details>`;
    }).join('');
    return `<details class="stat-group"><summary><span class="tree-caret"></span><span class="main">${escapeHtml(t('tracksRepeats'))}</span>
        <span class="stat-count">${groups.length}</span></summary><div class="repeat-groups">${items}</div></details>`;
}

// ---------- 轨迹沿线的照片 ----------

// 先按时间找：拍摄时间落在这次活动期间（前后放宽半小时）的标注；
// 一张都没有时，再按位置找离轨迹很近的标注
function photosAlong(track) {
    const pins = getPins().filter(pin => pin.photos?.length);
    const start = new Date(track.started_at).getTime() - PHOTO_WINDOW_MS;
    const end = (track.ended_at ? new Date(track.ended_at).getTime() : new Date(track.started_at).getTime()) + PHOTO_WINDOW_MS;
    const byTime = pins.filter(pin => {
        const time = new Date(pin.visited_at).getTime();
        return time >= start && time <= end;
    });
    if (byTime.length) return byTime;

    const points = segmentsOf(track).flat();
    if (!points.length) return [];
    return pins.filter(pin => points.some(point => distanceKm(point, [pin.lng, pin.lat]) < PHOTO_NEAR_KM));
}

// ---------- 面板 ----------

function renderDetail(track) {
    const photos = photosAlong(track);
    const photoHtml = photos.map(pin => `
        <button type="button" class="track-photo" data-pin="${pin.id}" title="${escapeHtml(pin.title)}">
            <img src="${escapeHtml(pin.photos[0].url)}" alt="" loading="lazy">
        </button>`).join('');
    const paceLegend = track.pace_profile
        ? `<div class="legend pace-legend"><span>${escapeHtml(t('paceSlow'))}</span>
            ${PACE_COLORS.map(color => `<i style="background:${color}"></i>`).join('')}
            <span>${escapeHtml(t('paceFast'))}</span></div>
            <p class="muted small">${escapeHtml(t('paceHint'))}</p>`
        : `<p class="muted small">${escapeHtml(t('paceMissing'))}</p>`;

    const line = (label, value) => `<div class="review-line"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
    const body = fragment(`
        <button type="button" class="link-btn" data-act="back">‹ ${escapeHtml(t('tripBack'))}</button>
        <div class="pin-meta">
            <span class="cat-chip" style="--cat:${colorOf(track)}">${escapeHtml(sportLabel(track.sport))}</span>
            <span>${escapeHtml(formatDate(track.started_at, { withTime: true }))}</span>
        </div>
        ${line(t('tracksDistance'), formatDistance(track.distance_m))}
        ${line(t('tracksDuration'), formatDuration(durationOf(track)) || '—')}
        ${line(t('tracksPace'), formatPace(track) || '—')}
        ${line(t('tracksAscent'), track.ascent_m ? `${Math.round(track.ascent_m)} m` : '—')}
        <h3 class="section-title">${escapeHtml(t('tracksPaceBand'))}</h3>
        ${paceLegend}
        <h3 class="section-title">${escapeHtml(t('tracksPhotos'))}</h3>
        ${photos.length ? `<div class="track-photos">${photoHtml}</div>` : `<p class="muted small">${escapeHtml(t('tracksNoPhotos'))}</p>`}
        <div class="actions">
            <button type="button" class="btn btn-ghost" data-act="delete"><svg><use href="#i-trash"/></svg>${escapeHtml(t('delete'))}</button>
            <span class="spacer"></span>
            <button type="button" class="btn" data-act="zoom"><svg><use href="#i-locate"/></svg>${escapeHtml(t('showOnMap'))}</button>
        </div>`);

    body.querySelector('[data-act="back"]').addEventListener('click', () => {
        openedId = null;
        drawLayer();
        panel.refresh();
    });
    body.querySelector('[data-act="zoom"]').addEventListener('click', () => {
        if (!track.geometry) return;
        // 手机上面板是底部抽屉，占了大半屏幕，轨迹会被挡住；打开详情时也已经缩放过一次，
        // 不收起面板的话点了看起来没反应。所以先关掉面板，再按整个屏幕缩放
        if (window.innerWidth <= 640) panel.close();
        map.fitBounds(boundsOf(track), fitOptions(16));
    });
    body.querySelector('[data-act="delete"]').addEventListener('click', () => deleteTrack(track));
    body.querySelectorAll('[data-pin]').forEach(button => {
        button.addEventListener('click', () => focusPin(Number(button.dataset.pin)));
    });
    return { title: track.name || sportLabel(track.sport), body };
}

function renderList() {
    const shown = tracks.filter(visible);
    const totalDistance = shown.reduce((sum, track) => sum + track.distance_m, 0);
    const byYear = new Map();
    for (const track of shown) {
        const year = new Date(track.started_at).getFullYear();
        if (!byYear.has(year)) byYear.set(year, []);
        byYear.get(year).push(track);
    }

    const groups = [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, list]) => {
        const items = list.map(track => `
            <div class="track-item ${track.id === selectedId ? 'selected' : ''}" data-id="${track.id}">
                <span class="track-dot" style="background:${colorOf(track)}"></span>
                <button type="button" class="track-main" data-open="${track.id}">
                    <strong>${escapeHtml(track.name || sportLabel(track.sport))}</strong>
                    <small>${escapeHtml(formatDate(track.started_at))} · ${escapeHtml(trackMeta(track))}</small>
                </button>
                <button type="button" class="track-delete" data-delete="${track.id}" title="${escapeHtml(t('delete'))}" aria-label="${escapeHtml(t('delete'))}"><svg><use href="#i-trash"/></svg></button>
            </div>`).join('');
        const distance = list.reduce((sum, track) => sum + track.distance_m, 0);
        return `<details class="stat-group" open>
            <summary><span class="tree-caret"></span><span class="main">${year}</span><span class="stat-count">${escapeHtml(formatDistance(distance))}</span></summary>
            <div>${items}</div>
        </details>`;
    }).join('');

    const legend = Object.entries(SPORT_COLORS)
        .filter(([sport]) => shown.some(track => track.sport === sport))
        .map(([sport, color]) => `<span><i style="background:${color}"></i>${escapeHtml(sportLabel(sport))}</span>`).join('');
    const modes = [['normal', 'tracksModeNormal'], ['heat', 'tracksModeHeat'], ['pace', 'tracksModePace']]
        .map(([value, key]) => `<button type="button" data-mode="${value}" class="${mode === value ? 'active' : ''}">${escapeHtml(t(key))}</button>`)
        .join('');

    const body = fragment(`
        <div class="segmented" data-segment="mode">${modes}</div>
        <p><strong>${escapeHtml(t('tracksSummary', { count: shown.length, km: (totalDistance / 1000).toFixed(1) }))}</strong></p>
        ${dateFilter !== null ? `<p class="muted small">${escapeHtml(t('tracksFiltered'))}</p>` : ''}
        ${mode === 'heat' ? `<p class="muted small">${escapeHtml(t('tracksHeatHint'))}</p>` : ''}
        ${mode === 'pace' ? `<div class="legend pace-legend"><span>${escapeHtml(t('paceSlow'))}</span>${PACE_COLORS.map(color => `<i style="background:${color}"></i>`).join('')}<span>${escapeHtml(t('paceFast'))}</span></div>` : ''}
        ${legend && mode === 'normal' ? `<div class="legend">${legend}</div>` : ''}
        ${yearlyChart(byYear)}
        ${recordsHtml(shown)}
        ${repeatsHtml(shown)}
        ${shown.length ? groups : `<p class="muted">${escapeHtml(t('tracksNone'))}</p>`}
        <div class="actions">
            <button type="button" class="btn btn-ghost" data-act="off">${escapeHtml(t('tracksOff'))}</button>
            <span class="spacer"></span>
            <button type="button" class="btn btn-primary" data-act="import"><svg><use href="#i-upload"/></svg>${escapeHtml(t('importTracks'))}</button>
        </div>`);

    body.querySelectorAll('[data-mode]').forEach(button => {
        button.addEventListener('click', () => {
            mode = button.dataset.mode;
            drawLayer();
            panel.refresh();
        });
    });
    body.querySelectorAll('[data-delete]').forEach(button => {
        button.addEventListener('click', () => deleteTrack(trackOf(Number(button.dataset.delete))));
    });
    body.querySelector('[data-act="import"]').addEventListener('click', () => document.getElementById('gpx-input').click());
    body.querySelector('[data-act="off"]').addEventListener('click', deactivate);
    return { title: t('tracks'), body };
}

function render() {
    const opened = openedId ? trackOf(openedId) : null;
    if (openedId && !opened) openedId = null;
    const result = opened ? renderDetail(opened) : renderList();
    // 列表、个人纪录、重复路线里都能点开某一条轨迹
    result.body.querySelectorAll('[data-open]').forEach(element => {
        element.addEventListener('click', () => openTrack(Number(element.dataset.open)));
    });
    return result;
}

function deactivate() {
    active = false;
    selectedId = null;
    openedId = null;
    layer?.remove();
    layer = null;
    if (renderer) map.removeLayer(renderer); // 移除图层后 canvas 还在，要单独拿掉
    if (panel.id === 'tracks') panel.close();
    notify();
}

// 工具栏按钮：和点亮地图一样，开着时再点就关掉；面板被别的面板替换了就重新打开面板
export async function toggleTracks() {
    if (active && (panel.id === 'tracks' || panel.id === null)) return deactivate();
    if (!active) {
        try {
            await loadTracks();
        } catch (err) {
            return toastError('', err);
        }
        active = true;
        drawLayer();
        notify();
    }
    panel.open('tracks', render);
}
