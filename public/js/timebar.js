// 时间刻度尺：历史地图和个人时间轴共用，同一时间只属于一个使用者。
// 刻度带在固定的中心指针下滑动：拖动跟手，松手后按速度惯性减速、正好停在整格上，
// 拖过两端有橡皮筋阻力并回弹。Ctrl + 滚轮或双指捏合缩放刻度。
import { t, getLanguage } from './i18n.js';

const bar = document.getElementById('timebar');
const label = document.getElementById('timebar-label');
const tape = document.getElementById('timebar-tape');
const canvas = tape.querySelector('canvas');
const ctx = canvas.getContext('2d');
const playButton = bar.querySelector('[data-action="time-play"]');

const DAY = 86400000;
const MOMENTUM_MS = 325;      // 松手后的滑行距离 = 速度 × 这个时间（接近 iOS 的滚动手感）
const EMIT_MS = 200;          // 拖动 / 滑行中通知使用者的最小间隔，避免连续发请求
const MIN_TICK_PX = 8;        // 最密的小刻度间距
const LABEL_TICK_PX = 64;     // 带文字的大刻度间距
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let owner = null;
let pos = 0;             // 指针所指的位置（连续值，拖过两端时会超出 min / max）
let upp = 1;             // 每像素多少个单位，决定刻度疏密
let shown = null;        // 当前显示（吸附到整格后）的值
let glide = null;        // 滑行动画 { from, target, tau, start }
let playing = false;
let width = 0;
let height = 0;
let frameId = 0;
let lastFrame = 0;
let colors = null;

// ---------- 值的换算 ----------

function clampValue(value) {
    return Math.min(owner.max, Math.max(owner.min, value));
}

// 吸附到整格；历史年份没有公元 0 年：-1 之后直接是 1
function snap(value, direction = 0) {
    const stepped = owner.min + Math.round((clampValue(value) - owner.min) / owner.step) * owner.step;
    const result = clampValue(stepped);
    if (owner.skipZero && result === 0) return direction < 0 ? -1 : 1;
    return result;
}

function zoomLimits() {
    const span = owner.max - owner.min;
    const min = owner.step / 40;                          // 放到最大：一格 40 像素
    const max = Math.max(min, span / Math.max(1, width * 0.6)); // 缩到最小：整段约占 60% 宽度
    return { min, max };
}

function setZoom(value) {
    const { min, max } = zoomLimits();
    upp = Math.min(max, Math.max(min, value));
}

// 拖过两端时的阻力：越往外拉越拉不动，最多拉出约半个刻度带
function rubberBand(overshoot) {
    const px = Math.abs(overshoot) / upp;
    const limit = width / 2;
    const damped = (1 - 1 / (px * 0.55 / limit + 1)) * limit;
    return Math.sign(overshoot) * damped * upp;
}

// ---------- 通知使用者 ----------

let emitTimer = 0;
let lastEmitAt = 0;
let lastEmitted = null;

function emitNow(value) {
    clearTimeout(emitTimer);
    emitTimer = 0;
    lastEmitAt = performance.now();
    if (value === lastEmitted) return;
    lastEmitted = value;
    owner?.onChange(value);
}

// 节流：拖动时每 200 毫秒最多通知一次，停下后再补发最后的值
function emitThrottled(value) {
    const wait = EMIT_MS - (performance.now() - lastEmitAt);
    if (wait <= 0) return emitNow(value);
    clearTimeout(emitTimer);
    emitTimer = setTimeout(() => emitNow(shown), wait);
}

let lastVibrate = 0;

function updateShown({ emit = true, direction = 0 } = {}) {
    const value = snap(pos, direction);
    if (value === shown) return;
    shown = value;
    label.textContent = owner.format(value);
    tape.setAttribute('aria-valuenow', String(value));
    tape.setAttribute('aria-valuetext', label.textContent);
    // 每跨过一格轻轻震一下（只有 Android 支持），刻度太密时不震
    if (dragging && owner.step / upp >= 6 && navigator.vibrate && performance.now() - lastVibrate > 35) {
        navigator.vibrate(1);
        lastVibrate = performance.now();
    }
    if (emit && !playing) emitThrottled(value);
}

// ---------- 动画 ----------

function requestFrame() {
    if (!frameId) frameId = requestAnimationFrame(frame);
}

