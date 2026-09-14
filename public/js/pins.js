// 个人标注：地图显示、聚合、详情 / 编辑面板、添加模式、时间过滤
import { map, currentPosition } from './map.js';
import { api } from './api.js';
import { settings, saveSettings } from './settings.js';
import { t, categoryLabel, formatDate, formatYear, regionName, getLanguage, setSpecialRegions } from './i18n.js';
import { enableHistory, loadPolityNames, polityLabel } from './history.js';
import { escapeHtml, fragment, panel, toast, toastError, confirmDialog } from './ui.js';
import { preparePhoto, PHOTO_ACCEPT } from './photos.js';
import { CATEGORIES, categoryOf, iconSvg } from './categories.js';

const pins = new Map(); // id -> { data, marker }
let clusterLayer = null;
let plainLayer = null;
let activeLayer = null;
let dateFilter = null;  // 时间戳；只显示此时间之前到访的标注
let selectedId = null;
let addMode = false;
let countryCodes = []; // 手动修改所在地区时的国家 / 地区列表
let placeHistoryOpen = false; // "历史上的这里"展开过一次后，打开别的标注时也保持展开

const PLACE_FIELDS = [['state', 'statStates'], ['city', 'statCities'], ['county', 'statCounties'], ['town', 'statTowns']];

const mapEl = document.getElementById('map');
const addButton = document.querySelector('.toolbar [data-action="add-pin"]');
const addHint = document.getElementById('add-hint');

// ---------- 地图图层 ----------

// 水滴形图钉：分类颜色填充，中间是白色线条图标
function createIcon(emoji, selected) {
    const { icon, color } = categoryOf(emoji);
    return L.divIcon({
        className: selected ? 'pin-icon selected' : 'pin-icon',
        html: `<svg viewBox="0 0 32 42"><path class="pin-shape" fill="${color}" d="M16 1.5C8 1.5 1.5 7.8 1.5 15.7 1.5 26.6 16 40.5 16 40.5s14.5-13.9 14.5-24.8C30.5 7.8 24 1.5 16 1.5z"/><use href="#cat-${icon}" x="8" y="7.7" width="16" height="16"/></svg>`,
        iconSize: [32, 42],
        iconAnchor: [16, 41],
        tooltipAnchor: [0, -36]
    });
}

// 聚合气泡：品牌色圆形，大小随数量变化
function createClusterIcon(cluster) {
    const count = cluster.getChildCount();
    const size = count < 10 ? 34 : count < 100 ? 40 : 46;
    return L.divIcon({ className: 'pin-cluster', html: `<span>${count}</span>`, iconSize: [size, size] });
}

function isVisible(point) {
    return dateFilter === null || new Date(point.visited_at).getTime() <= dateFilter;
}

function syncLayer() {
    activeLayer.clearLayers();
    const visible = [...pins.values()].filter(entry => isVisible(entry.data)).map(entry => entry.marker);
    if (activeLayer.addLayers) activeLayer.addLayers(visible);
    else visible.forEach(marker => activeLayer.addLayer(marker));
}

function upsert(point) {
    const existing = pins.get(point.id);
    if (existing) {
        existing.data = point;
        existing.marker.setLatLng([point.lat, point.lng]);
        existing.marker.setIcon(createIcon(point.emoji, point.id === selectedId));
        existing.marker.setTooltipContent(escapeHtml(point.title));
        return;
    }
    const marker = L.marker([point.lat, point.lng], { icon: createIcon(point.emoji, false) });
    marker.bindTooltip(escapeHtml(point.title), { direction: 'top' });
    marker.on('click', () => openPin(point.id));
    pins.set(point.id, { data: point, marker });
}

function selectPin(id) {
    const previous = pins.get(selectedId);
    selectedId = id;
    if (previous) previous.marker.setIcon(createIcon(previous.data.emoji, false));
    const next = pins.get(id);
    if (next) next.marker.setIcon(createIcon(next.data.emoji, true));
}

