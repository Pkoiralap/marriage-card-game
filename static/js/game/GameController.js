import { Game } from '../models/Game.js';
import { Renderer } from '../engine/Renderer.js';
import { InputHandler } from '../engine/InputHandler.js';
import { SocketManager } from '../network/SocketManager.js';
import { UIManager } from '../ui/UIManager.js';

import { DECK_POS, CHOICE_POS } from '../utils/Constants.js';

// F2: client mirror of game/emotes.py CHAT_PHRASES (id + display text). The
// server is the source of truth and re-validates ids; this only drives the
// quick-chat picker buttons. Keep in sync with the Python allowlist.
const CHAT_PHRASES = [
    { id: 'ohno', text: 'Oh no!' },
    { id: 'gotcha', text: 'Gotcha!' },
    { id: 'iwin', text: 'I win!' },
    { id: 'yourturn', text: 'Your turn' },
    { id: 'nice', text: 'Nice!' },
    { id: 'soclose', text: 'So close' },
    { id: 'wellplayed', text: 'Well played' },
    { id: 'hurryup', text: 'Hurry up!' },
    { id: 'oops', text: 'Oops' },
    { id: 'gg', text: 'GG' },
    { id: 'hello', text: 'Hello!' },
    { id: 'thanks', text: 'Thanks!' },
];

export class GameController {
    constructor() {
        this.game = new Game();
        this.showMode = 'SEQUENCE'; // 'SEQUENCE', 'TUNNELA', 'DUBLEE'
        this.ui = new UIManager({
            startGame: (gameId, playerName) => this.startGame(gameId, playerName),
            onShowSequenceMode: (enabled, mode = 'SEQUENCE') => {
                if (enabled) this.showMode = mode;
                if (this.inputHandler) this.inputHandler.setSelectionMode(enabled);
                if (!enabled) {
                    // Cancel: in claim mode just drop the validated groups (do NOT
                    // send cancel_sequence — that would clear the shown sequences).
                    if (this.showMode === 'CLAIM') {
                        this.claimedCardIds.clear();
                        this.syncRegisteredIndices();
                    } else {
                        this.socket.cancelSequence();
                    }
                    this.showMode = 'SEQUENCE';
                }
            },
            onRegisterSequence: () => {
                if (!this.inputHandler) return;
                const indices = this.inputHandler.getSelectedIndices();
                if (this.showMode === 'CLAIM') {
                    // bug3: validate one meld group toward a claim. Dirty melds
                    // (same-rank sets, runs, tunnelas, wild-filled) are 3+ cards.
                    if (indices.length < 3 || indices.length > 5) {
                        this.notify("Select 3-5 cards for a set/sequence", 'warn');
                        return;
                    }
                    this.socket.registerClaim(indices);
                } else if (this.showMode === 'SEQUENCE') {
                    if (indices.length < 3 || indices.length > 5) {
                        this.notify("Select 3-5 cards for a sequence", 'warn');
                        return;
                    }
                    const sequenceId = (this.game.me.shownSequences ? this.game.me.shownSequences.length : 0) + 1;
                    this.socket.registerSequence(sequenceId, indices);
                } else if (this.showMode === 'TUNNELA') {
                    if (indices.length !== 3) {
                        this.notify("Select exactly 3 cards for a tunnela", 'warn');
                        return;
                    }
                    this.socket.registerTunnela(indices);
                } else if (this.showMode === 'DUBLEE') {
                    if (indices.length !== 2) {
                        this.notify("Select exactly 2 cards for a dublee", 'warn');
                        return;
                    }
                    this.socket.registerDublee(indices);
                }
            },
            onConfirmMaal: (cardId) => {
                this.socket.confirmMaal(cardId);
            },
            // bug3: "Claim Game" now opens an interactive flow — organise your
            // hand into validated melds (dirty sequences allowed via the maal
            // jokers). When all but one card is grouped, "Claim Now!" appears.
            onClaimGame: () => {
                this.showMode = 'CLAIM';
                this.claimedCardIds.clear();
                this.syncRegisteredIndices();
                if (this.inputHandler) this.inputHandler.setSelectionMode(true);
                this.ui.enterClaimControls();
                this.notify("Validate each set/sequence, leave 1 card, then Claim Now!", 'info');
            },
            onConfirmClaim: () => {
                if (this.socket) this.socket.claimGame();
            },
            // F1: send a cosmetic gesture/emote. The server broadcasts it back as
            // a GESTURE action which handleAction maps to the right avatar slot.
            onGesture: (gesture) => {
                if (this.socket) this.socket.sendGesture(gesture);
            },
            // Peek: toggle whether my RIGHT neighbour may rotate the table to see
            // my hand. Server refreshes so the change takes effect immediately.
            onTogglePeek: (allow) => {
                if (this.socket) this.socket.setPeek(allow);
            }
        });
        this.renderer = null;
        this.inputHandler = null;
        this.socket = null;
        
        this.isAnimating = false;
        this.wasManualPick = false;
        this.wasManualDiscard = false;
        this.lastDiscardTransform = null;
        // Single FIFO of {kind:'state'|'action', data} processed in ARRIVAL order.
        // The server sends a move's resulting state before broadcasting the next
        // player's action, so strict ordering keeps animations consistent.
        // (A previous two-queue design drained all actions before any state,
        // which animated the next player's pick before the prior discard had
        // landed on the board — cards appeared to fly to the wrong place.)
        this.eventQueue = [];
        this.claimedCardIds = new Set();  // bug3: card ids validated into claim melds

        // Check if there is a game_id in URL
        this.checkUrlForGame();
    }

