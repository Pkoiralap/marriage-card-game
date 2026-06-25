import json
import asyncio
import logging
import random
from dataclasses import dataclass

from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
from django.db import transaction

from .models import Player, Game, GameAction
from .logic import HumanPlayer, AIPlayer
from .rules import Card, is_sequence, is_tunnela, is_dublee

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
    }

    # --- connection lifecycle ----------------------------------------------
    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = 'game_%s' % self.room_name
        self.player_name = None  # set once we learn who this socket is
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        # Release this socket's seat so it shows as open again in the lobby.
        if self.player_name:
            await self._set_joined(self.player_name, False)
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def _set_joined(self, player_name, joined):
        try:
            await sync_to_async(
                Player.objects.filter(name=player_name, game__code=self.room_name).update
            )(is_joined=joined)
        except Exception:
            logger.exception("Failed to set joined=%s for %s", joined, player_name)

    async def receive(self, text_data):
        try:
            message = json.loads(json.loads(text_data).get('message', '{}'))
            entry = self.DISPATCH.get(message.get('type'))
            if entry:
                method_name, fields = entry
                await getattr(self, method_name)(*(message.get(f) for f in fields))
            if message.get('type') == 'get_game_state':
                self._ensure_ai_running()
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
            await self._perform_pick(ctx.game, ctx.player, ctx.index, source, 'player_pick', target_index)

    async def discard_card(self, player_name, card_index):
        ctx = await self._load(player_name, with_players=True)
        if self._is_turn(ctx):
            await self._perform_discard(ctx.game, ctx.player, ctx.index, 'player_discard', card_index)

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
        if not is_sequence(card_objs):
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

    # --- AI driver ----------------------------------------------------------
    async def handle_ai_turns(self):
        try:
            while True:
                ctx = await self._load_turn_player()
                if ctx.player.player_type != 'AI':
                    logger.debug("Turn back to human player %s", ctx.player.name)
                    break

                logger.debug("AI turn for %s (seat %s)", ctx.player.name, ctx.index)

                # Let the PREVIOUS player's move (e.g. a human's discard) finish
                # propagating + animating on every client before the AI acts on
                # the same pile. Without this, the AI's pick can reach a client
                # before that client has placed the discarded card on the board,
                # glitching the animation.
                await asyncio.sleep(1.2)

                # 1. AI picks (random source, falling back to deck).
                source = 'choice' if (ctx.game.visibles and random.random() > 0.5) else 'deck'
                if await self._perform_pick(ctx.game, ctx.player, ctx.index, source, 'ai_pick'):
                    await asyncio.sleep(1.5)  # let the pick animation play

                # 2. AI discards (re-fetch: pick advanced turn_step and the hand).
                player = await sync_to_async(Player.objects.get)(id=ctx.player.id)
                if await self._perform_discard(ctx.game, player, ctx.index, 'ai_discard'):
                    await asyncio.sleep(1.5)  # let the discard animation play
        except Exception:
            logger.exception("AI loop crashed in room %s", self.room_name)

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
        }

        await self.send(text_data=json.dumps({
            'message': json.dumps({'type': 'game_state', 'state': state})
        }))

    async def game_message(self, event):
        await self.send(text_data=json.dumps({'message': event['message']}))
