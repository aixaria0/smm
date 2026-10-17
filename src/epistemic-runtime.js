import { safeJson } from './utils.js';
import { normalizeBeliefGraph, compileBeliefQubo } from './epistemic.js';
import { solveEpistemicQubo } from './quantum.js';

function candidatesText(views) {
  return views.map((v) => `### ${v.role}\n${v.content}`).join('\n\n');
}

export async function runEpistemicLayer({ provider, query, views, mode = 'balanced', signal } = {}) {
  if (!provider || !Array.isArray(views) || !views.length) return null;
  const maxClaims = mode === 'deep' ? 12 : 8;
  const prompt = [
    'Compile the candidate assessments into a bounded epistemic claim graph.',
    'Return ONLY JSON with schema:',
    '{"claims":[{"id":"c1","statement":"atomic claim","confidence":0.0,"evidence":0.0,"independence":0.0,"source_roles":["role"],"requires":["cX"],"conflicts":["cY"],"falsifier":"observation that would weaken or refute it"}]}',
    `Use at most ${maxClaims} claims.`,
    'confidence estimates candidate-level plausibility; evidence scores only explicit support present in the candidate text; independence estimates how independently the claim is supported across roles.',
    'Do not invent external sources. Keep claims atomic. References in requires/conflicts must point to IDs in the same JSON. If two claims cannot both be true, mark the conflict.',
    'Do not output chain-of-thought.',
    `ORIGINAL REQUEST:\n${query}`,
    `CANDIDATES:\n${candidatesText(views)}`
  ].join('\n\n');
  const compiled = await provider.complete({
    messages: [
      { role: 'system', content: 'You are the epistemic compiler inside SMM-Q. Output strict JSON only.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0,
    maxTokens: mode === 'deep' ? 1800 : 1200,
    json: true,
    signal
  });
  const parsed = safeJson(compiled.content);
  const graph = normalizeBeliefGraph(parsed, { maxClaims });
  if (!graph.claims.length) return null;
  const qubo = compileBeliefQubo(graph);
  const solve = solveEpistemicQubo(graph, qubo, {
    gammaSteps: mode === 'deep' ? 14 : 10,
    betaSteps: mode === 'deep' ? 12 : 8,
    acceptanceTolerance: mode === 'deep' ? 0.03 : 0.05
  });
  const selected = new Set(solve.chosen.selected);
  return {
    graph,
    qubo: {
      schema: qubo.schema,
      digest: qubo.digest,
      variables: qubo.variables.length,
      terms: qubo.quadratic.length,
      penalties: qubo.penalties
    },
    solve,
    selectedClaims: graph.claims.filter((claim) => selected.has(claim.id)),
    rejectedClaimIds: graph.claims.filter((claim) => !selected.has(claim.id)).map((claim) => claim.id)
  };
}

export function epistemicPromptSection(epistemic) {
  if (!epistemic?.selectedClaims?.length) return 'No epistemic selection was available; use the candidate assessments directly.';
  const lines = epistemic.selectedClaims.map((claim) =>
    `- ${claim.id}: ${claim.statement} [confidence=${claim.confidence.toFixed(2)}, evidence=${claim.evidence.toFixed(2)}]`
  );
  return [
    'Selected claims from the SMM-Q belief optimization layer:',
    ...lines,
    `Selection backend: ${epistemic.solve.chosen.backend}.`,
    'These claims are optimization candidates, not automatically established truth. Preserve uncertainty and verifier corrections.'
  ].join('\n');
}
