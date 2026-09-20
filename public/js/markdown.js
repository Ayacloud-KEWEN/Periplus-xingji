// 导出旅程记录：把所有标注和运动轨迹按时间顺序整理成一份 Markdown 文字，方便存档、打印或贴到笔记里
import { api } from './api.js';
import { getPins } from './pins.js';
import { categoryOf } from './categories.js';
import { t, formatDate, regionName, categoryLabel, localized, getLanguage } from './i18n.js';
import { toast, toastError } from './ui.js';
import { settings } from './settings.js';
import { buildTrips, tripTitle, reloadTripOverrides } from './trips.js';
import { formatDistance, formatDuration, formatPace, durationOf } from './tracks.js';

// 标题、描述里的 * _ # | 等字符会被当成 Markdown 语法，先转义；换行在单行字段里合并成空格
const SPECIAL = /([\\`*_[\]#|<>])/g;
const inline = (text) => String(text ?? '').replace(SPECIAL, '\\$1').replace(/\s*\r?\n\s*/g, ' ').trim();
const quote = (text) => String(text).trim().split(/\r?\n/).map(line => `> ${line.replace(SPECIAL, '\\$1')}`).join('\n');
const timeOf = (value) => new Date(value).getTime();
const yearOf = (value) => new Date(value).getFullYear();
// 字段名后的冒号：中文用全角，英文、法文用半角加空格
const sep = () => (getLanguage() === 'zh' ? '：' : ': ');

function placeText(place) {
    if (!place) return t('placePending');
    if (!place.countryCode) return t('placeUnknown');
    const city = place.city !== place.state ? place.city : null; // 直辖市不重复
    return [regionName(place.countryCode, place.country), place.state, city, place.county, place.town]
        .filter(Boolean).join(' · ');
}

// 按年份分组，保持组内顺序
function groupByYear(items, dateOf) {
    const groups = new Map();
    for (const item of items) {
        const year = yearOf(dateOf(item));
        if (!groups.has(year)) groups.set(year, []);
        groups.get(year).push(item);
    }
    return groups;
}

function summaryLines(pins, tracks, stats) {
    const lines = [t('mdSummary', { pins: pins.length, tracks: tracks.length })];
    const times = [...pins.map(pin => timeOf(pin.visited_at)), ...tracks.map(track => timeOf(track.started_at))]
        .filter(Number.isFinite);
    if (times.length) {
        lines.push(t('mdRange', { from: formatDate(Math.min(...times)), to: formatDate(Math.max(...times)) }));
    }
    if (stats) {
        const counts = [
            ['statContinents', stats.counts.continent],
            ['statCountries', stats.counts.country],
            ['statStates', stats.counts.state],
            ['statCities', stats.counts.city],
            ['statCounties', stats.counts.county],
            ['statTowns', stats.counts.town],
            ['statHeritage', stats.heritage.visited.length]
        ].map(([key, value]) => `${t(key)} ${value}`).join(' · ');
        lines.push(counts);
    }
    return lines.map(line => `- ${inline(line)}`).join('\n');
}

function pinsSection(pins, heritageByPin, tripByPin) {
    if (!pins.length) return t('mdNone');
    const parts = [];
    for (const [year, list] of groupByYear(pins, pin => pin.visited_at)) {
        parts.push(`### ${year}\n\n*${inline(t('mdYearPins', { count: list.length }))}*`);
        for (const pin of list) {
            const lines = [
                `#### ${inline(formatDate(pin.visited_at, { withTime: true }))} · ${inline(pin.title || t('newPinTitle'))}`,
                '',
                `- **${inline(t('mdPlace'))}**${sep()}${inline(placeText(pin.place))}`,
                `- **${inline(t('mdCoords'))}**${sep()}${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`,
                `- **${inline(t('category'))}**${sep()}${inline(categoryLabel(categoryOf(pin.emoji).emoji))}`
            ];
            const sites = heritageByPin.get(pin.id);
            if (sites) lines.push(`- **${inline(t('statHeritage'))}**${sep()}${sites.map(inline).join('；')}`);
            const trip = tripByPin.get(pin.id);
            if (trip) lines.push(`- **${inline(t('mdTrip'))}**${sep()}${inline(trip)}`);
            if (pin.photos?.length) lines.push(`- **${inline(t('photo'))}**${sep()}${inline(t('mdPhotoCount', { count: pin.photos.length }))}`);
            if (pin.description?.trim()) lines.push('', quote(pin.description));
            parts.push(lines.join('\n'));
        }
    }
    return parts.join('\n\n');
}