export function initPins() {
    clusterLayer = L.markerClusterGroup({
        disableClusteringAtZoom: 14,
        maxClusterRadius: 50,
        showCoverageOnHover: false,
        // 分批加入地图，每批连续处理 1 秒再让出主线程：1 万个以内一批就处理完，和一次性加载一样快；
        // 更多时页面也不会长时间卡住。默认的 0.2 秒一批让出太频繁，1 万个标注会慢好几倍
        chunkedLoading: true,
        chunkInterval: 1000,
        iconCreateFunction: createClusterIcon
    });
    plainLayer = L.layerGroup();
    activeLayer = settings.cluster ? clusterLayer : plainLayer;
    if (settings.showPins) activeLayer.addTo(map);

    map.on('click', onMapClick);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setAddMode(false);
    });
    // 国家列表里也包括特殊地区（北塞浦路斯等），同时登记它们的显示名称
    api.countries().then(({ codes, special }) => {
        setSpecialRegions(special);
        countryCodes = [...new Set([...codes, ...special.map(region => region.code)])];
    }).catch(() => { /* 编辑时只显示当前国家 */ });
}

export async function loadPins() {
    const list = await api.listPoints();
    pins.clear();
    list.forEach(upsert);
    syncLayer();
}

// 导入等批量操作创建的标注
export function addPoints(points) {
    points.forEach(upsert);
    syncLayer();
}

// 新建的标注由服务器在后台查询所在地区，通常几秒内完成。
// 这里每 2 秒问一次，查到就更新页面上的数据；最多等 1 分钟（关闭了自动识别时就一直是空的）
const WATCH_INTERVAL_MS = 2000;
const WATCH_TIMEOUT_MS = 60000;

export function watchPlaces(ids) {
    const pending = new Set(ids);
    const started = Date.now();
    const check = async () => {
        try {
            const points = await api.getPoints([...pending]);
            const found = new Set(points.map(point => point.id));
            for (const id of pending) if (!found.has(id)) pending.delete(id); // 已被删除
            for (const point of points) {
                if (point.place === null) continue;
                pending.delete(point.id);
                upsert(point);
                // 正在编辑时不刷新，免得清掉用户正在填的内容
                if (panel.id === `pin:${point.id}` && !document.querySelector('#panel-body .pin-form')) panel.refresh();
            }
        } catch { /* 网络问题：下一轮再试 */ }
        if (pending.size && Date.now() - started < WATCH_TIMEOUT_MS) setTimeout(check, WATCH_INTERVAL_MS);
    };
    if (pending.size) setTimeout(check, WATCH_INTERVAL_MS);
}

export function getPins() {
    return [...pins.values()].map(entry => entry.data);
}

export function setClustering(enabled) {
    settings.cluster = enabled;
    saveSettings();
    const next = enabled ? clusterLayer : plainLayer;
    if (next === activeLayer) return;
    activeLayer.clearLayers();
    activeLayer.remove();
    activeLayer = next;
    syncLayer();
    if (settings.showPins) activeLayer.addTo(map);
}

export function setPinsVisible(visible) {
    settings.showPins = visible;
    saveSettings();
    if (visible) activeLayer.addTo(map);
    else activeLayer.remove();
}

export function setDateFilter(timestamp) {
    dateFilter = timestamp;
    syncLayer();
}

export function focusPin(id) {
    const entry = pins.get(id);
    if (!entry) return;
    map.flyTo([entry.data.lat, entry.data.lng], Math.max(map.getZoom(), 15), { duration: 1 });
    openPin(id);
}

// ---------- 添加模式 ----------

export function setAddMode(enabled) {
    addMode = enabled;
    mapEl.classList.toggle('adding', enabled);
    addButton.classList.toggle('active', enabled);
    addHint.hidden = !enabled;
}

export function toggleAddMode() {
    setAddMode(!addMode);
}

