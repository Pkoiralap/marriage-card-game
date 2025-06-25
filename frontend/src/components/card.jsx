import React, {useRef} from 'react';
import {useDrag, useDrop} from 'react-dnd';
import '../css/card.css'

const ItemTypes = {CARD:'card'};

const Card = ({index, value, suit, hidden, moveCard, draggable, fromHand = false}) => {
  const id = index;
  const ref = useRef(null);

  const [,drop] = useDrop({
    accept: ItemTypes.CARD,
    hover(item) {
      if (!ref.current || !draggable || !moveCard || !item.fromHand || !fromHand) return;

      const dragIndex = item.index;
      const hoverIndex = index;
      if (dragIndex === hoverIndex) return;

      moveCard(dragIndex, hoverIndex);
      item.index = hoverIndex;
    },
  })

  const [{ isDragging }, drag] = useDrag({
    type: ItemTypes.CARD,
    item: { id, index, value,suit, fromHand },
    canDrag: () => draggable,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  if (draggable) drag(drop(ref));
  else drop(ref);

  return (
  <div className="card" 
    ref = {ref} 
    style = {{
      opacity: isDragging? 0.5 : 1,
      cursor: draggable?'move':'default',

    }}
  >
    {hidden ? <div className="card-back"></div> : `${value}${suit}`}
  </div>
  );
};

export default Card