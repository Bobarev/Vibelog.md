/**
 * Тесты VL-83 — локальные инструменты агента (src/agent/tools.ts).
 *
 * Всё во временной /tmp-директории (изоляция от проекта, см. память о CLI
 * тестах): read/write/edit, отказ ../-путей, run_shell_command (echo, таймаут
 * с kill, abort-сигнал), grep_search и glob по фейковому дереву.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { listLocalTools, validateArgs, miniGlobToRegex } from '../../dist/agent/tools.js';

const TMP = '/tmp/vibelog-agent-tools-test';
let tools;
let byName;

before(() => {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'sub'), { recursive: true });
  mkdirSync(join(TMP, 'grep', 'sub'), { recursive: true });
  writeFileSync(join(TMP, 'a.txt'), 'alpha\nbeta\nalpha\n');
  writeFileSync(join(TMP, 'sub', 'b.ts'), 'const x = 1;\n');
  writeFileSync(join(TMP, 'sub', 'c.md'), '# Заголовок\nalpha\n');
  // Отдельное поддерево для grep: edit-тесты выше мутируют a.txt, поэтому
  // grep-фикстуры живут в отдельной директории и не зависят от порядка describe.
  writeFileSync(join(TMP, 'grep', 'f1.txt'), 'alpha\nbeta\nalpha\n');
  writeFileSync(join(TMP, 'grep', 'f2.ts'), 'const x = 1;\n');
  writeFileSync(join(TMP, 'grep', 'sub', 'f3.md'), '# Заголовок\nalpha\n');
  tools = listLocalTools(TMP);
  byName = new Map(tools.map((t) => [t.name, t]));
});

describe('validateArgs (VL-83)', () => {
  const schema = {
    type: 'object',
    properties: { path: { type: 'string' }, offset: { type: 'number' }, flag: { type: 'boolean' } },
    required: ['path'],
  };

  it('валидные аргументы → null', () => {
    assert.equal(validateArgs(schema, { path: 'x', offset: 1 }, 't'), null);
  });

  it('отсутствует обязательное поле → текст про него', () => {
    const err = validateArgs(schema, {}, 't');
    assert.match(err, /обязательное поле "path"/);
  });

  it('неверный тип → текст про тип', () => {
    const err = validateArgs(schema, { path: 42 }, 't');
    assert.match(err, /поле "path" должно иметь тип string/);
  });
});

describe('listLocalTools (VL-83)', () => {
  it('содержит ровно 6 инструментов', () => {
    assert.deepEqual(
      [...byName.keys()].sort(),
      ['edit', 'glob', 'grep_search', 'read_file', 'run_shell_command', 'write_file'],
    );
  });
});

describe('read_file / write_file / edit (VL-83)', () => {
  it('write_file + read_file: запись и чтение с offset/limit', async () => {
    const w = await byName.get('write_file').handler({ path: 'new/dir/f.txt', content: 'стр1\nстр2\nстр3\n' });
    assert.match(w, /Файл записан/);
    const full = await byName.get('read_file').handler({ path: 'new/dir/f.txt' });
    assert.equal(full, 'стр1\nстр2\nстр3\n');
    const slice = await byName.get('read_file').handler({ path: 'new/dir/f.txt', offset: 1, limit: 1 });
    assert.equal(slice, 'стр2');
  });

  it('read_file: несуществующий файл → текст модели', async () => {
    const out = await byName.get('read_file').handler({ path: 'нет.txt' });
    assert.match(out, /Файл не найден/);
  });

  it('edit: точная замена без replace_all', async () => {
    const out = await byName.get('edit').handler({ path: 'a.txt', old_string: 'beta', new_string: 'BETA' });
    assert.match(out, /Выполнено замен: 1/);
    const content = await byName.get('read_file').handler({ path: 'a.txt' });
    assert.equal(content, 'alpha\nBETA\nalpha\n');
  });

  it('edit: несколько вхождений без replace_all → отказ', async () => {
    const out = await byName.get('edit').handler({ path: 'a.txt', old_string: 'alpha', new_string: 'A' });
    assert.match(out, /найдена 2 раз/);
  });

  it('edit: replace_all заменяет все вхождения', async () => {
    const out = await byName
      .get('edit')
      .handler({ path: 'a.txt', old_string: 'alpha', new_string: 'A', replace_all: true });
    assert.match(out, /Выполнено замен: 2/);
    const content = await byName.get('read_file').handler({ path: 'a.txt' });
    assert.equal(content, 'A\nBETA\nA\n');
  });

  it('edit: отсутствующая строка → отказ', async () => {
    const out = await byName.get('edit').handler({ path: 'a.txt', old_string: 'нет такого', new_string: 'x' });
    assert.match(out, /не найдена/);
  });
});

describe('ограничение путей (VL-83)', () => {
  it('read_file с ../ → отказ «за пределы проекта»', async () => {
    const out = await byName.get('read_file').handler({ path: '../secrets.txt' });
    assert.match(out, /выходит за пределы проекта/);
  });

  it('write_file с абсолютным путём наружу → отказ', async () => {
    const out = await byName.get('write_file').handler({ path: '/etc/evil.txt', content: 'x' });
    assert.match(out, /выходит за пределы проекта/);
  });

  it('edit с ../ → отказ', async () => {
    const out = await byName
      .get('edit')
      .handler({ path: '../../x.txt', old_string: 'a', new_string: 'b' });
    assert.match(out, /выходит за пределы проекта/);
  });
});

describe('run_shell_command (VL-83)', () => {
  it('echo: exit code 0 и stdout', async () => {
    const out = await byName.get('run_shell_command').handler({ command: 'echo привет' });
    assert.match(out, /exit code: 0/);
    assert.match(out, /привет/);
  });

  it('не нулевой exit code попадает в результат', async () => {
    const out = await byName.get('run_shell_command').handler({ command: 'exit 3' });
    assert.match(out, /exit code: 3/);
  });

  it('cwd вне проекта → отказ', async () => {
    const out = await byName.get('run_shell_command').handler({ command: 'pwd', cwd: '../..' });
    assert.match(out, /выходит за пределы проекта/);
  });

  it('таймаут: sleep 5 при лимите 1с → kill и пометка', async () => {
    const started = Date.now();
    const out = await byName.get('run_shell_command').handler({ command: 'sleep 5', timeout_ms: 1000 });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 4500, `процесс не убит вовремя: ${elapsed}мс`);
    assert.match(out, /таймаут 1000 мс/);
  });

  it('abort-сигнал убивает процесс', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const started = Date.now();
    const out = await byName
      .get('run_shell_command')
      .handler({ command: 'sleep 5' }, { signal: controller.signal });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `процесс не убит по abort: ${elapsed}мс`);
    assert.match(out, /отменено пользователем/);
  });
});

describe('grep_search (VL-83)', () => {
  it('ищет по regex: формат file:line: text', async () => {
    const out = await byName.get('grep_search').handler({ pattern: 'alpha', path: 'grep' });
    const lines = out.split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^grep\/f1\.txt:1:alpha$/);
    assert.match(lines[1], /^grep\/f1\.txt:3:alpha$/);
    assert.match(lines[2], /^grep\/sub\/f3\.md:2:alpha$/);
  });

  it('фильтр glob сужает выдачу', async () => {
    const out = await byName.get('grep_search').handler({ pattern: 'alpha', path: 'grep', glob: '*.txt' });
    assert.equal(out.split('\n').length, 2);
    assert.match(out, /^grep\/f1\.txt:1:/);
  });

  it('поиск в поддиректории по path', async () => {
    const out = await byName.get('grep_search').handler({ pattern: 'const', path: 'sub' });
    assert.match(out, /^sub\/b\.ts:1:/);
  });

  it('невалидный regex → текст модели', async () => {
    const out = await byName.get('grep_search').handler({ pattern: '([' });
    assert.match(out, /Невалидный regex/);
  });

  it('нет совпадений → «Совпадений не найдено»', async () => {
    const out = await byName.get('grep_search').handler({ pattern: 'zzz_not_found' });
    assert.equal(out, 'Совпадений не найдено');
  });
});

describe('glob (VL-83)', () => {
  it('**/*.txt находит txt-файлы рекурсивно', async () => {
    const out = await byName.get('glob').handler({ pattern: '**/*.txt' });
    const files = out.split('\n');
    assert.ok(files.includes('a.txt'));
    assert.ok(files.includes('sub/../a.txt') === false);
  });

  it('*.ts без ** не заходит в поддиректории', async () => {
    const out = await byName.get('glob').handler({ pattern: '*.ts' });
    assert.equal(out, 'Файлы не найдены');
  });

  it('src-подобный паттерн **/*.ts', async () => {
    const out = await byName.get('glob').handler({ pattern: '**/*.ts' });
    assert.deepEqual(out.split('\n'), ['grep/f2.ts', 'sub/b.ts']);
  });
});

describe('miniGlobToRegex (VL-83)', () => {
  it('одна * не пересекает слэш', () => {
    const re = miniGlobToRegex('*.ts');
    assert.ok(re.test('a.ts'));
    assert.ok(!re.test('sub/a.ts'));
  });

  it('**/ поглощает директории', () => {
    const re = miniGlobToRegex('**/*.ts');
    assert.ok(re.test('a.ts'));
    assert.ok(re.test('sub/deep/a.ts'));
  });
});
