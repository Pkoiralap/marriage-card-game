import { Game } from '../models/Game.js';
import { Renderer } from '../engine/Renderer.js';
import { InputHandler } from '../engine/InputHandler.js';
import { SocketManager } from '../network/SocketManager.js';
import { UIManager } from '../ui/UIManager.js';

import { DECK_POS, CHOICE_POS, HAND_CENTER_POS } from '../utils/Constants.js';

export class GameController {
    constructor() {
        this.game = new Game();
        this.showMode = 'SEQUENCE'; // 'SEQUENCE', 'TUNNELA', 'DUBLEE'
        this.ui = new UIManager({
            startGame: (gameId, playerName) => this.startGame(gameId, playerName),
            onShowSequenceMode: (enabled, mode = 'SEQUENCE') => {
                this.showMode = mode;
                if (this.inputHandler) this.inputHandler.setSelectionMode(enabled);
                if (!enabled) this.socket.cancelSequence();
            },
            onRegisterSequence: () => {
                if (this.inputHandler) {
                    const indices = this.inputHandler.getSelectedIndices();
                    if (this.showMode === 'SEQUENCE') {
                        if (indices.length < 3 || indices.length > 5) {
                            alert("Select 3-5 cards for a sequence");
                            return;
                        }
                        const sequenceId = (this.game.me.shownSequences ? this.game.me.shownSequences.length : 0) + 1;
                        this.socket.registerSequence(sequenceId, indices);
                    } else if (this.showMode === 'TUNNELA') {
                        if (indices.length !== 3) {
                            alert("Select exactly 3 cards for a tunnela");
                            return;
                        }
                        this.socket.registerTunnela(indices);
                    } else if (this.showMode === 'DUBLEE') {
                        if (indices.length !== 2) {
                            alert("Select exactly 2 cards for a dublee");
                            return;
                        }
                        this.socket.registerDublee(indices);
                    }
                }
            },
            onConfirmMaal: (cardId) => {
                this.socket.confirmMaal(cardId);
            },
            onClaimGame: () => {
                if (this.game.me.hand.length === 1) {
                    this.socket.claimGame();
                } else {
                    alert("You must have only 1 card remaining to claim the game");
                }
            }
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
            },
            reorderHand: (oldIndex, newIndex) => {
                this.socket.reorderHand(oldIndex, newIndex);
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
        this.logMessage("Game started! Waiting for players...");
    }

    async processQueues() {
        if (this.isAnimating) return;

        // Prioritize actions over state refreshes for smoother animation flow
        if (this.actionQueue.length > 0) {
            const action = this.actionQueue.shift();
            await this.handleAction(action);
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
            this.syncRegisteredIndices();
        }

        // 2. Handle Animations
        if (handledManualAction) {
            const numAddedToTable = newVisiblesSize - oldVisiblesSize;
            if (this.lastDiscardTransform && numAddedToTable > 0) {
                const discardedCard = state.visibles[newVisiblesSize - 1];
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

    syncRegisteredIndices() {
        try {
            if (!this.inputHandler || !this.game.me || !Array.isArray(this.game.me.shownSequences)) return;
            this.inputHandler.registeredIndices.clear();
            
            const hand = this.game.me.hand;
            const registeredCards = this.game.me.shownSequences.flat();
            const registeredIds = new Set(registeredCards.map(c => c.id));
            
            hand.forEach((card, index) => {
                if (registeredIds.has(card.id)) {
                    this.inputHandler.registeredIndices.add(index);
                    if (card.mesh) {
                        this.renderer.highlightMesh(card.mesh, 0x4caf50);
                    }
                } else if (card.mesh) {
                    this.renderer.highlightMesh(card.mesh, null);
                }
            });
        } catch (e) {
            console.error("Error in syncRegisteredIndices:", e);
        }
    }

    async handleAction(action) {
        const myIndex = this.game.getMyIndex();
        if (myIndex === -1) return;

        // Log the action
        this.logAction(action);

        const isMe = (action.player_name === this.game.me.name);
        
        // If it's my own action and I've already handled it locally, just skip animation
        if (isMe && (this.wasManualPick || this.wasManualDiscard)) {
            this.processQueues();
            return;
        }

        // Anti-clockwise relative index: 
        let relativeIndex = (myIndex - action.player_index - 1);
        while (relativeIndex < 0) relativeIndex += this.game.players.length;
        relativeIndex = relativeIndex % (this.game.players.length); 

        const oppPos = isMe ? HAND_CENTER_POS.clone() : this.renderer.getOpponentPosition(relativeIndex, this.game.players.length - 1);
        if (!isMe) oppPos.y = 2.5; 

        if (action.type.includes('pick')) {
            const sourcePos = action.source === 'choice' ? CHOICE_POS.clone() : DECK_POS.clone();
            let existingMesh = null;

            if (action.source === 'choice') {
                sourcePos.y += (this.game.visibles.length * 0.02);
                if (action.card && action.card.id !== undefined) {
                    existingMesh = this.renderer.extractCardMesh(action.card.id);
                }
                if (this.game.visibles.length > 0) {
                    this.game.visibles.pop();
                    this.renderer.updateChoiceCard(this.game.visibles);
                }
            } else {
                sourcePos.y += (this.game.stockPileCount / 5 * 0.05);
                if (this.game.stockPileCount > 0) {
                    this.game.stockPileCount--;
                    this.renderer.updateDeck(this.game.stockPileCount);
                }
            }

            this.isAnimating = true;
            this.renderer.animateCard(sourcePos, oppPos, action.card, action.source === 'deck' && !isMe, () => {
                this.isAnimating = false;
                this.processQueues();
            }, null, null, existingMesh);
        } else if (action.type.includes('discard')) {
            const target = this.calculateTableTarget(this.game.visibles.length + 1, [...this.game.visibles, action.card]);

            this.isAnimating = true;
            this.renderer.animateCard(oppPos, target.pos, action.card, false, () => {
                this.isAnimating = false;
                this.processQueues();
            }, target.quat);
        }

        // Handle special action types for UI updates
        if (action.type === 'SHOW_SEQUENCE_SUCCESS') {
            if (isMe) {
                this.logMessage(`Sequence verified!`);
                
                this.inputHandler.selectedIndices.clear();
                // State update will trigger syncRegisteredIndices which highlights the cards

                if (action.all_sequences_done) {
                    this.ui.hideSequenceControls();
                    this.inputHandler.setSelectionMode(false);
                    if (action.needs_maal_selection) {
                        this.ui.showMaalModal(action.unseen_cards);
                    }
                }
            } else {
                this.logMessage(`<span class="log-player">${action.player_name}</span> showed a sequence!`);
            }
        } else if (action.type === 'SHOW_SEQUENCE_CANCEL') {
            if (isMe) {
                this.game.me.shownSequences = [];
                this.syncRegisteredIndices();
                this.updateShownSequencesUI();
            }
        } else if (action.type === 'SHOW_TUNNELA_SUCCESS') {
            this.logMessage(`<span class="log-player">${action.player_name}</span> showed a Tunnela!`);
            if (isMe) {
                this.inputHandler.selectedIndices.clear();
                this.ui.hideSequenceControls();
                this.inputHandler.setSelectionMode(false);
            }
        } else if (action.type === 'SHOW_DUBLEE_SUCCESS') {
            this.logMessage(`<span class="log-player">${action.player_name}</span> showed a Dublee!`);
            if (isMe) {
                this.inputHandler.selectedIndices.clear();
                if (action.all_sequences_done) {
                    this.ui.hideSequenceControls();
                    this.inputHandler.setSelectionMode(false);
                    if (action.needs_maal_selection) {
                        this.ui.showMaalModal(action.unseen_cards);
                    }
                }
            }
        } else if (action.type === 'MAAL_SELECTED') {
            this.game.maalCard = action.card;
            this.logMessage(`<span class="log-player">${action.player_name}</span> has set the Maal card!`);
            this.renderer.updateMaalCard(action.card);
        } else if (action.type === 'GAME_CLAIMED') {
            alert(action.message);
            location.reload();
        }
    }

    updateShownSequencesUI() {
        const container = document.getElementById('shown-sequences-container');
        if (!container) return;
        
        container.innerHTML = '';
        const sequences = this.game.me.shownSequences;
        if (!sequences) return;

        const validSequences = sequences.filter(s => s && s.length > 0);
        
        if (validSequences.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        validSequences.forEach((seq, i) => {
            const seqBox = document.createElement('div');
            seqBox.className = 'sequence-box';
            
            const title = document.createElement('div');
            title.className = 'sequence-title';
            title.innerText = `Sequence ${i + 1}`;
            seqBox.appendChild(title);
            
            const cardsDiv = document.createElement('div');
            cardsDiv.className = 'sequence-cards';
            
            seq.forEach(card => {
                const cardEl = document.createElement('div');
                cardEl.className = 'mini-card';
                const suitSymbols = { 'HEART': '♥', 'DIAMOND': '♦', 'SPADE': '♠', 'CLUB': '♣' };
                const suitClass = (card.suit === 'HEART' || card.suit === 'DIAMOND') ? 'suit-HEART' : 'suit-SPADE';
                cardEl.innerHTML = `
                    <div class="${suitClass}">${card.number}</div>
                    <div class="${suitClass}">${suitSymbols[card.suit]}</div>
                `;
                cardsDiv.appendChild(cardEl);
            });
            
            seqBox.appendChild(cardsDiv);
            container.appendChild(seqBox);
        });
    }

    logAction(action) {
        let message = "";
        const playerName = `<span class="log-player">${action.player_name}</span>`;
        let cardName = "a card";
        if (action.card && action.card.number) {
            cardName = `<span class="log-card">${action.card.number} of ${action.card.suit}</span>`;
        }
        if (action.type.includes('pick')) {
            const source = action.source === 'choice' ? 'the choice pile' : 'the deck';
            message = `${playerName} picked ${cardName} from ${source}`;
        } else if (action.type.includes('discard')) {
            message = `${playerName} discarded ${cardName}`;
        }
        if (message) this.logMessage(message);
    }

    logMessage(message) {
        const logContainer = document.getElementById('game-log');
        if (!logContainer) return;
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.innerHTML = message;
        logContainer.prepend(entry);
        while (logContainer.children.length > 50) {
            logContainer.removeChild(logContainer.lastChild);
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
        if (this.game.phase === 'PLAYING' || this.game.phase === 'MAAL_REVEALED') {
            this.renderer.removeMarkers();
        }
        this.ui.setPhase(this.game.phase, state.show_sequence_allowed, state.turn_count);
        this.renderer.updateCards(this.game.me.getHandMeshes());
        this.renderer.updateDeck(this.game.stockPileCount);
        this.renderer.updateChoiceCard(this.game.visibles);
        this.renderer.addOpponents();
        
        if (state.maal_card) {
            this.game.maalCard = state.maal_card;
            this.renderer.updateMaalCard(state.maal_card);
        }
        this.syncRegisteredIndices();
        this.updateShownSequencesUI();
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.inputHandler) this.inputHandler.animate();
        if (this.renderer) this.renderer.render();
    }
}