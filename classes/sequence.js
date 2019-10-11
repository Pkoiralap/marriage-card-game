const {suits, numbers, Card, CardStack} = require('./card')

/* 
    same suit same card
    same suit continuos card
        queen, king, ace counts as continuous cards
        king, ace , two do not count as continuos card
*/ 

class Sequence {
    constructor(cardStack) {
        this.cardStack = cardStack;
        this.valid = false;
        this.tunnela = false;
        this.checkSequence();
    }

    checkSequence() {
        const length = this.cardStack.length();
        if (length < 3) {
            this.valid = false;
            return;
        }

        this.cardStack.sort();
        const cards = this.cardStack.cards;

        let sameSuit = true;
        let sameCard = true;
        let sequence = true;

        for(let i = 0; i < length - 1; i++) {
            sameSuit = sameSuit && 
                cards[i].suit == cards[i+1].suit;
            sameCard = sameSuit && sameCard &&
                cards[i].number == cards[i+1].number;

            const number2 = numbers[cards[i+1].number];
            const number1 = numbers[cards[i].number];
            sequence = sequence && sameSuit && (number2 - number1 === 1)
        }

        if (!sameSuit) return;
        // tunnela

        // convert post ace to ace
        if (cards[length-1].number === 'POSTACE') {
            cards[length-1].number = 'ACE';
        }
        if (sameCard) {
            this.valid = true;
            this.tunnela = true;
            return;
        }
        if (sequence) {
            this.valid = true;
            return;
        }

        // it has already been set to postace
        if (cards[length-1].number === 'POSTACE') {
            return;
        }
        
        // if the first card is ace, check to see if postace case is met
        if (cards[0].number === 'ACE') {
            cards[0].number = 'POSTACE';
            this.checkSequence();
        }
        return;
    }
}

/* 
    same suit same card
    same suit continuos card
        queen, king, ace counts as continuous cards
        king, ace , two do not count as continuos card
*/ 
class Group extends Sequence {
    constructor(cardStack) {
        super(cardStack);
        // is a group if it is a sequence
        this.valid = 
            this.valid ||
            this.checkGroup();
    }

    getCardStructure(cards) {
        const cardStructure = {};
        let retFalse = false;
        let maalCount = 0;
        cards.forEach(({number, suit, maalJoker}) => {
            if (maalJoker) {
                maalCount += 1;
            } else {
                if (cardStructure[number]) {
                    if (cardStructure[number].indexOf(suit) === -1) {
                        cardStructure[number].push(suit);
                    } else {
                        // there is a dublee in the group, not a valid group
                        retFalse = true;
                        return;
                    }
                } else {
                    cardStructure[number] = [suit]
                }
            }
        });
        if (retFalse) retFalse;
        return {cardStructure, maalCount};
    }

    checkGroup() {
        const cards = this.cardStack.cards;
        // find type of group => 1) trail  2) sequence
        // maalJoker can be anything that satisfies the condition
        const {cardStructure, maalCount} = this.getCardStructure(cards);
        if (!cardStructure) return false;
        const keys = Object.keys(cardStructure);
        if (maalCount >= 2) {
            return true;
        } else if (maalCount === 1) {
            if (keys.length === 1 && cardStructure[keys[0]].length === 2) {
                // if there is a single number card and there are two separate suit of cards
                // case 1 trial
                return true;
            } else {
                // if there are multiple number card
                // case 2 sequence
                // see possible things the maal card can be
                // create a sequence out of it and check to see if it is a valid sequence
                const possibleCards = [];
                let isValid = true;
                keys.forEach(key => {
                    if (cardStructure[key].length > 1) {
                        // not valid as we are checking for sequence, but we have two suit of same number
                        isValid = false;
                        return;
                    }
                    let number1 = (numbers[key] - 1) % 13;
                    let number2 = (numbers[key] + 1) % 13;
                    if (number1 === 0) number1 = 13;
                    if (number2 === 0) number2 = 13;
                    
                    possibleCards.push(new Card(cardStructure[key][0], number1));
                    possibleCards.push(new Card(cardStructure[key][0], number2));
                });
                if (!isValid) return false;

                isValid = false;
                possibleCards.forEach(card => {
                    const possibleSequence = new CardStack();
                    keys.forEach(key => {
                        possibleSequence.add(new Card(cardStructure[key][0], numbers[key]));
                    });
                    possibleSequence.add(card);
                    if (new Sequence(possibleSequence).valid) {
                        console.log(JSON.stringify(possibleSequence))
                        isValid = true;
                        return;
                    }
                });
                if (isValid) return true;
            }
        } else {
            // there is no maal, it can not be a sequence as we already checked that in the constructor
            // we just check to see if it is a trial or a 4-of-a-kind
            if (keys.length > 1) {
                return false;
            }
            if (cardStructure[keys[0]].length === cards.length) {
                return true;
            }
        }
        return false;
    }
}

// create for dublee in a later date
exports.Sequence = Sequence;
exports.Group = Group;

// const card5 = new Card('HEART', 'ACE');
// const card4 = new Card('CLUB', 'ACE');
// const card2 = new Card('DIAMOND', 'ACE');


// const cardStack = new CardStack([card5, card4,card2]);
// const sequence = new Group(cardStack);

// console.log(sequence.valid);
// console.log(sequence.tunnela);