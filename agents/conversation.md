# Agent Coordination — Feature Build

Four feature agents work **in parallel, each in its own git worktree on its own
branch**, branched from `master`. A QA agent reviews each afterward. This file is
the shared coordination log + interface contracts. The orchestrator (main Claude)
relays messages between agents when an entry below requests it.

## Active assignments
| Feature | Branch | Owns (primary files) |
|---|---|---|
| F1 Gestures | `feat/gestures` | `Avatar.js` (gestures), gesture msg in `consumers.py`, gesture routing in `GameController.js`, emote UI |
| F2 Chat | `feat/chat` | chat msg in `consumers.py`, chat bubble/log, quick-chat UI, `CHAT_PHRASES` in `game/emotes.py` |
| F3 AI | `feat/ai` | `game/logic.py` (`AIPlayer`), AI loop in `consumers.py`, AI emote/chat triggers |
| F4 UI modernization | `feat/ui` | `static/css/style.css`, `templates/index.html`, `UIManager.js` styling, toasts |

## Working rules (all agents)
1. `git checkout -b <your branch>` from `master`. Commit frequently; **push your
   branch to origin** when done (`git push -u origin <branch>`) so it survives.
2. Stay within your owned files where possible. When you must touch a **shared
   file** (`consumers.py`, `GameController.js`, `index.html`, `style.css`), make
   **additive, clearly-commented** changes (`# F1:` / `// F2:` markers) so merges
   are trivial. Do not refactor shared code you don't own.
3. Run `docker compose exec -T web python manage.py test game` (or `node --check`
   for JS) before pushing. Don't break existing tests.
4. Log decisions and any cross-feature needs in the **Log** section below and push.
5. Do NOT delete the debug HUD (`utils/Hud.js`) — separate cleanup task.

## Shared contracts (agree on these — do not diverge)

### Message protocol (client → server `message`, then server broadcasts an action)
- **Gesture (F1):** client sends `{type:'gesture', player_name, gesture}`. Server
  validates `gesture` ∈ `GESTURES` (in `game/emotes.py`) and broadcasts action
  `{type:'GESTURE', player_name, gesture}`. Client, on a `GESTURE` action, maps
  player→avatar slot and calls `renderer.triggerGesture(slot, gesture)`.
- **Chat (F2):** client sends `{type:'chat', player_name, phrase_id}`. Server
  validates `phrase_id` against `CHAT_PHRASES` and broadcasts
  `{type:'CHAT', player_name, phrase_id, text}`. Client shows a bubble via the
  avatar `setLabel(text)` hook + a chat log; play an optional paired gesture.
- Both add a key to `GameConsumer.DISPATCH` and a handler method. Add new
  DISPATCH entries at the **end** of the dict with a `# F1`/`# F2` comment.
- Helpers already present: `Renderer.triggerGesture(slot, name)`,
  `Renderer.setAvatarLabel(slot, text)`, `Avatar.playGesture(name)`,
  `Avatar.setLabel(text)`, `GameController.getOpponentAvatarSeeds()` (slot order),
  `game.getMyIndex()`. Map a player_name → slot the same way avatars are seeded.

### Shared allowlists — `game/emotes.py` (pre-stubbed in baseline)
- F1 fills `GESTURES` (list of gesture name strings). Must match the gestures
  authored in `Avatar._applyGesture`.
- F2 fills `CHAT_PHRASES` (list of `{id, text, gesture?}`). AI (F3) may import
  these to send contextual lines.

### Frontend DOM id / CSS namespaces (avoid collisions)
- F1 emote UI: ids/classes prefixed `emote-` (e.g. `#emote-menu`, `.emote-btn`).
- F2 chat UI: prefixed `chat-` (e.g. `#chat-panel`, `#chat-quick`, `.chat-bubble`).
- F4 owns global restyle + **design tokens** as CSS variables on `:root`. F4 MUST
  define at least: `--surface`, `--surface-2`, `--accent`, `--accent-2`, `--text`,
  `--text-dim`, `--radius`, `--shadow`. **F1 and F2 must style their new UI using
  these tokens** so the modernized theme applies after merge.
- F4: replace `alert(...)` with a `toast(msg)` helper (expose globally, e.g.
  `window.toast`); F1/F2 may use it if present (feature-detect).

