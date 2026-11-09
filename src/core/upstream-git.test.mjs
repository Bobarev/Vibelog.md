/**
 * Тесты git-транспорта баг-репортов (VL-375).
 *
 * Проверяется поведение из AC:
 *   1. создание отчёта + коммит + push в локальный bare-репозиторий;
 *   2. идемпотентность по `report_id` (второй writeReport не создаёт файл);
 *   3. `listIncoming` фильтрует по `target` и `status: open`;
 *   4. `ackReport` меняет ТОЛЬКО `status`/`accepted_as` (остальное байт-в-байт);
 *   5. `ensureInboxClone` создаёт клон / обновляет существующий;
 *   6. `git add` берёт только файл отчёта (мусор в рабочем дереве не попадает);
 *   7. чистые функции: slugify (кириллица → латиница), parse/serialize round-trip,
 *      паритет с образцом отчёта (источник истины формата — код).
 *
 * Фикстура — локальный bare-репозиторий рядом с проектом (приём git-commit.test.mjs):
 * сеть не нужна, push идёт в файловый путь. Каталог — mkdtempSync (VL-241).
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  INBOX_DIR,
  UpstreamGitError,
  ackReport,
  ensureInboxClone,
  listIncoming,
  normalizeAcceptedAs,
  parseReport,
  replaceAckFields,
  reportId,
  reportRelPath,
  serializeReport,
  slugify,
  targetMatches,
  writeReport,
} from '../../dist/core/upstream-git.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** git в каталоге (без шелла, пути аргументами). */
function git(cwd, ...args) {
  return execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Создаёт bare-инбокс с начальным коммитом и пустой проект-источник. */
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'vibelog-upstream-git-'));
  const remote = join(root, 'inbox.git');
  const seed = join(root, 'seed');
  const project = join(root, 'project');

  execFileSync('/usr/bin/git', ['init', '-q', '--bare', remote]);
  mkdirSync(seed, { recursive: true });
  execFileSync('/usr/bin/git', ['init', '-q'], { cwd: seed });
  git(seed, 'config', 'user.email', 'test@example.com');
  git(seed, 'config', 'user.name', 'Test');
  writeFileSync(join(seed, 'README.md'), '# Inbox\n', 'utf8');
  git(seed, 'add', 'README.md');
  git(seed, 'commit', '-q', '-m', 'init');
  git(seed, 'remote', 'add', 'origin', remote);
  git(seed, 'push', '-q', 'origin', 'HEAD:main');
  execFileSync('/usr/bin/git', ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);

  mkdirSync(join(project, 'backlog'), { recursive: true });
  writeFileSync(
    join(project, 'backlog', 'config.yml'),
    'project_name: Vibelog UI\ntask_prefix: ui\ndefault_status: To Do\nstatuses:\n  - To Do\n  - Done\n',
    'utf8',
  );
  return { root, remote, project, cfg: { mode: 'git', inbox: remote, prefix: 'ui' } };
}

