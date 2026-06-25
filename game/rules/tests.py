"""Unit tests for the rules engine.

Pure tests — no database. Run either way::

    python -m unittest game.rules.tests           # plain, no Django needed
    python manage.py test game.rules               # via Django's runner
"""

import unittest

from game.rules import (
    Card,
    find_meld_partition,
    hand_points,
    is_dublee,
    is_pure_sequence,
    is_sequence,
    is_tunnela,
    is_valid_meld,
    is_winning_hand,
    unmelded_points,
)

_AUTO_ID = iter(range(1, 10_000))


def C(rank, suit, id=None):
    """Terse card builder; auto-assigns a unique id when not given."""
    return Card(suit=suit, rank=rank, id=id if id is not None else next(_AUTO_ID))


class CardTests(unittest.TestCase):
    def test_rank_value_and_color(self):
        self.assertEqual(C("A", "SPADE").rank_value, 1)
        self.assertEqual(C("K", "SPADE").rank_value, 13)
        self.assertEqual(C("7", "HEART").color, "RED")
        self.assertEqual(C("7", "CLUB").color, "BLACK")

    def test_dict_roundtrip(self):
        d = {"suit": "DIAMOND", "number": "10", "id": 42}
        self.assertEqual(Card.from_dict(d).to_dict(), d)

    def test_same_face_ignores_id(self):
        self.assertTrue(C("5", "CLUB", id=1).same_face(C("5", "CLUB", id=2)))
        self.assertFalse(C("5", "CLUB", id=1).same_face(C("6", "CLUB", id=2)))

    def test_rejects_bad_values(self):
        with self.assertRaises(ValueError):
            Card(suit="STAR", rank="A")
        with self.assertRaises(ValueError):
            Card(suit="SPADE", rank="1")


class PureSequenceTests(unittest.TestCase):
    def test_basic_run(self):
        self.assertTrue(is_pure_sequence([C("4", "SPADE"), C("5", "SPADE"), C("6", "SPADE")]))

    def test_ace_low(self):
        self.assertTrue(is_pure_sequence([C("A", "HEART"), C("2", "HEART"), C("3", "HEART")]))

    def test_ace_high(self):
        self.assertTrue(is_pure_sequence([C("Q", "CLUB"), C("K", "CLUB"), C("A", "CLUB")]))

    def test_no_wraparound(self):
        # K-A-2 is not a legal run.
        self.assertFalse(is_pure_sequence([C("K", "CLUB"), C("A", "CLUB"), C("2", "CLUB")]))

    def test_mixed_suit_fails(self):
        self.assertFalse(is_pure_sequence([C("4", "SPADE"), C("5", "HEART"), C("6", "SPADE")]))

    def test_non_consecutive_fails(self):
        self.assertFalse(is_pure_sequence([C("4", "SPADE"), C("6", "SPADE"), C("7", "SPADE")]))

    def test_duplicate_rank_fails(self):
        self.assertFalse(is_pure_sequence([C("4", "SPADE"), C("4", "SPADE"), C("5", "SPADE")]))

    def test_too_short_fails(self):
        self.assertFalse(is_pure_sequence([C("4", "SPADE"), C("5", "SPADE")]))

    def test_five_card_run(self):
        self.assertTrue(is_pure_sequence(
            [C("4", "SPADE"), C("5", "SPADE"), C("6", "SPADE"), C("7", "SPADE"), C("8", "SPADE")]))


class DirtySequenceTests(unittest.TestCase):
    def test_joker_fills_interior_gap(self):
        joker = C("J", "DIAMOND", id=900)
        cards = [C("4", "SPADE"), joker, C("6", "SPADE")]
        self.assertTrue(is_sequence(cards, jokers={900}))
        self.assertFalse(is_pure_sequence(cards))  # not pure: a joker is used

    def test_joker_extends_end(self):
        joker = C("2", "HEART", id=901)
        cards = [C("9", "SPADE"), C("10", "SPADE"), joker]
        self.assertTrue(is_sequence(cards, jokers={901}))

    def test_two_jokers_one_gap_too_far(self):
        j1, j2 = C("2", "HEART", id=1), C("3", "HEART", id=2)
        # 4 _ _ 8 needs to span 4..8 (5 slots) with only 3 naturals+... here 2 naturals + 2 jokers = 4 cards
        cards = [C("4", "SPADE"), C("8", "SPADE"), j1, j2]
        self.assertFalse(is_sequence(cards, jokers={1, 2}))

    def test_jokers_bridge_exact_gap(self):
        j1, j2 = C("2", "HEART", id=1), C("3", "HEART", id=2)
        cards = [C("4", "SPADE"), C("7", "SPADE"), j1, j2]  # 4 5 6 7 -> jokers as 5,6
        self.assertTrue(is_sequence(cards, jokers={1, 2}))


