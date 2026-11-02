/**
 * Тесты MCP-инструмента `git_commit` (VL-311).
 *
 * Задача: коммит перестаёт быть инструкцией модели («передай трейлер вторым -m»,
 * «никогда git add -A») и становится проверкой в коде — узкий write-инструмент
 * `git_commit { paths, message, amend?, allowForeign? }`.
 *
 * Проверяется поведение из AC задачи:
 *   1. успешный коммит c трейлером Co-authored-by (переиспользование VL-302);
 *   2. `commit_coauthor: false` → без трейлера;
 *   3. `amend: true` сохраняет тело исходного коммита (%B) и не дублирует трейлер;
 *   4. чужой путь (вне modified_files) → отказ с перечислением; allowForeign → коммит;
 *   5. нет изменений по путям → noop, коммит не создаётся (совместимо с VL-310);
 *   6. путь вне проекта, `git add -A`, `.` → отказ;
 *   7. JSON-ack: поля ok/message/applied.hash/applied.subject/applied.paths.
 *
 * Каталог — mkdtempSync (AGENTS.md/VL-241: фиксированные пути запрещены).
 * Env фазовой сессии снимается на время файла (lesson-88/VL-286): VIBELOG_CWD
 * увёл бы коммит в главный репозиторий, VIBELOG_PHASE_TASK_ID подменил бы ID
 * задачи для сверки с modified_files.
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleToolCall, listTools } from '../../dist/mcp/tools.js';
import { commitFiles, foreignPaths } from '../../dist/mcp/git-commit.js';
import { createTaskFile } from '../../dist/core/store.js';

/** Ключи фазового env, которые снимаются на время теста (VL-286). */
const PHASE_ENV_KEYS = [
  'VIBELOG_CWD',
  'VIBELOG_PHASE_TASK_ID',
  'VIBELOG_PHASE_NAME',
  'VIBELOG_RUN_PHASE',
  'VIBELOG_RUN_STARTED_AT',
];

