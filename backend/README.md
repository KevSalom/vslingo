# VSLingo Backend

FastAPI API with typed provider boundaries and the Writing Studio correction vertical for the VSLingo Public Alpha.

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

Set `OPENROUTER_API_KEY` and `OPENROUTER_LLM_MODEL` only when a live Writing
request or OpenRouter smoke is explicitly authorized and has a known cost
limit. The selected model must support Structured Outputs. Without those
values, startup and health still work, while Writing returns a safe typed 503.
Keep AWS credentials empty until an authorized Polly smoke; `EDGE_TTS_VOICE`
has a safe default and requires no Azure SDK credential.

## Writing endpoint

`POST /api/writing/correct` accepts up to 1000 characters and returns a typed
correction with categorized changes and Spanish feedback. With authorized
OpenRouter values in `.env`, try it from another PowerShell terminal:

```powershell
$body = @{ text = "Yesterday I deploy the API and the tests was passing." } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/writing/correct -ContentType "application/json" -Body $body
```

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