function frame(now) {
    frameId = 0;
    const dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
    lastFrame = now;
    let active = false;

    if (glide) {
        const elapsed = Math.max(0, now - glide.start);
        let done;
        if (glide.duration) {
            // 定时缓出（点按、键盘、回弹）：先快后慢，按时正好到位
            const p = Math.min(1, elapsed / glide.duration);
            pos = glide.from + (glide.target - glide.from) * (1 - (1 - p) ** 3);
            done = p >= 1;
        } else {
            // 惯性滑行：指数减速，起始速度和松手时一致，越来越慢，最后正好停在目标格上
            pos = glide.target - (glide.target - glide.from) * Math.exp(-elapsed / glide.tau);
            done = Math.abs(glide.target - pos) / upp < 0.3;
        }
        if (done) {
            pos = glide.target;
            glide = null;
            updateShown({ emit: false });
            emitNow(shown);
        } else {
            updateShown({ direction: Math.sign(glide.target - pos) });
            active = true;
        }
    }

    if (playing) {
        const before = Math.floor((pos - owner.min) / owner.playStep);
        pos = Math.min(owner.max, pos + (owner.playStep / 500) * dt); // 速度和以前一样：每 0.5 秒一个 playStep
        updateShown({ direction: 1 });
        // 播放时只在每个 playStep 整格上通知，请求频率和以前的逐格播放相同
        if (Math.floor((pos - owner.min) / owner.playStep) !== before || pos >= owner.max) emitNow(shown);
        if (pos >= owner.max) stop();
        else active = true;
    }

    draw();
    if (active) requestFrame();
    else lastFrame = 0;
}

// 惯性滑行，tau 由松手速度决定
function glideTo(target, tau) {
    if (reducedMotion.matches) return easeTo(target);
    glide = { from: pos, target, tau, start: performance.now() };
    requestFrame();
}

// 定时缓出到目标：距离越远时间略长，但不超过 0.6 秒
function easeTo(target) {
    const px = Math.abs(target - pos) / upp;
    const duration = reducedMotion.matches ? 80 : Math.min(600, 180 + 70 * Math.log2(1 + px / 40));
    glide = { from: pos, target, duration, start: performance.now() };
    requestFrame();
}

// 按"格"移动：连续快速点击会累加，而不是每次从当前滑行的中途算起
function stepBy(count) {
    if (!owner) return;
    stop();
    const base = glide ? glide.target : shown;
    easeTo(snap(base + count * owner.step, Math.sign(count)));
}

// ---------- 绘制 ----------

function readColors() {
    const style = getComputedStyle(document.documentElement);
    return {
        tick: style.getPropertyValue('--text-muted').trim() || '#7a6a5c',
        text: style.getPropertyValue('--text').trim() || '#2b2118',
        accent: style.getPropertyValue('--accent').trim() || '#c8893b'
    };
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    colors = null;
    requestFrame();
});

function resize() {
    const rect = tape.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (owner) setZoom(upp);
    requestFrame();
}
new ResizeObserver(resize).observe(tape);

