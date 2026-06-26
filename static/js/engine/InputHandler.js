import { FAN_RADIUS, FAN_SPACING, HAND_CENTER_POS, CHOICE_POS, DISCARD_ZONE_RADIUS } from '../utils/Constants.js';

export class InputHandler {
    constructor(renderer, game, callbacks) {
        this.renderer = renderer;
        this.game = game;
        this.callbacks = callbacks;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        this.isDragging = false;
        this.draggedCardMesh = null;
        this.dragOffset = new THREE.Vector3();
        this.hoverIndex = -1;
        
        // Multi-selection state
        this.isSelectionMode = false;
        this.selectedIndices = new Set();
        this.registeredIndices = new Set(); // Indices of cards already in a sequence
        
        // Ghost card for dragging from source
        this.ghostCard = null;
        this.dragSource = null; // 'deck' or 'choice'
        this.dragSourceMesh = null; // Reference to original mesh
        this.isWaitingForServer = false;
        this.settlingMesh = null; // Mesh currently settling into hand
        this.lockedDiscardMesh = null; // Mesh locked in place after discard drop

        // Touch tap-to-act state (mobile): first tap "arms" a card/source, the
        // second tap on the same target performs the pick/discard.
        this.armedHandIndex = -1;
        this.armedSource = null;       // 'deck' | 'choice'
        this.armedSourceMesh = null;
        this.usingTouch = false;       // once true, ignore (synthesized) mouse events
        this._touchActive = false;     // a game touch (not on an HTML control) is in progress

        window.addEventListener('mousemove', this.onMouseMove.bind(this), false);
        window.addEventListener('mousedown', this.onMouseDown.bind(this), false);
        window.addEventListener('mouseup', this.onMouseUp.bind(this), false);

        // Touch uses a discrete tap model instead of drag (drag-on-touch is
        // unreliable on phones, especially iOS). Bound to WINDOW like the mouse
        // handlers so a tap anywhere over the 3D scene is caught regardless of
        // which element it technically lands on. Taps on HTML controls pass
        // through untouched so buttons/inputs keep working.
        window.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
        window.addEventListener('touchmove', (e) => { if (this._touchActive && e.cancelable) e.preventDefault(); }, { passive: false });
        window.addEventListener('touchend', (e) => { if (this._touchActive && e.cancelable) e.preventDefault(); this._touchActive = false; }, { passive: false });
    }

    onTouchStart(event) {
        // Any touch means this is a touch device: permanently disable the mouse
        // drag path so iOS's synthesized mouse events can't start phantom drags.
        this.usingTouch = true;

        // Let taps on HTML controls (buttons, inputs, modals, side panels)
        // behave normally so clicks still fire there.
        const onControl = event.target && event.target.closest &&
            event.target.closest('button, input, select, textarea, .modal, '
                + '#game-log, #game-controls, #sequence-controls, #shown-sequences-container');
        if (onControl) {
            this._touchActive = false;
            return;
        }
        // A game-surface touch: take over the gesture and run the tap model.
        this._touchActive = true;
        if (event.cancelable) event.preventDefault();
        this.onTap(event);
    }

    // Visually arm/disarm a deck/choice source (tinted while armed).
    setArmedSource(source, mesh) {
        if (this.armedSourceMesh && this.armedSourceMesh !== mesh) {
            this.renderer.highlightMesh(this.armedSourceMesh, null);
        }
        this.armedSource = source;
        this.armedSourceMesh = mesh;
        if (mesh) this.renderer.highlightMesh(mesh, 0xffd700);
    }

    clearArmed() {
        this.armedHandIndex = -1;
        if (this.armedSourceMesh) this.renderer.highlightMesh(this.armedSourceMesh, null);
        this.armedSource = null;
        this.armedSourceMesh = null;
    }

