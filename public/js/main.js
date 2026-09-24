// 应用入口
import { loadLanguage, initialLanguage, t } from './i18n.js';
import { api } from './api.js';
import { initMap, locate } from './map.js';
import { initPins, loadPins, toggleAddMode, checkIn } from './pins.js';
import { initSearch } from './search.js';
import { enableHistory, disableHistory, isHistoryActive } from './history.js';
import { openJourneysPanel } from './journeys.js';
import { openStatsPanel } from './stats.js';
import { openTripsPanel } from './trips.js';
import { openReviewPanel } from './review.js';
import { openGalleryPanel } from './gallery.js';
import { toggleLighten, isLightenActive } from './lighten.js';
import { toggleTracks, isTracksActive, importTracks } from './tracks.js';
import { openSettingsPanel, openDataPanel, togglePersonalTimeline } from './panels.js';
import { importPhotos, importBackup } from './io.js';
import { panel, toast, toastError } from './ui.js';
import { refreshTimebarLabel, timebarOwner } from './timebar.js';
import { settings, saveSettings, setCurrentUser } from './settings.js';

const PANELS = { settings: openSettingsPanel, journeys: openJourneysPanel, trips: openTripsPanel,
    review: openReviewPanel, stats: openStatsPanel, data: openDataPanel, gallery: openGalleryPanel };

const ACTIONS = {
    history: () => (isHistoryActive() ? disableHistory() : enableHistory()),
    lighten: toggleLighten,
    tracks: toggleTracks,
    timeline: togglePersonalTimeline,
    'toggle-toolbar': () => setToolbarCollapsed(!settings.toolbarCollapsed),
    locate,
    'add-pin': toggleAddMode,
    checkin: checkIn,
    'panel-close': () => panel.close()
};

// 收起时只留熊猫按钮，状态记在本地设置里，下次打开保持
function setToolbarCollapsed(collapsed) {
    settings.toolbarCollapsed = collapsed;
    saveSettings();
    document.querySelector('.toolbar').classList.toggle('collapsed', collapsed);
    document.querySelector('.toolbar .brand').setAttribute('aria-expanded', String(!collapsed));
}

function updateToolStates() {
    for (const button of document.querySelectorAll('.toolbar [data-action]')) {
        const action = button.dataset.action;
        if (action === 'add-pin' || action === 'toggle-toolbar' || action === 'checkin') continue; // 添加模式的高亮由 pins.js 管

        let active = panel.id === action;
        if (action === 'history' || action === 'timeline') active = timebarOwner() === action;
        if (action === 'lighten') active = isLightenActive(); // 图层开着就算激活，面板可以关掉
        if (action === 'tracks') active = isTracksActive();
        button.classList.toggle('active', active);
    }
}

function bindActions() {
    document.addEventListener('click', (e) => {
        const button = e.target.closest('[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        if (action in PANELS) {
            if (panel.id === action) panel.close();
            else PANELS[action]();
        } else {
            ACTIONS[action]?.();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !document.querySelector('dialog[open]')) panel.close();
    });

    document.addEventListener('panelchange', updateToolStates);
    document.addEventListener('timebarchange', updateToolStates);
    document.addEventListener('lightenchange', updateToolStates);
    document.addEventListener('trackschange', updateToolStates);
    window.addEventListener('languagechange', () => {
        panel.refresh();
        refreshTimebarLabel();
    });

    const photoInput = document.getElementById('photo-input');
    photoInput.addEventListener('change', async () => {
        const files = [...photoInput.files];
        photoInput.value = '';
        await importPhotos(files);
        if (panel.id === 'data') panel.refresh();
    });

    const gpxInput = document.getElementById('gpx-input');
    gpxInput.addEventListener('change', async () => {
        const files = [...gpxInput.files];
        gpxInput.value = '';
        await importTracks(files);
    });

    const backupInput = document.getElementById('backup-input');
    backupInput.addEventListener('change', async () => {
        const file = backupInput.files[0];
        backupInput.value = '';
        if (file) await importBackup(file);
        if (panel.id === 'data') panel.refresh();
    });
}

// Service Worker 只在安全上下文（HTTPS 或 localhost）中可用
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    // 只在用户点了"刷新"之后才重新加载。
    // 首次安装时 clients.claim() 也会触发 controllerchange，那时不能刷新，否则会吞掉用户的操作。
    let refreshRequested = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshRequested) return;
        refreshRequested = false;
        location.reload();
    });

    navigator.serviceWorker.register('sw.js').then((registration) => {
        registration.addEventListener('updatefound', () => {
            const worker = registration.installing;
            worker?.addEventListener('statechange', () => {
                if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                    toast(t('newVersionReady'), {
                        duration: 0,
                        action: {
                            label: t('refresh'),
                            onClick: () => {
                                refreshRequested = true;
                                worker.postMessage('skipWaiting');
                            }
                        }
                    });
                }
            });
        });
    }).catch(err => console.warn('Service Worker 注册失败:', err));
}

async function main() {
    await loadLanguage(initialLanguage()).catch(() => loadLanguage('en'));

    // 多用户版：先确认登录了，没登录 api.js 会跳到登录页。
    // 断网等其他错误照常往下走，离线时还能看 Service Worker 缓存的数据
    try {
        setCurrentUser(await api.me());
    } catch (err) {
        if (err.status === 401) return;
    }

    let config = { maptilerKey: '' };
    try {
        config = await api.config();
    } catch (err) {
        toastError('', err);
    }

    initMap(config.maptilerKey);
    initPins();
    initSearch();
    bindActions();
    setToolbarCollapsed(settings.toolbarCollapsed);
    updateToolStates();

    try {
        await loadPins();
    } catch (err) {
        toastError('', err);
    }
    registerServiceWorker();
}

main();
