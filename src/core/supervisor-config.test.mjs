/**
 * Тесты конфигурации супервизора (VL-270, AC20: дефолты, валидация heal_rules,
 * битые правила, самонастройка).
 *
 * Проверяется главное свойство конфига: он ТЕРПИМЫЙ. Битое значение откатывается
 * к дефолту, битое правило выпадает — но цикл лечения продолжает работать, а
 * защищённые поля нельзя переписать самонастройкой (AC14).
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_HEAL_ACTION,
  DEFAULT_HEAL_RULES,
  DEFAULT_MAX_PARALLEL_PHASES,
  DEFAULT_SUPERVISOR_CHAT_MAX_ITERATIONS,
  DEFAULT_SUPERVISOR_CHAT_MAX_WALL_TIME,
  DEFAULT_SUPERVISOR_TICK_SECONDS,
  PROTECTED_SUPERVISOR_KEYS,
  applySelfTuning,
  healRulesPath,
  loadHealRules,
  resolveSupervisorRuntime,
  saveHealRules,
  tuningLogPath,
} from '../../dist/core/supervisor-config.js';

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-supervisor-config-'));

/** Кладёт секцию supervisor в .vibelog/settings.json проекта. */
function writeSettings(supervisor) {
  mkdirSync(join(cwd, '.vibelog'), { recursive: true });
  writeFileSync(join(cwd, '.vibelog', 'settings.json'), JSON.stringify({ supervisor }), 'utf-8');
}

/** Кладёт файл правил лечения. */
function writeHealFile(body) {
  mkdirSync(join(cwd, '.vibelog', 'supervisor'), { recursive: true });
  writeFileSync(healRulesPath(cwd), typeof body === 'string' ? body : JSON.stringify(body), 'utf-8');
}

beforeAll(() => {
  mkdirSync(join(cwd, 'backlog', 'tasks'), { recursive: true });
});

afterAll(() => {
  rmSync(cwd, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(cwd, '.vibelog'), { recursive: true, force: true });
});

describe('resolveSupervisorRuntime: дефолты (doc-19 §7)', () => {
  it('без settings.json — все дефолты, без ошибок', () => {
    const rt = resolveSupervisorRuntime(cwd);
    assert.equal(rt.tickSeconds, DEFAULT_SUPERVISOR_TICK_SECONDS);
    assert.equal(rt.tickSeconds, 60);
    assert.equal(rt.maxParallelPhases, DEFAULT_MAX_PARALLEL_PHASES);
    assert.equal(rt.maxParallelPhases, 3);
    assert.equal(rt.healAttempts, 2);
    assert.equal(rt.allowSelfTuning, false);
    assert.equal(rt.parallelMode, 'conservative');
    assert.equal(rt.limits.chatMaxIterations, DEFAULT_SUPERVISOR_CHAT_MAX_ITERATIONS);
    assert.equal(rt.limits.chatMaxIterations, 30);
    assert.equal(rt.limits.chatMaxWallTimeMs, DEFAULT_SUPERVISOR_CHAT_MAX_WALL_TIME * 1000);
    assert.equal(rt.limits.chatMaxWallTimeMs, 600_000);
    assert.deepEqual(rt.errors, []);
  });

  it('валидная секция применяется целиком', () => {
    writeSettings({
      tick_seconds: 15,
      max_parallel_phases: 5,
      heal_attempts: 3,
      allow_self_tuning: true,
      parallel_mode: 'aggressive',
      limits: { chat_max_iterations: 50, chat_max_wall_time: 1200 },
    });
    const rt = resolveSupervisorRuntime(cwd);
    assert.equal(rt.tickSeconds, 15);
    assert.equal(rt.maxParallelPhases, 5);
    assert.equal(rt.healAttempts, 3);
    assert.equal(rt.allowSelfTuning, true);
    assert.equal(rt.parallelMode, 'aggressive');
    assert.equal(rt.limits.chatMaxIterations, 50);
    assert.equal(rt.limits.chatMaxWallTimeMs, 1_200_000);
    assert.deepEqual(rt.errors, []);
  });

  it('мусор в каждом поле → дефолт + предупреждение, тик не падает', () => {
    writeSettings({
      tick_seconds: 'часто',
      max_parallel_phases: 0,
      heal_attempts: -1,
      allow_self_tuning: 'да',
      parallel_mode: 'turbo',
      limits: { chat_max_iterations: 0, chat_max_wall_time: 'много' },
    });
    const rt = resolveSupervisorRuntime(cwd);
    assert.equal(rt.tickSeconds, 60);
    assert.equal(rt.maxParallelPhases, 3);
    assert.equal(rt.healAttempts, 2);
    assert.equal(rt.allowSelfTuning, false);
    assert.equal(rt.parallelMode, 'conservative');
    assert.equal(rt.limits.chatMaxIterations, 30);
    assert.equal(rt.limits.chatMaxWallTimeMs, 600_000);
    assert.equal(rt.errors.length, 7, rt.errors.join(' | '));
  });

  it('секция supervisor не объект → дефолты + одна ошибка', () => {
    writeSettings(['плохо']);
    const rt = resolveSupervisorRuntime(cwd);
    assert.equal(rt.maxParallelPhases, 3);
    assert.equal(rt.errors.length, 1);
    assert.match(rt.errors[0], /должна быть объектом/);
  });
});

