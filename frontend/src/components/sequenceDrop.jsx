import React from 'react';
import { useDrop } from "react-dnd";
import Card from './card';

const ItemTypes = {CARD:'card'};

const SequenceDrop = ({cards, onDrop}) => {
  const [{ isOver }, drop] = useDrop({
    accept: ItemTypes.CARD,
    drop: (item) => {
      if (item.fromHand) {
        onDrop({ value: item.value, suit: item.suit });
      }
    },
    collect: monitor => ({
      isOver: !!monitor.isOver()
    })
  });

  return (
    <div
      ref={drop}
      className="drop-zone"
      style={{
        border: "2px dashed #888",
        padding: "10px",
        margin: "10px",
        backgroundColor: isOver ? "#eef" : "#f9f9f9",
        display: "flex",
        flexWrap: "wrap",
        gap: "4px",
        width: "30px",
        height: "40px"
      }}
    > Seq
      {cards.map((card, idx) => (
        <Card
          index={idx}
          value={card.value}
          suit={card.suit}
          hidden={false}
          moveCard={true}
          draggable={true}
          fromHand={true}
        />
      ))}
    </div>
  );
}

export default SequenceDrop;