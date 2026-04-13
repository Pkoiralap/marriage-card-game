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
    maal_card = models.JSONField(null=True, blank=True)

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
    PLAYER_TYPES = [
        ('HUMAN', 'Human'),
        ('AI', 'AI'),
    ]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name='players')
    player_type = models.CharField(max_length=10, choices=PLAYER_TYPES, default='HUMAN')
    hand = models.JSONField(default=list)
    shown_sequences = models.JSONField(default=list) # List of lists of cards
    is_dealer = models.BooleanField(default=False)
    points = models.IntegerField(default=0)
    turn_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    def __str__(self):
        return self.name

class GameAction(models.Model):
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name='actions')
    player = models.ForeignKey(Player, on_delete=models.SET_NULL, null=True, related_name='actions')
    action_type = models.CharField(max_length=50) # 'PICK', 'DISCARD', 'SHOW_SEQUENCE', etc.
    data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{self.player.name if self.player else 'System'}: {self.action_type}"