function lowerBound(list, value) {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (list[mid] < value) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

function draw() {
    if (!owner || !width) return;
    colors ??= readColors();
    ctx.clearRect(0, 0, width, height);
    const center = width / 2;
    const x = (value) => center + (value - pos) / upp;
    const left = Math.max(owner.min, pos - center * upp);
    const right = Math.min(owner.max, pos + center * upp);
    const base = height - 1.5;

    // 标注分布：刻度带底部的小柱子，指针左边（已经到过的时间）用强调色
    if (owner.marks?.length) {
        const bucket = 3;
        for (let bx = Math.max(0, x(owner.min)); bx < Math.min(width, x(owner.max)); bx += bucket) {
            const v0 = pos + (bx - center) * upp;
            const count = lowerBound(owner.marks, v0 + bucket * upp) - lowerBound(owner.marks, v0);
            if (!count) continue;
            const h = Math.min(16, 3 + 3.2 * Math.log2(1 + count));
            ctx.globalAlpha = v0 <= pos ? 0.55 : 0.2;
            ctx.fillStyle = colors.accent;
            ctx.fillRect(bx + 0.5, base - h, bucket - 1, h);
        }
        ctx.globalAlpha = 1;
    }

    // 基线和两端的端点
    ctx.strokeStyle = colors.tick;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.max(0, x(owner.min)), base);
    ctx.lineTo(Math.min(width, x(owner.max)), base);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 刻度：小 / 中 / 大三级，大刻度上方写文字
    const ticks = owner.ticks(left, right, upp);
    const heights = [6, 11, 17];
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    let labelRight = -Infinity;
    for (const tick of ticks) {
        const tx = Math.round(x(tick.value)) + 0.5;
        // 离指针越近颜色越深，形成一点立体的"滚筒"感
        const nearness = 1 - Math.min(1, Math.abs(tx - center) / center);
        ctx.globalAlpha = 0.35 + 0.65 * nearness;
        ctx.strokeStyle = colors.tick;
        ctx.lineWidth = tick.level === 2 ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(tx, base);
        ctx.lineTo(tx, base - heights[tick.level]);
        ctx.stroke();
        if (tick.text) {
            const textWidth = ctx.measureText(tick.text).width;
            if (tx - textWidth / 2 > labelRight + 6) {
                ctx.fillStyle = Math.abs(tx - center) < LABEL_TICK_PX / 2 ? colors.text : colors.tick;
                ctx.fillText(tick.text, tx, base - heights[2] - 5);
                labelRight = tx + textWidth / 2;
            }
        }
    }
    for (const end of [owner.min, owner.max]) {
        const ex = Math.round(x(end)) + 0.5;
        if (ex < 0 || ex > width) continue;
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ex, base);
        ctx.lineTo(ex, base - heights[2]);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

// ---------- 刻度生成 ----------

const YEAR_INTERVALS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

// 按年的刻度（历史地图）：自动挑选合适的间隔
export function yearTicks(labelOf) {
    return (left, right, unitsPerPx) => {
        const pick = (px, from = 0) => YEAR_INTERVALS.find(n => n >= from && n / unitsPerPx >= px) ?? YEAR_INTERVALS.at(-1);
        const minor = pick(MIN_TICK_PX);
        const major = YEAR_INTERVALS.find(n => n % minor === 0 && n / unitsPerPx >= LABEL_TICK_PX) ?? YEAR_INTERVALS.at(-1);
        const mid = YEAR_INTERVALS.find(n => n > minor && n < major && major % n === 0 && n % minor === 0 && n / unitsPerPx >= 22);
        const ticks = [];
        for (let v = Math.ceil(left / minor) * minor; v <= right; v += minor) {
            if (v % major === 0) ticks.push({ value: v, level: 2, text: labelOf(v) });
            else ticks.push({ value: v, level: mid && v % mid === 0 ? 1 : 0 });
        }
        return ticks;
    };
}

// 日历刻度（个人时间轴）：日、月、季度、年……，对齐到本地时间的日期边界
const CALENDAR_UNITS = [
    { unit: 'day', n: 1, approx: DAY },
    { unit: 'month', n: 1, approx: 30.44 * DAY },
    { unit: 'month', n: 3, approx: 91.3 * DAY },
    { unit: 'year', n: 1, approx: 365.25 * DAY },
    { unit: 'year', n: 5, approx: 5 * 365.25 * DAY },
    { unit: 'year', n: 10, approx: 10 * 365.25 * DAY },
    { unit: 'year', n: 50, approx: 50 * 365.25 * DAY }
];

function onBoundary(date, { unit, n }) {
    if (unit === 'day') return true;
    if (date.getDate() !== 1) return false;
    if (unit === 'month') return date.getMonth() % n === 0;
    return date.getMonth() === 0 && date.getFullYear() % n === 0;
}

function floorTo(time, { unit, n }) {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    if (unit === 'month') {
        date.setDate(1);
        date.setMonth(Math.floor(date.getMonth() / n) * n);
    } else if (unit === 'year') {
        date.setMonth(0, 1);
        date.setFullYear(Math.floor(date.getFullYear() / n) * n);
    }
    return date;
}

function advance(date, { unit, n }) {
    if (unit === 'day') date.setDate(date.getDate() + n);
    else if (unit === 'month') date.setMonth(date.getMonth() + n);
    else date.setFullYear(date.getFullYear() + n);
}

export function calendarTicks() {
    return (left, right, unitsPerPx) => {
        const index = (px) => {
            const i = CALENDAR_UNITS.findIndex(u => u.approx / unitsPerPx >= px);
            return i < 0 ? CALENDAR_UNITS.length - 1 : i;
        };
        const minor = CALENDAR_UNITS[index(MIN_TICK_PX)];
        const majorIndex = Math.max(index(LABEL_TICK_PX), CALENDAR_UNITS.indexOf(minor));
        const major = CALENDAR_UNITS[majorIndex];
        const midIndex = index(22);
        const mid = midIndex > CALENDAR_UNITS.indexOf(minor) && midIndex < majorIndex ? CALENDAR_UNITS[midIndex] : null;
        const lang = getLanguage();
        const text = (date) => {
            if (major.unit === 'year' || (major.unit === 'month' && date.getMonth() === 0)) return String(date.getFullYear());
            if (major.unit === 'month') return date.toLocaleDateString(lang, { month: 'short' });
            return date.getDate() === 1
                ? date.toLocaleDateString(lang, { month: 'short', day: 'numeric' })
                : String(date.getDate());
        };
        const ticks = [];
        const date = floorTo(left, minor);
        while (date.getTime() < left) advance(date, minor);
        for (let guard = 0; date.getTime() <= right && guard < 2000; guard++) {
            if (onBoundary(date, major)) ticks.push({ value: date.getTime(), level: 2, text: text(date) });
            else ticks.push({ value: date.getTime(), level: mid && onBoundary(date, mid) ? 1 : 0 });
            advance(date, minor);
        }
        return ticks;
    };
}

// ---------- 手势 ----------

const pointers = new Map(); // pointerId → { x, y }
let dragging = false;
let dragStart = null;       // { x, pos, time }
let samples = [];           // 最近 100 毫秒的 { time, x }，用来算松手时的速度
let pinch = null;           // { distance, upp }
let moved = false;

function pointerDistance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
}

