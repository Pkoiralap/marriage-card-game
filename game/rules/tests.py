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


# S2: maal/tiplu joker derivation -------------------------------------------
from game.rules import maal_joker_faces, maal_joker_ids


class MaalJokerFaceTests(unittest.TestCase):
    def test_tiplu_poplu_jhiplu_alternate(self):
        # maal = 7 of HEART -> tiplu 7H, poplu 8H, jhiplu 6H, alt 7D (red pair).
        faces = maal_joker_faces({"suit": "HEART", "number": "7"})
        self.assertEqual(
            faces,
            {("HEART", "7"), ("HEART", "8"), ("HEART", "6"), ("DIAMOND", "7")},
        )

    def test_alternate_is_same_colour_other_suit(self):
        # SPADE (black) -> CLUB; DIAMOND (red) -> HEART.
        self.assertIn(("CLUB", "5"), maal_joker_faces({"suit": "SPADE", "number": "5"}))
        self.assertIn(("HEART", "5"), maal_joker_faces({"suit": "DIAMOND", "number": "5"}))

    def test_rank_wraps_at_king_and_ace(self):
        # tiplu = K -> poplu wraps to A; jhiplu = Q.
        k = maal_joker_faces({"suit": "CLUB", "number": "K"})
        self.assertIn(("CLUB", "A"), k)   # poplu
        self.assertIn(("CLUB", "Q"), k)   # jhiplu
        # tiplu = A -> jhiplu wraps to K; poplu = 2.
        a = maal_joker_faces({"suit": "CLUB", "number": "A"})
        self.assertIn(("CLUB", "K"), a)   # jhiplu
        self.assertIn(("CLUB", "2"), a)   # poplu

    def test_accepts_card_object(self):
        faces = maal_joker_faces(Card(suit="SPADE", rank="9"))
        self.assertEqual(
            faces,
            {("SPADE", "9"), ("SPADE", "10"), ("SPADE", "8"), ("CLUB", "9")},
        )

    def test_empty_before_maal(self):
        self.assertEqual(maal_joker_faces(None), set())
        self.assertEqual(maal_joker_faces({}), set())


class MaalJokerIdTests(unittest.TestCase):
    def test_maps_hand_ids_to_jokers(self):
        maal = {"suit": "HEART", "number": "7"}
        hand = [
            {"suit": "HEART", "number": "7", "id": 1},    # tiplu
            {"suit": "HEART", "number": "8", "id": 2},    # poplu
            {"suit": "HEART", "number": "6", "id": 3},    # jhiplu
            {"suit": "DIAMOND", "number": "7", "id": 4},  # alternate tiplu
            {"suit": "SPADE", "number": "7", "id": 5},    # not wild (wrong colour)
            {"suit": "HEART", "number": "9", "id": 6},    # not wild
        ]
        self.assertEqual(maal_joker_ids(hand, maal), {1, 2, 3, 4})

    def test_empty_before_maal(self):
        hand = [{"suit": "HEART", "number": "7", "id": 1}]
        self.assertEqual(maal_joker_ids(hand, None), set())

    def test_ignores_cards_without_id(self):
        maal = {"suit": "CLUB", "number": "3"}
        hand = [{"suit": "CLUB", "number": "3"}]  # no id
        self.assertEqual(maal_joker_ids(hand, maal), set())

    def test_duplicate_faces_across_decks_all_map(self):
        # S2: three physical decks -> the same wild face can appear multiple
        # times; every copy's id must be flagged, not just the first.
        maal = {"suit": "HEART", "number": "7"}
        hand = [
            {"suit": "HEART", "number": "7", "id": 1},    # tiplu copy A
            {"suit": "HEART", "number": "7", "id": 2},    # tiplu copy B
            {"suit": "DIAMOND", "number": "7", "id": 3},  # alt-tiplu copy A
            {"suit": "DIAMOND", "number": "7", "id": 4},  # alt-tiplu copy B
        ]
        self.assertEqual(maal_joker_ids(hand, maal), {1, 2, 3, 4})

    def test_mixed_dict_and_card_hand(self):
        # S2: callers may pass a hand mixing wire dicts and Card objects
        # (e.g. AI probes append a Card to a dict hand). Both must resolve.
        maal = {"suit": "HEART", "number": "7"}
        hand = [
            {"suit": "HEART", "number": "8", "id": 10},   # poplu (dict)
            Card(suit="HEART", rank="6", id=11),          # jhiplu (Card)
            Card(suit="SPADE", rank="7", id=12),          # not wild (wrong colour)
        ]
        self.assertEqual(maal_joker_ids(hand, maal), {10, 11})


