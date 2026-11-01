/**
 * Тесты VL-196 — transient In Progress (core/phase-transient.ts).
 *
 * Покрытие: eligibility (workflow-фазы vs служебные), mark (кэш + статус),
 * finalize (успех → produces_status, провал → откат + комментарий, «агент
 * сам зафиксировал» — не перетираем), recovery (мёртвый pid → откат, живой →
 * пропуск) и fail-open (битый путь кэша не роняет фазу).
 *
 * Фикстуры — временные каталоги /tmp; workflow — DEFAULT_WORKFLOW (без
 * settings.json): Spec + plan → Planned, чтобы проверять реальные переходы.
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isTransientEligible,
  markPhaseStarted,
  markPhaseAborted,
  finalizePhaseStatus,
  recoverStalePhaseStatuses,
  phaseTransientCachePath,
  getPhaseTransientStatus,
  readPhaseTransient,
} from '../../dist/core/phase-transient.js';
import { createTaskFile, getTask, updateTaskFile } from '../../dist/core/store.js';
import { stringifyYaml } from '../../dist/core/yaml.js';

describe('phase-transient (VL-196)', () => {
  const root = mkdtempSync(join(tmpdir(), 'vibelog-transient-'));
  const cacheFile = phaseTransientCachePath(root);

  // Backlog-фикстура: префикс VL → ключи задач вида VL-90N (taskIdPattern)
  mkdirSync(join(root, 'backlog', 'tasks'), { recursive: true });
  writeFileSync(join(root, 'backlog', 'config.yml'), stringifyYaml({
    project_name: 'Transient Test',
    task_prefix: 'VL',
    default_status: 'To Do',
    statuses: ['To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done', 'Rejected'],
    definition_of_done: [],
  }), 'utf-8');
  createTaskFile(root, { id: 'VL-901', title: 'Транзиент: успех', status: 'Spec' });
  createTaskFile(root, { id: 'VL-902', title: 'Транзиент: провал', status: 'Spec' });
  createTaskFile(root, { id: 'VL-903', title: 'Транзиент: агент зафиксировал', status: 'Spec' });
  createTaskFile(root, { id: 'VL-904', title: 'Транзиент: recovery, мёртвый pid', status: 'Spec' });
  createTaskFile(root, { id: 'VL-905', title: 'Транзиент: recovery, живой pid', status: 'Spec' });
  createTaskFile(root, { id: 'VL-906', title: 'Транзиент: финальный статус', status: 'Done' });
  createTaskFile(root, { id: 'VL-907', title: 'Транзиент: aborted при exit 0', status: 'Spec' });
  createTaskFile(root, { id: 'VL-908', title: 'Транзиент: aborted без записи кэша', status: 'Spec' });
  createTaskFile(root, { id: 'VL-911', title: 'Транзиент: статус до фазы (VL-245)', status: 'Spec' });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Текущее содержимое кэша (файл обязан существовать после mark). */
  const readCache = () => JSON.parse(readFileSync(cacheFile, 'utf-8'));

  it('eligibility: plan из Spec — да; comment/фаза без перехода/чужой ключ — нет', () => {
    assert.equal(isTransientEligible(root, 'VL-901', 'plan'), true, 'переход Spec → plan есть');
    assert.equal(isTransientEligible(root, 'VL-901', 'comment'), false, 'SERVICE_PHASES');
    assert.equal(isTransientEligible(root, 'VL-901', 'code'), false, 'перехода Spec → code нет');
    assert.equal(isTransientEligible(root, 'XX-1', 'plan'), false, 'префикс не проекта');
    assert.equal(isTransientEligible(root, 'prompt', 'prompt'), false, 'не задачный ключ');
  });

  it('mark: статус In Progress + запись кэша {prevStatus, phase, pid}', () => {
    rmSync(cacheFile, { force: true });
    markPhaseStarted(root, 'VL-901', 'plan', 424242);
    assert.equal(getTask(root, 'VL-901').status, 'In Progress');
    const entry = readCache()['VL-901'];
    assert.ok(entry, 'запись в кэше');
    assert.equal(entry.prevStatus, 'Spec');
    assert.equal(entry.phase, 'plan');
    assert.equal(entry.pid, 424242);
    assert.ok(entry.startedAt, 'startedAt записан');
  });

  it('finalize успех: produces_status (Spec+plan → Planned), кэш очищен, без комментариев', () => {
    finalizePhaseStatus(root, 'VL-901', 'plan', { exitCode: 0, result: { type: 'result' } });
    assert.equal(getTask(root, 'VL-901').status, 'Planned', 'produces_status от исходного Spec');
    assert.equal('VL-901' in readCache(), false, 'запись удалена');
    assert.equal(getTask(root, 'VL-901').comments.length, 0, 'успех без комментария');
  });

  // VL-244 (AC1/AC2): aborted отменяет produces_status даже при exitCode 0 —
  // аварийная ветка шаблона иначе получала бы Done незавершённой задаче
  it('aborted: exitCode 0 + флаг → откат к prevStatus + комментарий-причина', () => {
    rmSync(cacheFile, { force: true });
    markPhaseStarted(root, 'VL-907', 'plan', 424247);
    assert.equal(getTask(root, 'VL-907').status, 'In Progress');
    // Ключ в нижнем регистре — проверяем канонизацию в markPhaseAborted
    assert.equal(markPhaseAborted(root, 'vl-907', 'merge не завершён'), true, 'флаг записан');
    assert.equal(readCache()['VL-907'].aborted, true, 'флаг виден в кэше');
    assert.equal(readCache()['VL-907'].abortedReason, 'merge не завершён');
    finalizePhaseStatus(root, 'VL-907', 'plan', { exitCode: 0, result: { type: 'result' } });
    const task = getTask(root, 'VL-907');
    assert.equal(task.status, 'Spec', 'aborted отменил produces_status (не Planned)');
    assert.equal(task.comments.length, 1, 'ровно один комментарий-причина');
    assert.equal(task.comments[0].author, '@agent');
    assert.match(task.comments[0].text, /Фаза plan прервана агентом \(aborted\)/);
    assert.match(task.comments[0].text, /merge не завершён/, 'причина из отчёта агента');
    assert.match(task.comments[0].text, /возвращён к Spec/);
    assert.equal('VL-907' in readCache(), false, 'запись кэша удалена');
  });

  // VL-289 (шаг 1): результат фазы должен дожить до оркестратора, а не
  // остаться только в удалённой записи кэша. readPhaseTransient читает запись
  // без удаления, finalizePhaseStatus возвращает снимок признака.
  it('readPhaseTransient: читает aborted до финализации, после — null', () => {
    rmSync(cacheFile, { force: true });
    markPhaseStarted(root, 'VL-907', 'plan', 424247);
    markPhaseAborted(root, 'VL-907', 'разреши конфликт README.md и повтори close');
    const seen = readPhaseTransient(root, 'vl-907');
    assert.ok(seen, 'запись читается по ключу любого регистра');
    assert.equal(seen.phase, 'plan');
    assert.equal(seen.prevStatus, 'Spec');
    assert.equal(seen.aborted, true);
    assert.equal(seen.abortedReason, 'разреши конфликт README.md и повтори close');
    assert.equal('VL-907' in readCache(), true, 'чтение не удаляет запись');
    finalizePhaseStatus(root, 'VL-907', 'plan', { exitCode: 0 });
    assert.equal(readPhaseTransient(root, 'VL-907'), null, 'после финализации записи нет');
  });

  it('finalizePhaseStatus возвращает исход: aborted + причина (VL-289)', () => {
    rmSync(cacheFile, { force: true });
    markPhaseStarted(root, 'VL-907', 'plan', 424247);
    markPhaseAborted(root, 'VL-907', 'merge vb/vl-285 → master: UU README.md');
    const out = finalizePhaseStatus(root, 'VL-907', 'plan', { exitCode: 0 });
    assert.ok(out, 'исход возвращён');
    assert.equal(out.outcome, 'aborted');
    assert.equal(out.aborted, true);
    assert.equal(out.phase, 'plan');
    assert.equal(out.prevStatus, 'Spec');
    assert.match(out.abortedReason, /UU README.md/);
    assert.equal(getTask(root, 'VL-907').status, 'Spec', 'статус откачен');
  });

  it('finalizePhaseStatus без транзиента возвращает null (fail-open)', () => {
    rmSync(cacheFile, { force: true });
    assert.equal(finalizePhaseStatus(root, 'VL-901', 'plan', { exitCode: 0 }), null);
  });

  it('markPhaseAborted без записи кэша — no-op, false, не бросает', () => {
    rmSync(cacheFile, { force: true });
    assert.equal(markPhaseAborted(root, 'VL-908', 'нет транзиента'), false);
    assert.equal(existsSync(cacheFile), false, 'кэш не создавался');
    assert.equal(getTask(root, 'VL-908').status, 'Spec', 'статус не тронут');
  });

  it('finalize провал: откат к Spec + комментарий-причина (@agent, код выхода)', () => {
    rmSync(cacheFile, { force: true });
    markPhaseStarted(root, 'VL-902', 'plan', 424243);
    assert.equal(getTask(root, 'VL-902').status, 'In Progress');
    finalizePhaseStatus(root, 'VL-902', 'plan', {
      exitCode: 1,
      result: { is_error: true },
      logTail: 'ошибка: stack trace',
    });
    const task = getTask(root, 'VL-902');
    assert.equal(task.status, 'Spec', 'откат к исходному статусу');
    assert.equal(task.comments.length, 1, 'ровно один комментарий');
    assert.equal(task.comments[0].author, '@agent');
    assert.match(task.comments[0].text, /Фаза plan не удалась \(код выхода 1\)/);
    assert.match(task.comments[0].text, /stack trace/, 'хвост лога в причине');
    assert.match(task.comments[0].text, /возвращён к Spec/);
    assert.equal('VL-902' in readCache(), false, 'запись удалена');
  });

  it('агент сам зафиксировал статус mid-фазы → finalize не перетирает (даже при провале)', () => {
    rmSync(cacheFile, { force: true });
    markPhaseStarted(root, 'VL-903', 'plan', 424244);
    // Имитация backlog_finish_phase агентом во время фазы
    updateTaskFile(root, 'VL-903', { status: 'Planned' });
    finalizePhaseStatus(root, 'VL-903', 'plan', { exitCode: 1, result: { is_error: true } });
    assert.equal(getTask(root, 'VL-903').status, 'Planned', 'запись агента приоритетна');
    assert.equal('VL-903' in readCache(), false, 'запись кэша всё равно удалена');
  });

  it('recovery: мёртвый pid → откат + комментарий; живой pid → пропуск', () => {
    rmSync(cacheFile, { force: true });
    // Живой pid (текущий процесс) — запись не трогаем
    markPhaseStarted(root, 'VL-905', 'plan', process.pid);
    // Мёртвый pid — реально завершённый процесс (spawnSync дождался выхода)
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
    markPhaseStarted(root, 'VL-904', 'plan', deadPid);
    assert.equal(getTask(root, 'VL-904').status, 'In Progress');

    recoverStalePhaseStatuses(root);

    const t4 = getTask(root, 'VL-904');
    assert.equal(t4.status, 'Spec', 'мёртвый pid → откат к prevStatus');
    assert.match(t4.comments.at(-1).text, /прервана остановкой процесса — статус возвращён к Spec/);
    const t5 = getTask(root, 'VL-905');
    assert.equal(t5.status, 'In Progress', 'живой pid → фаза ещё идёт, статус не трогаем');
    const cache = readCache();
    assert.equal('VL-904' in cache, false, 'мёртвая запись удалена');
    assert.equal('VL-905' in cache, true, 'живая запись сохранена');
    rmSync(cacheFile, { force: true });
    // Прибираем живую запись: VL-905 остаётся в In Progress осознанно —
    // кэша нет, recovery его не тронет (проверка «запись есть ⇔ откат»)
    updateTaskFile(root, 'VL-905', { status: 'Spec' });
  });

  it('mark для финального статуса (Done, перехода нет) — статус и кэш не трогаются', () => {
    rmSync(cacheFile, { force: true });
    markPhaseStarted(root, 'VL-906', 'close', 424245);
    assert.equal(getTask(root, 'VL-906').status, 'Done');
    assert.equal(existsSync(cacheFile), false, 'кэш не создавался');
  });

  // ── VL-245: статус ДО фазы из кэша (база проверки перехода на границе MCP) ──

  it('getPhaseTransientStatus: своя фаза → prevStatus, чужая фаза → null', () => {
    rmSync(cacheFile, { force: true });
    markPhaseStarted(root, 'VL-911', 'plan', 424247);
    // Запись принадлежит plan: для plan база = Spec, для чужой фазы — null
    assert.equal(getPhaseTransientStatus(root, 'VL-911', 'plan'), 'Spec');
    assert.equal(getPhaseTransientStatus(root, 'VL-911', 'close'), null, 'чужая фаза не подменяет базу');
    // Регистр ключа не важен: в кэше ключи канонические (UPPER)
    assert.equal(getPhaseTransientStatus(root, 'vl-911', 'plan'), 'Spec');
    finalizePhaseStatus(root, 'VL-911', 'plan', { exitCode: 0 });
  });

  it('getPhaseTransientStatus: нет записи/нет кэша/битый кэш → null (fail-open)', () => {
    rmSync(cacheFile, { force: true });
    assert.equal(getPhaseTransientStatus(root, 'VL-911', 'plan'), null, 'кэша нет');
    // Битый файл кэша — readCache fail-open, функция не бросает
    mkdirSync(join(root, '.vibelog'), { recursive: true });
    writeFileSync(cacheFile, '{ не json', 'utf-8');
    assert.equal(getPhaseTransientStatus(root, 'VL-911', 'plan'), null);
    rmSync(cacheFile, { force: true });
  });

  it('fail-open: .vibelog как файл — mark не бросает, статус не меняется', () => {
    const root2 = mkdtempSync(join(tmpdir(), 'vibelog-transient-fail-'));
    try {
      mkdirSync(join(root2, 'backlog', 'tasks'), { recursive: true });
      writeFileSync(join(root2, 'backlog', 'config.yml'), stringifyYaml({
        project_name: 'Fail Open',
        task_prefix: 'VL',
        default_status: 'To Do',
        statuses: ['To Do', 'Spec', 'In Progress'],
        definition_of_done: [],
      }), 'utf-8');
      createTaskFile(root2, { id: 'VL-999', title: 'fail-open', status: 'Spec' });
      // .vibelog — обычный файл: mkdirSync при записи кэша упадёт
      writeFileSync(join(root2, '.vibelog'), 'не каталог', 'utf-8');
      markPhaseStarted(root2, 'VL-999', 'plan', 424246); // не должно бросить
      assert.equal(getTask(root2, 'VL-999').status, 'Spec', 'без транзиента — как раньше');
    } finally {
      rmSync(root2, { recursive: true, force: true });
    }
  });
});
