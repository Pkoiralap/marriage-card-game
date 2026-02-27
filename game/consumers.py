import json
from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
from .models import Player, Game

class GameConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = 'game_%s' % self.room_name

        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        await self.accept()

    async def disconnect(self, close_code):
        # Leave room group
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    # Receive message from WebSocket
    async def receive(self, text_data):
        text_data_json = json.loads(text_data)
        message_str = text_data_json.get('message')
        
        if message_str:
            try:
                message = json.loads(message_str)
                message_type = message.get('type')
                
                if message_type == 'get_game_state':
                    player_name = message.get('player_name')
                    await self.send_game_state(player_name)
                elif message_type == 'join':
                    # Notify others (optional for now)
                    pass
                elif message_type == 'pick_card':
                    player_name = message.get('player_name')
                    pick_source = message.get('source') # 'deck' or 'choice'
                    target_index = message.get('target_index')
                    await self.pick_card(player_name, pick_source, target_index)
                elif message_type == 'discard_card':
                    player_name = message.get('player_name')
                    card_index = message.get('card_index')
                    await self.discard_card(player_name, card_index)
                    
            except json.JSONDecodeError:
                pass

    async def pick_card(self, player_name, source, target_index=None):
        # Fetch game and player from DB
        try:
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            player = await sync_to_async(Player.objects.get)(name=player_name, game=game)
            
            # Find current turn player
            players = await sync_to_async(list)(game.players.all().order_by('created_at'))
            turn_player = players[game.turn_player_index % len(players)]
            
            # Validate turn and step
            if player.id != turn_player.id:
                return # Not your turn
            
            if game.turn_step != 'PICK':
                return # Already picked, must discard

            card = None
            if source == 'deck':
                if game.deck:
                    card = game.deck.pop()
                else:
                    return
            elif source == 'choice':
                if game.visibles and len(game.visibles) > 0:
                    card = game.visibles.pop()
                else:
                    return

            if card:
                if target_index is not None and isinstance(target_index, int) and 0 <= target_index <= len(player.hand):
                    player.hand.insert(target_index, card)
                else:
                    player.hand.append(card)

            game.turn_step = 'DISCARD'
            await sync_to_async(player.save)()
            await sync_to_async(game.save)()
            
            # Broadcast refresh to everyone
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'game_message',
                    'message': json.dumps({'type': 'refresh_state'})
                }
            )
        except (Player.DoesNotExist, Game.DoesNotExist):
            pass

    async def discard_card(self, player_name, card_index):
        try:
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            player = await sync_to_async(Player.objects.get)(name=player_name, game=game)
            
            # Validate turn and step
            players = await sync_to_async(list)(game.players.all().order_by('created_at'))
            turn_player = players[game.turn_player_index % len(players)]
            
            if player.id != turn_player.id:
                return # Not your turn
            
            if game.turn_step != 'DISCARD':
                return # Must pick first

            if 0 <= card_index < len(player.hand):
                card = player.hand.pop(card_index)
                game.visibles.append(card)
                
                # Turn stays with current player for testing
                game.turn_step = 'PICK'
                
                await sync_to_async(player.save)()
                await sync_to_async(game.save)()
                
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'game_message',
                        'message': json.dumps({'type': 'refresh_state'})
                    }
                )
        except (Player.DoesNotExist, Game.DoesNotExist):
            pass

    async def send_game_state(self, player_name):
        # Fetch player and hand from DB
        try:
            player = await sync_to_async(Player.objects.get)(name=player_name, game__id=self.room_name)
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            
            state = {
                'hand': player.hand,
                'points': player.points,
                'deck_count': len(game.deck),
                'visibles': game.visibles,
                'choice_card': game.visibles[-1] if game.visibles else None,
                'turn_player_index': game.turn_player_index,
                'turn_step': game.turn_step,
                'phase': game.phase
            }
            
            await self.send(text_data=json.dumps({
                'message': json.dumps({
                    'type': 'game_state',
                    'state': state
                })
            }))
        except Player.DoesNotExist:
            pass

    # Receive message from room group
    async def game_message(self, event):
        message = event['message']

        # Send message to WebSocket
        await self.send(text_data=json.dumps({
            'message': message
        }))