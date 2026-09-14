// 解析 GPX：用浏览器自带的 XML 解析器，不需要额外的库。
// 佳明等设备导出的 GPX 里，一次活动是一个 <trk>，中途暂停会分成多个 <trkseg>。
const SPORT_WORDS = {
    running: ['run', 'running', 'jog', 'trail_running', 'trail running', '跑'],
    hiking: ['hike', 'hiking', 'trekking', 'mountaineering', '徒步', '登山'],
    walking: ['walk', 'walking', 'stroll', '步行', '散步'],
    cycling: ['bike', 'biking', 'cycling', 'cycle', 'ride', 'road_biking', 'mountain_biking', '骑行', '骑车'],
    // 佳明的公开水域游泳导出的 type 是 open_water / swimming
    swimming: ['swim', 'swimming', 'open_water', 'openwater', 'open water', '游泳']
};

// 配速色带：每隔这么远取一个点，算这一段的平均速度
const PACE_SAMPLE_M = 50;

// GPX 里的运动类型写法五花八门（running、trail_running、Biking…），按关键词归到五类
function sportOf(...texts) {
    const text = texts.filter(Boolean).join(' ').toLowerCase();
    for (const [sport, words] of Object.entries(SPORT_WORDS)) {
        if (words.some(word => text.includes(word))) return sport;
    }
    return 'other';
}

function distanceM(a, b) {
    const rad = Math.PI / 180;
    const s = Math.sin((b[1] - a[1]) * rad / 2) ** 2
        + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(s));
}

// 爬升：高度每次上升超过 3 米才算，滤掉 GPS 高度的抖动
function ascentOf(elevations) {
    let ascent = 0;
    let base = null;
    for (const ele of elevations) {
        if (ele === null) continue;
        if (base === null) base = ele;
        if (ele > base + 3) {
            ascent += ele - base;
            base = ele;
        } else if (ele < base) {
            base = ele;
        }
    }
    return ascent;
}

// 把一段轨迹按距离抽稀成 [经度, 纬度, 速度]，速度是从上一个取样点到这里的平均值（米/秒）。
// 没有时间戳的轨迹算不出速度，返回 null
function paceSamples(points) {
    if (points.length < 2 || points.some(point => !point.time)) return null;
    const samples = [[points[0].lng, points[0].lat, 0]];
    let last = points[0];
    let distance = 0;
    for (let i = 1; i < points.length; i++) {
        distance += distanceM([last.lng, last.lat], [points[i].lng, points[i].lat]);
        const seconds = (points[i].time - last.time) / 1000;
        if (distance >= PACE_SAMPLE_M || i === points.length - 1) {
            // 停下来休息时速度接近 0，照实记录；时间倒退等异常数据当作 0
            const speed = seconds > 0 ? distance / seconds : 0;
            samples.push([points[i].lng, points[i].lat, speed]);
            last = points[i];
            distance = 0;
        }
    }
    return samples.length >= 2 ? samples : null;
}

// 返回 { name, sport, segments, paceProfile, startedAt, endedAt, distance, ascent, points }
export function parseGpx(text, filename = '') {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('GPX 文件格式不正确');

    const segments = [];
    const paceProfile = [];
    const elevations = [];
    const times = [];
    let distance = 0;
    let points = 0;

    for (const seg of doc.querySelectorAll('trkseg')) {
        const coords = [];
        const detailed = [];
        for (const pt of seg.querySelectorAll('trkpt')) {
            const lat = Number(pt.getAttribute('lat'));
            const lng = Number(pt.getAttribute('lon'));
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            const previous = coords.at(-1);
            if (previous) distance += distanceM(previous, [lng, lat]);
            coords.push([lng, lat]);
            points++;
            const ele = pt.querySelector('ele')?.textContent;
            elevations.push(ele ? Number(ele) : null);
            const time = pt.querySelector('time')?.textContent;
            if (time) times.push(time);
            detailed.push({ lng, lat, time: time ? new Date(time) : null });
        }
        if (coords.length >= 2) {
            segments.push(coords);
            const samples = paceSamples(detailed);
            if (samples) paceProfile.push(samples);
        }
    }
    if (!segments.length) throw new Error('GPX 里没有找到轨迹点');

    // 没有时间戳的轨迹（有些工具会去掉）用文件修改时间兜底，调用方传进来
    const startedAt = times[0] || null;
    const endedAt = times.at(-1) || null;
    const trk = doc.querySelector('trk');
    const name = (trk?.querySelector('name')?.textContent || filename.replace(/\.gpx$/i, '')).trim().slice(0, 200);
    const sport = sportOf(trk?.querySelector('type')?.textContent, doc.querySelector('metadata > name')?.textContent, name, filename);

    return {
        name, sport, segments, startedAt, endedAt, distance, points,
        ascent: ascentOf(elevations),
        paceProfile: paceProfile.length === segments.length ? paceProfile : null
    };
}
