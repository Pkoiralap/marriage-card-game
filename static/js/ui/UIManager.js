import { getCookie } from '../utils/Helpers.js';

export class UIManager {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.homeContainer = document.getElementById('home-container');
        this.gameContainer = document.getElementById('game-container');
        
        // Panels
        this.gameControls = document.getElementById('game-controls');
        this.sequenceControls = document.getElementById('sequence-controls');

        // Modals
        this.createModal = document.getElementById('create-modal');
        this.joinModal = document.getElementById('join-modal');
        this.maalModal = document.getElementById('maal-modal');

        // Inputs
        this.createPlayerNameInput = document.getElementById('create-player-name');
        this.createNumPlayersInput = document.getElementById('create-num-players');
        this.joinPlayerNameInput = document.getElementById('join-player-name');
        this.joinGameIdInput = document.getElementById('join-game-id');

        // Maal State
        this.selectedMaalCardId = null;

        this.initEventListeners();
    }

    initEventListeners() {
        document.getElementById('show-create-modal-btn')?.addEventListener('click', () => {
            this.createModal.style.display = 'flex';
            this.createPlayerNameInput.focus();
        });

        document.getElementById('show-join-modal-btn')?.addEventListener('click', () => {
            this.joinModal.style.display = 'flex';
            this.joinGameIdInput.focus();
        });

        document.getElementById('cancel-create-btn')?.addEventListener('click', () => {
            this.createModal.style.display = 'none';
        });

        document.getElementById('cancel-join-btn')?.addEventListener('click', () => {
            this.joinModal.style.display = 'none';
        });

        document.getElementById('show-sequence-btn')?.addEventListener('click', () => {
            this.showSequenceControls();
            if (this.callbacks.onShowSequenceMode) this.callbacks.onShowSequenceMode(true);
        });

        document.getElementById('show-tunnela-btn')?.addEventListener('click', () => {
            this.showSequenceControls();
            if (this.callbacks.onShowSequenceMode) this.callbacks.onShowSequenceMode(true, 'TUNNELA');
        });

        document.getElementById('show-dublee-btn')?.addEventListener('click', () => {
            this.showSequenceControls();
            if (this.callbacks.onShowSequenceMode) this.callbacks.onShowSequenceMode(true, 'DUBLEE');
        });

        document.getElementById('cancel-sequence-btn')?.addEventListener('click', () => {
            this.hideSequenceControls();
            if (this.callbacks.onShowSequenceMode) this.callbacks.onShowSequenceMode(false);
        });

        document.getElementById('validate-seq-btn')?.addEventListener('click', () => {
            if (this.callbacks.onRegisterSequence) this.callbacks.onRegisterSequence();
        });

        document.getElementById('claim-game-btn')?.addEventListener('click', () => {
            if (this.callbacks.onClaimGame) this.callbacks.onClaimGame();
        });

        document.getElementById('confirm-maal-btn')?.addEventListener('click', () => {
            if (this.selectedMaalCardId !== null && this.callbacks.onConfirmMaal) {
                this.callbacks.onConfirmMaal(this.selectedMaalCardId);
                this.maalModal.style.display = 'none';
            } else {
                alert("Please select a card first!");
            }
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

    showSequenceControls() {
        this.gameControls.style.display = 'none';
        this.sequenceControls.style.display = 'flex';
    }

    hideSequenceControls() {
        this.gameControls.style.display = 'flex';
        this.sequenceControls.style.display = 'none';
    }

    setPhase(phase, showAllowed, turnCount) {
        const showSeqBtn = document.getElementById('show-sequence-btn');
        const showTunBtn = document.getElementById('show-tunnela-btn');
        const showDubBtn = document.getElementById('show-dublee-btn');
        const claimGameBtn = document.getElementById('claim-game-btn');

        if (phase === 'MAAL_REVEALED') {
            if (showSeqBtn) showSeqBtn.style.display = 'block'; // Can still show sequences in phase 2
            if (showTunBtn) showTunBtn.style.display = 'none';
            if (showDubBtn) showDubBtn.style.display = 'none';
            if (claimGameBtn) claimGameBtn.style.display = 'block';
        } else {
            if (showSeqBtn) showSeqBtn.style.display = showAllowed ? 'block' : 'none';
            if (showTunBtn) showTunBtn.style.display = (showAllowed && turnCount === 0) ? 'block' : 'none';
            if (showDubBtn) showDubBtn.style.display = (showAllowed && turnCount === 0) ? 'block' : 'none';
            if (claimGameBtn) claimGameBtn.style.display = 'none';
        }
    }

    showMaalModal(unseenCards) {
        const container = document.getElementById('maal-card-list');
        container.innerHTML = '';
        this.selectedMaalCardId = null;

        // Add a range slider at the top
        const sliderContainer = document.createElement('div');
        sliderContainer.style.width = '100%';
        sliderContainer.style.padding = '0 20px';
        sliderContainer.style.marginBottom = '20px';
        
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = (unseenCards.length - 1).toString();
        slider.value = '0';
        slider.style.width = '100%';
        sliderContainer.appendChild(slider);
        container.parentElement.insertBefore(sliderContainer, container);

        unseenCards.forEach((card, index) => {
            const item = document.createElement('div');
            item.className = 'card-slider-item';
            item.dataset.id = card.id;
            item.dataset.index = index;
            
            // Cards should be "unseen" - so show back design
            item.style.backgroundColor = '#2c3e50';
            item.style.backgroundImage = 'repeating-linear-gradient(45deg, #34495e, #34495e 10px, #2c3e50 10px, #2c3e50 20px)';
            item.innerHTML = `
                <div style="color: rgba(255,255,255,0.2); font-size: 2rem;">?</div>
            `;

            item.onclick = () => {
                document.querySelectorAll('.card-slider-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                this.selectedMaalCardId = card.id;
                slider.value = index;
            };

            container.appendChild(item);
        });

        slider.oninput = () => {
            const index = parseInt(slider.value);
            const items = document.querySelectorAll('.card-slider-item');
            const targetItem = items[index];
            if (targetItem) {
                targetItem.click();
                targetItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        };

        this.maalModal.style.display = 'flex';
    }
}
