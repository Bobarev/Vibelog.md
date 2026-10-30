/**
 * Тесты ядра сводки сессии `buildSessionSummary` (VL-261).
 *
 * Чистый модуль: вход — массив ChatMessage (как в jsonl-транскрипте) +
 * мета/billing, поэтому тесты не трогают fs. Фикстуры собираются здесь же.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  buildSessionSummary,
  formatSessionSummary,
  isPhasePromptMarker,
  phaseFromPromptText,
  shellCommandSkeleton,
  SESSION_SUMMARY_SCHEMA_VERSION,
} from '../../dist/agent/session-summary.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** assistant-сообщение с usage/payload/tool_calls. */
function assistant(opts = {}) {
  const msg = { role: 'assistant', content: opts.text ?? null };
  if (opts.usage) msg.usage = opts.usage;
  if (opts.payload !== undefined) msg.payload_bytes = opts.payload;
  if (opts.calls) msg.tool_calls = opts.calls;
  return msg;
}

/** Вызов инструмента. */
function call(name, args = {}, id = `${name}-${Math.random().toString(36).slice(2, 8)}`) {
  return { id, name, arguments: args };
}

/** usage-объект одного ответа. */
function usage(input = 100, output = 10, cache = 0, total = 110, reasoning = 0) {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cache,
    total_tokens: total,
    reasoning_tokens: reasoning,
  };
}

const PLAN_PROMPT = 'Ты — автоматический исполнитель Vibelog (Фаза 2: Plan) для задачи VL-9.';
const CODE_PROMPT = 'Ты — автоматический исполнитель Vibelog (Фаза 3: Code) для задачи VL-9.';
const SPEC_PROMPT = 'Ты — автоматический исполнитель Vibelog (Фаза 1: Spec) для задачи VL-9.';
const CLOSE_PROMPT = 'Ты — автоматический закрыватель Vibelog (Фаза Close: закрытие задачи VL-9).';
const DO_PROMPT = 'Ты — автоматический исполнитель Vibelog (Фаза Do: реализация без планирования) для задачи VL-9.';
const COMMENT_PROMPT = 'Ты — автоматический исполнитель Vibelog (Фаза Comment: выполнение запроса из комментария) для задачи VL-9.';
const REJECT_PROMPT = 'Ты — автоматический исполнитель Vibelog (Фаза Reject: отказ от задачи) для задачи VL-9.';
const ANALYZE_PROMPT = 'Ты — автоматический исполнитель Vibelog (Фаза Analyze: разбор сессии агента по session-ref).';
const INVESTIGATE_PROMPT = 'Ты — автоматический исполнитель Vibelog (Фаза Investigate: расследование инцидента) для задачи VL-9.';
const MATERIALIZE_PROMPT = 'Ты — автоматический исполнитель Vibelog (Фаза Materialize: создание задач из расследования) для задачи VL-9.';
const PROMPT_CMD = 'Ты — автоматический исполнитель Vibelog (команда prompt: произвольный запрос пользователя).';

/** Фикстура: 3 рана (plan → code → code-resume) с агрегатами. */
function threeRunMessages() {
  return [
    { role: 'system', content: 'sys' },
    { role: 'user', content: PLAN_PROMPT }, // рана 1 startLine=2
    assistant({ usage: usage(1000, 100, 0, 1100), payload: 5000, calls: [call('run_shell_command', { command: 'git status' })] }),
    { role: 'tool', tool_call_id: 'x', content: 'ok' },
    assistant({ usage: usage(2000, 200, 0, 2200), payload: 9000, calls: [call('edit', { path: 'src/a.ts' })] }),
    { role: 'tool', tool_call_id: 'y', content: 'ok' },
    // «Продолжи» — граница рана 2
    { role: 'user', content: 'Продолжи' },
    assistant({ usage: usage(3000, 300, 0, 3300), payload: 3000, calls: [
      call('run_shell_command', { command: 'git status --porcelain' }),
      call('write_file', { path: 'src/b.ts' }),
    ] }),
    { role: 'tool', tool_call_id: 'z', content: 'ok' },
    // внутреннее user-сообщение рана (repeat-guard) — НЕ граница
    { role: 'user', content: 'Ты уже обращался к read_file|src/a.ts 5 раз — используй ранее полученный результат' },
    assistant({ usage: usage(4000, 400, 0, 4400), calls: [call('read_file', { path: 'src/a.ts' })] }),
    // «Продолжи» — граница рана 3
    { role: 'user', content: CODE_PROMPT },
    assistant({ usage: usage(5000, 500, 0, 5500), calls: [call('edit', { path: 'src/a.ts' })] }),
  ];
}

