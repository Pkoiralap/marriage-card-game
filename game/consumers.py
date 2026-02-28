import json
import asyncio
import random
from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
from .models import Player, Game
from .logic import HumanPlayer, AIPlayer

class GameConsumer(AsyncWebsocketConsumer):
    # Track running AI tasks per room to prevent spam
    ai_tasks = {}

    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = 'game_%s' % self.room_name
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            message = json.loads(data.get('message', '{}'))
            message_type = message.get('type')
            
            if message_type == 'get_game_state':
                await self.send_game_state(message.get('player_name'))
                # Only kick off AI if not already running for this room
                if self.room_name not in GameConsumer.ai_tasks or GameConsumer.ai_tasks[self.room_name].done():
                    GameConsumer.ai_tasks[self.room_name] = asyncio.create_task(self.handle_ai_turns())
            elif message_type == 'pick_card':
                await self.pick_card(message.get('player_name'), message.get('source'), message.get('target_index'))
            elif message_type == 'discard_card':
                await self.discard_card(message.get('player_name'), message.get('card_index'))
        except Exception as e:
            print(f"Error in receive: {e}")

    def run_player_turn(self, player_model, **kwargs):
        player = HumanPlayer(player_model) if player_model.player_type == 'HUMAN' else AIPlayer(player_model)
        return player.process_turn(**kwargs)

    async def pick_card(self, player_name, source, target_index):
        try:
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            players_models = await sync_to_async(list)(game.players.all().order_by('created_at'))
            player_model = await sync_to_async(Player.objects.get)(name=player_name, game=game)
            
            turn_player_model = players_models[game.turn_player_index % len(players_models)]
            if player_model.id != turn_player_model.id:
                return

            await sync_to_async(self.run_player_turn)(player_model, source=source, target_index=target_index)
            await self.broadcast_refresh()
        except Exception as e:
            print(f"Error in pick_card: {e}")

    async def discard_card(self, player_name, card_index):
        try:
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            players_models = await sync_to_async(list)(game.players.all().order_by('created_at'))
            player_model = await sync_to_async(Player.objects.get)(name=player_name, game=game)
            
            turn_player_model = players_models[game.turn_player_index % len(players_models)]
            if player_model.id != turn_player_model.id:
                return

            if await sync_to_async(self.run_player_turn)(player_model, card_index=card_index):
                await self.broadcast_refresh()
                # AI turns will be kicked off by the next 'get_game_state' or already running loop
            else:
                await self.broadcast_refresh()
        except Exception as e:
            print(f"Error in discard_card: {e}")

    async def handle_ai_turns(self):
        while True:
            # Re-fetch models every iteration to get latest state
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            players_models = await sync_to_async(list)(game.players.all().order_by('created_at'))
            current_player_model = players_models[game.turn_player_index % len(players_models)]
            
            if current_player_model.player_type != 'AI':
                print(f"Turn is back to Human player: {current_player_model.name}")
                break
            
            ai_index = game.turn_player_index % len(players_models)
            print(f"AI Turn starting for {current_player_model.name} (Index {ai_index})")
            
            # 1. AI Picks
            source = 'deck'
            if game.visibles and random.random() > 0.5: source = 'choice'
            
            await sync_to_async(self.run_player_turn)(current_player_model, source=source)
            
            # Fetch latest card for animation
            current_player_model = await sync_to_async(Player.objects.get)(id=current_player_model.id)
            picked_card = current_player_model.hand[-1]
            
            await self.broadcast_action({
                'type': 'ai_pick',
                'player_index': ai_index,
                'source': source,
                'card': picked_card
            })
            await asyncio.sleep(1.5) # Wait for pick animation
            
            # 2. AI Discards
            # Refresh model state
            current_player_model = await sync_to_async(Player.objects.get)(id=current_player_model.id)
            await sync_to_async(self.run_player_turn)(current_player_model)
            
            # Refresh game to get the discarded card from visibles
            game = await sync_to_async(Game.objects.get)(id=game.id)
            discarded_card = game.visibles[-1]
            
            await self.broadcast_action({
                'type': 'ai_discard',
                'player_index': ai_index,
                'card': discarded_card
            })
            await asyncio.sleep(1.5) # Wait for discard animation

    async def broadcast_action(self, action):
        # Notify all clients about a specific AI action
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'game_message',
                'message': json.dumps({'type': 'ai_action', 'action': action})
            }
        )
        # Also send full state refresh
        await self.broadcast_refresh()

    async def broadcast_refresh(self):
        await self.channel_layer.group_send(
            self.room_group_name,
            {'type': 'game_message', 'message': json.dumps({'type': 'refresh_state'})}
        )

    async def send_game_state(self, player_name):
        try:
            player = await sync_to_async(Player.objects.get)(name=player_name, game__id=self.room_name)
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            players_models = await sync_to_async(list)(game.players.all().order_by('created_at'))
            
            players_data = []
            for p in players_models:
                players_data.append({
                    'name': p.name,
                    'player_type': p.player_type,
                    'hand_size': len(p.hand)
                })

            state = {
                'hand': player.hand,
                'points': player.points,
                'deck_count': len(game.deck),
                'visibles': game.visibles,
                'choice_card': game.visibles[-1] if game.visibles else None,
                'turn_player_index': game.turn_player_index,
                'turn_step': game.turn_step,
                'phase': game.phase,
                'players': players_data
            }
            
            await self.send(text_data=json.dumps({
                'message': json.dumps({'type': 'game_state', 'state': state})
            }))
        except Exception:
            pass

    async def game_message(self, event):
        await self.send(text_data=json.dumps({'message': event['message']}))
