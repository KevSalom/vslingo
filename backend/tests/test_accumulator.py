"""Unit tests for SentenceAccumulator."""

from app.voice.accumulator import SentenceAccumulator


def test_sentence_accumulator_basic_punctuation() -> None:
    acc = SentenceAccumulator()
    res1 = acc.feed("Hello world. ")
    assert res1 == ["Hello world."]

    res2 = acc.feed("How are you? I'm fine!")
    assert res2 == ["How are you?"]

    res3 = acc.flush()
    assert res3 == ["I'm fine!"]


def test_sentence_accumulator_abbreviations_and_decimals() -> None:
    acc = SentenceAccumulator()
    # "Mr. " shouldn't cut. "Smith. " cuts. "3.14" shouldn't cut. "dollars. " cuts.
    res1 = acc.feed("Hello Mr. Smith. The value is 3.14 dollars. Done!")
    assert res1 == ["Hello Mr. Smith.", "The value is 3.14 dollars."]
    res_final = acc.flush()
    assert res_final == ["Done!"]


def test_sentence_accumulator_length_limit() -> None:
    acc = SentenceAccumulator()
    long_text = "word " * 60  # 300 chars without punctuation
    res = acc.feed(long_text)
    assert len(res) >= 1
    assert len(res[0]) <= 240



def test_sentence_accumulator_waits_until_buffer_exceeds_240() -> None:
    acc = SentenceAccumulator()
    assert acc.feed("x" * 240) == []
    assert acc.feed("y") == ["x" * 240]
    assert acc.flush() == ["y"]


def test_sentence_accumulator_forces_cut_before_late_punctuation() -> None:
    acc = SentenceAccumulator()
    result = acc.feed(("a" * 245) + ". ")
    assert result == ["a" * 240, ("a" * 5) + "."]
    assert acc.flush() == []


def test_sentence_accumulator_uses_unicode_whitespace_for_forced_cut() -> None:
    acc = SentenceAccumulator()
    result = acc.feed(("a" * 180) + "\u2003" + ("b" * 70))
    assert result == ["a" * 180]
    assert acc.flush() == ["b" * 70]
