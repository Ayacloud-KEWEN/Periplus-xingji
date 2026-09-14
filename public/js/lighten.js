// 点亮地图：把去过的国家、省 / 州涂上颜色，还可以导出一张海报。
// 去过哪里按标注坐标和边界做空间匹配（服务端 /api/regions），不依赖逆地理编码。
import { map } from './map.js';
import { api } from './api.js';
import { settings, saveSettings } from './settings.js';
import { t, localized, regionName } from './i18n.js';
import { escapeHtml, fragment, panel, toast, toastError } from './ui.js';

// 按标注数量分四档，越多颜色越深
const BUCKETS = [
    { min: 10, color: '#c2410c', label: '10+' },
    { min: 5, color: '#ea7a22', label: '5–9' },
    { min: 2, color: '#f5a54a', label: '2–4' },
    { min: 1, color: '#fcd08a', label: '1' }
];
const UNVISITED = '#e3dcd0';

let active = false;
let layer = null;
let renderer = null;    // 只建一个 canvas 反复用；每次重画都新建的话，旧 canvas 会一直留在页面上跟着地图重绘
let countries = null;   // FeatureCollection：所有国家和地区
let provinces = null;   // FeatureCollection：去过的国家的所有省 / 州
let focusCountry = null;

const colorFor = (pins) => BUCKETS.find(bucket => pins >= bucket.min)?.color || null;
const visited = (feature) => feature.properties.pins > 0;
const byPins = (a, b) => b.properties.pins - a.properties.pins;

function featureName(feature) {
    const { code, names } = feature.properties;
    // 国家用和足迹统计一致的名称（浏览器内置 / 特殊地区），省用 Natural Earth 自带的名称
    return feature.properties.code === feature.properties.country
        ? regionName(code, localized(names))
        : localized(names) || code;
}

function notify() {
    document.dispatchEvent(new CustomEvent('lightenchange'));
}

export function isLightenActive() {
    return active;
}

async function loadData() {
    countries = await api.regions(0);
    const codes = countries.features.filter(visited).map(feature => feature.properties.code);
    provinces = codes.length ? await api.regions(1, codes) : { type: 'FeatureCollection', features: [] };
    const litCountries = countries.features.filter(visited).sort(byPins);
    if (!litCountries.some(feature => feature.properties.code === focusCountry)) {
        focusCountry = litCountries[0]?.properties.code ?? null;
    }
}

function drawLayer() {
    layer?.remove();
    if (!map.getPane('lighten')) {
        map.createPane('lighten');
        map.getPane('lighten').style.zIndex = 360; // 在历史疆域（350）之上、标注之下
    }
    renderer ??= L.canvas({ pane: 'lighten', padding: 0.5 });
    const byProvince = settings.lightenLevel === 1;
    layer = L.geoJSON(byProvince ? provinces : countries, {
        pane: 'lighten',
        renderer,
        // 按国家时只画去过的；按省时把去过的国家里没去过的省也描出虚线轮廓，看得出还差哪些
        filter: byProvince ? undefined : visited,
        style: (feature) => {
            const color = colorFor(feature.properties.pins);
            if (color) return { color: '#fff', weight: 1, opacity: 0.9, fillColor: color, fillOpacity: 0.65 };
            return { color: '#9b8b7a', weight: 0.7, opacity: 0.7, dashArray: '2 3', fillOpacity: 0 };
        },
        onEachFeature: (feature, polygon) => polygon.bindTooltip(
            () => `${escapeHtml(featureName(feature))} · ${escapeHtml(t('statPins', { count: feature.properties.pins }))}`,
            { sticky: true }
        )
    }).addTo(map);
}

function fitFeatures(features) {
    if (!features.length) return;
    map.fitBounds(L.geoJSON({ type: 'FeatureCollection', features }).getBounds(), { padding: [40, 40] });
}

// ---------- 海报 ----------

