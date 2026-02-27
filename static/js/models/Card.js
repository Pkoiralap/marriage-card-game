import { CARD_WIDTH, CARD_HEIGHT, CARD_THICKNESS } from '../utils/Constants.js';
import { createCardTexture, createCardBackTexture } from '../utils/Helpers.js';

export class Card {
    constructor(suit, number, renderer) {
        this.suit = suit;
        this.number = number;
        this.color = (suit === 'HEART' || suit === 'DIAMOND') ? 'red' : 'black';
        this.id = suit + number;
        this.renderer = renderer;
        
        // Game Logic Properties
        this.isMaal = false;
        this.isWild = false;
        this.pointValue = 0;
        this.isTiplu = false;
        
        this.mesh = this.createMesh();
    }

    setGameRole(role) {
        this.isMaal = role.isMaal || false;
        this.isWild = role.isWild || false;
        this.pointValue = role.pointValue || 0;
        this.isTiplu = role.isTiplu || false;
        
        // Potential visual update for maal cards (e.g., a glow or border)
        if (this.isMaal) {
            // this.mesh.material...
        }
    }

    createMesh() {
        const texture = createCardTexture(this.number, this.suit, this.color, this.renderer);
        const backTexture = createCardBackTexture(this.renderer);
        
        const geometry = new THREE.BoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_THICKNESS);
        
        const frontMaterial = new THREE.MeshBasicMaterial({ 
            map: texture,
            transparent: true
        });
        
        const backMaterial = new THREE.MeshBasicMaterial({ 
            map: backTexture,
            transparent: true
        });
        
        const sideMaterial = new THREE.MeshBasicMaterial({ 
            color: 0xeeeeee
        });

        const materials = [
            sideMaterial, // right
            sideMaterial, // left
            sideMaterial, // top
            sideMaterial, // bottom
            frontMaterial, // front
            backMaterial   // back
        ];

        const mesh = new THREE.Mesh(geometry, materials);
        mesh.userData.card = this;
        return mesh;
    }

    setIndex(index) {
        this.mesh.userData.index = index;
    }

    getIndex() {
        return this.mesh.userData.index;
    }

    dispose() {
        if (this.mesh.geometry) this.mesh.geometry.dispose();
        if (this.mesh.material) {
            if (Array.isArray(this.mesh.material)) {
                this.mesh.material.forEach(m => m.dispose());
            } else {
                this.mesh.material.dispose();
            }
        }
    }
}