tape.addEventListener('pointerdown', (e) => {
    if (!owner || (e.pointerType === 'mouse' && e.button !== 0)) return;
    try {
        tape.setPointerCapture(e.pointerId); // 拖出刻度带范围也继续跟手
    } catch { /* 个别浏览器对已结束的指针会抛错，不影响拖动 */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stop();
    glide = null;
    if (pointers.size === 2) {
        pinch = { distance: pointerDistance(), upp };
        moved = true;
        return;
    }
    dragging = true;
    moved = false;
    tape.classList.add('dragging');
    dragStart = { x: e.clientX, pos, time: performance.now() };
    samples = [{ time: performance.now(), x: e.clientX }];
});

tape.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
        setZoom(pinch.upp * pinch.distance / pointerDistance());
        requestFrame();
        return;
    }
    if (!dragging) return;
    const dx = e.clientX - dragStart.x;
    if (Math.abs(dx) > 3) moved = true;
    const raw = dragStart.pos - dx * upp;
    // 拖过两端：阻力越来越大
    if (raw < owner.min) pos = owner.min - rubberBand(owner.min - raw);
    else if (raw > owner.max) pos = owner.max + rubberBand(raw - owner.max);
    else pos = raw;
    const now = performance.now();
    samples.push({ time: now, x: e.clientX });
    while (samples.length > 2 && now - samples[0].time > 100) samples.shift();
    updateShown({ direction: -Math.sign(dx) });
    requestFrame();
});

function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pinch) {
        if (pointers.size < 2) pinch = null;
        if (pointers.size === 0) {
            dragging = false;
            tape.classList.remove('dragging');
            easeTo(snap(pos));
        }
        return;
    }
    if (!dragging) return;
    dragging = false;
    tape.classList.remove('dragging');
    const rect = tape.getBoundingClientRect();

    // 轻点：滑到点的那个位置
    if (!moved && performance.now() - dragStart.time < 350) {
        easeTo(snap(pos + (e.clientX - rect.left - width / 2) * upp));
        return;
    }
    // 越界松手：弹回端点
    if (pos < owner.min || pos > owner.max) {
        easeTo(clampValue(pos));
        return;
    }
    // 惯性滑行：按最后 100 毫秒的速度估算停在哪一格
    const first = samples[0];
    const last = samples.at(-1);
    const elapsed = last.time - first.time;
    const velocity = elapsed > 0 && performance.now() - last.time < 80 ? -(last.x - first.x) / elapsed * upp : 0; // 单位 / 毫秒
    const target = snap(pos + velocity * MOMENTUM_MS, Math.sign(velocity));
    const distance = target - pos;
    const tau = Math.abs(velocity) > 1e-9 && Math.sign(distance) === Math.sign(velocity)
        ? Math.min(650, Math.max(120, distance / velocity)) // 太大的话最后几个像素要爬好几秒
        : 160;
    glideTo(target, tau);
}
tape.addEventListener('pointerup', endPointer);
tape.addEventListener('pointercancel', endPointer);

