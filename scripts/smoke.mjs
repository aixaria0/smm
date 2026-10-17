import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { FunctionProvider } from '../src/providers.js';
import { createRuntime, createServer } from '../src/server.js';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'smm-smoke-'));
const provider = new FunctionProvider(async ({ messages }) => {
  const system = messages[0]?.content || '';
  if (system.includes('calibration-focused')) return '{"confidence":0.9,"risks":[],"agreements":["ok"],"required_corrections":[]}';
  if (system.includes('synthesis layer')) return 'SMM smoke test answer.';
  return 'Candidate view.';
});
const runtime = createRuntime({ provider, config: { memoryPath: path.join(tmp, 'memory.jsonl'), ledgerPath: path.join(tmp, 'ledger.jsonl'), publicDir: path.resolve('public') } });
await Promise.all([runtime.memory.init(), runtime.ledger.init()]);
const server = createServer(runtime);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
try {
  const response = await fetch(`http://127.0.0.1:${port}/v1/mind/think`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'smoke test' }] }) });
  const body = await response.json();
  if (!response.ok || body.answer !== 'SMM smoke test answer.' || body.confidence < 0.8) throw new Error(JSON.stringify(body));
  console.log(`smoke ok: confidence=${body.confidence} trace=${body.trace.id}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmp, { recursive: true, force: true });
}