class TunnelaDubleeTests(unittest.TestCase):
    def test_tunnela_ok(self):
        self.assertTrue(is_tunnela([C("7", "HEART"), C("7", "HEART"), C("7", "HEART")]))

    def test_tunnela_needs_same_suit(self):
        self.assertFalse(is_tunnela([C("7", "HEART"), C("7", "DIAMOND"), C("7", "HEART")]))

    def test_tunnela_wrong_size(self):
        self.assertFalse(is_tunnela([C("7", "HEART"), C("7", "HEART")]))

    def test_dublee_ok(self):
        self.assertTrue(is_dublee([C("9", "CLUB"), C("9", "CLUB")]))

    def test_dublee_needs_match(self):
        self.assertFalse(is_dublee([C("9", "CLUB"), C("9", "SPADE")]))

    def test_valid_meld_accepts_seq_and_tunnela(self):
        self.assertTrue(is_valid_meld([C("4", "SPADE"), C("5", "SPADE"), C("6", "SPADE")]))
        self.assertTrue(is_valid_meld([C("7", "HEART"), C("7", "HEART"), C("7", "HEART")]))
        self.assertFalse(is_valid_meld([C("9", "CLUB"), C("9", "CLUB")]))  # dublee isn't a showable meld


class PartitionAndWinTests(unittest.TestCase):
    def test_partition_two_melds(self):
        cards = [
            C("4", "SPADE"), C("5", "SPADE"), C("6", "SPADE"),
            C("J", "HEART"), C("J", "HEART"), C("J", "HEART"),
        ]
        partition = find_meld_partition(cards)
        self.assertIsNotNone(partition)
        self.assertEqual(len(partition), 2)

    def test_partition_impossible(self):
        cards = [
            C("4", "SPADE"), C("5", "SPADE"), C("9", "CLUB"),
            C("J", "HEART"), C("2", "DIAMOND"), C("K", "SPADE"),
        ]
        self.assertIsNone(find_meld_partition(cards))

    def test_not_divisible_by_meld_size(self):
        self.assertIsNone(find_meld_partition([C("4", "SPADE"), C("5", "SPADE")]))

    def test_winning_hand_requires_pure(self):
        # Two melds, both pure sequences -> win with min_pure up to 2.
        cards = [
            C("4", "SPADE"), C("5", "SPADE"), C("6", "SPADE"),
            C("9", "HEART"), C("10", "HEART"), C("J", "HEART"),
        ]
        self.assertTrue(is_winning_hand(cards, min_pure=2))
        self.assertFalse(is_winning_hand(cards, min_pure=3))

    def test_winning_hand_with_joker_meld_not_pure(self):
        joker = C("2", "DIAMOND", id=500)
        cards = [
            C("4", "SPADE"), joker, C("6", "SPADE"),       # dirty sequence
            C("9", "HEART"), C("10", "HEART"), C("J", "HEART"),  # pure sequence
        ]
        self.assertTrue(is_winning_hand(cards, jokers={500}, min_pure=1))
        self.assertFalse(is_winning_hand(cards, jokers={500}, min_pure=2))


class ScoringTests(unittest.TestCase):
    def test_hand_points(self):
        self.assertEqual(hand_points([C("K", "SPADE"), C("3", "HEART")]), 13)

    def test_unmelded_zero_when_all_meld(self):
        cards = [C("4", "SPADE"), C("5", "SPADE"), C("6", "SPADE")]
        self.assertEqual(unmelded_points(cards), 0)

    def test_unmelded_scores_leftovers(self):
        cards = [C("K", "SPADE"), C("2", "HEART"), C("9", "CLUB")]  # no meld
        self.assertEqual(unmelded_points(cards), 10 + 2 + 9)


if __name__ == "__main__":
    unittest.main()
