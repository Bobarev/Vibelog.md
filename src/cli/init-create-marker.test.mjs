/**
 * Тесты маркера `VIBELOG_CREATE` в выводе `vibelog init` (VL-389).
 *
 * `postCreate` шаблона вызывает `vb init --components --yes` внутри
 * `vb create`. Без маркера `init` ведёт себя как самостоятельная команда и
 * печатает два ложных сигнала: «Проект не в git: .env с секретами не
 * защищён» (репозиторий создаст сам `create` через два шага) и вторую
 * подсказку «Дальше: vibelog task create …» (сразу за ней идёт итоговый блок
 * `create` со своим «Дальше: cd …»).
 *
 * Спавнится реальный CLI в mkdtemp-каталоге; env — только через
 * `testSpawnEnv()` (VL-286), маркер передаётся в `extra`.
 */

import { describe, it, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = mkdtempSync(join(tmpdir(), 'vibelog-init-marker-'));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');

/** Текст предупреждения VL-348 (ищем по устойчивому фрагменту). */
const GIT_WARNING = 'Проект не в git';
/** Финальная подсказка `init`, которую подавляем внутри `create`. */
const NEXT_HINT = 'Дальше: vibelog task create';

/** Чистая директория теста. */
function fresh() {
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(testDir, { recursive: true });
  return testDir;
}

/** Запуск CLI в тестовом каталоге: { out, code }. */
function runCli(args, extraEnv = {}) {
  const r = spawnSync('node', [cliPath, ...args], {
    cwd: testDir,
    encoding: 'utf-8',
    timeout: 60000,
    env: testSpawnEnv(extraEnv),
  });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}

describe('VL-389 — маркер VIBELOG_CREATE в vibelog init', () => {
  beforeEach(() => {
    fresh();
  });
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('AC1/AC2/AC6/AC7: с маркером 1 вне git — без предупреждения о git и без второй подсказки, код 0', () => {
    const { out, code } = runCli(['init', 'MarkerProj', '--prefix', 'mp', '--yes'], {
      VIBELOG_CREATE: '1',
    });
    assert.equal(code, 0, out);
    assert.ok(!out.includes(GIT_WARNING), `ложное предупреждение о git: ${out}`);
    assert.ok(!out.includes(NEXT_HINT), `дубль подсказки «Дальше»: ${out}`);
  });

  it('AC5: без маркера вне git — предупреждение на месте (VL-348 не сломан)', () => {
    const { out, code } = runCli(['init', 'PlainProj', '--prefix', 'pp', '--yes']);
    assert.equal(code, 0, out);
    assert.ok(out.includes(GIT_WARNING), out);
    assert.ok(out.includes(NEXT_HINT), out);
  });

  it('AC3: маркер no-git (vb create --no-git) — предупреждение НЕ подавляется', () => {
    const { out, code } = runCli(['init', 'NoGitProj', '--prefix', 'np', '--yes'], {
      VIBELOG_CREATE: 'no-git',
    });
    assert.equal(code, 0, out);
    assert.ok(out.includes(GIT_WARNING), out);
  });

  it('AC8: --git-init + маркер — предупреждения нет', () => {
    const { out, code } = runCli(
      ['init', 'GitMarkerProj', '--prefix', 'gp', '--yes', '--git-init'],
      { VIBELOG_CREATE: '1' },
    );
    assert.equal(code, 0, out);
    assert.ok(!out.includes(GIT_WARNING), out);
  });

  it('AC6: с маркером подсказка «Дальше» подавлена, но настройка выполнена (backlog/ есть)', () => {
    const { out, code } = runCli(['init', 'QuietProj', '--prefix', 'qp', '--yes'], {
      VIBELOG_CREATE: '1',
    });
    assert.equal(code, 0, out);
    assert.ok(!out.includes(NEXT_HINT), out);
    // Сама работа не изменилась: сводка режима на месте.
    assert.ok(out.includes('Режим: fresh'), out);
  });

  it('AGENTS.md шаблона: с маркером — нейтральное сообщение вместо «Пропущено:»', () => {
    writeFileSync(join(testDir, 'AGENTS.md'), '# Правила шаблона\n', 'utf-8');
    const fromCreate = runCli(['init', 'AgentsProj', '--prefix', 'ap', '--yes'], {
      VIBELOG_CREATE: '1',
    });
    assert.equal(fromCreate.code, 0, fromCreate.out);
    assert.ok(!fromCreate.out.includes('Пропущено: AGENTS.md'), fromCreate.out);
    assert.ok(fromCreate.out.includes('AGENTS.md из шаблона сохранён'), fromCreate.out);

    // Прямой запуск `init` сохраняет прежний текст (регрессия не нужна).
    fresh();
    writeFileSync(join(testDir, 'AGENTS.md'), '# Правила шаблона\n', 'utf-8');
    const direct = runCli(['init', 'AgentsProj2', '--prefix', 'a2', '--yes']);
    assert.equal(direct.code, 0, direct.out);
    assert.ok(direct.out.includes('Пропущено: AGENTS.md'), direct.out);
  });
});