    // Tap model: first tap selects/arms, second tap on the same target acts.
    onTap(event) {
        if (!this.game.me || this.isWaitingForServer) { return; }
        if (!this.game.isMyTurn()) { return; }

        const p = this.getEventPoint(event);
        this.mouse.x = (p.x / window.innerWidth) * 2 - 1;
        this.mouse.y = -(p.y / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.renderer.camera);

        // 1) Hand cards
        const handIntersects = this.raycaster.intersectObjects(this.renderer.cardsGroup.children);
        if (handIntersects.length > 0) {
            const index = handIntersects[0].object.userData.index;

            // Sequence/tunnela/dublee selection: tap toggles membership.
            if (this.isSelectionMode) {
                if (this.registeredIndices.has(index)) return;
                if (this.selectedIndices.has(index)) this.selectedIndices.delete(index);
                else if (this.selectedIndices.size < 5) this.selectedIndices.add(index);
                return;
            }

            // Discard step: arm a card, tap it again to throw it.
            if (this.game.turnStep === 'DISCARD') {
                if (this.armedHandIndex === index) {
                    const mesh = handIntersects[0].object;
                    const cardId = mesh.userData.card && mesh.userData.card.id;
                    const sent = this.callbacks.discardCard(index, mesh.position.clone(), mesh.quaternion.clone(), cardId);
                    if (sent) {
                        this.isWaitingForServer = true;
                        this.lockedDiscardMesh = mesh;
                        this.armedHandIndex = -1;
                    }
                    // If not sent (busy animating), stay armed so a re-tap retries.
                } else {
                    this.armedHandIndex = index;
                }
            }
            return;
        }

        // 2) Deck / choice during the pick step: arm it, tap again to pick.
        if (this.game.turnStep === 'PICK') {
            const deckIntersects = this.raycaster.intersectObjects(this.renderer.deckGroup.children);
            if (deckIntersects.length > 0) {
                const mesh = deckIntersects[0].object;
                const type = mesh.userData.type;
                if (type === 'deck' || type === 'choice') {
                    if (this.armedSource === type) {
                        const sent = this.callbacks.pickCard(type, this.game.me.hand.length);
                        if (sent) {
                            this.isWaitingForServer = true;
                            this.clearArmed();
                        }
                        // If not sent (busy animating), stay armed for a re-tap.
                    } else {
                        this.setArmedSource(type, mesh);
                    }
                    return;
                }
            }
        }

        // Tapped empty space -> disarm.
        this.clearArmed();
    }

    // Coordinates from either a mouse event or the first touch point.
    getEventPoint(event) {
        const t = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
        return t ? { x: t.clientX, y: t.clientY } : { x: event.clientX, y: event.clientY };
    }

    onMouseMove(event) {
        if (this.usingTouch) return;  // touch device: ignore synthesized mouse
        if (event.cancelable) event.preventDefault();
        const p = this.getEventPoint(event);
        this.mouse.x = (p.x / window.innerWidth) * 2 - 1;
        this.mouse.y = -(p.y / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.renderer.camera);

        if (this.isDragging && this.draggedCardMesh && !this.isWaitingForServer) {
            const intersects = this.raycaster.intersectObject(this.renderer.interactionPlane);
            if (intersects.length > 0) {
                const point = intersects[0].point;
                this.draggedCardMesh.position.copy(point.sub(this.dragOffset));
                this.calculateHoverIndex(this.draggedCardMesh.position);
            }
        } else if (this.ghostCard && !this.isWaitingForServer) {
            const intersects = this.raycaster.intersectObject(this.renderer.interactionPlane);
            if (intersects.length > 0) {
                const point = intersects[0].point;
                this.ghostCard.position.copy(point);
                
                // Only hide source when we've moved it slightly
                if (this.dragSourceMesh && this.dragSourceMesh.visible) {
                    const sourcePos = new THREE.Vector3();
                    this.dragSourceMesh.getWorldPosition(sourcePos);
                    if (point.distanceTo(sourcePos) > 1.0) {
                        this.dragSourceMesh.visible = false;
                    }
                }

                this.calculateHoverIndex(this.ghostCard.position);
            }
        }
    }

    onMouseDown(event) {
        if (this.usingTouch) return;  // touch device: ignore synthesized mouse
        if (!this.game.me || this.isWaitingForServer) return;

        // NOTE: we intentionally do NOT block off-turn here. Picking up a hand
        // card to reorder it is allowed at any time (the player can organise
        // their hand while others play); only PICK from deck/choice and DISCARD
        // are turn-gated (see the deck branch below and onMouseUp).

        // Seed the pointer from this event: on touch there is no preceding
        // move to set this.mouse, so the raycast would otherwise use stale coords.
        const p = this.getEventPoint(event);
        this.mouse.x = (p.x / window.innerWidth) * 2 - 1;
        this.mouse.y = -(p.y / window.innerHeight) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.renderer.camera);
        
