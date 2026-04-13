import json
import asyncio
import random
from channels.generic.websocket import AsyncWebsocketConsumer
from asgiref.sync import sync_to_async
from .models import Player, Game, GameAction
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
            elif message_type == 'register_sequence':
                await self.register_sequence(message.get('player_name'), message.get('sequence_id'), message.get('card_indices'))
            elif message_type == 'register_tunnela':
                await self.register_tunnela(message.get('player_name'), message.get('card_indices'))
            elif message_type == 'register_dublee':
                await self.register_dublee(message.get('player_name'), message.get('card_indices'))
            elif message_type == 'select_maal':
                await self.select_maal(message.get('player_name'), message.get('card_id'))
            elif message_type == 'cancel_sequence':
                await self.cancel_sequence(message.get('player_name'))
            elif message_type == 'reorder_hand':
                await self.reorder_hand(message.get('player_name'), message.get('old_index'), message.get('new_index'))
            elif message_type == 'claim_game':
                await self.claim_game(message.get('player_name'))
        except Exception as e:
            print(f"Error in receive: {e}")

    async def claim_game(self, player_name):
        try:
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            player_model = await sync_to_async(Player.objects.get)(name=player_name, game=game)
            
            # Logic: verify player has only 1 card and has shown sequences
            # For now, just trust the client and broadcast winner
            if len(player_model.hand) == 1:
                game.is_active = False
                await sync_to_async(game.save)()
                
                await self.broadcast_action({
                    'type': 'GAME_CLAIMED',
                    'player_name': player_name,
                    'message': f"{player_name} has won the game!"
                })
        except Exception as e:
            print(f"Error in claim_game: {e}")

    async def reorder_hand(self, player_name, old_index, new_index):
        try:
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            player_model = await sync_to_async(Player.objects.get)(name=player_name, game=game)
            
            hand = list(player_model.hand)
            if 0 <= old_index < len(hand) and 0 <= new_index < len(hand):
                card = hand.pop(old_index)
                hand.insert(new_index, card)
                player_model.hand = hand
                await sync_to_async(player_model.save)()
                # No need to broadcast, only the reordering player cares
        except Exception as e:
            print(f"Error in reorder_hand: {e}")

    def run_player_turn(self, player_model, **kwargs):
        player = HumanPlayer(player_model) if player_model.player_type == 'HUMAN' else AIPlayer(player_model)
        return player.process_turn(**kwargs)

    async def pick_card(self, player_name, source, target_index):
        try:
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            players_models = await sync_to_async(list)(game.players.all().order_by('created_at'))
            player_model = await sync_to_async(Player.objects.get)(name=player_name, game=game)
            
            player_index = -1
            for i, p in enumerate(players_models):
                if p.id == player_model.id:
                    player_index = i
                    break

            turn_player_model = players_models[game.turn_player_index % len(players_models)]
            if player_model.id != turn_player_model.id:
                return

            success, picked_card, actual_source = await sync_to_async(self.run_player_turn)(player_model, source=source, target_index=target_index)
            if success:
                await sync_to_async(GameAction.objects.create)(
                    game=game,
                    player=player_model,
                    action_type='PICK',
                    data={'source': actual_source, 'card': picked_card}
                )

                broadcast_card = picked_card if actual_source == 'choice' else None

                await self.broadcast_action({
                    'type': 'player_pick',
                    'player_index': player_index,
                    'player_name': player_name,
                    'source': actual_source,
                    'card': broadcast_card
                })
        except Exception as e:
            print(f"Error in pick_card: {e}")

    async def discard_card(self, player_name, card_index):
        try:
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            players_models = await sync_to_async(list)(game.players.all().order_by('created_at'))
            player_model = await sync_to_async(Player.objects.get)(name=player_name, game=game)
            
            player_index = -1
            for i, p in enumerate(players_models):
                if p.id == player_model.id:
                    player_index = i
                    break

            turn_player_model = players_models[game.turn_player_index % len(players_models)]
            if player_model.id != turn_player_model.id:
                return

            success, discarded_card, _ = await sync_to_async(self.run_player_turn)(player_model, card_index=card_index)
            if success:
                player_model.turn_count += 1
                await sync_to_async(player_model.save)()

                await sync_to_async(GameAction.objects.create)(
                    game=game,
                    player=player_model,
                    action_type='DISCARD',
                    data={'card': discarded_card}
                )

                await self.broadcast_action({
                    'type': 'player_discard',
                    'player_index': player_index,
                    'player_name': player_name,
                    'card': discarded_card
                })
        except Exception as e:
            print(f"Error in discard_card: {e}")

    async def register_sequence(self, player_name, sequence_id, card_indices):
        try:
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            player_model = await sync_to_async(Player.objects.get)(name=player_name, game=game)
            
            # Logic: verify indices are valid and cards form a sequence
            # For now, just stub it
            cards = [player_model.hand[i] for i in card_indices]
            
            # Update shown_sequences (Don't remove from hand yet!)
            current_sequences = player_model.shown_sequences
            current_sequences.append(cards)
            
            player_model.shown_sequences = current_sequences
            
            all_done = len([s for s in current_sequences if s]) >= 3
            
            if all_done:
                # ONLY NOW remove all cards from hand
                registered_ids = set()
                for seq in current_sequences:
                    for c in seq:
                        registered_ids.add(c['id'])
                
                new_hand = [c for c in player_model.hand if c['id'] not in registered_ids]
                player_model.hand = new_hand

            await sync_to_async(player_model.save)()
            needs_maal = all_done and game.maal_card is None
            
            # Broadcast the success
            await self.broadcast_action({
                'type': 'SHOW_SEQUENCE_SUCCESS',
                'player_name': player_name,
                'sequence_id': sequence_id,
                'all_sequences_done': all_done,
                'needs_maal_selection': needs_maal,
                'unseen_cards': game.deck if needs_maal else []
            })
        except Exception as e:
            print(f"Error in register_sequence: {e}")

    async def register_tunnela(self, player_name, card_indices):
        try:
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            player_model = await sync_to_async(Player.objects.get)(name=player_name, game=game)
            if player_model.turn_count > 0: return 
            
            cards = [player_model.hand[i] for i in card_indices]
            # Stub
            await self.broadcast_action({
                'type': 'SHOW_TUNNELA_SUCCESS',
                'player_name': player_name,
                'cards': cards
            })
        except Exception as e:
            print(f"Error in register_tunnela: {e}")

    async def register_dublee(self, player_name, card_indices):
        try:
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            player_model = await sync_to_async(Player.objects.get)(name=player_name, game=game)
            
            cards = [player_model.hand[i] for i in card_indices]
            current_sequences = player_model.shown_sequences
            current_sequences.append(cards)
            player_model.shown_sequences = current_sequences
            await sync_to_async(player_model.save)()

            # For dublee, need 7 or 8. Let's say 7 for maal, 8 for win.
            all_done = len(current_sequences) >= 7
            needs_maal = all_done and game.maal_card is None

            await self.broadcast_action({
                'type': 'SHOW_DUBLEE_SUCCESS',
                'player_name': player_name,
                'all_sequences_done': all_done,
                'needs_maal_selection': needs_maal,
                'unseen_cards': game.deck if needs_maal else []
            })
        except Exception as e:
            print(f"Error in register_dublee: {e}")

    async def cancel_sequence(self, player_name):
        try:
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            player_model = await sync_to_async(Player.objects.get)(name=player_name, game=game)
            player_model.shown_sequences = []
            await sync_to_async(player_model.save)()
            
            await self.broadcast_action({
                'type': 'SHOW_SEQUENCE_CANCEL',
                'player_name': player_name
            })
        except Exception as e:
            print(f"Error in cancel_sequence: {e}")

    async def select_maal(self, player_name, card_id):
        try:
            game = await sync_to_async(Game.objects.get)(id=self.room_name)
            # Find the card in the deck
            card_to_move = None
            new_deck = []
            for c in game.deck:
                if c['id'] == card_id:
                    card_to_move = c
                else:
                    new_deck.append(c)
            
            if card_to_move:
                # Place at bottom
                new_deck.insert(0, card_to_move)
                game.deck = new_deck
                game.maal_card = card_to_move
                game.phase = 'MAAL_REVEALED'
                await sync_to_async(game.save)()

                await self.broadcast_action({
                    'type': 'MAAL_SELECTED',
                    'player_name': player_name,
                    'card': card_to_move
                })
        except Exception as e:
            print(f"Error in select_maal: {e}")

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
            
            success, picked_card, actual_source = await sync_to_async(self.run_player_turn)(current_player_model, source=source)
            
            if success:
                await sync_to_async(GameAction.objects.create)(
                    game=game,
                    player=current_player_model,
                    action_type='PICK',
                    data={'source': actual_source, 'card': picked_card}
                )

                broadcast_card = picked_card if actual_source == 'choice' else None

                await self.broadcast_action({
                    'type': 'ai_pick',
                    'player_index': ai_index,
                    'player_name': current_player_model.name,
                    'source': actual_source,
                    'card': broadcast_card
                })
                await asyncio.sleep(1.5) # Wait for pick animation
            
            # 2. AI Discards
            # Refresh model state
            current_player_model = await sync_to_async(Player.objects.get)(id=current_player_model.id)
            success, discarded_card, _ = await sync_to_async(self.run_player_turn)(current_player_model)
            
            if success:
                current_player_model.turn_count += 1
                await sync_to_async(current_player_model.save)()

                await sync_to_async(GameAction.objects.create)(
                    game=game,
                    player=current_player_model,
                    action_type='DISCARD',
                    data={'card': discarded_card}
                )

                await self.broadcast_action({
                    'type': 'ai_discard',
                    'player_index': ai_index,
                    'player_name': current_player_model.name,
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
                    'hand_size': len(p.hand),
                    'has_shown': len([s for s in p.shown_sequences if s]) >= 3
                })

            visible_maal = None
            if len([s for s in player.shown_sequences if s]) >= 3:
                visible_maal = game.maal_card

            show_allowed = (game.turn_step == 'DISCARD') or (player.turn_count == 0)

            state = {
                'hand': player.hand,
                'shown_sequences': player.shown_sequences,
                'points': player.points,
                'turn_count': player.turn_count,
                'show_sequence_allowed': show_allowed,
                'deck_count': len(game.deck),
                'visibles': game.visibles,
                'choice_card': game.visibles[-1] if game.visibles else None,
                'turn_player_index': game.turn_player_index,
                'turn_step': game.turn_step,
                'phase': game.phase,
                'players': players_data,
                'maal_card': visible_maal
            }
            
            await self.send(text_data=json.dumps({
                'message': json.dumps({'type': 'game_state', 'state': state})
            }))
        except Exception as e:
            print(f"Error in send_game_state: {e}")

    async def game_message(self, event):
        await self.send(text_data=json.dumps({'message': event['message']}))