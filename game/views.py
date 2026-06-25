from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from .models import Game, Player
import json

@ensure_csrf_cookie
def index(request, game_id=None):
    return render(request, 'index.html')

def create_game(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'Invalid request'}, status=400)

    data = json.loads(request.body)
    player_name = (data.get('player_name') or '').strip()
    if not player_name:
        return JsonResponse({'error': 'player_name is required'}, status=400)

    seats = _normalize_seats(data, player_name)

    game = Game.objects.create(
        num_players=len(seats), turn_player_index=0, code=Game.generate_code())
    creator = None
    for i, (ptype, name) in enumerate(seats):
        player = Player.objects.create(
            name=name, game=game, player_type=ptype,
            # The creator has already claimed seat 0 (owned, not a free seat).
            is_dealer=(i == 0), is_joined=(i == 0), has_owner=(i == 0))
        if i == 0:
            creator = player

    game.initialize_deck()
    game.deal_cards()

    return JsonResponse({
        'game_id': str(game.id),
        'code': game.code,
        'player_id': str(creator.id),
    })


def list_games(request):
    """Ongoing games that still have an open human seat to join."""
    games = []
    # Exclude legacy games created before join codes existed (code is null).
    active = Game.objects.filter(is_active=True, code__isnull=False).order_by('-created_at')
    for game in active[:30]:
        open_seats = game.open_human_seat_names()
        if open_seats:
            games.append({
                'code': game.code,
                'num_players': game.num_players,
                'open_seats': open_seats,
            })
    return JsonResponse({'games': games})


def _normalize_seats(data, player_name):
    """Build an ordered list of (player_type, name) tuples for the seats.

    Seat 0 is always the creator (human). Other seats come from the client's
    `seats` config when present; otherwise we fall back to the legacy layout of
    one human plus alternating AI. AI seats are auto-named and every name is
    made unique so per-game name lookups stay unambiguous.
    """
    raw_seats = data.get('seats')
    if not raw_seats:
        num_players = int(data.get('num_players', 4))
        raw_seats = [{'type': 'HUMAN'}] + [
            {'type': 'AI' if i % 2 == 0 else 'HUMAN'} for i in range(num_players - 1)
        ]

    seats, used, ai_count = [], set(), 0
    for i, seat in enumerate(raw_seats):
        if i == 0:
            ptype, name = 'HUMAN', player_name
        elif str(seat.get('type', '')).upper() == 'AI':
            ai_count += 1
            ptype, name = 'AI', f'AI_{ai_count}'
        else:
            ptype = 'HUMAN'
            name = (seat.get('name') or '').strip() or f'Player {i + 1}'

        unique, suffix = name, 2
        while unique in used:
            unique = f'{name} ({suffix})'
            suffix += 1
        used.add(unique)
        seats.append((ptype, unique))

    return seats