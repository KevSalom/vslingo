"""Conversation history management per session (T06)."""

from app.domain.models import ChatMessage


class ConversationHistory:
    """Manages bounded, atomic conversation history per session.

    Limits:
    - Maximum 6 pairs (12 messages).
    - Maximum 12,000 total characters.
    - Atomic incorporation of (user, assistant) pair only on completion.
    - Always prunes in full (user, assistant) pairs from the oldest end.
    """

    MAX_PAIRS: int = 6
    MAX_MESSAGES: int = 12
    MAX_CHARACTERS: int = 12_000

    def __init__(self) -> None:
        self._history: list[ChatMessage] = []

    def clear(self) -> None:
        """Clear all conversation history."""
        self._history.clear()

    def get_messages(self) -> list[ChatMessage]:
        """Return a copy of current completed history messages."""
        return list(self._history)

    def add_completed_turn(self, user_text: str, assistant_text: str) -> None:
        """Atomically incorporate a completed (user, assistant) turn pair into history."""
        user_msg = ChatMessage(role="user", content=user_text.strip())
        assistant_msg = ChatMessage(role="assistant", content=assistant_text.strip())

        self._history.append(user_msg)
        self._history.append(assistant_msg)
        self._enforce_limits()

    def _enforce_limits(self) -> None:
        """Prune oldest complete pairs until count and character limits are satisfied."""
        while len(self._history) > self.MAX_MESSAGES:
            # Remove oldest pair (index 0 and 1)
            self._history.pop(0)
            if self._history:
                self._history.pop(0)

        while self._total_chars() > self.MAX_CHARACTERS and len(self._history) >= 2:
            self._history.pop(0)
            self._history.pop(0)

    def _total_chars(self) -> int:
        return sum(len(msg.content) for msg in self._history)
