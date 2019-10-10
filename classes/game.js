const UUID = require('uuid');
const {Card, CardStack, suits, numbers} = require('./card');
const Player = require('./player');

const MAX_NUMBER_OF_PLAYERS = 6;
class Game {
    constructor() {
        this.id = UUID.v4();
        this.baseStack = this.buildBaseStack();
        this.players = [];

        this.baseStack.shuffle();
        this.baseStack.cards.forEach(card => {
            console.log(card.display());
        });
    }

    addPlayer(player) {
        if (this.players.length <= MAX_NUMBER_OF_PLAYERS) {
            this.players.push(player);
            return {success: true};
        };
        return {success: false, message: 'Number of players exceeded'};
    }

    deal() {
        this.players.forEach(player => {
            for (let i=0; i<21; i++) {
                const card = this.baseStack.pop();
                player.addCard(card)
            }
        });
    }

    distributeCards() {

    }

    buildBaseStack() {
        const cardStack = new CardStack();
        [1,2,3].forEach(book => {
            Object.keys(suits).forEach(suit => {
                numbers.forEach(number => {
                    const card = new Card(suit, number, false);
                    cardStack.add(card);
                })
            });
            const joker = new Card(undefined, undefined, true);
            cardStack.add(joker);
        });
        
        return cardStack;
    }
}

const game = new Game();
const player1 = new Player(new CardStack());
const player2 = new Player(new CardStack());
const player3 = new Player(new CardStack());

game.addPlayer(player1);
game.addPlayer(player2);
game.addPlayer(player3);

game.deal();

player1.display();
player2.display();
player3.display();