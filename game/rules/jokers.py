# S2: Maal (tiplu) joker derivation — the single source of truth.
"""Derive the wild-card (joker) faces from the table's maal card.

Pure and framework-free (no Django, no DB) like the rest of ``game.rules`` so
it can be unit-tested with zero setup. Both the show-validator
(``consumers.register_sequence``) and the AI (``logic.jokers_from_maal``) call
into here, so humans and AI always agree on which cards are wild.

Variant assumptions (standard Marriage, "maal + relatives" house rule):
The maal card chosen from the deck is the **tiplu**. Wild faces are:

  * **tiplu**       — the maal face itself (same suit, same rank).
  * **poplu**       — tiplu rank + 1, same suit (rank wraps K -> A).
  * **jhiplu**      — tiplu rank - 1, same suit (rank wraps A -> K).
  * **alternate
    tiplu**         — same rank, the *other* suit of the same colour
                      (e.g. tiplu = 7♥ -> alternate = 7♦; 7♠ -> 7♣).

That is, four distinct faces are wild (tiplu, poplu, jhiplu, alt-tiplu). There
are no separate "pure joker" cards in this deck, so none are added here; the
hook is left in :func:`maal_joker_faces` for variants that use printed jokers.

A *face* is a ``(suit, rank)`` tuple. The rules engine identifies jokers by
**card id**, so :func:`maal_joker_ids` maps a hand's card dicts to the id set
the engine expects.
"""

from __future__ import annotations

from .cards import RANKS, RED_SUITS, SUITS, Card

# Same-colour suit partner: HEART<->DIAMOND (red), SPADE<->CLUB (black).
_RED = tuple(s for s in SUITS if s in RED_SUITS)        # ("HEART", "DIAMOND")
_BLACK = tuple(s for s in SUITS if s not in RED_SUITS)  # ("SPADE", "CLUB")


def _alternate_suit(suit: str) -> str:
    """The other suit of the same colour."""
    pair = _RED if suit in RED_SUITS else _BLACK
    return pair[1] if pair[0] == suit else pair[0]


def _shifted_rank(rank: str, delta: int) -> str:
    """Rank shifted by ``delta`` steps, wrapping around the 13-rank cycle
    (so K + 1 -> A and A - 1 -> K)."""
    return RANKS[(RANKS.index(rank) + delta) % len(RANKS)]


def _coerce_face(maal_card) -> tuple[str, str] | None:
    """Pull a ``(suit, rank)`` face out of a maal card in any accepted form:
    a ``Card``, a wire/DB dict (``{'suit', 'number', ...}``), or None."""
    if not maal_card:
        return None
    if isinstance(maal_card, Card):
        return (maal_card.suit, maal_card.rank)
    suit = maal_card.get("suit")
    # DB/wire dicts call the rank "number"; tolerate "rank" too.
    rank = maal_card.get("number", maal_card.get("rank"))
    if suit is None or rank is None:
        return None
    return (suit, rank)


def maal_joker_faces(maal_card) -> set[tuple[str, str]]:
    """The set of ``(suit, rank)`` faces that are wild given ``maal_card``.

    ``maal_card`` may be a :class:`Card`, a card dict, or falsy. Returns an
    empty set when no maal has been revealed yet (pure-only play).
    """
    face = _coerce_face(maal_card)
    if face is None:
        return set()
    suit, rank = face
    if suit not in SUITS or rank not in RANKS:
        return set()

    faces = {
        (suit, rank),                                # tiplu
        (suit, _shifted_rank(rank, +1)),             # poplu
        (suit, _shifted_rank(rank, -1)),             # jhiplu
        (_alternate_suit(suit), rank),               # alternate tiplu
    }
    # No printed jokers in this deck; variants would add their faces here.
    return faces


def maal_joker_ids(hand, maal_card) -> set[int]:
    """Card ids in ``hand`` whose face is wild given ``maal_card``.

    ``hand`` is an iterable of card dicts (DB/wire format) or :class:`Card`s.
    Returns an empty set when the maal is unrevealed. This is what the meld
    validators expect as their ``jokers`` argument.
    """
    faces = maal_joker_faces(maal_card)
    if not faces:
        return set()
    ids: set[int] = set()
    for c in hand:
        if isinstance(c, Card):
            suit, rank, cid = c.suit, c.rank, c.id
        else:
            suit = c.get("suit")
            rank = c.get("number", c.get("rank"))
            cid = c.get("id")
        if cid is not None and (suit, rank) in faces:
            ids.add(cid)
    return ids
