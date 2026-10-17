import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { MemoryStore } from './memory.js';
import { TraceLedger } from './ledger.js';
import { StatefulMindMesh } from './mesh.js';
import { OpenAICompatibleProvider, ProviderError } from './providers.js';
import { id, nowIso, redact } from './utils.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

class RateLimiter {
  constructor(limit = 60) { this.limit = limit; this.map = new Map(); }
  allow(key) {
    const now = Date.now();
    const row = this.map.get(key) || { start: now, count: 0 };
    if (now - row.start >= 60_000) { row.start = now; row.count = 0; }
    row.count += 1;
    this.map.set(key, row);
    if (this.map.size > 10_000) for (const [k, v] of this.map) if (now - v.start > 120_000) this.map.delete(k);
    return row.count <= this.limit;
  }
}

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, { 'content-type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

async function readJson(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error('Request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('Invalid JSON body'); error.status = 400; throw error; }
}

function securityHeaders(config) {
  return {
    'access-control-allow-origin': config.corsOrigin,
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"
  };
}

export function createRuntime(overrides = {}) {
  const config = loadConfig(overrides.config || {});
  const provider = overrides.provider || new OpenAICompatibleProvider({
    baseUrl: config.providerUrl, model: config.model, apiKey: config.apiKey, timeoutMs: config.requestTimeoutMs
  });
  const memory = overrides.memory || new MemoryStore({ file: config.memoryPath, enabled: config.memoryEnabled });
  const ledger = overrides.ledger || new TraceLedger({ file: config.ledgerPath });
  const mesh = overrides.mesh || new StatefulMindMesh({ provider, memory, ledger, defaultMode: config.mode });
  return { config, provider, memory, ledger, mesh };
}

export function createServer(runtime = createRuntime()) {
  const { config, provider, memory, ledger, mesh } = runtime;
  const limiter = new RateLimiter(config.rateLimitPerMinute);
  const headers = securityHeaders(config);

  return http.createServer(async (req, res) => {
    const requestId = id();
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, headers); return res.end(); }
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      const ip = req.socket.remoteAddress || 'unknown';
      if (!limiter.allow(ip)) return send(res, 429, { error: { message: 'Rate limit exceeded', request_id: requestId } });
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        await memory.init();
        const [providerHealth, ledgerHealth] = await Promise.all([provider.health(), ledger.verify()]);
        return send(res, providerHealth.ok ? 200 : 503, {
          ok: providerHealth.ok && ledgerHealth.ok,
          service: 'smm', version: '1.0.0', at: nowIso(),
          provider: providerHealth,
          memory: { enabled: memory.enabled, items: memory.items.size },
          ledger: ledgerHealth
        });
      }

      if (req.method === 'GET' && url.pathname === '/v1/models') {
        const models = await provider.models();
        return send(res, 200, { object: 'list', data: models });
      }

      if (req.method === 'GET' && url.pathname === '/v1/memory') {
        await memory.init();
        return send(res, 200, { object: 'list', data: memory.list({ limit: Math.min(500, Number(url.searchParams.get('limit')) || 100) }) });
      }

      if (req.method === 'DELETE' && url.pathname === '/v1/memory') {
        await memory.clear();
        return send(res, 200, { ok: true });
      }

      if (req.method === 'POST' && (url.pathname === '/v1/mind/think' || url.pathname === '/v1/chat/completions')) {
        const body = await readJson(req, config.maxBodyBytes);
        const result = await mesh.think({
          messages: body.messages,
          mode: body.mode || config.mode,
          remember: body.remember !== false,
          trace: url.pathname === '/v1/mind/think' ? body.trace !== false : false
        });
        if (url.pathname === '/v1/mind/think') return send(res, 200, result);
        if (body.stream) {
          res.writeHead(200, { ...headers, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
          const words = result.answer.match(/\S+\s*/g) || [result.answer];
          for (const piece of words) {
            res.write(`data: ${JSON.stringify({ id: result.id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`);
          }
          res.write(`data: ${JSON.stringify({ id: result.id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
          res.write('data: [DONE]\n\n');
          return res.end();
        }
        return send(res, 200, {
          id: result.id,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: result.model,
          choices: [{ index: 0, message: { role: 'assistant', content: result.answer }, finish_reason: 'stop' }],
          smm: { confidence: result.confidence, intent: result.intent, mode: result.mode, metrics: result.metrics }
        });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/')) {
        let relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        relative = path.normalize(relative).replace(/^(\.\.(\/|\\|$))+/, '');
        const absolute = path.resolve(config.publicDir, `.${relative.startsWith('/') ? relative : `/${relative}`}`);
        const fromPublic = path.relative(config.publicDir, absolute);
        if (fromPublic.startsWith('..') || path.isAbsolute(fromPublic)) return send(res, 403, { error: { message: 'Forbidden' } });
        try {
          const file = await fs.readFile(absolute);
          const type = MIME[path.extname(absolute)] || 'application/octet-stream';
          res.writeHead(200, { ...headers, 'content-type': type, 'content-length': file.length, 'cache-control': relative === '/index.html' ? 'no-cache' : 'public, max-age=3600' });
          return res.end(file);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }

      return send(res, 404, { error: { message: 'Not found', request_id: requestId } });
    } catch (error) {
      const status = Number(error.status || (error instanceof ProviderError ? error.status : 500));
      if (status >= 500) console.error(`[${requestId}]`, redact(error.stack || error.message));
      return send(res, status, { error: { message: status >= 500 ? 'SMM request failed' : error.message, detail: error instanceof ProviderError ? error.details : undefined, request_id: requestId } });
    }
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const runtime = createRuntime();
  await Promise.all([runtime.memory.init(), runtime.ledger.init()]);
  const server = createServer(runtime);
  server.listen(runtime.config.port, runtime.config.host, () => {
    console.log(`SMM listening on http://${runtime.config.host}:${runtime.config.port}`);
    console.log(`Provider: ${runtime.config.providerUrl}`);
  });
}
