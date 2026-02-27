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
        
        // Check if there is a game_id in URL
        this.checkUrlForGame();
    }

    checkUrlForGame() {
        const pathParts = window.location.pathname.split('/');
        // URL is /game/<uuid>/
        const gameIdx = pathParts.indexOf('game');
        if (gameIdx !== -1 && pathParts[gameIdx + 1]) {
            const gameId = pathParts[gameIdx + 1];
            // Ask for name since we don't have it on refresh
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
        
        // Update URL without refreshing
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
            const oldHandSize = this.game.me.hand.length;
            const newHandSize = state.hand ? state.hand.length : oldHandSize;
            const oldVisiblesSize = this.game.visibles.length;
            const newVisiblesSize = state.visibles ? state.visibles.length : oldVisiblesSize;

            let handledManualAction = false;

            // 1. Update Hand meshes and cleanup drag state
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
                    const discardedCard = state.visibles[oldVisiblesSize];
                    const numAdded = newVisiblesSize - oldVisiblesSize;
                    
                    if (this.lastDiscardTransform && numAdded > 0) {
                        const target = this.calculateTableTarget(newVisiblesSize, state.visibles);
                        this.isAnimating = true;
                        this.renderer.animateCard(this.lastDiscardTransform.pos, target.pos, discardedCard, false, () => {
                            if (numAdded > 1) {
                                const extraCard = state.visibles[state.visibles.length - 1];
                                this.renderer.animateCard(DECK_POS, CHOICE_POS, extraCard, false, () => {
                                    this.isAnimating = false;
                                    this.applyState(state);
                                });
                            } else {
                                this.isAnimating = false;
                                this.applyState(state);
                            }
                        }, target.quat, this.lastDiscardTransform.quat);
                    }
                    
                    this.inputHandler.cleanupDrag();
                    this.wasManualDiscard = false;
                    handledManualAction = true;
                }

                this.renderer.updateCards(this.game.me.getHandMeshes());
            }

            // 2. Handle Animations for Table/Deck
            const numAddedToTable = newVisiblesSize - oldVisiblesSize;

            if (handledManualAction) {
                if (this.lastDiscardTransform && numAddedToTable > 0) {
                    // Animate the card we just threw
                    const discardedCard = state.visibles[oldVisiblesSize];
                    const target = this.calculateTableTarget(newVisiblesSize, state.visibles);

                    this.isAnimating = true;
                    this.renderer.animateCard(this.lastDiscardTransform.pos, target.pos, discardedCard, false, () => {
                        // Check if an extra card was added (e.g. deck flip)
                        if (numAddedToTable > 1) {
                            const extraCard = state.visibles[state.visibles.length - 1];
                            this.renderer.animateCard(DECK_POS, CHOICE_POS, extraCard, false, () => {
                                this.isAnimating = false;
                                this.applyState(state);
                            });
                        } else {
                            this.isAnimating = false;
                            this.applyState(state);
                        }
                    }, target.quat, this.lastDiscardTransform.quat);
                    this.lastDiscardTransform = null;
                } else {
                    this.applyState(state);
                }
            } else if (newHandSize > oldHandSize && oldHandSize > 0) {
                // Someone else picked or server-side pick
                const pickedCard = state.hand[state.hand.length - 1];
                const wasChoice = oldVisiblesSize > newVisiblesSize;
                const sourcePos = wasChoice ? CHOICE_POS : DECK_POS;
                this.isAnimating = true;
                this.renderer.animateCard(sourcePos, HAND_CENTER_POS, pickedCard, !wasChoice, () => {
                    this.isAnimating = false;
                    this.applyState(state);
                });
            } else if (numAddedToTable > 0) {
                // Someone else discarded
                const discardedCard = state.visibles[state.visibles.length - 1];
                const opponentPos = new THREE.Vector3(0, 5, -15);
                this.isAnimating = true;
                this.renderer.animateCard(opponentPos, CHOICE_POS, discardedCard, false, () => {
                    this.isAnimating = false;
                    this.applyState(state);
                });
            } else {
                this.applyState(state);
            }
        });
        
        this.socket.connect();
        this.animate();
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
        
        // Remove table markers once game is in PLAYING phase
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