    // User-facing notification. Prefers window.toast (feature-detected), falls
    // back to alert so behavior is preserved if the toast helper isn't loaded.
    notify(message, type = 'info') {
        if (typeof window !== 'undefined' && typeof window.toast === 'function') {
            window.toast(message, type);
        } else {
            alert(message);
        }
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
                if (this.isAnimating) return false;
                this.wasManualPick = true;
                this.socket.pickCard(source, index);
                return true;
            },
            discardCard: (index, pos, quat, cardId = null) => {
                if (this.isAnimating) return false;
                this.wasManualDiscard = true;
                this.lastDiscardTransform = { pos, quat };
                this.socket.discardCard(index, cardId);
                return true;
            },
            reorderHand: (oldIndex, newIndex) => {
                this.socket.reorderHand(oldIndex, newIndex);
            },
            // Peek: ask the server for (or stop receiving) the left neighbour's
            // hand. The server only honours it if they've consented; the next
            // state push carries their real cards (or clears them).
            requestPeek: (want) => {
                if (this.socket) this.socket.requestPeek(want);
            }
        });
        
        this.socket = new SocketManager(gameId, playerName, (state) => {
            this.eventQueue.push({ kind: 'state', data: state });
            this.processQueues();
        }, (action) => {
            this.eventQueue.push({ kind: 'action', data: action });
            this.processQueues();
        });
        
        this.socket.connect();
        this.setupQuickChat();  // F2: build the quick-chat picker buttons
        this.animate();
        this.logMessage(`Game started! Share code <span class="log-card">${gameId}</span> for others to join.`);
    }

    async processQueues() {
        if (this.isAnimating) return;
        if (this.eventQueue.length === 0) return;

        const ev = this.eventQueue.shift();
        try {
            // Strict arrival order: a move's state is applied before the next
            // player's action animates, so the board is always consistent.
            if (ev.kind === 'action') {
                await this.handleAction(ev.data);
            } else {
                await this.handleStateUpdate(ev.data);
            }
        } catch (e) {
            // A thrown action/state must NOT permanently freeze the queue (that
            // leaves isAnimating stuck and the table half-rendered). Recover and
            // keep draining; the failing item was already shifted off the queue.
            console.error('processQueues error:', e);
            this.isAnimating = false;
            if (this.eventQueue.length) this.processQueues();
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
            
            if (this.wasManualPick) {
                // Drag pick: settle the new card from the ghost's position.
                // Tap pick (touch): no ghost — just let the card appear in hand.
                if (this.inputHandler.ghostCard) {
                    const newCardObj = this.game.me.hand.find(c => !oldHandMap.has(c.id));
                    if (newCardObj && newCardObj.mesh) {
                        newCardObj.mesh.position.copy(this.inputHandler.ghostCard.position);
                        newCardObj.mesh.quaternion.copy(this.inputHandler.ghostCard.quaternion);
                        this.inputHandler.settlingMesh = newCardObj.mesh;
                    }
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
            // bug3: claim-validated cards are also "locked" (highlighted, can't be
            // re-selected) while building a claim.
            const registeredIds = new Set([
                ...registeredCards.map(c => c.id),
                ...this.claimedCardIds,
            ]);

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

        // F1: cosmetic gesture/emote. Maps the sender to their opponent avatar
        // slot and plays the gesture there. Self has no avatar, so a gesture from
        // me is just acknowledged (no avatar to animate). Returns early — a
        // gesture never animates cards or advances the board.
        if (action.type === 'GESTURE') {
            const slot = this.getAvatarSlotForPlayer(action.player_name);
            if (slot !== -1) this.renderer.triggerGesture(slot, action.gesture);
            this.processQueues();
            return;
        }

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

        const oppPos = isMe ? this.renderer.getHandCenter() : this.renderer.getOpponentPosition(relativeIndex, this.game.players.length - 1);
        if (!isMe) oppPos.y = 2.5; 

        if (action.type.includes('pick')) {
            const sourcePos = action.source === 'choice' ? CHOICE_POS.clone() : DECK_POS.clone();
            let existingMesh = null;

            if (action.source === 'choice') {
                // Pick the SPECIFIC card by id and fly it from where it actually
                // sits — robust to a momentarily-stale board (the picked card may
                // be a discard that just landed, possibly out of order in MP).
                const mesh = (action.card && action.card.id !== undefined)
                    ? this.renderer.extractCardMesh(action.card.id) : null;
                if (mesh) {
                    existingMesh = mesh;
                    sourcePos.copy(mesh.position);  // deckGroup is at origin -> world pos
                    // Remove exactly this card (not a blind pop of the top).
                    const idx = this.game.visibles.findIndex(c => c.id === action.card.id);
                    if (idx !== -1) this.game.visibles.splice(idx, 1);
                    this.renderer.updateChoiceCard(this.game.visibles);
                } else {
                    // Card isn't rendered yet (state lagging behind this action):
                    // animate from the top and let the next state reconcile the
                    // pile rather than corrupting visibles with a wrong pop.
                    sourcePos.y += (this.game.visibles.length * 0.02);
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
        } else if (action.type === 'CLAIM_GROUP_SUCCESS') {
            // bug3: a meld group validated toward a claim. Lock those cards in
            // (highlighted), clear the selection, and reveal "Claim Now!" once
            // exactly one card remains ungrouped.
            if (isMe) {
                (action.card_ids || []).forEach(id => this.claimedCardIds.add(id));
                this.inputHandler.selectedIndices.clear();
                this.syncRegisteredIndices();
                const remaining = this.game.me.hand.length - this.claimedCardIds.size;
                this.ui.setClaimReady(remaining === 1);
                this.logMessage(remaining === 1
                    ? `Group validated — 1 card left, you can Claim Now!`
                    : `Group validated — ${remaining} cards left to group.`);
            }
        } else if (action.type.endsWith('_FAILED')) {
            // Server rejected a show/claim group. Keep the player in selection
            // mode with their cards still selected so they can fix it.
            this.notify(action.reason || "That selection isn't valid.", 'error');
        } else if (action.type === 'MAAL_SELECTED') {
            this.game.maalCard = action.card;
            this.logMessage(`<span class="log-player">${action.player_name}</span> has set the Maal card!`);
            this.renderer.updateMaalCard(action.card);
        } else if (action.type === 'GAME_CLAIMED') {
            // S1: end of round. Show winner + standings; "Play again" re-deals a
            // fresh round in the same room (cumulative points preserved) instead
            // of reloading the page.
            const myName = this.game.me ? this.game.me.name : null;
            const iWon = action.player_name && myName && action.player_name === myName;
            const title = iWon ? 'You won! 🎉' : 'Round over';
            let msg = action.message
                || (action.player_name ? `${action.player_name} claimed the round.` : 'The round has ended.');
            const standings = action.results && action.results.standings;
            if (Array.isArray(standings) && standings.length) {
                const lines = standings.map(s =>
                    `${s.rank}. ${s.name}: ${s.total_points} pts (+${s.round_points})`);
                msg = msg + '\n' + lines.join('\n');
            }
            const playAgain = () => {
                if (this.socket) {
                    this.ui.hideGameBanner ? this.ui.hideGameBanner() : null;
                    this.socket.playAgain();
                } else {
                    location.reload();
                }
            };
            const shown = this.ui.showGameBanner(
                title, msg, iWon ? 'win' : 'lose', playAgain
            );
            this.ui.hideTurnIndicator();
            if (!shown) {
                this.notify(msg, iWon ? 'success' : 'info');
            }
        } else if (action.type === 'NEW_ROUND') {
            // S1: a fresh round was dealt. Dismiss the banner; the refresh_state
            // that follows broadcast_action re-fetches everyone's new hand.
            if (this.ui.hideGameBanner) this.ui.hideGameBanner();
            this.logMessage(action.message || 'A new round has started.');
            this.notify(action.message || 'New round started.', 'info');
        } else if (action.type === 'CHAT') {
            // F2: a quick-chat line. Show a bubble over the speaker (opponents
            // only; mapped player->slot like getOpponentAvatarSeeds) AND log it.
            this.handleChat(action);
        }

        // Keep the queue draining for non-animating actions (e.g. CLAIM_GROUP_*,
        // which have no following state refresh). No-op while an animation runs.
        if (!this.isAnimating) this.processQueues();
    }

    // F2: render an incoming CHAT action — speech bubble + chat log entry.
    handleChat(action) {
        const text = action.text || '';
        this.appendChatLog(action.player_name, text);

        // Bubble: map the speaker to a renderer avatar slot. Opponents only
        // (my own avatar isn't rendered). Slot i corresponds to seat
        // (me-1-i) mod N, the inverse of getOpponentAvatarSeeds()'s mapping.
        const slot = this.getSlotForPlayer(action.player_name);
        if (slot !== -1 && this.renderer) {
            this.renderer.setAvatarLabel(slot, text);
            // Best-effort paired gesture (feature-detected: triggerGesture is a
            // no-op for an unknown gesture name).
            if (action.gesture && this.renderer.triggerGesture) {
                this.renderer.triggerGesture(slot, action.gesture);
            }
            // Auto-clear the bubble after ~4s. Keyed per slot so a newer line
            // cancels the previous timer.
            this._chatBubbleTimers = this._chatBubbleTimers || {};
            clearTimeout(this._chatBubbleTimers[slot]);
            this._chatBubbleTimers[slot] = setTimeout(() => {
                if (this.renderer) this.renderer.setAvatarLabel(slot, null);
            }, 4000);
        }
    }

    // F2: inverse of getOpponentAvatarSeeds() seat mapping. Returns the render
    // slot for an opponent's player_name, or -1 (e.g. my own name / not found).
    getSlotForPlayer(playerName) {
        const N = this.game.players.length;
        const me = this.game.getMyIndex();
        if (N <= 1 || me === -1) return -1;
        for (let i = 0; i < N - 1; i++) {
            const seat = (((me - 1 - i) % N) + N) % N;
            const p = this.game.players[seat];
            if (p && p.name === playerName) return i;
        }
        return -1;
    }

    appendChatLog(playerName, text) {
        const panel = document.getElementById('chat-panel');
        if (!panel) return;
        const entry = document.createElement('div');
        entry.className = 'chat-entry';
        const who = playerName === (this.game.me && this.game.me.name) ? 'You' : playerName;
        // F2: build via textContent, never innerHTML. player_name is user-chosen
        // and NOT server-sanitized, so interpolating it into innerHTML is an XSS
        // sink (e.g. a player named "<img src=x onerror=...>" would execute for
        // everyone else on every chat). text is allowlisted but still set safely.
        const author = document.createElement('span');
        author.className = 'chat-author';
        author.textContent = who;
        entry.appendChild(author);
        entry.appendChild(document.createTextNode(text));
        panel.prepend(entry);
        while (panel.children.length > 30) panel.removeChild(panel.lastChild);
    }

    // F2: build the quick-chat picker (one button per CHAT_PHRASE). Each button
    // sends the phrase id; the server validates and broadcasts it back to all.
    setupQuickChat() {
        const picker = document.getElementById('chat-quick');
        if (!picker || picker.dataset.built) return;
        picker.dataset.built = '1';
        CHAT_PHRASES.forEach(p => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'chat-quick-btn';
            btn.textContent = p.text;
            btn.addEventListener('click', () => {
                if (this.socket) this.socket.sendChat(p.id);
                // Close the picker after sending (mirrors the emote menu).
                document.getElementById('chat-box')?.classList.remove('chat-open');
            });
            picker.appendChild(btn);
        });
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

    // Avatar preset for each opponent, in the renderer's slot order. Slot i maps
    // to the seat that handleAction also uses as relative index i, so an avatar
    // lines up with the player whose moves animate at that position.
    getOpponentAvatarSeeds() {
        const N = this.game.players.length;
        if (N <= 1) return [];
        const me = this.game.getMyIndex();
        const seeds = [];
        for (let i = 0; i < N - 1; i++) {
            let seed = i;
            if (me !== -1) {
                const seat = (((me - 1 - i) % N) + N) % N;
                const p = this.game.players[seat];
                if (p && p.avatar != null) seed = p.avatar;
            }
            seeds.push(seed);
        }
        return seeds;
    }

    // F1: inverse of getOpponentAvatarSeeds' seat->slot mapping. Given a player
    // name, return the renderer avatar slot showing that opponent, or -1 if it's
    // me (no avatar) or the player isn't found. Slot i is seeded from seat
    // (me-1-i) mod N, so seat s -> slot (me-1-s) mod N (valid only for s != me).
    getAvatarSlotForPlayer(playerName) {
        const N = this.game.players.length;
        if (N <= 1) return -1;
        const me = this.game.getMyIndex();
        const seat = this.game.players.findIndex(p => p.name === playerName);
        if (seat === -1 || seat === me || me === -1) return -1;
        return (((me - 1 - seat) % N) + N) % N;
    }

    applyState(state) {
        this.game.updateState(state, this.renderer.threeRenderer);
        // Deck/choice meshes get rebuilt here, so drop any stale tap-arm.
        // Guarded so a stale cached InputHandler can never break rendering.
        if (this.inputHandler && this.inputHandler.clearArmed) this.inputHandler.clearArmed();
        if (this.game.phase === 'PLAYING' || this.game.phase === 'MAAL_REVEALED') {
            this.renderer.removeMarkers();
        }
        this.ui.setPhase(this.game.phase, state.show_sequence_allowed, state.turn_count);

        // --- Rendering FIRST: never let diagnostics/anything below block it. ---
        this.renderer.updateCards(this.game.me.getHandMeshes());
        this.renderer.updateDeck(this.game.stockPileCount);
        this.renderer.updateChoiceCard(this.game.visibles);
        this.renderer.addOpponents(this.getOpponentAvatarSeeds());

        // Peek: render opponents' held fans live. The left neighbour (rendered at
        // the last/screen-left opponent slot) shows real faces when they've
        // consented — state.peek_hand carries their hand, else null -> backs.
        const numOpp = Math.max(0, this.game.players.length - 1);
        this.renderer.updateOpponentHands(numOpp, numOpp - 1, state.peek_hand || null);
        if (this.ui.setPeekState) this.ui.setPeekState(!!state.peek_allowed);

        if (state.maal_card) {
            this.game.maalCard = state.maal_card;
            this.renderer.updateMaalCard(state.maal_card);
        }
        this.syncRegisteredIndices();
        this.updateShownSequencesUI();
        this.ui.updateTurnIndicator(this.game);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        // Watchdog: if an animation stalls (e.g. a backgrounded/throttled mobile
        // tab loses a completion callback), isAnimating sticks true and the queue
        // freezes on stale state — looking like "permanently not my turn". Force
        // recovery after 3s so state updates resume. Normal animations are ~600ms.
        if (this.isAnimating) {
            this._animSince = this._animSince || performance.now();
            if (performance.now() - this._animSince > 3000) {
                this.isAnimating = false;
                this._animSince = null;
                this.processQueues();
            }
        } else {
            this._animSince = null;
        }

        // S3: tick the turn countdown ~2x/sec while a deadline is pending, so
        // the #turn-indicator seconds stay live between server state pushes.
        if (this.game && this.game.turnDeadline) {
            const now = performance.now();
            if (!this._lastTurnTick || now - this._lastTurnTick > 500) {
                this._lastTurnTick = now;
                try { this.ui.updateTurnIndicator(this.game); } catch (e) { /* best-effort */ }
            }
        }

        if (this.inputHandler) this.inputHandler.animate();
        if (this.renderer) this.renderer.render();
    }
}