// 后台逆地理编码：给还没有行政区信息的标注查询所在的国家、省、市、县、镇。
// 使用 OpenStreetMap Nominatim，遵守其使用政策：每秒最多 1 次请求、标明 User-Agent、
// 结果永久保存在数据库里，每个标注只查一次（坐标改变后才会重新查）。
import { pool } from './db.js';
import { config } from './config.js';
import { continentOf } from './continents.js';
import { CN_PROVINCES, CN_MUNICIPALITIES, CN_SPECIAL_REGIONS } from './cn-provinces.js';

const BASE_URL = 'https://nominatim.openstreetmap.org';
// Nominatim 的使用政策要求 User-Agent 能标识出应用，附上项目地址
const USER_AGENT = 'Periplus/2.0 (self-hosted personal map; https://github.com/Ayacloud-KEWEN/Periplus-xingji)';
const LANGUAGE = 'zh-CN,zh,en';
const INTERVAL_MS = 1100;                 // 任意两次请求至少间隔 1.1 秒
const IDLE_MS = 60 * 1000;                // 没有待查询的标注时，每分钟检查一次
const RETRY_AFTER_ERROR_MS = 5 * 60 * 1000;

let timer = null;
let running = false;
let wakeRequested = false; // 查询进行中又有新标注：查完当前这个立刻接着查
let lastRequestAt = 0;
let lastError = null;

// OSM 里有的名称是"简体;繁体"两个写法，只取第一个
function clean(value) {
    return value ? String(value).split(';')[0].trim() || null : null;
}

// 把 Nominatim 的 address 整理成统一的几个层级
export function normalizeAddress(address = {}, displayName = null) {
    let countryCode = (address.country_code || '').toLowerCase() || null;
    const lvl4 = address['ISO3166-2-lvl4'];
    const specialRegion = CN_SPECIAL_REGIONS[address['ISO3166-2-lvl3']];
    let state, city, county, town;

    if (specialRegion) {
        // 香港、澳门：按"国家和地区"单独统计，下面分区域（如九龙）和区（如油尖旺区）
        countryCode = specialRegion;
        state = clean(address.region || address.state);
        city = null;
        county = clean(address.suburb || address.city_district);
        town = null;
    } else if (countryCode === 'cn') {
        // OSM 的中国地址：state 是省，city 是县级（区、县、县级市），town/suburb 是乡镇街道。
        // 地级市不在返回结果里，由 geocodeNext 另外查询；直辖市的市级就是它本身
        state = clean(address.state) || CN_PROVINCES[lvl4] || null;
        county = clean(address.city || address.county || address.district);
        city = CN_MUNICIPALITIES.has(lvl4) ? state : null;
        town = clean(address.town || address.township || address.suburb);
    } else {
        state = clean(address.state || address.province || address.region);
        city = clean(address.city || address.municipality);
        county = clean(address.county || address.city_district || address.district || address.borough);
        if (county === city) county = null; // 比如巴黎：city 和 city_district 都是"巴黎"
        town = clean(address.town || address.village || address.suburb);
    }

    return {
        continent: continentOf(countryCode),
        countryCode,
        country: clean(address.country),
        state,
        city,
        county,
        town,
        display: displayName
    };
}

