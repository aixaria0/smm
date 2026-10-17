const $ = (q) => document.querySelector(q);
const state = { mode: 'balanced', messages: [] };
const els = {
  status: $('#status'), messages: $('#messages'), composer: $('#composer'), prompt: $('#prompt'), send: $('#send'),
  confidence: $('#confidence'), intent: $('#intent'), nodes: $('#nodes'), latency: $('#latency'), memories: $('#memories'), trace: $('#trace'), ledger: $('#ledger')
};

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
}
function addMessage(role, content, extra = '') {
  const node = document.createElement('article');
  node.className = `message ${role} ${extra}`;
  node.innerHTML = `<div class="message-label">${role === 'user' ? 'YOU' : 'SMM'}</div><div class="message-body">${escapeHtml(content)}</div>`;
  els.messages.append(node);
  els.messages.scrollTop = els.messages.scrollHeight;
  return node;
}
function renderTrace(result) {
  els.confidence.textContent = Number(result.confidence).toFixed(2);
  els.intent.textContent = result.intent;
  els.nodes.textContent = String(result.metrics?.nodes ?? '—');
  els.latency.textContent = `${result.metrics?.durationMs ?? 0} ms`;
  els.memories.textContent = String(result.memory?.recalled ?? 0);
  els.ledger.textContent = result.trace?.head || '—';
  const views = result.trace?.views || [];
  els.trace.innerHTML = views.map((v) => `<div class="node ${v.ok ? '' : 'bad'}"><b></b><span>${escapeHtml(v.role)}</span><code>${escapeHtml((v.hash || 'failed').slice(0, 9))}</code></div>`).join('') || '<div class="trace-empty">No trace.</div>';
  const verify = result.trace?.verification;
  if (verify) els.trace.insertAdjacentHTML('beforeend', `<div class="verify">verification · ${escapeHtml(String(verify.risks?.length || 0))} risk flags · ${escapeHtml(String(verify.required_corrections?.length || 0))} corrections</div>`);
}
async function health() {
  try {
    const res = await fetch('/health');
    const body = await res.json();
    els.status.className = `status ${body.provider?.ok ? 'ok' : 'bad'}`;
    els.status.querySelector('span').textContent = body.provider?.ok ? `substrate online · ${body.provider.models?.[0] || 'model'}` : 'runtime online · substrate unavailable';
  } catch {
    els.status.className = 'status bad';
    els.status.querySelector('span').textContent = 'runtime unavailable';
  }
}

document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.remove('active'));
  button.classList.add('active');
  state.mode = button.dataset.mode;
}));

els.prompt.addEventListener('input', () => {
  els.prompt.style.height = 'auto';
  els.prompt.style.height = `${Math.min(190, els.prompt.scrollHeight)}px`;
});
els.prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); els.composer.requestSubmit(); }
});

els.composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = els.prompt.value.trim();
  if (!text || els.send.disabled) return;
  state.messages.push({ role: 'user', content: text });
  addMessage('user', text);
  els.prompt.value = ''; els.prompt.style.height = 'auto'; els.send.disabled = true;
  const pending = addMessage('smm', 'Running cognitive mesh…', 'thinking');
  try {
    const res = await fetch('/v1/mind/think', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: state.messages, mode: state.mode, remember: true, trace: true }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error?.detail || body.error?.message || `HTTP ${res.status}`);
    pending.remove();
    addMessage('smm', body.answer);
    state.messages.push({ role: 'assistant', content: body.answer });
    renderTrace(body);
  } catch (error) {
    pending.remove();
    addMessage('smm', `Request failed: ${error.message}`);
  } finally { els.send.disabled = false; els.prompt.focus(); }
});

$('#clear-memory').addEventListener('click', async () => {
  if (!confirm('Clear all persisted SMM memory?')) return;
  const res = await fetch('/v1/memory', { method: 'DELETE' });
  if (res.ok) { els.memories.textContent = '0'; state.messages = []; }
});

health();
