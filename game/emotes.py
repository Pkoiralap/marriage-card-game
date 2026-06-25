"""Server-side allowlists for emotes & quick-chat (shared by humans and AI).

Kept as a plain module (no Django imports) so it can be imported anywhere,
including the rules/AI layer. Filled in by the gesture (F1) and chat (F2) agents.
"""

# F1 (gestures): list of allowed gesture name strings. Must match the gestures
# implemented in static/js/engine/Avatar.js (_applyGesture).
GESTURES = [
    # e.g. "wave", "nod", "shake", "jump", "celebrate", ...
]

# F2 (chat): allowed quick-chat phrases. Each entry: {"id", "text", optional "gesture"}.
# The optional "gesture" pairs a phrase with an emote so a chat can also play an
# avatar animation. Pairing is best-effort: the client feature-detects whether the
# gesture exists (F1 owns the gesture list in GESTURES), so an unknown gesture is
# simply skipped. AI (F3) may import CHAT_PHRASES / chat_phrase to send lines.
CHAT_PHRASES = [
    {"id": "ohno",      "text": "Oh no!",      "gesture": "shake"},
    {"id": "gotcha",    "text": "Gotcha!",     "gesture": "nod"},
    {"id": "iwin",      "text": "I win!",      "gesture": "celebrate"},
    {"id": "yourturn",  "text": "Your turn"},
    {"id": "nice",      "text": "Nice!",       "gesture": "nod"},
    {"id": "soclose",   "text": "So close"},
    {"id": "wellplayed","text": "Well played", "gesture": "nod"},
    {"id": "hurryup",   "text": "Hurry up!",   "gesture": "shake"},
    {"id": "oops",      "text": "Oops"},
    {"id": "gg",        "text": "GG",          "gesture": "wave"},
    {"id": "hello",     "text": "Hello!",      "gesture": "wave"},
    {"id": "thanks",    "text": "Thanks!",     "gesture": "nod"},
]


def is_valid_gesture(name):
    return name in GESTURES


def chat_phrase(phrase_id):
    """Return the phrase dict for an id, or None if not allowed."""
    return next((p for p in CHAT_PHRASES if p.get("id") == phrase_id), None)