        // Check for hand cards first
        const handIntersects = this.raycaster.intersectObjects(this.renderer.cardsGroup.children);
        if (handIntersects.length > 0) {
            const mesh = handIntersects[0].object;
            const index = mesh.userData.index;

            if (this.isSelectionMode) {
                // Cannot select already registered cards
                if (this.registeredIndices.has(index)) return;

                if (this.selectedIndices.has(index)) {
                    this.selectedIndices.delete(index);
                } else if (this.selectedIndices.size < 5) {
                    this.selectedIndices.add(index);
                }
                return;
            }

            if (mesh.userData && index !== undefined) {
                this.isDragging = true;
                this.draggedCardMesh = mesh;
                
                // Align plane to camera
                this.renderer.interactionPlane.quaternion.copy(this.renderer.camera.quaternion);
                
                const viewDir = new THREE.Vector3();
                this.renderer.camera.getWorldDirection(viewDir);
                const liftVector = viewDir.clone().multiplyScalar(-2.5);
            
                this.renderer.interactionPlane.position.copy(mesh.position).add(liftVector);
                this.renderer.interactionPlane.updateMatrixWorld();
                            const planeIntersect = this.raycaster.intersectObject(this.renderer.interactionPlane);
                if (planeIntersect.length > 0) {
                    const targetPos = mesh.position.clone().add(liftVector);
                    this.dragOffset.copy(planeIntersect[0].point).sub(targetPos);
                    mesh.position.copy(targetPos);
                }
                
                mesh.quaternion.copy(this.renderer.camera.quaternion); 
                mesh.renderOrder = 999; 
            }
            return;
        }

