# Inglés al Grano Backend

FastAPI API with typed boundaries for writing, video transcripts, and the voice protocol v2.

## Local setup

```powershell
uv sync --frozen --all-groups
uv run vslingo-api
```

The API listens on `http://127.0.0.1:8000`; health is available at
`GET /api/health`. Provider or identity credentials are not required locally:
development uses an explicit fake bearer session and SQLite on disk.

Copy `.env.example` to `.env` when you need local overrides:

```powershell
Copy-Item .env.example .env
```

OpenRouter uses `google/gemini-3.1-flash-lite` for conversation and writing,
and `openai/whisper-large-v3-turbo` for speech-to-text. Remote speech uses Edge
TTS with an allowlisted English voice. Browser speech synthesis is a frontend
fallback and needs no backend secret.

## Endpoints in the current increment

- `GET /api/session`: current verified session.
- `POST /api/session/logout`: revoke the session and its outstanding WS tickets.
- `POST /api/session/ws-ticket`: issue an opaque, short-lived, one-use voice ticket.
- `GET|PUT /api/preferences`: versioned preferences owned by the verified user.
- `POST /api/writing/correct`: up to 1,000 characters; structured correction and Spanish explanations.
- `POST /api/video/transcript`: normalized YouTube URL; ordered English transcript segments.
- `POST /api/speech`: bounded Edge TTS for approved text and voice IDs.
- `WS /api/voice/ws?ticket=…`: protocol v2 after Origin validation and atomic ticket consumption.
- `GET /api/health`: content-free readiness information.

Writing, transcript, speech and voice operations reject anonymous requests. Production
must use `AUTH_MODE=clerk`; the backend verifies Clerk session tokens and never accepts
a client-supplied user identifier. Normal tests use deterministic fakes and never
contact external providers.

## Quality checks

```powershell
uv lock --check
uv run ruff check app tests
uv run mypy
uv run pytest
```

## Explicit live smokes

Only run a smoke after authorization, credentials, and a cost limit are confirmed:

```powershell
uv run vslingo-smoke openrouter-stt --audio .\path\to\short-sample.wav
uv run vslingo-smoke openrouter-chat
uv run vslingo-smoke edge-tts
```

The CLI reports normalized status only; it does not print prompts, transcripts,
audio, or secrets.
