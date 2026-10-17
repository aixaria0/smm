# SMM-Q — Quantum Epistemic Mesh

SMM-Q connects the cognitive mesh to a bounded quantum-optimization layer. The quantum layer does not answer the user directly and it does not turn model output into truth. Its job is narrower: select a mutually consistent, evidence-weighted subset of atomic claims before final verification and synthesis.

## Pipeline

```text
request
  -> task-sensitive cognitive views
  -> epistemic compiler
  -> atomic claim graph
  -> QUBO
  -> Ising representation
  -> QAOA candidate
  -> classical validity + baseline checks
  -> verifier
  -> synthesis
```

Each claim carries a confidence estimate, explicit-evidence score, independence estimate, dependencies, conflicts and a falsifier. Claims are capped at 8 in balanced mode and 12 in deep mode so the local statevector path stays bounded.

## QUBO semantics

One binary variable represents one claim. `1` means the claim is admitted to the candidate synthesis set.

The objective rewards high-utility claims and penalizes:

- mutually conflicting claims selected together;
- a claim selected without its declared dependency;
- unnecessary claim count through a small sparsity term.

Claim utility combines confidence, explicit evidence and independent support. The QUBO is deterministically transformed to an Ising form, producing a content-addressed `smm-q/epistemic-job-v1` artifact.

## Quantum path

The current built-in backend is a dependency-free classical statevector simulation of QAOA with depth up to `p=2`.

Parameter search combines:

1. a deterministic `p=1` grid;
2. a `p=2` low-discrepancy search;
3. deterministic coordinate refinement.

The simulator is deliberately labeled `qaoa-statevector-*`. It is not evidence of physical QPU execution.

The exported Ising job is the boundary intended for a future managed-QPU adapter. `Quantum001` already provides a separate Amazon Braket execution/evidence path; SMM-Q does not currently claim that this repository executed the epistemic job on that path.

## Guardrail: quantum cannot silently degrade reasoning

Every bounded problem is also evaluated by classical baselines:

- greedy selection;
- exact enumeration while the problem is small enough.

A QAOA candidate is admitted only when:

- its selected claim set passes dependency/conflict validation;
- it is not worse than the greedy baseline;
- when exact reference is available, its optimality gap is within the configured tolerance.

Otherwise SMM-Q falls back to the exact classical selection. The trace records the QAOA candidate, exact result, greedy result, optimality gap, QAOA-vs-greedy delta, chosen backend and the trust boundary.

This rule is intentional. The architecture is quantum-capable without granting the word `quantum` authority over answer quality.

## Reproducible benchmark

```bash
npm run benchmark:quantum
```

The benchmark generates deterministic synthetic claim graphs and compares QAOA, greedy and exact solutions. It exists to falsify performance claims, not manufacture an advantage result.

A better QAOA result on this benchmark would still not establish quantum advantage: the current QAOA backend is a classical simulation, the problem set is synthetic, and exact enumeration is feasible at this scale.

## Operational trace

Balanced/deep traces add:

- epistemic graph digest;
- QUBO digest;
- quantum-job digest;
- QAOA backend and candidate energy;
- exact energy when available;
- optimality gap;
- QAOA-vs-greedy delta;
- whether the quantum candidate was accepted;
- final selected claim IDs.

The existing hash-chained SMM ledger binds those records into the execution trace. Ledger integrity proves ordering/integrity of recorded metadata, not factual correctness of the claims.

## Donor lineage

The design was informed by primitives already present in the wider Aix repository set:

- `Quantum001`: bounded statevector execution, replay, evidence journals and a Braket boundary;
- `vqe-analyzer`: Hamiltonian/QUBO-style optimization, deterministic statevector work and adaptive search ideas;
- `Omni`: separation of browser quantum evidence, hybrid certificates and managed execution;
- `qt`: typed translation boundary between natural-language intent and quantum state mutation;
- `CHIMERA-OMEGA`: explicit evidence/claim separation and non-promotion of unknown dimensions;
- `strategic-intelligence-lattice`: compute-allocation experiments and baseline-first falsification discipline.

SMM-Q copies no authority from those projects. Each boundary must be established in this runtime on its own evidence.

## Explicit non-claims

SMM-Q v1 does **not** claim:

- quantum advantage;
- physical QPU execution;
- that optimized claims are true;
- that confidence scores are calibrated probabilities;
- that the current claim compiler is formally verified;
- that a quantum solution replaces the final verifier;
- that this architecture is the first AI/quantum system in the world.

Novelty must be assessed against prior art separately. The implementation is structured so such claims can be tested rather than assumed.
