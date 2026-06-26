export const CARD_WIDTH = 4.0;
export const CARD_HEIGHT = 5.6;
export const CARD_THICKNESS = 0.02;
export const FAN_RADIUS = 60;
export const FAN_SPACING = 1.3;   // bug 1: tighter spacing to match smaller hand cards
export const DEPTH_STEP = 0.1;
export const TABLE_RADIUS = 15;
export const OPPONENT_TABLE_RADIUS = 18;
// export const HAND_CENTER_POS = new THREE.Vector3(13, 2, 16);   // bug1: nearer the player
export const HAND_CENTER_POS = new THREE.Vector3(15, 2, 16);   // bug1: nearer the player
export const DECK_POS = new THREE.Vector3(-3, 0.5, 0);
export const CHOICE_POS = new THREE.Vector3(3, 0.5, 2);
// bug1 follow-up: the hand moved out to HAND_CENTER_POS (15,16), ~19 units from
// the choice pile at (3,2) (was ~12). A radius-12 drop zone no longer reached
// from the hand, so throws fell through to "reorder" and snapped back. Widen the
// zone so a normal drag toward the table centre registers as a discard, while
// still clearing the nearest fanned hand card (~19 units out).
export const DISCARD_ZONE_RADIUS = 15;

