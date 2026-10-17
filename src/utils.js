import { createHash, randomUUID } from 'node:crypto';

export const clamp = (n, min = 0, max = 1) => Math.min(max, Math.max(min, n));
export const nowIso = () => new Date().toISOString();
export const id = () => randomUUID();
export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function tokenize(text) {
  return String(text ?? '')
    .toLocaleLowerCase()
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_-]{2,}/gu) ?? [];
}

export function lexicalSimilarity(a, b) {
  const aa = new Set(tokenize(a));
  const bb = new Set(tokenize(b));
  if (!aa.size || !bb.size) return 0;
  let overlap = 0;
  for (const token of aa) if (bb.has(token)) overlap += 1;
  const precision = overlap / aa.size;
  const recall = overlap / bb.size;
  return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
}

export function safeJson(text, fallback = null) {
  if (typeof text !== 'string') return fallback;
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(stripped); } catch {}
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(stripped.slice(start, end + 1)); } catch {}
  }
  return fallback;
}

export function compactMessages(messages, maxChars = 18_000) {
  const clean = (messages ?? [])
    .filter((m) => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 12_000) }));
  let chars = 0;
  const out = [];
  for (let i = clean.length - 1; i >= 0; i -= 1) {
    const m = clean[i];
    if (chars + m.content.length > maxChars && out.length) break;
    out.unshift(m);
    chars += m.content.length;
  }
  return out;
}

export function redact(value) {
  const text = String(value ?? '');
  return text
    .replace(/\b(?:sk|hf|gh[pousr])_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{12,}/gi, 'Bearer [REDACTED]');
}

export function classifyIntent(text) {
  const q = String(text ?? '').toLowerCase();
  if (/\b(code|bug|function|class|api|repo|github|rust|python|javascript|typescript|compile|test|ci)\b/.test(q)) return 'engineering';
  if (/\b(research|evidence|paper|study|compare|investigate|source|citation|analy[sz]e)\b/.test(q)) return 'research';
  if (/\b(write|story|poem|design|brand|creative|logo|caption|script)\b/.test(q)) return 'creative';
  if (/\b(plan|decision|strategy|tradeoff|choose|architecture|roadmap)\b/.test(q)) return 'strategy';
  return 'general';
}

export function roleSet(intent, mode = 'balanced') {
  const roles = {
    engineering: ['implementer', 'reviewer', 'tester', 'systems-thinker'],
    research: ['analyst', 'skeptic', 'methodologist', 'synthesizer'],
    creative: ['explorer', 'editor', 'audience', 'constraint-keeper'],
    strategy: ['architect', 'red-team', 'operator', 'counterfactual'],
    general: ['reasoner', 'skeptic', 'pragmatist', 'counterfactual']
  }[intent] ?? ['reasoner', 'skeptic', 'pragmatist', 'counterfactual'];
  if (mode === 'fast') return roles.slice(0, 1);
  if (mode === 'deep') return roles;
  return roles.slice(0, 3);
}
