import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../src/memory.js';

async function tempFile(name) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'smm-memory-'));
  return { dir, file: path.join(dir, name) };
}

test('memory recalls semantically overlapping state and persists it', async (t) => {
  const { dir, file } = await tempFile('memory.jsonl');
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new MemoryStore({ file });
  await store.remember({ text: 'Casper CBC finality depends on validator observations and weights.', tags: ['consensus'], salience: 0.9 });
  await store.remember({ text: 'A recipe for apple pie uses cinnamon.', tags: ['food'], salience: 0.5 });
  const hits = await store.recall('validator finality in Casper consensus', { limit: 2 });
  assert.equal(hits.length, 1);
  assert.match(hits[0].text, /Casper CBC/);

  const reloaded = new MemoryStore({ file });
  await reloaded.init();
  assert.equal(reloaded.list().length, 2);
});

test('memory deletion and clear are durable events', async (t) => {
  const { dir, file } = await tempFile('memory.jsonl');
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = new MemoryStore({ file });
  const item = await store.remember({ text: 'temporary state' });
  assert.equal(await store.delete(item.id), true);
  assert.equal(store.list().length, 0);
  await store.remember({ text: 'another state' });
  await store.clear();
  const reloaded = new MemoryStore({ file });
  await reloaded.init();
  assert.equal(reloaded.list().length, 0);
});