// 滚轮 / 触控板：横向或纵向滚动都能拨动；Ctrl + 滚轮（触控板双指捏合）缩放
let wheelTimer = 0;
tape.addEventListener('wheel', (e) => {
    if (!owner) return;
    e.preventDefault();
    stop();
    glide = null;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? width : 1;
    if (e.ctrlKey) {
        setZoom(upp * Math.exp(e.deltaY * unit * 0.01));
    } else {
        const delta = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
        pos = clampValue(pos + delta * upp);
        updateShown({ direction: Math.sign(delta) });
    }
    requestFrame();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => easeTo(snap(pos)), 120); // 停下后吸附到整格
}, { passive: false });

tape.addEventListener('keydown', (e) => {
    if (!owner) return;
    const big = e.shiftKey ? owner.playStep / owner.step : 1;
    const actions = {
        ArrowLeft: () => stepBy(-big),
        ArrowDown: () => stepBy(-big),
        ArrowRight: () => stepBy(big),
        ArrowUp: () => stepBy(big),
        PageDown: () => stepBy(-owner.playStep / owner.step * 10),
        PageUp: () => stepBy(owner.playStep / owner.step * 10),
        Home: () => { stop(); easeTo(owner.min); },
        End: () => { stop(); easeTo(owner.max); }
    };
    if (!actions[e.key]) return;
    e.preventDefault();
    actions[e.key]();
});

// ---------- 播放 ----------

function updatePlayButton() {
    playButton.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
    playButton.title = t(playing ? 'pause' : 'play');
    playButton.setAttribute('aria-label', playButton.title);
}

function stop() {
    if (!playing) return;
    playing = false;
    updatePlayButton();
    if (owner) easeTo(snap(pos));
}

// 播放是连续平滑地推进刻度带，而不是每 0.5 秒跳一格
function togglePlay() {
    if (!owner) return;
    if (playing) return stop();
    glide = null;
    if (shown >= owner.max) pos = owner.min;
    playing = true;
    updatePlayButton();
    requestFrame();
}

// ---------- 对外接口 ----------

// ticks：刻度生成函数（yearTicks / calendarTicks），marks：要在刻度带上画出分布的值（已排序）
// pxPerStep：初始每格多少像素；不给时自动选，让整段大约是刻度带宽度的 3 倍
export function openTimebar(id, { min, max, value, step = 1, playStep = step, format, onChange, onClose, skipZero = false,
    ticks = yearTicks(String), marks = null, pxPerStep = null }) {
    if (owner && owner.id !== id) closeTimebar();
    playing = false;
    glide = null;
    owner = { id, min, max, step, playStep, format, onChange, onClose, skipZero, ticks, marks };
    bar.hidden = false;
    resize();
    const steps = Math.max(1, (max - min) / step);
    setZoom(step / (pxPerStep ?? Math.min(30, Math.max(1.5, 3 * width / steps))));
    tape.setAttribute('aria-label', t('time'));
    tape.setAttribute('aria-valuemin', String(min));
    tape.setAttribute('aria-valuemax', String(max));
    pos = snap(value);
    shown = null;
    lastEmitted = null;
    updateShown({ emit: false });
    emitNow(shown);
    updatePlayButton();
    requestFrame();
    notify();
}

export function closeTimebar(id) {
    if (!owner || (id && owner.id !== id)) return;
    playing = false;
    glide = null;
    clearTimeout(emitTimer);
    updatePlayButton();
    const closing = owner;
    owner = null;
    bar.hidden = true;
    closing.onClose?.();
    notify();
}

function notify() {
    document.dispatchEvent(new CustomEvent('timebarchange', { detail: { id: owner?.id ?? null } }));
}

export function timebarOwner() {
    return owner?.id ?? null;
}

export function setTimebarValue(value) {
    if (!owner) return;
    stop();
    easeTo(snap(value));
}

export function refreshTimebarLabel() {
    if (owner && shown !== null) label.textContent = owner.format(shown);
    updatePlayButton();
    requestFrame(); // 刻度文字也跟着换语言
}

bar.querySelector('[data-action="time-back"]').addEventListener('click', () => stepBy(-1));
bar.querySelector('[data-action="time-forward"]').addEventListener('click', () => stepBy(1));
bar.querySelector('[data-action="time-close"]').addEventListener('click', () => closeTimebar());
playButton.addEventListener('click', togglePlay);
