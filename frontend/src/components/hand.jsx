import React, {useState,useCallback} from "react";
import Card from "./card";
import SequenceDrop from "./sequenceDrop";
import '../css/hand.css'

const Hand = ({name, cards}) => {
  const [hand, setHand] = useState(cards);
  const [sequences, setSequences] = useState([[],[],[]])

  const moveCard = useCallback((from, to) => {
    const updated = [...hand];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    setHand(updated);
  }, [hand]);

  const dropSequence = (zoneIndex, card) => {
    setSequences(prev => {
      const updated = [...prev];
      updated[zoneIndex] = [...updated[zoneIndex],card];
      return updated;
    });
    setHand(prev => prev.filter(c => !(c.value === card.value && c.suit === card.suit)))
  }
  
  return (
    <>
    <div className='sequence'>
    {sequences.map((zone, i) =>(
      <SequenceDrop key={Math.random} index={i} cards={zone} onDrop={card => dropSequence(i,card)}/>
    ))}
    </div>
    <div className='player'>
      {hand.map((card, index) => (
        <Card key = {Math.random} index={index} value = {card.value} suit={card.suit} moveCard={moveCard} draggable={true} hidden={false} fromHand={true}/>
      )
      )}
    <div className="Name">{name}</div>
    </div>
    </>
  );
};

export default Hand;