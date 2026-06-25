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
- (F3 QA) Reviewed `feat/ai` vs `master`, tested, fixed bugs. All `# F3`-scoped.
  - **BUG 1 (High) — AI could never win.** The claim path checked
    `is_winning(player.hand)` on the *post-pick* hand (22 cards; one extra not
    yet discarded). 22 isn't a multiple of the meld size, so `find_meld_partition`
    always returned None and the AI never claimed — the whole claim flow was dead.
    Fix: new pure helper `claim_discard_index(hand, jokers)` (`logic.py`) finds the
    card whose removal leaves a winning 21-card hand. `_ai_claim` now discards that
    exact card via the normal path (board/GameAction stay consistent), then
    broadcasts `GAME_CLAIMED`; `_ai_show_and_claim` returns whether it claimed and
    the driver breaks on it (no double discard).
  - **BUG 2 (High) — infinite stall on empty deck.** When deck+choice are both
    empty, `handle_pick` fails and `turn_step` stays PICK; the driver then re-loops
    on the same AI seat forever (game never ends, turn never returns to a human).
    Fix: `handle_ai_turns` now `break`s when the pick fails, and defensively when a
    post-pick discard fails. Added `# F3` loop-safety guards + warnings.
  - **BUG 3 (Med) — claim discard ignored the requested card.** `AIPlayer.handle_discard`
    ignored `card_index`, so the claim path couldn't discard the specific winning
    card. Fix: honour an explicit in-range `card_index`, else fall back to the
    heuristic. (Out-of-range/None falls through safely.)
  - **Verified OK:** `getattr(player_model,'ai_difficulty',...)` defaults to
    'normal' with no AttributeError (no field/migration); `choose_discard` never
    returns out-of-range and never discards a joker; `should_pick_choice` handles
    empty visibles/None; `_ai_select_maal` picks a valid deck card; `is_winning`
    only true on genuine wins; `claim_discard_index` ~7ms worst case on a 22-card
    hand; hard lookahead in-range and keeps jokers.
  - **Non-blocking concerns (left for merge, not fixed — out of F3 scope):**
    (a) `find_showable_sequences` only returns groups when the *whole* hand
    partitions (`find_meld_partition` is all-or-nothing), so mid-game the AI
    rarely shows sequences progressively — it mostly shows/claims at the end. Works
    correctly, just weak strategy. (b) `register_sequence` validates with
    `is_sequence(cards)` (no jokers), so a joker-filled sequence the AI finds would
    be rejected by the shared human flow; harmless (bounded, no loop) but the two
    paths disagree on jokers. (c) Discard-to-win via `process_turn` calls the base
    no-op `claim_game()`; only the pre-discard `_ai_claim` actually ends the game
    (which is the path the driver uses).
  - **Tests:** +12 (73 -> 85, all green). `ClaimDiscardIndexTests`,
    `AIForcedDiscardTests`, `AIDifficultyTests`, `AILoopProgressTests`
    (incl. an all-AI multi-turn no-stall drive).
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
- (QA, branch `feat/gestures`) Reviewed `origin/master...HEAD`. 58 backend tests
  green; `node --check` clean on all 4 changed JS files.
  - **Bug found & fixed (low–med, cosmetic, persistent)**: stuck head-roll after
    `think`/`shrug`. Idle (`Avatar.update`) re-asserts `group.position.y`,
    `group.rotation.z`, `headPivot.rotation.{x,y}`, `armL/R.rotation.{x,z}` and
    `eyes.scale.y` every frame, but never `headPivot.rotation.z` — which only the
    `think`/`shrug` gestures drive. The gesture overlay stops at `k>=1`, so on a
    frame where the last-applied `ease` hadn't reached 0, a residual roll (up to
    ~0.08 rad) stayed forever until the next gesture. Fix: reset
    `this.headPivot.rotation.z = 0` in the idle block (`// F1`, additive). Verified
    by a Node simulation of the reset+overlay math (residual now 0).
  - **Verified OK (no change needed)**: queue safety — `GESTURE` in `handleAction`
    never sets `isAnimating`, calls `processQueues()` and returns; a gesture
    arriving mid-card-anim simply waits in `eventQueue` (no interrupt/corruption,
    no stall). `getAvatarSlotForPlayer` is the exact inverse of
    `getOpponentAvatarSeeds` (`seat s -> slot (me-1-s) mod N`, always in 0..N-2);
    self/not-seated/N<=1 return -1 → safe no-op; `Renderer.triggerGesture` is
    bounds-guarded. `is_valid_gesture`/`GESTURES` match the 11 implemented
    gestures exactly (asserted by `test_allowlist_matches_implemented_gestures`).
    Server rejects unknown/empty/None gestures. Emote menu uses `pointer-events:
    none` when closed (taps pass through to the InputHandler tap layer); right-
    anchored, doesn't overlap the centered `#game-controls`; mobile lift matches.
    No NaN sources (durations table never 0). Final: **58 tests green.**
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