async function onMapClick(e) {
    if (!addMode) return;
    setAddMode(false);
    const latlng = e.latlng.wrap(); // 地图横向滚动过一圈时经度可能超出 ±180
    try {
        const point = await api.createPoint({ lat: latlng.lat, lng: latlng.lng, title: t('newPinTitle'), emoji: '📍' });
        addPoints([point]);
        openPin(point.id, { edit: true });
        watchPlaces([point.id]);
    } catch (err) {
        toastError(t('saveFailed'), err);
    }
}

// 一键打卡：用当前位置直接建一个标注，省去先在地图上找位置
export async function checkIn() {
    const status = toast(t('checkinLocating'), { duration: 0 });
    try {
        const { coords } = await currentPosition();
        const point = await api.createPoint({
            lat: coords.latitude, lng: coords.longitude, title: t('checkinTitle'), emoji: '📍'
        });
        addPoints([point]);
        map.flyTo([point.lat, point.lng], Math.max(map.getZoom(), 16));
        openPin(point.id, { edit: true }); // 直接进编辑，方便马上改名字、加照片
        watchPlaces([point.id]);
        status.update(t('checkinDone', { accuracy: Math.round(coords.accuracy) }));
        status.closeAfter(4000);
    } catch (err) {
        status.close();
        toastError('', err);
    }
}

// ---------- 详情 / 编辑面板 ----------

export function openPin(id, { edit = false } = {}) {
    let editing = edit;
    const render = () => {
        const entry = pins.get(id);
        if (!entry) return { title: '', body: fragment('') };
        const setEditing = (value) => {
            editing = value;
            panel.refresh();
        };
        return editing
            ? renderEdit(entry.data, () => setEditing(false))
            : renderView(entry.data, () => setEditing(true));
    };
    selectPin(id);
    panel.open(`pin:${id}`, render, { onClose: () => selectPin(null) });
}

// 所在地区一行字：中国 · 浙江省 · 杭州市 · 西湖区 · 北山街道
function placeHtml(point) {
    const place = point.place;
    let text;
    if (!place) {
        text = t('placePending');
    } else if (!place.countryCode) {
        text = t('placeUnknown');
    } else {
        const city = place.city !== place.state ? place.city : null; // 直辖市不重复
        text = [regionName(place.countryCode, place.country), place.state, city, place.county, place.town].filter(Boolean).join(' · ');
    }
    const badge = point.place_manual ? `<span class="badge">${escapeHtml(t('placeManual'))}</span>` : '';
    return `<div class="pin-place"><svg><use href="#i-locate"/></svg><span>${escapeHtml(text)}${badge}</span></div>`;
}

// 编辑表单里的"所在地区"：国家 / 地区下拉选择，其余四级直接输入
function placeFieldsHtml(point) {
    const place = point.place || {};
    const codes = countryCodes.length ? [...countryCodes] : [];
    if (place.countryCode && !codes.includes(place.countryCode)) codes.push(place.countryCode);
    const options = codes
        .map(code => ({ code, name: regionName(code) }))
        .sort((a, b) => a.name.localeCompare(b.name, getLanguage()))
        .map(({ code, name }) => `<option value="${code}" ${code === place.countryCode ? 'selected' : ''}>${escapeHtml(name)}</option>`)
        .join('');
    const inputs = PLACE_FIELDS.map(([field, label]) => `
        <label><span>${escapeHtml(t(label))}</span>
            <input class="input" name="place_${field}" maxlength="100" value="${escapeHtml(place[field] || '')}"></label>`).join('');
    const badge = point.place_manual ? `<span class="badge">${escapeHtml(t('placeManual'))}</span>` : '';

    return `<div class="field"><span>${escapeHtml(t('placeSection'))}${badge}</span>
        <div class="place-grid">
            <label><span>${escapeHtml(t('placeCountry'))}</span>
                <select class="input" name="place_countryCode"><option value="">—</option>${options}</select></label>
            ${inputs}
        </div>
        <label class="checkbox"><input type="checkbox" name="place_auto">${escapeHtml(t('placeAuto'))}</label>
    </div>`;
}

