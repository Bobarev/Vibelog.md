/**
 * Тесты CLI-команды `vibelog session summary` (VL-261).
 *
 * Вызываем runSession напрямую с перехватом console.log/console.error (как
 * src/cli/map-cli.test.mjs) — без spawn'ов. Каталог сессий берётся из
 * VIBELOG_CWD (в агентской сессии он указывает на главный репо, lesson-88),
 * поэтому в тесте он подменяется на временный проект и восстанавливается.
 */

import { describe, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runSession } from '../../dist/cli/commands/session.js';
import { parseArgs } from '../../dist/cli/args.js';

let testRoot;
let prevCwdEnv;

/** Перехватывает console.log и console.error, возвращает вывод. */
async function capture(fn) {
  const out = [];
  const errs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { out.push(args.join(' ')); };
  console.error = (...args) => { errs.push(args.join(' ')); };
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { out: out.join('\n'), err: errs.join('\n') };
}

/** Повторяет runSession с аргументами в стиле CLI. */
function run(argv) {
  const parsed = parseArgs(argv);
  return runSession(parsed.subcommand, parsed.positional, parsed.flags, testRoot);
}

/** Мини-транскрипт: 2 рана (plan → code), shell/edit/write_file. */
const JSONL = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'Ты — автоматический исполнитель Vibelog (Фаза 2: Plan) для задачи VL-9.' },
  {
    role: 'assistant',
    content: null,
    usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, total_tokens: 110, reasoning_tokens: 0 },
    payload_bytes: 4000,
    tool_calls: [
      { id: 'c1', name: 'run_shell_command', arguments: { command: 'git status' } },
      { id: 'c2', name: 'edit', arguments: { path: 'src/a.ts' } },
    ],
  },
  { role: 'tool', tool_call_id: 'c1', content: 'ok' },
  { role: 'tool', tool_call_id: 'c2', content: 'ok' },
  { role: 'user', content: 'Ты — автоматический исполнитель Vibelog (Фаза 3: Code) для задачи VL-9.' },
  {
    role: 'assistant',
    content: null,
    usage: { input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 5, total_tokens: 220, reasoning_tokens: 7 },
    payload_bytes: 9000,
    tool_calls: [
      { id: 'c3', name: 'run_shell_command', arguments: { command: 'git status --porcelain' } },
      { id: 'c4', name: 'write_file', arguments: { path: 'src/b.ts' } },
    ],
  },
  { role: 'tool', tool_call_id: 'c3', content: 'ok' },
  { role: 'tool', tool_call_id: 'c4', content: 'ok' },
];

const SESSION_ID = 'agent-1793328615846';

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'vibelog-session-cli-'));
  const sessions = join(testRoot, '.vibelog', 'agent-sessions');
  mkdirSync(sessions, { recursive: true });
  mkdirSync(join(testRoot, '.vibelog', 'billing'), { recursive: true });
  writeFileSync(join(sessions, `${SESSION_ID}.jsonl`), JSONL.map((m) => JSON.stringify(m)).join('\n') + '\n', 'utf8');
  writeFileSync(
    join(sessions, `${SESSION_ID}.meta.json`),
    JSON.stringify({
      sessionId: SESSION_ID,
      taskId: 'VL-9',
      phase: 'plan',
      cwd: testRoot,
      startedAt: '2026-01-01T00:00:00Z',
      finishedAt: '2026-01-01T00:30:00Z',
      durationMs: 1800000,
      model: 'test-model',
      agent: 'vb',
    }),
    'utf8',
  );
  writeFileSync(
    join(testRoot, '.vibelog', 'billing', 'VL-9.json'),
    JSON.stringify({
      taskId: 'VL-9',
      sessions: [
        {
          sessionId: SESSION_ID,
          phase: 'plan',
          startedAt: '2026-01-01T00:00:00Z',
          finishedAt: '2026-01-01T00:10:00Z',
          durationMs: 600000,
          usage: { input: 100, output: 10, cache: 0, total: 110 },
        },
        {
          sessionId: SESSION_ID,
          phase: 'code',
          sessionPhase: 'plan',
          startedAt: '2026-01-01T00:10:00Z',
          finishedAt: '2026-01-01T00:30:00Z',
          durationMs: 1200000,
          usage: { input: 200, output: 20, cache: 5, total: 220 },
        },
      ],
    }),
    'utf8',
  );
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

beforeEach(() => {
  prevCwdEnv = process.env.VIBELOG_CWD;
  process.env.VIBELOG_CWD = testRoot;
  process.exitCode = 0;
});

afterEach(() => {
  if (prevCwdEnv === undefined) delete process.env.VIBELOG_CWD;
  else process.env.VIBELOG_CWD = prevCwdEnv;
  process.exitCode = 0;
});

