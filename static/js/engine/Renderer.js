import { TABLE_RADIUS, OPPONENT_TABLE_RADIUS, CARD_WIDTH, CARD_HEIGHT, CARD_THICKNESS, DECK_POS, CHOICE_POS, DISCARD_ZONE_RADIUS } from '../utils/Constants.js';
import { createCardBackTexture, createCardTexture } from '../utils/Helpers.js';

export class Renderer {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x2c3e50);
        
        this.activeAnimations = [];
        this.markers = [];
        
        this.cardsGroup = new THREE.Group();
        this.opponentsGroup = new THREE.Group();
        this.deckGroup = new THREE.Group();
        this.animationGroup = new THREE.Group();
        this.scene.add(this.cardsGroup);
        this.scene.add(this.opponentsGroup);
        this.scene.add(this.deckGroup);
        this.scene.add(this.animationGroup);

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
        const d = 18;
        this.camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
        this.camera.position.set(25, 40, 25);
        this.camera.lookAt(0, 0, 0); 
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
        const d = 14; 
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
        const stackHeight = Math.min(20, Math.ceil(stockPileCount / 5));
        if (this.deckGroup.children.filter(m => m.userData.type === 'deck').length === stackHeight) return;
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
    }

    updateChoiceCard(visibles) {
        if (!visibles) return;

        // Use a differential update for visibles too to prevent flicker
        const maxVisible = 5;
        const cardsToShow = visibles.slice(-maxVisible);
        const newIds = new Set(cardsToShow.map(c => c.id));

        // Remove old ones
        this.deckGroup.children.filter(m => (m.userData.type === 'choice' || m.userData.type === 'discard')).forEach(m => {
            if (!newIds.has(m.userData.card.id)) {
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

    animateCard(sourcePos, targetPos, cardData, isFaceDown, onComplete, targetQuat = null, sourceQuat = null) {
        const geometry = new THREE.BoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_THICKNESS);
        const backTexture = createCardBackTexture(this.threeRenderer);
        const sideMaterial = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
        const backMaterial = new THREE.MeshBasicMaterial({ map: backTexture, transparent: true });
        
        let frontMaterial;
        if (cardData && !isFaceDown) {
            const color = (cardData.suit === 'HEART' || cardData.suit === 'DIAMOND') ? 'red' : 'black';
            const texture = createCardTexture(cardData.number, cardData.suit, color, this.threeRenderer);
            frontMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
        } else {
            // Face down or no data - use back texture for front side too
            frontMaterial = backMaterial;
        }

        const materials = [sideMaterial, sideMaterial, sideMaterial, sideMaterial, frontMaterial, backMaterial];
        const mesh = new THREE.Mesh(geometry, materials);
        mesh.renderOrder = 1000; // Always in front
        // Keep depthTest enabled so it feels like it's in the world, but use high renderOrder
        
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
        
        this.animationGroup.add(mesh);

        const anim = {
            mesh,
            startTime: performance.now(),
            duration: 600, // Increased for smoother feel
            startPos: sourcePos.clone(),
            targetPos: targetPos.clone(),
            startQuat: sourceQuat ? sourceQuat.clone() : mesh.quaternion.clone(),
            targetQuat: targetQuat ? targetQuat.clone() : null,
            onComplete,
            isFaceDown
        };
        
        this.activeAnimations.push(anim);
    }

    addOpponents() {
        if (this.opponentsGroup.children.length > 0) return;
        
        const numOpponents = 3; 
        const tableRadius = OPPONENT_TABLE_RADIUS; 
        for (let i = 0; i < numOpponents; i++) {
            const pos = this.getOpponentPosition(i, numOpponents);
            const oppGeo = new THREE.SphereGeometry(2, 32, 32);
            const oppMat = new THREE.MeshStandardMaterial({ color: 0xe74c3c });
            const opponent = new THREE.Mesh(oppGeo, oppMat);
            opponent.position.copy(pos);
            opponent.position.y = 2;
            opponent.castShadow = true;
            this.opponentsGroup.add(opponent);
            
            const handSize = 8;
            for (let j = 0; j < handSize; j++) {
                const cGeo = new THREE.BoxGeometry(1.5, 2.1, 0.05);
                const cMat = new THREE.MeshStandardMaterial({ map: createCardBackTexture(this.threeRenderer) });
                const cMesh = new THREE.Mesh(cGeo, cMat);
                const cx = pos.x * 0.85 + (j - handSize/2) * 0.4; 
                const cz = pos.z * 0.85 + (j - handSize/2) * 0.4; 
                cMesh.position.set(cx, 2.5, cz);
                cMesh.lookAt(0, 2.5, 0); 
                cMesh.rotation.y += Math.PI; 
                cMesh.castShadow = true;
                this.opponentsGroup.add(cMesh);
            }
        }
    }

    getOpponentPosition(index, totalOpponents = 3) {
        const totalPlayers = totalOpponents + 1;
        const angleStep = (Math.PI * 2) / totalPlayers;
        const offset = Math.PI/totalPlayers;
        
        const angle = (-Math.PI / 2) + (index + 1) * angleStep + offset;
        
        const x = Math.cos(angle) * OPPONENT_TABLE_RADIUS * 0.9;
        // In Three.js, negative Z is 'up' (away from camera)
        const z = -Math.sin(angle) * OPPONENT_TABLE_RADIUS * 0.9; 
        return new THREE.Vector3(x, 0, z);
    }
}
