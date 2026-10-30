/**
 * Тесты VL-234 — поиск по файлам проекта (`src/agent/search-files.ts`).
 *
 * Фикстура — mkdtemp-каталог (VL-241: уникален на прогон, не конфликтует
 * с параллельными worktree). Проверяем literal/regex/регистр, glob-фильтр,
 * окно контекста, лимит, пропуск node_modules/.git/dist, бинарников и
 * файлов >1 МБ, отказ на выход за пределы проекта.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_FILE_BYTES,
  buildSearchRegex,
  isBinaryContent,
  searchProjectFiles,
  walkFiles,
} from '../../dist/agent/search-files.js';

const TMP = mkdtempSync(join(tmpdir(), 'vibelog-search-files-'));

beforeAll(() => {
  mkdirSync(join(TMP, 'src', 'sub'), { recursive: true });
  mkdirSync(join(TMP, 'docs'), { recursive: true });
  mkdirSync(join(TMP, 'node_modules'), { recursive: true });
  mkdirSync(join(TMP, 'dist'), { recursive: true });
  // Основное дерево
  writeFileSync(
    join(TMP, 'src', 'a.ts'),
    ['// шапка', 'export function createLlmClient() {}', 'const x = 1;', 'createLlmClient();', ''].join('\n'),
  );
  writeFileSync(join(TMP, 'src', 'sub', 'b.ts'), 'import { createLlmClient } from "../a";\n');
  writeFileSync(join(TMP, 'docs', 'c.md'), 'createLlmClient упоминается в документации\n');
  // literal-проверка: a.b не должно матчить axb
  writeFileSync(join(TMP, 'src', 'dots.ts'), 'a.b and axb and A.B\n');
  writeFileSync(join(TMP, 'src', 'case.ts'), 'CreateLlmClient\n');
  // Служебные каталоги — не должны просматриваться
  writeFileSync(join(TMP, 'node_modules', 'x.js'), 'createLlmClient\n');
  writeFileSync(join(TMP, 'dist', 'y.js'), 'createLlmClient\n');
  mkdirSync(join(TMP, '.git'), { recursive: true });
  writeFileSync(join(TMP, '.git', 'z'), 'createLlmClient\n');
  // Бинарник и слишком большой файл
  writeFileSync(join(TMP, 'bin.dat'), Buffer.from([0x63, 0x00, 0x72, 0x65, 0x61]));
  writeFileSync(join(TMP, 'huge.txt'), 'createLlmClient\n' + 'x'.repeat(SEARCH_MAX_FILE_BYTES));
});

afterAll(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('search_files: базовый поиск (VL-234)', () => {
  it('literal-паттерн, выдача сгруппирована по файлу', async () => {
    const out = await searchProjectFiles(TMP, { pattern: 'createLlmClient' });
    const lines = out.split('\n');
    assert.equal(lines[0], 'docs/c.md', 'заголовок первого файла (сортировка путей)');
    assert.match(lines[1], /^ {2}1: createLlmClient/);
    assert.ok(lines.includes('src/a.ts'));
    assert.ok(lines.includes('src/sub/b.ts'));
    // node_modules/.git/dist и бинарники не попали в выдачу
    assert.ok(!out.includes('node_modules'));
    assert.ok(!out.includes('dist/y.js'));
    assert.ok(!out.includes('.git/z'));
    assert.ok(!out.includes('bin.dat'));
    assert.ok(!out.includes('huge.txt'));
  });

  it('literal: точки не работают как regex-метасимволы', async () => {
    const out = await searchProjectFiles(TMP, { pattern: 'a.b', glob: 'src/dots.ts' });
    assert.match(out, /1: a\.b and axb and A\.B/);
    assert.equal(out.match(/dots\.ts/g).length, 1, 'одна группа на файл');
    assert.equal(out.trim().split('\n').length, 2, 'заголовок + одна строка');
  });

  it('regex: true включает регулярку', async () => {
    const regexOut = await searchProjectFiles(TMP, { pattern: 'a\\.b|axb', glob: 'src/dots.ts', regex: true });
    assert.match(regexOut, /1: a\.b and axb and A\.B/);
    // Невалидный regex — текст модели, не исключение
    const bad = await searchProjectFiles(TMP, { pattern: '([', regex: true });
    assert.match(bad, /Невалидный regex/);
  });

  it('caseSensitive: false находит другие регистры', async () => {
    const sensitive = await searchProjectFiles(TMP, { pattern: 'CreateLlmClient', glob: 'src/case.ts' });
    assert.match(sensitive, /1: CreateLlmClient/);
    const insensitive = await searchProjectFiles(TMP, {
      pattern: 'createllmclient', glob: 'src/**/*.ts', caseSensitive: false,
    });
    assert.ok(insensitive.includes('src/case.ts'));
    assert.ok(insensitive.includes('src/a.ts'));
  });

  it('glob-фильтр сужает выдачу', async () => {
    const out = await searchProjectFiles(TMP, { pattern: 'createLlmClient', glob: '**/*.md' });
    assert.match(out, /^docs\/c\.md$/m);
    assert.ok(!out.includes('src/a.ts'));
  });
});

