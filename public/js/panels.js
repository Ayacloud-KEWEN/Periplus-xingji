// 设置面板、数据面板、个人时间轴
import { settings, currentUser } from './settings.js';
import { api } from './api.js';
import { getStyles, setBasemap, hasMaptiler } from './map.js';
import { getPins, setClustering, setPinsVisible, setDateFilter } from './pins.js';
import { t, LANGUAGES, getLanguage, loadLanguage, formatDate } from './i18n.js';
import { escapeHtml, fragment, panel, toast, toastError } from './ui.js';
import { openTimebar, closeTimebar, timebarOwner, calendarTicks } from './timebar.js';
import { exportBackup } from './io.js';
import { exportMarkdown } from './markdown.js';
import { ensureTracks, trackTimes, setTracksDateFilter } from './tracks.js';

const DAY = 24 * 60 * 60 * 1000;

// ---------- 设置 ----------

function segmented(name, options, activeValue) {
    return `<div class="segmented" data-segment="${name}">${options
        .map(([value, label]) => `<button type="button" data-value="${escapeHtml(value)}" class="${value === activeValue ? 'active' : ''}">${escapeHtml(label)}</button>`)
        .join('')}</div>`;
}

function renderSettings() {
    const styles = getStyles();
    const providerSwitch = hasMaptiler()
        ? segmented('provider', [['osm', 'OpenStreetMap'], ['maptiler', 'MapTiler']], settings.provider)
        : '';

    const body = fragment(`
        <section class="section">
            <h3 class="section-title">${escapeHtml(t('basemap'))}</h3>
            ${providerSwitch}
            <select class="input" data-style style="margin-top:8px">
                ${styles.map((style, i) => `<option value="${i}" ${i === settings.styleIndex ? 'selected' : ''}>${escapeHtml(t(style.key))}</option>`).join('')}
            </select>
        </section>
        <section class="section">
            <h3 class="section-title">${escapeHtml(t('myPinsResults'))}</h3>
            <label class="row"><span>${escapeHtml(t('showPins'))}</span>
                <span class="switch"><input type="checkbox" data-show ${settings.showPins ? 'checked' : ''}><span></span></span></label>
            <label class="row"><span>${escapeHtml(t('clusterMarkers'))}</span>
                <span class="switch"><input type="checkbox" data-cluster ${settings.cluster ? 'checked' : ''}><span></span></span></label>
            <p class="muted">${escapeHtml(t('pinCount', { count: getPins().length }))}</p>
        </section>
        <section class="section">
            <h3 class="section-title">${escapeHtml(t('language'))}</h3>
            ${segmented('language', Object.entries(LANGUAGES), getLanguage())}
        </section>
        <section class="section">
            <h3 class="section-title">${escapeHtml(t('account'))}</h3>
            <p class="muted">${escapeHtml(t('signedInAs', { name: currentUser?.username ?? '' }))}</p>
            <div class="account-actions">
                <a class="btn" href="pages/account.html">${escapeHtml(t(currentUser?.isAdmin ? 'manageAccounts' : 'changePassword'))}</a>
                <button type="button" class="btn" data-logout>${escapeHtml(t('logout'))}</button>
            </div>
        </section>`);
    body.querySelector('[data-logout]').addEventListener('click', logout);

    body.querySelectorAll('[data-segment="provider"] button').forEach(button => {
        button.addEventListener('click', () => {
            setBasemap(button.dataset.value, 0);
            panel.refresh();
        });
    });
    body.querySelector('[data-style]').addEventListener('change', (e) => setBasemap(settings.provider, Number(e.target.value)));
    body.querySelector('[data-show]').addEventListener('change', (e) => setPinsVisible(e.target.checked));
    body.querySelector('[data-cluster]').addEventListener('change', (e) => setClustering(e.target.checked));
    body.querySelectorAll('[data-segment="language"] button').forEach(button => {
        button.addEventListener('click', () => loadLanguage(button.dataset.value).catch(err => toastError('', err)));
    });

    return { title: t('settings'), body };
}

async function logout() {
    try {
        await api.logout();
    } catch (err) {
        return toastError('', err);
    }
    // Service Worker 缓存过这个人的接口数据，退出时清掉，同一台设备换人登录也看不到
    try {
        await caches.delete('mapweb-runtime');
    } catch { /* 不支持 Cache API 时忽略 */ }
    location.href = '/login.html';
}

export function openSettingsPanel() {
    panel.open('settings', renderSettings);
}

// ---------- 数据 ----------

function renderData() {
    const item = (act, icon, title, hint) => `
        <button class="list-button" data-act="${act}">
            <span class="icon"><svg><use href="#${icon}"/></svg></span>
            <span class="main"><strong>${escapeHtml(t(title))}</strong><small>${escapeHtml(t(hint))}</small></span>
        </button>`;
    const body = fragment(`
        ${item('photos', 'i-camera', 'importPhotos', 'importPhotosHint')}
        ${item('export', 'i-download', 'exportZip', 'exportZipHint')}
        ${item('markdown', 'i-review', 'exportMarkdown', 'exportMarkdownHint')}
        ${item('import', 'i-upload', 'importFile', 'importFileHint')}
        <p class="muted">${escapeHtml(t('pinCount', { count: getPins().length }))}</p>`);

    body.querySelector('[data-act="photos"]').addEventListener('click', () => document.getElementById('photo-input').click());
    body.querySelector('[data-act="export"]').addEventListener('click', exportBackup);
    body.querySelector('[data-act="markdown"]').addEventListener('click', exportMarkdown);
    body.querySelector('[data-act="import"]').addEventListener('click', () => document.getElementById('backup-input').click());
    return { title: t('data'), body };
}

export function openDataPanel() {
    panel.open('data', renderData);
}

// ---------- 个人时间轴 ----------

export async function togglePersonalTimeline() {
    if (timebarOwner() === 'timeline') return closeTimebar('timeline');

    await ensureTracks(); // 轨迹的日期也要算进时间轴的范围
    const pinTimes = getPins().map(pin => new Date(pin.visited_at).getTime()).filter(Number.isFinite);
    const times = [...pinTimes, ...trackTimes()];
    if (!times.length) return toast(t('noPinsForTimeline'));

    const min = Math.min(...times);
    // 滑块按天步进，把终点对齐到整天，保证最后一个标注能显示出来
    const days = Math.max(1, Math.ceil((Math.max(...times) - min) / DAY));
    const max = min + days * DAY;
    openTimebar('timeline', {
        min,
        max,
        value: max,
        step: DAY,
        playStep: Math.max(1, Math.round(days / 100)) * DAY,
        ticks: calendarTicks(),
        marks: times.sort((a, b) => a - b), // 刻度带底部画出每段时间有多少标注和轨迹
        format: (value) => formatDate(value),
        // 标注和轨迹一起跟着时间轴走
        onChange: (value) => {
            setDateFilter(value);
            setTracksDateFilter(value);
        },
        onClose: () => {
            setDateFilter(null);
            setTracksDateFilter(null);
        }
    });
}
