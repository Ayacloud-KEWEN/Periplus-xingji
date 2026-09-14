// 年度回顾：把一年里的标注、旅程、轨迹、世界遗产汇总成一张卡片，可以导出成图片
import { api } from './api.js';
import { getPins, focusPin } from './pins.js';
import { settings } from './settings.js';
import { t, formatDate, regionName, getLanguage } from './i18n.js';
import { escapeHtml, fragment, panel, toast, toastError } from './ui.js';
import { buildTrips } from './trips.js';

let year = null;
let tracks = [];
let heritage = [];

const yearOf = (value) => new Date(value).getFullYear();

// ---------- 汇总 ----------

// 某一级地区在这一年是不是"第一次去"：把所有标注按时间排序，第一次出现的那年算新的
function firstVisits(pins, keyOf) {
    const first = new Map();
    for (const pin of [...pins].sort((a, b) => new Date(a.visited_at) - new Date(b.visited_at))) {
        const key = keyOf(pin);
        if (key && !first.has(key)) first.set(key, { year: yearOf(pin.visited_at), label: key });
    }
    return first;
}

function summarize(pins, targetYear) {
    const inYear = pins.filter(pin => yearOf(pin.visited_at) === targetYear);
    const countryKey = (pin) => (pin.place?.countryCode
        ? regionName(pin.place.countryCode, pin.place.country) : null);
    const stateKey = (pin) => (pin.place?.state ? `${pin.place.countryCode}|${pin.place.state}` : null);
    const cityKey = (pin) => (pin.place?.city ? `${pin.place.countryCode}|${pin.place.city}` : null);

    const newOf = (keyOf, pretty = (key) => key) => [...firstVisits(pins, keyOf).values()]
        .filter(entry => entry.year === targetYear)
        .map(entry => pretty(entry.label));

    const trips = buildTrips(pins, settings.tripGapDays).filter(trip => yearOf(trip.start) === targetYear);
    const yearTracks = tracks.filter(track => yearOf(track.started_at) === targetYear);
    const bySport = new Map();
    for (const track of yearTracks) {
        bySport.set(track.sport, (bySport.get(track.sport) || 0) + track.distance_m);
    }

    return {
        year: targetYear,
        pins: inYear.length,
        photos: inYear.reduce((sum, pin) => sum + (pin.photos?.length || 0), 0),
        countries: newOf(countryKey),
        states: newOf(stateKey).length,
        cities: newOf(cityKey, (key) => key.split('|')[1]),
        trips,
        tripKm: trips.reduce((sum, trip) => sum + trip.km, 0),
        longestTrip: trips.slice().sort((a, b) => b.days - a.days)[0] || null,
        tracks: yearTracks,
        trackKm: yearTracks.reduce((sum, track) => sum + track.distance_m, 0) / 1000,
        bySport: [...bySport.entries()].sort((a, b) => b[1] - a[1]),
        heritage: heritage.filter(site => site.firstVisit && yearOf(site.firstVisit) === targetYear),
        busiestMonth: busiestMonth(inYear),
        firstPin: inYear[0] || null,
        lastPin: inYear.at(-1) || null
    };
}

function busiestMonth(pins) {
    const months = new Array(12).fill(0);
    for (const pin of pins) months[new Date(pin.visited_at).getMonth()]++;
    const best = months.indexOf(Math.max(...months));
    if (!months[best]) return null;
    const name = new Intl.DateTimeFormat(getLanguage(), { month: 'long' }).format(new Date(2000, best, 1));
    return { name, count: months[best] };
}

function availableYears(pins) {
    const years = new Set([...pins.map(pin => yearOf(pin.visited_at)), ...tracks.map(track => yearOf(track.started_at))]);
    return [...years].filter(Number.isFinite).sort((a, b) => b - a);
}

// ---------- 导出图片 ----------