describe('loadHealRules: дефолты и битые правила (AC6, AC8)', () => {
  it('файла нет → дефолтные правила из doc-19 §12', () => {
    const cfg = loadHealRules(cwd);
    assert.deepEqual(cfg.rules.map(r => r.id), ['aborted-requires-human', 'repeat-loop-stuck', 'repeat-loop', 'payload-limit', 'wall-timeout', 'no-progress']);
    assert.equal(cfg.rules.length, DEFAULT_HEAL_RULES.length);
    assert.equal(cfg.defaultAction, DEFAULT_HEAL_ACTION);
    assert.equal(cfg.defaultAction, 'bug');
    assert.deepEqual(cfg.errors, []);
  });

  // VL-289: фаза, которая сама сообщила aborted, не перезапускается — правило
  // стоит ПЕРВЫМ, чтобы no-progress не успел перезапустить детерминированную
  // причину (инцидент VL-285: merge-конфликт воспроизводился до сгорания бюджета)
  it('VL-289: aborted-requires-human первым в дефолтных правилах, действие bug', () => {
    const cfg = loadHealRules(cwd);
    assert.equal(cfg.rules[0].id, 'aborted-requires-human');
    assert.deepEqual(cfg.rules[0].when, { aborted: true });
    assert.equal(cfg.rules[0].action, 'bug');
  });

  it('VL-289: when.aborted не boolean → правило выпадает с ошибкой', () => {
    writeHealFile({
      heal_rules: [
        { id: 'bad-aborted', when: { aborted: 'да' }, action: 'bug' },
        { id: 'ok-aborted', when: { aborted: true }, action: 'bug' },
      ],
    });
    const cfg = loadHealRules(cwd);
    assert.deepEqual(cfg.rules.map(r => r.id), ['ok-aborted']);
    assert.ok(cfg.errors.some(e => /aborted должен быть true\/false/.test(e)), cfg.errors.join(' | '));
  });

  it('битый JSON → дефолты + предупреждение', () => {
    writeHealFile('{ это не json');
    const cfg = loadHealRules(cwd);
    assert.equal(cfg.rules.length, DEFAULT_HEAL_RULES.length);
    assert.equal(cfg.errors.length, 1);
    assert.match(cfg.errors[0], /не читается как JSON/);
  });

  it('heal_rules не массив → дефолты + предупреждение', () => {
    writeHealFile({ heal_rules: 'одно правило' });
    const cfg = loadHealRules(cwd);
    assert.equal(cfg.rules.length, DEFAULT_HEAL_RULES.length);
    assert.ok(cfg.errors.some(e => /должен быть массивом/.test(e)));
  });

  it('битое правило выпадает, валидные остаются', () => {
    writeHealFile({
      heal_rules: [
        { id: 'ok-1', when: { status_unchanged: true }, action: 'retry' },
        { id: 'bad-action', when: { status_unchanged: true }, action: 'explode' },
        { id: 'ok-2', when: { fail_reason_contains: ['payload'] }, action: 'retry' },
      ],
      default_action: 'stop',
    });
    const cfg = loadHealRules(cwd);
    assert.deepEqual(cfg.rules.map(r => r.id), ['ok-1', 'ok-2']);
    assert.equal(cfg.defaultAction, 'stop');
    assert.ok(cfg.errors.some(e => /вне набора/.test(e) && /bad-action/.test(e)), cfg.errors.join(' | '));
  });

  it('пустой id, when не объект, битые диапазоны → правила выпадают', () => {
    writeHealFile({
      heal_rules: [
        { when: { status_unchanged: true }, action: 'retry' },
        { id: 'no-when', when: [], action: 'retry' },
        { id: 'share-bad', when: { repeat_share_min: 3 }, action: 'retry' },
        { id: 'calls-bad', when: { repeat_calls_min: 0 }, action: 'retry' },
        { id: 'contains-bad', when: { fail_reason_contains: [] }, action: 'retry' },
        { id: 'flag-bad', when: { status_unchanged: 'yes' }, action: 'retry' },
        { id: 'all-bad', when: { unknown_key: 1 }, action: 'retry' },
      ],
    });
    const cfg = loadHealRules(cwd);
    assert.equal(cfg.rules.length, 0);
    assert.ok(cfg.errors.length >= 7, cfg.errors.join(' | '));
  });

  it('неизвестный ключ when — предупреждение, правило остаётся рабочим', () => {
    writeHealFile({
      heal_rules: [{ id: 'future', when: { status_unchanged: true, new_key: 1 }, action: 'retry' }],
    });
    const cfg = loadHealRules(cwd);
    assert.deepEqual(cfg.rules.map(r => r.id), ['future']);
    assert.ok(cfg.errors.some(e => /неизвестный ключ when.new_key/.test(e)));
  });

  it('comment_and_retry без comment_template → правило выпадает (AC7)', () => {
    writeHealFile({
      heal_rules: [
        { id: 'no-template', when: { status_unchanged: true }, action: 'comment_and_retry' },
        {
          id: 'with-template',
          when: { status_unchanged: true },
          action: 'comment_and_retry',
          comment_template: '{task_id}: {top_repeats}',
        },
      ],
    });
    const cfg = loadHealRules(cwd);
    assert.deepEqual(cfg.rules.map(r => r.id), ['with-template']);
    assert.ok(cfg.errors.some(e => /требует comment_template/.test(e)));
  });

  it('битый default_action → дефолт bug + предупреждение', () => {
    writeHealFile({ heal_rules: DEFAULT_HEAL_RULES, default_action: 'ничего' });
    const cfg = loadHealRules(cwd);
    assert.equal(cfg.defaultAction, 'bug');
    assert.ok(cfg.errors.some(e => /default_action/.test(e)));
  });
});

