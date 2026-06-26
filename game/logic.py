import random
from abc import ABC, abstractmethod

# F3: the AI reasons about cards using the pure rules engine rather than chance.
from .rules import (
    Card,
    is_sequence,
    is_tunnela,
    is_dublee,
    find_meld_partition,
    is_winning_hand,
    unmelded_points,
    maal_joker_ids,  # S2
)


# F3: ---------------------------------------------------------------------
# Pure, framework-free AI decision helpers. They take plain card dicts (the
# DB/wire format) plus an optional joker-id set and return a decision. No
# Django, no I/O -> fully unit-testable. The AIPlayer below is a thin shell
# that wires these into the game models.
# -------------------------------------------------------------------------

def jokers_from_maal(hand, maal_card):
    """Card ids in ``hand`` that act as wild (jokers).

    S2: delegates to ``rules.maal_joker_ids`` so the AI, the show-validator and
    win/claim checks all derive jokers from the *same* rule — the tiplu plus its
    relatives (poplu, jhiplu, alternate tiplu). See ``game/rules/jokers.py`` for
    the variant assumptions. Returns an empty set when no maal is revealed yet.
    """
    return maal_joker_ids(hand, maal_card)


def _hand_cards(hand):
    return [Card.from_dict(c) for c in hand]


def _meld_connections(hand, jokers=None):
    """For each card index, how many *other* cards it pairs with toward a meld.

    A higher score means the card is more entangled in potential melds (part of
    a pair, a run neighbour, or a sequence with the same suit). Cards with a
    score of 0 are 'dead' and the safest to discard. This is a cheap heuristic,
    not a full partition search.
    """
    jokers = jokers or set()
    cards = _hand_cards(hand)
    scores = [0] * len(cards)
    for i, a in enumerate(cards):
        if a.id in jokers:
            scores[i] = 99  # jokers are always worth keeping
            continue
        for j, b in enumerate(cards):
            if i == j:
                continue
            if a.same_face(b):
                scores[i] += 2  # pair / triple toward dublee / tunnela / book
            elif a.suit == b.suit and abs(a.rank_value - b.rank_value) <= 2:
                scores[i] += 1  # same-suit neighbour toward a sequence
    return scores


def choose_discard(hand, jokers=None):
    """Index of the card to discard: the one contributing least to any meld.

    Strategy: prefer to throw a card that is (a) not in a meld connection and
    (b) carries the most penalty points if left over. Ties broken by highest
    `unmelded_points` of the single card. Pure: depends only on its inputs.
    """
    if not hand:
        return None
    jokers = jokers or set()
    connections = _meld_connections(hand, jokers)

    def penalty(i):
        # Standalone penalty for keeping this exact card around.
        return unmelded_points([hand[i]], jokers)

    # Sort by (fewest connections, then most penalty points) -> first is discard.
    order = sorted(range(len(hand)), key=lambda i: (connections[i], -penalty(i)))
    return order[0]


def should_pick_choice(hand, choice_card, jokers=None):
    """True if drawing the visible ``choice_card`` improves the hand.

    Picking from the choice pile is only worth it when the card extends a
    potential meld: it forms/extends a sequence, makes a pair (dublee/tunnela),
    or is itself a joker. Otherwise the AI prefers the (hidden) deck so it does
    not telegraph its plans by grabbing a useless visible card.
    """
    if not choice_card:
        return False
    jokers = jokers or set()
    cand = Card.from_dict(choice_card)
    if choice_card.get('id') in jokers:
        return True

    cards = _hand_cards(hand)
    same_suit = sorted({c.rank_value for c in cards if c.suit == cand.suit})

    # Pair / book toward a dublee or tunnela.
    if any(c.same_face(cand) for c in cards):
        return True
    # Sequence neighbour: a same-suit card within 2 ranks can complete a run.
    if any(abs(rv - cand.rank_value) <= 2 for rv in same_suit):
        return True
    return False


def is_winning(hand, jokers=None):
    """Thin wrapper so the consumer/AI can ask 'can I claim?' without imports."""
    return is_winning_hand(hand, jokers or set())


# S3: turn-timer / AFK auto-act decision -----------------------------------
def auto_act_decision(turn_step, hand, choice_card=None, deck_count=0,
                      visibles_count=0, jokers=None):
    """Decide the single safe action to take for an AFK player on timeout.

    Pure: depends only on its inputs, so it can be unit-tested without any DB
    or async machinery. The async timer task only *applies* this decision.

    Returns one of:
      ('pick', 'deck')              -> draw the hidden deck (default in PICK)
      ('pick', 'choice')            -> take the visible card (only if deck empty
                                       but a choice card exists)
      ('discard', index)            -> discard the safest card (DISCARD step),
                                       reusing the AI ``choose_discard`` heuristic
      None                          -> nothing safe/possible to do (e.g. PICK
                                       with both piles empty, or empty hand)

    PICK: always prefer the deck so we don't reveal intent (mirrors the AI's
    deck-default); fall back to the visible choice card only if the deck is
    empty. DISCARD: throw the least-connected / highest-penalty card.
    """
    jokers = jokers or set()
    if turn_step == 'PICK':
        if deck_count > 0:
            return ('pick', 'deck')
        if visibles_count > 0 and choice_card:
            return ('pick', 'choice')
        return None  # both piles empty: nothing to pick, can't advance
    if turn_step == 'DISCARD':
        if not hand:
            return None
        idx = choose_discard(hand, jokers)
        if idx is None:
            return None
        return ('discard', idx)
    return None


