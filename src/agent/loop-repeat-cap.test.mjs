/**
 * VL-357 — фазовый прогресс вместо капа повторов (шаг 5).
 *
 * До VL-357 любое исчерпание капа повторов убивало ран кодом 1, даже когда
 * работа была сделана (регресс VL-349: merge прошёл, 3455 тестов зелёные, а
 * фаза падала на повторе `lesson_update`). Теперь `fail()` по капу срабатывает
 * только при НЕдостигнутой цели фазы: след выполненной работы (правка файла,
 * коммит, отчёт) делает завершение штатным.
 */

import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runLoop } from '../../dist/agent/loop.js';

const USER_MSG = [{ role: 'user', content: 'задача' }];

function fakeLlm(script) {
  const state = { calls: 0 };
  const llm = {
    async streamChat() {
      const step = script[state.calls] ?? script[script.length - 1];
      state.calls++;
      return { text: step.text ?? '', toolCalls: step.toolCalls ?? [], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } };
    },
  };
  return { llm, state };
}

function noopSpec() {
  return {
    name: 'backlog_update_task',
    description: 'write-заглушка',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    handler: async () => JSON.stringify({ ok: true, outcome: 'applied', message: 'Изменений нет', applied: {}, unchanged: ['type'], skipped: [] }),
  };
}

function editSpec(state) {
  return {
    name: 'edit',
    description: 'правка файла',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    handler: async () => {
      state.edits++;
      return 'файл записан';
    },
  };
}

describe('VL-357 — кап повторов при недостигнутой цели по-прежнему fail()', () => {
  it('вечный noop-повтор без правок → is_error:true', async () => {
    const scripts = Array.from({ length: 10 }, (_, i) => ({
      text: '',
      toolCalls: [{ id: `c${i}`, name: 'backlog_update_task', arguments: { id: 'VL-1', type: 'feature' } }],
    }));
    const { llm } = fakeLlm(scripts);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [noopSpec()] });
    assert.equal(res.is_error, true, 'работа не сделана — честный fail');
    assert.match(res.result, /повторила уже применённый вызов/, res.result.slice(0, 200));
  });
});

describe('VL-357 — кап повторов при ВЫПОЛНЕННОЙ работе завершает ран штатно', () => {
  it('есть правка файла (edit) → кап noop-повторов не убивает ран', async () => {
    const state = { edits: 0 };
    // Сначала модель реально правит файл, затем зацикливается на noop-вызове.
    const scripts = [
      { text: '', toolCalls: [{ id: 'e1', name: 'edit', arguments: { path: 'src/a.ts' } }] },
      { text: '', toolCalls: [{ id: 'e2', name: 'edit', arguments: { path: 'src/b.ts' } }] },
      ...Array.from({ length: 10 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: `c${i}`, name: 'backlog_update_task', arguments: { id: 'VL-1', type: 'feature' } }],
      })),
    ];
    const { llm } = fakeLlm(scripts);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [editSpec(state), noopSpec()] });
    assert.equal(res.is_error, false, `работа сделана — ран завершается штатно: ${res.result.slice(0, 300)}`);
    assert.equal(state.edits, 2, 'правки выполнены');
    assert.match(res.result, /Кап повторов исчерпан/, 'в тексте названа причина завершения');
    assert.match(res.result, /Работа в ране выполнена/, 'прогресс зафиксирован');
    assert.ok(res.progress, 'блок прогресса приложен к результату');
  });

  it('есть коммит (git_commit) → кап применённых повторов не убивает ран', async () => {
    const commitSpec = {
      name: 'git_commit',
      description: 'коммит',
      inputSchema: { type: 'object', properties: { paths: { type: 'array' } } },
      handler: async () => JSON.stringify({ ok: true, message: 'закоммичено', applied: {} }),
    };
    const appliedSpec = {
      name: 'backlog_update_task',
      description: 'write-заглушка',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      handler: async () => JSON.stringify({ ok: true, message: 'обновлено' }),
    };
    const same = { id: 'VL-1', type: 'feature' };
    const scripts = [
      { text: '', toolCalls: [{ id: 'g1', name: 'git_commit', arguments: { paths: ['a.ts'] } }] },
      ...Array.from({ length: 10 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: `c${i}`, name: 'backlog_update_task', arguments: same }],
      })),
    ];
    const { llm } = fakeLlm(scripts);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [commitSpec, appliedSpec] });
    assert.equal(res.is_error, false, `коммит есть — ран не падает: ${res.result.slice(0, 300)}`);
    assert.match(res.result, /Работа в ране выполнена/);
  });
});

