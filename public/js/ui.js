// 通用界面工具：转义、提示、确认框、侧边面板、按需加载脚本
import { t } from './i18n.js';

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// 用 HTML 字符串创建 DocumentFragment；插值内容必须先经过 escapeHtml
export function fragment(html) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content;
}

export function debounce(fn, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

// --- 提示 ---
const toastsEl = document.getElementById('toasts');

export function toast(message, { type = 'info', duration = 3000, action } = {}) {
    const node = document.createElement('div');
    node.className = type === 'error' ? 'toast error' : 'toast';
    const text = document.createElement('span');
    text.textContent = message;
    node.append(text);

    let timer = null;
    const close = () => {
        clearTimeout(timer);
        node.remove();
    };
    const closeAfter = (ms) => {
        clearTimeout(timer);
        timer = setTimeout(close, ms);
    };

    if (action) {
        const button = document.createElement('button');
        button.textContent = action.label;
        button.addEventListener('click', () => {
            action.onClick();
            close();
        });
        node.append(button);
    }

    toastsEl.append(node);
    if (duration) closeAfter(duration);
    return { update: (msg) => { text.textContent = msg; }, close, closeAfter };
}

export function toastError(prefix, err) {
    return toast(prefix + (err?.message || err), { type: 'error', duration: 5000 });
}

// --- 确认框 ---
const dialog = document.getElementById('confirm-dialog');
const dialogMessage = document.getElementById('confirm-message');
const dialogOk = dialog.querySelector('button[value="ok"]');

export function confirmDialog(message, okLabel = t('delete')) {
    dialogMessage.textContent = message;
    dialogOk.textContent = okLabel;
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise(resolve => {
        // 正常情况下 <dialog> 关闭时会派发 close 事件；但个别浏览器内核不派发（应用内的预览浏览器就是），
        // 那样等 close 会一直等下去，"删除"点了没反应。所以同时监听表单提交和 Esc，谁先到算谁。
        const controller = new AbortController();
        const finish = (confirmed) => {
            controller.abort();
            resolve(confirmed);
        };
        const options = { signal: controller.signal };
        dialog.addEventListener('close', () => finish(dialog.returnValue === 'ok'), options);
        dialog.addEventListener('cancel', () => finish(false), options);
        dialog.addEventListener('submit', (e) => {
            const value = e.submitter?.value ?? dialog.returnValue;
            setTimeout(() => finish(value === 'ok'), 0); // 等浏览器把对话框关掉再返回
        }, options);
    });
}

// --- 侧边面板 ---
// 同一时间只显示一个面板。render() 返回 { title, body }，语言切换时会重新调用。
const panelEl = document.getElementById('panel');
const panelTitle = document.getElementById('panel-title');
const panelBody = document.getElementById('panel-body');
let current = null;

function notifyPanelChange() {
    document.dispatchEvent(new CustomEvent('panelchange', { detail: { id: current?.id ?? null } }));
}

export const panel = {
    get id() {
        return current?.id ?? null;
    },

    open(id, render, { onClose } = {}) {
        if (current && current.id !== id) current.onClose?.();
        current = { id, render, onClose };
        panelEl.hidden = false;
        this.refresh();
        panelBody.scrollTop = 0;
        notifyPanelChange();
    },

    refresh() {
        if (!current) return;
        const { title, body } = current.render();
        panelTitle.textContent = title;
        panelBody.replaceChildren(body);
    },

    close() {
        if (!current) return;
        const closing = current;
        current = null;
        panelEl.hidden = true;
        panelBody.replaceChildren();
        closing.onClose?.();
        notifyPanelChange();
    }
};

// --- 按需加载第三方脚本（照片处理、zip 等较大的库只在用到时加载）---
const loadedScripts = new Map();

export function loadScript(src) {
    if (!loadedScripts.has(src)) {
        loadedScripts.set(src, new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = () => {
                loadedScripts.delete(src);
                reject(new Error(`failed to load ${src}`));
            };
            document.head.append(script);
        }));
    }
    return loadedScripts.get(src);
}
