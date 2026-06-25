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
- (S3 Turn timer / AFK, branch `feat/timer`). Per-turn AFK deadline that
  auto-acts for a slow/disconnected human so play never stalls.
  - **Timeout**: `GameConsumer.TURN_TIMEOUT_SECONDS = 30` (single config constant).
  - **Mechanism (consumers.py, all `# S3`)**: per-room `turn_timers = {}` mirroring
    `ai_tasks`. `_schedule_turn_timer()` (called after each human pick/discard,
    on `get_game_state`, and when the AI loop hands back to a human) cancels any
    in-flight timer, and — only when it's a HUMAN's turn and the game is
    active/non-DEALING — sets `Game.turn_deadline` and spawns one
    `_run_turn_timer(player_id, turn_index, turn_step)` task. That task
    `asyncio.sleep`s the window (no busy-wait), re-loads fresh state, and acts
    **only if the same player is still on the same turn** (never-double-act
    guard; a real action cancels the task first via `_cancel_turn_timer()`).
    `_auto_act` applies the pure decision via the normal `_perform_pick` /
    `_perform_discard` flow, so the existing action broadcast animates it on
    every client. The task's `finally` re-arms AI + the next seat's timer.
    Disconnect leaves the timer running (it's room-scoped) so an AFK/leaving
    human is auto-acted; it also `_ensure_ai_running()`.
  - **Auto-act decision (pure, `game/logic.py` `auto_act_decision`)**: PICK ->
    draw the deck (`('pick','deck')`), falling back to the visible card only if
    the deck is empty (`('pick','choice')`), `None` if both piles empty;
    DISCARD -> reuse the AI `choose_discard` heuristic for the safe card
    (`('discard', idx)`), `None` on empty hand. Unit-tested in isolation.
  - **Deadline broadcast shape**: `send_game_state` adds to `state`:
    `turn_deadline` (ISO-8601 UTC string or `null`) and
    `turn_timeout_seconds` (int). `_schedule_turn_timer` also fires a
    `broadcast_refresh()` so clients pick up a fresh deadline immediately.
  - **Client**: `Game.js` parses `turn_deadline` -> epoch ms + `secondsLeft()`;
    `UIManager.updateTurnIndicator` appends `⏱ Ns` and toggles a `.turn-low`
    class (≤10s) -> pulsing orange/red pill (`style.css`, `@keyframes
    turnLowPulse`). `GameController.animate` ticks the indicator ~2x/sec while a
    deadline is pending (no separate setInterval). Auto-acted moves animate via
    the existing `player_pick`/`player_discard` broadcast — no new client path.
  - **Model field / migration**: `Game.turn_deadline = DateTimeField(null=True,
    blank=True)` -> migration **`0013_game_turn_deadline.py`** (dep
    `0012_player_avatar`). Orchestrator: resolve multiple `0013_*` with
    `makemigrations --merge` at merge.
  - **Tests**: +9 (99 -> 108, all green). `AutoActDecisionTests` (PICK
    deck/choice/none, DISCARD index matches `choose_discard`, jokers honoured,
    empty hand, unknown step) + `TurnDeadlineFieldTests` (field nullable, timeout
    constant positive). The async timer itself is validated by the pure decision
    layer per the brief. `node --check` clean on all 3 changed JS files.
  - **Merge risks** — shared `consumers.py` (S1 claim, S2 register_sequence):
    my edits are additive/`# S3` — new constant + dict near class top, a
    `# S3: turn timer` method block after `_ensure_ai_running`, two-line
    cancel+reschedule wraps inside `pick_card`/`discard_card`, a one-line
    `_schedule_turn_timer()` in the AI loop's human-handback branch, the import
    line, and two `state` keys. Should conflict-merge cleanly. If S1's claim
    advances/ends the turn outside the pick/discard handlers, it should call
    `_cancel_turn_timer()` (or rely on the next `_schedule_turn_timer` to clear
    the deadline since the game goes inactive — already handled).

- (S3 QA, branch `feat/timer`). Reviewed `git diff origin/master...HEAD`,
  tested thoroughly, fixed bugs. **2 real bugs found & fixed (additive / `# S3`-scoped):**
  - **[HIGH] Refresh storm / feedback loop.** `_schedule_turn_timer()` ended
    with an unconditional `broadcast_refresh()`, and the `get_game_state`
    handler also called `_schedule_turn_timer()`. Chain:
    `get_game_state -> _schedule_turn_timer -> broadcast_refresh (refresh_state)
    -> every client replies get_game_state -> ...` looping forever the entire
    time it was a human's turn (the only case that sets a deadline + broadcasts).
    Even a single client self-loops. **Fix:** `_schedule_turn_timer(broadcast=True)`
    param; the `get_game_state` path calls it with `broadcast=False` and BEFORE
    `send_game_state` (so the response still carries the fresh deadline) — no
    echo. Real moves / handback / timer re-arm still broadcast once.
  - **[MED] Never-double-act guard ignored `turn_step`.** `_run_turn_timer`'s
    guard checked seat index + player id but NOT the step, then auto-acted on
    `game.turn_step` (fresh). A human PICK advances PICK->DISCARD without
    changing the seat index, so a timer armed on PICK that fired right as the
    human picked would pass the guard and **auto-DISCARD for them, stealing
    their discard**. **Fix:** guard now requires `game.turn_step == turn_step`
    (the armed step) and auto-acts on the snapshotted `turn_step`.
  - **Verified OK (no change):** pure `auto_act_decision` (PICK deck->choice->None,
    DISCARD via `choose_discard`, jokers honoured, empty/unknown safe);
    `_cancel_turn_timer` runs before mutating state in pick/discard; one-timer-
    per-room invariant (single `turn_timers[room]` slot, `_schedule` cancels
    first, `finally` pop only when `is current_task()`); AFK PICK->DISCARD
    continuation via the `finally` re-arm; empty-deck auto-act returns None (no
    spin); disconnect leaves the room-scoped timer running + re-arms AI;
    client `secondsLeft()` null/past-deadline safe, countdown tick guarded.
  - **Tests:** +7 (108 -> 115, all green). New `TurnTimerSchedulingTests`
    (`TransactionTestCase` — the async/sync `sync_to_async` hop deadlocks
    against `TestCase`'s wrapping txn on SQLite): no-broadcast on
    get_game_state, one broadcast on real schedule, AI-turn clears deadline +
    no timer, the index- and step-level never-double-act guards, PICK auto-act
    advances to DISCARD, empty-pile PICK no-ops. `auto_act_decision` unit tests
    retained. `node --check` clean on the 3 JS files; migration `0013` applies
    (makemigrations --check: no changes).
  - **Merge note (consumers.py overlap w/ S1 claim, S2 register_sequence):**
    my fixes are still additive `# S3` — a `broadcast` kwarg + one-line guard
    on `_schedule_turn_timer`, a reordered `get_game_state` branch in `receive`,
    and a `turn_step` term in `_run_turn_timer`'s guard. The original merge note
    stands: if S1's `claim_game` advances/ends the turn it should
    `_cancel_turn_timer()` (else the next `_schedule_turn_timer` clears the
    deadline as the game goes inactive — already handled). No new shared-line
    conflicts introduced.
- (S1 Game loop + scoring) `feat/gameloop`. Closed the game loop with real
  win-validation + scoring + multi-round.
  - **Claim rule (real)**: `claim_game` no longer trusts "1 card left". It now
    validates the claimant's *whole* holding — shown melds (`shown_sequences`) +
    concealed `hand` — via new pure helper `rules.is_winning_claim(shown, hand,
    jokers)` (a thin union wrapper over `is_winning_hand`, still requiring ≥1 pure
    sequence overall). Maal jokers come from F3's `jokers_from_maal(hand, maal_card)`
    (empty set when no maal revealed — no hard dep on S2). Out-of-turn / incomplete
    claims are rejected with a typed `CLAIM_FAILED` (client shows it via the
    existing `_FAILED` toast path). The client `onClaimGame` gate was relaxed —
    server is the authority now.
  - **Scoring formula**: Marriage low-score-wins. Winner = 0; each loser =
    `rules.round_penalty(shown, hand, jokers)` = `unmelded_points` of their
    *concealed* hand (shown melds are free; any still-melding remainder is free),
    capped at `DEFAULT_MAX_ROUND_PENALTY = 100`/round. Pure helpers
    `round_penalty` + `round_scores` in `game/rules/scoring.py` (exported from
    `game/rules/__init__.py`). Consumer bridge `_score_and_persist` adds each
    round penalty to cumulative `Player.points` and builds the standings payload.
  - **Results payload** (on `GAME_CLAIMED`, new `results` key):
    `{round_number, winner, standings:[{name, player_type, is_winner,
    round_points, total_points, rank}]}` sorted by `total_points` asc (rank 1 =
    leader). Both human `claim_game` and AI `_ai_claim` now go through one shared
    `_finish_round(game, players, winner_name)` so AI wins also broadcast
    standings + accumulate points. Client `GAME_CLAIMED` handler renders the
    standings in F4's `UIManager.showGameBanner(...)` (banner `<p>` now uses
    `white-space:pre-line`).
  - **Multi-round / play again**: new `Game.start_new_round()` re-deals a fresh
    deck, resets per-round state (`hand`, `shown_sequences`, `turn_count`),
    rotates the dealer one seat, clears `maal_card`, bumps `round_number`, sets
    `is_active=True` — **keeps `Player.points`** (cumulative). New consumer
    handler `play_again` (DISPATCH `'play_again'`, `# S1`) triggers it (ignored
    while a round is active), broadcasts `{type:'NEW_ROUND', round_number, ...}`,
    and restarts the AI loop. Client: `SocketManager.playAgain()`, banner
    "Play again" now sends `play_again` instead of `location.reload()`;
    `NEW_ROUND` dismisses the banner (new `UIManager.hideGameBanner()`); the
    `refresh_state` that follows re-fetches everyone's new hand. `send_game_state`
    now includes `round_number`, `is_active`, and per-player cumulative `points`.
  - **Model field + migration**: added `Game.round_number` (IntegerField,
    default 1). Migration `game/migrations/0013_game_round_number.py` (orchestrator
    resolves any sibling `0013_*` via `makemigrations --merge`). No new Player
    field — cumulative scoring reuses existing `Player.points`.
  - **Tests**: +16 (99 -> 115, all green). `RoundScoringTests` (pure: claim
    valid/invalid, no-pure-sequence rejection, penalty/cap, winner-0/loser-penalty
    math), `ClaimGameValidationTests` (valid claim ends+scores, claim with shown
    melds, invalid -> CLAIM_FAILED + game stays active, out-of-turn rejected,
    loser points accumulate), `PlayAgainTests` (re-deal resets hands/keeps points/
    rotates dealer, handler re-deals, ignored while active). The two DB-backed
    consumer classes use `TransactionTestCase` + `async_to_sync` (the consumer's
    threaded `sync_to_async` DB access deadlocks SQLite under a plain `TestCase`
    transaction). `node --check` clean on the 3 changed JS files.
  - **Merge risks**:
    - **`consumers.py`** (shared hot file): all edits `# S1`-marked — import line
      (`is_winning_claim, round_scores`), DISPATCH `'play_again'` entry at the end,
      rewrote `claim_game`, added `_finish_round`/`_score_and_persist`/`play_again`,
      reworked the tail of `_ai_claim` (it now calls `_finish_round` instead of
      inlining the broadcast). Overlaps S2 (`register_sequence`) and S3 (timer) but
      in different methods; claim/scoring is self-contained. S3's timer should call
      `_finish_round` on an auto-claim if it wants the same scoring.
    - **`models.py`**: additive `round_number` field + `start_new_round()` method;
      migration `0013_game_round_number`.
    - **`tests.py`**: extended the DISPATCH coverage set (`'play_again'`) — same
      non-additive line S2/S3 will also touch; merge by union.
    - JS (`GameController.js`, `UIManager.js`, `SocketManager.js`): all `// S1`,
      additive, except the relaxed `onClaimGame` gate. S4's HUD removal also
      touches `GameController.js` — edits are localized.
- (QA S1 Game loop) Reviewed `origin/master...HEAD` @ `0d26bcd`, tested, fixed one
  real bug, added 4 tests. Final: **119 backend tests green**; `node --check` clean
  on the 3 changed JS files.
  - **BUG (Med) — `play_again` re-deal race / spam.** `play_again` did a non-atomic
    read-modify-write: `game = get(); if game.is_active: return; start_new_round()`.
    Two play-again messages (multiple humans clicking the banner, or one client
    double-firing) after the same finished round could each pass the `is_active`
    check before either saved, re-dealing twice — skipping a round number and
    double-broadcasting `NEW_ROUND`. **Fixed (`# S1`, additive):** new
    `_begin_new_round_if_finished()` does a compare-and-set inside
    `transaction.atomic()` — a single `Game.objects.filter(is_active=False)
    .update(is_active=True)`; the returned row count decides who won the flip, and
    only the winner calls `start_new_round()`. Other callers no-op. Added
    `test_play_again_cannot_be_spammed_to_redeal_twice`.
  - **Investigated, NOT a bug (key finding) — shown+hand union double-count.** When
    a claimant has shown <3 sequences, `register_sequence` keeps those cards in
    `hand` AND in `shown_sequences`, so `claim_game` unions a physical card twice.
    Proved (pure probes + DB test `test_partial_show_double_count_does_not_falsely_win`)
    that this can **never manufacture a win**: the duplicated group is itself an
    already-valid meld, so `is_winning_hand(union)` ⇔ (real 21-card hand wins) ∧
    (dup is a meld) — the verdict is unchanged. So the double-count is benign for
    the claim verdict; no fix needed. (In the normal path all-3-shown strips the
    cards from hand, so there's no double-count at all.) Left as-is rather than
    deduping, to stay minimal.
  - **Verified OK (no change):** `is_winning_claim([],hand) == is_winning_hand(hand)`
    (agrees by construction); ≥1-pure-sequence rule holds (rejects 7-tunnela hand);
    maal empty-set pre-maal works; out-of-turn claim → `CLAIM_FAILED`, game stays
    active, no points; invalid claim rejected, no game end. Scoring: winner 0,
    loser = `unmelded_points(concealed)` capped 100, cumulative `Player.points`
    correct across rounds. **Standings rank by *cumulative* total, not the round
    winner** — verified the round winner can sit below a lower-total loser
    (`test_standings_ranked_by_cumulative_not_round_winner`); `is_winner` still
    flags the round winner. (Ties get distinct sequential ranks — cosmetic, left.)
    **AI win goes through the same `_finish_round`** — broadcasts standings + a
    `results` payload and accumulates loser points
    (`test_ai_win_finish_round_accumulates_and_broadcasts`). `start_new_round`
    re-deals 21 each, resets hand/shown/turn_count/maal/visibles, rotates dealer,
    bumps `round_number`, keeps `Player.points`, `deal_cards` resets phase/turn_step.
    Migration `0013` applies; `makemigrations --check` clean. `NEW_ROUND` →
    `broadcast_action` → `broadcast_refresh`, so every client re-fetches the new
    hand. **Note (out of S1 scope):** a human can only claim at the START of their
    turn (PICK step) with an already-complete 21 — after a discard the turn has
    advanced off them, so `_is_turn` would reject; there's no human discard-to-claim
    atomic action (the AI has one via `_ai_claim`). Works, slightly different rule
    feel.
  - **Merge notes:** all changes `# S1`-scoped/additive. `consumers.py` overlap with
    S2 (`register_sequence`) / S3 (timer) is in different methods — claim/scoring is
    self-contained; the new `_begin_new_round_if_finished` is a fresh method.
    **The `DispatchTests` expected-set line** (now lists `'play_again'`) is the one
    non-additive line S2/S3 also edit — **merge by union**. **S3's timer auto-claim
    should route through `_finish_round`** (not inline a `GAME_CLAIMED` broadcast) so
    it scores + accumulates points like the human/AI paths. No cross-feature action
    needed otherwise.
