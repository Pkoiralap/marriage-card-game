import { Game } from '../models/Game.js';
import { Renderer } from '../engine/Renderer.js';
import { InputHandler } from '../engine/InputHandler.js';
import { SocketManager } from '../network/SocketManager.js';
import { UIManager } from '../ui/UIManager.js';

import { DECK_POS, CHOICE_POS, HAND_CENTER_POS } from '../utils/Constants.js';

export class GameController {
    constructor() {
        this.game = new Game();
        this.ui = new UIManager({
            startGame: (gameId, playerName) => this.startGame(gameId, playerName)
        });
        this.renderer = null;
        this.inputHandler = null;
        this.socket = null;
        
        this.isAnimating = false;
        this.wasManualPick = false;
        this.wasManualDiscard = false;
        this.lastDiscardTransform = null;
        this.stateQueue = [];
        this.actionQueue = [];
        
        // Check if there is a game_id in URL
        this.checkUrlForGame();
    }

    checkUrlForGame() {
        const pathParts = window.location.pathname.split('/');
        const gameIdx = pathParts.indexOf('game');
        if (gameIdx !== -1 && pathParts[gameIdx + 1]) {
            const gameId = pathParts[gameIdx + 1];
            setTimeout(() => {
                const playerName = prompt("Enter your name to join the game:");
                if (playerName) {
                    this.startGame(gameId, playerName);
                } else {
                    window.location.href = '/';
                }
            }, 500);
        }
    }

    startGame(gameId, playerName) {
        this.game.id = gameId;
        this.game.setPlayer(playerName);
        this.ui.showGame();
        
        const newUrl = `/game/${gameId}/`;
        if (window.location.pathname !== newUrl) {
            window.history.pushState({ gameId }, `Game ${gameId}`, newUrl);
        }
        
        const gameContainer = document.getElementById('game-container');
        this.renderer = new Renderer(gameContainer);
        this.inputHandler = new InputHandler(this.renderer, this.game, {
            pickCard: (source, index) => {
                if (this.isAnimating) return;
                this.wasManualPick = true;
                this.socket.pickCard(source, index);
            },
            discardCard: (index, pos, quat) => {
                if (this.isAnimating) return;
                this.wasManualDiscard = true;
                this.lastDiscardTransform = { pos, quat };
                this.socket.discardCard(index);
            }
        });
        
        this.socket = new SocketManager(gameId, playerName, (state) => {
            this.stateQueue.push(state);
            this.processQueues();
        }, (action) => {
            this.actionQueue.push(action);
            this.processQueues();
        });
        
        this.socket.connect();
        this.animate();
    }

    async processQueues() {
        if (this.isAnimating) return;

        // Prioritize AI Actions over state refreshes for smoother animation flow
        if (this.actionQueue.length > 0) {
            const action = this.actionQueue.shift();
            await this.handleAIAction(action);
            return;
        }

        if (this.stateQueue.length > 0) {
            const state = this.stateQueue.shift();
            await this.handleStateUpdate(state);
        }
    }