---

# Batch 2 — Suggested features (parallel worktrees, branched from master @ 6bf4436)

| Feature | Branch | Owns (primary) |
|---|---|---|
| S1 Game loop + scoring | `feat/gameloop` | human `claim_game` via `rules.is_winning_hand`; scoring (`rules/scoring.py`, `Player.points`); end-of-round/game; multi-round; win banner reuse (F4 `showGameBanner`) |
| S2 Maal/joker rules | `feat/maal` | `rules/` joker derivation (tiplu + relatives) from `game.maal_card`; wire into `register_sequence` (allow dirty sequences) + AI `jokers_from_maal` |
| S3 Turn timer / AFK | `feat/timer` | per-turn deadline in `consumers.py`; auto-discard/skip on timeout; timer UI |
| S4 Prod hardening + HUD removal | `feat/hardening` | env `DEBUG`/`SECRET_KEY`/`ALLOWED_HOSTS`; WhiteNoise static; **remove debug HUD** (`utils/Hud.js` + all `hud.` calls); light WS rate-limit |

## Batch-2 rules
- Same as batch 1: branch, additive `# S#`/`// S#` markers in shared files, push your branch, log here, run the local-venv test suite, don't break existing tests.
- **Shared hot file = `consumers.py`** (S1 claim, S2 register_sequence, S3 timer): additive only, comment-marked.
- **Migrations**: if you add a model field, run `makemigrations game` — your branch will create `0013_*`. The orchestrator resolves multiple `0013_*` at merge via `makemigrations --merge`. Note your migration + new fields in the Log.
- **S4 removes the HUD**: it deletes `static/js/utils/Hud.js` and all `hud.` calls in `GameController.js`/`InputHandler.js`/`Renderer.js`. S1/S3 may also touch `GameController.js`/`consumers.py` — keep edits localized; orchestrator merges.
- Reuse, don't reinvent: `rules.is_winning_hand`, `rules.unmelded_points`, `Player.points`, F4's `UIManager.showGameBanner(...)`, F3's AI helpers.