/**
 * VL-361 — shell-работа как след прогресса.
 *
 * Фаза Close-worktree делает всю работу через `run_shell_command`: merge,
 * build, полный прогон тестов, уборку worktree. `git_commit` модель при этом
 * не вызывает, поэтому `runHasProgress()` возвращал false при полностью
 * выполненной работе и ран падал кодом 1 (сессия `agent-1794064942811`).
 *
 * Наивное «добавить имя в набор» дало бы регресс VL-124: ответ shell — плоский
 * текст, и упавшая команда выдала бы себя за работу. Поэтому класс команды и
 * успех разбираются отдельно (`shellCallIsWork`).
 */

function shellSpec(outputs) {
  const state = { calls: 0 };
  return {
    state,
    spec: {
      name: 'run_shell_command',
      description: 'shell-заглушка',
      inputSchema: { type: 'object', properties: { command: { type: 'string' } } },
      handler: async (args) => {
        const out = outputs[state.calls] ?? outputs[outputs.length - 1];
        state.calls++;
        return typeof out === 'function' ? out(args) : out;
      },
    },
  };
}

const SHELL_OK = (cmd) => `exit code: 0\nstdout:\n${cmd} ok\nstderr:\n`;

describe('VL-361 — shell-работа учитывается как прогресс рана', () => {
  it('регресс agent-1794064942811: merge + build + тесты через shell, затем noop-повторы → штатное завершение', async () => {
    const { spec, state } = shellSpec([
      (a) => SHELL_OK(a.command),
      (a) => SHELL_OK(a.command),
      (a) => SHELL_OK(a.command),
    ]);
    const scripts = [
      { text: '', toolCalls: [{ id: 's1', name: 'run_shell_command', arguments: { command: 'git merge --no-ff vb/vl-359' } }] },
      { text: '', toolCalls: [{ id: 's2', name: 'run_shell_command', arguments: { command: 'pnpm build' } }] },
      { text: '', toolCalls: [{ id: 's3', name: 'run_shell_command', arguments: { command: 'npx vitest run' } }] },
      ...Array.from({ length: 10 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: `c${i}`, name: 'backlog_update_task', arguments: { id: 'VL-1', type: 'feature' } }],
      })),
    ];
    const { llm } = fakeLlm(scripts);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec, noopSpec()] });
    assert.equal(state.calls, 3, 'все три shell-команды исполнены');
    assert.equal(res.is_error, false, `shell-работа сделана — ран завершается штатно: ${res.result.slice(0, 300)}`);
    assert.match(res.result, /Работа в ране выполнена/);
    assert.ok(res.progress, 'блок прогресса приложен к результату');
  });

  it('регресс VL-124: shell с fatal: работой не считается → fail()', async () => {
    const { spec } = shellSpec([
      () => 'exit code: 1\nstdout:\nstderr:\nfatal: merge conflict in src/a.ts\n',
    ]);
    const scripts = [
      { text: '', toolCalls: [{ id: 's1', name: 'run_shell_command', arguments: { command: 'git merge --no-ff vb/vl-1' } }] },
      ...Array.from({ length: 10 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: `c${i}`, name: 'backlog_update_task', arguments: { id: 'VL-1', type: 'feature' } }],
      })),
    ];
    const { llm } = fakeLlm(scripts);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec, noopSpec()] });
    assert.equal(res.is_error, true, 'упавшая команда не выдаёт себя за работу');
    assert.match(res.result, /повторила уже применённый вызов/);
  });

  it('shell с exit code 1 в выводе работой не считается', async () => {
    const { spec } = shellSpec([() => 'exit code: 1\nstdout:\nstderr:\n']);
    const scripts = [
      { text: '', toolCalls: [{ id: 's1', name: 'run_shell_command', arguments: { command: 'pnpm build' } }] },
      ...Array.from({ length: 10 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: `c${i}`, name: 'backlog_update_task', arguments: { id: 'VL-1', type: 'feature' } }],
      })),
    ];
    const { llm } = fakeLlm(scripts);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec, noopSpec()] });
    assert.equal(res.is_error, true, 'ненулевой код возврата — не работа');
  });

  it('shell-команда вне класса работы (ls, cat) работой не считается', async () => {
    const { spec } = shellSpec([() => 'exit code: 0\nstdout:\nfile.txt\nstderr:\n']);
    const scripts = [
      { text: '', toolCalls: [{ id: 's1', name: 'run_shell_command', arguments: { command: 'ls -la' } }] },
      ...Array.from({ length: 10 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: `c${i}`, name: 'backlog_update_task', arguments: { id: 'VL-1', type: 'feature' } }],
      })),
    ];
    const { llm } = fakeLlm(scripts);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec, noopSpec()] });
    assert.equal(res.is_error, true, 'чтение каталога — не след работы');
  });
});