describe('saveHealRules: атомарная запись', () => {
  it('файл читается обратно, temp-файл не остаётся', () => {
    saveHealRules(cwd, [{ id: 'x', when: { status_unchanged: true }, action: 'stop' }], 'stop');
    assert.ok(existsSync(healRulesPath(cwd)));
    assert.ok(!existsSync(`${healRulesPath(cwd)}.tmp`));
    const back = loadHealRules(cwd);
    assert.deepEqual(back.rules.map(r => r.id), ['x']);
    assert.equal(back.defaultAction, 'stop');
  });
});

describe('applySelfTuning: самонастройка (AC14)', () => {
  it('применяет heal_rules и default_action, пишет tuning.log', () => {
    const current = loadHealRules(cwd);
    const res = applySelfTuning(
      cwd,
      current,
      {
        heal_rules: [
          {
            id: 'custom',
            when: { fail_reason_contains: ['тесты'] },
            action: 'comment_and_retry',
            comment_template: 'Попробуй иначе: {fail_reason}',
          },
        ],
        default_action: 'stop',
      },
      'тесты падают каждый раз',
      new Date('2026-11-01T10:00:00Z'),
    );
    assert.deepEqual(res.applied.heal_rules.map(r => r.id), ['custom']);
    assert.equal(res.applied.default_action, 'stop');
    assert.deepEqual(res.rejected, []);
    assert.ok(res.tuningLogLine.startsWith('2026-11-01T10:00:00.000Z'));
    const log = readFileSync(tuningLogPath(cwd), 'utf8').trim().split('\n');
    assert.equal(log.length, 1);
    assert.match(log[0], /было=/);
    assert.match(log[0], /стало=/);
    assert.match(log[0], /причина=тесты падают каждый раз/);
    const back = loadHealRules(cwd);
    assert.deepEqual(back.rules.map(r => r.id), ['custom']);
    assert.equal(back.defaultAction, 'stop');
  });

  it('защищённые поля отклоняются с причиной, остальное применяется', () => {
    const current = loadHealRules(cwd);
    const patch = { heal_rules: current.rules, default_action: 'bug' };
    for (const key of PROTECTED_SUPERVISOR_KEYS) patch[key] = 42;
    const res = applySelfTuning(cwd, current, patch, 'пытаюсь расширить себе лимиты');
    assert.equal(res.applied.default_action, 'bug');
    assert.equal(res.rejected.length, PROTECTED_SUPERVISOR_KEYS.length, res.rejected.join(' | '));
    for (const key of PROTECTED_SUPERVISOR_KEYS) {
      assert.ok(res.rejected.some(r => r.includes(`"${key}"`) && /защищённый/.test(r)), res.rejected.join(' | '));
    }
    // Значение в settings.json осталось дефолтным: тик читает 3
    assert.equal(resolveSupervisorRuntime(cwd).maxParallelPhases, 3);
  });

  it('top-level comment_template отклоняется (правится только внутри правила)', () => {
    const current = loadHealRules(cwd);
    const res = applySelfTuning(cwd, current, { comment_template: 'текст' }, 'причина');
    assert.equal(res.tuningLogLine, null);
    assert.ok(res.rejected.some(r => /comment_template/.test(r)));
  });

  it('нечего применять → файл не переписывается, лог не растёт', () => {
    const current = loadHealRules(cwd);
    const res = applySelfTuning(cwd, current, { heal_rules: 'мусор' }, 'причина');
    assert.equal(res.tuningLogLine, null);
    assert.equal(res.applied.heal_rules, undefined);
    assert.ok(res.rejected.some(r => /heal_rules/.test(r)));
    assert.ok(!existsSync(tuningLogPath(cwd)));
  });
});