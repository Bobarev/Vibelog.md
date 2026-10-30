/**
 * Тесты CLI-команды `vibelog map` (VL-235).
 *
 * Чистая логика команды проверяется прямым вызовом runMap с перехватом
 * console.log (как в src/cli/cli.test.mjs:40) — без spawn'ов.
 * Фикстура — mkdtemp (AGENTS.md).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runMap } from '../../dist/cli/commands/map.js';
import { parseArgs } from '../../dist/cli/args.js';

let testRoot;

/** Перехватывает console.log команды и возвращает склеенный вывод. */
async function capture(fn) {
  const chunks = [];
  const orig = console.log;
  console.log = (...args) => { chunks.push(args.join(' ')); };
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return chunks.join('\n');
}

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'vibelog-cli-map-'));
  mkdirSync(join(testRoot, 'src', 'agent'), { recursive: true });
  writeFileSync(
    join(testRoot, 'src', 'agent', 'cli.ts'),
    '/**\n * CLI агента.\n */\nexport function main(): void {}\n',
    'utf8',
  );
  writeFileSync(
    join(testRoot, 'src', 'agent', 'llm.ts'),
    '/**\n * LLM-клиент.\n */\nexport function streamChat(): void {}\n',
    'utf8',
  );
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-235 — vibelog map', () => {
  it('обычный вывод: карта + итоговая строка', async () => {
    const out = await capture(() => runMap([], parseArgs(['map']).flags, testRoot));
    assert.match(out, /src\/agent\//);
    assert.match(out, /cli\.ts — CLI агента\./);
    assert.match(out, /\[main\]/);
    assert.match(out, /Итого: 2 модулей из 2/);
  });

  it('query позиционным аргументом', async () => {
    const out = await capture(() => runMap(['streamChat'], parseArgs(['map']).flags, testRoot));
    assert.match(out, /llm\.ts/);
    assert.ok(!out.includes('cli.ts — CLI агента.'), 'нерелевантный модуль не показан');
  });

  it('--json: валидный JSON с kind=map', async () => {
    const out = await capture(() => runMap([], parseArgs(['map', '--json']).flags, testRoot));
    const parsed = JSON.parse(out);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.kind, 'map');
    assert.equal(parsed.data.modules, 2);
    assert.match(parsed.data.text, /src\/agent\//);
  });

  it('--limit 1: маркер усечения', async () => {
    const out = await capture(() => runMap([], parseArgs(['map', '--limit', '1']).flags, testRoot));
    assert.match(out, /карта усечена: показано 1 из 2 модулей/);
  });

  it('--no-exports: без списков экспортов', async () => {
    const out = await capture(() => runMap([], parseArgs(['map', '--no-exports']).flags, testRoot));
    assert.ok(!out.includes('[main]'));
    assert.match(out, /cli\.ts — CLI агента\./);
  });
});
