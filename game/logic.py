import random
from abc import ABC, abstractmethod

class BasePlayer(ABC):
    def __init__(self, player_model):
        self.player_model = player_model
        self.game_model = player_model.game

    def process_turn(self, **kwargs):
        """
        Main entry point for a player's turn. 
        Returns True if turn is complete (discarded), False if still in progress.
        """
        if self.game_model.turn_step == 'PICK':
            if self.handle_pick(**kwargs):
                self.game_model.turn_step = 'DISCARD'
                self.sort_cards()
                self.show_sequence_or_dublee()
                self.save()
                return False # Still need to discard
        
        elif self.game_model.turn_step == 'DISCARD':
            if self.handle_discard(**kwargs):
                # Turn is complete, move to next player (ANTI-CLOCKWISE)
                self.game_model.turn_step = 'PICK'
                self.game_model.turn_player_index = (self.game_model.turn_player_index - 1) % self.game_model.num_players
                
                if self.check_game_end():
                    self.claim_game()
                
                self.save()
                return True
        
        return False

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
            return False
            
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
            return True
        return False

    def handle_discard(self, card_index=None, **kwargs):
        if card_index is None:
            return False
            
        if 0 <= card_index < len(self.player_model.hand):
            card = self.player_model.hand.pop(card_index)
            self.game_model.visibles.append(card)
            return True
        return False

class AIPlayer(BasePlayer):
    def handle_pick(self, **kwargs):
        # Random pick logic for now
        source = 'deck'
        if self.game_model.visibles and random.random() > 0.5:
            source = 'choice'
        
        card = None
        if source == 'choice' and self.game_model.visibles:
            card = self.game_model.visibles.pop()
        elif self.game_model.deck:
            card = self.game_model.deck.pop()

        if card:
            self.player_model.hand.append(card)
            return True
        return False

    def handle_discard(self, **kwargs):
        if self.player_model.hand:
            # Discard random card
            idx = random.randint(0, len(self.player_model.hand) - 1)
            card = self.player_model.hand.pop(idx)
            self.game_model.visibles.append(card)
            return True
        return False
