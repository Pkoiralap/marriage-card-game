const UUID = require('uuid');

class Player {
    constructor(cardStack) {
        this.id = UUID.v4();
        this.cardStack = cardStack;
        this.turn = false;
    }

    addCard(card) {
        this.cardStack.add(card);
    }

    display() {
        console.log(this.cardStack.length());
    }
};

module.exports = Player;
