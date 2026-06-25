from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('game/<str:game_id>/', views.index, name='game_room'),
    path('create_game/', views.create_game, name='create_game'),
    path('games/', views.list_games, name='list_games'),
]