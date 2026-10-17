# SMM protocol

## `POST /v1/mind/think`

Request:

```json
{
  "messages": [{"role":"user","content":"..."}],
  "mode": "balanced",
  "remember": true,
  "trace": true
}
```

`mode` is one of `fast`, `balanced`, `deep`.

Response fields:

- `answer`: synthesized user-facing response
- `confidence`: verifier calibration clamped to `[0.05, 0.98]`
- `intent`: deterministic task class
- `memory.recalled`: number of memory records supplied to the mesh
- `trace.id`: execution trace identifier
- `trace.head`: hash of final ledger event
- `trace.views`: role/result digests; no hidden chain-of-thought
- `trace.verification`: risk/correction summary
- `metrics.durationMs`: wall-clock orchestration latency

## `POST /v1/chat/completions`

Implements the common non-tooling subset of the OpenAI chat-completions shape. SMM-specific metadata is returned under `smm`.

When `stream=true`, SMM emits SSE `chat.completion.chunk` objects followed by `data: [DONE]`.

## `GET /health`

Returns provider reachability and ledger integrity. HTTP 503 indicates inference substrate unavailability.

## Memory API

`GET /v1/memory?limit=100` lists recent memory records.

`DELETE /v1/memory` appends a clear event and removes active memory state.
