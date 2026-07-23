# VSLingo Backend

FastAPI walking skeleton and provider boundaries for the VSLingo Public Alpha.

## Local setup

```powershell
uv sync --frozen --all-groups
uv run vslingo-api
```

The API listens on `http://127.0.0.1:8000`; health is available at
`GET /api/health`. Optional provider credentials are not required for startup
or health.

## Environment placeholders

Copy `.env.example` to `.env` once; the local file is ignored by Git and is
already prepared with empty, safe placeholders for OpenRouter and AWS:

```powershell
Copy-Item .env.example .env
```

Keep `OPENROUTER_API_KEY`, `OPENROUTER_LLM_MODEL`, `AWS_ACCESS_KEY_ID`, and
`AWS_SECRET_ACCESS_KEY` empty until a live smoke has explicit authorization,
credentials, and a known cost limit. `EDGE_TTS_VOICE` has a safe default and
requires no Azure SDK credential.

## Quality checks

```powershell
uv lock --check
uv run ruff check app tests
uv run mypy
uv run pytest
```

The normal test suite uses deterministic STT, LLM, and TTS fakes and never
calls remote or paid providers.

## Live provider smokes

Live checks are explicit and isolated from `pytest`. Run them only after
confirming authorization, credentials, and provider cost limits. Each command
runs exactly one provider check and keeps generated audio in memory.

```powershell
uv run vslingo-smoke openrouter-stt --audio .\path\to\short-sample.wav
uv run vslingo-smoke openrouter-chat
uv run vslingo-smoke aws-polly
uv run vslingo-smoke edge-tts
```

Required configuration:

- OpenRouter STT: `OPENROUTER_API_KEY` and a local WAV sample.
- OpenRouter chat: `OPENROUTER_API_KEY` and `OPENROUTER_LLM_MODEL`.
- AWS Polly: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, region, and voice.
- Microsoft Edge Neural: `EDGE_TTS_VOICE` (no Azure SDK credentials).

The CLI reports only success or a normalized provider/error code. It does not
print transcripts, prompts, audio, or secrets.