describe('VL-261 — shellCommandSkeleton', () => {
  it('сворачивает хвост, флаги и аргументы после команды отбрасывает', () => {
    assert.equal(shellCommandSkeleton('git status'), 'git status');
    assert.equal(shellCommandSkeleton('git status --porcelain'), 'git status');
    assert.equal(shellCommandSkeleton('node -e "const x=1"'), 'node -e');
    assert.equal(shellCommandSkeleton('ls src/a.ts'), 'ls src/a.ts');
    assert.equal(shellCommandSkeleton('grep -rn x src'), 'grep -rn');
  });

  it('берёт первый сегмент составной команды', () => {
    assert.equal(shellCommandSkeleton('pnpm build && pnpm test'), 'pnpm build');
    assert.equal(shellCommandSkeleton('git status | head -5'), 'git status');
  });

  it('пустая команда → пустая строка', () => {
    assert.equal(shellCommandSkeleton('   '), '');
  });
});

describe('VL-261 — маркеры фаз', () => {
  it('isPhasePromptMarker узнаёт промпт фазы и не путает с guard-сообщением', () => {
    assert.equal(isPhasePromptMarker(PLAN_PROMPT), true);
    assert.equal(isPhasePromptMarker('Продолжи'), false);
    assert.equal(isPhasePromptMarker('Ты уже обращался к read_file|src/a.ts'), false);
  });

  it('phaseFromPromptText разбирает все 11 фаз шаблонов', () => {
    assert.equal(phaseFromPromptText(SPEC_PROMPT), 'spec');
    assert.equal(phaseFromPromptText(PLAN_PROMPT), 'plan');
    assert.equal(phaseFromPromptText(CODE_PROMPT), 'code');
    assert.equal(phaseFromPromptText(DO_PROMPT), 'do');
    assert.equal(phaseFromPromptText(CLOSE_PROMPT), 'close');
    assert.equal(phaseFromPromptText(COMMENT_PROMPT), 'comment');
    assert.equal(phaseFromPromptText(REJECT_PROMPT), 'reject');
    assert.equal(phaseFromPromptText(ANALYZE_PROMPT), 'analyze');
    assert.equal(phaseFromPromptText(INVESTIGATE_PROMPT), 'investigate');
    assert.equal(phaseFromPromptText(MATERIALIZE_PROMPT), 'materialize');
    assert.equal(phaseFromPromptText(PROMPT_CMD), 'prompt');
    assert.equal(phaseFromPromptText('Ты — кто-то другой'), null);
  });
});

describe('VL-261 — границы ранов', () => {
  it('3 маркера → 3 рана с правильными startLine/endLine', () => {
    const s = buildSessionSummary({
      messages: threeRunMessages(),
      sessionId: 'agent-1',
      path: '.vibelog/agent-sessions/agent-1.jsonl',
    });
    assert.equal(s.runs.length, 3);
    // system-строка в ран не входит; endLine — последнее содержательное
    // сообщение рана (внутренние user-guard'ы ран не растягивают)
    assert.deepEqual(s.runs.map((r) => r.startLine), [2, 7, 12]);
    assert.deepEqual(s.runs.map((r) => r.endLine), [6, 11, 13]);
    // ран 2 — resume-маркер «Продолжи» без фазы в тексте: фаза не выводится
    // из маркера (billing/мета в этой фикстуре не переданы)
    assert.deepEqual(s.runs.map((r) => r.phase), ['plan', null, 'code']);
  });

  it('внутренние user-сообщения рана не режут ран', () => {
    const msgs = [
      { role: 'user', content: PLAN_PROMPT },
      { role: 'user', content: 'Ты уже обращался к read_file|src/a.ts 5 раз — используй ранее полученный результат' },
      { role: 'user', content: 'Замечание: проигнорировано 2 tool_call(ов) с пустым name/id (VL-215).' },
      { role: 'user', content: 'Ошибка ответа модели: tool_call с пустым name/id проигнорирован (VL-215).' },
      assistant({ usage: usage() }),
    ];
    const s = buildSessionSummary({ messages: msgs, sessionId: 'agent-2', path: 'p' });
    assert.equal(s.runs.length, 1);
  });

  it('транскрипт без маркера: данные не теряются (один «безымянный» ран)', () => {
    const msgs = [assistant({ usage: usage(), calls: [call('edit', { path: 'a.ts' })] })];
    const s = buildSessionSummary({ messages: msgs, sessionId: 'agent-3', path: 'p' });
    assert.equal(s.runs.length, 1);
    assert.equal(s.runs[0].phase, null);
    assert.equal(s.totals.toolCalls, 1);
  });

  it('пустой транскрипт: 0 ранов, нулевые агрегаты', () => {
    const s = buildSessionSummary({ messages: [], sessionId: 'agent-4', path: 'p' });
    assert.deepEqual(s.runs, []);
    assert.equal(s.lines, 0);
    assert.equal(s.totals.runs, 0);
    assert.equal(s.totals.toolCalls, 0);
    assert.equal(s.totals.requests, 0);
    assert.deepEqual(s.totals.shellTop, []);
    assert.deepEqual(s.totals.editedFiles, []);
  });
});

