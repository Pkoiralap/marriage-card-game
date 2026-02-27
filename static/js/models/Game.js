import { Player } from './Player.js';

export class Game {
    constructor() {
        this.id = null;
        this.me = null;
        this.opponents = [];
        this.turnPlayerIndex = 0;
        this.numPlayers = 4;
        this.isStarted = false;
        
        // Game State Logic
        this.phase = 'DEALING'; // 'DEALING', 'PURE_SETS', 'DIRTY_SETS', 'ENDING'
        this.turnStep = 'PICK'; // 'PICK', 'DISCARD'
        this.tiplu = null; // The Main Maal Card
        this.stockPileCount = 156;
        this.discardPile = [];
        this.visibles = [];
        this.choiceCard = null;
    }

    setPlayer(name) {
        this.me = new Player(name, true);
    }

    setTiplu(cardData) {
        this.tiplu = cardData;
    }

    setPhase(phase) {
        this.phase = phase;
    }

    updateState(state, renderer) {
        console.log("Game state update:", state);
        if (state.hand && this.me) {
            this.me.updateHand(state.hand, renderer);
        }
        if (state.points !== undefined && this.me) {
            this.me.points = state.points;
        }
        
        // Update game context
        if (state.phase) this.phase = state.phase;
        if (state.tiplu) this.tiplu = state.tiplu;
        if (state.stock_count !== undefined) this.stockPileCount = state.stock_count;
        if (state.deck_count !== undefined) this.stockPileCount = state.deck_count;
        if (state.visibles !== undefined) this.visibles = state.visibles;
        if (state.choice_card !== undefined) this.choiceCard = state.choice_card;
        if (state.turn_player_index !== undefined) this.turnPlayerIndex = state.turn_player_index;
        if (state.turn_step !== undefined) this.turnStep = state.turn_step;
    }

    reorderHand(oldIndex, newIndex) {
        if (!this.me) return;
        const card = this.me.hand.splice(oldIndex, 1)[0];
        this.me.hand.splice(newIndex, 0, card);
        
        // Update indices
        this.me.hand.forEach((card, i) => card.setIndex(i));
    }
}
