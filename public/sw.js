// Service Worker：缓存应用本身，服务器暂时连不上时也能打开并查看上次的标注
// 发布新版本时修改 VERSION，页面会提示刷新
const VERSION = 'v2.20.0';
const SHELL_CACHE = `mapweb-shell-${VERSION}`;
const RUNTIME_CACHE = 'mapweb-runtime';

const SHELL_FILES = [
    './',
    'index.html',
    'manifest.webmanifest',
    'css/app.css',
    'js/main.js', 'js/api.js', 'js/i18n.js', 'js/ui.js', 'js/settings.js', 'js/map.js', 'js/pins.js',
    'js/photos.js', 'js/timebar.js', 'js/history.js', 'js/journeys.js', 'js/search.js', 'js/io.js', 'js/panels.js',
    'js/categories.js', 'js/stats.js', 'js/route.js', 'js/trips.js', 'js/lighten.js', 'js/tracks.js', 'js/gpx.js', 'js/review.js', 'js/gallery.js', 'js/markdown.js',
    'lang/zh.json', 'lang/en.json', 'lang/fr.json',
    'vendor/leaflet/leaflet.css', 'vendor/leaflet/leaflet.js',
    'vendor/markercluster/leaflet.markercluster.js', 'vendor/markercluster/MarkerCluster.css', 'vendor/markercluster/MarkerCluster.Default.css',
    'img/ayacloud.png', 'img/mapweb-192.png', 'favicon.ico'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_FILES)));
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith('mapweb-shell-') && key !== SHELL_CACHE).map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') self.skipWaiting();
});

// 网络优先，失败时用缓存。
// 不接管：跨域请求（瓦片、地名搜索）、历史疆域数据（体积大）、上传的照片（由浏览器 HTTP 缓存负责）
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/history') || url.pathname.startsWith('/uploads/')) return;

    event.respondWith((async () => {
        try {
            const response = await fetch(request);
            if (response.ok) {
                const cache = await caches.open(RUNTIME_CACHE);
                cache.put(request, response.clone());
            }
            return response;
        } catch (err) {
            const cached = await caches.match(request);
            if (cached) return cached;
            throw err;
        }
    })());
});
