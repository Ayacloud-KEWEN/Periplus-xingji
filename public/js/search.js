// 搜索：输入时即时匹配自己的标注；按回车再搜索地名（Nominatim 不允许逐字请求）
import { map, hasMaptiler, getMaptilerKey } from './map.js';
import { settings } from './settings.js';
import { getPins, focusPin } from './pins.js';
import { t, getLanguage, formatDate } from './i18n.js';
import { escapeHtml, fragment, debounce } from './ui.js';
import { categoryOf, iconSvg } from './categories.js';

const form = document.getElementById('search');
const input = document.getElementById('search-input');
const results = document.getElementById('search-results');

let placeQuery = '';
let places = [];
let requestSeq = 0;

function matchPins(query) {
    const q = query.toLowerCase();
    return getPins()
        .filter(pin => pin.title.toLowerCase().includes(q) || pin.description.toLowerCase().includes(q))
        .slice(0, 8);
}

async function searchPlaces(query) {
    if (settings.provider === 'maptiler' && hasMaptiler()) {
        const params = new URLSearchParams({ key: getMaptilerKey(), language: getLanguage(), limit: '6' });
        const response = await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?${params}`);
        const data = await response.json();
        return (data.features || []).map(f => ({ name: f.place_name, lat: f.center[1], lng: f.center[0], bbox: f.bbox }));
    }
    const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '6', 'accept-language': getLanguage() });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
    const data = await response.json();
    return data.map(item => {
        const [south, north, west, east] = item.boundingbox.map(Number);
        return { name: item.display_name, lat: Number(item.lat), lng: Number(item.lon), bbox: [west, south, east, north] };
    });
}

function hideResults() {
    results.hidden = true;
}

function render() {
    const query = input.value.trim();
    if (!query) return hideResults();

    const pins = matchPins(query);
    const placeList = query === placeQuery ? places : [];
    let html = '';
    if (pins.length) {
        html += `<div class="result-group">${escapeHtml(t('myPinsResults'))}</div>`;
        html += pins.map(pin => `
            <button type="button" class="result-item" data-pin="${pin.id}">
                <span class="cat-chip" style="--cat:${categoryOf(pin.emoji).color}">${iconSvg(pin.emoji)}</span>
                <span class="main">${escapeHtml(pin.title)}<span class="sub">${escapeHtml(formatDate(pin.visited_at))}</span></span>
            </button>`).join('');
    }
    if (placeList.length) {
        html += `<div class="result-group">${escapeHtml(t('mapResults'))}</div>`;
        html += placeList.map((place, i) => `
            <button type="button" class="result-item" data-place="${i}">
                <span class="main">${escapeHtml(place.name)}</span>
            </button>`).join('');
    }
    if (!html) html = `<div class="result-empty">${escapeHtml(t('noResults'))}</div>`;

    const content = fragment(html);
    content.querySelectorAll('[data-pin]').forEach(button => {
        button.addEventListener('click', () => {
            hideResults();
            focusPin(Number(button.dataset.pin));
        });
    });
    content.querySelectorAll('[data-place]').forEach(button => {
        button.addEventListener('click', () => {
            hideResults();
            const place = placeList[Number(button.dataset.place)];
            if (place.bbox) map.flyToBounds([[place.bbox[1], place.bbox[0]], [place.bbox[3], place.bbox[2]]], { maxZoom: 16 });
            else map.flyTo([place.lat, place.lng], 14);
        });
    });
    results.replaceChildren(content);
    results.hidden = false;
}

export function initSearch() {
    input.addEventListener('input', debounce(render, 120));
    input.addEventListener('focus', render);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideResults();
            input.blur();
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = input.value.trim();
        if (!query) return;
        const seq = ++requestSeq;
        let found = [];
        try {
            found = await searchPlaces(query);
        } catch (err) {
            console.warn('地名搜索失败:', err);
        }
        if (seq !== requestSeq) return;
        placeQuery = query;
        places = found;
        render();
    });

    document.addEventListener('pointerdown', (e) => {
        if (!form.contains(e.target)) hideResults();
    });
}
