// Resolve the browser dependency beside the tool OR in the consuming project.
// A skill lives outside the project's node_modules, so ESM import alone misses it.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const project = createRequire(resolve(process.cwd(), 'package.json'));
let engine;
const pick = (module) => module.chromium ?? module.default?.chromium;
for (const name of ['playwright', '@playwright/test']) {
  try { engine = pick(await import(name)); } catch { /* try the project */ }
  if (!engine) {
    try { engine = pick(await import(pathToFileURL(project.resolve(name)).href)); } catch { /* try the next package */ }
  }
  if (engine) break;
}
if (!engine) throw new Error('In the target project run: npm i -D playwright && npx playwright install chromium');
export const chromium = engine;