// 自己在 canvas 上画，不截地图：在线瓦片跨域，截图导不出来
function exportPoster() {
    const byProvince = settings.lightenLevel === 1;
    const features = byProvince
        ? provinces.features.filter(feature => feature.properties.country === focusCountry)
        : countries.features;
    if (!features.length) return;

    const W = 1600;
    const H = 1000;
    const margin = { top: 170, right: 70, bottom: 110, left: 70 };
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f7f3ec';
    ctx.fillRect(0, 0, W, H);

    // 墨卡托投影，按要画的范围缩放到画布
    const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + Math.max(-83, Math.min(83, lat)) * Math.PI / 360));
    let bounds;
    if (byProvince) {
        const b = L.geoJSON({ type: 'FeatureCollection', features }).getBounds();
        bounds = { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
    } else {
        bounds = { west: -170, east: 180, south: -56, north: 80 };
    }
    const spanX = (bounds.east - bounds.west) * Math.PI / 180;
    const spanY = mercY(bounds.north) - mercY(bounds.south);
    const areaW = W - margin.left - margin.right;
    const areaH = H - margin.top - margin.bottom;
    const scale = Math.min(areaW / spanX, areaH / spanY);
    const offsetX = margin.left + (areaW - spanX * scale) / 2;
    const offsetY = margin.top + (areaH - spanY * scale) / 2;
    const project = ([lng, lat]) => [
        offsetX + (lng - bounds.west) * Math.PI / 180 * scale,
        offsetY + (mercY(bounds.north) - mercY(lat)) * scale
    ];

    for (const feature of features) {
        const { type, coordinates } = feature.geometry || {};
        const polygons = type === 'Polygon' ? [coordinates] : type === 'MultiPolygon' ? coordinates : [];
        ctx.beginPath();
        for (const polygon of polygons) {
            for (const ring of polygon) {
                ring.forEach((point, i) => {
                    const [x, y] = project(point);
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.closePath();
            }
        }
        ctx.fillStyle = colorFor(feature.properties.pins) || UNVISITED;
        ctx.fill('evenodd');
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = byProvince ? 1.2 : 0.8;
        ctx.stroke();
    }

    // 标题和统计
    const font = (size, weight = 400) => `${weight} ${size}px "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif`;
    const lit = features.filter(visited);
    const pins = lit.reduce((sum, feature) => sum + feature.properties.pins, 0);
    ctx.fillStyle = '#3d2b1f';
    ctx.font = font(56, 700);
    ctx.fillText(byProvince ? `${regionName(focusCountry)} · ${t('posterTitle')}` : t('posterTitle'), margin.left, 90);
    ctx.fillStyle = '#7a6a5c';
    ctx.font = font(28);
    ctx.fillText(byProvince
        ? t('posterProvinceStats', { provinces: lit.length, total: features.length, pins })
        : t('posterStats', { countries: lit.length, provinces: provinces.features.filter(visited).length, pins }), margin.left, 138);

    // 图例和落款
    let x = margin.left;
    ctx.font = font(22);
    for (const bucket of [...BUCKETS].reverse()) {
        ctx.fillStyle = bucket.color;
        ctx.fillRect(x, H - 62, 26, 26);
        ctx.fillStyle = '#7a6a5c';
        ctx.fillText(bucket.label, x + 34, H - 41);
        x += 34 + ctx.measureText(bucket.label).width + 28;
    }
    ctx.textAlign = 'right';
    ctx.fillText(`Periplus · 行纪 · ${new Date().toISOString().slice(0, 10)}`, W - margin.right, H - 41);

    canvas.toBlob((blob) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `periplus-${byProvince ? focusCountry : 'world'}.png`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    }, 'image/png');
}

// ---------- 面板 ----------

function render() {
    const byProvince = settings.lightenLevel === 1;
    const litCountries = countries.features.filter(visited).sort(byPins);
    const litProvinces = provinces.features.filter(visited);
    const levelButtons = [[0, 'lightenCountries'], [1, 'lightenProvinces']]
        .map(([level, key]) => `<button type="button" data-level="${level}" class="${settings.lightenLevel === level ? 'active' : ''}">${escapeHtml(t(key))}</button>`)
        .join('');
    const legend = [...BUCKETS].reverse()
        .map(bucket => `<span><i style="background:${bucket.color}"></i>${bucket.label}</span>`).join('');

    let list;
    let countrySelect = '';
    if (byProvince) {
        countrySelect = `<label class="field"><span>${escapeHtml(t('lightenCountry'))}</span>
            <select class="input" data-country>${litCountries.map(feature => `<option value="${escapeHtml(feature.properties.code)}" ${feature.properties.code === focusCountry ? 'selected' : ''}>${escapeHtml(featureName(feature))}</option>`).join('')}</select></label>`;
        const inCountry = provinces.features.filter(feature => feature.properties.country === focusCountry);
        list = inCountry.filter(visited).sort(byPins);
        countrySelect += `<p class="muted">${escapeHtml(t('posterProvinceStats', { provinces: list.length, total: inCountry.length, pins: list.reduce((s, f) => s + f.properties.pins, 0) }))}</p>`;
    } else {
        list = litCountries;
    }
    const items = list.map((feature, i) => `
        <button type="button" class="stat-item" data-index="${i}">
            <span class="legend-dot" style="background:${colorFor(feature.properties.pins)}"></span>
            <span class="main"><strong>${escapeHtml(featureName(feature))}</strong></span>
            <span class="stat-count">${feature.properties.pins}</span>
        </button>`).join('');

    const body = fragment(`
        <div class="segmented" data-segment="level">${levelButtons}</div>
        <p><strong>${escapeHtml(t('lightenSummary', { countries: litCountries.length, provinces: litProvinces.length }))}</strong></p>
        <p class="muted small">${escapeHtml(t('lightenHint'))}</p>
        <div class="legend"><span>${escapeHtml(t('lightenLegend'))}</span>${legend}</div>
        ${countrySelect}
        <div class="stat-list">${items || `<p class="muted">${escapeHtml(t('statNone'))}</p>`}</div>
        <div class="actions">
            <button type="button" class="btn btn-ghost" data-act="off">${escapeHtml(t('lightenOff'))}</button>
            <span class="spacer"></span>
            <button type="button" class="btn btn-primary" data-act="poster"><svg><use href="#i-download"/></svg>${escapeHtml(t('lightenExport'))}</button>
        </div>`);

    body.querySelectorAll('[data-level]').forEach(button => {
        button.addEventListener('click', () => {
            settings.lightenLevel = Number(button.dataset.level);
            saveSettings();
            drawLayer();
            panel.refresh();
        });
    });
    body.querySelector('[data-country]')?.addEventListener('change', (e) => {
        focusCountry = e.target.value;
        fitFeatures(provinces.features.filter(feature => feature.properties.country === focusCountry));
        panel.refresh();
    });
    body.querySelectorAll('[data-index]').forEach(button => {
        button.addEventListener('click', () => fitFeatures([list[Number(button.dataset.index)]]));
    });
    body.querySelector('[data-act="poster"]').addEventListener('click', exportPoster);
    body.querySelector('[data-act="off"]').addEventListener('click', deactivate);
    return { title: t('lighten'), body };
}

function deactivate() {
    active = false;
    layer?.remove();
    layer = null;
    if (renderer) map.removeLayer(renderer); // 移除图层后 canvas 还在，要单独拿掉；下次画时会自动加回来
    if (panel.id === 'lighten') panel.close();
    notify();
}

// 工具栏按钮：没开 → 打开图层和面板；开着、面板在或已关掉 → 关闭点亮；
// 开着但面板被别的面板替换了 → 重新打开面板。
// 以前面板被关掉后再点只会重新打开面板，图层就再也关不掉了
export async function toggleLighten() {
    if (active && (panel.id === 'lighten' || panel.id === null)) return deactivate();
    if (!active) {
        try {
            await loadData(); // 每次打开都重新取，标注有增减时颜色是最新的
        } catch (err) {
            return toastError('', err);
        }
        if (!countries.features.length) return toast(t('lightenUnavailable'), { type: 'error', duration: 6000 });
        active = true;
        drawLayer();
        notify();
    }
    panel.open('lighten', render);
}
