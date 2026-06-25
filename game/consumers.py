import json
import asyncio
import logging
import random
import time  # S4: monotonic clock for WS rate-limiting
from dataclasses import dataclass
from datetime import timedelta

from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
from django.db import transaction
from django.utils import timezone

from .models import Player, Game, GameAction
from .logic import HumanPlayer, AIPlayer
# F3: pure AI helpers for showing melds / claiming.
from .logic import (
    jokers_from_maal,
    find_showable_sequences,
    find_showable_tunnelas,
    is_winning,
    claim_discard_index,
)
# S3: pure auto-act decision for the turn timer (PICK -> draw, DISCARD -> safe card).
from .logic import auto_act_decision
from .rules import Card, is_sequence, is_tunnela, is_dublee
from . import emotes  # F1: gesture allowlist (is_valid_gesture) + F2: quick-chat phrases

logger = logging.getLogger(__name__)


@dataclass
class TurnContext:
    """The models a handler needs, loaded once per message."""
    game: Game
    player: Player
    players: list | None = None   # ordered by created_at, when requested
    index: int = -1               # `player`'s seat in `players`


class GameConsumer(AsyncWebsocketConsumer):
    # Track running AI tasks per room to prevent spam.
    ai_tasks = {}

    # S4: lightweight, defensive per-connection WebSocket safeguards. Additive
    # and tuned well above normal play (a fast human taps a few msgs/sec), so
    # legitimate traffic is never dropped — this only sheds floods / oversized
    # frames from a misbehaving or malicious client.
    MAX_MESSAGE_BYTES = 16 * 1024       # 16 KiB; real messages are well under 1 KiB
    RATE_LIMIT_MAX = 40                 # max messages...
    RATE_LIMIT_WINDOW = 5.0             # ...per this many seconds, per connection

    # S3: per-turn deadline for HUMAN players. If a human doesn't act within
    # this many seconds the server auto-acts for them (pick from deck in PICK,
    # safe discard in DISCARD) so a slow/disconnected player can't stall the
    # table. One pending timer task per room, mirroring the ai_tasks pattern.
    TURN_TIMEOUT_SECONDS = 30
    turn_timers = {}  # room_name -> asyncio.Task

    # type -> (handler method name, message fields to pass positionally)
    DISPATCH = {
        'get_game_state':    ('send_game_state',   ('player_name',)),
        'pick_card':         ('pick_card',         ('player_name', 'source', 'target_index')),
        'discard_card':      ('discard_card',      ('player_name', 'card_index')),
        'register_sequence': ('register_sequence', ('player_name', 'sequence_id', 'card_indices')),
        'register_tunnela':  ('register_tunnela',  ('player_name', 'card_indices')),
        'register_dublee':   ('register_dublee',   ('player_name', 'card_indices')),
        'select_maal':       ('select_maal',       ('player_name', 'card_id')),
        'cancel_sequence':   ('cancel_sequence',   ('player_name',)),
        'reorder_hand':      ('reorder_hand',      ('player_name', 'old_index', 'new_index')),
        'claim_game':        ('claim_game',        ('player_name',)),
        'gesture':           ('gesture',           ('player_name', 'gesture')),  # F1
        'chat':              ('chat',              ('player_name', 'phrase_id')),  # F2
    }

    # --- connection lifecycle ----------------------------------------------
    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = 'game_%s' % self.room_name
        self.player_name = None  # set once we learn who this socket is
        # S4: rate-limit state (sliding window of recent message timestamps).
        self._msg_times = []
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

    def _rate_limited(self):
        """S4: True if this connection has exceeded its message budget.

        Drops the oldest timestamps outside the window, then records & checks
        the current one. Defensive only — never trips under normal play.
        """
        now = time.monotonic()
        cutoff = now - self.RATE_LIMIT_WINDOW
        times = getattr(self, "_msg_times", None)
        if times is None:
            times = self._msg_times = []
        self._msg_times = times = [t for t in times if t >= cutoff]
        if len(times) >= self.RATE_LIMIT_MAX:
            return True
        times.append(now)
        return False

    async def disconnect(self, close_code):
        # Release this socket's seat so it shows as open again in the lobby.
        if self.player_name:
            await self._set_joined(self.player_name, False)
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)
        # S3: a disconnecting human is exactly the AFK case the timer guards
        # against. Leave the timer running so it auto-acts on their behalf and
        # keeps play moving; the timer task is room-scoped (not tied to this
        # socket) so it survives this disconnect. Re-arm the AI driver too in
        # case the auto-act hands the turn to an AI seat.
        self._ensure_ai_running()

    async def _set_joined(self, player_name, joined):
        try:
            await sync_to_async(
                Player.objects.filter(name=player_name, game__code=self.room_name).update
            )(is_joined=joined)
        except Exception:
            logger.exception("Failed to set joined=%s for %s", joined, player_name)

    async def receive(self, text_data):
        # S4: defensive guards — drop oversized frames and message floods before
        # doing any work. Both are no-ops for normal play (small, infrequent msgs).
        if text_data is None:
            return
        if len(text_data) > self.MAX_MESSAGE_BYTES:
            logger.warning("Dropping oversized message (%d bytes) in room %s",
                           len(text_data), getattr(self, 'room_name', '?'))
            return
        if self._rate_limited():
            logger.warning("Rate-limiting connection in room %s",
                           getattr(self, 'room_name', '?'))
            return
        try:
            message = json.loads(json.loads(text_data).get('message', '{}'))
            entry = self.DISPATCH.get(message.get('type'))
            if message.get('type') == 'get_game_state':
                # S3: (re)arm the turn timer BEFORE sending state, and without a
                # broadcast, so this response already carries the fresh deadline
                # and we don't trigger a get_game_state -> refresh -> get_game_state
                # storm across clients.
                self._ensure_ai_running()
                await self._schedule_turn_timer(broadcast=False)
            if entry:
                method_name, fields = entry
                await getattr(self, method_name)(*(message.get(f) for f in fields))
        except Exception:
            logger.exception("Error handling message in room %s", getattr(self, 'room_name', '?'))

    # --- shared loading / guards -------------------------------------------
    async def _load(self, player_name, with_players=False):
        """Load (game, player[, ordered players + seat index]) in one place."""
        game = await sync_to_async(Game.objects.get)(code=self.room_name)
        player = await sync_to_async(Player.objects.get)(name=player_name, game=game)
        players, index = None, -1
        if with_players:
            players = await sync_to_async(list)(game.players.all().order_by('created_at'))
            index = next((i for i, p in enumerate(players) if p.id == player.id), -1)
        return TurnContext(game=game, player=player, players=players, index=index)

    async def _load_turn_player(self):
        """Load the player whose turn it currently is (used by the AI loop)."""
        game = await sync_to_async(Game.objects.get)(code=self.room_name)
        players = await sync_to_async(list)(game.players.all().order_by('created_at'))
        index = game.turn_player_index % len(players)
        return TurnContext(game=game, player=players[index], players=players, index=index)

    @staticmethod
    def _is_turn(ctx):
        turn_player = ctx.players[ctx.game.turn_player_index % len(ctx.players)]
        return ctx.player.id == turn_player.id

    def _ensure_ai_running(self):
        task = GameConsumer.ai_tasks.get(self.room_name)
        if task is None or task.done():
            GameConsumer.ai_tasks[self.room_name] = asyncio.create_task(self.handle_ai_turns())

    # --- S3: turn timer / AFK auto-act -------------------------------------
    def _cancel_turn_timer(self):
        """Cancel any pending turn timer for this room (action taken / no human)."""
        task = GameConsumer.turn_timers.pop(self.room_name, None)
        if task is not None and not task.done():
            task.cancel()

    async def _schedule_turn_timer(self, broadcast=True):
        """Start a fresh per-turn deadline when it's a HUMAN's turn.

        Called after every move (via broadcast_action) and on initial state.
        Cancels any in-flight timer first so each turn gets a clean window
        (reset each turn, cancel on action). No-op when it's an AI's turn or
        the game has ended — the AI driver keeps those seats moving.

        ``broadcast`` controls whether we push a ``refresh_state`` so clients
        pick up the new deadline immediately. It MUST be False on the
        ``get_game_state`` path: that path already returns the full state
        (deadline included) to the requester, and a refresh there would make
        every client re-fetch state, which would re-schedule + re-broadcast
        again — an unbounded refresh storm (S3 bugfix).
        """
        self._cancel_turn_timer()
        try:
            game = await sync_to_async(Game.objects.get)(code=self.room_name)
        except Game.DoesNotExist:
            return
        if not game.is_active or game.phase == 'DEALING':
            await self._clear_deadline(game)
            return
        ctx = await self._load_turn_player()
        if ctx.player.player_type != 'HUMAN':
            # AI turns are driven by handle_ai_turns; no human deadline.
            await self._clear_deadline(game)
            return

        deadline = timezone.now() + timedelta(seconds=self.TURN_TIMEOUT_SECONDS)
        game.turn_deadline = deadline
        await sync_to_async(game.save)(update_fields=['turn_deadline'])
        # Snapshot the seat + step the timer is for, so when it fires we can
        # confirm the turn never changed and never double-act.
        GameConsumer.turn_timers[self.room_name] = asyncio.create_task(
            self._run_turn_timer(ctx.player.id, game.turn_player_index, game.turn_step))
        # Tell clients the new deadline so they can show a live countdown.
        # Skipped on the get_game_state path (see docstring) to avoid a storm.
        if broadcast:
            await self.broadcast_refresh()

    async def _clear_deadline(self, game):
        if game.turn_deadline is not None:
            game.turn_deadline = None
            await sync_to_async(game.save)(update_fields=['turn_deadline'])

    async def _run_turn_timer(self, player_id, turn_index, turn_step):
        """Wait out the deadline, then auto-act for the AFK human (no busy-wait)."""
        try:
            await asyncio.sleep(self.TURN_TIMEOUT_SECONDS)
            # Re-load fresh state: only act if the SAME player is still on the
            # SAME turn/step — i.e. they never acted. This is the never-double-act
            # guard (a human action cancels this task before we get here anyway).
            game = await sync_to_async(Game.objects.get)(code=self.room_name)
            if not game.is_active:
                return
            ctx = await self._load_turn_player()
            # Never-double-act guard: the same player must still be on the SAME
            # turn AND the SAME step the timer was armed for. turn_step matters
            # because a human PICK advances PICK->DISCARD without changing the
            # seat index — if we only checked the index, a timer armed on PICK
            # could fire and auto-DISCARD right after the human picked, stealing
            # their discard. (S3 QA bugfix.)
            if (ctx.player.id != player_id
                    or game.turn_player_index != turn_index
                    or game.turn_step != turn_step
                    or ctx.player.player_type != 'HUMAN'):
                return  # turn/step moved on; the human acted -> nothing to do
            await self._auto_act(game, ctx.player, ctx.index, turn_step)
        except asyncio.CancelledError:
            # Normal: a real action (or turn change) cancelled us.
            raise
        except Exception:
            logger.exception("Turn timer auto-act failed in room %s", self.room_name)
        finally:
            # Whatever happened, re-arm so the (possibly new) current seat gets a
            # timer and AI seats keep flowing.
            if GameConsumer.turn_timers.get(self.room_name) is asyncio.current_task():
                GameConsumer.turn_timers.pop(self.room_name, None)
            self._ensure_ai_running()
            await self._schedule_turn_timer()

    async def _auto_act(self, game, player, player_index, turn_step):
        """Apply the pure auto-act decision for an AFK human via the normal flow."""
        choice_card = game.visibles[-1] if game.visibles else None
        jokers = jokers_from_maal(player.hand, game.maal_card)
        decision = auto_act_decision(
            turn_step, player.hand, choice_card=choice_card,
            deck_count=len(game.deck), visibles_count=len(game.visibles), jokers=jokers)
        if decision is None:
            logger.warning("Turn timer: no safe auto-act for %s in room %s (step=%s)",
                           player.name, self.room_name, turn_step)
            return
        kind, arg = decision
        logger.info("Turn timer auto-acting for AFK player %s in room %s: %s %s",
                    player.name, self.room_name, kind, arg)
        if kind == 'pick':
            await self._perform_pick(game, player, player_index, arg, 'player_pick')
        elif kind == 'discard':
            await self._perform_discard(game, player, player_index, 'player_discard', card_index=arg)

    def run_player_turn(self, player_model, **kwargs):
        player = HumanPlayer(player_model) if player_model.player_type == 'HUMAN' else AIPlayer(player_model)
        return player.process_turn(**kwargs)

    @staticmethod
    def _select_cards(hand, card_indices):
        """Return (card_dicts, card_objs) for valid in-range indices, else (None, None)."""
        if not card_indices or any(not (0 <= i < len(hand)) for i in card_indices):
            return None, None
        card_dicts = [hand[i] for i in card_indices]
        return card_dicts, [Card.from_dict(c) for c in card_dicts]

    # --- one pick / discard path, shared by humans and AI ------------------
    async def _perform_pick(self, game, player, player_index, source, action_type, target_index=None):
        success, picked_card, actual_source = await sync_to_async(self.run_player_turn)(
            player, source=source, target_index=target_index)
        if not success:
            return False
        await sync_to_async(GameAction.objects.create)(
            game=game, player=player, action_type='PICK',
            data={'source': actual_source, 'card': picked_card})
        await self.broadcast_action({
            'type': action_type,
            'player_index': player_index,
            'player_name': player.name,
            'source': actual_source,
            # The deck pick stays hidden; only a 'choice' pick reveals the card.
            'card': picked_card if actual_source == 'choice' else None,
        })
        return True

    async def _perform_discard(self, game, player, player_index, action_type, card_index=None):
        success, discarded_card, _ = await sync_to_async(self.run_player_turn)(player, card_index=card_index)
        if not success:
            return False
        player.turn_count += 1
        await sync_to_async(player.save)()
        await sync_to_async(GameAction.objects.create)(
            game=game, player=player, action_type='DISCARD', data={'card': discarded_card})
        await self.broadcast_action({
            'type': action_type,
            'player_index': player_index,
            'player_name': player.name,
            'card': discarded_card,
        })
        return True

    # --- human action handlers ---------------------------------------------
    async def pick_card(self, player_name, source, target_index):
        ctx = await self._load(player_name, with_players=True)
        if self._is_turn(ctx):
            # S3: the player acted in time -> cancel the AFK timer before the move
            # so it can't also fire, then re-arm for the next step/seat after.
            self._cancel_turn_timer()
            await self._perform_pick(ctx.game, ctx.player, ctx.index, source, 'player_pick', target_index)
            await self._schedule_turn_timer()

    async def discard_card(self, player_name, card_index):
        ctx = await self._load(player_name, with_players=True)
        if self._is_turn(ctx):
            self._cancel_turn_timer()  # S3: action taken in time
            await self._perform_discard(ctx.game, ctx.player, ctx.index, 'player_discard', card_index)
            await self._schedule_turn_timer()  # S3: arm next seat's deadline

    async def reorder_hand(self, player_name, old_index, new_index):
        ctx = await self._load(player_name)
        hand = list(ctx.player.hand)
        if 0 <= old_index < len(hand) and 0 <= new_index < len(hand):
            hand.insert(new_index, hand.pop(old_index))
            ctx.player.hand = hand
            await sync_to_async(ctx.player.save)()
            # No broadcast: only the reordering player cares about their own order.

    async def register_sequence(self, player_name, sequence_id, card_indices):
        ctx = await self._load(player_name)
        player_model = ctx.player

        # Validate the selection forms a real sequence before accepting it.
        cards, card_objs = self._select_cards(player_model.hand, card_indices)
        if card_objs is None:
            return await self.send_reject('SHOW_SEQUENCE_FAILED', "Invalid card selection.")
        # S2: once the maal is revealed, accept dirty (joker-filled) sequences
        # using the shared tiplu+relatives derivation. Before the maal is set
        # the joker set is empty, so this stays pure-only as before.
        jokers = jokers_from_maal(player_model.hand, ctx.game.maal_card)
        if not is_sequence(card_objs, jokers):
            return await self.send_reject('SHOW_SEQUENCE_FAILED', "These cards don't form a sequence.")

        # Record the shown sequence (cards stay in hand until all three are done).
        current_sequences = player_model.shown_sequences
        current_sequences.append(cards)
        player_model.shown_sequences = current_sequences

        all_done = len([s for s in current_sequences if s]) >= 3
        if all_done:
            # Only now strip the registered cards from the hand.
            registered_ids = {c['id'] for seq in current_sequences for c in seq}
            player_model.hand = [c for c in player_model.hand if c['id'] not in registered_ids]

        await sync_to_async(player_model.save)()
        needs_maal = all_done and ctx.game.maal_card is None

        await self.broadcast_action({
            'type': 'SHOW_SEQUENCE_SUCCESS',
            'player_name': player_name,
            'sequence_id': sequence_id,
            'all_sequences_done': all_done,
            'needs_maal_selection': needs_maal,
            'unseen_cards': ctx.game.deck if needs_maal else [],
        })

    async def register_tunnela(self, player_name, card_indices):
        ctx = await self._load(player_name)
        if ctx.player.turn_count > 0:
            return  # tunnela is a first-round-only show

        cards, card_objs = self._select_cards(ctx.player.hand, card_indices)
        if card_objs is None or not is_tunnela(card_objs):
            return await self.send_reject('SHOW_TUNNELA_FAILED', "A tunnela needs 3 identical cards.")

        await self.broadcast_action({
            'type': 'SHOW_TUNNELA_SUCCESS',
            'player_name': player_name,
            'cards': cards,
        })

    async def register_dublee(self, player_name, card_indices):
        ctx = await self._load(player_name)
        player_model = ctx.player

        cards, card_objs = self._select_cards(player_model.hand, card_indices)
        if card_objs is None or not is_dublee(card_objs):
            return await self.send_reject('SHOW_DUBLEE_FAILED', "A dublee is a pair of identical cards.")

        current_sequences = player_model.shown_sequences
        current_sequences.append(cards)
        player_model.shown_sequences = current_sequences
        await sync_to_async(player_model.save)()

        # For dublee, need 7 or 8. 7 unlocks the maal, 8 wins.
        all_done = len(current_sequences) >= 7
        needs_maal = all_done and ctx.game.maal_card is None

        await self.broadcast_action({
            'type': 'SHOW_DUBLEE_SUCCESS',
            'player_name': player_name,
            'all_sequences_done': all_done,
            'needs_maal_selection': needs_maal,
            'unseen_cards': ctx.game.deck if needs_maal else [],
        })

    async def cancel_sequence(self, player_name):
        ctx = await self._load(player_name)
        ctx.player.shown_sequences = []
        await sync_to_async(ctx.player.save)()
        await self.broadcast_action({'type': 'SHOW_SEQUENCE_CANCEL', 'player_name': player_name})

    async def select_maal(self, player_name, card_id):
        game = await sync_to_async(Game.objects.get)(code=self.room_name)
        card_to_move = next((c for c in game.deck if c['id'] == card_id), None)
        if not card_to_move:
            return

        new_deck = [c for c in game.deck if c['id'] != card_id]
        new_deck.insert(0, card_to_move)  # place the chosen card at the bottom
        game.deck = new_deck
        game.maal_card = card_to_move
        game.phase = 'MAAL_REVEALED'
        await sync_to_async(game.save)()

        await self.broadcast_action({
            'type': 'MAAL_SELECTED',
            'player_name': player_name,
            'card': card_to_move,
        })

    async def claim_game(self, player_name):
        ctx = await self._load(player_name)
        # TODO: validate the full hand with rules.is_winning_hand once the claim
        # flow tracks maal-jokers. For now trust the client's "1 card left" rule.
        if len(ctx.player.hand) == 1:
            ctx.game.is_active = False
            await sync_to_async(ctx.game.save)()
            await self.broadcast_action({
                'type': 'GAME_CLAIMED',
                'player_name': player_name,
                'message': f"{player_name} has won the game!",
            })

    # F1: cosmetic gesture/emote. Validated against the shared allowlist and
    # broadcast to everyone (including the sender) as a GESTURE action. It does
    # NOT touch game state, so it skips the usual state-refresh that follows a
    # real move (an emote shouldn't force every client to re-fetch their hand).
    async def gesture(self, player_name, gesture):
        if not emotes.is_valid_gesture(gesture):
            return
        await self._broadcast_action_only({
            'type': 'GESTURE',
            'player_name': player_name,
            'gesture': gesture,
        })

    # --- quick-chat (F2) ----------------------------------------------------
    async def chat(self, player_name, phrase_id):
        """Human quick-chat: validate the phrase id, then broadcast it."""
        await self.broadcast_chat(player_name, phrase_id)

    async def broadcast_chat(self, player_name, phrase_id):
        """Validate `phrase_id` against CHAT_PHRASES and broadcast a CHAT action.

        Reusable by the AI agent (F3): call
            await self.broadcast_chat(ai_player_name, phrase_id)
        to make an AI say a preset line. Unknown ids are ignored (no broadcast).
        Broadcasts {type:'CHAT', player_name, phrase_id, text} (+ optional
        `gesture` if the phrase pairs one, for a best-effort avatar animation).
        """
        phrase = emotes.chat_phrase(phrase_id)
        if not phrase:
            return False
        await self.broadcast_action({
            'type': 'CHAT',
            'player_name': player_name,
            'phrase_id': phrase_id,
            'text': phrase['text'],
            'gesture': phrase.get('gesture'),
        })
        return True

    # --- AI driver ----------------------------------------------------------
    async def handle_ai_turns(self):
        try:
            while True:
                ctx = await self._load_turn_player()
                if ctx.player.player_type != 'AI':
                    logger.debug("Turn back to human player %s", ctx.player.name)
                    # S3: control handed back to a human — arm their AFK timer.
                    await self._schedule_turn_timer()
                    break

                logger.debug("AI turn for %s (seat %s)", ctx.player.name, ctx.index)

                # Let the PREVIOUS player's move (e.g. a human's discard) finish
                # propagating + animating on every client before the AI acts on
                # the same pile. Without this, the AI's pick can reach a client
                # before that client has placed the discarded card on the board,
                # glitching the animation.
                await asyncio.sleep(1.2)

                # F3: the AIPlayer now decides its own pick source from the
                # rules engine (extend a meld -> choice, else deck). We pass
                # source=None so handle_pick runs its strategy; it still falls
                # back to deck when the choice pile is useless/empty.
                if await self._perform_pick(ctx.game, ctx.player, ctx.index, None, 'ai_pick'):
                    await asyncio.sleep(1.5)  # let the pick animation play
                else:
                    # F3: loop-safety. A pick can only fail when the deck AND the
                    # choice pile are both empty. In that case the AI cannot take
                    # its turn, turn_step stays on PICK, and discard would fail
                    # too — re-looping on the same seat forever. Stop the driver
                    # instead of stalling; the game is wedged on an empty deck and
                    # only a (human) reset can move it on.
                    logger.warning("AI %s could not pick (deck+choice empty) in "
                                   "room %s; stopping AI loop.", ctx.player.name, self.room_name)
                    break

                # F3: between pick and discard, try to show any melds the AI now
                # holds, pick the maal when prompted, and claim if it has won.
                # When it claims it also performs its own (winning) discard and
                # returns True, so we stop here rather than discarding twice.
                player = await sync_to_async(Player.objects.get)(id=ctx.player.id)
                claimed = await self._ai_show_and_claim(ctx.game, player, ctx.index)
                if claimed:
                    break

                # 2. AI discards (re-fetch: pick/show may have changed the hand).
                player = await sync_to_async(Player.objects.get)(id=ctx.player.id)
                # F3: defensive — if the game ended for any other reason, stop.
                game_now = await sync_to_async(Game.objects.get)(code=self.room_name)
                if not game_now.is_active:
                    break
                if await self._perform_discard(ctx.game, player, ctx.index, 'ai_discard'):
                    await asyncio.sleep(1.5)  # let the discard animation play
                    await self._ai_maybe_quip(player.name)  # occasional liveliness
                else:
                    # F3: loop-safety. A successful pick leaves turn_step=DISCARD
                    # with a non-empty hand, so discard should always succeed.
                    # If it somehow doesn't, the turn never advances — break
                    # rather than spin on the same seat forever.
                    logger.warning("AI %s discard failed in room %s; stopping AI "
                                   "loop to avoid a stall.", player.name, self.room_name)
                    break
        except Exception:
            logger.exception("AI loop crashed in room %s", self.room_name)

    # F3: -------------------------------------------------------------------
    # AI meld-showing / maal-selection / claim driver. Reuses the same
    # consumer flows a human triggers (register_sequence, register_tunnela,
    # select_maal, claim_game) so there is one code path and one set of
    # broadcasts. Everything here is additive and guarded so it's a no-op when
    # the AI has nothing to show.
    # -----------------------------------------------------------------------
    async def _ai_show_and_claim(self, game, player, player_index):
        # Re-fetch fresh game/player so we act on post-pick state.
        game = await sync_to_async(Game.objects.get)(code=self.room_name)
        player = await sync_to_async(Player.objects.get)(id=player.id)

        jokers = jokers_from_maal(player.hand, game.maal_card)
        already_shown = len([s for s in player.shown_sequences if s])

        # First round only: a tunnela may be shown.
        if player.turn_count == 0:
            for grp in find_showable_tunnelas(player.hand):
                await self.register_tunnela(player.name, grp)
                await asyncio.sleep(0.6)

        # Show sequences until the AI has three down (which unlocks maal).
        if already_shown < 3:
            seqs = find_showable_sequences(player.hand, jokers, limit=3 - already_shown)
            for seq in seqs:
                # Re-read indices each time: register_sequence keeps cards in the
                # hand until all three are shown, so indices stay stable here.
                player = await sync_to_async(Player.objects.get)(id=player.id)
                await self.register_sequence(player.name, len(player.shown_sequences), seq)
                await asyncio.sleep(0.6)

        # If the AI just unlocked the maal and none is chosen, pick a good one.
        player = await sync_to_async(Player.objects.get)(id=player.id)
        game = await sync_to_async(Game.objects.get)(code=self.room_name)
        if len([s for s in player.shown_sequences if s]) >= 3 and game.maal_card is None and game.deck:
            await self._ai_select_maal(game, player)
            await asyncio.sleep(0.6)

        # Claim if discarding one card leaves a winning hand. NOTE: at this point
        # the AI is holding its post-pick hand (one card more than a finished
        # 21-card hand), so a bare is_winning() never fires — we must check
        # whether *some* discard completes the win. Returns True when claimed so
        # the driver skips the normal discard step.
        player = await sync_to_async(Player.objects.get)(id=player.id)
        game = await sync_to_async(Game.objects.get)(code=self.room_name)
        claimed = await self._ai_claim(game, player)

        # F3 hook (F1 gestures / F2 chat): once those branches land, this is the
        # natural place for the AI to emote — e.g. emit a 'celebrate' gesture on
        # a claim or a quip on showing all sequences. Intentionally a no-op now
        # so we don't hard-depend on feature branches that aren't merged yet.
        # Example (guarded so it's safe before F1/F2 exist):
        #   if hasattr(self, 'send_gesture'):
        #       await self.send_gesture(player.name, 'celebrate')
        return claimed

    async def _ai_select_maal(self, game, player):
        """Pick the maal that maximises the AI's own wild cards.

        Choosing a face the AI holds many copies of turns those copies into
        jokers, which is the strongest pick available from the visible state.
        """
        deck = game.deck
        if not deck:
            return
        hand_faces = {}
        for c in player.hand:
            hand_faces[(c['suit'], c['number'])] = hand_faces.get((c['suit'], c['number']), 0) + 1
        # Prefer a deck card whose face the AI already holds; else just take one.
        best = max(deck, key=lambda c: hand_faces.get((c['suit'], c['number']), 0))
        await self.select_maal(player.name, best['id'])

    async def _ai_claim(self, game, player):
        """Claim the game iff some single discard leaves a winning hand.

        The AI is mid-turn holding one extra card, so it must discard the
        card whose removal completes the win, leaving the finished 21-card
        hand on the table (mirroring the human "1 card left -> claim" rule).
        Returns True when a claim was made (so the driver skips its own
        discard), False otherwise.
        """
        jokers = jokers_from_maal(player.hand, game.maal_card)
        discard_idx = claim_discard_index(player.hand, jokers)
        if discard_idx is None:
            return False

        # Discard the winning card via the normal path so the board + the
        # GameAction log stay consistent (turn also advances off this seat).
        discarded = await self._perform_discard(
            game, player, game.turn_player_index, 'ai_discard', card_index=discard_idx)
        if discarded:
            await asyncio.sleep(0.6)

        game = await sync_to_async(Game.objects.get)(code=self.room_name)
        game.is_active = False
        await sync_to_async(game.save)()

        # F3+F1+F2: the AI celebrates its win before the game-over banner (which
        # makes clients reload), so the emote is actually seen.
        await self._ai_emote(player.name, gesture='celebrate', phrase_id='iwin', pause=1.0)

        await self.broadcast_action({
            'type': 'GAME_CLAIMED',
            'player_name': player.name,
            'message': f"{player.name} has won the game!",
        })
        return True

    async def _ai_maybe_quip(self, player_name):
        """Occasionally play a subtle gesture / quick-chat so AIs feel alive.

        Low-probability and cosmetic — only valid allowlisted ids are used."""
        roll = random.random()
        if roll < 0.12:
            await self._ai_emote(player_name, gesture=random.choice(['think', 'nod', 'shrug', 'clap']))
        if roll < 0.05:
            await self._ai_emote(player_name, phrase_id=random.choice(['nice', 'gg', 'hurryup', 'hello']))

    async def _ai_emote(self, player_name, gesture=None, phrase_id=None, pause=0.0):
        """Make an AI play a gesture and/or quick-chat line (cosmetic, best-effort).

        Reuses the F1 gesture handler and the F2 broadcast_chat helper so AI
        emotes go through the exact same validated, networked path as humans.
        """
        try:
            if gesture:
                await self.gesture(player_name, gesture)
            if phrase_id:
                await self.broadcast_chat(player_name, phrase_id)
            if pause:
                await asyncio.sleep(pause)
        except Exception:
            logger.exception("AI emote failed for %s", player_name)

    # --- broadcasting / state ----------------------------------------------
    async def send_reject(self, reject_type, reason):
        """Notify only the acting player that a play was rejected (no state change)."""
        await self.send(text_data=json.dumps({
            'message': json.dumps({
                'type': 'ai_action',
                'action': {'type': reject_type, 'reason': reason},
            })
        }))

    async def broadcast_action(self, action):
        # Notify all clients about a specific action, then push a full refresh.
        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'game_message', 'message': json.dumps({'type': 'ai_action', 'action': action})},
        )
        await self.broadcast_refresh()

    async def broadcast_refresh(self):
        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'game_message', 'message': json.dumps({'type': 'refresh_state'})},
        )

    # F1: broadcast an action to every client WITHOUT a following state refresh.
    # For cosmetic-only actions (gestures) that don't change game state.
    async def _broadcast_action_only(self, action):
        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'game_message', 'message': json.dumps({'type': 'ai_action', 'action': action})},
        )

    def _get_or_claim_player(self, player_name):
        """Resolve the socket's player, claiming a fresh seat if needed.

        Name match -> reconnect to that exact seat (this is how a player who
        left rejoins: same name restores their hand). No match -> seat them in
        the first NEVER-occupied human slot, renaming it. A seat whose owner
        only disconnected is never auto-claimed, so an absent player's hand
        can't be hijacked. Returns the Player, or None if no fresh seat exists.
        """
        with transaction.atomic():
            try:
                return Player.objects.get(name=player_name, game__code=self.room_name)
            except Player.DoesNotExist:
                # DB writes from the consumer are serialized on one thread, so a
                # plain read is safe here (SQLite has no row locks anyway).
                seat = (Player.objects
                        .filter(game__code=self.room_name, player_type='HUMAN', has_owner=False)
                        .order_by('created_at')
                        .first())
                if seat is None:
                    return None
                seat.name = player_name
                seat.is_joined = True
                seat.has_owner = True
                seat.save(update_fields=['name', 'is_joined', 'has_owner'])
                return seat

    async def send_game_state(self, player_name):
        player = await sync_to_async(self._get_or_claim_player)(player_name)
        if player is None:
            await self.send_reject('JOIN_FAILED', 'This game has no open seat to join.')
            return
        game = await sync_to_async(Game.objects.get)(code=self.room_name)

        # Remember the seat this socket now controls. Mark it connected and
        # owned (covers reconnecting and claiming a fresh seat by its exact name).
        self.player_name = player.name
        if not (player.is_joined and player.has_owner):
            player.is_joined = True
            player.has_owner = True
            await sync_to_async(player.save)(update_fields=['is_joined', 'has_owner'])
        players_models = await sync_to_async(list)(game.players.all().order_by('created_at'))

        players_data = [{
            'name': p.name,
            'player_type': p.player_type,
            'hand_size': len(p.hand),
            'has_shown': len([s for s in p.shown_sequences if s]) >= 3,
            'avatar': p.avatar,
        } for p in players_models]

        has_shown_all = len([s for s in player.shown_sequences if s]) >= 3
        visible_maal = game.maal_card if has_shown_all else None
        show_allowed = (game.turn_step == 'DISCARD') or (player.turn_count == 0)

        state = {
            'hand': player.hand,
            'shown_sequences': player.shown_sequences,
            'points': player.points,
            'turn_count': player.turn_count,
            'show_sequence_allowed': show_allowed,
            'deck_count': len(game.deck),
            'visibles': game.visibles,
            'choice_card': game.visibles[-1] if game.visibles else None,
            'turn_player_index': game.turn_player_index,
            'turn_step': game.turn_step,
            'phase': game.phase,
            'players': players_data,
            'maal_card': visible_maal,
            # S3: ISO-8601 UTC deadline for the current turn (null when none).
            # Clients render a live countdown from this; the server is the source
            # of truth and auto-acts if it lapses.
            'turn_deadline': game.turn_deadline.isoformat() if game.turn_deadline else None,
            'turn_timeout_seconds': self.TURN_TIMEOUT_SECONDS,
        }

        await self.send(text_data=json.dumps({
            'message': json.dumps({'type': 'game_state', 'state': state})
        }))

    async def game_message(self, event):
        await self.send(text_data=json.dumps({'message': event['message']}))