def claim_discard_index(hand, jokers=None):
    """Index to discard so the *remaining* cards form a winning hand, else None.

    During its turn the AI holds one extra card (it picked before discarding),
    so the hand is one card larger than a finished 21-card hand. A win is only
    valid *after* the discard: there must be some single card whose removal
    leaves every remaining card melded (with at least one pure sequence). This
    returns that card's index (preferring to keep the lowest-penalty leftovers),
    or ``None`` when no discard yields a win. Pure: depends only on its inputs.

    Note: ``is_winning`` alone never fires on a mid-turn hand because the extra
    card makes the count indivisible by the meld size — this is the bridge.
    """
    if not hand:
        return None
    jokers = jokers or set()
    best_idx = None
    for i in range(len(hand)):
        remaining = hand[:i] + hand[i + 1:]
        if is_winning_hand(remaining, jokers):
            # Prefer discarding the highest-penalty card among winning options so
            # the (irrelevant) discarded card is the least valuable one.
            if best_idx is None or unmelded_points([hand[i]], jokers) > \
                    unmelded_points([hand[best_idx]], jokers):
                best_idx = i
    return best_idx


def find_showable_sequences(hand, jokers=None, limit=3):
    """Up to ``limit`` disjoint groups of card indices that form sequences.

    Used by the AI driver to 'show' melds. Greedily extracts sequences from a
    full meld partition (preferring pure runs first), returning each group as a
    list of indices into the original ``hand`` so the consumer can register
    them by index. Returns [] when no clean partition exists.
    """
    jokers = jokers or set()
    partition = find_meld_partition(hand, jokers)
    if not partition:
        return []

    # Map each Card object back to a hand index (by id, falling back to face).
    used = set()
    groups = []
    for group in partition:
        if not is_sequence(group, jokers):
            continue  # only sequences are showable (tunnela handled separately)
        indices = []
        for card in group:
            for i, h in enumerate(hand):
                if i in used:
                    continue
                if h.get('id') == card.id:
                    indices.append(i)
                    used.add(i)
                    break
        if len(indices) == len(group):
            groups.append(indices)
        if len(groups) >= limit:
            break
    return groups


def find_showable_tunnelas(hand, limit=1):
    """Index groups for tunnelas (3 identical cards) the AI can show round 1."""
    groups = []
    used = set()
    n = len(hand)
    for i in range(n):
        if i in used:
            continue
        matches = [i]
        for j in range(i + 1, n):
            if j in used:
                continue
            if (hand[j].get('suit') == hand[i].get('suit')
                    and hand[j].get('number') == hand[i].get('number')):
                matches.append(j)
            if len(matches) == 3:
                break
        if len(matches) == 3:
            groups.append(matches)
            used.update(matches)
        if len(groups) >= limit:
            break
    return groups


class BasePlayer(ABC):
    def __init__(self, player_model):
        self.player_model = player_model
        self.game_model = player_model.game

    def process_turn(self, **kwargs):
        """
        Main entry point for a player's turn.
        Returns (True, card, action_details) if turn step is complete, (False, None, None) otherwise.
        """
        if self.game_model.turn_step == 'PICK':
            success, card, source = self.handle_pick(**kwargs)
            if success:
                self.game_model.turn_step = 'DISCARD'
                self.sort_cards()
                self.show_sequence_or_dublee()
                self.save()
                return True, card, source

        elif self.game_model.turn_step == 'DISCARD':
            success, card = self.handle_discard(**kwargs)
            if success:
                # Turn is complete, move to next player (ANTI-CLOCKWISE)
                self.game_model.turn_step = 'PICK'
                self.game_model.turn_player_index = (self.game_model.turn_player_index - 1) % self.game_model.num_players

                if self.check_game_end():
                    self.claim_game()

                self.save()
                return True, card, None

        return False, None, None

    @abstractmethod
    def handle_pick(self, **kwargs):
        pass

    @abstractmethod
    def handle_discard(self, **kwargs):
        pass

    def sort_cards(self):
        # TODO: Implement auto-sort or manual sort logic
        pass

    def show_sequence_or_dublee(self):
        # TODO: Implement showing pure sets or dublees
        pass

    def check_game_end(self):
        # TODO: Logic to check if all sets are complete
        return False

    def claim_game(self):
        # TODO: Handle winning the game
        pass

    def save(self):
        self.player_model.save()
        self.game_model.save()

