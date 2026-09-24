// 后端 API 封装
import { t } from './i18n.js';

// 没登录或登录过期：带上当前地址去登录页，登录完再回来
export function goToLogin() {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
}

async function request(method, url, body) {
    const options = { method, headers: {} };
    if (body instanceof FormData) {
        options.body = body;
    } else if (body !== undefined) {
        options.headers['content-type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    let response;
    try {
        response = await fetch(url, options);
    } catch {
        throw new Error(t('networkError'));
    }

    if (response.status === 401) {
        goToLogin();
        throw Object.assign(new Error(t('loginRequired')), { status: 401 });
    }
    if (!response.ok) {
        let message = `${response.status} ${response.statusText}`;
        try {
            message = (await response.json()).error || message;
        } catch { /* 响应不是 JSON */ }
        throw new Error(message);
    }
    return response.status === 204 ? null : response.json();
}

export const api = {
    me: () => request('GET', '/api/auth/me'),
    logout: () => request('POST', '/api/auth/logout'),

    config: () => request('GET', '/api/config'),
    countries: () => request('GET', '/api/countries'),

    listPoints: () => request('GET', '/api/points'),
    getPoints: (ids) => request('GET', `/api/points?ids=${ids.join(',')}`),
    createPoint: (data) => request('POST', '/api/points', data),
    createPoints: (list) => request('POST', '/api/points/batch', list),
    updatePoint: (id, data) => request('PATCH', `/api/points/${id}`, data),
    deletePoint: (id) => request('DELETE', `/api/points/${id}`),

    // 给标注添加一张照片（排在最后），返回更新后的标注
    addPhoto(id, blob, filename = 'photo.jpg') {
        const form = new FormData();
        form.append('image', blob, filename);
        return request('POST', `/api/points/${id}/photos`, form);
    },
    removePhoto: (id, photoId) => request('DELETE', `/api/points/${id}/photos/${photoId}`),

    history: (year) => request('GET', `/api/history?year=${year}`),
    historyRange: () => request('GET', '/api/history/range'),
    historyAt: (lat, lng) => request('GET', `/api/history/at?lat=${lat}&lng=${lng}`),
    historyNames: () => request('GET', '/api/history/names'),

    regions: (level, countries) => request('GET', `/api/regions?level=${level}${countries ? `&country=${countries.join(',')}` : ''}`),

    stats: () => request('GET', '/api/stats'),

    tracks: () => request('GET', '/api/tracks'),
    createTrack: (data) => request('POST', '/api/tracks', data),
    deleteTrack: (id) => request('DELETE', `/api/tracks/${id}`),

    getSettings: (key) => request('GET', `/api/settings/${key}`),
    saveSettings: (key, value) => request('PUT', `/api/settings/${key}`, value)
};
