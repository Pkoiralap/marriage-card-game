import { TABLE_RADIUS, OPPONENT_TABLE_RADIUS, CARD_WIDTH, CARD_HEIGHT, CARD_THICKNESS, DECK_POS, CHOICE_POS, DISCARD_ZONE_RADIUS, HAND_CENTER_POS } from '../utils/Constants.js';
import { createCardBackTexture, createCardTexture } from '../utils/Helpers.js';
import { Avatar } from './Avatar.js';

export class Renderer {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x2c3e50);

        this.activeAnimations = [];
        this.markers = [];
        this.avatars = [];   // procedural opponent avatars (idle-animated each frame)

        this.cardsGroup = new THREE.Group();
        this.opponentsGroup = new THREE.Group();      // avatars (sig-gated rebuild)
        this.opponentFansGroup = new THREE.Group();   // their held card fans (live)
        this.deckGroup = new THREE.Group();
        this.animationGroup = new THREE.Group();
        this.scene.add(this.cardsGroup);
        this.scene.add(this.opponentsGroup);
        this.scene.add(this.opponentFansGroup);
        this.scene.add(this.deckGroup);
        this.scene.add(this.animationGroup);

        // Peek: GPU resources for the opponent fans, disposed on each rebuild.
        this._oppFanDisposables = [];

        this.initCamera();
        this.initRenderer();
        this.initLights();
        this.initTable();

        this.interactionPlane = this.createInteractionPlane();
        this.scene.add(this.interactionPlane);

        window.addEventListener('resize', this.onWindowResize.bind(this), false);
    }

    initCamera() {
        const aspect = window.innerWidth / window.innerHeight;
        const d = 17;
        this.camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);

        // Peek/orbit: the camera sits on a circle (fixed height + xz-radius)
        // around a look target. The player can drag empty table space to orbit
        // the azimuth a little (to glance at the left neighbour's hand) within a
        // clamped range. The DEFAULT (base) azimuth is the original (26,21,26).
        this._camTarget = new THREE.Vector3(0, 5, 0);
        this._camHeight = 21;
        this._camRadiusXZ = Math.hypot(26, 26);          // 36.77
        this._camAzimuthBase = Math.atan2(26, 26);       // 45° in the xz-plane
        this._camAzimuth = this._camAzimuthBase;
        this._camAzimuthLimit = 0.5;                     // ~±28° of glance
        // Fans orient to the BASE viewpoint (not the live camera) so a glance
        // doesn't make them flip/re-face — they read like a held hand from here.
        this._baseCamPos = new THREE.Vector3(26, 21, 26);

        this.camera.position.set(26, 21, 26);
        this.camera.lookAt(this._camTarget);
    }

    // Peek/orbit: set the camera's azimuth (clamped to a small glance range).
    setCameraAzimuth(phi) {
        const lo = this._camAzimuthBase - this._camAzimuthLimit;
        const hi = this._camAzimuthBase + this._camAzimuthLimit;
        this._camAzimuth = Math.max(lo, Math.min(hi, phi));
        const x = Math.cos(this._camAzimuth) * this._camRadiusXZ;
        const z = Math.sin(this._camAzimuth) * this._camRadiusXZ;
        this.camera.position.set(x, this._camHeight, z);
        this.camera.lookAt(this._camTarget);
    }

    orbitCamera(deltaPhi) { this.setCameraAzimuth(this._camAzimuth + deltaPhi); }
    resetCameraView() { this.setCameraAzimuth(this._camAzimuthBase); }

    // How far (radians) the view is currently rotated from its default. The
    // InputHandler uses this to decide when a peek is "active" (rotated enough).
    cameraAzimuthOffset() { return this._camAzimuth - this._camAzimuthBase; }

    // The player's own hand orbits WITH the camera so it stays centred on screen
    // as the view rotates — rotate the base hand centre around the table centre
    // (origin) by the same azimuth delta as the camera.
    getHandCenter() {
        const d = this._camAzimuth - this._camAzimuthBase;
        const c = Math.cos(d), s = Math.sin(d);
        return new THREE.Vector3(
            HAND_CENTER_POS.x * c - HAND_CENTER_POS.z * s,
            HAND_CENTER_POS.y,
            HAND_CENTER_POS.x * s + HAND_CENTER_POS.z * c,
        );
    }

    initRenderer() {
        this.threeRenderer = new THREE.WebGLRenderer({ antialias: true });
        this.threeRenderer.setSize(window.innerWidth, window.innerHeight);
        this.threeRenderer.setPixelRatio(window.devicePixelRatio);
        this.threeRenderer.shadowMap.enabled = true;
        this.container.appendChild(this.threeRenderer.domElement);
    }

    initLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
        dirLight.position.set(20, 40, 20);
        dirLight.castShadow = true;
        // Adjust shadow camera for better shadow quality
        dirLight.shadow.camera.left = -30;
        dirLight.shadow.camera.right = 30;
        dirLight.shadow.camera.top = 30;
        dirLight.shadow.camera.bottom = -30;
        this.scene.add(dirLight);
    }

    initTable() {
        const tableGeometry = new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 1, 64);
        const tableMaterial = new THREE.MeshLambertMaterial({ color: 0x27ae60 });
        const table = new THREE.Mesh(tableGeometry, tableMaterial);
        table.position.y = -0.5;
        table.receiveShadow = true;
        this.scene.add(table);

        const borderGeometry = new THREE.TorusGeometry(TABLE_RADIUS, 0.8, 16, 100);
        const borderMaterial = new THREE.MeshLambertMaterial({ color: 0x5e3023 });
        const border = new THREE.Mesh(borderGeometry, borderMaterial);
        border.rotation.x = -Math.PI / 2;
        this.scene.add(border);

        // Add visual markers for Deck and Choice
        const markerGeo = new THREE.PlaneGeometry(CARD_WIDTH + 0.5, CARD_HEIGHT + 0.5);
        const markerMat = new THREE.MeshBasicMaterial({ color: 0x1e8449, transparent: true, opacity: 0.5, side: THREE.DoubleSide });

        const deckMarker = new THREE.Mesh(markerGeo, markerMat);
        deckMarker.position.set(DECK_POS.x, 0.01, DECK_POS.z);
        deckMarker.rotation.x = -Math.PI / 2;
        this.scene.add(deckMarker);
        this.markers.push(deckMarker);

        const choiceMarker = new THREE.Mesh(markerGeo, markerMat);
        choiceMarker.position.set(CHOICE_POS.x, 0.01, CHOICE_POS.z);
        choiceMarker.rotation.x = -Math.PI / 2;
        this.scene.add(choiceMarker);
        this.markers.push(choiceMarker);
    }

    removeMarkers() {
        this.markers.forEach(m => {
            this.scene.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (m.material) m.material.dispose();
        });
        this.markers = [];
    }

    createInteractionPlane() {
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(2000, 2000),
            new THREE.MeshBasicMaterial({
                visible: false,
                side: THREE.DoubleSide,
                transparent: true,
                depthWrite: false // CRITICAL: prevent it from blocking depth
            })
        );
        plane.quaternion.copy(this.camera.quaternion);
        return plane;
    }

    onWindowResize() {
        const aspect = window.innerWidth / window.innerHeight;
        const d = 17;   // bug 1: keep zoom consistent with initCamera
        this.camera.left = -d * aspect;
        this.camera.right = d * aspect;
        this.camera.top = d;
        this.camera.bottom = -d;
        this.camera.updateProjectionMatrix();
        this.threeRenderer.setSize(window.innerWidth, window.innerHeight);
    }

    render() {
        const now = performance.now();
        for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
            const anim = this.activeAnimations[i];
            const elapsed = now - anim.startTime;
            const progress = Math.min(elapsed / anim.duration, 1);

            // Smoother easing: easeInOutSine
            const t = -(Math.cos(Math.PI * progress) - 1) / 2;

            anim.mesh.position.lerpVectors(anim.startPos, anim.targetPos, t);

            // Arc up - ensure it is additive to the height to prevent dipping
            const baseArcHeight = 6;
            const currentArc = Math.sin(t * Math.PI) * baseArcHeight;
            anim.mesh.position.y += currentArc;

            // Rotate from start to target (interpolated)
            const finalTargetQuat = anim.targetQuat || this.camera.quaternion;
            anim.mesh.quaternion.slerpQuaternions(anim.startQuat, finalTargetQuat, t);

            if (progress >= 1) {
                this.animationGroup.remove(anim.mesh);
                this.activeAnimations.splice(i, 1);
                if (anim.onComplete) anim.onComplete();
            }
        }

        // Idle-animate the avatars every frame.
        const tsec = now / 1000;
        for (let i = 0; i < this.avatars.length; i++) this.avatars[i].update(tsec);

        this.threeRenderer.render(this.scene, this.camera);
    }

    updateCards(meshes) {
        // Differential update to prevent flicker
        const newMeshesSet = new Set(meshes);

        // Remove meshes that are not in the new list
        for (let i = this.cardsGroup.children.length - 1; i >= 0; i--) {
            const child = this.cardsGroup.children[i];
            if (!newMeshesSet.has(child)) {
                this.cardsGroup.remove(child);
            }
        }

        // Add meshes that are not in the group yet
        const existingMeshesSet = new Set(this.cardsGroup.children);
        meshes.forEach(mesh => {
            if (!existingMeshesSet.has(mesh)) {
                this.cardsGroup.add(mesh);
            }
        });
    }

    updateDeck(stockPileCount) {
        if (stockPileCount === undefined || isNaN(stockPileCount)) stockPileCount = 0;
        const stackHeight = Math.min(20, Math.ceil(stockPileCount / 5));
        if (this.deckGroup.children.filter(m => m.userData.type === 'deck').length === stackHeight) {
            // Still need to update maal card position if deck height changes
            this.updateMaalCardPosition();
            return;
        }
        this.deckGroup.children.filter(m => m.userData.type === 'deck').forEach(m => this.deckGroup.remove(m));

        const geometry = new THREE.BoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_THICKNESS);
        const backTexture = createCardBackTexture(this.threeRenderer);
        const sideMaterial = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
        const backMaterial = new THREE.MeshBasicMaterial({ map: backTexture, transparent: true });

        // Materials: index 5 is -Z (Back when flat)
        const materials = [sideMaterial, sideMaterial, sideMaterial, sideMaterial, sideMaterial, backMaterial];

        for (let i = 0; i < stackHeight; i++) {
            const mesh = new THREE.Mesh(geometry, materials);
            mesh.position.set(DECK_POS.x, DECK_POS.y + i * 0.05, DECK_POS.z);
            mesh.rotation.x = Math.PI / 2; // +Z face down
            mesh.userData.type = 'deck';
            this.deckGroup.add(mesh);
        }
        this.updateMaalCardPosition();
    }

    updateMaalCard(cardData) {
        if (!cardData) return;

        let mesh = this.deckGroup.children.find(m => m.userData.type === 'maal');
        const sideMaterial = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
        const backMaterial = new THREE.MeshBasicMaterial({ map: createCardBackTexture(this.threeRenderer), transparent: true });
        const color = (cardData.suit === 'HEART' || cardData.suit === 'DIAMOND') ? 'red' : 'black';
        const texture = createCardTexture(cardData.number, cardData.suit, color, this.threeRenderer);
        const frontMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
        const materials = [sideMaterial, sideMaterial, sideMaterial, sideMaterial, frontMaterial, backMaterial];

        if (mesh) {
            mesh.material = materials;
            mesh.userData.card = cardData;
        } else {
            const geometry = new THREE.BoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_THICKNESS);
            mesh = new THREE.Mesh(geometry, materials);
            mesh.userData.type = 'maal';
            mesh.userData.card = cardData;
            this.deckGroup.add(mesh);
        }
        this.updateMaalCardPosition();
    }

    updateMaalCardPosition() {
        const mesh = this.deckGroup.children.find(m => m.userData.type === 'maal');
        if (!mesh) return;

        // Place it at the bottom, offset so it's "half showing" from under the deck
        mesh.position.set(DECK_POS.x, DECK_POS.y - 0.1, DECK_POS.z + CARD_HEIGHT * 0.4);
        mesh.rotation.set(-Math.PI / 2, 0, 0); // Face up
    }

    updateChoiceCard(visibles) {
        if (!visibles) return;

        // Use a differential update for visibles too to prevent flicker
        const maxVisible = 5;
        const cardsToShow = visibles.slice(-maxVisible);
        const newIds = new Set(cardsToShow.map(c => c.id));

        // Remove old ones
        this.deckGroup.children.filter(m => (m.userData.type === 'choice' || m.userData.type === 'discard')).forEach(m => {
            if (m.userData.card && !newIds.has(m.userData.card.id)) {
                this.deckGroup.remove(m);
            }
        });

        const existingMeshes = new Map();
        this.deckGroup.children.filter(m => (m.userData.type === 'choice' || m.userData.type === 'discard')).forEach(m => {
            existingMeshes.set(m.userData.card.id, m);
        });

        const geometry = new THREE.BoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_THICKNESS);
        const sideMaterial = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
        const backMaterial = new THREE.MeshBasicMaterial({ map: createCardBackTexture(this.threeRenderer), transparent: true });

        cardsToShow.forEach((cardData, i) => {
            let mesh = existingMeshes.get(cardData.id);
            const globalIndex = visibles.length - cardsToShow.length + i;
            const offset = (globalIndex % maxVisible) * 0.4;
            const rotOffset = ((globalIndex % maxVisible) - (maxVisible - 1) / 2) * 0.1;
            const targetPos = new THREE.Vector3(CHOICE_POS.x + offset, CHOICE_POS.y + i * 0.02, CHOICE_POS.z);
            const targetRot = new THREE.Euler(-Math.PI / 2, 0, rotOffset);

            if (mesh) {
                // Update properties and position
                mesh.position.copy(targetPos);
                mesh.rotation.copy(targetRot);
                mesh.userData.type = (i === cardsToShow.length - 1) ? 'choice' : 'discard';
            } else {
                const color = (cardData.suit === 'HEART' || cardData.suit === 'DIAMOND') ? 'red' : 'black';
                const texture = createCardTexture(cardData.number, cardData.suit, color, this.threeRenderer);
                const frontMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
                const materials = [sideMaterial, sideMaterial, sideMaterial, sideMaterial, frontMaterial, backMaterial];

                mesh = new THREE.Mesh(geometry, materials);
                mesh.position.copy(targetPos);
                mesh.rotation.copy(targetRot);
                mesh.userData.type = (i === cardsToShow.length - 1) ? 'choice' : 'discard';
                mesh.userData.card = cardData;
                this.deckGroup.add(mesh);
            }
        });
    }

    animateCard(sourcePos, targetPos, cardData, isFaceDown, onComplete, targetQuat = null, sourceQuat = null, existingMesh = null) {
        let mesh = existingMesh;

        const sideMaterial = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
        const backMaterial = new THREE.MeshBasicMaterial({ map: createCardBackTexture(this.threeRenderer), transparent: true });

        let frontMaterial;
        if (cardData && !isFaceDown) {
            const color = (cardData.suit === 'HEART' || cardData.suit === 'DIAMOND') ? 'red' : 'black';
            const texture = createCardTexture(cardData.number, cardData.suit, color, this.threeRenderer);
            frontMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
        } else {
            frontMaterial = backMaterial;
        }
        const materials = [sideMaterial, sideMaterial, sideMaterial, sideMaterial, frontMaterial, backMaterial];

        if (!mesh) {
            const geometry = new THREE.BoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_THICKNESS);
            mesh = new THREE.Mesh(geometry, materials);
        } else {
            // Update materials of existing mesh
            mesh.material = materials;
        }

        mesh.renderOrder = 1000; // Always in front

        // Ensure mesh is in animation group and has correct starting transform
        if (mesh.parent) mesh.parent.remove(mesh);
        this.animationGroup.add(mesh);

        mesh.position.copy(sourcePos);
        if (sourceQuat) {
            mesh.quaternion.copy(sourceQuat);
        } else {
            if (isFaceDown) {
                mesh.rotation.x = Math.PI / 2; // Face down
            } else {
                mesh.rotation.x = -Math.PI / 2; // Face up
            }
        }

        const anim = {
            mesh,
            startTime: performance.now(),
            duration: 600,
            startPos: sourcePos.clone(),
            targetPos: targetPos.clone(),
            startQuat: mesh.quaternion.clone(),
            targetQuat: targetQuat ? targetQuat.clone() : null,
            onComplete,
            isFaceDown
        };

        this.activeAnimations.push(anim);
    }

    extractCardMesh(cardId) {
        // Search in deckGroup (choice/discard pile)
        const mesh = this.deckGroup.children.find(m => m.userData.card && m.userData.card.id === cardId);
        if (mesh) {
            this.deckGroup.remove(mesh);
            return mesh;
        }
        return null;
    }

    highlightMesh(mesh, color) {
        if (!mesh || !mesh.material) return;

        // MeshBasicMaterial doesn't have emissive. 
        // Let's highlight by changing the color of the side materials (indices 0-3)
        // or just the front/back if we want a full glow.
        // For a simple border effect, we can tint the materials.
        if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m, i) => {
                if (color) {
                    // Save original color if not already saved
                    if (m.userData.originalColor === undefined) {
                        m.userData.originalColor = m.color.getHex();
                    }
                    m.color.setHex(color);
                } else if (m.userData.originalColor !== undefined) {
                    m.color.setHex(m.userData.originalColor);
                }
            });
        }
    }

    // avatarSeeds: array (one entry per opponent, in render-slot order) of the
    // avatar preset index for that player. Rebuilt only when the set changes,
    // so per-turn state updates don't reset the idle animation.
    addOpponents(avatarSeeds = []) {
        const numOpponents = avatarSeeds.length;
        if (numOpponents < 1) return;

        const sig = avatarSeeds.join(',');
        if (this.opponentsGroup.userData.sig === sig) return;
        this.opponentsGroup.userData.sig = sig;

        // Tear down the previous set (dispose avatar geometries/materials).
        this.avatars.forEach(a => a.dispose());
        this.avatars = [];
        for (let i = this.opponentsGroup.children.length - 1; i >= 0; i--) {
            this.opponentsGroup.remove(this.opponentsGroup.children[i]);
        }

        for (let i = 0; i < numOpponents; i++) {
            const pos = this.getOpponentPosition(i, numOpponents);

            const avatar = new Avatar(avatarSeeds[i]);
            avatar.group.position.set(pos.x, 0, pos.z);
            // Bug 1: face the player's camera (not the table centre) so the
            // player sees the opponents' faces at eye level.
            avatar.group.rotation.y = Math.atan2(
                this._baseCamPos.x - pos.x, this._baseCamPos.z - pos.z);
            this.opponentsGroup.add(avatar.group);
            this.avatars.push(avatar);
        }
    }

    // Peek: free the GPU resources behind the current opponent fans.
    _disposeOpponentFans() {
        for (let i = this.opponentFansGroup.children.length - 1; i >= 0; i--) {
            this.opponentFansGroup.remove(this.opponentFansGroup.children[i]);
        }
        this._oppFanDisposables.forEach(d => d && d.dispose && d.dispose());
        this._oppFanDisposables = [];
    }

    // Peek: (re)build every opponent's held card fan, live. Most show card
    // BACKS; the one slot the player is allowed to peek (their consenting left
    // neighbour, rendered at the last/screen-left slot) shows the real FACES,
    // tracked in real time (rebuilt on each state update). `peekCards` is that
    // neighbour's hand (array of {suit,number}) or null.
    updateOpponentHands(numOpponents, peekSlot = -1, peekCards = null) {
        this._disposeOpponentFans();
        if (numOpponents < 1) return;

        const backTexture = createCardBackTexture(this.threeRenderer);
        const sharedGeo = new THREE.BoxGeometry(1.6, 2.3, 0.04);
        const backMat = new THREE.MeshStandardMaterial({ map: backTexture });
        this._oppFanDisposables.push(backTexture, sharedGeo, backMat);

        for (let i = 0; i < numOpponents; i++) {
            const pos = this.getOpponentPosition(i, numOpponents);
            const faces = (i === peekSlot && peekCards && peekCards.length) ? peekCards : null;
            const isRightNeighbour = (i === 0);
            const isLeftNeighbour = (i === numOpponents - 1);
            let tilt = 0;
            if (isRightNeighbour) {
                tilt = 0.55;
            } else if (isLeftNeighbour) {
                tilt = 0.15;
            }
            this._buildHeldCardFan(pos, sharedGeo, backMat, faces, tilt);
        }
    }

    // A static fan of cards held UPRIGHT in front of an avatar, like a real
    // hand: backs (or real faces when `faces` is given) pivoting about a grip
    // point near the bottom, heavily overlapping.
    //
    // Orientation models real life: every player holds their cards facing
    // INWARD (toward the table centre / their own eyes), so from your seat the
    // neighbours' fans read edge-on and you can't see into them. The peeked left
    // neighbour uses the SAME held position/orientation — revealing only swaps
    // the BACKS for real FACES IN PLACE (so a glance left reads them) rather than
    // re-laying the cards out, which keeps the reveal seamless and realistic.
    _buildHeldCardFan(pos, geo, backMat, faces = null, tilt = 0) {
        const count = faces ? faces.length : 21;
        if (count <= 0) return;

        const up = new THREE.Vector3(0, 1, 0);
        // Anchor in front of the avatar (toward centre), raised to chest/face
        // height so it reads as cards held up in front of them.
        const anchor = new THREE.Vector3(pos.x * 0.72, 4.2, pos.z * 0.72);
        // Base facing is the table centre (held toward themselves) — identical for
        // backs and revealed faces so the reveal doesn't move/re-orient the fan.
        const viewPoint = new THREE.Vector3(0, this._camHeight, 0);
        const toCam = new THREE.Vector3(viewPoint.x - anchor.x, 0, viewPoint.z - anchor.z).normalize();
        // ...then yaw it toward the player's own right (negative spin): turns the
        // left neighbour's fan toward you and the right neighbour's away.
        if (tilt) toCam.applyAxisAngle(up, tilt);
        const right = new THREE.Vector3().crossVectors(up, toCam).normalize();   // horizontal
        const basis = new THREE.Matrix4().makeBasis(right, up, toCam);
        const baseQuat = new THREE.Quaternion().setFromRotationMatrix(basis);

        // Pivot/grip sits below the anchor by `radius`; each card rotates about
        // it. Small per-card angle so all the cards fit in a graceful ~80deg arc
        // with a real hand's tight overlap (only a strip of each card shows).
        const radius = 5.6;     // grip-to-centre distance (controls arc curvature)
        const spread = 0.072;   // radians between adjacent cards
        const mid = (count - 1) / 2;
        for (let j = 0; j < count; j++) {
            const a = (j - mid) * spread;

            let mat = backMat;
            if (faces) {
                const cd = faces[j];
                const color = (cd.suit === 'HEART' || cd.suit === 'DIAMOND') ? 'red' : 'black';
                const tex = createCardTexture(cd.number, cd.suit, color, this.threeRenderer);
                mat = new THREE.MeshStandardMaterial({ map: tex });
                this._oppFanDisposables.push(tex, mat);
            }

            const card = new THREE.Mesh(geo, mat);
            // Upright arc in the (right, up) plane: centre highest, edges lower.
            card.position.copy(anchor)
                .addScaledVector(right, radius * Math.sin(a))
                .addScaledVector(up, radius * (Math.cos(a) - 1))
                .addScaledVector(toCam, j * 0.012);  // layer toward viewer, avoid z-fight
            // Stand upright facing the viewpoint, then splay each card by rolling
            // it about its own normal.
            const roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -a);
            card.quaternion.copy(baseQuat).multiply(roll);
            card.castShadow = true;
            this.opponentFansGroup.add(card);
        }
    }

    // --- avatar emote/chat hooks (for future networked gestures & chat) ------
    triggerGesture(slot, name) {
        const a = this.avatars[slot];
        if (a) a.playGesture(name);
    }

    setAvatarLabel(slot, text) {
        const a = this.avatars[slot];
        if (a) a.setLabel(text);
    }

    getOpponentPosition(index, totalOpponents = 3) {
        const totalPlayers = totalOpponents + 1;
        const angleStep = (Math.PI * 2) / totalPlayers;
        const offset = Math.PI / totalPlayers;

        const angle = (-Math.PI / 2) + (index + 1) * angleStep + offset;

        const x = Math.cos(angle) * OPPONENT_TABLE_RADIUS * 0.9;
        // In Three.js, negative Z is 'up' (away from camera)
        const z = -Math.sin(angle) * OPPONENT_TABLE_RADIUS * 0.9;
        return new THREE.Vector3(x, 0, z);
    }
}
