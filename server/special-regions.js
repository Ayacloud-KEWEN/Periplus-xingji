// "特殊地区"规则：把 OpenStreetMap 归入某个国家、但想单独统计的地方分出来（比如北塞浦路斯、索马里兰、西撒哈拉）。
// 规则写在 config/special-regions.json，修改后重启服务生效。
// 规则在读取时实时套用，不改数据库里存的识别结果，所以增删规则后不需要重新查询行政区。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './config.js';
import { CONTINENT_CODES } from './continents.js';

const RULES_FILE = path.join(ROOT_DIR, 'config', 'special-regions.json');

const normalized = (list) => (list || []).map(value => String(value).trim().toLowerCase());

// 返回问题描述；没问题返回 null
function validate(rule) {
    if (!rule || typeof rule !== 'object') return '格式不对';
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(rule.code || '')) return 'code 只能用小写字母、数字和连字符';
    if (!rule.name || typeof rule.name !== 'object' || !Object.values(rule.name).some(value => typeof value === 'string' && value)) {
        return '缺少 name';
    }
    if (!CONTINENT_CODES.includes(rule.continent)) return `continent 必须是 ${CONTINENT_CODES.join(' / ')} 之一`;
    const match = rule.match || {};
    if (match.bbox && !(Array.isArray(match.bbox) && match.bbox.length === 4 && match.bbox.every(Number.isFinite))) {
        return 'bbox 应为 [西经度, 南纬度, 东经度, 北纬度]';
    }
    if (!match.countryCodes?.length && !match.countryNames?.length && !match.stateNames?.length && !match.bbox) {
        return 'match 至少要有一个条件';
    }
    return null;
}

function loadRules() {
    let config;
    try {
        config = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'));
    } catch (err) {
        if (err.code !== 'ENOENT') console.warn('特殊地区规则读取失败，本次不使用规则:', err.message);
        return [];
    }

    const rules = [];
    for (const rule of config.rules || []) {
        const problem = validate(rule);
        if (problem) {
            console.warn(`特殊地区规则 "${rule?.code ?? '?'}" 已忽略：${problem}`);
            continue;
        }
        rules.push({
            code: rule.code,
            name: rule.name,
            continent: rule.continent,
            countryCodes: normalized(rule.match.countryCodes),
            countryNames: normalized(rule.match.countryNames),
            stateNames: normalized(rule.match.stateNames),
            bbox: rule.match.bbox || null
        });
    }
    if (rules.length) console.log(`已加载 ${rules.length} 条特殊地区规则：${rules.map(rule => rule.code).join('、')}`);
    return rules;
}

const rules = loadRules();

// 规则里写了的条件都要满足；同一个条件列了多个值时，满足其中一个即可
function matches(rule, place, lat, lng) {
    if (rule.countryCodes.length && !rule.countryCodes.includes(String(place.countryCode).toLowerCase())) return false;
    if (rule.countryNames.length && !rule.countryNames.includes(String(place.country || '').trim().toLowerCase())) return false;
    if (rule.stateNames.length && !rule.stateNames.includes(String(place.state || '').trim().toLowerCase())) return false;
    if (rule.bbox) {
        const [west, south, east, north] = rule.bbox;
        if (!(lng >= west && lng <= east && lat >= south && lat <= north)) return false;
    }
    return true;
}

// 自动识别的结果套用规则；手动修改的地区保持用户自己的选择
export function resolvePlace(place, lat, lng, manual) {
    if (!place || !place.countryCode || manual || rules.length === 0) return place;
    const rule = rules.find(candidate => matches(candidate, place, lat, lng));
    return rule ? { ...place, countryCode: rule.code, continent: rule.continent } : place;
}

// 给前端显示名称和国家下拉列表用
export function specialRegions() {
    return rules.map(({ code, name, continent }) => ({ code, name, continent }));
}

export function specialContinent(code) {
    return rules.find(rule => rule.code === code)?.continent || null;
}
