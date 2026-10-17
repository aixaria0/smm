import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from '../src/providers.js';

test('provider discovers model and speaks OpenAI chat-completions protocol', async () => {
  const seen = [];
  const fakeFetch = async (url, options = {}) => {
    seen.push({ url, options });
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'local-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ model: 'local-model', choices: [{ message: { content: 'hello' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const provider = new OpenAICompatibleProvider({ baseUrl: 'http://localhost:9999/v1', fetchImpl: fakeFetch });
  const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.content, 'hello');
  assert.equal(seen[0].url, 'http://localhost:9999/v1/models');
  assert.equal(seen[1].url, 'http://localhost:9999/v1/chat/completions');
  assert.equal(JSON.parse(seen[1].options.body).model, 'local-model');
});
