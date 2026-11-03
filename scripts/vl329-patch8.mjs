// VL-329: правки теста env-file (отрицательные chat_id валидны — группы Telegram).
import { readFileSync, writeFileSync } from 'node:fs';

const p = 'src/core/env-file.test.mjs';
let s = readFileSync(p, 'utf-8');

const edits = [
  [
    `    assert.deepEqual(parseChatIds('0,-1,1.5'), []);`,
    `    // 0 и дробные — мусор; отрицательные валидны: так выглядят id групп
    assert.deepEqual(parseChatIds('0,1.5'), []);
    assert.deepEqual(parseChatIds('-1001234567890'), [-1001234567890]);`,
  ],
  [
    `  /** check-ignore для набора путей: мапа путь → игнорируется ли. */
  function checkIgnore(paths) {
    const res = spawnSync('git', ['check-ignore', '--no-index', '-v', ...paths], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    const lines = (res.stdout || '').trim().split('\\n').filter((l) => l !== '');
    const ignored = new Set(lines.map((l) => l.split('\\t')[1]));
    return ignored;
  }`,
    `  /**
   * Набор игнорируемых путей: \`git check-ignore\` печатает только
   * игнорируемые, поэтому непришедший путь = коммитится.
   */
  function checkIgnore(paths) {
    const res = spawnSync('git', ['check-ignore', '--no-index', ...paths], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    const lines = (res.stdout || '').trim().split('\\n').filter((l) => l !== '');
    return new Set(lines);
  }`,
  ],
];

let failed = 0;
for (const [oldS, newS] of edits) {
  if (!s.includes(oldS)) {
    console.error('ЯКОРЬ НЕ НАЙДЕН:', oldS.slice(0, 60).replace(/\n/g, '\\n'));
    failed++;
    continue;
  }
  s = s.replace(oldS, newS);
}
writeFileSync(p, s, 'utf-8');
console.log(`применено: ${edits.length - failed} из ${edits.length}`);
if (failed > 0) process.exitCode = 1;
