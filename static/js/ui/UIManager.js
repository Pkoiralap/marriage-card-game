import { getCookie } from '../utils/Helpers.js';

export class UIManager {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.homeContainer = document.getElementById('home-container');
        this.gameContainer = document.getElementById('game-container');
        
        // Modals
        this.createModal = document.getElementById('create-modal');
        this.joinModal = document.getElementById('join-modal');

        // Inputs
        this.createPlayerNameInput = document.getElementById('create-player-name');
        this.createNumPlayersInput = document.getElementById('create-num-players');
        this.joinPlayerNameInput = document.getElementById('join-player-name');
        this.joinGameIdInput = document.getElementById('join-game-id');

        this.initEventListeners();
    }

    initEventListeners() {
        document.getElementById('show-create-modal-btn')?.addEventListener('click', () => {
            this.createModal.style.display = 'flex';
            this.createPlayerNameInput.focus();
        });

        document.getElementById('show-join-modal-btn')?.addEventListener('click', () => {
            this.joinModal.style.display = 'flex';
            this.joinPlayerNameInput.focus();
        });

        document.getElementById('cancel-create-btn')?.addEventListener('click', () => {
            this.createModal.style.display = 'none';
        });

        document.getElementById('cancel-join-btn')?.addEventListener('click', () => {
            this.joinModal.style.display = 'none';
        });

        window.onclick = (event) => {
            if (event.target == this.createModal) this.createModal.style.display = "none";
            if (event.target == this.joinModal) this.joinModal.style.display = "none";
        };

        document.getElementById('confirm-create-btn')?.addEventListener('click', async () => {
            const playerName = this.createPlayerNameInput.value.trim();
            const numPlayers = parseInt(this.createNumPlayersInput.value);
            if (!playerName) return alert("Please enter your name");

            try {
                const response = await fetch('/create_game/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
                    body: JSON.stringify({ player_name: playerName, num_players: numPlayers })
                });
                const data = await response.json();
                if (data.game_id) {
                    this.createModal.style.display = 'none';
                    this.callbacks.startGame(data.game_id, playerName);
                } else alert("Failed to create game");
            } catch (error) {
                console.error(error); alert("Error connecting to server");
            }
        });

        document.getElementById('confirm-join-btn')?.addEventListener('click', () => {
            const playerName = this.joinPlayerNameInput.value.trim();
            const gameId = this.joinGameIdInput.value.trim();
            if (!playerName || !gameId) return alert("Please enter both name and Game ID");
            
            this.joinModal.style.display = 'none';
            this.callbacks.startGame(gameId, playerName);
        });
    }

    showGame() {
        this.homeContainer.style.display = 'none';
        this.gameContainer.style.display = 'block';
    }
}
