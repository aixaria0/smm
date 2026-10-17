import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FunctionProvider } from '../src/providers.js';
import { MemoryStore } from '../src/memory.js';
import { TraceLedger } from '../src/ledger.js';
import { StatefulMindMesh } from '../src/mesh.js';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smm-mesh-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [];
  const provider = new FunctionProvider(async ({ messages }) => {
    calls.push(messages);
    const system = messages[0]?.content || '';
    if (system.includes('calibration-focused')) return '{"confidence":0.92,"risks":[],"agreements":["candidate agreement"],"required_corrections":[]}';
    if (system.includes('synthesis layer')) return 'Verified final answer.';
    return `View for ${system.slice(0, 24)}`;
  });
  const memory = new MemoryStore({ file: path.join(dir, 'memory.jsonl') });
  const ledger = new TraceLedger({ file: path.join(dir, 'ledger.jsonl') });
  const mesh = new StatefulMindMesh({ provider, memory, ledger });
  return { mesh, memory, ledger, calls };
}

test('balanced mesh creates independent views, verifies, synthesizes and remembers', async (t) => {
  const { mesh, memory, ledger, calls } = await fixture(t);
  const result = await mesh.think({ messages: [{ role: 'user', content: 'Design and test an API function in JavaScript' }], mode: 'balanced' });
  assert.equal(result.answer, 'Verified final answer.');
  assert.equal(result.intent, 'engineering');
  assert.equal(result.trace.views.length, 3);
  assert.equal(result.confidence, 0.92);
  assert.equal(calls.length, 5); // 3 views + verifier + synthesis
  assert.equal(memory.list().length, 1);
  assert.equal((await ledger.verify()).ok, true);
});

test('fast mode uses one cognitive view and skips verifier call', async (t) => {
  const { mesh, calls } = await fixture(t);
  const result = await mesh.think({ messages: [{ role: 'user', content: 'Give me a short practical answer' }], mode: 'fast', remember: false });
  assert.equal(result.trace.views.length, 1);
  assert.equal(calls.length, 2); // view + synthesis
});