        // Check for deck or choice card (picking is turn-gated)
        if (this.game.isMyTurn() && this.game.turnStep === 'PICK' && !this.isSelectionMode) {
            const deckIntersects = this.raycaster.intersectObjects(this.renderer.deckGroup.children);
            if (deckIntersects.length > 0) {
                const mesh = deckIntersects[0].object;
                if (mesh.userData.type === 'deck' || mesh.userData.type === 'choice') {
                    this.dragSource = mesh.userData.type;
                    this.dragSourceMesh = mesh;
                    this.createGhostCard(mesh);
                    
                    // Align plane to camera
                    this.renderer.interactionPlane.quaternion.copy(this.renderer.camera.quaternion);

                    // Setup interaction plane for ghost - lift significantly
                    const viewDir = new THREE.Vector3();
                    this.renderer.camera.getWorldDirection(viewDir);
                    const liftVector = viewDir.clone().multiplyScalar(-5); 
                    this.renderer.interactionPlane.position.copy(this.ghostCard.position).add(liftVector);
                    this.renderer.interactionPlane.updateMatrixWorld();
                }
            }
        }
    }

    createGhostCard(sourceMesh) {
        this.ghostCard = sourceMesh.clone();
        this.ghostCard.material = Array.isArray(sourceMesh.material) ? sourceMesh.material.map(m => m.clone()) : sourceMesh.material.clone();
        // bug1 follow-up: hand cards render at 0.7 scale (see Card.js), but the
        // deck/choice source meshes are full size. Match the destination size so
        // the dragged card doesn't fly oversized and then pop down on landing.
        this.ghostCard.scale.setScalar(0.7);

        this.ghostCard.renderOrder = 1000;
        if (Array.isArray(this.ghostCard.material)) {
            this.ghostCard.material.forEach(m => {
                m.transparent = true;
                m.depthTest = false;
            });
        } else {
            this.ghostCard.material.transparent = true;
            this.ghostCard.material.depthTest = false;
        }

        sourceMesh.getWorldPosition(this.ghostCard.position);
        sourceMesh.getWorldQuaternion(this.ghostCard.quaternion);
        this.renderer.scene.add(this.ghostCard);
        this.isWaitingForServer = false;
    }

    onMouseUp(event) {
        if (this.usingTouch) return;  // touch device: ignore synthesized mouse
        if (this.isDragging && this.draggedCardMesh) {
            const oldIndex = this.draggedCardMesh.userData.index;

            // The dragged card is locked to a camera-facing plane, so with the
            // tilted (eye-level) camera its world x,z barely move toward the
            // choice pile as you drag up-screen — the card mostly rises in Y.
            // Testing the card's own x,z therefore never registers a discard.
            // Instead, project the CURSOR onto the table (y=0) to find where the
            // player is actually aiming the drop.
            const p = this.getEventPoint(event);
            this.mouse.x = (p.x / window.innerWidth) * 2 - 1;
            this.mouse.y = -(p.y / window.innerHeight) * 2 + 1;
            this.raycaster.setFromCamera(this.mouse, this.renderer.camera);
            const tableHit = new THREE.Vector3();
            const aimed = this.raycaster.ray.intersectPlane(
                new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), tableHit);
            const aim2D = aimed
                ? new THREE.Vector2(tableHit.x, tableHit.z)
                : new THREE.Vector2(this.draggedCardMesh.position.x, this.draggedCardMesh.position.z);
            const choicePos2D = new THREE.Vector2(CHOICE_POS.x, CHOICE_POS.z);

            // Only allow discard if it's my turn AND the correct turn step;
            // otherwise the drop falls through to a (harmless) reorder.
            if (this.game.isMyTurn() && this.game.turnStep === 'DISCARD' && aim2D.distanceTo(choicePos2D) < DISCARD_ZONE_RADIUS) {
                this.isWaitingForServer = true;
                this.lockedDiscardMesh = this.draggedCardMesh;
                const cardId = this.draggedCardMesh.userData.card && this.draggedCardMesh.userData.card.id;
                this.callbacks.discardCard(oldIndex, this.draggedCardMesh.position.clone(), this.draggedCardMesh.quaternion.clone(), cardId);
                
                this.isDragging = false;
                this.draggedCardMesh = null;
            } else {
                // Not discard time, or not in zone - just reorder
                const newIndex = this.hoverIndex;
                if (newIndex !== -1 && newIndex !== oldIndex) {
                    this.game.reorderHand(oldIndex, newIndex);
                    if (this.callbacks.reorderHand) {
                        this.callbacks.reorderHand(oldIndex, newIndex);
                    }
                    // Update registered indices after reorder
                    this.updateRegisteredIndicesAfterReorder(oldIndex, newIndex);
                }
                this.isDragging = false;
                this.draggedCardMesh = null;
                this.hoverIndex = -1;
            }
        } else if (this.ghostCard) {
            if (this.hoverIndex !== -1) {
                this.isWaitingForServer = true;
                this.callbacks.pickCard(this.dragSource, this.hoverIndex);
            } else {
                this.cleanupDrag();
            }
        }
    }

    updateRegisteredIndicesAfterReorder(oldIdx, newIdx) {
        // Logic to shift registered indices if needed
        // Since we are rebuilding the hand meshes based on indices in animate, 
        // if we just reordered the game.hand array, the indices mapping might change.
        // But game.reorderHand handles the array, and InputHandler animate handles the meshes.
        // Actually, better if GameController provides the absolute indices.
        // Let's assume for now the caller (GameController) will reset registeredIndices.
    }

    cleanupDrag() {
        if (this.ghostCard) {
            this.renderer.scene.remove(this.ghostCard);
            this.ghostCard = null;
        }
        if (this.dragSourceMesh) {
            this.dragSourceMesh.visible = true;
            this.dragSourceMesh = null;
        }
        if (this.draggedCardMesh) {
            this.draggedCardMesh.visible = true;
            this.draggedCardMesh = null;
        }
        this.lockedDiscardMesh = null;
        this.isDragging = false;
        this.dragSource = null;
        this.hoverIndex = -1;
        this.isWaitingForServer = false;
    }

    calculateHoverIndex(position) {
        const radius = FAN_RADIUS;
        const viewDir = new THREE.Vector3();
        this.renderer.camera.getWorldDirection(viewDir).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(viewDir, up).normalize();
        const screenUp = new THREE.Vector3().crossVectors(right, viewDir).normalize();
        const pivotPos = HAND_CENTER_POS.clone().add(screenUp.clone().multiplyScalar(-radius));

        const toCard = position.clone().sub(pivotPos);
        const x = toCard.dot(right);
        const y = toCard.dot(screenUp);
        
        const heightFromBase = position.dot(screenUp) - HAND_CENTER_POS.dot(screenUp);
        if (heightFromBase > 10) { 
            if (!this.isWaitingForServer) this.hoverIndex = -1;
            return;
        }

        const angleStep = FAN_SPACING / radius;
        const totalCards = this.game.me.hand.length; 
        const totalAngle = (totalCards - 1) * angleStep;
        const startAngle = totalAngle / 2;
        
        const angle = Math.atan2(x, y);
        let idx = Math.round((angle + startAngle) / angleStep);
        
        if (!this.isWaitingForServer) {
            this.hoverIndex = Math.max(0, Math.min(totalCards, idx));
        }
    }

    getCardTransform(index, totalCards) {
        const radius = FAN_RADIUS;
        const angleStep = FAN_SPACING / radius; 
        const totalAngle = (totalCards - 1) * angleStep;
        const startAngle = totalAngle / 2;

        const viewDir = new THREE.Vector3();
        this.renderer.camera.getWorldDirection(viewDir).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const right = new THREE.Vector3().crossVectors(viewDir, up).normalize();
        const screenUp = new THREE.Vector3().crossVectors(right, viewDir).normalize();

        const pivotPos = HAND_CENTER_POS.clone().add(screenUp.clone().multiplyScalar(-radius));
        const theta = (index * angleStep) - startAngle;

        const offsetRight = right.clone().multiplyScalar(radius * Math.sin(theta));
        const offsetUp = screenUp.clone().multiplyScalar(radius * Math.cos(theta));
        const pos = pivotPos.clone().add(offsetRight).add(offsetUp);

        const depthStep = 0.1;
        pos.add(viewDir.clone().multiplyScalar(-index * depthStep));

        const rotQuat = this.renderer.camera.quaternion.clone();
        const tiltQuat = new THREE.Quaternion();
        tiltQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -theta);
        rotQuat.multiply(tiltQuat);

        return { position: pos, quaternion: rotQuat };
    }

    setSelectionMode(enabled) {
        this.isSelectionMode = enabled;
        this.selectedIndices.clear();
    }

    getSelectedIndices() {
        return Array.from(this.selectedIndices);
    }

    animate() {
        if (!this.game.me) return;
        const currentHand = this.game.me.hand;
        const totalCards = currentHand.length;

        // Animate ghost card to match hover spot rotation
        if (this.ghostCard) {
            let targetQuat = this.renderer.camera.quaternion;
            if (this.hoverIndex !== -1) {
                const fanSize = totalCards + 1;
                const transform = this.getCardTransform(this.hoverIndex, fanSize);
                targetQuat = transform.quaternion;
            }
            this.ghostCard.quaternion.slerp(targetQuat, 0.2);
        }

        this.renderer.cardsGroup.children.forEach((mesh) => {
            if (mesh === this.draggedCardMesh || mesh === this.lockedDiscardMesh) return; 
            
            const myIndex = mesh.userData.index;
            let targetIndex = myIndex;
            let fanSize = totalCards;

            if (this.isDragging && this.draggedCardMesh) {
                const originalIndex = this.draggedCardMesh.userData.index;
                if (this.hoverIndex === -1) {
                    fanSize = totalCards - 1;
                    if (myIndex > originalIndex) targetIndex = myIndex - 1;
                } else {
                    fanSize = totalCards; 
                    let visualIdx = myIndex;
                    if (myIndex > originalIndex) visualIdx--; 
                    if (visualIdx >= this.hoverIndex) visualIdx++;
                    targetIndex = visualIdx;
                }
            } 
            else if (this.ghostCard && this.hoverIndex !== -1) {
                fanSize = totalCards + 1;
                if (myIndex >= this.hoverIndex) targetIndex = myIndex + 1;
            }

            const target = this.getCardTransform(targetIndex, fanSize);

            // Selection / Registration / armed lift - push "upwards" on screen.
            const isArmed = (myIndex === this.armedHandIndex);
            if (this.selectedIndices.has(myIndex) || this.registeredIndices.has(myIndex) || isArmed) {
                const viewDir = new THREE.Vector3();
                this.renderer.camera.getWorldDirection(viewDir);
                const up = new THREE.Vector3(0, 1, 0);
                const right = new THREE.Vector3().crossVectors(viewDir, up).normalize();
                const screenUp = new THREE.Vector3().crossVectors(right, viewDir).normalize();

                // Lift "upwards" on the screen (which is screenUp)
                const liftAmount = isArmed ? 2.0 : (this.selectedIndices.has(myIndex) ? 1.5 : 2.5);
                target.position.add(screenUp.clone().multiplyScalar(liftAmount));

                // User requested: "must not change their z value"
                // Removed the viewDir (towards camera) lift.
            }

            const lerpFactor = (this.ghostCard || this.isDragging || mesh === this.settlingMesh) ? 0.3 : 0.15;
            
            // Special handling for settling mesh to keep it in front
            if (mesh === this.settlingMesh) {
                mesh.renderOrder = 1000;
                // Force it to stay "lifted" physically until it arrives
                const viewDir = new THREE.Vector3();
                this.renderer.camera.getWorldDirection(viewDir);
                const lift = viewDir.clone().multiplyScalar(-1.5); // Lift toward camera
                const liftedTarget = target.position.clone().add(lift);
                
                mesh.position.lerp(liftedTarget, lerpFactor);
                mesh.quaternion.slerp(target.quaternion, lerpFactor);

                if (mesh.position.distanceTo(liftedTarget) < 0.1) {
                    mesh.position.copy(target.position);
                    this.settlingMesh = null;
                }
            } else {
                mesh.position.lerp(target.position, lerpFactor);
                mesh.quaternion.slerp(target.quaternion, lerpFactor);
                
                // Keep natural fan order even for selected cards to prevent hiding cards to the right
                if (this.isDragging && mesh === this.draggedCardMesh) {
                    mesh.renderOrder = 1000;
                } else {
                    mesh.renderOrder = targetIndex + 1;
                }
            }
        });
    }
}