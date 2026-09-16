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

- `GET /api/plan`: public typed offer, price, usage and content limits.
- `GET /api/account/quota`: authenticated period snapshot and available balance.
- `GET /api/account/billing`: authenticated offer, checkout and subscription state.
- `POST /api/billing/checkout`: recover or create one idempotent PayPal subscription attempt.
- `POST /api/billing/cancel`: stop future renewals while preserving the paid period.
- `POST /api/billing/webhooks/paypal`: signature-verified PayPal event ingestion.
- `GET /api/marketing/config`: public consent policy and enabled state.
- `POST /api/marketing/visitor-consent|page-view`: bounded anonymous consent/PageView ingestion.
- `GET|PUT /api/account/marketing-consent`: authenticated, versioned measurement choice.
- `GET /api/session`: current verified session.
- `POST /api/session/logout`: revoke the session and its outstanding WS tickets.
- `POST /api/session/ws-ticket`: issue an opaque, short-lived, one-use voice ticket.
- `GET|PUT /api/preferences`: versioned preferences owned by the verified user.
- `GET|POST|DELETE /api/history/writings`: automatic writing history.
- `GET|POST|DELETE /api/history/videos`: explicitly saved transcripts.
- `GET|POST|PUT|DELETE /api/history/notes`: versioned notes with conflict preservation.
- `GET|POST|DELETE /api/history/conversations`: voice conversations and completed turns.
- `PATCH /api/history/turns/{turn_id}/feedback`: attach late feedback without recreating deleted content.
- `POST /api/writing/correct`: up to 1,000 characters; structured correction and Spanish explanations.
- `POST /api/video/transcript`: normalized YouTube URL; ordered English transcript segments.
- `POST /api/speech`: bounded Edge TTS for approved text and voice IDs.
- `WS /api/voice/ws?ticket=…`: protocol v2 after Origin validation and atomic ticket consumption.
- `GET /api/health`: content-free readiness information.

Writing, transcript, speech and voice operations reject anonymous requests. Production
must use `AUTH_MODE=clerk`; the backend verifies Clerk session tokens and never accepts
a client-supplied user identifier. Normal tests use deterministic fakes and never
contact external providers.

Study history stores text and structured feedback only. Voice reconnection can restore
at most the last six complete user/assistant pairs; WAV and MP3 payloads are never stored.

Writing, video and voice reserve quota atomically before calling a provider. Results
settle idempotently; known failures release capacity, uncertain external calls are
quarantined for reconciliation, and provider cost is stored in integer micro-dollars.
The usage ledger contains only financial/consumption metadata; replay payloads remain
in a separate result table. A trial grant is unique per verified account and never
reactivates after its access period ends.

Billing uses `BILLING_MODE=fake` only in development/tests. Sandbox and live modes
require their own PayPal client, webhook, plan and merchant IDs. Browser return URLs
never activate access: only a verified `PAYMENT.SALE.COMPLETED` event or provider
reconciliation creates a monthly period. Webhook IDs and transaction IDs are unique,
and checkout retries reuse a stable `PayPal-Request-Id`. Run the one-shot reconciler
from a scheduler or operator shell with:

```powershell
uv run vslingo-billing-reconcile
```

The normal test suite uses the deterministic fake gateway and never performs a charge.

Meta delivery is independently disabled by default. `MARKETING_MODE=meta_test`
requires a dataset, token and Test Events code; `meta_live` rejects a test code.
Lead and Purchase are inserted in the same SQLite transactions as first registration
and payment, but dispatch happens later and only with current consent. PageView accepts
only public route names and real browser request metadata. The outbox never contains
audio, study text, notes or feedback. Run delivery and the content-free aggregate
operator report separately:

```powershell
uv run vslingo-marketing-dispatch
uv run vslingo-operator-report
```

SQLite puede mantener cambios en el archivo WAL, por lo que una copia directa del
`.db` no es un backup consistente. Crea un destino nuevo mediante la API de backup y
ensaya cada restauración en otro archivo, sin sustituir producción:

```powershell
uv run vslingo-db backup --output C:\backups\ingles-al-grano.db
uv run vslingo-db restore-verify --backup C:\backups\ingles-al-grano.db --target C:\restore-check\ingles-al-grano.db
```

Ambos comandos validan integridad, claves foráneas, migraciones y tablas comerciales.
El procedimiento operativo completo está en [`deploy/launch-runbook.md`](../deploy/launch-runbook.md).

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