describe('search_files: контекст и лимит (VL-234)', () => {
  it('context: 1 добавляет строки с N- и объединяет окна', async () => {
    const out = await searchProjectFiles(TMP, {
      pattern: 'createLlmClient()', glob: 'src/a.ts', context: 1,
    });
    const lines = out.split('\n');
    assert.ok(lines.some(l => /^ {2}2: export function createLlmClient\(\) \{\}$/.test(l)));
    assert.ok(lines.some(l => /^ {2}1- \/\/ шапка$/.test(l)), 'строка контекста до');
    assert.ok(lines.some(l => /^ {2}3- const x = 1;$/.test(l)), 'строка контекста после');
    assert.ok(!lines.some(l => l.startsWith('  3: ')), 'контекстная строка не помечена как совпадение');
  });

  it('limit: 2 → пометка об усечении', async () => {
    const out = await searchProjectFiles(TMP, { pattern: 'createLlmClient', limit: 2 });
    assert.match(out, /достигнут лимит 2 совпадений/);
  });

  it('нет совпадений → «Совпадений не найдено»', async () => {
    assert.equal(await searchProjectFiles(TMP, { pattern: 'zzz_not_found_zzz' }), 'Совпадений не найдено');
  });

  it('пустой pattern → текст модели', async () => {
    assert.match(await searchProjectFiles(TMP, { pattern: '' }), /Паттерн не задан/);
  });

  it('дефолтный лимит — 100', () => {
    assert.equal(SEARCH_DEFAULT_LIMIT, 100);
  });
});

describe('search_files: границы и обход (VL-234)', () => {
  it('path вне проекта → отказ', async () => {
    const out = await searchProjectFiles(TMP, { pattern: 'x', path: '../outside' });
    assert.match(out, /Путь выходит за пределы проекта/);
    // VL-257: структура проекта наружу не раскрывается.
    assert.ok(!out.includes('Ближайший существующий каталог'));
  });

  it('VL-257: отсутствующий path → подсказка с листингом ближайшего каталога', async () => {
    const out = await searchProjectFiles(TMP, { pattern: 'x', path: 'src/nope' });
    assert.match(out, /Путь не найден: src\/nope/);
    assert.match(out, /Ближайший существующий каталог: src\//);
    assert.ok(out.includes('a.ts'), out);
  });

  it('walkFiles пропускает служебные каталоги', () => {
    const files = walkFiles(TMP, 10_000);
    assert.ok(files.includes('src/a.ts'));
    assert.ok(!files.some(f => f.startsWith('node_modules/')));
    assert.ok(!files.some(f => f.startsWith('dist/')));
    assert.ok(!files.some(f => f.startsWith('.git/')));
  });

  it('path — конкретный файл: поиск только в нём', async () => {
    const out = await searchProjectFiles(TMP, { pattern: 'createLlmClient', path: 'src/sub/b.ts' });
    assert.match(out, /^src\/sub\/b\.ts$/m);
    assert.ok(!out.includes('src/a.ts'));
  });

  it('isBinaryContent: NUL-байт → бинарник', () => {
    assert.equal(isBinaryContent(Buffer.from([0x61, 0x00, 0x62])), true);
    assert.equal(isBinaryContent(Buffer.from('просто текст')), false);
  });

  it('buildSearchRegex: literal экранирует все метасимволы', () => {
    const re = buildSearchRegex('foo.bar(');
    assert.ok(re instanceof RegExp);
    assert.equal(re.test('foo.bar('), true);
    assert.equal(re.test('fooXbar('), false);
    const bad = buildSearchRegex('([', { regex: true });
    assert.ok(!(bad instanceof RegExp) && /Невалидный regex/.test(bad.error));
  });
});
