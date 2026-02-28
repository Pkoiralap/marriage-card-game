from django.shortcuts import render
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from .models import Game, Player
import json

@ensure_csrf_cookie
def index(request, game_id=None):
    return render(request, 'index.html')

def create_game(request):
    if request.method == 'POST':
        data = json.loads(request.body)
        player_name = data.get('player_name')
        num_players = int(data.get('num_players', 4))
        
        game = Game.objects.create(num_players=num_players, turn_player_index=0)
        # Create Human player first
        player = Player.objects.create(name=player_name, game=game, is_dealer=True, player_type='HUMAN')
        
        # Create AI players after
        for i in range(num_players - 1):
            Player.objects.create(name=f"AI_{i+1}", game=game, player_type='AI')
        
        # Initialize deck and deal cards
        game.initialize_deck()
        game.deal_cards()
        
        return JsonResponse({'game_id': str(game.id), 'player_id': str(player.id)})
    return JsonResponse({'error': 'Invalid request'}, status=400)