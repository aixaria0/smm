import fs from 'node:fs/promises';
import path from 'node:path';
import { id, nowIso, sha256, stableStringify } from './utils.js';

export class TraceLedger {
  constructor({ file } = {}) {
    this.file = file;
    this.lastHash = 'GENESIS';
    this.seq = 0;
    this.initialized = false;
    this._tail = Promise.resolve();
    this._initPromise = null;
  }

  async init() {
    if (this.initialized) return;
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      try {
        const text = await fs.readFile(this.file, 'utf8');
        const lines = text.trim().split('\n').filter(Boolean);
        if (lines.length) {
          const last = JSON.parse(lines.at(-1));
          this.lastHash = last.hash || 'GENESIS';
          this.seq = Number(last.seq) || lines.length;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      this.initialized = true;
    })();
    try { await this._initPromise; } finally { this._initPromise = null; }
  }

  record(type, payload = {}, traceId = null) {
    const write = async () => {
      await this.init();
      const body = {
        seq: ++this.seq,
        eventId: id(),
        traceId: traceId || id(),
        type,
        at: nowIso(),
        prevHash: this.lastHash,
        payload
      };
      const hash = sha256(`${body.prevHash}:${stableStringify(body)}`);
      const event = { ...body, hash };
      await fs.appendFile(this.file, `${JSON.stringify(event)}\n`, 'utf8');
      this.lastHash = hash;
      return event;
    };
    const next = this._tail.then(write, write);
    this._tail = next.then(() => undefined, () => undefined);
    return next;
  }

  async begin(payload = {}) {
    const traceId = id();
    const event = await this.record('trace.begin', payload, traceId);
    return { traceId, rootHash: event.hash };
  }

  async verify() {
    await this._tail;
    await this.init();
    let previous = 'GENESIS';
    let count = 0;
    try {
      const text = await fs.readFile(this.file, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        const { hash, ...body } = event;
        const expected = sha256(`${previous}:${stableStringify(body)}`);
        if (body.prevHash !== previous || hash !== expected) return { ok: false, count, failedSeq: body.seq };
        previous = hash;
        count += 1;
      }
      return { ok: true, count, head: previous };
    } catch (error) {
      if (error.code === 'ENOENT') return { ok: true, count: 0, head: 'GENESIS' };
      return { ok: false, count, error: error.message };
    }
  }
}