/**
 * VL-368 — в фазах с обязательным отчётом след работы не доказывает успех.
 *
 * Close с коммитом документации и последующим капом повторов `lesson_update`
 * завершался «штатно» (is_error:false) при неотмеченных AC/DoD: статус не
 * откатывался, авто-resume не запускался, задача молча висела. Теперь
 * «нужен отчёт» вычисляется из workflow (`phaseNextStep`, VL-410), и
 * `runHasProgress()` требует `reportWritten`.
 */
describe('VL-368 — close без отчёта: кап повторов даёт честный fail()', () => {
  // VL-410: признак «нужен отчёт» считается из workflow задачи, поэтому рану
  // нужны cwd и задача. Каталог — mkdtemp (AGENTS.md: фиксированные пути
  // запрещены), задача — минимальный объект: workflow берётся по типу.
  const projectDir = mkdtempSync(join(tmpdir(), 'vibelog-loop-cap-'));
  afterAll(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });
  const closeTask = { id: 'VL-1', type: 'task', status: 'Review' };
  const codeTask = { id: 'VL-1', type: 'task', status: 'Planned' };

  const appliedSpec = {
    name: 'lesson_update',
    description: 'write-заглушка, ответ ok',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    handler: async () => JSON.stringify({ ok: true, message: 'обновлено' }),
  };
  const commitSpec = {
    name: 'git_commit',
    description: 'коммит',
    inputSchema: { type: 'object', properties: { paths: { type: 'array' } } },
    handler: async () => JSON.stringify({ ok: true, message: 'закоммичено', applied: {} }),
  };
  const finishSpec = {
    name: 'backlog_finish_phase',
    description: 'отчёт фазы',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    handler: async () => JSON.stringify({ ok: true, message: 'отчёт записан' }),
  };

  it('close: коммит документации + кап повторов lesson_update → is_error:true', async () => {
    const same = { id: 'lesson-1' };
    const scripts = [
      { text: '', toolCalls: [{ id: 'g1', name: 'git_commit', arguments: { paths: ['docs/a.md'] } }] },
      ...Array.from({ length: 10 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: `c${i}`, name: 'lesson_update', arguments: same }],
      })),
    ];
    const { llm } = fakeLlm(scripts);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [commitSpec, appliedSpec],
      phase: 'close',
      cwd: projectDir,
      task: closeTask,
    });
    assert.equal(res.is_error, true, `без отчёта фаза не завершена: ${res.result.slice(0, 300)}`);
    assert.match(res.result, /отчёт фазы \(backlog_finish_phase\) не записан/);
  });

  it('close: тот же сценарий с записанным отчётом → штатное завершение', async () => {
    const same = { id: 'lesson-1' };
    const scripts = [
      { text: '', toolCalls: [{ id: 'g1', name: 'git_commit', arguments: { paths: ['docs/a.md'] } }] },
      { text: '', toolCalls: [{ id: 'f1', name: 'backlog_finish_phase', arguments: { id: 'VL-1' } }] },
      ...Array.from({ length: 10 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: `c${i}`, name: 'lesson_update', arguments: same }],
      })),
    ];
    const { llm } = fakeLlm(scripts);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [commitSpec, finishSpec, appliedSpec],
      phase: 'close',
      cwd: projectDir,
      task: closeTask,
    });
    assert.equal(res.is_error, false, `отчёт записан — ран завершается штатно: ${res.result.slice(0, 300)}`);
  });

  it('VL-410: code тоже требует отчёта — у фазы есть переход (Planned → Review)', async () => {
    // До VL-410 «нужен отчёт» было захардкожено для close. Теперь признак
    // вычисляется из workflow: у code переход есть, значит отчёт обязателен.
    const same = { id: 'lesson-1' };
    const scripts = [
      { text: '', toolCalls: [{ id: 'g1', name: 'git_commit', arguments: { paths: ['src/a.ts'] } }] },
      ...Array.from({ length: 10 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: `c${i}`, name: 'lesson_update', arguments: same }],
      })),
    ];
    const { llm } = fakeLlm(scripts);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [commitSpec, appliedSpec],
      phase: 'code',
      cwd: projectDir,
      task: codeTask,
    });
    assert.equal(res.is_error, true, `code без отчёта — фаза не завершена: ${res.result.slice(0, 300)}`);
    assert.match(res.result, /отчёт фазы \(backlog_finish_phase\) не записан/);
  });

  it('VL-410: code с записанным отчётом — штатное завершение', async () => {
    const same = { id: 'lesson-1' };
    const scripts = [
      { text: '', toolCalls: [{ id: 'g1', name: 'git_commit', arguments: { paths: ['src/a.ts'] } }] },
      { text: '', toolCalls: [{ id: 'f1', name: 'backlog_finish_phase', arguments: { id: 'VL-1' } }] },
      ...Array.from({ length: 10 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: `c${i}`, name: 'lesson_update', arguments: same }],
      })),
    ];
    const { llm } = fakeLlm(scripts);
    const res = await runLoop({
      llm,
      messages: USER_MSG,
      tools: [commitSpec, finishSpec, appliedSpec],
      phase: 'code',
      cwd: projectDir,
      task: codeTask,
    });
    assert.equal(res.is_error, false, `отчёт записан — ран завершается штатно: ${res.result.slice(0, 300)}`);
  });
});

