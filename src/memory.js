import fs from 'node:fs/promises';
import path from 'node:path';
import { id, lexicalSimilarity, nowIso, clamp } from './utils.js';

export class MemoryStore {
  constructor({ file, enabled = true, maxItems = 5000 } = {}) {
    this.file = file;
    this.enabled = enabled;
    this.maxItems = maxItems;
    this.items = new Map();
    this.ready = false;
    this._initPromise = null;
    this._writeTail = Promise.resolve();
  }

  async init() {
    if (this.ready || !this.enabled) { this.ready = true; return; }
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      try {
        const text = await fs.readFile(this.file, 'utf8');
        for (const line of text.split('\n')) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.op === 'put' && event.value?.id) this.items.set(event.value.id, event.value);
            if (event.op === 'delete' && event.id) this.items.delete(event.id);
            if (event.op === 'clear') this.items.clear();
          } catch {}
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      this.ready = true;
    })();
    try { await this._initPromise; } finally { this._initPromise = null; }
  }

  append(event) {
    if (!this.enabled) return Promise.resolve();
    const write = async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.appendFile(this.file, `${JSON.stringify(event)}\n`, 'utf8');
    };
    const next = this._writeTail.then(write, write);
    this._writeTail = next.then(() => undefined, () => undefined);
    return next;
  }

  async remember({ text, role = 'note', tags = [], salience = 0.5, metadata = {} } = {}) {
    await this.init();
    if (!this.enabled || !String(text ?? '').trim()) return null;
    const value = {
      id: id(),
      text: String(text).trim().slice(0, 16_000),
      role: String(role),
      tags: Array.isArray(tags) ? tags.map(String).slice(0, 20) : [],
      salience: clamp(Number(salience) || 0.5),
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      createdAt: nowIso(),
      lastAccessedAt: nowIso(),
      accesses: 0
    };
    this.items.set(value.id, value);
    await this.append({ op: 'put', value });
    if (this.items.size > this.maxItems) await this.compact();
    return value;
  }

  async recall(query, { limit = 6, minScore = 0.08 } = {}) {
    await this.init();
    if (!this.enabled || !String(query ?? '').trim()) return [];
    const now = Date.now();
    const ranked = [];
    for (const value of this.items.values()) {
      const lexical = lexicalSimilarity(query, `${value.text} ${(value.tags || []).join(' ')}`);
      if (lexical === 0 && value.salience < 0.95) continue;
      const ageDays = Math.max(0, (now - Date.parse(value.createdAt)) / 86_400_000);
      const recency = Math.exp(-ageDays / 45);
      const access = Math.min(1, Math.log2(1 + (value.accesses || 0)) / 6);
      const score = (0.66 * lexical) + (0.18 * recency) + (0.12 * value.salience) + (0.04 * access);
      if (score >= minScore) ranked.push({ ...value, score: Number(score.toFixed(4)) });
    }
    ranked.sort((a, b) => b.score - a.score || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const out = ranked.slice(0, limit);
    for (const hit of out) {
      const original = this.items.get(hit.id);
      if (original) {
        original.accesses = (original.accesses || 0) + 1;
        original.lastAccessedAt = nowIso();
      }
    }
    return out;
  }

  list({ limit = 100 } = {}) {
    return [...this.items.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }

  async delete(idValue) {
    await this.init();
    const existed = this.items.delete(idValue);
    if (existed) await this.append({ op: 'delete', id: idValue });
    return existed;
  }

  async clear() {
    await this.init();
    this.items.clear();
    await this.append({ op: 'clear', at: nowIso() });
  }

  async compact() {
    const keep = [...this.items.values()]
      .sort((a, b) => (b.salience - a.salience) || Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, Math.max(100, Math.floor(this.maxItems * 0.8)));
    this.items = new Map(keep.map((m) => [m.id, m]));
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, keep.map((value) => JSON.stringify({ op: 'put', value })).join('\n') + '\n', 'utf8');
    await fs.rename(tmp, this.file);
  }
}
