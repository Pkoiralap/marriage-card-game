import { getCookie } from '../utils/Helpers.js';

// Feature-detect window.toast (installed by utils/Toast.js); fall back to alert.
const notify = (msg, type = 'info') =>
    (typeof window !== 'undefined' && typeof window.toast === 'function')
        ? window.toast(msg, type)
        : alert(msg);

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
        this.seatConfigContainer = document.getElementById('seat-config');
        this.joinPlayerNameInput = document.getElementById('join-player-name');
        this.joinGameIdInput = document.getElementById('join-game-id');
        this.ongoingGamesContainer = document.getElementById('ongoing-games');

        // Maal State
        this.selectedMaalCardId = null;

        this.initEventListeners();
    }

    initEventListeners() {
        document.getElementById('show-create-modal-btn')?.addEventListener('click', () => {
            this.createModal.style.display = 'flex';
            this.renderSeatConfig();
            this.createPlayerNameInput.focus();
        });

        this.createNumPlayersInput?.addEventListener('change', () => this.renderSeatConfig());
        this.createPlayerNameInput?.addEventListener('input', () => this.syncCreatorSeatName());

        document.getElementById('show-join-modal-btn')?.addEventListener('click', () => {
            this.joinModal.style.display = 'flex';
            this.loadOngoingGames();
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
                notify("Please select a card first!", 'warn');
            }
        });

        // F1: emote menu. Toggle opens the grid; each gesture button fires the
        // onGesture callback (wired to SocketManager.sendGesture) and closes it.
        const emoteControls = document.getElementById('emote-controls');
        document.getElementById('emote-toggle')?.addEventListener('click', () => {
            if (emoteControls) emoteControls.classList.toggle('emote-open');
        });
        document.querySelectorAll('.emote-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const gesture = btn.dataset.gesture;
                if (gesture && this.callbacks.onGesture) this.callbacks.onGesture(gesture);
                if (emoteControls) emoteControls.classList.remove('emote-open');
            });
        });

        window.onclick = (event) => {
            if (event.target == this.createModal) this.createModal.style.display = "none";
            if (event.target == this.joinModal) this.joinModal.style.display = "none";
        };

        document.getElementById('confirm-create-btn')?.addEventListener('click', async () => {
            const playerName = this.createPlayerNameInput.value.trim();
            if (!playerName) return notify("Please enter your name", 'warn');

            const seats = this.gatherSeats(playerName);
            try {
                const response = await fetch('/create_game/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
                    body: JSON.stringify({ player_name: playerName, num_players: seats.length, seats })
                });
                const data = await response.json();
                if (data.code || data.game_id) {
                    this.createModal.style.display = 'none';
                    // Share the short code so others can join this game.
                    this.callbacks.startGame(data.code || data.game_id, playerName);
                } else notify("Failed to create game", 'error');
            } catch (error) {
                console.error(error); notify("Error connecting to server", 'error');
            }
        });

        document.getElementById('confirm-join-btn')?.addEventListener('click', () => {
            const playerName = this.joinPlayerNameInput.value.trim();
            const gameId = this.joinGameIdInput.value.trim();
            if (!playerName || !gameId) return notify("Please enter both name and Game ID", 'warn');
            
            this.joinModal.style.display = 'none';
            this.callbacks.startGame(gameId, playerName);
        });
    }

    // --- create-game seat configuration ------------------------------------
    // Seat 0 is always the creator (you, human). Other seats default to an
    // alternating pattern so that every other player is an AI.
    renderSeatConfig() {
        const container = this.seatConfigContainer;
        if (!container) return;
        const numPlayers = parseInt(this.createNumPlayersInput.value) || 4;

        // Preserve any choices the user already made when the count changes.
        const previous = this.gatherSeats(this.createPlayerNameInput.value.trim() || 'You');
        container.innerHTML = '';

        for (let i = 0; i < numPlayers; i++) {
            const row = document.createElement('div');
            row.className = 'seat-row';
            row.dataset.seat = i;

            const label = document.createElement('span');
            label.className = 'seat-label';

            if (i === 0) {
                label.textContent = 'Player 1 (You)';
                row.appendChild(label);
                row.dataset.type = 'HUMAN';
                const you = document.createElement('span');
                you.className = 'seat-you';
                you.textContent = 'Human';
                row.appendChild(you);
                container.appendChild(row);
                continue;
            }

            label.textContent = `Player ${i + 1}`;
            row.appendChild(label);

            const select = document.createElement('select');
            select.className = 'seat-type form-control';
            for (const t of ['HUMAN', 'AI']) {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t === 'AI' ? 'AI' : 'Human';
                select.appendChild(opt);
            }
            // Default: every other seat is AI (odd seats), unless we have a
            // remembered choice for this seat from before a count change.
            const remembered = previous[i];
            select.value = remembered ? remembered.type : (i % 2 === 1 ? 'AI' : 'HUMAN');

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'seat-name form-control';
            nameInput.placeholder = `Player ${i + 1}`;
            nameInput.value = (remembered && remembered.name) ? remembered.name : '';

            const syncNameVisibility = () => {
                nameInput.style.display = select.value === 'HUMAN' ? 'block' : 'none';
            };
            select.addEventListener('change', syncNameVisibility);
            syncNameVisibility();

            row.appendChild(select);
            row.appendChild(nameInput);
            container.appendChild(row);
        }
    }

    syncCreatorSeatName() {
        const firstLabel = this.seatConfigContainer?.querySelector('.seat-row[data-seat="0"] .seat-label');
        const name = this.createPlayerNameInput.value.trim();
        if (firstLabel) firstLabel.textContent = name ? `${name} (You)` : 'Player 1 (You)';
    }

    // Returns [{type, name}] in seat order; seat 0 is the creator.
    gatherSeats(creatorName) {
        const rows = this.seatConfigContainer
            ? Array.from(this.seatConfigContainer.querySelectorAll('.seat-row'))
            : [];
        if (rows.length === 0) {
            // Fallback if the config wasn't rendered: creator + alternating AI.
            const n = parseInt(this.createNumPlayersInput.value) || 4;
            return Array.from({ length: n }, (_, i) =>
                i === 0 ? { type: 'HUMAN', name: creatorName }
                        : { type: i % 2 === 1 ? 'AI' : 'HUMAN', name: '' });
        }
        return rows.map((row, i) => {
            if (i === 0) return { type: 'HUMAN', name: creatorName };
            const type = row.querySelector('.seat-type')?.value || 'AI';
            const name = row.querySelector('.seat-name')?.value.trim() || '';
            return { type, name: type === 'HUMAN' ? name : '' };
        });
    }

    // --- join: list of ongoing games with open seats -----------------------
    async loadOngoingGames() {
        const container = this.ongoingGamesContainer;
        if (!container) return;
        container.innerHTML = '<div class="ongoing-empty">Loading…</div>';
        try {
            const resp = await fetch('/games/');
            const data = await resp.json();
            this.renderOngoingGames(data.games || []);
        } catch (e) {
            container.innerHTML = '<div class="ongoing-empty">Could not load games.</div>';
        }
    }

    renderOngoingGames(games) {
        const container = this.ongoingGamesContainer;
        container.innerHTML = '';
        if (games.length === 0) {
            container.innerHTML = '<div class="ongoing-empty">No open games right now.</div>';
            return;
        }
        games.forEach(game => {
            const row = document.createElement('div');
            row.className = 'ongoing-game';

            const code = document.createElement('span');
            code.className = 'ongoing-code';
            code.textContent = game.code;
            row.appendChild(code);

            const seats = document.createElement('div');
            seats.className = 'ongoing-seats';
            game.open_seats.forEach(name => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'seat-chip';
                chip.textContent = name;
                chip.addEventListener('click', () => {
                    // Joining takes the seat under its assigned name.
                    this.joinGameIdInput.value = game.code;
                    this.joinPlayerNameInput.value = name;
                });
                seats.appendChild(chip);
            });
            row.appendChild(seats);
            container.appendChild(row);
        });
    }

    showGame() {
        this.homeContainer.style.display = 'none';
        this.gameContainer.style.display = 'block';
    }

    // --- in-game HUD: turn indicator ---------------------------------------
    // Updates the top-center pill. Called from GameController on each state.
    updateTurnIndicator(game) {
        const el = document.getElementById('turn-indicator');
        if (!el || !game || !game.players || game.players.length === 0) {
            if (el) el.style.display = 'none';
            return;
        }
        if (game.phase === 'DEALING') {
            el.classList.remove('your-turn');
            el.textContent = 'Dealing…';
            el.style.display = 'block';
            return;
        }
        const myTurn = game.isMyTurn();
        const active = game.players[game.turnPlayerIndex];
        const handCount = (game.me && game.me.hand) ? game.me.hand.length : null;
        const points = (game.me && game.me.points != null) ? game.me.points : null;

        let label;
        if (myTurn) {
            const step = game.turnStep === 'DISCARD' ? 'Discard a card' : 'Your turn';
            label = step;
        } else {
            label = `${active && active.name ? active.name : 'Opponent'}'s turn`;
        }
        const meta = [];
        if (handCount != null) meta.push(`${handCount} cards`);
        if (points != null) meta.push(`${points} pts`);
        el.textContent = meta.length ? `${label}  ·  ${meta.join(' · ')}` : label;
        el.classList.toggle('your-turn', myTurn);
        el.style.display = 'block';
    }

    hideTurnIndicator() {
        const el = document.getElementById('turn-indicator');
        if (el) el.style.display = 'none';
    }

    // --- win / lose banner hook for GAME_CLAIMED ---------------------------
    // outcome: 'win' | 'lose' | 'info'
    showGameBanner(title, message, outcome = 'info', onAction) {
        const banner = document.getElementById('game-banner');
        if (!banner) return false;
        const titleEl = document.getElementById('game-banner-title');
        const msgEl = document.getElementById('game-banner-msg');
        const btn = document.getElementById('game-banner-btn');
        if (titleEl) titleEl.textContent = title || 'Game over';
        if (msgEl) msgEl.textContent = message || '';
        banner.classList.remove('win', 'lose');
        if (outcome === 'win' || outcome === 'lose') banner.classList.add(outcome);
        if (btn) {
            btn.onclick = onAction || (() => location.reload());
        }
        banner.style.display = 'flex';
        return true;
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
