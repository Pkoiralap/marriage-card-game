const UUID = require('uuid');

const suits = {
    'CLUB': 1,
    'SPADE': 2,
    'HEART': 3,
    'DIAMOND': 4,
};

const numbers = {
    'ACE': 1,
    'TWO': 2,
    'THREE': 3,
    'FOUR': 4,
    'FIVE': 5,
    'SIX': 6,
    'SEVEN': 7,
    'EIGHT': 8,
    'NINE': 9,
    'TEN': 10,
    'JACK': 11,
    'QUEEN': 12,
    'KING': 13,
    'POSTACE': 14,
};

class Card {
    constructor(suit, number, jocker, player) {
        this.cardID = UUID.v4();
        if (typeof number === 'string') {
            this.number = number;
        } else {
            Object.keys(numbers).forEach(key => {
                if (numbers[key] === number) {
                    this.number = key;
                    return;
                }
            });
        }
        this.suit = suit;
        this.player = player;
        this.jocker = jocker;
    }

    setMaal(maal) {
        // maal is also a jocker
        this.setJoker();

        // maal is the value of it
        // maal of 2 points, 3 points or 5 points
        this.maal = maal; 
    }

    setJoker() {
        this.maalJoker = true;
    }

    display() {
        return this.jocker ? 'JOKER' : `${this.number} of ${this.suit}`
    }
}

class CardStack {
    constructor(cards) {
        this.cards = cards || [];
    }

    __findCardIndex(card) {
        return this.cards.map(item => item.UUID).indexOf(card.UUID);
    }

    length() {
        return this.cards.length;
    }

    add(card) {
        this.cards.push(card);
    }

    remove(card) {
        let removedCard;
        if (this.__findCardIndex(card) !== -1) {
            removedCard = this.cards.splice(index);
        }
        return removedCard;
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

    sort() {
        this.cards = this.cards.sort((a, b) => {
            const aNumber = numbers[a.number];
            const bNumber = numbers[b.number];
            if (aNumber - bNumber > 0) return 1;
            if (aNumber - bNumber < 0) return -1;
            return 0;
        })
    }
}

exports.CardStack = CardStack;
exports.Card = Card;
exports.suits = suits;
exports.numbers = numbers;