describe('VL-261 — usage/payload по ранам', () => {
  it('суммирует токены и берёт максимум payload внутри рана', () => {
    const s = buildSessionSummary({ messages: threeRunMessages(), sessionId: 'agent-1', path: 'p' });
    const first = s.runs[0];
    assert.equal(first.requests, 2);
    assert.equal(first.input, 3000);
    assert.equal(first.output, 300);
    assert.equal(first.total, 3300);
    assert.equal(first.maxPayloadBytes, 9000);
    assert.equal(s.totals.requests, 5);
    assert.equal(s.totals.input, 15000);
  });

  it('assistant без usage не считается запросом, payload=null при отсутствии полей', () => {
    const s = buildSessionSummary({
      messages: [{ role: 'user', content: PLAN_PROMPT }, assistant({ calls: [call('edit', { path: 'a.ts' })] })],
      sessionId: 'agent-5',
      path: 'p',
    });
    assert.equal(s.runs[0].requests, 0);
    assert.equal(s.runs[0].maxPayloadBytes, null);
    assert.equal(s.runs[0].toolCalls, 1);
  });
});

describe('VL-261 — агрегаты инструментов и файлов', () => {
  it('tools по ранам и по сессии; правки раздельно edit/write_file', () => {
    const s = buildSessionSummary({ messages: threeRunMessages(), sessionId: 'agent-1', path: 'p' });
    assert.deepEqual(s.runs[0].tools, { run_shell_command: 1, edit: 1 });
    assert.equal(s.runs[1].tools.run_shell_command, 1);
    assert.equal(s.runs[1].tools.write_file, 1);
    assert.equal(s.totals.tools.run_shell_command, 2);
    assert.equal(s.totals.tools.edit, 2);
    assert.equal(s.totals.tools.write_file, 1);
    assert.equal(s.totals.tools.read_file, 1);
    // edits — только edit (2 вызова src/a.ts), writes — только write_file
    assert.deepEqual(s.totals.edits, [{ key: 'src/a.ts', count: 2 }]);
    assert.deepEqual(s.totals.writes, [{ key: 'src/b.ts', count: 1 }]);
    assert.deepEqual(s.totals.editedFiles.map((e) => e.key).sort(), ['src/a.ts', 'src/b.ts']);
    assert.deepEqual(s.totals.topReadPaths, [{ key: 'src/a.ts', count: 1 }]);
  });

  it('shell-скелеты группируются: git status и git status --porcelain — один ключ', () => {
    const s = buildSessionSummary({ messages: threeRunMessages(), sessionId: 'agent-1', path: 'p' });
    assert.deepEqual(s.totals.shellTop, [{ skeleton: 'git status', count: 2 }]);
    assert.equal(s.runs[0].shellTop[0].skeleton, 'git status');
  });

  it('фантомные tool_calls (пустой name/id) не считаются (VL-215)', () => {
    const msgs = [
      { role: 'user', content: PLAN_PROMPT },
      assistant({ usage: usage(), calls: [
        call('edit', { path: 'a.ts' }),
        { id: '', name: 'edit', arguments: {} },
        { id: 'abc', name: '', arguments: {} },
      ] }),
    ];
    const s = buildSessionSummary({ messages: msgs, sessionId: 'agent-6', path: 'p' });
    assert.equal(s.totals.toolCalls, 1);
    assert.deepEqual(s.totals.tools, { edit: 1 });
  });

  it('repeatStats заполнены (переиспользование repeat-tracker)', () => {
    const msgs = [
      { role: 'user', content: PLAN_PROMPT },
      assistant({ usage: usage(), calls: [
        call('read_file', { path: 'a.ts' }),
        call('read_file', { path: 'a.ts' }),
        call('read_file', { path: 'a.ts' }),
      ] }),
    ];
    const s = buildSessionSummary({ messages: msgs, sessionId: 'agent-7', path: 'p' });
    assert.equal(s.totals.repeatStats.tool_calls_total, 3);
    assert.equal(s.totals.repeatStats.top[0].key, 'read_file|a.ts');
    assert.equal(s.totals.repeatStats.top[0].count, 3);
  });
});

