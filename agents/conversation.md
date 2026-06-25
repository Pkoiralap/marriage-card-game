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
- (F3 AI) `feat/ai`. Replaced the random AI with a rules-engine strategy.
  - **`game/logic.py`**: added pure, unit-tested helpers — `jokers_from_maal`
    (maal face -> wild card ids), `choose_discard` (dumps the least-connected /
    highest-penalty card via `unmelded_points` + a meld-connection heuristic),
    `should_pick_choice` (take the visible card only when it extends a
    sequence/pair or is a joker, else draw deck), `is_winning` (wrapper over
    `is_winning_hand`), `find_showable_sequences` / `find_showable_tunnelas`
    (index groups the driver can register). `AIPlayer` now wires these in and
    has a `difficulty` knob: `easy` = old random, `normal` = greedy (default),
    `hard` = `normal` + a bounded 1-card discard lookahead. `check_game_end`
    now uses the rules engine. Reads optional `player_model.ai_difficulty`.
  - **`consumers.py`** (additive, all `# F3`): `handle_ai_turns` now passes
    `source=None` so the AIPlayer decides its own pick source, then calls a new
    `_ai_show_and_claim` between pick and discard. That helper reuses the
    existing human flows — `register_tunnela` (first round), `register_sequence`
    (until 3 shown), `select_maal` (picks the deck face the AI holds most of),
    and an `_ai_claim` guarded by `is_winning`. One code path / one set of
    broadcasts; it's a no-op when the AI has nothing to show.
  - **Tests**: +20 in `game/tests.py` (53 -> 73, all green). Pure helpers
    (discard/pick/win/tunnela/sequence/jokers) plus 3 DB-backed `AIPlayer`
    turn tests.
  - **Hooks for F1/F2**: clean, commented no-op hook in `_ai_show_and_claim`
    where the AI could emit a gesture on claim / a chat quip on showing — feature
    -detected (`hasattr`), so no hard dependency on `feat/gestures`/`feat/chat`.
  - **Remaining / risks**: maal-as-joker is interpreted as "every hand copy of
    the maal face is wild" (engine takes ids, table decides faces); adjust if the
    house rule differs (e.g. alter/poplu relatives also wild). The human
    `claim_game` handler still uses the client "1 card left" rule (untouched).
    **Merge overlap = `consumers.py`**: I rewrote the pick-source line and the
    pick/discard block inside `handle_ai_turns`, and added the import block +
    `_ai_show_and_claim`/`_ai_select_maal`/`_ai_claim` methods. F1/F2 add DISPATCH
    entries + handler methods elsewhere in the class, so conflicts should be
    localized to the import area and the AI loop body.
