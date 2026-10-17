import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createRuntime } from './server.js';

const runtime = createRuntime();
await Promise.all([runtime.memory.init(), runtime.ledger.init()]);
const rl = readline.createInterface({ input, output });
const history = [];
console.log('SMM · Stateful Mind Mesh');
console.log('Commands: /mode fast|balanced|deep, /clear, /memory, /quit');
let mode = runtime.config.mode;
while (true) {
  const line = (await rl.question(`\n[${mode}] you> `)).trim();
  if (!line) continue;
  if (line === '/quit' || line === '/exit') break;
  if (line.startsWith('/mode ')) {
    const next = line.slice(6).trim();
    if (['fast', 'balanced', 'deep'].includes(next)) { mode = next; console.log(`mode=${mode}`); }
    else console.log('valid modes: fast, balanced, deep');
    continue;
  }
  if (line === '/clear') { history.length = 0; console.log('conversation cleared'); continue; }
  if (line === '/memory') { console.log(runtime.memory.list({ limit: 10 })); continue; }
  history.push({ role: 'user', content: line });
  try {
    const result = await runtime.mesh.think({ messages: history, mode, remember: true, trace: false });
    history.push({ role: 'assistant', content: result.answer });
    console.log(`\nsmm> ${result.answer}`);
    console.log(`\n[confidence=${result.confidence.toFixed(2)} intent=${result.intent} ${result.metrics.durationMs}ms]`);
  } catch (error) {
    console.error(`error: ${error.message}`);
  }
}
rl.close();
