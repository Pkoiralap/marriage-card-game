const UUID = require('uuid');
const {Card, CardStack, suits, numbers} = require('./card');
const Player = require('./player');

const MAX_NUMBER_OF_PLAYERS = 6;
const TWO_HOURS = 2 * 60 * 60 * 1000;
class Game {
    constructor(db, json) {
        this.db = db;
        this.id = UUID.v4();
        this.players = [];
        this.deck = this.buildDeck();
        this.visibles = new CardStack();
        this.createdBy = undefined;

        setTimeout(() => {
            this.destroy();
        }, TWO_HOURS)
    }

    addPlayer(player) {
        if (this.players.filter(p => p.name === player.name )[0]) {
            return {success: false, message: 'A player with the same name already exists'};
        }
        if (this.players.length <= MAX_NUMBER_OF_PLAYERS) {
            if (this.players.length === 0) {
                this.createdBy = player;
            }
            this.players.push(player);
            return {success: true, data: {gameId: this.id}};
        };
        return {success: false, message: 'Number of players exceeded'};
    }

    deal() {
        this.players.forEach(player => {
            for (let i=0; i<21; i++) {
                const card = this.deck.pop();
                player.addCard(card)
            }
        });
    }

    buildDeck() {
        const cardStack = new CardStack();
        [1,2,3].forEach(book => {
            Object.keys(suits).forEach(suit => {
                Object.keys(numbers).forEach(number => {
                    const card = new Card(suit, number, false);
                    cardStack.add(card);
                })
            });
            const joker = new Card(undefined, undefined, true);
            cardStack.add(joker);
        });
        cardStack.shuffle();
        return cardStack;
    }

    initiate() {
        this.deal();
        const card = this.deck.pop();
        this.visibles.add(card);
    }

    // deckOrVisibles == 'deck', or 'visibles'
    take(player, deckOrVisibles) {
        const taken = this[deckOrVisibles].pop();
        player.addCard(taken);
    }

    throw(player, card) {
        const removed = player.remove(card);
        this.visibles.add(removed);
    }

    async save() {
        const docToSave = {
            _id: this.id,
            players: this.players,
            deck: this.deck,
            visibles: this.visibles,
        };
        
        const exists = await this.db.existsDocument('GAME', this);
        if (exists) {
            return this.db.replaceDocument('GAME', {_id: this.id}, docToSave)
        }
        return this.db.createDocument('GAME', docToSave)
    }

    destroy() {
        return this.db.deleteDocument({_id: id});
    }
}

module.exports = Game;

// const game = new Game();
// const player1 = new Player(new CardStack());
// const player2 = new Player(new CardStack());
// const player3 = new Player(new CardStack());

// game.addPlayer(player1);
// game.addPlayer(player2);
// game.addPlayer(player3);

// game.initiate();

// player1.display();
// player2.display();
// player3.display();