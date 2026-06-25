# Marriage Card Game — Project Summary

A real-time, multiplayer 3D implementation of the Nepali card game **Marriage**.
Django + Channels (WebSockets) backend, vanilla ES-modules + Three.js (r128, CDN,
**no build step**) frontend, SQLite, Redis (prod) for the channel layer, Docker.

---

## Architecture

### Backend (`game/`, `server/`)
- **`server/settings.py`** — env-driven channel layer (Redis when `REDIS_URL`/`REDIS_HOST`
  is set, else in-process in-memory for local dev), `DEFAULT_AUTO_FIELD`, `ALLOWED_HOSTS`.
- **`game/models.py`** — `Game` (UUID pk + short `code`, deck/visibles/turn state, `maal_card`),
  `Player` (name, type HUMAN/AI, hand, shown_sequences, `is_joined`, `has_owner`, `avatar`),
  `GameAction` (audit log — currently write-only).
- **`game/rules/`** — **pure, framework-free rules engine** (no Django imports), fully unit-tested:
  - `cards.py` — `Card` value object + the single source of truth for suits/ranks/colors.
  - `melds.py` — `is_sequence` (pure & joker-filled), `is_pure_sequence`, `is_tunnela`,
    `is_dublee`, `is_valid_meld`, `find_meld_partition`, `is_winning_hand`.
  - `scoring.py` — `card_points`, `hand_points`, `unmelded_points` (configurable point table).
- **`game/logic.py`** — `BasePlayer`/`HumanPlayer`/`AIPlayer` turn processing (pick/discard,
  turn advance, anti-clockwise rotation).
- **`game/consumers.py`** — `GameConsumer` (the WebSocket hub): dispatch table, single
  `TurnContext` loader, shared pick/discard path for humans + AI, seat claim/rejoin, AI driver loop.
- **`game/views.py`** — `create_game` (seat composition), `list_games` (lobby of open games).

### Frontend (`static/js/`)
- **`game/GameController.js`** — orchestrator: single FIFO event queue, state/action handling,
  animation sequencing, avatar seeding.
- **`engine/Renderer.js`** — Three.js scene, table, deck/choice/discard piles, opponent
  avatars + held-card fans, card animations.
- **`engine/Avatar.js`** — procedural avatars (10 presets), idle animation, gesture/chat hooks.
- **`engine/InputHandler.js`** — desktop drag + mobile tap-to-act; hand fan layout.
- **`network/SocketManager.js`** — WebSocket send/receive.
- **`ui/UIManager.js`** — modals (create/join/maal), seat config, lobby list, controls.
- **`models/`** (`Game`, `Player`, `Card`), **`utils/`** (`Constants`, `Helpers`, `Hud`).

---

## Work completed this session

### Rules engine + validation
- Built the pure `game/rules/` engine with **31 unit tests** (ace high/low, no-wraparound,
  joker gap-filling, mixed suits, duplicate ranks, partition/win, scoring).
- Wired real validation into `register_sequence` / `register_tunnela` / `register_dublee`
  (previously rubber-stamped); invalid shows are rejected with a typed `*_FAILED` message
  the client surfaces.

### Consumer refactor (maintainability)
- Replaced the 20-branch `if/elif` with a **dispatch table**, the duplicated per-handler
  load/guard boilerplate with one `TurnContext` loader, and the two copies of pick/discard
  (human vs AI) with a **single shared path**. Swapped `print` for real `logging`.

### Bug fixes
- **"Connection lost" on connect** — two causes: channel layer hardcoded to host `"redis"`
  (made env-driven), and **redis-py 8.0 is incompatible with channels_redis 4.x** (the
  blocking group read raised `Timeout reading from redis` ~5s after connect). Pinned
  `redis>=5,<6` and rebuilt.
- **Player count ignored** — `Renderer.addOpponents` hardcoded 3 opponents; now uses the
  real player count.
- **Joining player saw no cards** — joining by a non-seat name hit `Player.DoesNotExist`;
  now claims an open seat.