## Log (append entries; newest at bottom)
- (orchestrator) Baseline at master `0054b09`. Branches not yet created.
- (F4 UI) `feat/ui` — modernized the whole UI (dark theme, gradients, elevation,
  soft shadows). **No DOM ids renamed or removed** (verified by grepping
  `getElementById`/`querySelector` in `static/js/**` against `index.html`).
  Backend tests stay green (53 passed); `node --check` passes on all changed JS.

  **Design tokens** (on `:root` in `static/css/style.css`) — F1/F2 should style
  their new UI with these:
  - `--surface: #16181d`, `--surface-2: #20242c`, `--surface-3: #2a2f39`
  - `--accent: #4caf50`, `--accent-2: #2196f3`
  - `--text: #eef1f5`, `--text-dim: #9aa3b2`
  - `--radius: 14px` (also `--radius-sm: 9px`, `--radius-lg: 20px`)
  - `--shadow: 0 10px 30px rgba(0,0,0,.45)` (also `--shadow-sm`)
  - extras: `--border`, `--border-strong`, `--accent-grad`, `--accent-2-grad`,
    `--danger`, `--warning`, `--font-family`.
  - Legacy aliases kept working: `--bg-color`, `--text-color`, `--primary-color`,
    `--primary-hover`, `--secondary-color`, `--secondary-hover`, `--card-bg`,
    `--table-color`.

  **Toast helper** — `window.toast(message, type?, opts?)`:
  - `type`: `'info'` (default) | `'success'` | `'error'` | `'warn'`
  - `opts`: `{ duration?: number ms (default 3200) }`
  - Defined in new module `static/js/utils/Toast.js` (imported by `main.js`).
    Mount point `#toast-container` in `index.html` (auto-created if missing).
  - F1/F2: feature-detect with `typeof window.toast === 'function'`.
  - Replaced all user-facing `alert(...)` in `UIManager.js` + `GameController.js`
    with toasts (behavior preserved via `alert` fallback). `SocketManager.js`
    connection-lost alert also uses toast if present.

  **Structural HTML additions** (additive only) in `templates/index.html`:
  - `#turn-indicator` (top-center pill) inside `#game-container`.
  - `#game-banner` (+ `#game-banner-title/-msg/-btn`) — win/lose hook for
    `GAME_CLAIMED`, populated by `UIManager.showGameBanner(...)`.
  - `#toast-container` before the main script.
  - Added Inter web-font `<link>`s, `viewport-fit=cover`, `color-scheme`,
    `theme-color` meta. Removed a stray literal `...` text node in
    `#game-container`.

  **New UIManager methods**: `updateTurnIndicator(game)`, `hideTurnIndicator()`,
  `showGameBanner(title, msg, outcome, onAction)`. New GameController method
  `notify(message, type)`. `applyState` now calls `ui.updateTurnIndicator`.

  **Merge risks**: `style.css` was rewritten wholesale and `index.html` got
  additive blocks — F1/F2 touching the same files will conflict. Resolution is
  easy since F1 (`emote-`) / F2 (`chat-`) use prefixed ids/classes that don't
  collide with anything here; take F4's `style.css`/`<head>`/token block and
  re-apply F1/F2's prefixed additions on top.

- (QA UI) Reviewed `feat/ui` @ `2edb412` (`git diff master...HEAD`). **PASS — no
  bugs found; no code changes needed.** Verified:
  - **DOM id/selector coverage (top risk):** grepped every `getElementById`
    (36 unique ids) and `querySelector(All)` (4 selectors: `.seat-row`,
    `.seat-name`, `.seat-type`, `.card-slider-item`) across `static/js/**`.
    Every referenced id exists in `templates/index.html`; the 4 selectors target
    elements UIManager creates at runtime (seat config / maal slider) and all
    have matching CSS. No id was renamed or removed. `#toast-container` exists in
    HTML and Toast.js also auto-creates it if missing.
  - **Toast:** `window.toast` installed at module-eval via `main.js` import
    (before `DOMContentLoaded`), so it's defined before any caller. All three
    remaining `alert(` calls (UIManager `notify` helper, GameController `notify`,
    SocketManager onclose) are feature-detect fallbacks — graceful if Toast fails
    to load. Every former `alert` path still informs the user.
  - **Turn indicator / banner:** `updateTurnIndicator(game)` guards null/empty
    `players`, missing `me`, missing `hand`/`points`; uses real Game props
    (`isMyTurn`, `phase`, `turnPlayerIndex`, `turnStep`). `active.name` resolves
    (server `players_data` includes `name`). `showGameBanner` no-ops safely if
    `#game-banner` absent and GAME_CLAIMED falls back to toast+reload. Banner
    "Play again" → `location.reload()` preserves original GAME_CLAIMED behavior.
  - **Layout/z-index:** modals (1000) < banner (1500) < toasts (4000); HUD pills
    (100–200) below. `#turn-indicator` and `#game-log` use `pointer-events:none`
    so they don't block the canvas/cards. Mobile media query raises controls
    above the browser toolbar (`+90px`) and shrinks log/sequences. safe-area
    insets applied throughout without pushing controls off-screen.
  - **Tokens:** all contract tokens present on `:root` (`--surface/-2/-3`,
    `--accent/-2`, `--text/-dim`, `--radius`, `--shadow`) + legacy aliases +
    extras. All 5 `@keyframes` referenced are defined.
  - **Tests:** backend `manage.py test game` → **53 passed** (UI untouched
    backend). `node --check` passes on all changed JS and all `static/js/**`.
  - **Merge notes:** unchanged from F4 — F1/F2 take F4's `style.css`/`<head>`/
    tokens wholesale and re-apply their prefixed (`emote-`/`chat-`) additions;
    F1/F2 should style new UI with the `:root` tokens and feature-detect
    `window.toast`.
