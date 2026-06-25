"""Card value object and the single source of truth for card constants.

This module is intentionally framework-free (no Django imports) so the rules
engine can be unit-tested with zero database or app setup.

A card on the wire / in the DB is a plain dict: ``{'suit', 'number', 'id'}``
(see ``game.models``). ``Card.from_dict`` / ``Card.to_dict`` bridge that format
so the engine can be adopted without a migration.
"""

from __future__ import annotations

from dataclasses import dataclass

# --- The one place suits / ranks / colors are defined -----------------------
SUITS = ("SPADE", "HEART", "CLUB", "DIAMOND")
RANKS = ("A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K")
RED_SUITS = frozenset({"HEART", "DIAMOND"})
SUIT_SYMBOLS = {"SPADE": "♠", "HEART": "♥", "CLUB": "♣", "DIAMOND": "♦"}

# A is low (1) by default; sequence logic also tries A high (14) where it helps.
ACE_HIGH = len(RANKS) + 1  # 14


@dataclass(frozen=True)
class Card:
    """An immutable playing card.

    Equality/hash include ``id`` so two physical copies of the same face (the
    game uses three decks) are distinct objects. Use :meth:`same_face` when you
    mean "same suit and rank regardless of which physical copy".
    """

    suit: str
    rank: str
    id: int | None = None

    def __post_init__(self) -> None:
        if self.suit not in SUITS:
            raise ValueError(f"Unknown suit: {self.suit!r}")
        if self.rank not in RANKS:
            raise ValueError(f"Unknown rank: {self.rank!r}")

    # --- derived properties -------------------------------------------------
    @property
    def color(self) -> str:
        return "RED" if self.suit in RED_SUITS else "BLACK"

    @property
    def rank_value(self) -> int:
        """1 (A) .. 13 (K). See :data:`ACE_HIGH` for the high-ace alias."""
        return RANKS.index(self.rank) + 1

    @property
    def symbol(self) -> str:
        return SUIT_SYMBOLS[self.suit]

    def same_face(self, other: "Card") -> bool:
        """True when suit and rank match, ignoring physical copy ``id``."""
        return self.suit == other.suit and self.rank == other.rank

    # --- DB / wire bridge ---------------------------------------------------
    @classmethod
    def from_dict(cls, data: dict) -> "Card":
        return cls(suit=data["suit"], rank=data["number"], id=data.get("id"))

    def to_dict(self) -> dict:
        return {"suit": self.suit, "number": self.rank, "id": self.id}

    def __str__(self) -> str:
        return f"{self.rank}{self.symbol}"


def to_cards(items) -> list[Card]:
    """Coerce a mix of dicts / Cards into a list of :class:`Card`."""
    return [c if isinstance(c, Card) else Card.from_dict(c) for c in items]
