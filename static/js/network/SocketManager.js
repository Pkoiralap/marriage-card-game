export class SocketManager {
    constructor(gameId, playerName, onStateUpdate, onAction) {
        this.gameId = gameId;
        this.playerName = playerName;
        this.onStateUpdate = onStateUpdate;
        this.onAction = onAction;
        this.socket = null;
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        this.socket = new WebSocket(protocol + window.location.host + '/ws/game/' + this.gameId + '/');

        this.socket.onopen = (e) => {
            console.log("Connection established");
            this.send({ type: 'join', player_name: this.playerName });
            this.send({ type: 'get_game_state', player_name: this.playerName });
        };

        this.socket.onmessage = (e) => {
            const data = JSON.parse(e.data);
            const message = JSON.parse(data.message);
            if (message.type === 'game_state') {
                this.onStateUpdate(message.state);
            } else if (message.type === 'ai_action' || message.type === 'game_action' || message.type === 'player_action') {
                // Ensure all action message types are handled
                if (this.onAction) this.onAction(message.action);
            } else if (message.type === 'refresh_state') {
                this.send({ type: 'get_game_state', player_name: this.playerName });
            }
        };

        this.socket.onclose = (e) => {
            console.error('Chat socket closed unexpectedly');
            // F4: prefer themed toast if available; reload shortly after so the
            // user can see the message instead of an abrupt jump.
            if (typeof window !== 'undefined' && typeof window.toast === 'function') {
                window.toast("Connection lost. Returning to home…", 'error');
                setTimeout(() => location.reload(), 1200);
            } else {
                alert("Connection lost. Returning to home.");
                location.reload();
            }
        };
    }

    pickCard(source, targetIndex = null) {
        this.send({ type: 'pick_card', player_name: this.playerName, source: source, target_index: targetIndex });
    }

    discardCard(cardIndex, cardId = null) {
        // card_id is the source of truth server-side (robust to hand-order
        // drift from reorders); card_index is kept as a fallback.
        this.send({ type: 'discard_card', player_name: this.playerName, card_index: cardIndex, card_id: cardId });
    }

    registerSequence(sequenceId, cardIndices) {
        this.send({ type: 'register_sequence', player_name: this.playerName, sequence_id: sequenceId, card_indices: cardIndices });
    }

    registerTunnela(cardIndices) {
        this.send({ type: 'register_tunnela', player_name: this.playerName, card_indices: cardIndices });
    }

    registerDublee(cardIndices) {
        this.send({ type: 'register_dublee', player_name: this.playerName, card_indices: cardIndices });
    }

    cancelSequence() {
        this.send({ type: 'cancel_sequence', player_name: this.playerName });
    }

    confirmMaal(cardId) {
        this.send({ type: 'select_maal', player_name: this.playerName, card_id: cardId });
    }

    reorderHand(oldIndex, newIndex) {
        this.send({ type: 'reorder_hand', player_name: this.playerName, old_index: oldIndex, new_index: newIndex });
    }

    claimGame() {
        this.send({ type: 'claim_game', player_name: this.playerName });
    }

    // bug3: validate one group of cards during the claim flow (dirty melds OK).
    registerClaim(cardIndices) {
        this.send({ type: 'register_claim', player_name: this.playerName, card_indices: cardIndices });
    }

    // S1: start a fresh round in the same room (cumulative points preserved).
    playAgain() {
        this.send({ type: 'play_again', player_name: this.playerName });
    }

    // F1: send a cosmetic gesture/emote. Server validates against the GESTURES
    // allowlist and broadcasts a GESTURE action to everyone.
    sendGesture(gesture) {
        this.send({ type: 'gesture', player_name: this.playerName, gesture: gesture });
    }

    // Peek: consent to (or revoke) my right neighbour seeing my hand.
    setPeek(allow) {
        this.send({ type: 'set_peek', player_name: this.playerName, allow: !!allow });
    }

    // Peek: ask to start/stop receiving my left neighbour's hand (the server
    // only sends it while I'm asking AND they've consented).
    requestPeek(want) {
        this.send({ type: 'request_peek', player_name: this.playerName, want: !!want });
    }

    // F2: send a quick-chat phrase (validated server-side against CHAT_PHRASES).
    sendChat(phraseId) {
        this.send({ type: 'chat', player_name: this.playerName, phrase_id: phraseId });
    }

    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ 'message': JSON.stringify(data) }));
        }
    }
}