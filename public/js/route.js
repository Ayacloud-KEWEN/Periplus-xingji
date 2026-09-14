// 路线图层：相邻两站用弧线连接，路段中间画方向箭头，站点显示编号，线上有沿行进方向流动的光点。
// 历史旅行家路线（journeys.js）和"我的旅程"（trips.js）共用。
import { map } from './map.js';
import { escapeHtml } from './ui.js';

const CURVE_SAMPLES = 24;
const CURVE_BEND = 0.18;       // 弧线弯曲程度：控制点偏离中点的距离 / 两站距离
const MIN_ARROW_SEGMENT = 56;  // 屏幕上短于这个像素长度的路段不显示箭头，避免和站点挤在一起

// 在墨卡托平面（缩放级别 0）上画二次贝塞尔弧线。
// 墨卡托是等角投影，这里算出的方向角在任何缩放级别下都不变。
function curveBetween(from, to) {
    const crs = map.options.crs;
    const a = crs.latLngToPoint(L.latLng(from), 0);
    const b = crs.latLngToPoint(L.latLng(to), 0);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    if (length === 0) return { latlngs: [from, to], mid: from, angle, length };

    // 控制点从中点向行进方向的左侧偏移，所有路段朝同一侧弯，整条路线更流畅
    const cx = (a.x + b.x) / 2 + dy * CURVE_BEND;
    const cy = (a.y + b.y) / 2 - dx * CURVE_BEND;
    const latlngs = [];
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
        const s = i / CURVE_SAMPLES;
        const u = 1 - s;
        latlngs.push(crs.pointToLatLng(L.point(u * u * a.x + 2 * u * s * cx + s * s * b.x, u * u * a.y + 2 * u * s * cy + s * s * b.y), 0));
    }
    // 二次贝塞尔在中点处的切线与 a→b 平行，所以箭头方向就是 a→b 的方向
    return { latlngs, mid: latlngs[CURVE_SAMPLES / 2], angle, length };
}

function arrowIcon(color, angle) {
    return L.divIcon({
        className: 'journey-arrow',
        html: `<svg viewBox="0 0 16 16" style="transform:rotate(${angle.toFixed(1)}deg);color:${escapeHtml(color)}"><path d="M3 2L14 8L3 14L6 8Z"/></svg>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
}

function stopIcon(color, number) {
    return L.divIcon({
        className: 'journey-stop-icon',
        html: `<span class="journey-stop" style="background:${escapeHtml(color)}">${number}</span>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11]
    });
}

// stops: [{ lat, lng, tooltip?: () => html, popup?: () => html, onClick?: () => void }]
// 返回 { bounds, show(predicate), remove() }。
// show 只显示满足条件的站点，以及两端站点都显示的路段（用于随时间轴逐段展开）
export function createRoute(stops, color) {
    const lineStyle = { interactive: false, lineCap: 'round', lineJoin: 'round' };
    const layer = L.layerGroup().addTo(map);
    // 三层线条：白色描边（任何底色上都清楚）、主色线、沿行进方向流动的白色光点
    const casing = L.polyline([], { ...lineStyle, color: '#fff', weight: 8, opacity: 0.9 }).addTo(layer);
    const line = L.polyline([], { ...lineStyle, color, weight: 4, opacity: 0.95 }).addTo(layer);
    const flow = L.polyline([], { ...lineStyle, color: '#fff', weight: 2.5, opacity: 0.9, dashArray: '1 14', className: 'journey-flow' }).addTo(layer);

    const markers = stops.map((stop, i) => {
        const marker = L.marker([stop.lat, stop.lng], { icon: stopIcon(color, i + 1), zIndexOffset: 1000 });
        if (stop.tooltip) marker.bindTooltip(stop.tooltip, { direction: 'top', offset: [0, -10] });
        if (stop.popup) marker.bindPopup(stop.popup);
        if (stop.onClick) marker.on('click', stop.onClick);
        return marker;
    });
    const segments = stops.slice(1).map((stop, i) => {
        const curve = curveBetween([stops[i].lat, stops[i].lng], [stop.lat, stop.lng]);
        return {
            from: i,
            to: i + 1,
            latlngs: curve.latlngs,
            length: curve.length,
            arrow: L.marker(curve.mid, { icon: arrowIcon(color, curve.angle), interactive: false, keyboard: false })
        };
    });

    let isVisible = () => true;
    const setShown = (item, show) => {
        if (show && !layer.hasLayer(item)) layer.addLayer(item);
        if (!show && layer.hasLayer(item)) layer.removeLayer(item);
    };

    function render() {
        const stopShown = stops.map((stop, i) => isVisible(stop, i));
        const shown = segments.filter(segment => stopShown[segment.from] && stopShown[segment.to]);
        const lines = shown.map(segment => segment.latlngs);
        casing.setLatLngs(lines);
        line.setLatLngs(lines);
        flow.setLatLngs(lines);

        const scale = 2 ** map.getZoom(); // 缩放级别 0 的长度 × 2^zoom = 当前屏幕上的像素长度
        const shownSet = new Set(shown);
        segments.forEach(segment => setShown(segment.arrow, shownSet.has(segment) && segment.length * scale >= MIN_ARROW_SEGMENT));
        markers.forEach((marker, i) => setShown(marker, stopShown[i]));
    }

    map.on('zoomend', render);
    render();

    return {
        bounds: L.latLngBounds(stops.map(stop => [stop.lat, stop.lng]).concat(segments.flatMap(segment => segment.latlngs))),
        show(predicate) {
            isVisible = predicate;
            render();
        },
        remove() {
            map.off('zoomend', render);
            layer.remove();
        }
    };
}
