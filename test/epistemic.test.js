import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBeliefGraph, compileBeliefQubo, exactSolveQubo, verifyBeliefSelection, compileToIsing, energyOf } from '../src/epistemic.js';
import { qaoaSolve, solveEpistemicQubo } from '../src/quantum.js';

const graph = normalizeBeliefGraph({ claims: [
  { id: 'c1', statement: 'A is supported', confidence: 0.95, evidence: 0.95, independence: 0.8, conflicts: ['c2'] },
  { id: 'c2', statement: 'Not A', confidence: 0.7, evidence: 0.4, independence: 0.6, conflicts: ['c1'] },
  { id: 'c3', statement: 'B depends on A', confidence: 0.9, evidence: 0.8, independence: 0.7, requires: ['c1'] }
]});

test('belief graph normalizes conflicts and compiles a deterministic QUBO', () => {
  assert.equal(graph.claims.length, 3);
  assert.ok(graph.claims.find((c) => c.id === 'c2').conflicts.includes('c1'));
  const a = compileBeliefQubo(graph), b = compileBeliefQubo(graph);
  assert.equal(a.digest, b.digest);
  assert.equal(a.variables.length, 3);
});

test('exact solver selects consistent evidence-weighted beliefs', () => {
  const problem = compileBeliefQubo(graph);
  const exact = exactSolveQubo(problem);
  assert.deepEqual(exact.selected.sort(), ['c1', 'c3']);
  assert.equal(verifyBeliefSelection(graph, exact.selected).ok, true);
});

test('dependency violation is penalized and reported', () => {
  const problem = compileBeliefQubo(graph);
  const badBits = [0, 0, 1];
  const goodBits = [1, 0, 1];
  assert.ok(energyOf(problem, badBits) > energyOf(problem, goodBits));
  const check = verifyBeliefSelection(graph, ['c3']);
  assert.equal(check.ok, false);
  assert.deepEqual(check.missingDependencies, [['c3', 'c1']]);
});

test('Ising export preserves QUBO energy exactly', () => {
  const problem = compileBeliefQubo(graph);
  const ising = compileToIsing(problem);
  for (let mask = 0; mask < (1 << problem.variables.length); mask += 1) {
    const bits = Array.from({ length: problem.variables.length }, (_, i) => (mask >>> i) & 1);
    const z = bits.map((x) => 1 - 2 * x);
    let energy = ising.offset;
    for (let i = 0; i < z.length; i += 1) energy += ising.h[i] * z[i];
    for (const term of ising.couplings) energy += term.value * z[term.i] * z[term.j];
    assert.ok(Math.abs(energy - energyOf(problem, bits)) < 1e-9);
  }
});

test('QAOA simulator returns a deterministic bounded candidate', () => {
  const problem = compileBeliefQubo(graph);
  const first = qaoaSolve(problem, { gammaSteps: 8, betaSteps: 7, searchPoints: 32 });
  const second = qaoaSolve(problem, { gammaSteps: 8, betaSteps: 7, searchPoints: 32 });
  assert.deepEqual(first, second);
  assert.equal(first.physicalQpu, false);
  assert.ok(first.probability > 0 && first.probability <= 1 + 1e-12);
});

test('hybrid solver never promotes a worse quantum candidate over exact verification', () => {
  const problem = compileBeliefQubo(graph);
  const report = solveEpistemicQubo(graph, problem, { gammaSteps: 5, betaSteps: 5, searchPoints: 24 });
  assert.equal(report.chosen.verification.ok, true);
  assert.ok(report.exact);
  assert.ok(report.chosen.energy <= report.qaoa.energy + 1e-12);
  assert.equal(report.trust.quantumAdvantageClaimed, false);
  assert.equal(report.job.authority.physicalQpuExecution, 'UNKNOWN');
});
