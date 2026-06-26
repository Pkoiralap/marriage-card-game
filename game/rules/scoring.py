"""Scoring helpers — kept separate so point variants can evolve in one place.

Marriage scoring is variant-heavy. This provides a sensible, fully-configurable
default: face cards and aces are worth more, the rest score their pip value.
Callers that use a different house rule pass their own ``point_values``.
"""

from __future__ import annotations

from .cards import RANKS, Card, to_cards
from .melds import find_meld_partition, is_winning_hand

# S1: cap a single round's penalty so one bad hand can't run away with the score.
DEFAULT_MAX_ROUND_PENALTY = 100

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


# S1: --- claim validation + round scoring (pure, framework-free) -----------
def is_winning_claim(shown_groups, hand, jokers: set[int] | None = None,
                     min_pure: int = 1, meld_size: int = 3, validator=None) -> bool:
    """True if a player's *whole* holding forms a winning hand.

    A Marriage hand is split between melds already laid down on the table
    (``shown_groups`` — a list of card groups) and the cards still concealed in
    ``hand``. The win is judged over the union of both: every card must fall
    into a valid meld with at least ``min_pure`` pure sequence(s) overall.

    ``shown_groups`` may be an empty list (nothing shown yet) — then this is just
    ``is_winning_hand`` over the concealed hand.
    """
    flat = []
    for group in (shown_groups or []):
        flat.extend(group)
    flat.extend(hand or [])
    return is_winning_hand(flat, jokers, min_pure=min_pure, meld_size=meld_size,
                           validator=validator)


def can_claim(shown_groups, hand, jokers: set[int] | None = None,
              min_pure: int = 1, meld_size: int = 3, validator=None) -> bool:
    """True if the player can claim by setting aside exactly ONE card.

    Marriage wins by melding everything and discarding the final card, so a
    claim is valid when there exists one card to drop from ``hand`` such that
    the rest of the holding (shown melds + remaining hand) forms a winning
    hand. Dirty (joker-filled) sequences count — ``jokers`` is the maal-derived
    joker-id set. ``min_pure`` pure sequence(s) are still required overall.
    """
    flat_shown = [c for group in (shown_groups or []) for c in group]
    hand = list(hand or [])
    if not hand:
        return False
    for i in range(len(hand)):
        rest = flat_shown + hand[:i] + hand[i + 1:]
        if is_winning_hand(rest, jokers, min_pure=min_pure, meld_size=meld_size,
                           validator=validator):
            return True
    return False


def round_penalty(shown_groups, hand, jokers: set[int] | None = None,
                  point_values: dict | None = None, meld_size: int = 3,
                  max_penalty: int | None = DEFAULT_MAX_ROUND_PENALTY) -> int:
    """Penalty points a *loser* carries for one round.

    Cards already shown as melds cost nothing; only the concealed ``hand`` is
    penalised, and any portion of it that still melds is free (via
    ``unmelded_points``). The result is capped at ``max_penalty`` (None = no cap)
    so a single disastrous hand can't dominate a multi-round match.
    """
    pts = unmelded_points(hand or [], jokers, point_values, meld_size)
    if max_penalty is not None:
        pts = min(pts, max_penalty)
    return pts


def round_scores(players, jokers_for=None, point_values: dict | None = None,
                 meld_size: int = 3,
                 max_penalty: int | None = DEFAULT_MAX_ROUND_PENALTY):
    """Per-player points for one finished round.

    ``players`` is a list of dicts: ``{'name', 'is_winner', 'shown', 'hand'}``
    where ``shown`` is the list of shown meld groups and ``hand`` the concealed
    cards. ``jokers_for(name) -> set[int]`` supplies each player's joker ids
    (defaults to no jokers). The winner scores 0; every loser scores their
    ``round_penalty``. Returns a list of ``{'name', 'is_winner', 'points'}`` in
    input order. Pure: depends only on its inputs.
    """
    jokers_for = jokers_for or (lambda name: set())
    out = []
    for p in players:
        if p.get('is_winner'):
            pts = 0
        else:
            pts = round_penalty(
                p.get('shown'), p.get('hand'), jokers_for(p.get('name')),
                point_values, meld_size, max_penalty)
        out.append({'name': p.get('name'), 'is_winner': bool(p.get('is_winner')), 'points': pts})
    return out