// 所有请求都经过这里，保证间隔
async function nominatim(pathAndQuery) {
    const wait = lastRequestAt + INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    const separator = pathAndQuery.includes('?') ? '&' : '?';
    const email = config.geocoderEmail ? `&email=${encodeURIComponent(config.geocoderEmail)}` : '';
    const response = await fetch(`${BASE_URL}${pathAndQuery}${separator}accept-language=${encodeURIComponent(LANGUAGE)}${email}`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15000)
    });
    // 限流、服务器故障、拒绝访问（403 等）都当作暂时的：抛错稍后重试，不记录结果。
    // 以前除 429 / 5xx 外都返回 null，被当成"海上等查不到的地方"写进数据库，标注就永久变成无法定位了。
    // 只有 404（对象不存在）才算确实没有结果
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Nominatim ${response.status}`);
    return response.json();
}

// 中国的地级市：查逆地理编码结果对象的上级行政区，取 admin_level 5。
// 按"省 + 县"缓存在数据库里，同一个县只查一次
async function cnPrefecture(result, province, county) {
    const { rows } = await pool.query('SELECT prefecture FROM cn_prefectures WHERE province = $1 AND county = $2', [province, county]);
    if (rows.length) return rows[0].prefecture;
    if (!result.osm_type || !result.osm_id) return null;

    const osmType = result.osm_type[0].toUpperCase();
    const details = await nominatim(`/details?osmtype=${osmType}&osmid=${result.osm_id}&addressdetails=1&format=json`);
    if (!details) return null; // 没拿到详情时不缓存，免得这个县以后都没有地级市
    const level5 = details?.address?.find(part => String(part.admin_level) === '5' && part.isaddress);
    const prefecture = clean(level5?.localname);
    await pool.query(
        'INSERT INTO cn_prefectures (province, county, prefecture) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [province, county, prefecture]
    );
    return prefecture;
}

async function lookupPlace(lat, lng) {
    const result = await nominatim(`/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`);
    // 海上等无法定位的地点返回 error，记为空结果，不再重复查询
    if (!result || result.error) return {};
    const place = normalizeAddress(result.address, result.display_name);
    if (place.countryCode === 'cn' && !place.city && place.state && place.county) {
        place.city = await cnPrefecture(result, place.state, place.county);
    }
    return place;
}

// 查询一个待处理的标注；没有待处理的返回 false。
// 最新的标注优先：刚添加的地点能马上看到结果，不用排在一大批旧标注后面
async function geocodeNext() {
    const { rows } = await pool.query(
        `SELECT id, ST_Y(geom) AS lat, ST_X(geom) AS lng FROM points
         WHERE place IS NULL ORDER BY id DESC LIMIT 1`
    );
    if (rows.length === 0) return false;
    const { id, lat, lng } = rows[0];
    const place = await lookupPlace(lat, lng);
    // 查询期间标注可能被移动了，或者用户手动填了地区：这两种情况都丢弃这次结果
    await pool.query(
        `UPDATE points SET place = $1, place_checked_at = now()
         WHERE id = $2 AND ST_Y(geom) = $3 AND ST_X(geom) = $4 AND place IS NULL`,
        [JSON.stringify(place), id, lat, lng]
    );
    return true;
}

async function tick() {
    if (running) return;
    running = true;
    let delay = 0;
    try {
        if (!(await geocodeNext())) delay = IDLE_MS;
        lastError = null;
    } catch (err) {
        lastError = err.message;
        delay = RETRY_AFTER_ERROR_MS;
        console.warn('逆地理编码失败，5 分钟后重试:', err.message);
    } finally {
        running = false;
        if (wakeRequested && !lastError) delay = 0;
        wakeRequested = false;
        timer = setTimeout(tick, delay); // 请求间隔由 nominatim() 保证
    }
}

export function startGeocoder() {
    if (!config.geocoder) return;
    timer = setTimeout(tick, 3000);
}

export function stopGeocoder() {
    clearTimeout(timer);
}

// 新建或移动标注后调用：尽快开始查询。
// 以前正在查询或者出过错时会直接忽略，新标注要等下一轮定时检查（最长 1 分钟，出错后 5 分钟）
export function wakeGeocoder() {
    if (!config.geocoder) return;
    if (running) {
        wakeRequested = true;
        return;
    }
    // 出过错时不要频繁重试，但距离上次请求超过 30 秒就允许新标注触发一次
    if (lastError && Date.now() - lastRequestAt < 30000) return;
    clearTimeout(timer);
    timer = setTimeout(tick, 0);
}

export function geocoderStatus() {
    return { enabled: config.geocoder, lastError };
}
