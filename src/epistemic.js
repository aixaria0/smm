import { clamp, sha256, stableStringify } from './utils.js';

const MAX_CLAIMS = 12;

function cleanId(value, fallback) {
  const id = String(value ?? '').trim().replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 80);
  return id || fallback;
}

function cleanRefs(value) {
  return Array.isArray(value) ? [...new Set(value.map((v) => String(v).trim()).filter(Boolean))].slice(0, 24) : [];
}

export function normalizeBeliefGraph(input, { maxClaims = MAX_CLAIMS } = {}) {
  const raw = Array.isArray(input) ? input : input?.claims;
  if (!Array.isArray(raw)) return { claims: [], digest: sha256('[]') };
  const claims = [];
  const used = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const statement = String(item.statement ?? '').trim().replace(/\s+/g, ' ').slice(0, 1000);
    if (!statement) continue;
    let claimId = cleanId(item.id, `c${claims.length + 1}`);
    while (used.has(claimId)) claimId = `${claimId}-${claims.length + 1}`;
    used.add(claimId);
    const confidence = clamp(Number(item.confidence) || 0.5, 0, 1);
    const evidence = clamp(Number(item.evidence ?? item.evidence_score) || 0, 0, 1);
    const independence = clamp(Number(item.independence) || 0.5, 0, 1);
    const utility = clamp(confidence * (0.30 + 0.55 * evidence + 0.15 * independence), 0, 1);
    claims.push({
      id: claimId,
      statement,
      confidence,
      evidence,
      independence,
      utility,
      sourceRoles: cleanRefs(item.source_roles ?? item.sourceRoles),
      requires: cleanRefs(item.requires),
      conflicts: cleanRefs(item.conflicts),
      falsifier: String(item.falsifier ?? '').trim().slice(0, 800)
    });
    if (claims.length >= maxClaims) break;
  }
  const ids = new Set(claims.map((c) => c.id));
  for (const claim of claims) {
    claim.requires = claim.requires.filter((ref) => ref !== claim.id && ids.has(ref));
    claim.conflicts = claim.conflicts.filter((ref) => ref !== claim.id && ids.has(ref));
  }
  const byId = new Map(claims.map((c) => [c.id, c]));
  for (const claim of claims) {
    for (const otherId of claim.conflicts) {
      const other = byId.get(otherId);
      if (other && !other.conflicts.includes(claim.id)) other.conflicts.push(claim.id);
    }
  }
  claims.sort((a, b) => a.id.localeCompare(b.id));
  return { claims, digest: sha256(stableStringify(claims)) };
}

export function compileBeliefQubo(graph, {
  conflictPenalty = 2.5,
  dependencyPenalty = 1.8,
  sparsityPenalty = 0.025
} = {}) {
  const claims = graph?.claims ?? [];
  const index = new Map(claims.map((c, i) => [c.id, i]));
  const linear = claims.map((claim) => -claim.utility + sparsityPenalty);
  const quadratic = new Map();
  const addQ = (a, b, value) => {
    if (a === b) { linear[a] += value; return; }
    const i = Math.min(a, b), j = Math.max(a, b), key = `${i}:${j}`;
    quadratic.set(key, (quadratic.get(key) || 0) + value);
  };
  const seenConflicts = new Set();
  for (const claim of claims) {
    const i = index.get(claim.id);
    for (const conflict of claim.conflicts) {
      const j = index.get(conflict);
      if (j === undefined) continue;
      const key = [Math.min(i, j), Math.max(i, j)].join(':');
      if (seenConflicts.has(key)) continue;
      seenConflicts.add(key);
      addQ(i, j, conflictPenalty);
    }
    for (const requirement of claim.requires) {
      const j = index.get(requirement);
      if (j === undefined) continue;
      linear[i] += dependencyPenalty;
      addQ(i, j, -dependencyPenalty);
    }
  }
  const pairs = [...quadratic.entries()].map(([key, value]) => {
    const [i, j] = key.split(':').map(Number);
    return { i, j, value };
  }).sort((a, b) => a.i - b.i || a.j - b.j);
  const problem = {
    schema: 'smm-q/qubo-v1',
    variables: claims.map((claim, i) => ({ index: i, claimId: claim.id, utility: claim.utility })),
    linear,
    quadratic: pairs,
    constant: 0,
    penalties: { conflictPenalty, dependencyPenalty, sparsityPenalty }
  };
  problem.digest = sha256(stableStringify(problem));
  return problem;
}

