from django.db import models
import uuid

import random

class Game(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)
    deck = models.JSONField(default=list)
    visibles = models.JSONField(default=list) # First element is choice card
    turn_player_index = models.IntegerField(default=0)
    num_players = models.IntegerField(default=4)
    phase = models.CharField(max_length=20, default='DEALING')
    turn_step = models.CharField(max_length=20, default='PICK') # 'PICK', 'DISCARD'

    def __str__(self):
        return str(self.id)

    def initialize_deck(self):
        suits = ['SPADE', 'HEART', 'CLUB', 'DIAMOND']
        numbers = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
        
        # 3 decks for Marriage
        deck = []
        card_id = 0
        for _ in range(3):
            for suit in suits:
                for number in numbers:
                    deck.append({'suit': suit, 'number': number, 'id': card_id})
                    card_id += 1
        
        random.shuffle(deck)
        self.deck = deck
        self.save()

    def deal_cards(self):
        players = list(self.players.all())
        for player in players:
            player.hand = [self.deck.pop() for _ in range(21)]
            player.save()
        
        # Set initial choice card
        if self.deck:
            self.visibles = [self.deck.pop()]
        
        self.phase = 'PLAYING'
        self.turn_step = 'PICK'
        self.save()

class Player(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name='players')
    hand = models.JSONField(default=list)
    is_dealer = models.BooleanField(default=False)
    points = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    def __str__(self):
        return self.name