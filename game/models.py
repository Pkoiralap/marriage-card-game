from django.db import models
import uuid

import random

# Short, shareable join codes. No I/O/0/1 to avoid visual confusion.
CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

# Number of distinct procedural avatar presets the client knows how to render.
NUM_AVATARS = 10


def random_avatar():
    return random.randint(0, NUM_AVATARS - 1)


class Game(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Short human-friendly room code used for sharing/joining (the UUID stays
    # the internal PK). Indexed + unique so codes resolve a game directly.
    code = models.CharField(max_length=12, unique=True, null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)
    deck = models.JSONField(default=list)
    visibles = models.JSONField(default=list) # First element is choice card
    turn_player_index = models.IntegerField(default=0)
    num_players = models.IntegerField(default=4)
    phase = models.CharField(max_length=20, default='DEALING')
    turn_step = models.CharField(max_length=20, default='PICK') # 'PICK', 'DISCARD'
    maal_card = models.JSONField(null=True, blank=True)
    # S3: deadline (UTC) by which the current turn's player must act before the
    # server auto-acts for them. Null when no human deadline is pending.
    turn_deadline = models.DateTimeField(null=True, blank=True)
    round_number = models.IntegerField(default=1)  # S1: increments each re-deal; Player.points is cumulative

    def __str__(self):
        return self.code or str(self.id)

    @classmethod
    def generate_code(cls):
        """A unique join code: 4 letters, growing only as active games scale.

        The code space is kept comfortably larger than the number of active
        games, so codes stay short (4 letters) until there are tens of
        thousands of live games, then lengthen automatically to stay unique.
        """
        active = cls.objects.filter(is_active=True).count()
        length = 4
        while len(CODE_ALPHABET) ** length < max(1, active) * 36:
            length += 1
        for _ in range(50):
            code = ''.join(random.choice(CODE_ALPHABET) for _ in range(length))
            if not cls.objects.filter(code=code).exists():
                return code
        # Astronomically unlikely; widen and try once more.
        return ''.join(random.choice(CODE_ALPHABET) for _ in range(length + 1))

    def open_human_seat_names(self):
        """Human seats that have NEVER been occupied (free for any new player).

        A seat whose owner merely disconnected (has_owner=True, is_joined=False)
        is deliberately excluded: it stays reserved so that player can rejoin by
        name, and nobody else can take over their in-progress hand.
        """
        return [p.name for p in self.players.filter(player_type='HUMAN', has_owner=False)]

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

    def start_new_round(self):
        """S1: re-deal a fresh round in the same room, keeping cumulative points.

        Resets every player's per-round state (hand, shown sequences, turn_count)
        but NOT their ``points`` (cumulative across rounds). Rotates the dealer so
        the next player leads, reshuffles a new deck, deals, and clears the maal.
        """
        players = list(self.players.all().order_by('created_at'))
        n = len(players) or 1
        # Rotate the lead/dealer one seat for the new round.
        prev_dealer = next((i for i, p in enumerate(players) if p.is_dealer), 0)
        new_dealer = (prev_dealer + 1) % n
        for i, p in enumerate(players):
            p.hand = []
            p.shown_sequences = []
            p.turn_count = 0
            p.is_dealer = (i == new_dealer)
            p.save(update_fields=['hand', 'shown_sequences', 'turn_count', 'is_dealer'])

        self.maal_card = None
        self.visibles = []
        self.is_active = True
        self.round_number = (self.round_number or 1) + 1
        self.turn_player_index = new_dealer
        self.initialize_deck()  # reshuffles + saves
        self.deal_cards()       # deals 21 each, sets choice card, PLAYING/PICK, saves

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
    is_joined = models.BooleanField(default=False)   # a client is connected right now
    has_owner = models.BooleanField(default=False)   # claimed at least once (set once, never cleared)
    # Peek: when True this player consents to their RIGHT neighbour seeing their
    # hand (the right neighbour can rotate the table to glance at it). Toggleable
    # mid-game; only the right neighbour's client ever receives the real cards.
    allow_peek = models.BooleanField(default=False)
    avatar = models.IntegerField(default=random_avatar)  # which procedural avatar preset to render
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