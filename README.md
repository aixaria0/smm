# SMM — Stateful Mind Mesh

SMM is a **model-agnostic AI runtime**. Instead of treating one model response as the product, it treats the model as a replaceable inference substrate and adds a stateful cognitive architecture around it:

- persistent local memory with relevance, recency and salience scoring
- task-sensitive cognitive roles selected from the request itself
- parallel independent views rather than a single first-pass answer
- an adversarial calibration/verification stage
- final synthesis that incorporates corrections and disagreement
- a tamper-evident hash-chained execution ledger
- OpenAI-compatible `/v1/chat/completions`
- a richer `/v1/mind/think` protocol with confidence and trace metadata
- SSE streaming, CLI and browser interface
- no runtime npm dependencies

The result is not a new foundation model. It is a different **AI system architecture**: the intelligence comes from the interaction of replaceable model substrate, explicit state, independent cognitive roles, verification and synthesis.

## Architecture

```text
                       ┌──────────────────────┐
request ──────────────▶│ intent + state gate  │
                       └──────────┬───────────┘
                                  │
                           memory recall
                                  │
             ┌────────────────────┼────────────────────┐
             ▼                    ▼                    ▼
      independent view      independent view     independent view
      (role selected)       (role selected)      (role selected)
             └────────────────────┼────────────────────┘
                                  ▼
                           verifier / judge
                                  │
                         corrections + score
                                  ▼
                              synthesis
                                  │
                  ┌───────────────┴───────────────┐
                  ▼                               ▼
              final answer                hash-chain ledger
                                                  │
                                             memory write
```

SMM does **not** expose hidden chain-of-thought. Its trace is operational: role names, hashes, confidence, verifier findings, timing and ledger integrity.

## Quick start

Requirements: Node.js 20+ and any inference server that implements the OpenAI chat-completions API.

```bash
cp .env.example .env
# export variables from .env using your preferred shell/tool
export SMM_PROVIDER_URL=http://127.0.0.1:11434/v1
export SMM_MODEL=your-model-name   # optional: SMM auto-discovers the first model
npm start
```

Open `http://127.0.0.1:8787`.

For local engines such as Ollama, llama.cpp server, vLLM or LocalAI, point `SMM_PROVIDER_URL` at their OpenAI-compatible `/v1` endpoint. For hosted providers, set the same URL plus `SMM_API_KEY`.

### CLI

```bash
npm run chat
```

Commands: `/mode fast|balanced|deep`, `/memory`, `/clear`, `/quit`.

## Modes

| Mode | Cognitive views | Verification | Use case |
| --- | ---: | --- | --- |
| `fast` | 1 | skipped | low latency |
| `balanced` | 3 | yes | default |
| `deep` | 4 | yes | hard problems / adversarial review |

The role set is dynamic. Engineering requests get implementer/reviewer/tester/system views; research gets analyst/skeptic/methodologist; strategy gets architect/red-team/operator; creative tasks get explorer/editor/audience.

## API

### Rich SMM endpoint

```bash
curl http://127.0.0.1:8787/v1/mind/think \
  -H 'content-type: application/json' \
  -d '{
    "mode":"balanced",
    "messages":[{"role":"user","content":"Design a fault-tolerant queue"}],
    "remember":true,
    "trace":true
  }'
```

Response excerpt:

```json
{
  "object": "smm.response",
  "answer": "...",
  "confidence": 0.87,
  "intent": "engineering",
  "trace": {
    "id": "...",
    "head": "sha256...",
    "views": [
      {"role":"implementer","hash":"...","ok":true},
      {"role":"reviewer","hash":"...","ok":true},
      {"role":"tester","hash":"...","ok":true}
    ]
  }
}
```

### OpenAI-compatible endpoint

Existing clients can point at SMM instead of the raw provider:

```text
POST /v1/chat/completions
GET  /v1/models
```

`stream: true` returns SSE chunks.

### Memory

```text
GET    /v1/memory
DELETE /v1/memory
```

Memory is stored locally under `.smm/` by default and is never sent anywhere except to the inference endpoint you configure as part of the prompt context. Set `SMM_MEMORY_ENABLED=false` to disable persistence.

## Proof-carrying execution ledger

Each operational event is stored as JSONL with:

```text
hash_n = SHA256(hash_(n-1) || canonical(event_n))
```

This gives SMM a tamper-evident history of each trace. It is **not** a proof that an answer is factually correct; it proves only the integrity/order of recorded execution metadata. `GET /health` verifies the chain.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SMM_PROVIDER_URL` | `http://127.0.0.1:11434/v1` | inference endpoint |
| `SMM_MODEL` | auto-discover | provider model id |
| `SMM_API_KEY` | empty | bearer credential |
| `SMM_MODE` | `balanced` | default mesh mode |
| `SMM_HOST` | `127.0.0.1` | listen address |
| `SMM_PORT` | `8787` | listen port |
| `SMM_MEMORY_ENABLED` | `true` | persistent memory |
| `SMM_MEMORY_PATH` | `.smm/memory.jsonl` | memory event log |
| `SMM_LEDGER_PATH` | `.smm/ledger.jsonl` | trace ledger |
| `SMM_MAX_BODY_BYTES` | `1048576` | request limit |
| `SMM_RATE_LIMIT_PER_MINUTE` | `60` | per-IP request cap |
| `SMM_CORS_ORIGIN` | `*` | API CORS origin |

For public deployments, bind behind TLS/reverse proxy, set an explicit `SMM_CORS_ORIGIN`, and add authentication at the proxy or application edge.

## Quality gates

```bash
npm run check
npm test
npm run smoke
```

CI runs all three on Node 20 and Node 22. Tests cover memory persistence/ranking, ledger tamper detection, mesh orchestration, provider protocol behavior, HTTP API behavior and browser asset serving.

## Container

```bash
docker compose up --build
```

The compose file expects the inference substrate on the host by default. Override `SMM_PROVIDER_URL` as needed.

## Model artifact workflow

`.github/workflows/fetch-model.yml` is a manual utility for caching a Hugging Face `.gguf` file as a GitHub Release asset. It validates the host, file name, extension and release-size ceiling before upload. It is separate from the SMM runtime; SMM itself does not require model binaries to live in this repository.

## Design constraints

- no hidden provider lock-in
- no runtime dependency tree
- no claim that self-verification guarantees truth
- no secret values in logs
- memory can be disabled or cleared
- failure of one cognitive view does not automatically fail the whole mesh
- all provider calls have request timeouts
- every response mode stays usable through the same API surface

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`SECURITY.md`](SECURITY.md).
