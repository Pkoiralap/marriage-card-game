// Lightweight toast notifications.
//
// Exposes `window.toast(message, type?, opts?)` so any module (incl. other
// feature agents that feature-detect `window.toast`) can use it.
//   type: 'info' (default) | 'success' | 'error' | 'warn'
//   opts: { duration?: number (ms, default 3200) }
//
// Falls back gracefully: if the #toast-container element is missing it logs to
// the console rather than throwing.

const VALID_TYPES = new Set(['info', 'success', 'error', 'warn']);

function getContainer() {
    let c = document.getElementById('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        c.setAttribute('aria-live', 'polite');
        c.setAttribute('aria-atomic', 'true');
        document.body.appendChild(c);
    }
    return c;
}

export function toast(message, type = 'info', opts = {}) {
    if (message == null) return;
    const text = String(message);
    if (typeof document === 'undefined') { console.log(`[toast] ${text}`); return; }

    const kind = VALID_TYPES.has(type) ? type : 'info';
    const duration = Number.isFinite(opts.duration) ? opts.duration : 3200;

    const container = getContainer();
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.textContent = text;
    container.appendChild(el);

    const remove = () => {
        if (!el.parentNode) return;
        el.classList.add('toast-hide');
        el.addEventListener('animationend', () => el.remove(), { once: true });
        // Safety net in case animationend doesn't fire.
        setTimeout(() => el.remove(), 400);
    };

    el.addEventListener('click', remove);
    setTimeout(remove, duration);
    return el;
}

// Expose globally for non-module callers and cross-feature feature-detection.
if (typeof window !== 'undefined') {
    window.toast = toast;
}
