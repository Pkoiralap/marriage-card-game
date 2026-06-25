# Marriage Card Game - Project Notes

## Current State
- **Core Mechanics**: Dealing, picking (deck/ground), discarding, and hand reordering are fully functional and synchronized with the backend.
- **Show Sequence**: Players can enter "Show Sequence" mode, select 3-5 cards, and validate them.
- **Maal Selection**: Once 3 sequences are shown, the qualified player selects the Maal card from a face-down slider representing the remaining deck.
- **Sequence Display**: Verified sequences move from the 3D hand to a side panel.
- **Phases**: Transition from `PLAYING` to `MAAL_REVEALED` is implemented.
- **Claim Game**: Basic claim functionality exists when a player has 1 card left after showing sequences.
- **First Round Exceptions**: Buttons for showing Tunnela and Dublee appear during the very first turn.

## Remaining / TODO (Validation Logic)
The following require real game logic implementation in `game/logic.py` or `game/consumers.py`:

1.  **Sequence Validation**:
    *   [ ] Implement pure sequence check (same suit, consecutive numbers).
    *   [ ] Implement dirty sequence check (using jokers/alternates).
2.  **Tunnela Validation**:
    *   [ ] Verify 3 identical cards (same number, same suit).
3.  **Dublee Validation**:
    *   [ ] Verify 7 or 8 pairs (same number, same suit).
4.  **Claim Game Validation**:
    *   [ ] Verify the remaining hand forms valid sets/sequences alongside the shown ones.
    *   [ ] Implement points calculation based on remaining cards in other players' hands.
5.  **AI Improvements**:
    *   [ ] Teach AI how to "Show Sequence" when it has valid sets.
    *   [ ] Teach AI how to pick the Maal card.
    *   [ ] Implement smarter AI discarding/picking logic based on Marriage rules.

## UI / UX Improvements
- [ ] **Auto-Sort**: Add a button to automatically sort cards by suit and number.
- [ ] **Manual Sequence Reordering**: Allow dragging cards between verified sequence boxes.
- [ ] **Better Feedback**: Show specific error messages (e.g., "This is not a consecutive sequence").
- [ ] **Joker/Maal Highlighting**: Visually mark Maal cards and jokers in the hand once revealed.

## Known Bugs Fixed
- [x] Hand reordering now persists across server refreshes (Bug 1).
- [x] Validated sequences now stay in hand highlighted/bumped until all 3 are done (Bug 2).
- [x] Maal selection modal now uses a proper face-down slider representing deck depth (Bug 3).
- [x] Game phase now transitions to `MAAL_REVEALED` allowing "Claim Game" mode (Bug 4).
- [x] "Show Sequence" availability now strictly follows turn rules and first-round exceptions (Bug 5).
- [x] Fixed rendering crash when `shownSequences` was undefined.
- [x] Fixed button overlap with player hand.
- [x] Added Tunnela and Dublee show support for the first round.