function tracksSection(tracks) {
    if (!tracks.length) return t('mdNone');
    const header = [t('mdDate'), t('mdName'), t('mdSport'), t('tracksDistance'), t('tracksDuration'), t('tracksPace'), t('tracksAscent')];
    const parts = [];
    for (const [year, list] of groupByYear(tracks, track => track.started_at)) {
        const km = (list.reduce((sum, track) => sum + track.distance_m, 0) / 1000).toFixed(1);
        const rows = list.map(track => [
            formatDate(track.started_at, { withTime: true }),
            track.name || t(`sport_${track.sport}`),
            t(`sport_${track.sport}`),
            formatDistance(track.distance_m),
            formatDuration(durationOf(track)) || '—',
            formatPace(track) || '—',
            track.ascent_m ? `${Math.round(track.ascent_m)} m` : '—'
        ].map(inline));
        parts.push([
            `### ${year}`,
            '',
            `*${inline(t('mdYearTracks', { count: list.length, km }))}*`,
            '',
            `| ${header.map(inline).join(' | ')} |`,
            `|${header.map(() => ' --- ').join('|')}|`,
            ...rows.map(row => `| ${row.join(' | ')} |`)
        ].join('\n'));
    }
    return parts.join('\n\n');
}

function download(text, filename) {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

export async function exportMarkdown() {
    const status = toast(t('mdExporting'), { duration: 0 });
    try {
        // 轨迹和世界遗产要问服务器；世界遗产读不到时照样导出，只是不标注遗产
        const [tracks, stats] = await Promise.all([api.tracks(), api.stats().catch(() => null)]);
        await reloadTripOverrides(); // 旅程的名字、拆分、合并以服务器上的为准

        const pins = [...getPins()]
            .filter(pin => Number.isFinite(timeOf(pin.visited_at)))
            .sort((a, b) => timeOf(a.visited_at) - timeOf(b.visited_at) || a.id - b.id);
        const sortedTracks = [...tracks].sort((a, b) => timeOf(a.started_at) - timeOf(b.started_at));

        const heritageByPin = new Map();
        for (const site of stats?.heritage?.visited ?? []) {
            for (const id of site.pins) {
                const pinId = Number(id);
                if (!heritageByPin.has(pinId)) heritageByPin.set(pinId, []);
                heritageByPin.get(pinId).push(localized(site.name) || site.id);
            }
        }
        const tripByPin = new Map();
        for (const trip of buildTrips(pins, settings.tripGapDays)) {
            for (const pin of trip.pins) tripByPin.set(pin.id, tripTitle(trip));
        }

        const today = new Date().toISOString().slice(0, 10);
        const text = [
            `# ${inline(t('mdTitle'))}`,
            '',
            `*${inline(t('mdExportedAt', { date: formatDate(Date.now(), { withTime: true }) }))}*`,
            '',
            `## ${inline(t('mdFootprint'))}`,
            '',
            summaryLines(pins, sortedTracks, stats),
            '',
            `## ${inline(t('mdPins'))}`,
            '',
            pinsSection(pins, heritageByPin, tripByPin),
            '',
            `## ${inline(t('mdTracks'))}`,
            '',
            tracksSection(sortedTracks),
            ''
        ].join('\n');

        const filename = `Periplus_Journal_${today}.md`;
        download(text, filename);
        status.close();
        toast(t('mdExported', { file: filename }));
    } catch (err) {
        status.close();
        toastError(t('saveFailed'), err);
    }
}
