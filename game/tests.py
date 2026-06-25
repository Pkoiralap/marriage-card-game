"""Infra-free tests for the consumer's logic-bearing helpers.

The websocket/DB/channel-layer paths need Redis and aren't exercised here; these
cover the pure pieces of the refactor (selection, turn guard, dispatch coverage)
so they run fast with no external services (via Django's runner, which loads
the app registry these handlers import):

    python manage.py test game
"""

import json
import unittest
from types import SimpleNamespace

from django.test import Client, TestCase

from game.consumers import GameConsumer, TurnContext
from game.logic import (
    choose_discard,
    claim_discard_index,
    find_showable_sequences,
    find_showable_tunnelas,
    is_winning,
    jokers_from_maal,
    should_pick_choice,
)
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
        }
        self.assertEqual(set(GameConsumer.DISPATCH), expected)


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


# F3: AI decision-helper tests. Pure (no DB) — they exercise the rules-engine
# backed heuristics that drive the smart AI.
def _card(suit, number, id):
    return {"suit": suit, "number": number, "id": id}


class AIDiscardTests(unittest.TestCase):
    def test_discards_dead_card_over_meld_card(self):
        # 4-5-6 of spades are entangled (sequence); the K of hearts is dead.
        hand = [
            _card("SPADE", "4", 1),
            _card("SPADE", "5", 2),
            _card("SPADE", "6", 3),
            _card("HEART", "K", 4),
        ]
        idx = choose_discard(hand)
        self.assertEqual(hand[idx]["id"], 4)

    def test_keeps_pair_discards_loner(self):
        # A pair of 9s connects; the lone 2 of clubs does not.
        hand = [
            _card("DIAMOND", "9", 1),
            _card("DIAMOND", "9", 2),
            _card("CLUB", "2", 3),
        ]
        idx = choose_discard(hand)
        self.assertEqual(hand[idx]["id"], 3)

    def test_empty_hand_returns_none(self):
        self.assertIsNone(choose_discard([]))

    def test_jokers_are_never_discarded(self):
        maal = _card("HEART", "7", 99)
        hand = [
            _card("HEART", "7", 10),  # this is a joker (matches maal face)
            _card("CLUB", "2", 11),   # dead card
            _card("CLUB", "K", 12),   # dead, high points
        ]
        jokers = jokers_from_maal(hand, maal)
        idx = choose_discard(hand, jokers)
        self.assertNotEqual(hand[idx]["id"], 10)


class AIPickTests(unittest.TestCase):
    def test_picks_choice_that_extends_sequence(self):
        hand = [_card("SPADE", "4", 1), _card("SPADE", "5", 2)]
        choice = _card("SPADE", "6", 3)  # completes 4-5-6
        self.assertTrue(should_pick_choice(hand, choice))

    def test_picks_choice_that_makes_pair(self):
        hand = [_card("CLUB", "9", 1)]
        self.assertTrue(should_pick_choice(hand, _card("CLUB", "9", 2)))

    def test_skips_useless_choice(self):
        hand = [_card("SPADE", "4", 1), _card("HEART", "K", 2)]
        self.assertFalse(should_pick_choice(hand, _card("DIAMOND", "8", 3)))

    def test_picks_joker_choice(self):
        maal = _card("HEART", "7", 99)
        hand = [_card("SPADE", "4", 1)]
        choice = _card("HEART", "7", 5)  # a joker face
        jokers = jokers_from_maal(hand + [choice], maal)
        self.assertTrue(should_pick_choice(hand, choice, jokers))

    def test_no_choice_card(self):
        self.assertFalse(should_pick_choice([_card("SPADE", "4", 1)], None))


