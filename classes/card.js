const UUID = require('uuid');

const suits = {
    'CLUB': 1,
    'SPADE': 2,
    'HEART': 3,
    'DIAMOND': 4,
};

const numbers = [
    'ACE',
    'ONE',
    'TWO',
    'THREE',
    'FOUR',
    'FIVE',
    'SIX',
    'SEVEN',
    'EIGHT',
    'NINE',
    'TEN',
    'JACK',
    'QUEEN',
    'KING',
];

class Card {
    constructor(suit, number, jocker) {
        this.cardID = UUID.v4();
        this.number = number;
        this.suit = suit;
        this.jocker = jocker;
    }

    display() {
        return this.jocker ? 'JOKER' : `${this.number} of ${this.suit}`
    }
}

class CardStack {
    constructor(cards) {
        this.cards = cards || [];
    }

    length() {
        return this.cards.length;
    }

    add(card) {
        this.cards.push(card);
    }

    remove(card) {
        const index = this.cards.map(item => item.UUID).indexOf(card.UUID);
        if (index !== -1) {
            this.cards.splice(index);
        }
    }

    pop() {
        return this.cards.pop();
    }

    /*
        * Randomly shuffle an array
        * https://stackoverflow.com/a/2450976/1293256
        * @param  {Array} array The array to shuffle
        * @return {String}      The first item in the shuffled array
    */
    shuffle() {
        let currentIndex = this.cards.length;
        let temporaryValue, randomIndex;

        // While there remain elements to shuffle...
        while (0 !== currentIndex) {
            // Pick a remaining element...
            randomIndex = Math.floor(Math.random(new Date()) * currentIndex);
            currentIndex -= 1;

            // And swap it with the current element.
            temporaryValue = this.cards[currentIndex];
            this.cards[currentIndex] = this.cards[randomIndex];
            this.cards[randomIndex] = temporaryValue;
        }

        return this.cards;
    }
}

exports.CardStack = CardStack;
exports.Card = Card;
exports.suits = suits;
exports.numbers = numbers;