describe('VL-261 — vibelog session summary', () => {
  it('--json: стабильная схема с schemaVersion и kind', async () => {
    const { out } = await capture(() => run(['session', 'summary', SESSION_ID, '--json']));
    const parsed = JSON.parse(out);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.kind, 'session-summary');
    assert.equal(parsed.sessionId, SESSION_ID);
    assert.equal(parsed.taskId, 'VL-9');
    assert.equal(parsed.lines, JSONL.length);
  });

  it('--json: раны и фазы из billing, tool-calls и правки', async () => {
    const { out } = await capture(() => run(['session', 'summary', SESSION_ID, '--json']));
    const parsed = JSON.parse(out);
    assert.equal(parsed.runs.length, 2);
    assert.deepEqual(parsed.runs.map((r) => r.phase), ['plan', 'code']);
    assert.deepEqual(parsed.runs.map((r) => r.durationMs), [600000, 1200000]);
    assert.equal(parsed.totals.toolCalls, 4);
    assert.equal(parsed.totals.tools.run_shell_command, 2);
    assert.equal(parsed.totals.tools.edit, 1);
    assert.equal(parsed.totals.tools.write_file, 1);
    // shell-скелеты: git status и git status --porcelain в одном ключе
    assert.deepEqual(parsed.totals.shellTop, [{ skeleton: 'git status', count: 2 }]);
    assert.deepEqual(parsed.totals.edits, [{ key: 'src/a.ts', count: 1 }]);
    assert.deepEqual(parsed.totals.writes, [{ key: 'src/b.ts', count: 1 }]);
    assert.equal(parsed.totals.requests, 2);
    assert.equal(parsed.totals.input, 300);
    assert.equal(parsed.runs[1].maxPayloadBytes, 9000);
    assert.deepEqual(parsed.warnings, []);
  });

  it('текстовый вывод содержит ключевые строки', async () => {
    const { out } = await capture(() => run(['session', 'summary', SESSION_ID]));
    assert.match(out, /Сводка сессии agent-1793328615846/);
    assert.match(out, /задача VL-9/);
    assert.match(out, /ранов: 2/);
    assert.match(out, /tool-calls: 4/);
    assert.match(out, /#1 plan/);
    assert.match(out, /#2 code/);
    assert.match(out, /shell \(скелеты\): git status×2/);
    assert.match(out, /src\/a\.ts/);
  });

  it('--task VL-9 находит ту же сессию', async () => {
    const { out } = await capture(() => run(['session', 'summary', '--task', 'VL-9', '--json']));
    const parsed = JSON.parse(out);
    assert.equal(parsed.sessionId, SESSION_ID);
  });

  it('алиас agent-session работает (роутер ведёт в тот же обработчик)', async () => {
    const parsed = parseArgs(['agent-session', 'summary', SESSION_ID, '--json']);
    const { out } = await capture(() =>
      runSession(parsed.subcommand, parsed.positional, parsed.flags, testRoot),
    );
    assert.equal(JSON.parse(out).kind, 'session-summary');
  });

  it('префикс vb: снимается', async () => {
    const { out } = await capture(() => run(['session', 'summary', `vb:${SESSION_ID}`, '--json']));
    assert.equal(JSON.parse(out).sessionId, SESSION_ID);
  });

  it('несуществующая сессия: ошибка и exitCode 1', async () => {
    const { err } = await capture(() => run(['session', 'summary', 'agent-0000000000000']));
    assert.match(err, /не найдена/);
    assert.equal(process.exitCode, 1);
  });

  it('--task без сессий задачи: ошибка и exitCode 1', async () => {
    const { err } = await capture(() => run(['session', 'summary', '--task', 'VL-777']));
    assert.match(err, /Сессий задачи VL-777 не найдено/);
    assert.equal(process.exitCode, 1);
  });

  it('без аргументов: подсказка синтаксиса', async () => {
    const { err } = await capture(() => run(['session', 'summary']));
    assert.match(err, /Укажите sessionId либо --task/);
    assert.equal(process.exitCode, 1);
  });

  it('битые строки jsonl пропускаются, сводка не падает', async () => {
    const brokenId = 'agent-1793328615999';
    const sessions = join(testRoot, '.vibelog', 'agent-sessions');
    writeFileSync(
      join(sessions, `${brokenId}.jsonl`),
      '{"role":"user","content":"Ты — автоматический исполнитель Vibelog (Фаза 2: Plan) для задачи VL-9."}\n' +
        '{битая строка\n' +
        '{"role":"assistant","content":null,"usage":{"input_tokens":5,"output_tokens":1,"cache_read_input_tokens":0,"total_tokens":6,"reasoning_tokens":0}}\n',
      'utf8',
    );
    const { out } = await capture(() => run(['session', 'summary', brokenId, '--json']));
    const parsed = JSON.parse(out);
    assert.equal(parsed.runs.length, 1);
    assert.equal(parsed.totals.requests, 1);
    assert.equal(parsed.totals.input, 5);
  });

  it('неизвестная подкоманда: справка и exitCode 1', async () => {
    const { err } = await capture(() => run(['session', 'nope']));
    assert.match(err, /Неизвестная подкоманда session: nope/);
    assert.match(err, /vibelog session summary/);
    assert.equal(process.exitCode, 1);
  });
});
