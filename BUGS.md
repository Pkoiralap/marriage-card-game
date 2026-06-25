Bug1: the user hand cards position change is not being registered in the backend, thus when fetchign a new card or throwing a new card, the positions are all brought back to original. The intended behaviour is for the user hand to preserve the order that the user sets.

Bug2: When validating sequence, upon each validation the cards are moved to the box. Instead, it should highlight the validated sequences. And once all three sequences are validated, it should move all the validated sequences to the box. If the user cancels mid way, all highlighted sequences are unhighlighted and normal play is to resume.

Bug3: When asking player to pick the maal card, players should be able to pick a top to bottom slider that correspond to the card in the deck top to bottom. This card is not visible to the user and is only made visible after selection has been confirmed. Right now its showing all the cards and asking user to pick one.

Bug4: After sequences are shown and user has seen the maal card, the game goes into phase 2, maal_revealed or something similar must be set to signify this. And in this state instead of showing show sequences, user should be shown Claim Game. This phase works similar to the select sequence phase, user can select 3-5 cards and validate sequence, upon successful validation, the sequences are highlighted and popped up. If everything is validated, and the user only has one card left unselected, the user can claim game. This will obviously have to be implemented in the backend, but for now, just send true from the backend.

Bug5: The show sequence option is only available to the user in case the user has picked the card, shown the sequence, and will be shown to user once they throw a card. If the user has yet to pick a card, the user can not show sequence, expect for the first round exeption to the rule.

FIRST ROUND EXCEPTION: If this is the very first round of the game for the user, the user can:
1. show sequence 
2. show tunnela - only available during the first round, not available after that, add appropriate backend verifier, but for now just return true
3. show dublee - 7 or 8 dublees can be shown, the dublee validation works similarly to the sequence validation. If user validates 7 dublee, user can either see/pick maal card, or show one more dublee to claim game.

Dublee game:
If a user has picked the dublee play, and shown 7 dublees to either see or pick the maal card, to claim the game user only needs to validate one dublee. This has to be done after the user picks a card, without picking this option is not available.