// 返回 undefined 表示没改，null 表示恢复自动识别，对象表示手动修改
function readPlace(values, original) {
    if (values.get('place_auto')) return null;
    const edited = { countryCode: values.get('place_countryCode') || '' };
    for (const [field] of PLACE_FIELDS) edited[field] = (values.get(`place_${field}`) || '').trim();
    const before = original || {};
    const changed = edited.countryCode !== (before.countryCode || '')
        || PLACE_FIELDS.some(([field]) => edited[field] !== (before[field] || ''));
    if (!changed) return undefined;
    if (!edited.countryCode) throw new Error(t('placeCountryRequired'));
    return edited;
}

// ---------- 历史上的这里 ----------

function yearSpan(start, end) {
    if (start === end) return formatYear(start);
    const endText = end >= new Date().getFullYear() ? t('untilNow') : formatYear(end);
    return `${formatYear(start)} – ${endText}`;
}

// 展开时才查询：大多数时候用户不看，没必要每打开一个标注都查一次
async function loadPlaceHistory(point, container) {
    if (container.dataset.loaded) return;
    container.dataset.loaded = '1';
    try {
        const [spans] = await Promise.all([api.historyAt(point.lat, point.lng), loadPolityNames()]);
        if (!spans.length) {
            container.replaceChildren(fragment(`<p class="muted small">${escapeHtml(t('placeHistoryNone'))}</p>`));
            return;
        }
        const items = spans.map(span => `
            <button type="button" class="history-item" data-year="${span.start === 0 ? 1 : span.start}">
                <span class="history-name">${escapeHtml(polityLabel(span.name, span.wiki))}</span>
                <span class="history-years">${escapeHtml(yearSpan(span.start, span.end))}</span>
            </button>`).join('');
        container.replaceChildren(fragment(`
            <p class="muted small">${escapeHtml(t('placeHistoryHint'))}</p>
            <div class="history-list">${items}</div>`));
        container.querySelectorAll('[data-year]').forEach(button => {
            button.addEventListener('click', async () => {
                map.flyTo([point.lat, point.lng], Math.min(map.getZoom(), 5));
                await enableHistory({ year: Number(button.dataset.year) });
            });
        });
    } catch (err) {
        delete container.dataset.loaded;
        container.replaceChildren(fragment(`<p class="muted small">${escapeHtml(err.message)}</p>`));
    }
}

// 照片：大图 + 缩略图条，点缩略图切换大图，点大图在新标签页看原图
function galleryHtml(photos) {
    if (!photos.length) return '';
    const first = escapeHtml(photos[0].url);
    const thumbs = photos.length > 1
        ? `<div class="pin-thumbs">${photos.map((photo, i) => `
            <button type="button" class="pin-thumb ${i === 0 ? 'active' : ''}" data-url="${escapeHtml(photo.url)}">
                <img src="${escapeHtml(photo.url)}" alt="" loading="lazy"></button>`).join('')}</div>`
        : '';
    return `<div class="pin-gallery">
        <a data-main href="${first}" target="_blank" rel="noopener"><img class="pin-photo" src="${first}" alt=""></a>
        ${photos.length > 1 ? `<span class="pin-photo-count">1 / ${photos.length}</span>` : ''}
        ${thumbs}</div>`;
}

function bindGallery(body) {
    const main = body.querySelector('.pin-gallery [data-main]');
    const count = body.querySelector('.pin-photo-count');
    const thumbs = [...body.querySelectorAll('.pin-thumb')];
    thumbs.forEach((thumb, i) => thumb.addEventListener('click', () => {
        main.href = thumb.dataset.url;
        main.querySelector('img').src = thumb.dataset.url;
        thumbs.forEach(other => other.classList.toggle('active', other === thumb));
        count.textContent = `${i + 1} / ${thumbs.length}`;
    }));
}

