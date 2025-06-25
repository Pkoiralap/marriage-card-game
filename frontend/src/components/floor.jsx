import React from "react";
import Card from "./card";
import '../css/floor.css';

const Floor =({thrownCards, deckCards}) => {
  return (
    <div className='floor'>
       <div className='floorCards'>
        {thrownCards.map((card, index) => (
          <div
          key={index}
          className="card"
          style={{
            position: 'absolute',
            top: `${index * 2}px`,
            left: `${index * 2}px`,
            zIndex: index,
          }}>
            <Card key={index} value={card.value} suit={card.suit}  />
          </div>
        ))}

      </div>
      <div className="Deck">
        {deckCards.map((card, index) => (
          <div
      key={index}
      className="card"
      style={{
        top: `${index * 2}px`,
        left: `${index * 2}px`,
        zIndex: index,
      }}
    >
        <Card key = {index} hidden={true} draggable={false} index={index} />
      </div>
      )
      )}
      </div>
    </div>
  );
}

export default Floor;