- **PC table cards not rendering** — a stale cached `InputHandler` made `applyState` throw at
  `clearArmed()` *before* the render calls. Guarded the call; moved rendering before
  diagnostics; made `processQueues` error-resilient.
- **Animation glitch (pick/throw mis-animated)** — the client drained all actions before any
  state, so the next player's pick animated before the prior discard landed. Fixed with a
  **single FIFO event queue** (arrival order), a **robust pick** (fly the exact card by id;
  tolerate lagging state), and a **~1.2s AI pre-move delay** so a player's discard propagates first.

### Multiplayer / lobby
- **Seat composition** in the create modal (each seat Human or AI; default alternating, every
  other seat AI). Backend honors it, auto-names/de-dupes.
- **Short join codes** (`Game.code`, 4 letters, grows only at scale) used as the room id in
  URLs and WebSocket; `/games/` lobby lists ongoing games with open seats.
- **Join/rejoin**: `has_owner` flag distinguishes never-occupied seats (claimable) from
  vacated ones (reserved). Re-join = reconnect with the same name; **vacated seats can't be
  stolen**. Seat released on disconnect.

### Mobile
- Replaced unreliable drag-on-touch with a **tap-to-act model** (tap deck/choice then tap to
  pick; tap a card then tap to discard); routes touch on `window`, passes HTML controls
  through, disables synthesized mouse. CSS kills native selection/callout/zoom; viewport locked.
- Raised in-game controls above the mobile browser toolbar.

### Avatars (this session's last feature)
- Replaced opponent **spheres** with **procedural avatars** — 10 distinct presets (human skin
  tones + alien + robot; hats: cap/beanie/tophat/helmet/cowboy/crown/headband/party; eyewear:
  glasses/sunglasses/goggles/eyepatch). Per-player `avatar` id stored server-side so every
  client renders the same avatar.
- **Idle animation** (breathing bob, sway, head wander, arm sway, blinking; phase-offset per seed).
- **Held-card fans** rebuilt to stand upright near each avatar's face.
- **Gesture/chat hooks** in place: `Avatar.playGesture(name)`, `Avatar.setLabel(text)`,
  `Renderer.triggerGesture(slot, name)`, `Renderer.setAvatarLabel(slot, text)`.

### Migrations & tests
- Migrations `0010` (code, is_joined), `0011` (has_owner), `0012` (avatar).
- **53 tests pass**: rules engine, consumer helpers (`_select_cards`, `_is_turn`, dispatch),
  view tests (create/lobby/codes), claim/rejoin tests.

### Research
- A subagent evaluated free avatar assets. Recommendation: **procedural** (chosen) for the
  no-build r128 setup, with **Kenney "Mini Characters"** (CC0, rigged GLB with baked idle/wave)
  or **Kenney "Modular Characters"** (CC0, swappable hats/accessories) as a drop-in upgrade
  via a one-`<script>` `GLTFLoader`. Twemoji (CC-BY) / Kenney CC0 emote sprites for chat bubbles.

---

## Known state / cleanup needed
- **Debug HUD** (`utils/Hud.js`, wired into Renderer/GameController) is still present from
  mobile debugging — should be removed or gated behind a build flag.
- **`NoCacheStaticMiddleware`** does **not** take effect under `runserver` (its static handler
  bypasses middleware). Stale-module caching during dev still requires hard-refresh; proper fix
  is serving static via WhiteNoise.
