import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FunctionProvider } from '../src/providers.js';
import { createRuntime, createServer } from '../src/server.js';

async function runningServer(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smm-server-'));
  const provider = new FunctionProvider(async ({ messages }) => {
    const system = messages[0]?.content || '';
    if (system.includes('calibration-focused')) return '{"confidence":0.88,"risks":[],"agreements":[],"required_corrections":[]}';
    if (system.includes('synthesis layer')) return 'API answer.';
    return 'Candidate.';
  });
  const runtime = createRuntime({ provider, config: {
    memoryPath: path.join(dir, 'memory.jsonl'), ledgerPath: path.join(dir, 'ledger.jsonl'), publicDir: path.resolve('public'), rateLimitPerMinute: 1000
  } });
  await Promise.all([runtime.memory.init(), runtime.ledger.init()]);
  const server = createServer(runtime);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${server.address().port}`, runtime };
}

test('server exposes rich SMM and OpenAI-compatible APIs', async (t) => {
  const { base } = await runningServer(t);
  const rich = await fetch(`${base}/v1/mind/think`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'test API code' }] }) });
  assert.equal(rich.status, 200);
  const richBody = await rich.json();
  assert.equal(richBody.answer, 'API answer.');
  assert.ok(richBody.trace.head.length === 64);

  const chat = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }], remember: false }) });
  const chatBody = await chat.json();
  assert.equal(chatBody.choices[0].message.content, 'API answer.');
  assert.equal(chatBody.object, 'chat.completion');
});

test('server serves UI and validates malformed requests', async (t) => {
  const { base } = await runningServer(t);
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Stateful Mind Mesh/);
  const bad = await fetch(`${base}/v1/mind/think`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
  assert.equal(bad.status, 400);
});