function renderView(point, onEdit) {
    const body = fragment(`
        ${galleryHtml(point.photos || [])}
        <div class="pin-meta">
            <span class="cat-chip" style="--cat:${categoryOf(point.emoji).color}">${iconSvg(point.emoji)}${escapeHtml(categoryLabel(categoryOf(point.emoji).emoji))}</span>
            <span>${escapeHtml(formatDate(point.visited_at, { withTime: true }))}</span>
            <span>${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}</span>
        </div>
        ${placeHtml(point)}
        <details class="pin-history">
            <summary><svg><use href="#i-history"/></svg>${escapeHtml(t('placeHistory'))}</summary>
            <div class="pin-history-body"><p class="muted small">${escapeHtml(t('placeHistoryLoading'))}</p></div>
        </details>
        <p class="pin-description ${point.description ? '' : 'empty'}">${escapeHtml(point.description || t('noDescription'))}</p>
        <div class="actions">
            <button class="btn btn-ghost" data-act="delete"><svg><use href="#i-trash"/></svg>${escapeHtml(t('delete'))}</button>
            <span class="spacer"></span>
            <button class="btn btn-primary" data-act="edit"><svg><use href="#i-edit"/></svg>${escapeHtml(t('edit'))}</button>
        </div>`);
    body.querySelector('[data-act="edit"]').addEventListener('click', onEdit);
    body.querySelector('[data-act="delete"]').addEventListener('click', () => deletePin(point));
    bindGallery(body);

    const history = body.querySelector('.pin-history');
    const historyBody = history.querySelector('.pin-history-body');
    history.addEventListener('toggle', () => {
        placeHistoryOpen = history.open;
        if (history.open) loadPlaceHistory(point, historyBody);
    });
    if (placeHistoryOpen) history.open = true; // 会触发 toggle，由上面负责加载
    return { title: point.title || t('newPinTitle'), body };
}

