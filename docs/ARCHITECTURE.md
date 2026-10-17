# SMM architecture

## 1. Substrate vs. mind

SMM deliberately separates **inference substrate** from **cognitive runtime**. The substrate is any model server that can answer OpenAI-compatible chat-completion requests. SMM owns the durable state and orchestration semantics above it.

This separation has three consequences:

1. Model replacement does not erase memory, API compatibility, trace semantics or role topology.
2. A smaller local model can be wrapped with stronger process discipline without pretending the process makes the model omniscient.
3. The system can later use heterogeneous providers per role without changing callers.

## 2. Request lifecycle

### Intent gate

A deterministic local classifier maps the request to `engineering`, `research`, `creative`, `strategy` or `general`. It does not consume model tokens and only selects the initial role topology.

### Memory recall

Persistent memory uses a bounded score:

```text
score = 0.66 lexical_similarity
      + 0.18 recency
      + 0.12 salience
      + 0.04 prior_access
```

This is intentionally inspectable and deterministic. It can be replaced later by an embedding retriever without changing the memory interface.

### Cognitive mesh

The selected role set runs concurrently. Each node receives the same request/context but a different operating objective. Nodes are instructed to return conclusions and supporting points, not private chain-of-thought.

Balanced engineering example:

```text
implementer ─┐
reviewer ────┼─▶ verifier ─▶ synthesis
 tester ─────┘
```

A failed node becomes an explicit failed view; surviving nodes may continue.

### Verification

The verifier sees the original request and candidate outputs and returns a machine-readable calibration object:

```json
{
  "confidence": 0.0,
  "risks": [],
  "agreements": [],
  "required_corrections": []
}
```

This is a second model judgment, not a mathematical correctness proof. Confidence is therefore a calibrated system signal, not a probability guarantee.

### Synthesis

The final synthesis stage is instructed to reconcile the candidate views and apply required corrections. Internal role names are not surfaced unless the caller uses the rich trace endpoint.

## 3. State model

There are two persistent state channels:

- **Memory log** — user/application state that can be recalled into later prompts.
- **Trace ledger** — operational metadata about each mesh execution.

Both are JSONL for inspectability and crash tolerance. Memory is event-sourced (`put`, `delete`, `clear`).

## 4. Ledger integrity

Every event contains `prevHash` and its own `hash`. On startup/health checks SMM can recompute the chain and detect mutation/reordering.

The ledger intentionally stores hashes and operational metadata rather than full model outputs. This lowers accidental disclosure while still binding the execution topology to specific result digests.

## 5. Failure model

SMM distinguishes:

- provider unavailable → request fails with 503-style provider error
- one mesh node unavailable → remaining views continue
- verifier unavailable → synthesis continues with an explicit verifier risk marker
- corrupt ledger → health becomes degraded
- malformed input → 4xx without contacting the provider
- oversized input → 413 before JSON parse/model invocation

## 6. Extension points

The current interfaces are intentionally narrow:

- `provider.complete()` / `provider.models()` / `provider.health()`
- `memory.remember()` / `memory.recall()`
- `ledger.record()` / `ledger.verify()`
- `mesh.think()`

Future substrate ensembles, vector retrieval, tool execution, signed traces, multimodal inputs or distributed state can attach at those boundaries without rewriting callers.