    async handleStateUpdate(state) {
        const oldHandSize = this.game.me.hand.length;
        const newHandSize = state.hand ? state.hand.length : oldHandSize;
        const oldVisiblesSize = this.game.visibles.length;
        const newVisiblesSize = state.visibles ? state.visibles.length : oldVisiblesSize;

        let handledManualAction = false;

        // 1. Update Hand meshes immediately
        if (state.hand && this.game.me) {
            const oldHandMap = new Map(this.game.me.hand.map(c => [c.id, c]));
            this.game.me.updateHand(state.hand, this.renderer.threeRenderer);
            
            if (this.wasManualPick && this.inputHandler.ghostCard) {
                const newCardObj = this.game.me.hand.find(c => !oldHandMap.has(c.id));
                if (newCardObj && newCardObj.mesh) {
                    newCardObj.mesh.position.copy(this.inputHandler.ghostCard.position);
                    newCardObj.mesh.quaternion.copy(this.inputHandler.ghostCard.quaternion);
                    this.inputHandler.settlingMesh = newCardObj.mesh;
                }
                this.inputHandler.cleanupDrag();
                this.wasManualPick = false;
                handledManualAction = true;
            }

            if (this.wasManualDiscard) {
                this.inputHandler.cleanupDrag();
                this.wasManualDiscard = false;
                handledManualAction = true;
            }

            this.renderer.updateCards(this.game.me.getHandMeshes());
        }

        // 2. Handle Animations
        if (handledManualAction) {
            const numAddedToTable = newVisiblesSize - oldVisiblesSize;
            if (this.lastDiscardTransform && numAddedToTable > 0) {
                const discardedCard = state.visibles[oldVisiblesSize];
                const target = this.calculateTableTarget(newVisiblesSize, state.visibles);
                this.isAnimating = true;
                this.renderer.animateCard(this.lastDiscardTransform.pos, target.pos, discardedCard, false, () => {
                    this.isAnimating = false;
                    this.applyState(state);
                    this.processQueues();
                }, target.quat, this.lastDiscardTransform.quat);
                this.lastDiscardTransform = null;
            } else {
                this.applyState(state);
                this.processQueues();
            }
        } else {
            this.applyState(state);
            this.processQueues();
        }
    }

    async handleAIAction(action) {
        const myIndex = this.game.getMyIndex();
        if (myIndex === -1) return;

        // Anti-clockwise relative index: 
        // If myIndex=0: AI 3->0 (Right), AI 2->1 (Top), AI 1->2 (Left)
        let relativeIndex = (myIndex - action.player_index - 1);
        while (relativeIndex < 0) relativeIndex += this.game.players.length;
        relativeIndex = relativeIndex % (this.game.players.length); 

        const oppPos = this.renderer.getOpponentPosition(relativeIndex, this.game.players.length - 1);
        oppPos.y = 2.5; // Height of opponent hands

        if (action.type === 'ai_pick') {
            const sourcePos = action.source === 'choice' ? CHOICE_POS.clone() : DECK_POS.clone();
            if (action.source === 'choice') {
                sourcePos.y += (this.game.visibles.length * 0.02);
            } else {
                sourcePos.y += (this.game.stockPileCount / 5 * 0.05);
            }

            this.isAnimating = true;
            this.renderer.animateCard(sourcePos, oppPos, action.card, action.source === 'deck', () => {
                this.isAnimating = false;
                this.processQueues();
            });
        } else if (action.type === 'ai_discard') {
            const target = this.calculateTableTarget(this.game.visibles.length + 1, [...this.game.visibles, action.card]);

            this.isAnimating = true;
            this.renderer.animateCard(oppPos, target.pos, action.card, false, () => {
                this.isAnimating = false;
                this.processQueues();
            }, target.quat);
        }
    }

    calculateTableTarget(totalVisibles, visiblesList) {
        const maxVisible = 5;
        const globalIndex = totalVisibles - 1;
        const fanIndex = (totalVisibles > maxVisible) ? (maxVisible - 1) : (totalVisibles - 1);
        const offset = (globalIndex % maxVisible) * 0.4;
        const rotOffset = ((globalIndex % maxVisible) - (maxVisible - 1) / 2) * 0.1;
        
        const pos = CHOICE_POS.clone();
        pos.x += offset;
        pos.y += fanIndex * 0.02;
        
        const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, rotOffset));
        return { pos, quat };
    }

    applyState(state) {
        this.game.updateState(state, this.renderer.threeRenderer);
        if (this.game.phase === 'PLAYING') {
            this.renderer.removeMarkers();
        }
        this.renderer.updateCards(this.game.me.getHandMeshes());
        this.renderer.updateDeck(this.game.stockPileCount);
        this.renderer.updateChoiceCard(this.game.visibles);
        this.renderer.addOpponents();
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.inputHandler) this.inputHandler.animate();
        if (this.renderer) this.renderer.render();
    }
}
