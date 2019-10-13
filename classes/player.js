const UUID = require('uuid');
const {CardStack} = require('./card');
class Player {
    constructor(name, cardStack) {
        this.id = UUID.v4();
        this.name = name;
        this.cardStack = cardStack || new CardStack();
        this.turn = false;
    }

    addCard(card) {
        this.cardStack.add(card);
    }

    removeCard(card) {
        this.cardStack.remove(card);
    }

    display() {
        console.log(this.cardStack.length());
    }
};

module.exports = Player;
