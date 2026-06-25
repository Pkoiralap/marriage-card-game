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
- (F1 Gestures, branch `feat/gestures`) Done.
  - **Gestures implemented** (11) in `Avatar._applyGesture` + `playGesture` duration
    table: `wave, nod, shake, jump, celebrate, cry, think, point, clap, facepalm,
    shrug`. `game/emotes.py` `GESTURES` matches exactly (validated by a new test).
  - **Message shape**: client → `{type:'gesture', player_name, gesture}` via
    `SocketManager.sendGesture(gesture)`. Server handler `GameConsumer.gesture`
    validates with `emotes.is_valid_gesture` and broadcasts action
    `{type:'GESTURE', player_name, gesture}` via new helper
    `_broadcast_action_only` (no state refresh — gestures are cosmetic). DISPATCH
    entry `'gesture'` added at the end (`# F1`).
  - **Client routing**: `GameController.handleAction` handles `GESTURE` early
    (returns before any card animation). New helper `getAvatarSlotForPlayer(name)`
    is the inverse of `getOpponentAvatarSeeds`' seat→slot map; calls
    `renderer.triggerGesture(slot, gesture)`. Self gesture: broadcast only, no
    avatar to animate.
  - **UI ids/classes**: `#emote-controls`, `#emote-toggle`, `#emote-menu`,
    `.emote-btn` (+ `.emote-open` open-state class on `#emote-controls`). Wired
    through `UIManager` (new `onGesture` callback in `GameController`).
  - **Styling**: uses F4 tokens `var(--surface)`, `var(--surface-2)`,
    `var(--accent)`, `var(--accent-2)`, `var(--radius)`, `var(--shadow)`,
    `var(--text)` with baseline fallbacks so it looks right pre- and post-merge.
  - **Tests**: +5 (`GestureTests`) — allowlist sync, `is_valid_gesture`, dispatch
    wiring, handler broadcasts valid / ignores invalid. 58 total, green.
  - **Cross-feature notes**: F3 (AI) can call `consumer.gesture(name, gesture)` or
    send a `gesture` message to trigger AI emotes — handler is reusable. F4 must
    define the listed tokens on `:root` (already in the contract). Shared-file
    edits all marked `# F1`/`// F1`; the one non-additive change is adding
    `'gesture'` to the expected set in `DispatchTests.test_known_message_types_covered`.
