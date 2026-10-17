import { energyOf, exactSolveQubo, greedySolveQubo, verifyBeliefSelection, buildQuantumJob } from './epistemic.js';

function phaseCost(re, im, costs, gamma, scale) {
  for (let i = 0; i < re.length; i += 1) {
    const angle = -gamma * costs[i] / scale;
    const c = Math.cos(angle), s = Math.sin(angle), r = re[i], q = im[i];
    re[i] = r * c - q * s;
    im[i] = r * s + q * c;
  }
}

function applyMixer(re, im, qubit, beta) {
  const bit = 1 << qubit;
  const c = Math.cos(beta), s = Math.sin(beta);
  for (let i = 0; i < re.length; i += 1) {
    if (i & bit) continue;
    const j = i | bit;
    const ar = re[i], ai = im[i], br = re[j], bi = im[j];
    re[i] = c * ar + s * bi;
    im[i] = c * ai - s * br;
    re[j] = c * br + s * ai;
    im[j] = c * bi - s * ar;
  }
}

function simulate(problem, costs, gammas, betas, scale) {
  const n = problem.variables.length, dim = 1 << n, amp = 1 / Math.sqrt(dim);
  const re = new Float64Array(dim); re.fill(amp);
  const im = new Float64Array(dim);
  for (let layer = 0; layer < gammas.length; layer += 1) {
    phaseCost(re, im, costs, gammas[layer], scale);
    for (let q = 0; q < n; q += 1) applyMixer(re, im, q, betas[layer]);
  }
  let expectation = 0, maxProbability = -1, mode = 0;
  const probabilities = new Float64Array(dim);
  for (let i = 0; i < dim; i += 1) {
    const p = re[i] * re[i] + im[i] * im[i];
    probabilities[i] = p;
    expectation += p * costs[i];
    if (p > maxProbability) { maxProbability = p; mode = i; }
  }
  return { expectation, mode, maxProbability, probabilities };
}

function vanDerCorput(index, base) {
  let n = index, denom = 1, result = 0;
  while (n > 0) { denom *= base; result += (n % base) / denom; n = Math.floor(n / base); }
  return result;
}

function evaluateAngles(problem, costs, scale, gammas, betas) {
  return { ...simulate(problem, costs, gammas, betas, scale), gammas: [...gammas], betas: [...betas] };
}

function better(a, b) { return !b || a.expectation < b.expectation - 1e-12; }

export function qaoaSolve(problem, { gammaSteps = 10, betaSteps = 8, depth = 2, searchPoints = 96 } = {}) {
  const n = problem.variables.length;
  if (n === 0) return { backend: 'qaoa-statevector-p0', depth: 0, bits: [], selected: [], energy: 0, expectedEnergy: 0, probability: 1, gammas: [], betas: [], physicalQpu: false };
  if (n > 12) throw new RangeError('local QAOA statevector simulator is limited to 12 variables');
  const p = Math.max(1, Math.min(2, Number(depth) || 2));
  const dim = 1 << n;
  const costs = Array.from({ length: dim }, (_, mask) => energyOf(problem, Array.from({ length: n }, (_, i) => (mask >>> i) & 1)));
  const minCost = Math.min(...costs), maxCost = Math.max(...costs);
  const scale = Math.max(1e-9, maxCost - minCost);
  let best = null;

  for (let gi = 0; gi < gammaSteps; gi += 1) {
    const gamma = gammaSteps === 1 ? 0 : (gi / (gammaSteps - 1)) * Math.PI * 2;
    for (let bi = 0; bi < betaSteps; bi += 1) {
      const beta = betaSteps === 1 ? 0 : (bi / (betaSteps - 1)) * Math.PI / 2;
      const run = evaluateAngles(problem, costs, scale, [gamma], [beta]);
      if (better(run, best)) best = run;
    }
  }

  if (p === 2) {
    for (let k = 1; k <= searchPoints; k += 1) {
      const gammas = [2 * Math.PI * vanDerCorput(k, 2), 2 * Math.PI * vanDerCorput(k, 3)];
      const betas = [(Math.PI / 2) * vanDerCorput(k, 5), (Math.PI / 2) * vanDerCorput(k, 7)];
      const run = evaluateAngles(problem, costs, scale, gammas, betas);
      if (better(run, best)) best = run;
    }
    if (best.gammas.length === 1) best = evaluateAngles(problem, costs, scale, [best.gammas[0], best.gammas[0] / 2], [best.betas[0], best.betas[0] / 2]);
    let gammaStep = Math.PI / 3, betaStep = Math.PI / 10;
    for (let round = 0; round < 4; round += 1) {
      for (let slot = 0; slot < 4; slot += 1) {
        for (const sign of [-1, 1]) {
          const gammas = [...best.gammas], betas = [...best.betas];
          if (slot < 2) gammas[slot] = (gammas[slot] + sign * gammaStep + 2 * Math.PI) % (2 * Math.PI);
          else betas[slot - 2] = Math.max(0, Math.min(Math.PI / 2, betas[slot - 2] + sign * betaStep));
          const run = evaluateAngles(problem, costs, scale, gammas, betas);
          if (better(run, best)) best = run;
        }
      }
      gammaStep *= 0.5; betaStep *= 0.5;
    }
  }

  const bits = Array.from({ length: n }, (_, i) => (best.mode >>> i) & 1);
  return {
    backend: `qaoa-statevector-p${best.gammas.length}`,
    depth: best.gammas.length,
    bits,
    selected: problem.variables.filter((_, i) => bits[i]).map((v) => v.claimId),
    energy: costs[best.mode],
    expectedEnergy: best.expectation,
    probability: best.maxProbability,
    gammas: best.gammas,
    betas: best.betas,
    physicalQpu: false
  };
}

export function solveEpistemicQubo(graph, problem, options = {}) {
  const job = buildQuantumJob(graph, problem);
  const qaoa = qaoaSolve(problem, options);
  const greedy = greedySolveQubo(problem);
  const exact = problem.variables.length <= 20 ? exactSolveQubo(problem) : null;
  const qaoaVerification = verifyBeliefSelection(graph, qaoa.selected);
  const gap = exact ? qaoa.energy - exact.energy : null;
  const exactTolerance = Number(options.acceptanceTolerance ?? 0.05);
  const qaoaVsGreedy = greedy.energy - qaoa.energy;
  const acceptQuantum = qaoaVerification.ok
    && qaoa.energy <= greedy.energy + 1e-12
    && (!exact || gap <= exactTolerance);
  const chosen = acceptQuantum ? qaoa : exact || greedy || qaoa;
  const chosenVerification = verifyBeliefSelection(graph, chosen.selected);
  return {
    schema: 'smm-q/solve-report-v1',
    job,
    qaoa,
    greedy,
    exact,
    optimalityGap: gap,
    qaoaVsGreedyDelta: qaoaVsGreedy,
    acceptedQuantumCandidate: acceptQuantum,
    chosen: { backend: chosen.backend, energy: chosen.energy, selected: chosen.selected, verification: chosenVerification },
    trust: {
      simulatorIsClassical: true,
      physicalQpuExecution: false,
      quantumAdvantageClaimed: false,
      selectionDoesNotEstablishTruth: true
    }
  };
}
