export class SocketManager {
    constructor(gameId, playerName, onStateUpdate, onAIAction) {
        this.gameId = gameId;
        this.playerName = playerName;
        this.onStateUpdate = onStateUpdate;
        this.onAIAction = onAIAction;
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
            } else if (message.type === 'ai_action') {
                if (this.onAIAction) this.onAIAction(message.action);
            } else if (message.type === 'refresh_state') {
                this.send({ type: 'get_game_state', player_name: this.playerName });
            }
        };

        this.socket.onclose = (e) => {
            console.error('Chat socket closed unexpectedly');
            alert("Connection lost. Returning to home.");
            location.reload();
        };
    }

    pickCard(source, targetIndex = null) {
        this.send({ type: 'pick_card', player_name: this.playerName, source: source, target_index: targetIndex });
    }

    discardCard(cardIndex) {
        this.send({ type: 'discard_card', player_name: this.playerName, card_index: cardIndex });
    }

    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ 'message': JSON.stringify(data) }));
        }
    }
}
