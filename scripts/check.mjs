import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (/\.(?:js|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const files = await walk(process.cwd());
let failed = false;
for (const file of files) {
  const run = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (run.status !== 0) failed = true;
}
if (failed) process.exit(1);
console.log(`syntax ok: ${files.length} JavaScript files`);