class HumanPlayer(BasePlayer):
    def handle_pick(self, source=None, target_index=None, **kwargs):
        if not source:
            return False, None, None

        card = None
        if source == 'deck' and self.game_model.deck:
            card = self.game_model.deck.pop()
        elif source == 'choice' and self.game_model.visibles:
            card = self.game_model.visibles.pop()

        if card:
            if target_index is not None and 0 <= target_index <= len(self.player_model.hand):
                self.player_model.hand.insert(target_index, card)
            else:
                self.player_model.hand.append(card)
            return True, card, source
        return False, None, None

    def handle_discard(self, card_index=None, card_id=None, **kwargs):
        hand = self.player_model.hand
        if not hand:
            return False, None

        # Prefer the card's stable id: the client's visual hand order can drift
        # from the server's stored order after reorders, so a positional index
        # may point at the wrong card. The id is unambiguous. Fall back to the
        # index for callers (AI / auto-act) that only supply a position.
        idx = None
        if card_id is not None:
            idx = next((i for i, c in enumerate(hand) if c.get('id') == card_id), None)
        if idx is None and card_index is not None and 0 <= card_index < len(hand):
            idx = card_index
        if idx is None:
            return False, None

        card = hand.pop(idx)
        self.game_model.visibles.append(card)
        return True, card

class AIPlayer(BasePlayer):
    # F3: difficulty knob. 'easy' keeps the old random behaviour, 'normal'
    # (default) uses the greedy rules-engine heuristics, 'hard' adds a light
    # one-card lookahead when choosing what to discard.
    def __init__(self, player_model, difficulty='normal'):
        super().__init__(player_model)
        self.difficulty = getattr(player_model, 'ai_difficulty', None) or difficulty

    # F3: jokers (wild card ids) derived from the table's maal face.
    def _jokers(self):
        return jokers_from_maal(self.player_model.hand, self.game_model.maal_card)

    def handle_pick(self, **kwargs):
        source = kwargs.get('source')
        if not source:
            if self.difficulty == 'easy':
                # Legacy random pick.
                source = 'choice' if (self.game_model.visibles and random.random() > 0.5) else 'deck'
            else:
                # F3: take the visible card only when it helps build a meld.
                choice_card = self.game_model.visibles[-1] if self.game_model.visibles else None
                # Include the choice card when deriving jokers so a wild choice
                # card (matching the maal face) is recognised as worth picking.
                probe = self.player_model.hand + ([choice_card] if choice_card else [])
                jokers = jokers_from_maal(probe, self.game_model.maal_card)
                source = 'choice' if should_pick_choice(self.player_model.hand, choice_card, jokers) else 'deck'

        card = None
        if source == 'choice' and self.game_model.visibles:
            card = self.game_model.visibles.pop()
        elif self.game_model.deck:
            # Fallback to deck if choice is empty but it wanted choice
            source = 'deck'
            card = self.game_model.deck.pop()

        if card:
            self.player_model.hand.append(card)
            return True, card, source
        return False, None, None

    def handle_discard(self, **kwargs):
        if not self.player_model.hand:
            return False, None

        # F3: honour an explicit card_index when the driver asks for a specific
        # discard (e.g. the claim path discards the exact card that completes the
        # win). Falls through to the heuristic when none/invalid is supplied.
        forced = kwargs.get('card_index')
        if forced is not None and 0 <= forced < len(self.player_model.hand):
            card = self.player_model.hand.pop(forced)
            self.game_model.visibles.append(card)
            return True, card

        if self.difficulty == 'easy':
            idx = random.randint(0, len(self.player_model.hand) - 1)
        else:
            jokers = self._jokers()
            if self.difficulty == 'hard':
                idx = self._discard_with_lookahead(jokers)
            else:
                idx = choose_discard(self.player_model.hand, jokers)

        card = self.player_model.hand.pop(idx)
        self.game_model.visibles.append(card)
        return True, card

    # F3: 'hard' lookahead — try discarding each candidate and keep the one
    # that leaves the lowest unmelded-point hand. Bounded to the cheapest few
    # candidates from the greedy heuristic so it stays fast.
    def _discard_with_lookahead(self, jokers):
        hand = self.player_model.hand
        connections = _meld_connections(hand, jokers)
        # Evaluate the 5 least-connected candidates only.
        candidates = sorted(range(len(hand)), key=lambda i: connections[i])[:5]
        best_idx, best_score = candidates[0], None
        for i in candidates:
            remaining = hand[:i] + hand[i + 1:]
            score = unmelded_points(remaining, jokers)
            if best_score is None or score < best_score:
                best_idx, best_score = i, score
        return best_idx

    def check_game_end(self):
        # F3: a real win check via the rules engine (1 card will be discarded,
        # so a winning hand is the remaining cards forming complete melds).
        return is_winning(self.player_model.hand, self._jokers())
