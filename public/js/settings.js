// 保存在浏览器里的个人设置
const STORAGE_KEY = 'mapweb.settings';

const defaults = {
    provider: 'osm',      // 'osm' | 'maptiler'
    styleIndex: 0,
    cluster: true,
    showPins: true,
    view: null,           // 上次的地图位置 { center: [lat, lng], zoom }
    tripGapDays: 3,       // 我的旅程：到访时间相隔超过几天算新的一次旅程
    lightenLevel: 0,      // 点亮地图：0 按国家，1 按省 / 州
    toolbarCollapsed: false // 左侧工具栏是否收起
};

function read() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
        return {};
    }
}

export const settings = { ...defaults, ...read() };

// 当前登录的用户 { id, username, isAdmin }，启动时由 main.js 设置
export let currentUser = null;
export function setCurrentUser(user) {
    currentUser = user;
}

export function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch { /* 浏览器禁用存储时忽略 */ }
}
