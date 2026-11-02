/**
 * Тесты VL-254 — прогресс фазы до обрыва (src/agent/run-progress.ts).
 *
 * AC4: при обрыве по wall-time/max-requests формируется блок «что сделано /
 * что осталось»; незакоммиченные изменения фазы code коммитятся в ветку,
 * файлы backlog/ в коммит не попадают.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  appendCommitToProgress,
  buildRunProgress,
  commitProgressChanges,
  committablePaths,
} from '../../dist/agent/run-progress.js';

/** assistant-сообщение с tool_call'ами. */
function assistant(calls = [], content = null) {
  return {
    role: 'assistant',
    content,
    tool_calls: calls.map(([name, args], i) => ({ id: `c${i}`, name, arguments: args })),
  };
}

/** git в тестовом каталоге (без наследования глобального конфига шума). */
function git(cwd, ...args) {
  return execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8' });
}

describe('VL-254 — buildRunProgress', () => {
  it('done собирается из путей edit/write_file и последней реплики модели', () => {
    const progress = buildRunProgress({
      messages: [
        { role: 'user', content: 'задача' },
        assistant([['edit', { path: 'src/a.ts' }], ['write_file', { path: 'src/b.ts' }]], 'правлю тест'),
        assistant([['run_shell_command', { command: 'pnpm test' }]], 'запускаю полный прогон'),
      ],
      reason: 'wall-time',
      durationMs: 240_000,
      payloadBytes: 486_004,
    });
    assert.equal(progress.reason, 'wall-time');
    assert.deepEqual(progress.done, ['src/a.ts', 'src/b.ts', 'запускаю полный прогон']);
    assert.match(progress.text, /Сделано/);
    assert.match(progress.text, /Осталось/);
    assert.match(progress.text, /wall-time/);
    assert.match(progress.text, /payload 486004 байт/);
    assert.match(progress.text, /отчёт фазы/);
    assert.equal(progress.pending.length, 3);
    assert.equal(progress.commit, null);
  });

  it('VL-274: reason=idle → подпись «по idle-таймауту», отдельная от wall-time', () => {
    const progress = buildRunProgress({ messages: [], reason: 'idle', durationMs: 610_000 });
    assert.equal(progress.reason, 'idle');
    assert.match(progress.text, /по idle-таймауту \(простой без активности\)/);
    assert.doesNotMatch(progress.text, /по лимиту wall-time/);
  });

  it('пустой ран: маркеры на месте, «правок нет»', () => {
    const progress = buildRunProgress({ messages: [], reason: 'max-requests' });
    assert.match(progress.text, /Сделано/);
    assert.match(progress.text, /Осталось/);
    assert.match(progress.text, /правок и реплик модели в ране нет/);
    assert.match(progress.text, /LLM-запросов/);
  });

  it('длинная реплика усечена, фантомные tool_calls не считаются', () => {
    const progress = buildRunProgress({
      messages: [
        { role: 'assistant', content: 'x'.repeat(1000), tool_calls: [{ id: '', name: '', arguments: {} }] },
      ],
      reason: 'other',
    });
    assert.equal(progress.done.length, 1);
    assert.ok(progress.done[0].length <= 301);
  });

  it('appendCommitToProgress дописывает хэш в текст; null — без изменений', () => {
    const base = buildRunProgress({ messages: [], reason: 'wall-time' });
    assert.equal(appendCommitToProgress(base, null).text, base.text);
    const withCommit = appendCommitToProgress(base, 'abc1234');
    assert.equal(withCommit.commit, 'abc1234');
    assert.match(withCommit.text, /abc1234/);
    assert.match(withCommit.text, /Незакоммиченные изменения сохранены/);
  });
});

describe('VL-254 — commitProgressChanges (git в tmp)', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vibelog-run-progress-'));
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    writeFileSync(join(dir, 'README.md'), 'init\n', 'utf-8');
    git(dir, 'add', 'README.md');
    git(dir, 'commit', '-q', '-m', 'init');
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('пустой статус → null и committablePaths пуст', () => {
    assert.deepEqual(committablePaths(dir), []);
    assert.equal(commitProgressChanges(dir, 'VL-254', 'wall-time'), null);
  });

  it('AC4: правки фазы code коммитятся, backlog/ исключается', () => {
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf-8');
    mkdirSync(join(dir, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'backlog', 'tasks', 'vl-254.md'), '# задача\n', 'utf-8');
    assert.deepEqual(committablePaths(dir), ['src/a.ts']);
    const hash = commitProgressChanges(dir, 'VL-254', 'wall-time');
    assert.ok(hash && /^[0-9a-f]{7,}$/.test(hash), 'возвращается short-hash');
    const log = git(dir, 'log', '-1', '--pretty=%s');
    assert.match(log, /wip\(VL-254\): прогресс фазы code до обрыва \(wall-time\)/);
    const committed = git(dir, 'show', '--name-only', '--pretty=format:', 'HEAD');
    assert.match(committed, /src\/a\.ts/);
    assert.doesNotMatch(committed, /backlog\//);
    // backlog-файл остался в рабочем дереве, но отфильтрован из коммитимых
    assert.deepEqual(committablePaths(dir), []);
    // повторный вызов не создаёт коммит (коммитимых путей нет)
    assert.equal(commitProgressChanges(dir, 'VL-254', 'wall-time'), null);
  });

  it('VL-302: WIP-коммит содержит трейлер Co-authored-by', () => {
    writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = 2;\n', 'utf-8');
    assert.ok(commitProgressChanges(dir, 'VL-302', 'max-requests'));
    const body = git(dir, 'log', '-1', '--pretty=%B');
    assert.match(body, /wip\(VL-302\): прогресс фазы code до обрыва \(max-requests\)/);
    assert.match(body, /Co-authored-by: vibelog-agent <vb@xw2\.ru>/);
  });
});
