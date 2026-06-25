"""Pure meld validators for Marriage.

Every function here takes cards in and returns a verdict out — no Django, no
DB, no I/O. ``jokers`` is always supplied by the caller as a set of card ids
(the maal/tiplu and its relatives are decided at the table, not by this engine),
so the rules stay independent of any particular joker variant.

Melds recognised:
  * sequence  — 3+ cards, same suit, consecutive ranks (pure or joker-filled)
  * tunnela   — exactly 3 identical cards (same suit AND rank)
  * dublee    — exactly 2 identical cards (same suit AND rank)
"""

from __future__ import annotations

from .cards import ACE_HIGH, Card, to_cards

MIN_SEQUENCE = 3
TUNNELA_SIZE = 3
DUBLEE_SIZE = 2


# --- low-level run detection ------------------------------------------------
def _fits_run(values: list[int], joker_count: int) -> bool:
    """Can ``values`` (distinct rank numbers) plus ``joker_count`` wild cards
    form one block of consecutive ranks?

    The natural cards must be distinct and span no wider than the total card
    count; jokers fill interior gaps and may extend either end.
    """
    if len(set(values)) != len(values):
        return False  # a run can't contain two of the same rank
    total = len(values) + joker_count
    if total > ACE_HIGH:
        return False
    if not values:
        return joker_count > 0
    span = max(values) - min(values) + 1
    holes = span - len(values)  # interior positions the jokers must cover
    return holes <= joker_count


def _split_jokers(cards: list[Card], jokers: set[int]) -> tuple[list[Card], int]:
    naturals = [c for c in cards if c.id not in jokers]
    joker_count = len(cards) - len(naturals)
    return naturals, joker_count


# --- public validators ------------------------------------------------------
def is_sequence(cards, jokers: set[int] | None = None) -> bool:
    """3+ same-suit cards forming a consecutive run, jokers allowed to fill."""
    cards = to_cards(cards)
    if len(cards) < MIN_SEQUENCE:
        return False
    jokers = jokers or set()
    naturals, joker_count = _split_jokers(cards, jokers)

    # All natural (non-joker) cards must share one suit.
    if naturals and len({c.suit for c in naturals}) != 1:
        return False

    low = [c.rank_value for c in naturals]
    # Try ace-low and ace-high placements; either passing is enough.
    candidates = [low]
    if any(c.rank == "A" for c in naturals):
        candidates.append([ACE_HIGH if v == 1 else v for v in low])
    return any(_fits_run(vals, joker_count) for vals in candidates)


def is_pure_sequence(cards) -> bool:
    """A sequence using no jokers at all (no wild substitutions)."""
    cards = to_cards(cards)
    if len(cards) < MIN_SEQUENCE:
        return False
    return is_sequence(cards, jokers=set())


def is_tunnela(cards) -> bool:
    """Exactly three identical cards (same suit and rank)."""
    cards = to_cards(cards)
    if len(cards) != TUNNELA_SIZE:
        return False
    first = cards[0]
    return all(c.same_face(first) for c in cards[1:])


def is_dublee(cards) -> bool:
    """Exactly two identical cards (same suit and rank)."""
    cards = to_cards(cards)
    if len(cards) != DUBLEE_SIZE:
        return False
    return cards[0].same_face(cards[1])


def is_valid_meld(cards, jokers: set[int] | None = None) -> bool:
    """A group that may legally be 'shown': a sequence or a tunnela."""
    cards = to_cards(cards)
    return is_tunnela(cards) or is_sequence(cards, jokers)


# --- whole-hand partitioning (claim / win detection) ------------------------
def find_meld_partition(cards, jokers: set[int] | None = None, meld_size: int = 3):
    """Partition all ``cards`` into melds of ``meld_size`` (default 3).

    Returns the list of meld groups, or ``None`` if no full partition exists.
    Uses lowest-card-first backtracking with memoisation on the remaining set.
    """
    cards = to_cards(cards)
    jokers = jokers or set()
    if len(cards) % meld_size != 0:
        return None

    # Index cards so each physical copy is addressable even with duplicates.
    indexed = list(enumerate(cards))
    failed: set[frozenset[int]] = set()

    def backtrack(remaining: list[tuple[int, Card]]):
        if not remaining:
            return []
        key = frozenset(i for i, _ in remaining)
        if key in failed:
            return None

        anchor = remaining[0]
        rest = remaining[1:]
        # Every meld must include the lowest-index remaining card (the anchor),
        # which makes the search exhaustive without revisiting orderings.
        from itertools import combinations

        for combo in combinations(rest, meld_size - 1):
            group = [anchor, *combo]
            group_cards = [c for _, c in group]
            if not is_valid_meld(group_cards, jokers):
                continue
            chosen_ids = {i for i, _ in group}
            sub = [item for item in remaining if item[0] not in chosen_ids]
            tail = backtrack(sub)
            if tail is not None:
                return [group_cards, *tail]

        failed.add(key)
        return None

    return backtrack(indexed)


def is_winning_hand(cards, jokers: set[int] | None = None, min_pure: int = 1,
                    meld_size: int = 3) -> bool:
    """True if every card can be grouped into valid melds with at least
    ``min_pure`` pure sequences among them."""
    partition = find_meld_partition(cards, jokers, meld_size)
    if partition is None:
        return False
    pure = sum(1 for group in partition if is_pure_sequence(group))
    return pure >= min_pure
