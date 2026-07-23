"""Tests for bounded atomic conversation history (T06)."""

from app.domain.history import ConversationHistory


def test_history_initial_state_is_empty() -> None:
    history = ConversationHistory()
    assert history.get_messages() == []


def test_history_atomic_turn_addition() -> None:
    history = ConversationHistory()
    history.add_completed_turn("Hello!", "Hi there! How can I help you today?")
    messages = history.get_messages()

    assert len(messages) == 2
    assert messages[0].role == "user"
    assert messages[0].content == "Hello!"
    assert messages[1].role == "assistant"
    assert messages[1].content == "Hi there! How can I help you today?"


def test_history_max_pairs_limit_enforced_by_pruning_pairs() -> None:
    history = ConversationHistory()
    for i in range(1, 8):  # Add 7 pairs
        history.add_completed_turn(f"User message {i}", f"Assistant message {i}")

    messages = history.get_messages()
    # Should keep only 6 pairs (12 messages)
    assert len(messages) == 12
    assert messages[0].role == "user"
    assert messages[0].content == "User message 2"
    assert messages[1].role == "assistant"
    assert messages[1].content == "Assistant message 2"
    assert messages[-2].content == "User message 7"
    assert messages[-1].content == "Assistant message 7"


def test_history_character_limit_prunes_oldest_pairs() -> None:
    history = ConversationHistory()

    # Add 4 long turns (~3,500 chars per turn)
    long_user = "U" * 1500
    long_assistant = "A" * 2000

    for _ in range(4):
        history.add_completed_turn(long_user, long_assistant)

    messages = history.get_messages()

    total_chars = sum(len(m.content) for m in messages)
    assert total_chars <= 12_000
    # Must remain even number of messages (pairs)
    assert len(messages) % 2 == 0
    assert len(messages) >= 2


def test_history_clear() -> None:
    history = ConversationHistory()
    history.add_completed_turn("User", "Assistant")
    assert len(history.get_messages()) == 2

    history.clear()
    assert history.get_messages() == []
