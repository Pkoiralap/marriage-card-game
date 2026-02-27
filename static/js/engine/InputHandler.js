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
        
        // Ghost card for dragging from source
        this.ghostCard = null;
        this.dragSource = null; // 'deck' or 'choice'
        this.dragSourceMesh = null; // Reference to original mesh
        this.isWaitingForServer = false;
        this.settlingMesh = null; // Mesh currently settling into hand
        this.lockedDiscardMesh = null; // Mesh locked in place after discard drop

        window.addEventListener('mousemove', this.onMouseMove.bind(this), false);
        window.addEventListener('mousedown', this.onMouseDown.bind(this), false);
        window.addEventListener('mouseup', this.onMouseUp.bind(this), false);
    }

    onMouseMove(event) {
        event.preventDefault();
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

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
        if (!this.game.me || this.isWaitingForServer) return;
        
        this.raycaster.setFromCamera(this.mouse, this.renderer.camera);
        
        // Check for hand cards first
        const handIntersects = this.raycaster.intersectObjects(this.renderer.cardsGroup.children);
        if (handIntersects.length > 0) {
            const mesh = handIntersects[0].object;
            if (mesh.userData && mesh.userData.index !== undefined) {
                this.isDragging = true;
                this.draggedCardMesh = mesh;
                
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

        // Check for deck or choice card
        if (this.game.turnStep === 'PICK') {
            const deckIntersects = this.raycaster.intersectObjects(this.renderer.deckGroup.children);
            if (deckIntersects.length > 0) {
                const mesh = deckIntersects[0].object;
                if (mesh.userData.type === 'deck' || mesh.userData.type === 'choice') {
                    this.dragSource = mesh.userData.type;
                    this.dragSourceMesh = mesh;
                    this.createGhostCard(mesh);                    
                    // Setup interaction plane for ghost
                    const viewDir = new THREE.Vector3();
                    this.renderer.camera.getWorldDirection(viewDir);
                    const liftVector = viewDir.clone().multiplyScalar(-2.5); 
                    this.renderer.interactionPlane.position.copy(this.ghostCard.position).add(liftVector);
                    this.renderer.interactionPlane.updateMatrixWorld();
                }
            }
        }
    }

    createGhostCard(sourceMesh) {
        this.ghostCard = sourceMesh.clone();
        this.ghostCard.material = Array.isArray(sourceMesh.material) ? sourceMesh.material.map(m => m.clone()) : sourceMesh.material.clone();
        
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
        if (this.isDragging && this.draggedCardMesh) {
            const oldIndex = this.draggedCardMesh.userData.index;
            const cardPos2D = new THREE.Vector2(this.draggedCardMesh.position.x, this.draggedCardMesh.position.z);
            const choicePos2D = new THREE.Vector2(CHOICE_POS.x, CHOICE_POS.z);
            
            // Only allow discard if it's the correct turn step
            if (this.game.turnStep === 'DISCARD' && cardPos2D.distanceTo(choicePos2D) < DISCARD_ZONE_RADIUS) {
                this.isWaitingForServer = true;
                this.lockedDiscardMesh = this.draggedCardMesh;
                this.callbacks.discardCard(oldIndex, this.draggedCardMesh.position.clone(), this.draggedCardMesh.quaternion.clone());
                
                this.isDragging = false;
                this.draggedCardMesh = null;
            } else {
                // Not discard time, or not in zone - just reorder
                const newIndex = this.hoverIndex;
                if (newIndex !== -1 && newIndex !== oldIndex) {
                    this.game.reorderHand(oldIndex, newIndex);
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
                
                if (this.isDragging && mesh === this.draggedCardMesh) {
                    mesh.renderOrder = 1000;
                } else {
                    mesh.renderOrder = targetIndex + 1;
                }
            }
        });
    }
}
