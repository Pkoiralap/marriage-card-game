import { Card } from './Card.js';

export class Player {
    constructor(name, isMe = false) {
        this.name = name;
        this.isMe = isMe;
        this.hand = [];
        this.points = 0;
        
        // Game State Logic
        this.pureSets = [];
        this.dirtySets = [];
        this.maalPoints = 0;
        this.hasShownPure = false;
    }

    updateHand(cardData, renderer) {
        const newHand = [];
        const existingHandMap = new Map();
        this.hand.forEach(card => existingHandMap.set(card.id, card));

        cardData.forEach((data, index) => {
            const id = data.id !== undefined ? data.id : (data.suit + data.number);
            let card = existingHandMap.get(id);
            if (!card) {
                card = new Card(data.suit, data.number, renderer);
                if (data.id !== undefined) card.id = data.id;
            }
            
            // Sync game roles from backend data if provided
            if (data.role) {
                card.setGameRole(data.role);
            }

            card.setIndex(index);
            newHand.push(card);
            existingHandMap.delete(id);
        });

        // Dispose cards no longer in hand
        existingHandMap.forEach(card => card.dispose());

        this.hand = newHand;
        this.calculateMaal();
    }

    calculateMaal() {
        this.maalPoints = this.hand.reduce((total, card) => total + (card.pointValue || 0), 0);
    }

    addPureSet(cards) {
        this.pureSets.push(cards);
        if (this.pureSets.length >= 3) this.hasShownPure = true;
    }

    getHandMeshes() {
        return this.hand.map(card => card.mesh);
    }
}
