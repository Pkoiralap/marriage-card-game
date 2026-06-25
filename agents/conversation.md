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
- (F2 Chat) Quick-chat implemented on `feat/chat`.
  - **Phrases**: filled `CHAT_PHRASES` in `game/emotes.py` (12 entries: ohno,
    gotcha, iwin, yourturn, nice, soclose, wellplayed, hurryup, oops, gg, hello,
    thanks). Some pair an optional `gesture` (shake/nod/celebrate/wave — matching
    the gesture names in `Avatar._applyGesture`); pairing is best-effort and the
    client feature-detects, so F1 changing the gesture list won't break chat.
  - **Message shape**: client → server `{type:'chat', player_name, phrase_id}`.
    Server broadcasts action `{type:'CHAT', player_name, phrase_id, text, gesture?}`.
  - **AI-reusable helper (for F3)**: `async def broadcast_chat(self, player_name,
    phrase_id)` on `GameConsumer` — validates `phrase_id` via
    `emotes.chat_phrase`, broadcasts the CHAT action, returns True/False (False =
    unknown id, no broadcast). AI can call `await self.broadcast_chat(ai_name, id)`
    to make an AI speak. The `chat` DISPATCH handler just delegates to it.
  - **Client**: `SocketManager.sendChat(phraseId)`. `GameController.handleAction`
    handles `CHAT`: speech bubble over the speaker via
    `renderer.setAvatarLabel(slot, text)` + optional `renderer.triggerGesture`,
    auto-clears after 4s; also appends to a chat log. `getSlotForPlayer(name)` is
    the inverse of `getOpponentAvatarSeeds()` seat mapping. There's a client
    mirror of `CHAT_PHRASES` in `GameController.js` (keep in sync with emotes.py).
  - **UI ids/classes** (namespace `chat-`): `#chat-box` (wrapper), `#chat-panel`
    (log), `#chat-quick` (picker), `.chat-entry`, `.chat-author`, `.chat-quick-btn`,
    `.chat-bubble` (reserved). Styled with F4 tokens (`--surface`, `--surface-2`,
    `--accent`, `--text`, `--radius`, `--shadow`) using fallbacks so it works
    pre/post the F4 merge.
  - **Tests**: added `ChatPhraseTests` + `ChatBroadcastTests` in `game/tests.py`
    and extended the DISPATCH coverage set. `manage.py test game` green (59).
  - **Merge notes**: shared-file edits are additive and `# F2`/`// F2` marked —
    `consumers.py` (import + DISPATCH end + handler/helper), `GameController.js`,
    `index.html` (block after `#sequence-controls`), `style.css` (appended),
    `tests.py`. Only overlap risk with F1 is the DISPATCH dict tail and the
    shared `emotes.py` (F1 fills `GESTURES`, F2 fills `CHAT_PHRASES` — disjoint).
- (QA F2 Chat) Reviewed `feat/chat`; one real bug fixed, hardened, tests added.
  - **[HIGH] XSS in chat log** (`GameController.appendChatLog`): built the entry
    with `innerHTML` interpolating `player_name`. Player names are user-chosen and
    only `.strip()`ed server-side (no HTML escaping — see `views._normalize_seats`),
    so a player named `<img src=x onerror=...>` would execute JS for every other
    player on each quick-chat. **Fixed**: rebuilt the entry with `createElement` +
    `textContent` / `createTextNode` (no innerHTML). The 3D bubble path
    (`Avatar.setLabel`, canvas texture) was already injection-safe.
  - **Verified, no bug**: server allowlists ids (`broadcast_chat` → `emotes.chat_phrase`,
    returns False / no broadcast for unknown ids); `getSlotForPlayer` correctly
    mirrors `getOpponentAvatarSeeds` seat math (self → -1, no self-bubble);
    per-slot bubble timers prevent overlap on rapid chats; chat log capped at 30;
    `handleChat` exceptions can't freeze the FIFO queue (`processQueues` try/catch
    recovers); client `CHAT_PHRASES` mirror ids match Python exactly.
  - **Tests added** (now 62 green): `test_client_mirror_ids_match_python`
    (drift guard parsing the JS mirror), `test_malformed_phrase_id_is_ignored`
    (None/''/0/[]/{} rejected, no crash), `test_paired_gesture_is_broadcast`.
  - **For merge**: changes stay within chat scope, `// F2`/`# F2` marked. No
    cross-feature action needed.
