import path from 'node:path';

function bool(name, fallback) {
  const value = process.env[name];
  if (value == null) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}
function int(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

export function loadConfig(overrides = {}) {
  const cwd = process.cwd();
  return {
    host: process.env.SMM_HOST || '127.0.0.1',
    port: int('SMM_PORT', 8787),
    providerUrl: process.env.SMM_PROVIDER_URL || 'http://127.0.0.1:11434/v1',
    model: process.env.SMM_MODEL || '',
    apiKey: process.env.SMM_API_KEY || '',
    mode: process.env.SMM_MODE || 'balanced',
    memoryEnabled: bool('SMM_MEMORY_ENABLED', true),
    memoryPath: path.resolve(cwd, process.env.SMM_MEMORY_PATH || '.smm/memory.jsonl'),
    ledgerPath: path.resolve(cwd, process.env.SMM_LEDGER_PATH || '.smm/ledger.jsonl'),
    maxBodyBytes: int('SMM_MAX_BODY_BYTES', 1_048_576),
    rateLimitPerMinute: int('SMM_RATE_LIMIT_PER_MINUTE', 60),
    corsOrigin: process.env.SMM_CORS_ORIGIN || '*',
    publicDir: path.resolve(cwd, 'public'),
    requestTimeoutMs: int('SMM_REQUEST_TIMEOUT_MS', 120_000),
    ...overrides
  };
}
