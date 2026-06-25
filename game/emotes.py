"""Server-side allowlists for emotes & quick-chat (shared by humans and AI).

Kept as a plain module (no Django imports) so it can be imported anywhere,
including the rules/AI layer. Filled in by the gesture (F1) and chat (F2) agents.
"""

# F1 (gestures): list of allowed gesture name strings. Must match the gestures
# implemented in static/js/engine/Avatar.js (_applyGesture).
GESTURES = [
    # F1: must stay in sync with Avatar._applyGesture in
    # static/js/engine/Avatar.js (one entry per implemented gesture).
    "wave", "nod", "shake", "jump", "celebrate",
    "cry", "think", "point", "clap", "facepalm", "shrug",
]

# F2 (chat): allowed quick-chat phrases. Each entry: {"id", "text", optional "gesture"}.
CHAT_PHRASES = [
    # e.g. {"id": "ohno", "text": "Oh no!", "gesture": "facepalm"},
]


def is_valid_gesture(name):
    return name in GESTURES


def chat_phrase(phrase_id):
    """Return the phrase dict for an id, or None if not allowed."""
    return next((p for p in CHAT_PHRASES if p.get("id") == phrase_id), None)
