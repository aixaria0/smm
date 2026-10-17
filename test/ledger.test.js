import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TraceLedger } from '../src/ledger.js';

test('ledger forms a verifiable hash chain and detects tampering', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smm-ledger-'));
  const file = path.join(dir, 'ledger.jsonl');
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const ledger = new TraceLedger({ file });
  const trace = await ledger.begin({ queryHash: 'abc' });
  await ledger.record('mesh.view', { role: 'tester', hash: 'def' }, trace.traceId);
  const ok = await ledger.verify();
  assert.equal(ok.ok, true);
  assert.equal(ok.count, 2);

  const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
  const event = JSON.parse(lines[0]);
  event.payload.queryHash = 'tampered';
  lines[0] = JSON.stringify(event);
  await fs.writeFile(file, `${lines.join('\n')}\n`);
  const fresh = new TraceLedger({ file });
  const bad = await fresh.verify();
  assert.equal(bad.ok, false);
  assert.equal(bad.failedSeq, 1);
});

test('ledger serializes concurrent cognitive-node events without breaking the chain', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smm-ledger-concurrent-'));
  const file = path.join(dir, 'ledger.jsonl');
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const ledger = new TraceLedger({ file });
  const trace = await ledger.begin({ kind: 'concurrency' });
  await Promise.all(Array.from({ length: 40 }, (_, i) => ledger.record('mesh.view', { index: i }, trace.traceId)));
  const result = await ledger.verify();
  assert.equal(result.ok, true);
  assert.equal(result.count, 41);
});