## Batch-2 Log
- (orchestrator) Batch 2 launched from master `6bf4436`.
- (S2 Maal/joker rules) `feat/maal`. Modeled the maal (tiplu) + relatives as
  jokers as a single source of truth in the rules engine, wired into the
  show-validator and the AI so humans and AI agree on jokers (fixes the F3-noted
  "register_sequence and AI disagree on jokers").
  - **New module `game/rules/jokers.py`** (pure, framework-free). Public API
    (also re-exported from `game.rules`):
    - `maal_joker_faces(maal_card) -> set[(suit, rank)]` — the wild faces.
    - `maal_joker_ids(hand, maal_card) -> set[int]` — maps a hand's card
      ids/dicts to the joker-id set the meld validators expect.
    Accepts a `Card`, a wire/DB dict (`{'suit','number',...}`), or falsy
    (-> empty set = pure-only before maal).
  - **Derivation rule (variant: maal + relatives).** Given the maal (tiplu),
    four faces are wild: **tiplu** (maal face), **poplu** (tiplu rank +1, same
    suit, wraps K->A), **jhiplu** (tiplu rank -1, same suit, wraps A->K), and
    **alternate tiplu** (same rank, the other suit of the *same colour*:
    HEART<->DIAMOND, SPADE<->CLUB). No printed jokers in this deck; the hook to
    add them lives in `maal_joker_faces`. **Other features should call
    `rules.maal_joker_ids(hand, maal_card)`** (or `logic.jokers_from_maal`, which
    now just delegates) — do NOT re-derive jokers by hand.
  - **`game/logic.py`**: `jokers_from_maal` now delegates to
    `rules.maal_joker_ids` (no behaviour change for the AI except relatives are
    now wild). All AI win/claim/show paths already route through it, so they pick
    up relatives automatically.
  - **`game/consumers.py` (`# S2`, additive, 1 line + comment)**:
    `register_sequence` now validates with
    `is_sequence(card_objs, jokers_from_maal(hand, game.maal_card))` — accepts
    dirty (joker-filled) sequences once the maal is revealed; before the maal is
    set the joker set is empty so it stays pure-only as today.
  - **Tests**: 99 -> 114 green. `game/rules/tests.py` (pure: tiplu/poplu/
    jhiplu/alt identification, K/A wrap, id mapping, dirty-sequence acceptance,
    winning-hand parity). `game/tests.py` (`jokers_from_maal` relatives;
    `RegisterSequenceMaalTests` — dirty rejected before maal / accepted after /
    pure still accepted). No JS, no migrations, no model fields.
  - **Merge risks**: `consumers.py register_sequence` — one-line change (added a
    `jokers` arg to `is_sequence`); trivial unless S1/S3 also edit that method.
    `logic.py jokers_from_maal` body replaced (delegates now) — conflicts only if
    F3/AI work re-touches that function. `rules/melds.py` UNCHANGED (joker logic
    lives in the new `jokers.py`). `rules/tests.py` and `game/tests.py` appended.
    `RegisterSequenceMaalTests` is a `TransactionTestCase` (sync_to_async +
    sqlite would deadlock under plain TestCase).