export function bitsFromMask(mask, count) {
  return Array.from({ length: count }, (_, i) => (mask >>> i) & 1);
}

export function energyOf(problem, bits) {
  let energy = Number(problem.constant || 0);
  for (let i = 0; i < problem.linear.length; i += 1) energy += problem.linear[i] * (bits[i] ? 1 : 0);
  for (const term of problem.quadratic) energy += term.value * (bits[term.i] ? 1 : 0) * (bits[term.j] ? 1 : 0);
  return energy;
}

export function exactSolveQubo(problem) {
  const n = problem.variables.length;
  if (n > 22) throw new RangeError('exact QUBO solver is limited to 22 variables');
  let bestEnergy = Infinity, bestMask = 0;
  const total = 1 << n;
  for (let mask = 0; mask < total; mask += 1) {
    const bits = bitsFromMask(mask, n);
    const energy = energyOf(problem, bits);
    if (energy < bestEnergy - 1e-12) { bestEnergy = energy; bestMask = mask; }
  }
  const bits = bitsFromMask(bestMask, n);
  return {
    backend: 'classical-exact',
    bits,
    energy: bestEnergy,
    selected: problem.variables.filter((_, i) => bits[i]).map((v) => v.claimId)
  };
}

export function greedySolveQubo(problem) {
  const n = problem.variables.length;
  let bits = Array(n).fill(0);
  let energy = energyOf(problem, bits);
  let changed = true;
  while (changed) {
    changed = false;
    let nextEnergy = energy, nextIndex = -1;
    for (let i = 0; i < n; i += 1) {
      if (bits[i]) continue;
      const candidate = [...bits]; candidate[i] = 1;
      const e = energyOf(problem, candidate);
      if (e < nextEnergy - 1e-12) { nextEnergy = e; nextIndex = i; }
    }
    if (nextIndex >= 0) { bits[nextIndex] = 1; energy = nextEnergy; changed = true; }
  }
  return { backend: 'classical-greedy', bits, energy, selected: problem.variables.filter((_, i) => bits[i]).map((v) => v.claimId) };
}

export function verifyBeliefSelection(graph, selectedIds) {
  const selected = new Set(selectedIds || []);
  const byId = new Map((graph?.claims || []).map((claim) => [claim.id, claim]));
  const conflicts = [], missingDependencies = [];
  for (const id of selected) {
    const claim = byId.get(id);
    if (!claim) continue;
    for (const other of claim.conflicts) if (selected.has(other) && id < other) conflicts.push([id, other]);
    for (const requirement of claim.requires) if (!selected.has(requirement)) missingDependencies.push([id, requirement]);
  }
  return { ok: conflicts.length === 0 && missingDependencies.length === 0, conflicts, missingDependencies };
}

export function compileToIsing(problem) {
  const n = problem.variables.length;
  const h = Array(n).fill(0);
  let offset = Number(problem.constant || 0);
  for (let i = 0; i < n; i += 1) {
    const value = problem.linear[i];
    offset += value / 2;
    h[i] -= value / 2;
  }
  const couplings = [];
  for (const term of problem.quadratic) {
    offset += term.value / 4;
    h[term.i] -= term.value / 4;
    h[term.j] -= term.value / 4;
    couplings.push({ i: term.i, j: term.j, value: term.value / 4 });
  }
  const ising = { schema: 'smm-q/ising-v1', offset, h, couplings, variables: problem.variables };
  ising.digest = sha256(stableStringify(ising));
  return ising;
}

export function buildQuantumJob(graph, problem) {
  const ising = compileToIsing(problem);
  const job = {
    schema: 'smm-q/epistemic-job-v1',
    graphDigest: graph.digest,
    quboDigest: problem.digest,
    ising,
    semantics: 'selected bit = claim admitted to synthesis candidate set',
    authority: { physicalQpuExecution: 'UNKNOWN', externalTruth: 'UNKNOWN' }
  };
  job.digest = sha256(stableStringify(job));
  return job;
}