/** git в тестовом каталоге. */
function git(cwd, ...args) {
  return execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Число коммитов в репозитории. */
function commitCount(cwd) {
  return Number(git(cwd, 'rev-list', '--count', 'HEAD'));
}

/** Разбирает ответ инструмента как JSON-ack. */
function parseAck(out) {
  let ack;
  try {
    ack = JSON.parse(out);
  } catch {
    assert.fail(`ответ не JSON: ${String(out).slice(0, 300)}`);
  }
  return ack;
}

describe('VL-311 — git_commit: коммит явными путями с трейлером', () => {
  let root;
  let savedEnv;

  beforeEach(() => {
    savedEnv = {};
    for (const key of PHASE_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    root = mkdtempSync(join(tmpdir(), 'vibelog-gitcommit-'));
    execFileSync('/usr/bin/git', ['init', '-q'], { cwd: root });
    execFileSync('/usr/bin/git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('/usr/bin/git', ['config', 'user.name', 'Test'], { cwd: root });
    mkdirSync(join(root, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(root, 'backlog', 'config.yml'), 'project_name: Git Commit Test\n', 'utf-8');
    writeFileSync(join(root, 'a.txt'), 'one\n', 'utf-8');
    git(root, 'add', 'backlog/config.yml', 'a.txt');
    git(root, 'commit', '-q', '-m', 'init');
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('AC1/AC3: коммит с трейлером, ack содержит hash/subject/paths', async () => {
    writeFileSync(join(root, 'a.txt'), 'two\n', 'utf-8');
    const before = commitCount(root);
    const ack = parseAck(await handleToolCall('git_commit', { paths: ['a.txt'], message: 'feat: тест' }, root));

    assert.equal(ack.ok, true, `ok:true ожидался — ${JSON.stringify(ack)}`);
    assert.match(ack.message, /Коммит/);
    assert.equal(typeof ack.applied.hash, 'string');
    assert.equal(ack.applied.hash.length, 40, 'hash полный (для amend/report)');
    assert.equal(ack.applied.subject, 'feat: тест');
    assert.deepEqual(ack.applied.paths, ['a.txt']);
    assert.equal(commitCount(root), before + 1, 'создан ровно один коммит');

    const body = git(root, 'log', '-1', '--pretty=%B');
    assert.match(body, /Co-authored-by: vibelog-agent <vb@xw2\.ru>/, 'трейлер дописан кодом');
    const files = git(root, '-c', 'core.quotePath=false', 'show', '--name-only', '--pretty=format:', 'HEAD')
      .split('\n')
      .filter(Boolean);
    assert.deepEqual(files, ['a.txt'], 'в коммите только переданный путь');
  });

  it('AC3: commit_coauthor: false в settings → коммит без трейлера', () => {
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    writeFileSync(join(root, '.vibelog', 'settings.json'), JSON.stringify({ commit_coauthor: false }), 'utf-8');
    writeFileSync(join(root, 'a.txt'), 'three\n', 'utf-8');

    const ack = parseAck(commitFiles(root, { paths: ['a.txt'], message: 'fix: без трейлера', taskId: '' }));
    assert.equal(ack.ok, true);
    const body = git(root, 'log', '-1', '--pretty=%B');
    assert.ok(!body.includes('Co-authored-by'), `трейлер должен быть выключен: ${body}`);
  });

  it('AC3/lesson-177: amend сохраняет тело (%B) и не дублирует трейлер', () => {
    writeFileSync(join(root, 'a.txt'), 'four\n', 'utf-8');
    const first = parseAck(commitFiles(root, { paths: ['a.txt'], message: 'feat: тема\n\nтело первого коммита' }));
    assert.equal(first.ok, true, JSON.stringify(first));
    const before = commitCount(root);

    // Повторный amend тем же сообщением: трейлер уже в HEAD — дубля быть не должно
    const amended = parseAck(commitFiles(root, {
      paths: ['a.txt'],
      message: 'feat: тема\n\nтело первого коммита',
      amend: true,
    }));
    assert.equal(amended.ok, true, JSON.stringify(amended));
    assert.equal(amended.applied.amended, true, 'флаг amended в ответе');
    assert.equal(commitCount(root), before, 'amend не добавляет коммит');

    const body = git(root, 'log', '-1', '--pretty=%B');
    assert.match(body, /тело первого коммита/, 'тело исходного коммита сохранено');
    const trailers = body.split('\n').filter(l => l.includes('Co-authored-by: vibelog-agent'));
    assert.equal(trailers.length, 1, `трейлер не должен дублироваться: ${body}`);
  });

  it('AC3: amend сохраняет тело, когда message переопределяет только тему', () => {
    writeFileSync(join(root, 'a.txt'), 'five\n', 'utf-8');
    assert.equal(parseAck(commitFiles(root, { paths: ['a.txt'], message: 'feat: старое\n\nстарое тело' })).ok, true);

    const before = commitCount(root);
    const ack = parseAck(commitFiles(root, { paths: ['a.txt'], message: 'feat: новое', amend: true }));
    assert.equal(ack.ok, true, JSON.stringify(ack));
    assert.equal(commitCount(root), before);
    assert.equal(git(root, 'log', '-1', '--pretty=%s'), 'feat: новое', 'тема обновлена');
    const body = git(root, 'log', '-1', '--pretty=%B');
    assert.match(body, /старое тело/, 'тело исходного коммита не потеряно (lesson-177)');
    assert.match(body, /Co-authored-by: vibelog-agent/);
    assert.equal(body.split('\n').filter(l => l.includes('Co-authored-by: vibelog-agent')).length, 1);
  });

  it('AC4: чужой путь (вне modified_files) → отказ с перечислением, allowForeign → коммит', () => {
    const task = createTaskFile(root, { id: 'VL-700', title: 'Задача коммита', modified_files: ['a.txt'] });
    writeFileSync(join(root, 'b.txt'), 'foreign\n', 'utf-8');
    git(root, 'add', 'b.txt');
    git(root, 'commit', '-q', '-m', 'add b');

    writeFileSync(join(root, 'a.txt'), 'six\n', 'utf-8');
    writeFileSync(join(root, 'b.txt'), 'foreign-edit\n', 'utf-8');
    const before = commitCount(root);

    const denied = parseAck(commitFiles(root, { paths: ['a.txt', 'b.txt'], message: 'feat: чужое', taskId: task.id }));
    assert.equal(denied.ok, false, JSON.stringify(denied));
    assert.match(denied.error, /не принадлежат задаче VL-700/);
    assert.match(denied.error, /b\.txt/, 'чужой путь перечислен');
    assert.match(denied.error, /allowForeign/, 'подсказка allowForeign');
    assert.equal(commitCount(root), before, 'отказ — коммита нет');

    const allowed = parseAck(commitFiles(root, {
      paths: ['a.txt', 'b.txt'],
      message: 'feat: чужое осознанно',
      taskId: task.id,
      allowForeign: true,
    }));
    assert.equal(allowed.ok, true, JSON.stringify(allowed));
    assert.equal(commitCount(root), before + 1);
  });

  it('AC4: пустой modified_files задачи → сверка не блокирует коммит', () => {
    const task = createTaskFile(root, { id: 'VL-701', title: 'Без modified_files' });
    writeFileSync(join(root, 'a.txt'), 'seven\n', 'utf-8');
    const ack = parseAck(commitFiles(root, { paths: ['a.txt'], message: 'feat: без сверки', taskId: task.id }));
    assert.equal(ack.ok, true, JSON.stringify(ack));
  });

  it('AC5/VL-310: нет изменений по путям → noop без коммита', async () => {
    const before = commitCount(root);
    const ack = parseAck(await handleToolCall('git_commit', { paths: ['a.txt'], message: 'feat: пусто' }, root));

    assert.equal(ack.ok, false, `noop — ошибка, а не успех: ${JSON.stringify(ack)}`);
    assert.equal(ack.noop, true);
    assert.equal(ack.reason, 'noop');
    assert.match(ack.message, /Изменений нет/, 'маркер noop-сообщений (VL-310)');
    assert.deepEqual(ack.applied.paths, ['a.txt']);
    assert.equal(commitCount(root), before, 'пустой коммит не создан');
  });

  it('AC2: путь вне проекта → отказ до git add', () => {
    const before = commitCount(root);
    const ack = parseAck(commitFiles(root, { paths: ['../outside.txt'], message: 'feat: наружу' }));
    assert.equal(ack.ok, false, JSON.stringify(ack));
    assert.match(ack.error, /выходит за пределы проекта/);
    assert.equal(commitCount(root), before);
  });

  it('AC2: git add -A, "." и флаги в paths отклоняются', () => {
    for (const bad of [['-A'], ['.'], ['--all'], ['-a'], ['-p']]) {
      const ack = parseAck(commitFiles(root, { paths: bad, message: 'feat: массовый add' }));
      assert.equal(ack.ok, false, `${bad.join()} должен быть отклонён: ${JSON.stringify(ack)}`);
      assert.match(ack.error, /git_commit: paths/, `${bad.join()}: понятная ошибка про paths`);
    }
    assert.equal(commitCount(root), 1, 'ни одного коммита не создано');
  });

  it('AC1/AC2: paths обязателен и непуст, message обязателен', () => {
    const empty = parseAck(commitFiles(root, { paths: [], message: 'feat: пустой список' }));
    assert.equal(empty.ok, false);
    assert.match(empty.error, /paths обязателен/);

    const noMessage = parseAck(commitFiles(root, { paths: ['a.txt'], message: '   ' }));
    assert.equal(noMessage.ok, false);
    assert.match(noMessage.error, /message/);

    const notArray = parseAck(commitFiles(root, { paths: 'a.txt', message: 'feat: строка' }));
    assert.equal(notArray.ok, false);
  });

  it('AC2: посторонний staged-файл чужих процессов → отказ, свой коммит не создан', () => {
    writeFileSync(join(root, 'a.txt'), 'eight\n', 'utf-8');
    writeFileSync(join(root, 'b.txt'), 'staged by someone\n', 'utf-8');
    git(root, 'add', 'b.txt'); // чужой процесс успел проиндексировать свой файл
    const before = commitCount(root);

    const ack = parseAck(commitFiles(root, { paths: ['a.txt'], message: 'feat: только a' }));
    assert.equal(ack.ok, false, JSON.stringify(ack));
    assert.match(ack.error, /посторонние файлы/);
    assert.match(ack.error, /b\.txt/);
    assert.equal(commitCount(root), before, 'коммит с чужим файлом не создан');
  });

  it('AC7/AC8: схема инструмента и классификация (write, не в grant)', () => {
    const tool = listTools().find(t => t.name === 'git_commit');
    assert.ok(tool, 'git_commit зарегистрирован в реестре MCP');
    assert.deepEqual(tool.inputSchema.required, ['paths', 'message']);
    for (const field of ['paths', 'message', 'amend', 'allowForeign']) {
      assert.ok(tool.inputSchema.properties[field], `поле ${field} в схеме`);
    }
  });

  it('foreignPaths: директория в modified_files покрывает файлы под ней', () => {
    const task = createTaskFile(root, { id: 'VL-702', title: 'Каталог в файлах', modified_files: ['src/mcp'] });
    assert.deepEqual(foreignPaths(root, task.id, ['src/mcp/git-commit.ts']), []);
    assert.deepEqual(foreignPaths(root, task.id, ['src/web/chat.ts']), ['src/web/chat.ts']);
    assert.deepEqual(foreignPaths(root, 'VL-999', ['src/web/chat.ts']), [], 'задача не читается — сверка пропускается');
  });
});