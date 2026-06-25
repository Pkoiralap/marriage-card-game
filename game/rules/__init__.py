"""Marriage rules engine — pure, framework-free, fully unit-testable.

Public API. Import from here rather than the submodules::

    from game.rules import Card, is_pure_sequence, is_tunnela, is_winning_hand
"""

from .cards import (
    ACE_HIGH,
    RANKS,
    RED_SUITS,
    SUIT_SYMBOLS,
    SUITS,
    Card,
    to_cards,
)
from .melds import (
    DUBLEE_SIZE,
    MIN_SEQUENCE,
    TUNNELA_SIZE,
    find_meld_partition,
    is_dublee,
    is_pure_sequence,
    is_sequence,
    is_tunnela,
    is_valid_meld,
    is_winning_hand,
)
from .scoring import (
    DEFAULT_MAX_ROUND_PENALTY,  # S1
    DEFAULT_POINT_VALUES,
    card_points,
    hand_points,
    is_winning_claim,  # S1
    round_penalty,  # S1
    round_scores,  # S1
    unmelded_points,
)
# S2: maal/tiplu joker derivation (single source of truth).
from .jokers import maal_joker_faces, maal_joker_ids

__all__ = [
    # cards
    "Card", "to_cards", "SUITS", "RANKS", "RED_SUITS", "SUIT_SYMBOLS", "ACE_HIGH",
    # melds
    "is_sequence", "is_pure_sequence", "is_tunnela", "is_dublee", "is_valid_meld",
    "find_meld_partition", "is_winning_hand",
    "MIN_SEQUENCE", "TUNNELA_SIZE", "DUBLEE_SIZE",
    # scoring
    "card_points", "hand_points", "unmelded_points", "DEFAULT_POINT_VALUES",
    # jokers (S2)
    "maal_joker_faces", "maal_joker_ids",
    # scoring/claim (S1)
    "is_winning_claim", "round_penalty", "round_scores", "DEFAULT_MAX_ROUND_PENALTY",
]