- **`claim_game`** still trusts the client (`is_winning_hand` exists but isn't wired).
- **`GameAction`** is written but never read.
- Not production-hardened: `DEBUG=True`, committed secret key, no auth on rejoin.

---

## Features to add

### Requested

#### 1. Gesture animations (multiple)
The plumbing exists (`Avatar.playGesture`, `Renderer.triggerGesture(slot, name)`); needs more
authored gestures and networking.
- Author a richer set: `wave`, `nod`, `shake`, `jump`, `celebrate`, `cry`, `think`, `point`,
  `clap`, `facepalm`, `shrug` (extend `_applyGesture`; add arm/head poses).
- Networking: add a `gesture` message type → consumer broadcasts `{player, gesture}` → clients
  map player→slot via `getOpponentAvatarSeeds`/`getMyIndex` and call `triggerGesture`.
- Let the local human trigger gestures from a small radial/emote menu (reuse the tap layer).
- AI emits contextual gestures (celebrate on win, cry on a bad draw).

#### 2. Chat (preloaded phrases, humans + AI)
- A fixed phrase set ("Oh no!", "Gotcha!", "I win!", "Your turn", "Nice!", "So close", etc.).
- `chat` message type → consumer broadcasts → clients show a **speech bubble** via the existing
  `setLabel(text)` hook (auto-expire after a few seconds), plus a scrolling chat log panel.
- Quick-chat picker for the human (buttons/wheel); AI sends contextual lines on key events
  (its turn, winning, getting sniped). Pair each phrase with a matching gesture.
- Keep phrases server-side as an allowlist (no free text → no moderation burden initially).

#### 3. Flesh out AI
Current AI picks a random source and discards a random card — no strategy.
- Use the rules engine: evaluate the hand, keep cards that extend
  sequences/tunnelas/dublees, prefer picking the choice card when it helps, discard the
  least-useful card (highest `unmelded_points` / fewest connections).
- Teach AI to **show sequences/tunnela/dublee** when valid, **pick the maal**, and **claim**
  (`is_winning_hand`). Difficulty levels (random → greedy → lookahead). Add per-AI "personality"
  to flavor chat/gestures.

#### 4. UI modernization
- Refresh the visual language: modern type scale, spacing, color tokens, rounded/elevated
  cards, subtle gradients/shadows, smooth transitions; cohesive theme (and a light/dark option).
- Polished modals, buttons, lobby cards; a proper turn indicator and player HUD (names, avatars,
  hand counts, points). Toasts instead of `alert()`.
- **Responsive mobile layout** (safe-area aware), better controls placement, larger tap targets.
- Loading/connecting states, win/lose screen, animations on phase transitions.

#### 5. Better play feel
- It feels like the user is watching from way top. reference state.png for reference. The player also needs to be on the same level as the table/other players. and see their cards from the back as if playing in real life.
- It is often acceptable to peek at the (left) neighbor's cards in real life. So players should be able to rotate the table a bit so that they can peak at their left neighbors cards. However, the catch is that the left neighbor needs to actively allow this to happen. It is okay for players to look before maal is exposed, and sometimes in favor of the showing player. However, after the mall is exposed the advantage is small. Thus all players should be able to either show their cards to their right neighbor or not and change it anytime mid game.


### Recommended additions (my picks)

- **Complete the game loop**: wire `claim_game` to `is_winning_hand`; implement scoring,
  winner determination, end-of-round/end-of-game screens, and multi-round play with running totals.
- **Maal / joker rules**: model tiplu and its relatives (poplu/jhiplu/alter), feed the joker set
  into the rules engine for dirty sequences and scoring.
- **Turn timer / AFK handling**: auto-skip or auto-discard on timeout so one idle/disconnected
  player can't stall the table.
- **Reconnect identity/security**: rejoin is name-only today (anyone who knows a name can take a
  seat). Add a per-seat token in the share/rejoin link.
- **Production hardening**: `DEBUG=False`, env-based secret key, real `ALLOWED_HOSTS`, static via
  WhiteNoise, remove the debug HUD; basic rate limiting on the WS.
- **Persistence & cleanup**: prune stale/finished games; optionally persist results.
- **Spectator mode** and shareable game links for watchers.
- **Sound & haptics**: card deal/pick/discard SFX, win jingle, optional mute.
- **Tests**: channels integration tests (WebSocket flow with the in-memory layer), a small
  frontend test/CI lint; keep the rules engine as the coverage anchor.
- **Settings/variants**: configurable rules (number of decks, sequence length, scoring),
  avatar/name picker per player.
- **Accessibility**: keyboard controls, colorblind-friendly suits, reduced-motion option.