class AIShowAndWinTests(unittest.TestCase):
    def test_recognises_winning_hand(self):
        hand = [
            _card("SPADE", "4", 1), _card("SPADE", "5", 2), _card("SPADE", "6", 3),
            _card("HEART", "9", 4), _card("HEART", "10", 5), _card("HEART", "J", 6),
        ]
        self.assertTrue(is_winning(hand))

    def test_non_winning_hand(self):
        hand = [
            _card("SPADE", "4", 1), _card("SPADE", "5", 2), _card("CLUB", "K", 3),
        ]
        self.assertFalse(is_winning(hand))

    def test_finds_showable_sequences(self):
        hand = [
            _card("SPADE", "4", 1), _card("SPADE", "5", 2), _card("SPADE", "6", 3),
            _card("HEART", "9", 4), _card("HEART", "10", 5), _card("HEART", "J", 6),
        ]
        groups = find_showable_sequences(hand, limit=3)
        self.assertEqual(len(groups), 2)
        # Groups are disjoint index sets that each form a sequence.
        flat = [i for g in groups for i in g]
        self.assertEqual(len(flat), len(set(flat)))

    def test_no_sequences_when_none_present(self):
        hand = [_card("SPADE", "4", 1), _card("HEART", "K", 2), _card("CLUB", "2", 3)]
        self.assertEqual(find_showable_sequences(hand), [])

    def test_finds_tunnela(self):
        hand = [
            _card("HEART", "7", 1), _card("HEART", "7", 2), _card("HEART", "7", 3),
            _card("CLUB", "2", 4),
        ]
        groups = find_showable_tunnelas(hand)
        self.assertEqual(len(groups), 1)
        self.assertEqual(sorted(groups[0]), [0, 1, 2])

    def test_no_tunnela_for_mixed_suit(self):
        hand = [
            _card("HEART", "7", 1), _card("DIAMOND", "7", 2), _card("HEART", "7", 3),
        ]
        self.assertEqual(find_showable_tunnelas(hand), [])


class AIPlayerTurnTests(TestCase):
    """End-to-end AIPlayer pick+discard through the model layer (no channels)."""

    def _game_with_ai(self, hand, deck, visibles, maal=None):
        game = Game.objects.create(
            num_players=1, code=Game.generate_code(), deck=deck, visibles=visibles,
            turn_step='PICK', maal_card=maal)
        player = Player.objects.create(name="AI_1", game=game, player_type='AI', hand=hand)
        return game, player

    def test_ai_picks_useful_choice_then_discards_dead(self):
        from game.logic import AIPlayer
        hand = [
            _card("SPADE", "4", 1), _card("SPADE", "5", 2), _card("HEART", "K", 3),
        ]
        game, player = self._game_with_ai(
            hand=list(hand), deck=[_card("CLUB", "2", 9)], visibles=[_card("SPADE", "6", 4)])

        ai = AIPlayer(player)
        ok, card, source = ai.process_turn()  # PICK step
        self.assertTrue(ok)
        # The 6S completes a sequence, so the AI should grab it from the choice.
        self.assertEqual(source, 'choice')
        self.assertEqual(card['id'], 4)

        player.refresh_from_db()
        game.refresh_from_db()
        ai2 = AIPlayer(player)
        ok2, discarded = ai2.handle_discard()
        self.assertTrue(ok2)
        # It keeps the 4-5-6 spade run and dumps the dead K of hearts.
        self.assertEqual(discarded['id'], 3)

    def test_ai_skips_useless_choice_and_draws_deck(self):
        from game.logic import AIPlayer
        game, player = self._game_with_ai(
            hand=[_card("SPADE", "4", 1), _card("HEART", "K", 2)],
            deck=[_card("CLUB", "3", 9)],
            visibles=[_card("DIAMOND", "8", 4)])  # useless choice
        ai = AIPlayer(player)
        ok, card, source = ai.process_turn()
        self.assertTrue(ok)
        self.assertEqual(source, 'deck')

    def test_ai_check_game_end_on_winning_hand(self):
        from game.logic import AIPlayer
        winning = [
            _card("SPADE", "4", 1), _card("SPADE", "5", 2), _card("SPADE", "6", 3),
            _card("HEART", "9", 4), _card("HEART", "10", 5), _card("HEART", "J", 6),
        ]
        game, player = self._game_with_ai(hand=winning, deck=[], visibles=[])
        ai = AIPlayer(player)
        self.assertTrue(ai.check_game_end())


class JokersFromMaalTests(unittest.TestCase):
    def test_no_maal_no_jokers(self):
        hand = [_card("SPADE", "4", 1)]
        self.assertEqual(jokers_from_maal(hand, None), set())

    def test_matches_maal_face(self):
        maal = _card("HEART", "7", 99)
        hand = [
            _card("HEART", "7", 1), _card("HEART", "7", 2), _card("SPADE", "7", 3),
        ]
        self.assertEqual(jokers_from_maal(hand, maal), {1, 2})


# F3 (QA): a finished, winning 21-card hand — two pure spade/heart runs plus
# five tunnelas (3 identical cards each). 7 melds * 3 = 21 cards.
def _winning_21():
    groups = [
        [("SPADE", "4"), ("SPADE", "5"), ("SPADE", "6")],     # pure sequence
        [("HEART", "9"), ("HEART", "10"), ("HEART", "J")],    # pure sequence
        [("CLUB", "2"), ("CLUB", "2"), ("CLUB", "2")],        # tunnela
        [("DIAMOND", "K"), ("DIAMOND", "K"), ("DIAMOND", "K")],
        [("SPADE", "8"), ("SPADE", "8"), ("SPADE", "8")],
        [("HEART", "3"), ("HEART", "3"), ("HEART", "3")],
        [("CLUB", "7"), ("CLUB", "7"), ("CLUB", "7")],
    ]
    out, cid = [], 0
    for grp in groups:
        for s, n in grp:
            cid += 1
            out.append(_card(s, n, cid))
    return out


