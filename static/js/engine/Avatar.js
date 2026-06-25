// Procedural player avatars built from Three.js primitives (no external assets,
// works with the CDN r128 core + no build step). 10 distinct presets with
// faces, headwear and eyewear, plus idle animation and a gesture/chat API that
// later networked emotes/chat can drive.
//
// Conventions: an avatar is built facing +Z. The Renderer positions it around
// the table and yaws it to face the centre. update(t) is called every frame.

const SKIN = {
    light: 0xf3c69a, tan: 0xe0ac69, brown: 0xc68642, dark: 0x8d5524,
    pale: 0xffdbac, alien: 0x7ac74f, robot: 0xb0bec5,
};
const SHIRT = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xecf0f1, 0x34495e, 0xff69b4];

// 10 curated, visually-distinct avatars. Each preset stays data-only so new
// looks (or swapping in downloaded art) is just an edit here.
export const AVATAR_PRESETS = [
    { skin: SKIN.light, shirt: 0xe74c3c, hat: 'cap',      hatColor: 0xc0392b, eyewear: 'none',       eye: 0x222222 },
    { skin: SKIN.tan,   shirt: 0x3498db, hat: 'beanie',   hatColor: 0x2c3e50, eyewear: 'round',      eye: 0x4e342e },
    { skin: SKIN.brown, shirt: 0x2ecc71, hat: 'none',     hatColor: 0x000000, eyewear: 'sunglasses', eye: 0x222222, hair: 0x1c1c1c },
    { skin: SKIN.pale,  shirt: 0xf1c40f, hat: 'tophat',   hatColor: 0x1b1b1b, eyewear: 'round',      eye: 0x2e5cb8 },
    { skin: SKIN.dark,  shirt: 0x9b59b6, hat: 'headband', hatColor: 0xe67e22, eyewear: 'goggles',    eye: 0x222222 },
    { skin: SKIN.alien, shirt: 0x1abc9c, hat: 'antenna',  hatColor: 0x16a085, eyewear: 'none',       eye: 0x101010, alien: true },
    { skin: SKIN.robot, shirt: 0x34495e, hat: 'helmet',   hatColor: 0x7f8c8d, eyewear: 'goggles',    eye: 0x00e5ff, robot: true },
    { skin: SKIN.light, shirt: 0xe67e22, hat: 'cowboy',   hatColor: 0x8d5a2b, eyewear: 'none',       eye: 0x222222, mustache: 0x3b2f2f },
    { skin: SKIN.tan,   shirt: 0xff69b4, hat: 'crown',    hatColor: 0xffd700, eyewear: 'sunglasses', eye: 0x222222 },
    { skin: SKIN.pale,  shirt: 0xecf0f1, hat: 'party',    hatColor: 0xe84393, eyewear: 'eyepatch',   eye: 0x222222 },
];

