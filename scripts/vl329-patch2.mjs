// VL-329: вторая часть пакетной правки — импорты и хвосты.
import { readFileSync, writeFileSync } from 'node:fs';

const edits = [];
const add = (file, old, neu) => edits.push({ file, old, neu });

// setup.ts: импорты по месту живут (parseChatIds, upsertDotEnv)
add(
  'src/core/setup.ts',
  `import { readEnvFile, writeSecrets } from './setup-secrets.js';`,
  `import { readEnvFile, writeSecrets } from './setup-secrets.js';
import { upsertDotEnv } from './env-file.js';
import { parseChatIds } from '../bot/env.js';`,
);

let failed = 0;
for (const e of edits) {
  const src = readFileSync(e.file, 'utf-8');
  if (!src.includes(e.old)) {
    console.error(`ЯКОРЬ НЕ НАЙДЕН: ${e.file} :: ${e.old.slice(0, 70)}`);
    failed++;
    continue;
  }
  writeFileSync(e.file, src.replace(e.old, e.neu), 'utf-8');
}
console.log(`применено: ${edits.length - failed} из ${edits.length}`);
if (failed > 0) process.exitCode = 1;
