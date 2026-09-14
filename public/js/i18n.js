// 多语言：界面文案在 lang/{zh,en,fr}.json
export const LANGUAGES = { zh: '中文', en: 'English', fr: 'Français' };
const STORAGE_KEY = 'mapweb.lang';

let dict = {};
let language = 'zh';

export function getLanguage() {
    return language;
}

export function initialLanguage() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved in LANGUAGES) return saved;
    } catch { /* 浏览器禁用存储时忽略 */ }
    const browser = (navigator.language || 'zh').split('-')[0];
    return browser in LANGUAGES ? browser : 'en';
}

export async function loadLanguage(code) {
    const response = await fetch(`lang/${code}.json`);
    if (!response.ok) throw new Error(`language ${code} not found`);
    dict = await response.json();
    language = code;
    document.documentElement.lang = code;
    try {
        localStorage.setItem(STORAGE_KEY, code);
    } catch { /* 忽略 */ }
    applyStaticTranslations();
    window.dispatchEvent(new CustomEvent('languagechange'));
}

export function t(key, params) {
    const text = typeof dict[key] === 'string' ? dict[key] : key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? params[name] : match));
}

// 特殊地区（config/special-regions.json）的名称，比如 north-cyprus → { zh: 北塞浦路斯, ... }
let specialNames = {};

export function setSpecialRegions(list) {
    specialNames = Object.fromEntries((list || []).map(region => [region.code, region.name]));
}

// 国家 / 地区名称（按当前语言），比如 cn → 中国、hk → 中国香港特别行政区
export function regionName(code, fallback) {
    if (!code) return fallback || '';
    if (specialNames[code]) return localized(specialNames[code]) || fallback || code;
    try {
        return new Intl.DisplayNames([language], { type: 'region' }).of(code.toUpperCase()) || fallback || code;
    } catch {
        return fallback || code;
    }
}

// 语言文件里的分组文案，比如 continents.AF
export function lookup(group, key) {
    return dict[group]?.[key] ?? '';
}

export function categoryLabel(emoji) {
    return dict.categories?.[emoji] ?? '';
}

export function categoryEmojis() {
    return Object.keys(dict.categories || {});
}

// 旅行家数据里的 { en, zh, fr } 文本
export function localized(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return value[language] || value.en || Object.values(value)[0] || '';
}

export function formatDate(value, { withTime = false } = {}) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(language, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
    });
}

export function formatYear(year) {
    return year < 0 ? t('yearBC', { year: -year }) : t('yearAD', { year });
}

// 静态 HTML 上的 data-i18n / data-i18n-title / data-i18n-placeholder
function applyStaticTranslations() {
    for (const node of document.querySelectorAll('[data-i18n]')) {
        node.textContent = t(node.dataset.i18n);
    }
    for (const node of document.querySelectorAll('[data-i18n-title]')) {
        node.title = t(node.dataset.i18nTitle);
        node.setAttribute('aria-label', node.title);
    }
    for (const node of document.querySelectorAll('[data-i18n-placeholder]')) {
        node.placeholder = t(node.dataset.i18nPlaceholder);
    }
}
