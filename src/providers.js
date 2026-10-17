import { compactMessages, redact } from './utils.js';

export class ProviderError extends Error {
  constructor(message, status = 502, details = undefined) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.details = details;
  }
}

export class OpenAICompatibleProvider {
  constructor({ baseUrl, model = '', apiKey = '', timeoutMs = 120_000, fetchImpl = fetch } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.model = model;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this._discoveredModel = '';
  }

  endpoint(path) {
    if (this.baseUrl.endsWith('/v1')) return `${this.baseUrl}${path}`;
    return `${this.baseUrl}/v1${path}`;
  }

  async models() {
    const response = await this.fetch(this.endpoint('/models'), { headers: this.headers() });
    if (!response.ok) throw new ProviderError(`Provider model discovery failed (${response.status})`, response.status);
    const body = await response.json();
    return Array.isArray(body.data) ? body.data : [];
  }

  headers() {
    const headers = { 'content-type': 'application/json' };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  async resolveModel() {
    if (this.model) return this.model;
    if (this._discoveredModel) return this._discoveredModel;
    const models = await this.models();
    const first = models.find((m) => m?.id)?.id;
    if (!first) throw new ProviderError('No model configured and provider reported no available model.', 503);
    this._discoveredModel = first;
    return first;
  }

  async complete({ messages, temperature = 0.3, maxTokens = 1400, json = false, signal } = {}) {
    const model = await this.resolveModel();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const body = {
      model,
      messages: compactMessages(messages),
      temperature,
      max_tokens: maxTokens,
      stream: false
    };
    if (json) body.response_format = { type: 'json_object' };
    let response;
    try {
      response = await this.fetch(this.endpoint('/chat/completions'), {
        method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: combined
      });
    } catch (error) {
      throw new ProviderError(`Inference provider unreachable: ${redact(error.message)}`, 503);
    }
    const text = await response.text();
    if (!response.ok) throw new ProviderError(`Inference provider rejected request (${response.status})`, response.status, redact(text).slice(0, 1000));
    let data;
    try { data = JSON.parse(text); } catch { throw new ProviderError('Inference provider returned invalid JSON.'); }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new ProviderError('Inference provider returned no assistant content.');
    return { content, model: data.model || model, usage: data.usage || null };
  }

  async health() {
    try {
      const models = await this.models();
      return { ok: true, models: models.map((m) => m.id).filter(Boolean).slice(0, 20) };
    } catch (error) {
      return { ok: false, error: redact(error.message) };
    }
  }
}

export class FunctionProvider {
  constructor(fn) { this.fn = fn; this.model = 'test-function'; }
  async complete(request) {
    const value = await this.fn(request);
    return typeof value === 'string' ? { content: value, model: this.model, usage: null } : value;
  }
  async health() { return { ok: true, models: [this.model] }; }
}
