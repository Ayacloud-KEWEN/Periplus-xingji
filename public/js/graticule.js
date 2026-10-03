// 地图上的经纬线：赤道、南北回归线、南北极圈、本初子午线、180° 经线和国际日期变更线。
// 在设置面板里开关，开关状态存在 localStorage。
import { map } from './map.js';
import { settings, saveSettings } from './settings.js';
import { t } from './i18n.js';

// 回归线和极圈的纬度取决于地球的轴倾角（约 23.4365°），每年都在变，这里用 2026 年的值
const OBLIQUITY = 23.4365;

// 纬线：[文案 key, 纬度, 颜色, 虚线]
const PARALLELS = [
    ['gratTropicCancer', OBLIQUITY, '#d9922b', '6 5'],
    ['gratEquator', 0, '#c0392b', null],
    ['gratTropicCapricorn', -OBLIQUITY, '#d9922b', '6 5'],
    ['gratArctic', 90 - OBLIQUITY, '#2f7fbf', '2 6'],
    ['gratAntarctic', -(90 - OBLIQUITY), '#2f7fbf', '2 6']
];

// 经线：[文案 key, 经度, 颜色, 虚线]
const MERIDIANS = [
    ['gratPrimeMeridian', 0, '#2e8b57', null],
    ['gratAntimeridian', 180, '#7a6a5c', '6 5']
];

// 国际日期变更线：它不是一条直线，为避开岛屿和国家来回绕。
// 下面是常见画法的示意折线（由北向南）：白令海峡从两个代奥米德岛之间穿过、西绕阿留申群岛、
// 东绕基里巴斯的莱恩群岛、再从两个萨摩亚之间穿过。只是示意，不是法定界线。
//
// 往东绕的那几段必须写成大于 180 的连续经度（191 而不是 -169）：
// 否则 Leaflet 会把 180 → -169 当成往西绕了大半个地球，画出一条横贯地图的线。
const DATE_LINE = [
    [90, 180], [75, 180], [75, 191], [68.5, 191], [65.5, 191],
    [60, 188], [54, 188], [52.5, 170], [48, 180], [5.5, 180],
    [5.5, 210], [-10.5, 210], [-10.5, 188.7], [-15.5, 188.7], [-15.5, 180],
    [-90, 180]
];

const PANE = 'graticule';
const COPIES = [-720, -360, 0, 360, 720]; // 地图可以左右无限拖，每一份世界都画一条

let layer = null;
let labels = [];

const style = (color, dash, weight = 1.2) => ({
    pane: PANE, color, weight, opacity: 0.75, dashArray: dash, interactive: false
});

// 纬线横跨好几份世界，一条折线画到底；经线每份世界各画一条
function buildLines() {
    const lines = [];
    for (const [, lat, color, dash] of PARALLELS) {
        lines.push(L.polyline([[lat, COPIES[0]], [lat, COPIES[COPIES.length - 1] + 360]],
            style(color, dash, lat === 0 ? 1.6 : 1.2)));
    }
    for (const [, lng, color, dash] of MERIDIANS) {
        for (const offset of COPIES) {
            lines.push(L.polyline([[85, lng + offset], [-85, lng + offset]], style(color, dash)));
        }
    }
    for (const offset of COPIES) {
        lines.push(L.polyline(DATE_LINE.map(([lat, lng]) => [lat, lng + offset]), style('#8e5fb5', '3 4', 1.6)));
    }
    return lines;
}

function makeLabel(text, color) {
    const marker = L.marker([0, 0], {
        pane: PANE,
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: 'graticule-label', html: `<span style="--line:${color}">${text}</span>`, iconSize: null })
    });
    return marker;
}

// 日期变更线在某条纬度上的经度（在折线上插值），用来摆放它的标签
function dateLineLngAt(lat) {
    for (let i = 0; i < DATE_LINE.length - 1; i++) {
        const [lat1, lng1] = DATE_LINE[i];
        const [lat2, lng2] = DATE_LINE[i + 1];
        if (lat <= lat1 && lat >= lat2) {
            if (lat1 === lat2) return lng1;
            return lng1 + (lng2 - lng1) * ((lat - lat1) / (lat2 - lat1));
        }
    }
    return 180;
}

// 标签跟着视野走：纬线的标签摆在屏幕中央的经度上，经线的标签摆在屏幕中央的纬度上，
// 这样不管拖到哪儿都看得见名字
function placeLabels() {
    if (!layer) return;
    const center = map.getCenter();
    const bounds = map.getBounds();
    // 地图左右可以无限拖，同一条经线每隔 360° 出现一次；取离视野中心最近的那一份
    const nearestCopy = (lng) => lng + Math.round((center.lng - lng) / 360) * 360;

    // 标签互相错开：纬线的名字放在视野偏左，经线的名字放在偏上，
    // 180° 经线和日期变更线大部分路段重合，再上下拉开
    const latSpan = bounds.getNorth() - bounds.getSouth();
    const lngSpan = bounds.getEast() - bounds.getWest();
    const labelLng = bounds.getWest() + lngSpan * 0.22;
    const latFor = { meridian: 0.18, dateline: 0.62 };

    for (const { marker, kind, value } of labels) {
        if (kind === 'parallel') {
            marker.setLatLng([value, labelLng]);
            marker.setOpacity(value >= bounds.getSouth() && value <= bounds.getNorth() ? 1 : 0);
        } else {
            const lat = bounds.getNorth() - latSpan * latFor[kind];
            const lng = nearestCopy(kind === 'dateline' ? dateLineLngAt(lat) : value);
            marker.setLatLng([lat, lng]);
            marker.setOpacity(lng >= bounds.getWest() && lng <= bounds.getEast() ? 1 : 0);
        }
    }
}

function build() {
    if (!map.getPane(PANE)) {
        // 自建图层面板：比底图高、比标注低，免得线和名字盖住图钉
        const pane = map.createPane(PANE);
        pane.style.zIndex = 450;
        pane.style.pointerEvents = 'none';
    }

    labels = [
        ...PARALLELS.map(([key, lat, color]) => ({ kind: 'parallel', value: lat, marker: makeLabel(t(key), color) })),
        ...MERIDIANS.map(([key, lng, color]) => ({ kind: 'meridian', value: lng, marker: makeLabel(t(key), color) })),
        { kind: 'dateline', value: 180, marker: makeLabel(t('gratDateLine'), '#8e5fb5') }
    ];

    layer = L.layerGroup([...buildLines(), ...labels.map(label => label.marker)]).addTo(map);
    placeLabels();
    map.on('moveend zoomend', placeLabels);
}

function destroy() {
    map.off('moveend zoomend', placeLabels);
    layer?.remove();
    layer = null;
    labels = [];
}

export function setGraticule(on) {
    settings.graticule = on;
    saveSettings();
    if (on && !layer) build();
    else if (!on && layer) destroy();
}

// 切换语言后重新画，标签才会跟着变
export function refreshGraticule() {
    if (!layer) return;
    destroy();
    build();
}

export function initGraticule() {
    if (settings.graticule) build();
}
