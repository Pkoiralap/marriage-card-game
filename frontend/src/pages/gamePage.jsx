import React from 'react'
import '../css/gamePage.css'
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import Hand from '../components/hand'
import Floor from '../components/floor'
import Opponents from '../components/opponents'

function GamePage() {
const player1Cards = [{ value: "5", suit: "D" },{ value: "10", suit: "C" }, { value: "8", suit: "H" },{ value: "6", suit: "S" },{ value: "6", suit: "S" },{ value: "6", suit: "S" },{ value: "6", suit: "S" },{ value: "6", suit: "S" },{ value: "6", suit: "S" } ];
const player2Cards = [{ value: "5", suit: "D" },{ value: "10", suit: "C" },];
const player3Cards = [{ value: "5", suit: "D" },{ value: "10", suit: "C" },  ];
const player4Cards = [{ value: "5", suit: "D" },{ value: "10", suit: "C" },  ];


 const centerCards = [
    { value: "5", suit: "D" },
    { value: "10", suit: "C" },{ value: "9", suit: "D" },{ value: "4", suit: "h" }
  ];

  const deckCards = [
    { value: "5", suit: "D" },
    { value: "10", suit: "C" },{ value: "9", suit: "D" },{ value: "4", suit: "h" }
  ];

return (
  <DndProvider backend={HTML5Backend}>
  <div className='gamePage'>
  <div className='Game-table'>
    <Hand position="bottom" name="Player1" cards={player1Cards} />
    <Floor thrownCards={centerCards} deckCards={deckCards}/>
    <Opponents number= "one" name="Player2" cards={player2Cards} />
    <Opponents number= "two" name="Player3" cards={player3Cards} />
    <Opponents number= "three" name="Player4" cards={player4Cards} />

    </div>
  </div>
  </DndProvider>
);
}

export default GamePage