class DirtySequenceWithMaalTests(unittest.TestCase):
    def test_pure_only_before_maal(self):
        # 5H, 7H + a wild stand-in, but no maal yet -> jokers empty -> rejected.
        cards = [C("5", "HEART", 1), C("7", "HEART", 2), C("9", "SPADE", 3)]
        jokers = maal_joker_ids(
            [c.to_dict() for c in cards], None
        )
        self.assertEqual(jokers, set())
        self.assertFalse(is_sequence(cards, jokers))

    def test_dirty_sequence_accepted_with_maal(self):
        # maal = 9 of SPADE. The 9S in hand is the tiplu (wild). It fills the
        # gap in 5H-_-7H to make 5H-6H-7H.
        maal = {"suit": "SPADE", "number": "9"}
        cards = [C("5", "HEART", 1), C("7", "HEART", 2), C("9", "SPADE", 3)]
        jokers = maal_joker_ids([c.to_dict() for c in cards], maal)
        self.assertEqual(jokers, {3})
        self.assertTrue(is_sequence(cards, jokers))

    def test_winning_hand_uses_same_jokers(self):
        maal = {"suit": "SPADE", "number": "9"}
        # 21 cards: one dirty sequence + two pure sequences.
        dirty = [C("5", "HEART", 10), C("7", "HEART", 11), C("9", "SPADE", 12)]
        pure1 = [C("4", "CLUB", 20), C("5", "CLUB", 21), C("6", "CLUB", 22)]
        pure2 = [C("J", "DIAMOND", 30), C("Q", "DIAMOND", 31), C("K", "DIAMOND", 32)]
        pure3 = [C("2", "SPADE", 40), C("3", "SPADE", 41), C("4", "SPADE", 42)]
        # NB: 9C would be the alternate tiplu of 9S (wild), so use a clean run.
        pure4 = [C("4", "DIAMOND", 50), C("5", "DIAMOND", 51), C("6", "DIAMOND", 52)]
        pure5 = [C("10", "HEART", 60), C("J", "HEART", 61), C("Q", "HEART", 62)]
        pure6 = [C("A", "DIAMOND", 70), C("2", "DIAMOND", 71), C("3", "DIAMOND", 72)]
        hand = dirty + pure1 + pure2 + pure3 + pure4 + pure5 + pure6
        jokers = maal_joker_ids([c.to_dict() for c in hand], maal)
        self.assertEqual(jokers, {12})
        self.assertTrue(is_winning_hand(hand, jokers, min_pure=1))


from game.rules import is_dirty_sequence, claim_joker_ids


class ClaimDirtySequenceTests(unittest.TestCase):
    """The claim-only dirty meld validator (sets / runs / tunnelas + wilds).

    Mirrors the house rule the user specified: same-rank-different-suit SETS
    are valid (unlike the initial reveal), and every same-rank card is wild.
    """

    def test_set_same_rank_distinct_suits(self):
        # 4C 4H 4S — all different suits, same value -> valid.
        self.assertTrue(is_dirty_sequence(
            [C("4", "CLUB", 1), C("4", "HEART", 2), C("4", "SPADE", 3)]))

    def test_set_rejects_duplicate_suit(self):
        # 4C 4H 4H — duplicate suit, no wilds -> NOT valid.
        self.assertFalse(is_dirty_sequence(
            [C("4", "CLUB", 1), C("4", "HEART", 2), C("4", "HEART", 3)], set()))

    def test_normal_run_valid(self):
        self.assertTrue(is_dirty_sequence(
            [C("3", "CLUB", 1), C("4", "CLUB", 2), C("5", "CLUB", 3)]))

    def test_tunnela_valid(self):
        self.assertTrue(is_dirty_sequence(
            [C("4", "CLUB", 1), C("4", "CLUB", 2), C("4", "CLUB", 3)]))

    def test_maal_and_joker_as_placeholders(self):
        # maal = 4C. Jokers = every 4 (any suit) + 3C/5C. So 7D + maal + joker
        # (two wilds + one natural) validates as a dirty group.
        maal = {"suit": "CLUB", "number": "4"}
        cards = [C("7", "DIAMOND", 20), C("4", "CLUB", 1), C("4", "HEART", 2)]
        jokers = claim_joker_ids([c.to_dict() for c in cards], maal)
        self.assertEqual(jokers, {1, 2})
        self.assertTrue(is_dirty_sequence(cards, jokers))

    def test_claim_jokers_cover_all_same_rank(self):
        maal = {"suit": "CLUB", "number": "4"}
        hand = [C("4", "CLUB", 1), C("4", "HEART", 2), C("4", "SPADE", 3),
                C("4", "DIAMOND", 4), C("3", "CLUB", 5), C("5", "CLUB", 6),
                C("9", "HEART", 7)]
        jokers = claim_joker_ids([c.to_dict() for c in hand], maal)
        self.assertEqual(jokers, {1, 2, 3, 4, 5, 6})  # all 4s + 3C + 5C, not 9H

    def test_initial_reveal_still_rejects_sets(self):
        # The same-rank set must NOT be accepted by the reveal-time validator.
        cards = [C("4", "CLUB", 1), C("4", "HEART", 2), C("4", "SPADE", 3)]
        self.assertFalse(is_valid_meld(cards))


if __name__ == "__main__":
    unittest.main()
