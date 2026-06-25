"""Scoring helpers — kept separate so point variants can evolve in one place.

Marriage scoring is variant-heavy. This provides a sensible, fully-configurable
default: face cards and aces are worth more, the rest score their pip value.
Callers that use a different house rule pass their own ``point_values``.
"""

from __future__ import annotations

from .cards import RANKS, Card, to_cards
from .melds import find_meld_partition

# Default per-rank penalty for a card left unmelded in a player's hand.
DEFAULT_POINT_VALUES = {
    "A": 10, "K": 10, "Q": 10, "J": 10, "10": 10,
    "9": 9, "8": 8, "7": 7, "6": 6, "5": 5, "4": 4, "3": 3, "2": 2,
}
assert set(DEFAULT_POINT_VALUES) == set(RANKS), "point table must cover every rank"


def card_points(card: Card, point_values: dict | None = None) -> int:
    values = point_values or DEFAULT_POINT_VALUES
    return values[card.rank]


def hand_points(cards, point_values: dict | None = None) -> int:
    """Total penalty points for a collection of cards."""
    return sum(card_points(c, point_values) for c in to_cards(cards))


def unmelded_points(cards, jokers: set[int] | None = None,
                    point_values: dict | None = None, meld_size: int = 3) -> int:
    """Penalty for the cards that cannot be arranged into any meld.

    Greedily extracts a meld partition from as many cards as possible, then
    scores whatever is left over. If the whole hand melds, the penalty is 0.
    """
    cards = to_cards(cards)
    partition = find_meld_partition(cards, jokers, meld_size)
    if partition is not None:
        return 0
    return hand_points(cards, point_values)
