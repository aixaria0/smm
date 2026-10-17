import { normalizeBeliefGraph, compileBeliefQubo } from '../src/epistemic.js';
import { solveEpistemicQubo } from '../src/quantum.js';

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeCase(seed, n = 8) {
  const random = rng(seed);
  const claims = Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    statement: `Synthetic claim ${i + 1}`,
    confidence: 0.45 + 0.5 * random(),
    evidence: 0.2 + 0.75 * random(),
    independence: 0.25 + 0.7 * random(),
    requires: [],
    conflicts: []
  }));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const draw = random();
      if (draw < 0.12) claims[i].conflicts.push(claims[j].id);
      else if (draw < 0.19 && j < i + 4) claims[j].requires.push(claims[i].id);
    }
  }
  return normalizeBeliefGraph({ claims });
}

const cases = Number(process.argv[2] || 24);
let qaoaOptimal = 0;
let qaoaAccepted = 0;
let qaoaBeatsGreedy = 0;
let gapSum = 0;
let greedyGapSum = 0;
for (let seed = 1; seed <= cases; seed += 1) {
  const graph = makeCase(seed);
  const problem = compileBeliefQubo(graph);
  const report = solveEpistemicQubo(graph, problem, {
    gammaSteps: 10,
    betaSteps: 8,
    searchPoints: 96,
    acceptanceTolerance: 0.05
  });
  const gap = report.optimalityGap ?? 0;
  const greedyGap = report.greedy.energy - report.exact.energy;
  if (Math.abs(gap) < 1e-9) qaoaOptimal += 1;
  if (report.acceptedQuantumCandidate) qaoaAccepted += 1;
  if (report.qaoaVsGreedyDelta > 1e-9) qaoaBeatsGreedy += 1;
  gapSum += gap;
  greedyGapSum += greedyGap;
}

console.log(JSON.stringify({
  schema: 'smm-q/benchmark-v1',
  cases,
  qaoaOptimal,
  qaoaAccepted,
  qaoaBeatsGreedy,
  meanQaoaOptimalityGap: gapSum / cases,
  meanGreedyOptimalityGap: greedyGapSum / cases,
  note: 'Synthetic deterministic benchmark; statevector simulation is classical and does not establish quantum advantage.'
}, null, 2));