class ClaimDiscardIndexTests(unittest.TestCase):
    """F3 (QA): the AI claims only after discarding the right extra card.

    A bare is_winning() never fires mid-turn (the AI holds one extra card, so
    the count isn't a multiple of the meld size). claim_discard_index bridges
    that: it finds the card to discard so the *remaining* 21 cards win.
    """

    def test_no_discard_wins_on_incomplete_hand(self):
        # One clean meld plus two unconnected cards: no single discard can leave
        # a fully-melded hand (a lone card can never form a meld).
        hand = [
            _card("SPADE", "4", 1), _card("SPADE", "5", 2), _card("SPADE", "6", 3),
            _card("HEART", "K", 4), _card("CLUB", "2", 5),
        ]
        self.assertIsNone(claim_discard_index(hand))

    def test_finds_the_discard_that_completes_the_win(self):
        # 21 winning cards + one dead extra = the real post-pick hand.
        hand = _winning_21() + [_card("DIAMOND", "2", 999)]
        idx = claim_discard_index(hand)
        self.assertIsNotNone(idx)
        # Discarding the chosen card must leave a genuine winning hand.
        remaining = hand[:idx] + hand[idx + 1:]
        self.assertEqual(len(remaining), 21)
        self.assertTrue(is_winning(remaining))
        # And the natural choice is to dump the dead extra (id 999).
        self.assertEqual(hand[idx]["id"], 999)

    def test_bare_is_winning_does_not_fire_on_post_pick_hand(self):
        # Regression: the original code claimed via is_winning(full hand), which
        # is always False at 22 cards -> the AI could never win.
        hand = _winning_21() + [_card("DIAMOND", "2", 999)]
        self.assertFalse(is_winning(hand))
        self.assertIsNotNone(claim_discard_index(hand))

    def test_empty_hand(self):
        self.assertIsNone(claim_discard_index([]))


class AIForcedDiscardTests(TestCase):
    """F3 (QA): the AI honours an explicit card_index (used by the claim path)."""

    def _ai(self, hand):
        game = Game.objects.create(
            num_players=1, code=Game.generate_code(), deck=[], visibles=[],
            turn_step='DISCARD')
        player = Player.objects.create(
            name="AI_1", game=game, player_type='AI', hand=hand)
        from game.logic import AIPlayer
        return AIPlayer(player)

    def test_forced_index_is_discarded_exactly(self):
        hand = [_card("SPADE", "4", 1), _card("SPADE", "5", 2), _card("HEART", "K", 3)]
        ai = self._ai(list(hand))
        ok, discarded = ai.handle_discard(card_index=0)
        self.assertTrue(ok)
        self.assertEqual(discarded["id"], 1)  # exactly the requested card

    def test_invalid_forced_index_falls_back_to_heuristic(self):
        hand = [_card("SPADE", "4", 1), _card("SPADE", "5", 2), _card("HEART", "K", 3)]
        ai = self._ai(list(hand))
        ok, discarded = ai.handle_discard(card_index=99)  # out of range
        self.assertTrue(ok)
        # Heuristic dumps the dead K of hearts, not a sequence card.
        self.assertEqual(discarded["id"], 3)


class AIDifficultyTests(TestCase):
    """F3 (QA): difficulty knob is read via getattr with no model field."""

    def _player(self):
        game = Game.objects.create(
            num_players=1, code=Game.generate_code(), deck=[], visibles=[])
        return Player.objects.create(
            name="AI_1", game=game, player_type='AI', hand=[])

    def test_defaults_to_normal_without_field(self):
        from game.logic import AIPlayer
        player = self._player()
        self.assertFalse(hasattr(player, 'ai_difficulty'))  # no migration added
        self.assertEqual(AIPlayer(player).difficulty, 'normal')  # no AttributeError

    def test_explicit_difficulty_argument(self):
        from game.logic import AIPlayer
        self.assertEqual(AIPlayer(self._player(), difficulty='easy').difficulty, 'easy')

    def test_hard_discard_lookahead_in_range_and_keeps_jokers(self):
        from game.logic import AIPlayer
        maal = _card("HEART", "7", 99)
        hand = [
            _card("HEART", "7", 10),                       # joker
            _card("SPADE", "4", 1), _card("SPADE", "5", 2),
            _card("HEART", "K", 3), _card("CLUB", "2", 4),
        ]
        game = Game.objects.create(
            num_players=1, code=Game.generate_code(), deck=[], visibles=[],
            turn_step='DISCARD', maal_card=maal)
        player = Player.objects.create(
            name="AI_1", game=game, player_type='AI', hand=list(hand))
        ai = AIPlayer(player, difficulty='hard')
        ok, discarded = ai.handle_discard()
        self.assertTrue(ok)
        self.assertNotEqual(discarded["id"], 10)  # never throw the joker


