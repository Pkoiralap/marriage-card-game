// Lightweight on-screen debug HUD for diagnosing mobile/touch issues.
// Enable with the URL param ?hud=1, or it auto-enables on the first touch.
// pointer-events:none so it never blocks the game.
class Hud {
    constructor() {
        this.el = null;
        this.enabled = false;
        this.data = {};
    }

    enable() {
        if (this.enabled) return;
        this.enabled = true;
        const el = document.createElement('div');
        el.id = 'debug-hud';
        Object.assign(el.style, {
            position: 'fixed', top: '6px', left: '6px', zIndex: '99999',
            background: 'rgba(0,0,0,0.78)', color: '#0f0',
            font: '11px/1.45 monospace', padding: '6px 8px',
            borderRadius: '6px', maxWidth: '78vw', whiteSpace: 'pre',
            pointerEvents: 'none',
        });
        document.body.appendChild(el);
        this.el = el;
        this.render();
    }

    set(key, value) {
        if (!this.enabled) return;
        this.data[key] = value;
        this.render();
    }

    render() {
        if (!this.el) return;
        this.el.textContent = Object.entries(this.data)
            .map(([k, v]) => `${k}: ${v}`).join('\n');
    }
}

export const hud = new Hud();
