"""Infra-free tests for the consumer's logic-bearing helpers.

The websocket/DB/channel-layer paths need Redis and aren't exercised here; these
cover the pure pieces of the refactor (selection, turn guard, dispatch coverage)
so they run fast with no external services (via Django's runner, which loads
the app registry these handlers import):

    python manage.py test game
"""

import asyncio
import json
import unittest
from types import SimpleNamespace

from django.test import Client, TestCase

from game import emotes  # F2
from game.consumers import GameConsumer, TurnContext
from game.models import CODE_ALPHABET, Game, Player


class SelectCardsTests(unittest.TestCase):
    HAND = [
        {"suit": "SPADE", "number": "4", "id": 1},
        {"suit": "SPADE", "number": "5", "id": 2},
        {"suit": "SPADE", "number": "6", "id": 3},
    ]

    def test_valid_indices(self):
        dicts, objs = GameConsumer._select_cards(self.HAND, [0, 2])
        self.assertEqual([d["id"] for d in dicts], [1, 3])
        self.assertEqual([o.rank for o in objs], ["4", "6"])

    def test_out_of_range_rejected(self):
        self.assertEqual(GameConsumer._select_cards(self.HAND, [0, 9]), (None, None))

    def test_negative_rejected(self):
        self.assertEqual(GameConsumer._select_cards(self.HAND, [-1]), (None, None))

    def test_empty_rejected(self):
        self.assertEqual(GameConsumer._select_cards(self.HAND, []), (None, None))


class IsTurnTests(unittest.TestCase):
    def _ctx(self, turn_index, my_id):
        players = [SimpleNamespace(id=10), SimpleNamespace(id=11), SimpleNamespace(id=12)]
        game = SimpleNamespace(turn_player_index=turn_index)
        me = next(p for p in players if p.id == my_id)
        return TurnContext(game=game, player=me, players=players, index=players.index(me))

    def test_my_turn(self):
        self.assertTrue(GameConsumer._is_turn(self._ctx(0, 10)))

    def test_not_my_turn(self):
        self.assertFalse(GameConsumer._is_turn(self._ctx(0, 11)))

    def test_negative_index_wraps(self):
        # logic.py decrements the turn index modulo player count; it can go
        # negative before wrapping. Python's % keeps the guard correct.
        self.assertTrue(GameConsumer._is_turn(self._ctx(-1, 12)))


class DispatchTests(unittest.TestCase):
    def test_every_handler_exists(self):
        for msg_type, (method_name, _fields) in GameConsumer.DISPATCH.items():
            self.assertTrue(
                callable(getattr(GameConsumer, method_name, None)),
                f"{msg_type} -> missing handler {method_name}",
            )

    def test_known_message_types_covered(self):
        expected = {
            'get_game_state', 'pick_card', 'discard_card', 'register_sequence',
            'register_tunnela', 'register_dublee', 'select_maal', 'cancel_sequence',
            'reorder_hand', 'claim_game',
            'chat',  # F2
        }
        self.assertEqual(set(GameConsumer.DISPATCH), expected)


# F2: quick-chat phrase allowlist + broadcast helper.
class ChatPhraseTests(unittest.TestCase):
    def test_valid_id_returns_phrase(self):
        phrase = emotes.chat_phrase('gg')
        self.assertIsNotNone(phrase)
        self.assertEqual(phrase['text'], 'GG')

    def test_unknown_id_returns_none(self):
        self.assertIsNone(emotes.chat_phrase('definitely-not-a-phrase'))

    def test_every_phrase_has_id_and_text(self):
        for p in emotes.CHAT_PHRASES:
            self.assertTrue(p.get('id'), p)
            self.assertTrue(p.get('text'), p)

    def test_phrase_ids_are_unique(self):
        ids = [p['id'] for p in emotes.CHAT_PHRASES]
        self.assertEqual(len(ids), len(set(ids)))


class ChatBroadcastTests(unittest.TestCase):
    """broadcast_chat validates the id and only broadcasts allowed phrases."""

    def _consumer(self):
        c = GameConsumer()
        c.sent = []

        async def fake_broadcast_action(action):
            c.sent.append(action)

        c.broadcast_action = fake_broadcast_action
        return c

    def _run(self, coro):
        return asyncio.new_event_loop().run_until_complete(coro)

    def test_valid_phrase_broadcasts_chat(self):
        c = self._consumer()
        result = self._run(c.broadcast_chat('Alice', 'gg'))
        self.assertTrue(result)
        self.assertEqual(len(c.sent), 1)
        action = c.sent[0]
        self.assertEqual(action['type'], 'CHAT')
        self.assertEqual(action['player_name'], 'Alice')
        self.assertEqual(action['phrase_id'], 'gg')
        self.assertEqual(action['text'], 'GG')

    def test_invalid_phrase_is_ignored(self):
        c = self._consumer()
        result = self._run(c.broadcast_chat('Alice', 'bogus'))
        self.assertFalse(result)
        self.assertEqual(c.sent, [])


