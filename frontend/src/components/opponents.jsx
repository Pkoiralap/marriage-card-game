import React from "react";
import Card from "./card";

const Opponents = ({number, name, cards}) => {
  return (
    <div className={`opponent ${number}`}>
      {cards.map((card, index) => (
        <Card key = {index} hidden={true} draggable={false} index={index} />
      )
      )}
    <div className="Name">{name}</div>
    </div>
  );
};

export default Opponents;