class AILoopProgressTests(TestCase):
    """F3 (QA): forward-progress invariants the AI driver relies on.

    The async driver (handle_ai_turns) needs Redis/channels, but its loop
    safety reduces to a model-layer contract: process_turn() advances the turn
    iff a step succeeds, and a pick can only fail when deck+choice are empty.
    These exercise that contract directly (the driver now BREAKS on a failed
    pick/discard so it can never spin on the same seat).
    """

    def _game(self, **kw):
        defaults = dict(num_players=2, code=Game.generate_code(), turn_step='PICK',
                        turn_player_index=0, deck=[], visibles=[])
        defaults.update(kw)
        return Game.objects.create(**defaults)

    def test_pick_fails_and_turn_does_not_advance_when_deck_and_choice_empty(self):
        from game.logic import AIPlayer
        game = self._game(deck=[], visibles=[])
        player = Player.objects.create(
            name="AI_1", game=game, player_type='AI',
            hand=[_card("SPADE", "4", 1), _card("HEART", "K", 2)])
        ai = AIPlayer(player)
        ok, _, _ = ai.process_turn()
        self.assertFalse(ok)                     # pick failed -> driver breaks
        self.assertEqual(ai.game_model.turn_step, 'PICK')
        self.assertEqual(ai.game_model.turn_player_index, 0)  # no advance

    def test_full_ai_turn_advances_to_next_seat(self):
        from game.logic import AIPlayer
        game = self._game(deck=[_card("CLUB", "3", 9)], visibles=[])
        player = Player.objects.create(
            name="AI_1", game=game, player_type='AI',
            hand=[_card("SPADE", "4", 1), _card("HEART", "K", 2)])
        ai = AIPlayer(player)
        ok, _, _ = ai.process_turn()             # PICK -> draws deck
        self.assertTrue(ok)
        player.refresh_from_db(); game.refresh_from_db()
        ai2 = AIPlayer(player)
        ok2, _, _ = ai2.process_turn()           # DISCARD -> advances seat
        self.assertTrue(ok2)
        self.assertEqual(ai2.game_model.turn_step, 'PICK')
        self.assertEqual(ai2.game_model.turn_player_index, 1)  # -1 % 2 == 1

    def test_all_ai_game_runs_many_turns_without_stalling(self):
        """Drive a 2-AI game through the model layer for many turns; it must
        keep advancing seats (no infinite re-loop on one seat) until a win or
        the deck runs dry."""
        from game.logic import AIPlayer
        deck = [_card("CLUB", str(((i % 9) + 2)), 1000 + i) for i in range(60)]
        game = self._game(num_players=2, deck=list(deck), visibles=[])
        p0 = Player.objects.create(
            name="AI_1", game=game, player_type='AI',
            hand=[_card("SPADE", "4", 1), _card("SPADE", "5", 2)])
        p1 = Player.objects.create(
            name="AI_2", game=game, player_type='AI',
            hand=[_card("HEART", "9", 3), _card("HEART", "10", 4)])
        players = [p0, p1]

        seats_seen = []
        for _ in range(200):  # generous cap; must terminate well before this
            game.refresh_from_db()
            if not game.deck:
                break
            idx = game.turn_player_index % 2
            seats_seen.append(idx)
            pm = players[idx]; pm.refresh_from_db()
            ai = AIPlayer(pm)
            picked, _, _ = ai.process_turn()       # PICK
            self.assertTrue(picked, "pick should succeed while deck non-empty")
            pm.refresh_from_db(); game.refresh_from_db()
            ai = AIPlayer(pm)
            discarded, _ = ai.handle_discard()
            self.assertTrue(discarded)
            # mirror process_turn's DISCARD bookkeeping (advance the seat)
            game.turn_step = 'PICK'
            game.turn_player_index = (game.turn_player_index - 1) % 2
            game.save()

        # The loop alternated seats and consumed the deck -> it progressed.
        self.assertIn(0, seats_seen)
        self.assertIn(1, seats_seen)


if __name__ == "__main__":
    unittest.main()
