// 照片墙：把所有标注的照片按到访时间倒序铺开，可以按分类筛选
import { getPins, focusPin } from './pins.js';
import { CATEGORIES, categoryOf, iconSvg } from './categories.js';
import { t, categoryLabel, formatDate } from './i18n.js';
import { escapeHtml, fragment, panel } from './ui.js';

// 选中的分类（emoji）；空集合表示全部。关掉面板再打开时保留，方便看完一张照片回来接着看
const selected = new Set();

function collect() {
    const items = [];
    for (const pin of getPins()) {
        // 旧数据里不在列表中的 emoji 按"通用"算，和地图上的图标一致
        const emoji = categoryOf(pin.emoji).emoji;
        for (const photo of pin.photos || []) items.push({ pin, photo, emoji });
    }
    // 没有到访时间的排在最后
    const time = (item) => (item.pin.visited_at ? new Date(item.pin.visited_at).getTime() : -Infinity);
    return items.sort((a, b) => time(b) - time(a));
}

function render() {
    const items = collect();
    const counts = new Map();
    for (const item of items) counts.set(item.emoji, (counts.get(item.emoji) || 0) + 1);
    // 已经没有照片的分类不再算作选中，否则会一直显示空白
    for (const emoji of selected) if (!counts.has(emoji)) selected.delete(emoji);

    const shown = selected.size ? items.filter(item => selected.has(item.emoji)) : items;
    // 只列出有照片的分类，顺序和编辑标注时的分类列表一致
    const chips = CATEGORIES.filter(category => counts.has(category.emoji)).map(category => `
        <button type="button" class="gallery-chip ${selected.has(category.emoji) ? 'active' : ''}" data-cat="${category.emoji}" style="--cat:${category.color}">
            ${iconSvg(category.emoji)}<span>${escapeHtml(categoryLabel(category.emoji))}</span><small>${counts.get(category.emoji)}</small>
        </button>`).join('');
    const grid = shown.map(({ pin, photo }) => {
        const caption = [pin.title, pin.visited_at ? formatDate(pin.visited_at) : ''].filter(Boolean).join(' · ');
        return `<button type="button" class="gallery-item" data-pin="${pin.id}" title="${escapeHtml(caption)}">
            <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(pin.title || '')}" loading="lazy" decoding="async">
        </button>`;
    }).join('');

    const body = fragment(items.length ? `
        <div class="gallery-filters">
            <button type="button" class="gallery-chip ${selected.size ? '' : 'active'}" data-cat=""><span>${escapeHtml(t('galleryAll'))}</span><small>${items.length}</small></button>
            ${chips}
        </div>
        <p class="muted small">${escapeHtml(t('galleryCount', { count: shown.length }))}</p>
        <div class="gallery-grid">${grid}</div>`
        : `<p class="muted">${escapeHtml(t('galleryEmpty'))}</p>`);

    body.querySelectorAll('[data-cat]').forEach(button => {
        button.addEventListener('click', () => {
            const emoji = button.dataset.cat;
            if (!emoji) selected.clear();
            else if (selected.has(emoji)) selected.delete(emoji);
            else selected.add(emoji);
            panel.refresh();
        });
    });
    body.querySelectorAll('[data-pin]').forEach(button => {
        button.addEventListener('click', () => focusPin(Number(button.dataset.pin)));
    });
    return { title: t('gallery'), body };
}

export function openGalleryPanel() {
    panel.open('gallery', render);
}