// datetime-local 输入框使用本地时间，不带时区
function toLocalInput(value) {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function renderEdit(point, onDone) {
    const current = categoryOf(point.emoji).emoji;
    const choices = CATEGORIES.map(category => `
        <label class="cat-option" style="--cat:${category.color}" title="${escapeHtml(categoryLabel(category.emoji))}">
            <input type="radio" name="emoji" value="${category.emoji}" ${category.emoji === current ? 'checked' : ''}>
            ${iconSvg(category.emoji)}<span>${escapeHtml(categoryLabel(category.emoji))}</span>
        </label>`).join('');

    const body = fragment(`
        <form class="pin-form">
            <label class="field"><span>${escapeHtml(t('title'))}</span>
                <input class="input" name="title" maxlength="200" value="${escapeHtml(point.title)}"></label>
            <div class="field"><span>${escapeHtml(t('category'))}</span>
                <div class="cat-grid">${choices}</div></div>
            <label class="field"><span>${escapeHtml(t('visitedAt'))}</span>
                <input class="input" type="datetime-local" name="visited_at" value="${toLocalInput(point.visited_at)}"></label>
            <label class="field"><span>${escapeHtml(t('description'))}</span>
                <textarea class="input" name="description" maxlength="5000">${escapeHtml(point.description)}</textarea></label>
            ${placeFieldsHtml(point)}
            <div class="field"><span>${escapeHtml(t('photo'))}</span>
                <div class="photo-edit">
                    <div class="photo-list" data-photos></div>
                    <label class="btn"><svg><use href="#i-camera"/></svg>${escapeHtml(t('addPhotos'))}
                        <input type="file" name="photo" accept="${PHOTO_ACCEPT}" multiple hidden></label>
                </div>
            </div>
            <div class="actions">
                <button type="button" class="btn" data-act="cancel">${escapeHtml(t('cancel'))}</button>
                <button type="submit" class="btn btn-primary">${escapeHtml(t('save'))}</button>
            </div>
        </form>`);

    const form = body.querySelector('form');
    const photoList = form.querySelector('[data-photos]');
    const submitButton = form.querySelector('[type="submit"]');
    // 保存前都只是记下来：已有照片里要删的、新选的文件；按"取消"就什么都不改
    const removedIds = new Set();
    const newPhotos = []; // { file, url }

    const renderPhotoList = () => {
        const kept = (point.photos || []).filter(photo => !removedIds.has(photo.id));
        const item = (src, attr) => `<div class="photo-item"><img src="${escapeHtml(src)}" alt="">
            <button type="button" class="photo-remove" ${attr} title="${escapeHtml(t('removePhoto'))}" aria-label="${escapeHtml(t('removePhoto'))}">×</button></div>`;
        photoList.replaceChildren(fragment(
            kept.map(photo => item(photo.url, `data-remove-id="${photo.id}"`)).join('')
            + newPhotos.map((photo, i) => item(photo.url, `data-remove-new="${i}"`)).join('')));
        photoList.hidden = !photoList.children.length;
    };
    renderPhotoList();

    photoList.addEventListener('click', (e) => {
        const button = e.target.closest('.photo-remove');
        if (!button) return;
        if (button.dataset.removeId) {
            removedIds.add(Number(button.dataset.removeId));
        } else {
            const [removed] = newPhotos.splice(Number(button.dataset.removeNew), 1);
            URL.revokeObjectURL(removed.url);
        }
        renderPhotoList();
    });
    form.elements.photo.addEventListener('change', (e) => {
        for (const file of e.target.files) newPhotos.push({ file, url: URL.createObjectURL(file) });
        e.target.value = ''; // 允许再次选择同一张
        renderPhotoList();
    });
    form.querySelector('[data-act="cancel"]').addEventListener('click', onDone);
    // 勾选"恢复自动识别"时，手动填写的地区不再生效
    form.elements.place_auto.addEventListener('change', (e) => {
        form.querySelectorAll('.place-grid input, .place-grid select').forEach(input => { input.disabled = e.target.checked; });
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        submitButton.disabled = true;
        const values = new FormData(form);
        const visitedAt = values.get('visited_at');
        try {
            const place = readPlace(values, point.place);
            let updated = await api.updatePoint(point.id, {
                title: values.get('title').trim() || t('newPinTitle'),
                emoji: values.get('emoji'),
                description: values.get('description'),
                visited_at: visitedAt ? new Date(visitedAt).toISOString() : point.visited_at,
                ...(place !== undefined ? { place } : {})
            });
            for (const photoId of removedIds) updated = await api.removePhoto(point.id, photoId);
            removedIds.clear(); // 上传中途失败再点保存时，不重复删除
            if (newPhotos.length) {
                const status = toast(t('uploading'), { duration: 0 });
                try {
                    const total = newPhotos.length;
                    for (let i = 0; newPhotos.length; i++) {
                        status.update(`${t('uploading')} ${i + 1}/${total}`);
                        const { blob, name } = await preparePhoto(newPhotos[0].file);
                        updated = await api.addPhoto(point.id, blob, name);
                        URL.revokeObjectURL(newPhotos.shift().url); // 传完一张去掉一张，失败后重试只传剩下的
                    }
                } finally {
                    status.close();
                }
            }
            upsert(updated);
            syncLayer();
            toast(t('saved'));
            onDone();
        } catch (err) {
            toastError(t('saveFailed'), err);
            submitButton.disabled = false;
        }
    });

    return { title: t('edit'), body };
}

async function deletePin(point) {
    if (!(await confirmDialog(t('confirmDelete', { title: point.title })))) return;
    try {
        await api.deletePoint(point.id);
        const entry = pins.get(point.id);
        activeLayer.removeLayer(entry.marker);
        pins.delete(point.id);
        panel.close();
        toast(t('deleted'));
    } catch (err) {
        toastError(t('deleteFailed'), err);
    }
}
