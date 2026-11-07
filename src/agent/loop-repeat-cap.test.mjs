/**
 * VL-357 — фазовый прогресс вместо капа повторов (шаг 5).
 *
 * До VL-357 любое исчерпание капа повторов убивало ран кодом 1, даже когда
 * работа была сделана (регресс VL-349: merge прошёл, 3455 тестов зелёные, а
 * фаза падала на повторе `lesson_update`). Теперь `fail()` по капу срабатывает
 * только при НЕдостигнутой цели фазы: след выполненной работы (правка файла,
 * коммит, отчёт) делает завершение штатным.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

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
    handler: async () => JSON.stringify({ ok: false, noop: true, reason: 'noop', message: 'Изменений нет', applied: {}, skipped: [] }),
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
    assert.match(res.result, /повторила вызов/, res.result.slice(0, 200));
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
    assert.match(res.result, /повторила вызов/);
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
 * откатывался, авто-resume не запускался, задача молча висела. Теперь для
 * `REPORT_REQUIRED_PHASES` (close) `runHasProgress()` требует `reportWritten`.
 */
describe('VL-368 — close без отчёта: кап повторов даёт честный fail()', () => {
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
    });
    assert.equal(res.is_error, false, `отчёт записан — ран завершается штатно: ${res.result.slice(0, 300)}`);
  });

  it('вне close (code) след работы по-прежнему достаточен', async () => {
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
    });
    assert.equal(res.is_error, false, `code: коммит — достаточный след работы: ${res.result.slice(0, 300)}`);
  });
});