describe('VL-375 — чистые функции формата отчёта', () => {
  it('AC2: slugify даёт только [a-z0-9-], кириллица транслитерируется', () => {
    assert.equal(slugify('git_commit падает на кириллице'), 'git-commit-padaet-na-kirillitse');
    assert.match(slugify('Шаблон не собирается'), /^[a-z0-9-]+$/);
    assert.match(slugify('!!! ???'), /^[a-z0-9-]+$/);
    assert.equal(slugify(''), 'report');
    // длина ограничена: длинные заголовки не ломают имя файла
    assert.ok(slugify('a'.repeat(200)).length <= 60);
  });

  it('AC2: reportId — sha1 от source_project+source_task+title', () => {
    const a = reportId({ source_project: 'Vibelog UI', source_task: 'UI-12', title: 'Баг' });
    const b = reportId({ source_project: 'Vibelog UI', source_task: 'UI-12', title: 'Баг' });
    const c = reportId({ source_project: 'Vibelog UI', source_task: 'UI-13', title: 'Баг' });
    assert.equal(a, b, 'одни и те же данные → один id');
    assert.notEqual(a, c, 'разные задачи → разные id');
    assert.match(a, /^[0-9a-f]{40}$/);
  });

  it('AC1: serializeReport → parseReport round-trip без потерь', () => {
    const report = {
      report_id: 'a'.repeat(40),
      source_project: 'Vibelog UI',
      source_prefix: 'ui',
      source_task: 'UI-12',
      title: 'git_commit падает на кириллице',
      target: 'vl',
      severity: 'high',
      area: 'mcp',
      created: '2026-11-08',
      status: 'open',
      accepted_as: '',
      rejected_reason: '',
      body: '## Что произошло\n\nПодробности\n',
    };
    const parsed = parseReport(serializeReport(report));
    assert.deepEqual(parsed, { ...report, body: '## Что произошло\n\nПодробности' });
  });

  it('AC1: reportRelPath — дата + task + slug, каталог = префикс', () => {
    const path = reportRelPath({
      report_id: 'x',
      source_project: 'Vibelog UI',
      source_prefix: 'ui',
      source_task: 'UI-12',
      title: 'Кнопка не работает',
      target: 'vl',
      severity: '',
      area: '',
      created: '2026-11-08',
      status: 'open',
      accepted_as: '',
      body: '',
    });
    assert.equal(path, 'reports/ui/2026-11-08-UI-12-knopka-ne-rabotaet.md');
    assert.match(path, /^reports\/ui\/[A-Za-z0-9._/-]+$/);
  });

  it('AC10: образец отчёта парсится без потери полей (паритет с кодом)', () => {
    const sample = readFileSync(join(__dirname, 'fixtures', 'reports', 'vl', '2026-11-08-VL-375-example.md'), 'utf8');
    const parsed = parseReport(sample);
    for (const field of [
      'report_id', 'source_project', 'source_prefix', 'source_task', 'title',
      'target', 'severity', 'area', 'created', 'status', 'accepted_as', 'rejected_reason',
    ]) {
      assert.ok(field in parsed, `поле ${field} не распарсилось`);
      assert.notEqual(parsed[field], undefined, `поле ${field} пусто`);
    }
    assert.equal(parsed.source_prefix, 'ui');
    assert.equal(parsed.target, 'vl');
    assert.equal(parsed.status, 'open');
    assert.equal(parsed.accepted_as, '');
    assert.equal(parsed.rejected_reason, '');
    assert.match(parsed.body, /## Что произошло/);
    // round-trip сериализации даёт тот же фронтматтер по полям
    assert.deepEqual(parseReport(serializeReport(parsed)), parsed);
  });

  it('targetMatches: префикс, имя проекта и регистр', () => {
    assert.equal(targetMatches('vl', 'vl'), true);
    assert.equal(targetMatches('VL', 'vl'), true);
    assert.equal(targetMatches('Vibelog UI', 'ui'), true);
    assert.equal(targetMatches('templates', 'ui'), false);
    assert.equal(targetMatches('', 'ui'), false);
  });

  it('replaceAckFields меняет только две строки', () => {
    const text = serializeReport({
      report_id: 'b'.repeat(40),
      source_project: 'Vibelog UI',
      source_prefix: 'ui',
      source_task: 'UI-12',
      title: 'Баг',
      target: 'vl',
      severity: 'high',
      area: 'mcp',
      created: '2026-11-08',
      status: 'open',
      accepted_as: '',
      rejected_reason: '',
      body: 'тело',
    });
    const updated = replaceAckFields(text, { status: 'accepted', acceptedAs: 'VL-367' });
    const before = text.split('\n');
    const after = updated.split('\n');
    assert.equal(before.length, after.length, 'число строк не меняется');
    const changed = before.map((line, i) => (line === after[i] ? null : i)).filter((i) => i !== null);
    assert.equal(changed.length, 2, `изменено строк: ${changed.length}`);
    assert.equal(after[changed[0]] === 'status: accepted' || after[changed[1]] === 'status: accepted', true);
    assert.equal(after[changed[0]] === 'accepted_as: VL-367' || after[changed[1]] === 'accepted_as: VL-367', true);
    assert.equal(parseReport(updated).status, 'accepted');
    assert.equal(parseReport(updated).accepted_as, 'VL-367');
  });
});

describe('VL-375 — git-транспорт на локальном инбоксе', () => {
  let fx;

  beforeEach(() => {
    fx = makeFixture();
  });

  afterEach(() => {
    rmSync(fx.root, { recursive: true, force: true });
  });

  it('AC1/AC9: ensureInboxClone создаёт клон, повторно — обновляет', () => {
    const first = ensureInboxClone(fx.project, fx.cfg);
    assert.equal(first.created, true);
    assert.ok(readFileSync(join(first.path, 'README.md'), 'utf8').includes('Inbox'));
    assert.ok(first.path.endsWith(INBOX_DIR), 'клон внутри проекта-источника');

    const second = ensureInboxClone(fx.project, fx.cfg);
    assert.equal(second.created, false, 'второй вызов — только pull --rebase');
  });

  it('AC1/AC3: writeReport пишет файл, коммитит и пушит только его', () => {
    const result = writeReport(fx.project, fx.cfg, {
      source_task: 'UI-12',
      title: 'Кнопка не работает',
      target: 'vl',
      body: 'при клике ничего',
      severity: 'high',
      area: 'web',
      created: '2026-11-08',
    });
    assert.equal(result.created, true);
    assert.equal(result.path, 'reports/ui/2026-11-08-UI-12-knopka-ne-rabotaet.md');

    const inbox = join(fx.project, INBOX_DIR);
    // мусор в рабочем дереве клона не должен попасть в коммит (git add явным путём)
    writeFileSync(join(inbox, 'junk.txt'), 'мусор\n', 'utf8');

    const committed = git(inbox, 'show', '--name-only', '--pretty=format:', 'HEAD')
      .split('\n')
      .filter(Boolean);
    assert.deepEqual(committed, [result.path], 'в коммите ровно один файл отчёта');

    // push дошёл до bare-репозитория
    const remoteFiles = git(fx.remote, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n');
    assert.ok(remoteFiles.includes(result.path), `файл не отправлен в инбокс: ${remoteFiles.join(', ')}`);

    const parsed = parseReport(readFileSync(join(inbox, result.path), 'utf8'));
    assert.equal(parsed.source_prefix, 'ui');
    assert.equal(parsed.source_project, 'Vibelog UI');
    assert.equal(parsed.status, 'open');
    assert.equal(parsed.accepted_as, '');
  });

  it('AC2: повторный writeReport идемпотентен по report_id', () => {
    const input = { source_task: 'UI-12', title: 'Кнопка не работает', target: 'vl' };
    const first = writeReport(fx.project, fx.cfg, { ...input, created: '2026-11-08' });
    assert.equal(first.created, true);
    const commitsBefore = Number(git(join(fx.project, INBOX_DIR), 'rev-list', '--count', 'HEAD'));

    const second = writeReport(fx.project, fx.cfg, { ...input, created: '2026-11-09' });
    assert.equal(second.created, false, 'второй отчёт не создаётся');
    assert.equal(second.path, first.path, 'путь существующего отчёта');
    const commitsAfter = Number(git(join(fx.project, INBOX_DIR), 'rev-list', '--count', 'HEAD'));
    assert.equal(commitsAfter, commitsBefore, 'нового коммита нет');
  });

  it('AC1: listIncoming фильтрует по target и status: open', () => {
    writeReport(fx.project, fx.cfg, { source_task: 'UI-1', title: 'Для vl', target: 'vl', created: '2026-11-08' });
    writeReport(fx.project, fx.cfg, { source_task: 'UI-2', title: 'Для tpl', target: 'tpl', created: '2026-11-09' });
    const incoming = listIncoming(fx.project, 'vl');
    assert.equal(incoming.length, 1);
    assert.equal(incoming[0].source_task, 'UI-1');

    // после ack отчёт уходит из входящих
    ackReport(fx.project, incoming[0].report_id, 'VL-999');
    assert.deepEqual(listIncoming(fx.project, 'vl'), []);
  });

  it('AC1/AC9: ackReport меняет только status/accepted_as (тело байт-в-байт)', () => {
    const written = writeReport(fx.project, fx.cfg, {
      source_task: 'UI-3',
      title: 'Шаблон не собирается',
      target: 'vl',
      body: '## Что произошло\n\nсборка падает',
      severity: 'high',
      area: 'install',
      created: '2026-11-08',
    });
    const abs = join(fx.project, INBOX_DIR, written.path);
    const before = readFileSync(abs, 'utf8');
    const id = parseReport(before).report_id;

    const res = ackReport(fx.project, id, 'VL-367');
    assert.equal(res.report.accepted_as, 'VL-367');
    assert.equal(res.report.status, 'accepted');

    const after = readFileSync(abs, 'utf8');
    const pick = (text) => text.split('\n').filter((line) => !/^(status|accepted_as|rejected_reason):/.test(line));
    assert.deepEqual(pick(after), pick(before), 'остальное тело изменилось');
    assert.match(serializeReport(parseReport(after)), /status: accepted/);

    // ack ушёл в инбокс
    const remoteText = git(fx.remote, 'show', `HEAD:${written.path}`);
    assert.match(remoteText, /accepted_as: VL-367/);
  });

  it('AC1: ackReport по неизвестному id → понятная ошибка', () => {
    ensureInboxClone(fx.project, fx.cfg);
    assert.throws(
      () => ackReport(fx.project, 'deadbeef', 'VL-1'),
      (err) => err instanceof UpstreamGitError && /не найден/.test(err.message),
    );
  });

  // --- VL-388: поиск по префиксу report_id и валидация --as ---

  /** Кладёт отчёт прямо в клон инбокса (без коммита) — фикстура поиска по id. */
  function writeRawReport(report) {
    const inbox = ensureInboxClone(fx.project, fx.cfg).path;
    const rel = `reports/vl/${report.created}-${report.source_task}-${report.report_id.slice(0, 6)}.md`;
    mkdirSync(join(inbox, 'reports', 'vl'), { recursive: true });
    writeFileSync(join(inbox, rel), serializeReport(report), 'utf-8');
    return rel;
  }

  /** Отчёт-фикстура с заданным report_id. */
  function rawReport(report_id, source_task, title) {
    return {
      report_id,
      source_project: 'Vibelog UI',
      source_prefix: 'ui',
      source_task,
      title,
      target: 'vl',
      severity: 'medium',
      area: 'cli',
      created: '2026-11-08',
      status: 'open',
      accepted_as: '',
      body: 'тело',
    };
  }

  it('VL-388 AC1: ack принимает 8-символьный префикс report_id (как его печатает pull)', () => {
    const written = writeReport(fx.project, fx.cfg, {
      source_task: 'UI-5', title: 'Отчёт для префикса', target: 'vl', created: '2026-11-08',
    });
    const fullId = parseReport(readFileSync(join(fx.project, INBOX_DIR, written.path), 'utf8')).report_id;
    const res = ackReport(fx.project, fullId.slice(0, 8), 'VL-388');
    assert.equal(res.report.accepted_as, 'VL-388');
    assert.equal(res.report.status, 'accepted');
    assert.equal(res.report.report_id, fullId, 'подтверждён именно этот отчёт');
  });

  it('VL-388 AC3: ack по полному id работает как раньше', () => {
    const written = writeReport(fx.project, fx.cfg, {
      source_task: 'UI-6', title: 'Полный id', target: 'vl', created: '2026-11-08',
    });
    const fullId = parseReport(readFileSync(join(fx.project, INBOX_DIR, written.path), 'utf8')).report_id;
    const res = ackReport(fx.project, fullId, 'VL-388');
    assert.equal(res.report.accepted_as, 'VL-388');
  });

  it('VL-388 AC1: префикс регистронезависим (hex в верхнем регистре)', () => {
    const written = writeReport(fx.project, fx.cfg, {
      source_task: 'UI-7', title: 'Регистр id', target: 'vl', created: '2026-11-08',
    });
    const fullId = parseReport(readFileSync(join(fx.project, INBOX_DIR, written.path), 'utf8')).report_id;
    const upper = fullId.slice(0, 8).toUpperCase();
    if (upper !== fullId.slice(0, 8)) {
      const res = ackReport(fx.project, upper, 'VL-388');
      assert.equal(res.report.accepted_as, 'VL-388');
    }
  });

  it('VL-388 AC1: несуществующий префикс → «не найден»', () => {
    ensureInboxClone(fx.project, fx.cfg);
    assert.throws(
      () => ackReport(fx.project, 'deadbeef', 'VL-388'),
      (err) => err instanceof UpstreamGitError && /не найден/.test(err.message) && err.code === 2,
    );
  });

  it('VL-388 AC2: неоднозначный префикс → ошибка со списком кандидатов, код 2', () => {
    const firstId = `abcd${'1'.repeat(36)}`;
    const secondId = `abcd${'2'.repeat(36)}`;
    writeRawReport(rawReport(firstId, 'UI-11', 'Первый'));
    writeRawReport(rawReport(secondId, 'UI-12', 'Второй'));
    assert.throws(
      () => ackReport(fx.project, 'abcd', 'VL-388'),
      (err) =>
        err instanceof UpstreamGitError &&
        err.code === 2 &&
        /совпал с 2 отчётами/.test(err.message) &&
        err.message.includes(firstId) &&
        err.message.includes(secondId) &&
        err.message.includes('UI-11') &&
        err.message.includes('UI-12'),
    );
  });

  it('VL-388 AC2: префикс короче 4 символов → ошибка с минимумом длины, код 2', () => {
    const id = `abc${'3'.repeat(37)}`;
    writeRawReport(rawReport(id, 'UI-13', 'Короткий префикс'));
    assert.throws(
      () => ackReport(fx.project, 'abc', 'VL-388'),
      (err) => err instanceof UpstreamGitError && /слишком короткий/.test(err.message) && err.code === 2,
    );
  });

  it('VL-388 AC4: writeReport идемпотентен точно по report_id, префикс не склеивает отчёты', () => {
    const shared = `ffff${'0'.repeat(36)}`;
    writeRawReport(rawReport(shared, 'UI-21', 'Общий префикс'));
    // новый отчёт с тем же началом id не должен считаться «уже есть»
    const result = writeReport(fx.project, fx.cfg, {
      source_task: 'UI-22', title: 'Другой отчёт', target: 'vl', created: '2026-11-08',
    });
    assert.equal(result.created, true, 'writeReport не склеил отчёт по префиксу');
    // повторное создание того же отчёта — по-прежнему идемпотентно
    const again = writeReport(fx.project, fx.cfg, {
      source_task: 'UI-22', title: 'Другой отчёт', target: 'vl', created: '2026-11-09',
    });
    assert.equal(again.created, false);
    assert.equal(again.path, result.path);
  });

  it('VL-388 AC5: формат --as валидируется и нормализуется', () => {
    assert.equal(normalizeAcceptedAs('VL-388'), 'VL-388');
    assert.equal(normalizeAcceptedAs('vl-388'), 'VL-388', 'префикс нормализуется в верхний регистр');
    assert.equal(normalizeAcceptedAs('  UI-444  '), 'UI-444', 'чужой префикс допустим');
    for (const bad of ['VL_388', 'VL388', 'vl 388', 'что угодно', '-388', 'VL-', '']) {
      assert.throws(
        () => normalizeAcceptedAs(bad),
        (err) => err instanceof UpstreamGitError && err.code === 1,
        `значение «${bad}» должно быть отвергнуто`,
      );
    }
    assert.throws(() => normalizeAcceptedAs(''), /--as/);
  });

  it('VL-388 AC1: ackReport отвергает неверный формат --as до записи файла', () => {
    const written = writeReport(fx.project, fx.cfg, {
      source_task: 'UI-31', title: 'Неверный --as', target: 'vl', created: '2026-11-08',
    });
    const abs = join(fx.project, INBOX_DIR, written.path);
    const before = readFileSync(abs, 'utf8');
    assert.throws(
      () => ackReport(fx.project, parseReport(before).report_id, 'VL_388'),
      (err) => err instanceof UpstreamGitError && err.code === 1,
    );
    assert.equal(readFileSync(abs, 'utf8'), before, 'файл не изменён при неверном --as');
  });

  it('AC1: ensureInboxClone с битым адресом → UpstreamGitError kind network/auth', () => {
    assert.throws(
      () => ensureInboxClone(fx.project, { ...fx.cfg, inbox: join(fx.root, 'nope.git') }),
      (err) => err instanceof UpstreamGitError && ['network', 'auth'].includes(err.kind),
    );
  });
});

// ============================================================
// VL-391 — приём отчёта: accept/reject, rejected_reason, includeResolved
// ============================================================

describe('VL-391 — accept/reject и список решённых отчётов', () => {
  let fx;

  beforeEach(() => {
    fx = makeFixture();
  });

  afterEach(() => {
    rmSync(fx.root, { recursive: true, force: true });
  });

  /** Создаёт отчёт об ошибке в инбоксе и возвращает его id и путь. */
  function seed(task = 'UI-41', title = 'Отчёт для приёма') {
    const written = writeReport(fx.project, fx.cfg, {
      source_task: task,
      title,
      target: 'vl',
      body: '## Что произошло\n\nсломано',
      severity: 'high',
      area: 'cli',
      created: '2026-11-08',
    });
    const abs = join(fx.project, INBOX_DIR, written.path);
    return { abs, id: parseReport(readFileSync(abs, 'utf8')).report_id, path: written.path, task };
  }

  it('AC11/AC5: accept пишет status+accepted_as и чистит rejected_reason', () => {
    const { abs, id } = seed();
    const res = ackReport(fx.project, id, { action: 'accept', taskId: 'VL-391' });
    assert.equal(res.report.status, 'accepted');
    assert.equal(res.report.accepted_as, 'VL-391');
    assert.equal(res.report.rejected_reason, '');

    const text = readFileSync(abs, 'utf8');
    assert.match(text, /^status: accepted$/m);
    assert.match(text, /^accepted_as: VL-391$/m);
    assert.match(text, /^rejected_reason: ""$/m);
  });

  it('AC11/AC6: reject пишет rejected_reason и чистит accepted_as', () => {
    const { abs, id } = seed();
    const res = ackReport(fx.project, id, { action: 'reject', reason: 'не воспроизводится на master' });
    assert.equal(res.report.status, 'rejected');
    assert.equal(res.report.rejected_reason, 'не воспроизводится на master');
    assert.equal(res.report.accepted_as, '');

    const text = readFileSync(abs, 'utf8');
    assert.match(text, /^status: rejected$/m);
    assert.match(text, /^accepted_as: ""$/m);
    assert.match(text, /^rejected_reason: не воспроизводится на master$/m);
  });

  it('AC6: accept после reject очищает rejected_reason (взаимоисключение)', () => {
    const { abs, id } = seed('UI-42', 'Сначала отклонили');
    ackReport(fx.project, id, { action: 'reject', reason: 'нужны шаги' });
    assert.match(readFileSync(abs, 'utf8'), /status: rejected/);

    const res = ackReport(fx.project, id, { action: 'accept', taskId: 'VL-392' });
    assert.equal(res.report.status, 'accepted');
    assert.equal(res.report.accepted_as, 'VL-392');
    assert.equal(res.report.rejected_reason, '', 'причина отказа вычищена');
    assert.doesNotMatch(readFileSync(abs, 'utf8'), /нужны шаги/);
  });

  it('AC6: reject на старом отчёте без rejected_reason дописывает поле в конец фронтматтера', () => {
    const inbox = ensureInboxClone(fx.project, fx.cfg).path;
    const id = `abc${'4'.repeat(37)}`;
    const legacy = [
      '---',
      `report_id: ${id}`,
      'source_project: Vibelog UI',
      'source_prefix: ui',
      'source_task: UI-43',
      'title: Старый формат',
      'target: vl',
      'severity: medium',
      'area: cli',
      'created: 2026-11-08',
      'status: open',
      'accepted_as: ""',
      '---',
      '',
      'тело',
      '',
    ].join('\n');
    const rel = 'reports/ui/2026-11-08-UI-43-staryi-format.md';
    mkdirSync(join(inbox, 'reports', 'ui'), { recursive: true });
    writeFileSync(join(inbox, rel), legacy, 'utf-8');

    const res = ackReport(fx.project, id, { action: 'reject', reason: 'устарело' });
    assert.equal(res.report.status, 'rejected');
    assert.equal(res.report.rejected_reason, 'устарело');

    const text = readFileSync(join(inbox, rel), 'utf8');
    const lines = text.split('\n');
    const yamlEnd = lines.findIndex((line, i) => i > 0 && line === '---');
    assert.equal(lines[yamlEnd - 1], 'rejected_reason: устарело', 'поле дописано последним во фронтматтере');
    assert.equal(lines[yamlEnd + 1], '', 'тело не сместилось относительно закрывающего ---');
    assert.equal(parseReport(text).report_id, id, 'файл остался валидным');
  });

  it('AC11: listIncoming по умолчанию не показывает rejected, includeResolved показывает', () => {
    const rejected = seed('UI-44', 'Будет отклонён');
    const accepted = seed('UI-45', 'Будет принят');
    const open = seed('UI-46', 'Останется открытым');
    ackReport(fx.project, rejected.id, { action: 'reject', reason: 'не наш баг' });
    ackReport(fx.project, accepted.id, { action: 'accept', taskId: 'VL-393' });

    const openOnly = listIncoming(fx.project, 'vl');
    assert.deepEqual(openOnly.map((r) => r.source_task), [open.task], 'только открытые');

    const all = listIncoming(fx.project, 'vl', { includeResolved: true });
    assert.deepEqual(
      all.map((r) => `${r.source_task}:${r.status}`).sort(),
      ['UI-44:rejected', 'UI-45:accepted', 'UI-46:open'],
    );
  });
});
