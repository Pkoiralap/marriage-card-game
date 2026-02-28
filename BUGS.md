Bug1: when adjecent cards are switched. say for instance pos10,pos11 are switched to pos11,pos10, upon discarding pos11 card in quick succession, the discard removes the pos10 card. This must have to do something with the positioning of the cards not being updated.

Bug2: when throwing and picking cards between human and AI, the picked card appears in the ground and only vanishes after the pickup has been completed by the ai

Bug3: when throwing and picking cards between human and AI, the picked card changes state after one and another pickup
Bug2 and bug3 seem to be related to how states are not being synchronized between each pickup and throw