describe('VL-261 — фазы и тайминги из billing/меты', () => {
  it('billing приоритетнее маркера; расхождение числа записей — предупреждение', () => {
    const s = buildSessionSummary({
      messages: threeRunMessages(),
      sessionId: 'agent-1',
      path: 'p',
      meta: { cwd: '/repo', taskId: 'VL-9', phase: 'plan', startedAt: '2026-01-01T00:00:00Z' },
      billingSessions: [
        { sessionId: 'agent-1', phase: 'plan', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:10:00Z', durationMs: 600000, usage: { input: 0, output: 0, cache: 0, total: 0 } },
        { sessionId: 'agent-1', phase: 'code', startedAt: '2026-01-01T00:10:00Z', finishedAt: '2026-01-01T00:20:00Z', durationMs: 600000, usage: { input: 0, output: 0, cache: 0, total: 0 } },
      ],
    });
    assert.deepEqual(s.runs.map((r) => r.phase), ['plan', 'code', 'code']);
    assert.equal(s.runs[0].durationMs, 600000);
    assert.equal(s.runs[0].finishedAt, '2026-01-01T00:10:00Z');
    assert.equal(s.warnings.length, 1);
    assert.match(s.warnings[0], /billing: 2 записей на 3 ранов/);
  });

  it('без billing: фазы из маркеров, тайминги — из меты (первый/последний ран)', () => {
    const s = buildSessionSummary({
      messages: threeRunMessages(),
      sessionId: 'agent-1',
      path: 'p',
      meta: { cwd: '/repo', taskId: 'VL-9', phase: 'code', startedAt: 'S', finishedAt: 'F', durationMs: 42 },
    });
    assert.equal(s.runs[0].startedAt, 'S');
    assert.equal(s.runs[0].finishedAt, null);
    assert.equal(s.runs[2].startedAt, null);
    assert.equal(s.runs[2].finishedAt, 'F');
    assert.equal(s.runs[2].durationMs, 42);
    assert.deepEqual(s.warnings, []);
  });

  it('схема JSON: schemaVersion/kind/meta/taskId', () => {
    const s = buildSessionSummary({
      messages: threeRunMessages(),
      sessionId: 'agent-1',
      path: 'p',
      meta: { cwd: '/repo', taskId: 'VL-9' },
    });
    assert.equal(s.schemaVersion, SESSION_SUMMARY_SCHEMA_VERSION);
    assert.equal(s.kind, 'session-summary');
    assert.equal(s.taskId, 'VL-9');
    assert.equal(s.meta.cwd, '/repo');
    assert.equal(s.meta.phase, null);
    // нет undefined в JSON (стабильная схема для потребителей)
    const round = JSON.parse(JSON.stringify(s));
    assert.deepEqual(round, s);
  });
});

describe('VL-261 — formatSessionSummary', () => {
  it('содержит раны, tool-calls и топ-файлы', () => {
    const s = buildSessionSummary({
      messages: threeRunMessages(),
      sessionId: 'agent-1',
      path: '.vibelog/agent-sessions/agent-1.jsonl',
      meta: { cwd: '/repo', taskId: 'VL-9', phase: 'plan' },
    });
    const text = formatSessionSummary(s);
    assert.match(text, /Сводка сессии agent-1/);
    assert.match(text, /задача VL-9/);
    assert.match(text, /ранов: 3/);
    assert.match(text, /tool-calls: 6/);
    assert.match(text, /#1 plan/);
    assert.match(text, /src\/a\.ts/);
    assert.match(text, /shell \(скелеты\): git status×2/);
  });

  it('пустая сессия печатается без падения', () => {
    const text = formatSessionSummary(buildSessionSummary({ messages: [], sessionId: 'agent-0', path: 'p' }));
    assert.match(text, /ранов: 0/);
    assert.match(text, /\(нет\)/);
  });
});

describe('VL-261 — реалистичная сессия (структура AC4)', () => {
  it('3 рана plan→code→code: 110 tool-calls, 72 shell, 18 edit, 5 write_file', () => {
    // Фикстура повторяет профиль живой сессии agent-1793328615846 (AC4):
    // jsonl главного репозитория недоступен из worktree, поэтому инвариант
    // проверяется на эквивалентной по структуре синтетике.
    const shell = 72, edits = 18, writes = 5, reads = 15;
    const calls = [];
    for (let i = 0; i < shell; i++) calls.push(call('run_shell_command', { command: `git status ${i}` }));
    for (let i = 0; i < edits; i++) calls.push(call('edit', { path: `src/f${i % 7}.ts` }));
    for (let i = 0; i < writes; i++) calls.push(call('write_file', { path: `src/w${i}.ts` }));
    for (let i = 0; i < reads; i++) calls.push(call('read_file', { path: `src/f${i % 7}.ts`, offset: i }));
    assert.equal(calls.length, shell + edits + writes + reads);

    // Раскладываем вызовы по трём ранам: plan (первые 30), code (следующие 50), code-resume (остальные)
    const chunk = (from, to) => calls.slice(from, to);

    const msgs = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: PLAN_PROMPT },
      assistant({ usage: usage(), payload: 120000, calls: chunk(0, 30) }),
      { role: 'user', content: CODE_PROMPT },
      assistant({ usage: usage(), payload: 400000, calls: chunk(30, 80) }),
      { role: 'user', content: 'Продолжи' },
      assistant({ usage: usage(), payload: 600000, calls: chunk(80, calls.length) }),
    ];
    const s = buildSessionSummary({
      messages: msgs,
      sessionId: 'agent-1793328615846',
      path: 'p',
      // topLimit большой: проверяем полные суммы по файлам, а не топ-5
      topLimit: 100,
      meta: { cwd: '/repo', taskId: 'VL-235', phase: 'code' },
      billingSessions: [
        { sessionId: 'agent-1793328615846', phase: 'plan', usage: { input: 0, output: 0, cache: 0, total: 0 } },
        { sessionId: 'agent-1793328615846', phase: 'code', usage: { input: 0, output: 0, cache: 0, total: 0 } },
        { sessionId: 'agent-1793328615846', phase: 'code', usage: { input: 0, output: 0, cache: 0, total: 0 } },
      ],
    });
    assert.equal(s.totals.runs, 3);
    assert.deepEqual(s.runs.map((r) => r.phase), ['plan', 'code', 'code']);
    assert.equal(s.totals.toolCalls, 110);
    assert.equal(s.totals.tools.run_shell_command, 72);
    assert.equal(s.totals.tools.edit, 18);
    assert.equal(s.totals.tools.write_file, 5);
    assert.equal(s.totals.tools.read_file, 15);
    // разбивка правок: edit и write_file раздельно (риск 4 плана)
    assert.equal(s.totals.edits.reduce((acc, e) => acc + e.count, 0), 18);
    assert.equal(s.totals.writes.reduce((acc, e) => acc + e.count, 0), 5);
    // все 72 shell-команды сворачиваются в один скелет
    assert.equal(s.totals.shellTop.length, 1);
    assert.equal(s.totals.shellTop[0].count, 72);
    // payload по ранам — пики соответствующих ранов
    assert.deepEqual(s.runs.map((r) => r.maxPayloadBytes), [120000, 400000, 600000]);
    assert.deepEqual(s.warnings, []);
  });
});

describe('VL-261 — шаблоны фаз начинаются с маркера «Ты — »', () => {
  let dir;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'vibelog-session-summary-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it('первая строка каждого templates/phases/*.md матчит /^Ты — /', () => {
    const phasesDir = join(repoRoot, 'templates', 'phases');
    const files = readdirSync(phasesDir).filter((f) => f.endsWith('.md'));
    assert.ok(files.length > 0, 'шаблоны фаз найдены');
    for (const file of files) {
      const first = readFileSync(join(phasesDir, file), 'utf-8').split('\n')[0];
      assert.match(first, /^Ты — /, `шаблон ${file} должен начинаться с «Ты — »: ${first}`);
      assert.ok(isPhasePromptMarker(first), `маркер распознаётся: ${file}`);
    }
  });
});