// 和"点亮地图"的海报一样，自己在 canvas 上画，不截图
function exportCard(data) {
    const W = 1080;
    const H = 1350; // 手机屏幕比例，方便分享
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const font = (size, weight = 400) => `${weight} ${size}px "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif`;

    // 名字太长时截断，免得画到卡片外面
    const fit = (text, maxWidth) => {
        if (ctx.measureText(text).width <= maxWidth) return text;
        let cut = text;
        while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
        return `${cut}…`;
    };
    const contentWidth = W - 160;

    ctx.fillStyle = '#f7f3ec';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#3d2b1f';
    ctx.font = font(120, 700);
    ctx.fillText(String(data.year), 80, 200);
    ctx.fillStyle = '#7a6a5c';
    ctx.font = font(34);
    ctx.fillText(t('review'), 80, 260);

    const rows = [
        [t('reviewPins'), String(data.pins)],
        [t('reviewNewCountries'), String(data.countries.length)],
        [t('reviewNewCities'), String(data.cities.length)],
        [t('reviewTrips'), String(data.trips.length)],
        [t('reviewTripKm'), `${data.tripKm.toLocaleString()} km`],
        [t('reviewPhotos'), String(data.photos)]
    ];
    if (data.tracks.length) rows.push([t('reviewTracks'), `${data.tracks.length} · ${data.trackKm.toFixed(0)} km`]);
    if (data.heritage.length) rows.push([t('reviewHeritage'), String(data.heritage.length)]);

    let y = 380;
    for (const [label, value] of rows) {
        ctx.fillStyle = '#7a6a5c';
        ctx.font = font(32);
        ctx.fillText(label, 80, y);
        ctx.fillStyle = '#3d2b1f';
        ctx.font = font(56, 700);
        ctx.textAlign = 'right';
        ctx.fillText(value, W - 80, y);
        ctx.textAlign = 'left';
        ctx.strokeStyle = 'rgba(61, 43, 31, 0.12)';
        ctx.beginPath();
        ctx.moveTo(80, y + 28);
        ctx.lineTo(W - 80, y + 28);
        ctx.stroke();
        y += 100;
    }

    // 去过的国家和最长的一次旅程
    if (data.countries.length) {
        ctx.fillStyle = '#7a6a5c';
        ctx.font = font(30);
        ctx.fillText(t('reviewNewCountries'), 80, y + 30);
        ctx.fillStyle = '#c8893b';
        ctx.font = font(36, 700);
        ctx.fillText(fit(data.countries.slice(0, 6).join(' · '), contentWidth), 80, y + 84);
        y += 130;
    }
    if (data.longestTrip) {
        ctx.fillStyle = '#7a6a5c';
        ctx.font = font(30);
        ctx.fillText(t('reviewLongestTrip'), 80, y + 30);
        ctx.fillStyle = '#3d2b1f';
        ctx.font = font(36, 700);
        ctx.fillText(fit(tripLabel(data.longestTrip), contentWidth), 80, y + 84);
    }

    ctx.fillStyle = '#a99a8b';
    ctx.font = font(26);
    ctx.fillText(`Periplus · 行纪 · ${new Date().toISOString().slice(0, 10)}`, 80, H - 70);

    canvas.toBlob((blob) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Periplus_${data.year}.png`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    }, 'image/png');
}

function tripLabel(trip) {
    const title = trip.name || trip.places.join(' · ') || formatDate(trip.start);
    return `${title}（${t('reviewDays', { days: trip.days })}）`;
}

// ---------- 面板 ----------

function render() {
    const pins = getPins();
    const years = availableYears(pins);
    if (!years.length) {
        return { title: t('review'), body: fragment(`<p class="muted">${escapeHtml(t('reviewNone'))}</p>`) };
    }
    if (!years.includes(year)) year = years[0];
    const data = summarize(pins, year);

    const index = years.indexOf(year);
    const tile = (value, label) => `<div class="stat-tile"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
    const tiles = [
        tile(data.pins, t('reviewPins')),
        tile(data.countries.length, t('reviewNewCountries')),
        tile(data.states, t('reviewNewStates')),
        tile(data.cities.length, t('reviewNewCities')),
        tile(data.trips.length, t('reviewTrips')),
        tile(data.photos, t('reviewPhotos'))
    ].join('');

    const line = (label, value) => (value
        ? `<div class="review-line"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>` : '');
    const sportLine = data.bySport
        .map(([sport, meters]) => `${t(`sport_${sport}`)} ${(meters / 1000).toFixed(0)} km`).join(' · ');

    const tripItems = data.trips.map(trip => `
        <button type="button" class="stat-item" data-pin="${trip.pins[0].id}">
            <span class="main"><strong>${escapeHtml(trip.name || trip.places.join(' · ') || formatDate(trip.start))}</strong>
                <small>${escapeHtml(t('tripStats', { days: trip.days, stops: trip.stops.length, km: trip.km.toLocaleString() }))}</small></span>
        </button>`).join('');

    const heritageItems = data.heritage.map(site => `<li>${escapeHtml(site.name?.zh || site.name?.en || site.id)}</li>`).join('');

    const body = fragment(`
        <div class="review-years">
            <button type="button" class="icon-btn" data-year="${years[index + 1] ?? ''}" ${years[index + 1] === undefined ? 'disabled' : ''}><svg><use href="#i-left"/></svg></button>
            <strong>${year}</strong>
            <button type="button" class="icon-btn" data-year="${years[index - 1] ?? ''}" ${years[index - 1] === undefined ? 'disabled' : ''}><svg><use href="#i-right"/></svg></button>
        </div>
        <div class="stat-grid">${tiles}</div>
        ${data.countries.length ? `<p class="review-countries">${data.countries.map(name => `<span>${escapeHtml(name)}</span>`).join('')}</p>` : ''}
        ${line(t('reviewTripKm'), data.tripKm ? `${data.tripKm.toLocaleString()} km` : '')}
        ${line(t('reviewLongestTrip'), data.longestTrip ? tripLabel(data.longestTrip) : '')}
        ${line(t('reviewTracks'), data.tracks.length ? `${data.tracks.length} · ${data.trackKm.toFixed(0)} km${sportLine ? ` （${sportLine}）` : ''}` : '')}
        ${line(t('reviewHeritage'), data.heritage.length ? String(data.heritage.length) : '')}
        ${heritageItems ? `<ul class="review-list">${heritageItems}</ul>` : ''}
        ${line(t('reviewBusiestMonth'), data.busiestMonth ? t('reviewMonthCount', { month: data.busiestMonth.name, count: data.busiestMonth.count }) : '')}
        ${data.trips.length ? `<h3 class="section-title">${escapeHtml(t('trips'))}</h3><div class="stat-list">${tripItems}</div>` : ''}
        <div class="actions">
            <span class="spacer"></span>
            <button type="button" class="btn btn-primary" data-act="export"><svg><use href="#i-download"/></svg>${escapeHtml(t('reviewExport'))}</button>
        </div>`);

    body.querySelectorAll('[data-year]').forEach(button => {
        button.addEventListener('click', () => {
            year = Number(button.dataset.year);
            panel.refresh();
        });
    });
    body.querySelectorAll('[data-pin]').forEach(button => {
        button.addEventListener('click', () => focusPin(Number(button.dataset.pin)));
    });
    body.querySelector('[data-act="export"]').addEventListener('click', () => {
        exportCard(data);
        toast(t('reviewExported'));
    });
    return { title: `${year} · ${t('review')}`, body };
}

export async function openReviewPanel() {
    panel.open('review', render);
    // 轨迹和世界遗产要问服务器。每次打开都重新读：期间可能导入、删除过轨迹，只读一次的话要刷新页面才对。
    // 先用上次的数据显示，拿到后再刷新；读失败时保留上次的数据
    const [trackList, stats] = await Promise.all([
        api.tracks().catch(() => null),
        api.stats().catch(() => null)
    ]);
    if (trackList) tracks = trackList;
    if (stats) heritage = stats.heritage?.visited ?? [];
    if (panel.id === 'review') panel.refresh();
}