class CreateGameViewTests(TestCase):
    def _create(self, payload):
        resp = self.client.post(
            "/create_game/", data=json.dumps(payload), content_type="application/json")
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()

    def _seats(self, game_id):
        players = Player.objects.filter(game__id=game_id).order_by("created_at")
        return [(p.player_type, p.name) for p in players]

    def test_honors_seat_composition(self):
        data = self._create({
            "player_name": "Pravesh",
            "seats": [
                {"type": "HUMAN"},
                {"type": "AI"},
                {"type": "HUMAN", "name": "Bob"},
                {"type": "AI"},
            ],
        })
        seats = self._seats(data["game_id"])
        self.assertEqual(seats, [
            ("HUMAN", "Pravesh"), ("AI", "AI_1"), ("HUMAN", "Bob"), ("AI", "AI_2"),
        ])
        # Creator is the dealer and the game is dealt (21 cards each).
        game = Game.objects.get(id=data["game_id"])
        self.assertEqual(game.num_players, 4)
        self.assertTrue(Player.objects.get(name="Pravesh", game=game).is_dealer)
        self.assertEqual(len(Player.objects.get(name="Bob", game=game).hand), 21)

    def test_requires_name(self):
        resp = self.client.post(
            "/create_game/", data=json.dumps({"player_name": "  "}),
            content_type="application/json")
        self.assertEqual(resp.status_code, 400)

    def test_legacy_payload_defaults_to_alternating(self):
        data = self._create({"player_name": "Me", "num_players": 4})
        types = [t for t, _ in self._seats(data["game_id"])]
        self.assertEqual(types, ["HUMAN", "AI", "HUMAN", "AI"])

    def test_returns_short_shareable_code(self):
        data = self._create({"player_name": "Me", "num_players": 4})
        code = data["code"]
        self.assertEqual(len(code), 4)
        self.assertTrue(all(c in CODE_ALPHABET for c in code), code)
        # The creator's seat is already claimed; AI + human-others are not.
        game = Game.objects.get(code=code)
        self.assertTrue(Player.objects.get(name="Me", game=game).is_joined)


class CodeAndLobbyTests(TestCase):
    def _create(self, payload):
        resp = self.client.post(
            "/create_game/", data=json.dumps(payload), content_type="application/json")
        return resp.json()

    def test_codes_are_unique(self):
        codes = {Game.generate_code() for _ in range(50)}
        # No collisions among freshly generated codes (DB is empty here).
        self.assertEqual(len(codes), 50)

    def test_code_length_grows_with_active_games(self):
        self.assertEqual(len(Game.generate_code()), 4)
        # Force many active games; the space must outgrow the count.
        Game.objects.bulk_create([
            Game(code=None, is_active=True) for _ in range(20000)
        ])
        self.assertGreater(len(Game.generate_code()), 4)

    def test_list_games_shows_only_open_human_seats(self):
        self._create({
            "player_name": "Host",
            "seats": [
                {"type": "HUMAN"},                      # creator, already joined
                {"type": "AI"},
                {"type": "HUMAN", "name": "Sita"},      # open human seat
                {"type": "AI"},
            ],
        })
        games = self.client.get("/games/").json()["games"]
        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]["open_seats"], ["Sita"])
        self.assertEqual(len(games[0]["code"]), 4)

    def test_all_ai_game_not_listed(self):
        # Only the creator is human (and joined) -> no open seats -> not listed.
        self._create({
            "player_name": "Solo",
            "seats": [{"type": "HUMAN"}, {"type": "AI"}, {"type": "AI"}],
        })
        games = self.client.get("/games/").json()["games"]
        self.assertEqual(games, [])


class ClaimSeatTests(TestCase):
    # seats: (type, name, is_joined, has_owner)
    def _game(self, seats):
        game = Game.objects.create(num_players=len(seats), code=Game.generate_code())
        for i, (ptype, name, joined, owner) in enumerate(seats):
            Player.objects.create(
                name=name, game=game, player_type=ptype,
                is_joined=joined, has_owner=owner, is_dealer=(i == 0))
        return game

    def _consumer(self, code):
        c = GameConsumer()
        c.room_name = code
        c.player_name = None
        return c

    def test_new_name_claims_fresh_seat(self):
        game = self._game([
            ("HUMAN", "Host", True, True),
            ("AI", "AI_1", False, False),
            ("HUMAN", "Player 3", False, False),  # never-occupied seat
        ])
        player = self._consumer(game.code)._get_or_claim_player("Sita")
        self.assertEqual(player.name, "Sita")
        self.assertTrue(player.is_joined)
        self.assertTrue(player.has_owner)

    def test_existing_name_reconnects_to_same_seat(self):
        # An owner who left (is_joined=False) rejoins by name and keeps the seat.
        game = self._game([
            ("HUMAN", "Host", True, True),
            ("HUMAN", "Alice", False, True),  # away
        ])
        player = self._consumer(game.code)._get_or_claim_player("Alice")
        self.assertEqual(player.name, "Alice")

    def test_away_seat_cannot_be_stolen_by_new_name(self):
        # Only an AI + Alice's vacated (owned) seat remain. A new joiner must
        # NOT be able to take Alice's seat.
        game = self._game([
            ("HUMAN", "Host", True, True),
            ("HUMAN", "Alice", False, True),  # away but owned -> reserved
            ("AI", "AI_1", False, False),
        ])
        self.assertIsNone(self._consumer(game.code)._get_or_claim_player("Thief"))
        # Alice's seat is untouched and still hers.
        self.assertTrue(Player.objects.filter(name="Alice", game=game).exists())

    def test_full_table_returns_none(self):
        game = self._game([
            ("HUMAN", "Host", True, True),
            ("AI", "AI_1", False, False),  # AI seats are never claimable
        ])
        self.assertIsNone(self._consumer(game.code)._get_or_claim_player("LateComer"))

    def test_vacated_seat_not_listed_as_open(self):
        game = self._game([
            ("HUMAN", "Host", True, True),
            ("HUMAN", "Alice", False, True),    # away -> reserved, not "open"
            ("HUMAN", "Player 4", False, False),  # truly open
        ])
        self.assertEqual(game.open_human_seat_names(), ["Player 4"])


if __name__ == "__main__":
    unittest.main()