/**
 * VL-411 — повтор noop-вызова блокирует ИНСТРУМЕНТ в ране, а не считает до трёх.
 *
 * Инцидент: сессия `agent-1794313856082` (spec VL-408) — модель четыре раза
 * дословно повторила `backlog_update_task {id, type}`, получила четыре
 * одинаковых noop-директивы и упёрлась в кап `MAX_NOOP_REPEATS_PER_RUN=3` →
 * `fail()` → откат статуса. Эскалации не было: 1-й, 2-й и 3-й повтор давали
 * ОДИН И ТОТ ЖЕ текст, а 4-й убивал ран. Теперь после второго дословного
 * повтора инструмент блокируется: вызов не доходит до handler, а модели
 * уходит машиночитаемый отказ `tool_blocked` с единственным доступным путём
 * завершения фазы — `backlog_finish_phase`.
 */
describe('VL-411 — блокировка инструмента после второго noop-повтора', () => {
  const SAME = { id: 'VL-1', type: 'feature' };

  function countingNoopSpec() {
    const state = { calls: 0 };
    return {
      state,
      spec: {
        name: 'backlog_update_task',
        description: 'write-заглушка, ответ noop',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        handler: async () => {
          state.calls++;
          return JSON.stringify({ ok: true, outcome: 'applied', message: 'Изменений нет', applied: {}, unchanged: ['type'], skipped: [] });
        },
      },
    };
  }

  function finishSpec() {
    const state = { calls: 0 };
    return {
      state,
      spec: {
        name: 'backlog_finish_phase',
        description: 'отчёт фазы',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        handler: async () => {
          state.calls++;
          return JSON.stringify({ ok: true, message: 'отчёт записан' });
        },
      },
    };
  }

  it('P6: после 2-го дословного повтора вызов не доходит до handler и получает tool_blocked (AC1)', async () => {
    const { spec, state } = countingNoopSpec();
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'backlog_update_task', arguments: SAME }] },
      { text: '', toolCalls: [{ id: 'c2', name: 'backlog_update_task', arguments: SAME }] },
      { text: '', toolCalls: [{ id: 'c3', name: 'backlog_update_task', arguments: SAME }] },
      { text: '', toolCalls: [{ id: 'c4', name: 'backlog_update_task', arguments: SAME }] },
      { text: 'готово' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(state.calls, 1, 'исполнен только первый вызов; повторы не доходят до handler');
    const blocked = res.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'c4');
    assert.ok(blocked, 'модель получает ответ на заблокированный вызов');
    const parsed = JSON.parse(String(blocked.content));
    assert.equal(parsed.outcome, 'rejected', 'исход — отказ, а не noop');
    assert.equal(parsed.reason, 'tool_blocked');
    assert.equal(parsed.tool_blocked, true, 'причина объявлена флагом');
    assert.match(parsed.message, /заблокирован в этом ране/);
    assert.match(parsed.message, /backlog_finish_phase/);
    assert.equal(res.is_error, false, 'ран продолжается — модель может завершить фазу');
  });

  it('AC2: блокировка per-name не мешает другим инструментам (finish_phase, manage_ac, чтения)', async () => {
    const { spec, state } = countingNoopSpec();
    const finish = finishSpec();
    const acSpec = {
      name: 'backlog_manage_ac',
      description: 'AC',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      handler: async () => JSON.stringify({ ok: true, message: 'AC отмечены' }),
    };
    const readSpec = {
      name: 'backlog_view_task',
      description: 'чтение',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      handler: async () => JSON.stringify({ ok: true, read: true, message: 'задача' }),
    };
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'backlog_update_task', arguments: SAME }] },
      { text: '', toolCalls: [{ id: 'c2', name: 'backlog_update_task', arguments: SAME }] },
      { text: '', toolCalls: [{ id: 'c3', name: 'backlog_update_task', arguments: SAME }] },
      { text: '', toolCalls: [{ id: 'r1', name: 'backlog_view_task', arguments: { id: 'VL-1' } }] },
      { text: '', toolCalls: [{ id: 'a1', name: 'backlog_manage_ac', arguments: { id: 'VL-1' } }] },
      { text: '', toolCalls: [{ id: 'f1', name: 'backlog_finish_phase', arguments: { id: 'VL-1' } }] },
      { text: 'фаза завершена' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec, finish.spec, acSpec, readSpec] });
    assert.equal(state.calls, 1, 'заблокирован только backlog_update_task');
    assert.equal(finish.state.calls, 1, 'backlog_finish_phase прошёл после блокировки');
    assert.equal(res.result, 'фаза завершена');
    const readMsg = res.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'r1');
    assert.ok(!String(readMsg.content).includes('tool_blocked'), 'чтение не заблокировано');
  });

  it('AC3: тот же инструмент с ДРУГИМИ аргументами исполняется как обычно', async () => {
    const { spec, state } = countingNoopSpec();
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'backlog_update_task', arguments: SAME }] },
      { text: '', toolCalls: [{ id: 'c2', name: 'backlog_update_task', arguments: SAME }] },
      { text: '', toolCalls: [{ id: 'c3', name: 'backlog_update_task', arguments: SAME }] },
      { text: '', toolCalls: [{ id: 'c4', name: 'backlog_update_task', arguments: { id: 'VL-1', priority: 'High' } }] },
      { text: 'готово' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(state.calls, 2, 'вызов с другими аргументами дошёл до handler');
    const other = res.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'c4');
    assert.ok(!String(other.content).includes('tool_blocked'), 'другие аргументы не блокируются');
  });

  it('AC5: исчерпание капа обращений к заблокированному инструменту называет незавершённую фазу', async () => {
    const { spec } = countingNoopSpec();
    const { llm } = fakeLlm(
      Array.from({ length: 12 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: `c${i}`, name: 'backlog_update_task', arguments: SAME }],
      })),
    );
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec], phase: 'spec' });
    assert.equal(res.is_error, true, 'вечный круг по заблокированному инструменту — честный fail');
    assert.match(res.result, /Фаза spec не завершена/);
    assert.match(res.result, /backlog_finish_phase не вызван/);
  });

  it('AC6: регресс agent-1794313856082 — 3 applied + 4 noop {id,type} доходят до backlog_finish_phase', async () => {
    // Реальная сессия spec VL-408: три успешных обновления задачи, затем
    // четыре дословных повтора {id, type} с ответом noop → кап → fail.
    // Теперь повторы не крутятся: инструмент блокируется, а модель доходит
    // до отчёта фазы.
    const state = { applied: 0, noop: 0 };
    const mixedSpec = {
      name: 'backlog_update_task',
      description: 'write-заглушка: первые вызовы ok, дальше noop',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      handler: async (args) => {
        if (args.type === 'feature') {
          state.noop++;
          return JSON.stringify({ ok: true, outcome: 'applied', message: 'Изменений нет', applied: {}, unchanged: ['type'], skipped: [] });
        }
        state.applied++;
        return JSON.stringify({ ok: true, message: 'обновлено' });
      },
    };
    const finish = finishSpec();
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'a1', name: 'backlog_update_task', arguments: { id: 'VL-408', title: 'T' } }] },
      { text: '', toolCalls: [{ id: 'a2', name: 'backlog_update_task', arguments: { id: 'VL-408', priority: 'High' } }] },
      { text: '', toolCalls: [{ id: 'a3', name: 'backlog_update_task', arguments: { id: 'VL-408', labels: ['x'] } }] },
      ...Array.from({ length: 4 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: `n${i}`, name: 'backlog_update_task', arguments: SAME }],
      })),
      { text: '', toolCalls: [{ id: 'f1', name: 'backlog_finish_phase', arguments: { id: 'VL-408' } }] },
      { text: 'фаза завершена' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [mixedSpec, finish.spec], phase: 'spec' });
    assert.equal(state.applied, 3, 'три успешных обновления исполнены');
    assert.equal(state.noop, 1, 'noop-вызов исполнен один раз, повторы заблокированы');
    assert.equal(finish.state.calls, 1, 'ран дошёл до backlog_finish_phase');
    assert.equal(res.is_error, false, `ран не крутится на повторах: ${res.result.slice(0, 300)}`);
  });
});