// Cheap deterministic hash -> [0,1) so each avatar idles out of phase.
function hash01(n) {
    let h = (n + 1) * 374761393;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Avatar {
    constructor(seed = 0, scale = 1.6) {
        this.seed = seed;
        this.preset = AVATAR_PRESETS[((seed % AVATAR_PRESETS.length) + AVATAR_PRESETS.length) % AVATAR_PRESETS.length];
        this.phase = hash01(seed) * Math.PI * 2;
        this.disposables = [];   // geometries/materials to free on dispose()

        this.group = new THREE.Group();
        this.group.scale.setScalar(scale);

        this._build();

        // Gesture state (future networked emotes set this via playGesture()).
        this.gesture = null;
        this.gestureStart = 0;
        this.gestureDur = 0;

        // Blink timing.
        this._nextBlink = 1 + hash01(seed + 7) * 4;
        this._blinkUntil = 0;
        this.labelSprite = null;
    }

    _mat(color, opts = {}) {
        const m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.7, metalness: opts.metal ?? 0.0, ...opts });
        this.disposables.push(m);
        return m;
    }
    _geo(g) { this.disposables.push(g); return g; }
    _mesh(geo, mat) {
        const m = new THREE.Mesh(this._geo(geo), mat);
        m.castShadow = true;
        return m;
    }

    _build() {
        const P = this.preset;
        const skinMat = this._mat(P.skin, { rough: P.robot ? 0.4 : 0.85, metal: P.robot ? 0.5 : 0 });

        // Torso.
        this.body = this._mesh(new THREE.CylinderGeometry(0.7, 0.95, 2.1, 16), this._mat(P.shirt, { rough: 0.8 }));
        this.body.position.y = 1.05;
        this.group.add(this.body);

        // Head pivots at the neck so nods/looks rotate the whole face rig.
        this.headPivot = new THREE.Group();
        this.headPivot.position.y = 2.1;
        this.group.add(this.headPivot);

        const headGeo = P.robot ? new THREE.BoxGeometry(1.5, 1.4, 1.4) : new THREE.SphereGeometry(0.9, 24, 24);
        this.head = this._mesh(headGeo, skinMat);
        this.head.position.y = 0.55;
        this.headPivot.add(this.head);

        const R = 0.9;
        const fz = R * 0.82;   // face depth (+Z front)

        // Eyes (white + pupil), grouped so we can blink (scale Y).
        this.eyes = new THREE.Group();
        this.head.add(this.eyes);
        const eyeR = P.alien ? 0.32 : 0.18;
        for (const sx of [-1, 1]) {
            const white = this._mesh(new THREE.SphereGeometry(eyeR, 12, 12), this._mat(0xffffff, { rough: 0.3 }));
            white.position.set(sx * 0.33, 0.08, fz);
            const pupil = this._mesh(new THREE.SphereGeometry(eyeR * 0.55, 10, 10),
                this._mat(P.eye, { emissive: P.robot ? P.eye : 0x000000, emissiveIntensity: P.robot ? 0.8 : 0 }));
            pupil.position.set(sx * 0.33, 0.08, fz + eyeR * 0.6);
            this.eyes.add(white, pupil);
        }

        // Mouth.
        const mouth = this._mesh(new THREE.BoxGeometry(0.4, 0.07, 0.05), this._mat(0x6d3b3b));
        mouth.position.set(0, -0.3, fz + 0.05);
        this.head.add(mouth);

        if (P.hair) {
            const hair = this._mesh(new THREE.SphereGeometry(R * 1.02, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), this._mat(P.hair));
            hair.position.y = 0.12;
            this.head.add(hair);
        }
        if (P.mustache) {
            const m = this._mesh(new THREE.BoxGeometry(0.55, 0.12, 0.08), this._mat(P.mustache));
            m.position.set(0, -0.18, fz + 0.02);
            this.head.add(m);
        }

        this._buildHeadwear(P, R);
        this._buildEyewear(P, R, fz);
        this._buildArms(skinMat, P);
    }

    _buildHeadwear(P, R) {
        const grp = new THREE.Group();
        this.head.add(grp);
        const hat = this._mat(P.hatColor, { rough: 0.6, metal: P.hat === 'crown' || P.hat === 'helmet' ? 0.7 : 0 });
        const add = (geo, x, y, z, rx) => { const m = this._mesh(geo, hat); m.position.set(x, y, z); if (rx) m.rotation.x = rx; grp.add(m); return m; };

        switch (P.hat) {
            case 'cap':
                add(new THREE.SphereGeometry(R * 1.02, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), 0, 0.3, 0);
                add(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 16, 1, false, 0, Math.PI), 0, 0.28, R * 0.7, Math.PI / 2);
                break;
            case 'beanie':
                add(new THREE.SphereGeometry(R * 1.05, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), 0, 0.25, 0);
                add(new THREE.TorusGeometry(R * 0.92, 0.12, 8, 20), 0, 0.18, 0, Math.PI / 2);
                break;
            case 'tophat':
                add(new THREE.CylinderGeometry(R * 1.2, R * 1.2, 0.08, 20), 0, 0.55, 0);
                add(new THREE.CylinderGeometry(0.62, 0.62, 1.0, 20), 0, 1.05, 0);
                break;
            case 'helmet':
                add(new THREE.SphereGeometry(R * 1.08, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), 0, 0.2, 0);
                break;
            case 'cowboy':
                add(new THREE.CylinderGeometry(R * 1.5, R * 1.5, 0.06, 20), 0, 0.5, 0);
                add(new THREE.CylinderGeometry(0.5, 0.6, 0.7, 16), 0, 0.85, 0);
                break;
            case 'crown': {
                add(new THREE.CylinderGeometry(R * 0.95, R * 0.95, 0.35, 12, 1, true), 0, 0.65, 0);
                for (let i = 0; i < 6; i++) {
                    const a = (i / 6) * Math.PI * 2;
                    add(new THREE.ConeGeometry(0.12, 0.3, 8), Math.cos(a) * R * 0.9, 0.95, Math.sin(a) * R * 0.9);
                }
                break;
            }
            case 'headband':
                add(new THREE.TorusGeometry(R * 0.95, 0.1, 8, 20), 0, 0.35, 0, Math.PI / 2);
                break;
            case 'antenna': {
                const stalk = add(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 8), 0, 0.9, 0);
                const ball = this._mesh(new THREE.SphereGeometry(0.16, 12, 12), this._mat(P.hatColor, { emissive: P.hatColor, emissiveIntensity: 0.5 }));
                ball.position.set(0, 1.25, 0); grp.add(ball);
                break;
            }
            case 'party':
                add(new THREE.ConeGeometry(R * 0.7, 1.2, 18), 0, 1.0, 0);
                break;
            case 'none':
            default:
                break;
        }
        this.headwear = grp;
    }

    _buildEyewear(P, R, fz) {
        if (P.eyewear === 'none') return;
        const grp = new THREE.Group();
        this.head.add(grp);
        const frame = this._mat(P.eyewear === 'sunglasses' ? 0x111111 : 0x222222, { rough: 0.3, metal: 0.4 });
        const lens = this._mat(P.eyewear === 'goggles' ? 0x66ccff : 0x222222, { rough: 0.1, metal: 0.3, transparent: true, opacity: 0.85 });

        const ring = (sx, r) => {
            const t = this._mesh(new THREE.TorusGeometry(r, 0.05, 8, 18), frame);
            t.position.set(sx * 0.33, 0.08, fz + 0.02); grp.add(t);
            const l = this._mesh(new THREE.CircleGeometry(r, 18), lens);
            l.position.set(sx * 0.33, 0.08, fz + 0.04); grp.add(l);
        };
        if (P.eyewear === 'round' || P.eyewear === 'goggles') {
            const r = P.eyewear === 'goggles' ? 0.26 : 0.2;
            ring(-1, r); ring(1, r);
            const bridge = this._mesh(new THREE.BoxGeometry(0.2, 0.04, 0.04), frame);
            bridge.position.set(0, 0.08, fz + 0.02); grp.add(bridge);
            if (P.eyewear === 'goggles') {
                const strap = this._mesh(new THREE.TorusGeometry(R * 0.95, 0.06, 8, 22), frame);
                strap.position.set(0, 0.08, 0); strap.rotation.y = Math.PI / 2; grp.add(strap);
            }
        } else if (P.eyewear === 'sunglasses') {
            for (const sx of [-1, 1]) {
                const l = this._mesh(new THREE.BoxGeometry(0.42, 0.26, 0.05), this._mat(0x111111, { rough: 0.15, metal: 0.5 }));
                l.position.set(sx * 0.33, 0.08, fz + 0.02); grp.add(l);
            }
            const bridge = this._mesh(new THREE.BoxGeometry(0.24, 0.05, 0.05), frame);
            bridge.position.set(0, 0.08, fz + 0.02); grp.add(bridge);
        } else if (P.eyewear === 'eyepatch') {
            const patch = this._mesh(new THREE.BoxGeometry(0.4, 0.4, 0.06), this._mat(0x111111));
            patch.position.set(0.33, 0.08, fz); grp.add(patch);
            const band = this._mesh(new THREE.TorusGeometry(R * 0.95, 0.04, 8, 22), this._mat(0x111111));
            band.position.set(0, 0.2, 0); band.rotation.y = Math.PI / 2; band.rotation.x = 0.3; grp.add(band);
        }
        this.eyewear = grp;
    }

    _buildArms(skinMat, P) {
        const sleeve = this._mat(P.shirt, { rough: 0.8 });
        const make = (sx) => {
            const pivot = new THREE.Group();
            pivot.position.set(sx * 0.85, 1.7, 0);   // shoulder
            const upper = this._mesh(new THREE.CylinderGeometry(0.18, 0.16, 1.0, 10), sleeve);
            upper.position.y = -0.5;
            const hand = this._mesh(new THREE.SphereGeometry(0.2, 10, 10), skinMat);
            hand.position.y = -1.05;
            pivot.add(upper, hand);
            this.group.add(pivot);
            return pivot;
        };
        this.armL = make(-1);
        this.armR = make(1);
    }

    // --- public API --------------------------------------------------------
    // Trigger a one-shot emote. Hook point for future networked gestures.
    playGesture(name, duration) {
        const durations = { wave: 2.0, nod: 1.2, shake: 1.2, jump: 0.9, celebrate: 1.6 };
        this.gesture = name;
        this.gestureDur = duration || durations[name] || 1.2;
        this.gestureStart = this._t || 0;
    }

    // Show a chat/emote bubble above the head (hook point for future chat).
    setLabel(text) {
        if (!text) { if (this.labelSprite) this.labelSprite.visible = false; return; }
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.strokeStyle = '#2c3e50'; ctx.lineWidth = 4;
        roundRect(ctx, 8, 8, 240, 96, 16); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#2c3e50'; ctx.font = 'bold 36px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(text).slice(0, 16), 128, 56);
        const tex = new THREE.CanvasTexture(canvas);
        if (!this.labelSprite) {
            this.labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
            this.labelSprite.scale.set(2.4, 1.2, 1);
            this.labelSprite.position.y = 3.6;
            this.group.add(this.labelSprite);
        } else {
            this.labelSprite.material.map.dispose();
            this.labelSprite.material.map = tex;
        }
        this.labelSprite.visible = true;
    }

    update(t) {
        this._t = t;
        const ph = this.phase;

        // --- idle: breathing bob, gentle sway, head wander, arm sway ---
        const baseY = 0;
        this.group.position.y = baseY + Math.sin(t * 1.6 + ph) * 0.06;
        this.group.rotation.z = Math.sin(t * 0.9 + ph) * 0.04;
        this.headPivot.rotation.y = Math.sin(t * 0.5 + ph) * 0.35;
        this.headPivot.rotation.x = Math.sin(t * 0.7 + ph) * 0.05;
        const armSway = Math.sin(t * 1.2 + ph) * 0.12;
        this.armL.rotation.x = armSway;
        this.armR.rotation.x = -armSway;
        this.armL.rotation.z = 0;
        this.armR.rotation.z = 0;

        // --- blink ---
        if (t > this._nextBlink) { this._blinkUntil = t + 0.12; this._nextBlink = t + 2 + hash01((t | 0) + this.seed) * 4; }
        this.eyes.scale.y = t < this._blinkUntil ? 0.1 : 1;

        // --- gesture overlay ---
        if (this.gesture) {
            const k = (t - this.gestureStart) / this.gestureDur;
            if (k >= 1) {
                this.gesture = null;
            } else {
                this._applyGesture(this.gesture, k, t, ph);
            }
        }
    }

    _applyGesture(name, k, t, ph) {
        const ease = Math.sin(Math.min(k, 1) * Math.PI);   // 0->1->0
        switch (name) {
            case 'wave':
                this.armR.rotation.z = -2.2 * ease;
                this.armR.rotation.x = Math.sin(t * 14) * 0.5 * ease;
                break;
            case 'nod':
                this.headPivot.rotation.x = Math.sin(t * 10) * 0.4 * ease;
                break;
            case 'shake':
                this.headPivot.rotation.y = Math.sin(t * 12) * 0.5 * ease;
                break;
            case 'jump':
                this.group.position.y += Math.abs(Math.sin(k * Math.PI)) * 0.8;
                break;
            case 'celebrate':
                this.group.position.y += Math.abs(Math.sin(k * Math.PI * 3)) * 0.5;
                this.armL.rotation.z = 1.8 * ease;
                this.armR.rotation.z = -1.8 * ease;
                break;
        }
    }

    dispose() {
        if (this.labelSprite) { this.labelSprite.material.map?.dispose(); this.labelSprite.material.dispose(); }
        this.disposables.forEach(d => d.dispose && d.dispose());
        this.disposables = [];
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
