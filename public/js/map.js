// 地图实例、底图与定位
import { settings, saveSettings } from './settings.js';
import { t } from './i18n.js';
import { debounce, toast } from './ui.js';

export let map = null;
let tileLayer = null;
let maptilerKey = '';
let locationLayer = null;

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const OSM_STYLES = [
    { key: 'osmStandard', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTRIBUTION, maxNativeZoom: 19 },
    {
        key: 'osmTopo',
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: `${OSM_ATTRIBUTION}, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
        maxNativeZoom: 17
    }
];

// [文案 key, MapTiler 样式 id, 瓦片格式]
const MAPTILER_STYLES = [
    ['mapStreets', 'streets-v2', 'png'],
    ['mapSatellite', 'satellite', 'jpg'],
    ['mapHybrid', 'hybrid', 'jpg'],       // 卫星图 + 地名、道路
    ['mapBasic', 'basic-v2', 'png'],
    ['mapToner', 'toner-v2', 'png'],
    ['mapOcean', 'ocean', 'jpg'],
    ['mapOutdoor', 'outdoor-v2', 'png'],
    ['mapSki', 'winter-v2', 'png'],
    ['mapNature', 'topo-v2', 'png']
];

export function hasMaptiler() {
    return Boolean(maptilerKey);
}

export function getMaptilerKey() {
    return maptilerKey;
}

export function getStyles(provider = settings.provider) {
    if (provider !== 'maptiler') return OSM_STYLES;
    // MapTiler 默认返回 512px 瓦片：按 512 显示并把缩放级别减 1，
    // 否则文字只有一半大，瓦片请求数还会翻好几倍
    return MAPTILER_STYLES.map(([key, id, ext]) => ({
        key,
        url: `https://api.maptiler.com/maps/${id}/{z}/{x}/{y}.${ext}?key=${maptilerKey}`,
        attribution: `&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> ${OSM_ATTRIBUTION}`,
        maxNativeZoom: 19,
        tileSize: 512,
        zoomOffset: -1
    }));
}

function applyBasemap() {
    const styles = getStyles();
    const style = styles[settings.styleIndex] || styles[0];
    if (tileLayer) tileLayer.remove();
    tileLayer = L.tileLayer(style.url, {
        attribution: style.attribution,
        maxNativeZoom: style.maxNativeZoom,
        maxZoom: 19,
        tileSize: style.tileSize || 256,
        zoomOffset: style.zoomOffset || 0
    }).addTo(map);
}

export function setBasemap(provider, styleIndex) {
    settings.provider = provider;
    settings.styleIndex = styleIndex;
    saveSettings();
    applyBasemap();
}

export function initMap(key) {
    maptilerKey = key || '';
    if (!maptilerKey && settings.provider === 'maptiler') {
        settings.provider = 'osm';
        settings.styleIndex = 0;
    }

    map = L.map('map', { zoomControl: false, minZoom: 2, maxZoom: 19, worldCopyJump: true });
    map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    if (settings.view) {
        map.setView(settings.view.center, settings.view.zoom);
    } else {
        map.setView([35, 105], 4);
    }
    applyBasemap();

    // 记住上次看的位置，下次打开时回到这里
    map.on('moveend', debounce(() => {
        const center = map.getCenter();
        settings.view = { center: [center.lat, center.lng], zoom: map.getZoom() };
        saveSettings();
    }, 500));

    map.on('locationfound', (e) => {
        if (locationLayer) locationLayer.remove();
        const accuracy = Math.round(e.accuracy);
        locationLayer = L.layerGroup([
            L.circle(e.latlng, { radius: e.accuracy, color: '#c8893b', weight: 1, fillOpacity: 0.12 }),
            L.circleMarker(e.latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#c8893b', fillOpacity: 1 })
        ]).addTo(map);
        toast(t('locationFound', { accuracy }));
    });
    map.on('locationerror', (e) => {
        // Leaflet 把 GeolocationPositionError 的 code 放在 e.code 上：1 拒绝，2 不可用，3 超时。
        // 浏览器给的英文原文（如 "Origin does not have permission…"）看不出原因，换成说明
        const key = { 1: 'locationDenied', 2: 'locationUnavailable', 3: 'locationTimeout' }[e.code];
        toast(key ? t(key) : t('locationError') + e.message, { type: 'error', duration: 8000 });
    });
    return map;
}

// 取当前位置；失败时抛出已经翻译好的错误，调用方直接显示即可
export function currentPosition() {
    if (!window.isSecureContext) return Promise.reject(new Error(t('locationNeedsHttps')));
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            position => resolve(position),
            error => reject(new Error(t({ 1: 'locationDenied', 2: 'locationUnavailable', 3: 'locationTimeout' }[error.code] || 'locationError'))),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
        );
    });
}

export function locate() {
    // 定位只在 HTTPS（或 localhost）下可用；http:// 访问时浏览器会直接拒绝，提示用户怎么解决
    if (!window.isSecureContext) {
        toast(t('locationNeedsHttps'), { type: 'error', duration: 10000 });
        return;
    }
    map.locate({ setView: true, maxZoom: 16, timeout: 15000 });
}

// fitBounds 的留白：避开时间轴、搜索栏和打开的面板（宽屏在右侧，手机在底部）
export function fitOptions(maxZoom) {
    let right = 60;
    let bottom = 90;
    const panelEl = document.getElementById('panel');
    if (!panelEl.hidden) {
        const rect = panelEl.getBoundingClientRect();
        if (window.innerWidth <= 640) bottom = window.innerHeight - rect.top + 20;
        else right = window.innerWidth - rect.left + 20;
    }
    // 剩下的可视区域太小时（比如小屏手机上打开了面板）就不再避让面板，
    // 否则 fitBounds 会把路线放得过大，甚至算出无效的缩放级别
    // 时间轴在底部时也要避开
    const timebarEl = document.getElementById('timebar');
    if (!timebarEl.hidden) bottom = Math.max(bottom, window.innerHeight - timebarEl.getBoundingClientRect().top + 20);
    const size = map.getSize();
    if (size.x - 70 - right < 100) right = 20;
    if (size.y - 90 - bottom < 100) bottom = 20;
    return { paddingTopLeft: [70, 90], paddingBottomRight: [right, bottom], maxZoom };
}