## QA Log
- (S2 QA, `feat/maal`) Reviewed `git diff origin/master...HEAD` and stress-tested
  the maal/joker feature. **No real bugs found** — derivation, validator, and
  parity are all correct. Verdict: ship.
  - **Derivation correctness (verified for every rank + wraps):** tiplu=A ->
    jhiplu wraps to K, poplu=2; tiplu=K -> poplu wraps to A, jhiplu=Q; 2/10/J/Q
    all correct. Exactly 4 distinct wild faces. **Alternate** mapping is exactly
    HEART<->DIAMOND, SPADE<->CLUB (same-colour partner, not suit-adjacent) for all
    four suits.
  - **`maal_joker_ids`:** correct for Card, wire/DB dict, None/empty/`{}`/`[]`
    (-> empty = pure-only), id-less cards (skipped), and a mixed dict+Card hand.
    Duplicate wild faces across the 3 decks ALL map to ids (not just the first).
  - **Validator:** before maal -> joker set empty -> pure-only (joker-filled
    "sequence" rejected); after maal -> right dirty sequences pass, genuinely
    invalid ones still fail. Same-suit enforced on naturals; gap bounded by joker
    count (jokers can't legalise a too-wide run); distinct-rank enforced; a joker
    can't exceed its count. No tunnela/dublee regression (they ignore jokers via
    `same_face`). Bad maal input (unknown suit/rank, garbage) degrades to empty
    with no crash.
  - **Parity (the stated F3 fix) confirmed:** human show (`consumers.register_sequence`),
    AI show (`find_showable_sequences`), AI claim (`claim_discard_index`), and AI
    win (`is_winning_hand`) all route through `jokers_from_maal` ->
    `rules.maal_joker_ids`, called with the player's own hand + `game.maal_card`
    (a JSONField card dict). Identical derivation -> cannot disagree.
  - **Tests:** 114 -> **116** green. Added two `# S2` additive regression tests to
    `game/rules/tests.py::MaalJokerIdTests`: `test_duplicate_faces_across_decks_all_map`
    and `test_mixed_dict_and_card_hand` (locking down the two prompt-flagged cases
    that weren't yet covered). No source changes — feature was already correct.
  - **Merge notes:** unchanged from S2 entry. QA touched only `game/rules/tests.py`
    (appended) + this log; no conflict surface added.
- (S4 Prod hardening + HUD removal) `feat/hardening`. All shared-file edits `# S4`/`// S4`.
  - **Debug HUD removed entirely.** Deleted `static/js/utils/Hud.js`. Removed the
    `import { hud }` lines + the `?hud` URL gate (`GameController` constructor) and
    every `hud.enable()`/`hud.set(...)` call across `GameController.js` (queue/err/
    diagnostics block — the whole `// Diagnostics LAST` try/catch was HUD-only and
    is gone, `applyState` logic intact) and `InputHandler.js` (`onTouchStart`,
    `onTap`, hand-hit routing — touch/tap logic intact). `Renderer.js` had **no**
    hud references. Verified: `grep -rn "hud\|Hud"` over `static/js`, `templates`,
    `server`, `game` returns NONE (the one Avatar.js `ease` match is unrelated);
    `node --check` passes on all 3 changed JS files.
  - **Settings hardening (env-driven, dev-safe defaults)** in `server/settings.py`:
    - `SECRET_KEY` from `SECRET_KEY` env; falls back to the existing insecure dev
      key when unset.
    - `DEBUG` from `DEBUG` env via `_env_bool` (accepts 1/true/yes/on); **default
      True** for dev. Docker's `DEBUG=1` still works.
    - `ALLOWED_HOSTS` from comma-separated `ALLOWED_HOSTS` env; **default**
      `"192.168.1.22,localhost,127.0.0.1"` (added 127.0.0.1) so local/LAN play is
      unchanged. Verified `manage.py check` passes both in dev defaults and with
      `DEBUG=0 SECRET_KEY=... ALLOWED_HOSTS=example.com,1.2.3.4`.
  - **WhiteNoise static** (new dep `whitenoise>=6.0,<7` in `requirements.txt`):
    added `whitenoise.middleware.WhiteNoiseMiddleware` right after
    `SecurityMiddleware`; `whitenoise.runserver_nostatic` in INSTALLED_APPS (before
    `staticfiles`) so dev and prod take the same serving path. New `STATIC_ROOT =
    BASE_DIR/"staticfiles"` (gitignored). In DEBUG: `WHITENOISE_USE_FINDERS=True` +
    `WHITENOISE_AUTOREFRESH=True` + `WHITENOISE_MAX_AGE=0` → serves straight from
    `STATICFILES_DIRS` with no collectstatic and no aggressive caching (closes the
    stale-ES-module gap that summary.md noted — `NoCacheStaticMiddleware` never
    fired under runserver; it's left in place, harmless). In prod (DEBUG off):
    `STORAGES["staticfiles"]` uses `whitenoise.storage.CompressedManifestStaticFilesStorage`
    → content-hashed + gzipped assets after `collectstatic`, served `immutable`.
    Verified end-to-end: dev runserver serves `/static/...` 200 (revalidates via
    Last-Modified); `collectstatic` produces hashed names + `.gz` + manifest;
    hashed files served `Cache-Control: max-age=315360000, public, immutable`.
  - **Light WS safeguard** in `GameConsumer` (`consumers.py`, additive `# S4`):
    `receive` now drops frames > `MAX_MESSAGE_BYTES` (16 KiB) and rate-limits to
    `RATE_LIMIT_MAX`=40 msgs / `RATE_LIMIT_WINDOW`=5s per connection via a sliding
    window (`_msg_times`, monotonic clock). Tuned well above normal play (a few
    msgs/sec) so it never trips for real users; both are no-ops on the happy path.
  - **Tests**: `manage.py test game` → **99 passed** (unchanged count, green);
    `manage.py check` clean (dev + prod env). Installed `whitenoise` into the local
    venv so check/test import it.
  - **Merge risks**:
    - `server/settings.py` — overlaps any S# that touches settings (none expected);
      the INSTALLED_APPS / MIDDLEWARE / STATIC blocks are additive and `# S4`-marked.
    - `game/consumers.py` — S1 (claim), S2 (register_sequence), S3 (timer) all edit
      this file. S4's edits are localized to the class header (constants), `connect`
      (init `_msg_times` + `_rate_limited` helper) and the top of `receive` (guards
      before the existing body) — no handler/DISPATCH changes, so conflicts should
      be trivial.
    - `GameController.js` / `InputHandler.js` — HUD-line removals. S1/S3 may also
      touch `GameController.js`; conflicts are only where their edits sit next to a
      removed `hud.set(...)` line. `Renderer.js` was listed in the brief but had no
      HUD code, so it's untouched here.
- (QA S4 Prod hardening + HUD removal) Reviewed `feat/hardening` @ `f34b21f`
  (`git diff origin/master...HEAD`), tested thoroughly. **PASS — no bugs found; no
  code changes needed.** Verified each axis:
  - **HUD removal — clean, no dangling refs.** `Hud.js` deleted (404s under
    runserver). `grep -rni hud` over `static/js`/`templates`/`server`/`game` →
    only two unrelated hits: a UIManager comment ("in-game HUD: turn indicator" —
    the F4 turn pill, not the debug module) and `Avatar.js` `ease`. No orphan
    `import { hud }` / `Hud.js` references anywhere. The merged `onTap` guard
    (`if (!me||waiting) return; if (!isMyTurn()) return;`) and the `if (onControl)`
    passthrough kept their bodies; `applyState` ends cleanly at
    `updateTurnIndicator` (the whole HUD-only `Diagnostics LAST` try/catch is
    gone, no half-removed `if`). `processQueues` recover-path intact.
    `node --check` clean on both changed JS files.
  - **Settings.** `os` is imported (used by `_env_bool`/`os.environ`).
    `manage.py check` clean in dev defaults, Docker `DEBUG=1`, and prod-style
    `DEBUG=0 SECRET_KEY=x ALLOWED_HOSTS=example.com`. `--deploy` only shows the
    standard HSTS/SSL/short-key warnings (out of S4 scope, expected with the
    `x` test key). `_env_bool` parses `1/true/yes/on` (+ case/whitespace) → True
    and `0/false/no/off/''/garbage` → False; unset → default. LAN/local hosts
    (`192.168.1.22,localhost,127.0.0.1`) preserved. `STORAGES["default"]` keeps
    FileSystemStorage; staticfiles backend switches on DEBUG correctly.
  - **WhiteNoise.** Middleware sits immediately after `SecurityMiddleware`;
    `runserver_nostatic` precedes `staticfiles` in INSTALLED_APPS. Dev runserver
    serves `/static/...` → 200 `text/javascript`, `Last-Modified` revalidate,
    no `max-age` (`WHITENOISE_MAX_AGE=0`). `collectstatic --noinput` → 144 copied,
    432 post-processed, producing content-hashed names + `.gz` + `staticfiles.json`
    manifest, no errors. `staticfiles/` is gitignored (`git check-ignore` OK).
    Cleaned up after. ASGI/`routing.py` untouched — WS path unaffected (channels
    protocol router, not the Django MIDDLEWARE stack).
  - **WS rate-limit.** Simulated `_rate_limited` exactly: normal play (5–8
    msgs/sec sustained) → 0 drops; a 45-frame rapid burst drops at index 40
    (41st onward); window recovers after 5s. Per-connection `_msg_times` init'd in
    `connect`, plus a `getattr` re-init guard. `receive` guards (`None` /
    oversize / rate) all `return` before any `json.loads`, so they can't crash or
    wedge the consumer. Monotonic clock used. No false positives for legitimate
    pick/discard/gesture/chat bursts.
  - **Tests:** `manage.py test game` → **99 passed** in BOTH dev defaults and
    prod-env (`DEBUG=0 SECRET_KEY=... ALLOWED_HOSTS=...`); `manage.py check` clean
    in both. Test count unchanged (99).
  - **Merge notes:** confirms S4's own notes. HUD-removal overlap with S1/S3 on
    `GameController.js`/`InputHandler.js` is limited to lines adjacent to removed
    `hud.set(...)` calls — trivial to resolve (take S4's removal, keep S1/S3's
    additions). `settings.py` is additive/`# S4`-marked and overlaps no other S#.
    `consumers.py` S4 edits (class constants, `connect` init, top-of-`receive`
    guards, `_rate_limited` helper) don't touch DISPATCH/handlers, so they sit
    cleanly alongside S1/S2/S3 edits.
