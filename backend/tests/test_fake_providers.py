from app.domain.models import ChatMessage
from app.providers.fakes import FakeLanguageModel, FakeSpeechSynthesizer, FakeSpeechToText


async def test_fake_providers_complete_a_deterministic_round_trip() -> None:
    stt = FakeSpeechToText()
    llm = FakeLanguageModel(chunks=("Clear ", "and concise."))
    tts = FakeSpeechSynthesizer()

    transcript = await stt.transcribe(b"fake-wave", media_type="audio/wav")
    chunks = [
        chunk
        async for chunk in llm.stream_chat(
            [ChatMessage(role="user", content=transcript.text)]
        )
    ]
    speech = await tts.synthesize("".join(chunks))

    assert transcript.text == "This is a deterministic transcript."
    assert chunks == ["Clear ", "and concise."]
    assert speech.media_type == "audio/mpeg"
    assert speech.audio.startswith(b"ID3")
