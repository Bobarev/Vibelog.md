/**
 * Свойства класса «модель крутится на повторах» (VL-371): P1–P4.
 *
 * До VL-371 регресс этого класса держался на ~20 тестах, названных по ID
 * сессии (`agent-1794045441657`, `agent-1794053090709`, …). Каждый
 * воспроизводил конкретный транскрипт, и свойство «тупик в необязательном шаге
 * не роняет ран» не проверялось ни одним тестом — проверялись 20 частных
 * случаев. Здесь проверяются СВОЙСТВА; конкретные сессии остаются примерами
 * внутри существующих тестов `loop.test.mjs` и `loop-repeat-cap.test.mjs`.
 *
 * Реестр свойств — `src/agent/loop-properties.mjs` (данные без тестов, чтобы
 * матрица трассировки могла их импортировать, не регистрируя `it` дважды).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { runLoop } from '../../dist/agent/loop.js';

const USER_MSG = [{ role: 'user', content: 'задача' }];

/** Фейковый LLM: очередь ответов (копия хелпера из loop.test.mjs). */
function fakeLlm(script) {
  const state = { calls: 0 };
  const llm = {
    async streamChat() {
      const step = script[state.calls] ?? script[state.length - 1];
      state.calls++;
      return {
        text: step.text ?? '',
        toolCalls: step.toolCalls ?? [],
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      };
    },
  };
  return { llm, state };
}

/** Заглушка write-инструмента с фиксированным ответом. */
function stubSpec(name, response, state = { calls: 0 }) {
  return {
    state,
    spec: {
      name,
      description: `заглушка ${name}`,
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      handler: async () => {
        state.calls++;
        return typeof response === 'function' ? response() : response;
      },
    },
  };
}

/** Серия одинаковых вызовов одного инструмента. */
function repeatCalls(name, args, count) {
  return Array.from({ length: count }, (_, i) => ({
    text: '',
    toolCalls: [{ id: `c${i + 1}`, name, arguments: args }],
  }));
}

/** Tool-сообщения рана (в порядке появления). */
function toolMessages(res) {
  return res.messages.filter((m) => m.role === 'tool').map((m) => String(m.content));
}

describe('P1 — вызов с корректными аргументами на неполной сущности не даёт отказа', () => {
  it('P1: частичное применение (ok:true + missing) не блокирует шаг и не роняет ран', async () => {
    // Класс VL-355/VL-356: инструмент отвечал ЖЁСТКИМ отказом на отсутствие
    // поля, без которого операция осмысленна (урок без тела). Модель не могла
    // выполнить шаг, повторяла вызов дословно и падала по капу повторов.
    // Свойство: корректные аргументы на неполной сущности → partial, не отказ.
    const { spec, state } = stubSpec('lesson_update', JSON.stringify({
      ok: true,
      outcome: 'partial',
      message: 'Lesson lesson-1 обновлён: linked_tasks (тело урока всё ещё не заполнено)',
      applied: { linked_tasks: ['VL-371'] },
      skipped: [],
      missing: [{ field: 'content', reason: 'тело урока не заполнено' }],
      hint: 'Добавь в вызов `content` с непустым markdown.',
    }));
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'lesson_update', arguments: { id: 'lesson-1', linkedTasks: ['VL-371'] } }] },
      { text: 'Готово' },
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    assert.equal(res.is_error, false, `ран не должен падать: ${res.result}`);
    assert.equal(res.result, 'Готово', 'модель дошла до финального текста');
    assert.equal(state.calls, 1, 'вызов исполнен один раз');
    const first = JSON.parse(toolMessages(res)[0]);
    assert.equal(first.ok, true, 'частичное применение — не ошибка');
    assert.equal(first.outcome, 'partial', 'исход объявлен полем, а не выводится из текста');
    assert.notEqual(first.outcome, 'rejected', 'отказа нет');
    assert.equal(first.missing[0].field, 'content', 'незаполненное поле названо');
  });
});

describe('P2 — серия повторов не роняет ран, если работа в ране выполнена', () => {
  // Свойство проверяется по ВСЕМ видам следа работы, а не по одному: правка
  // файла, запись файла, коммит и успешная shell-команда класса
  // «меняет состояние / проверяет результат» (VL-357 шаг 5 + VL-361).
  const EVIDENCE = [
    ['edit', { path: 'src/a.ts' }, 'файл записан'],
    ['write_file', { path: 'src/b.ts', content: 'x' }, 'файл записан'],
    ['git_commit', { paths: ['src/a.ts'], message: 'feat: x' }, JSON.stringify({ ok: true, message: 'закоммичено' })],
    ['run_shell_command', { command: 'pnpm build' }, 'exit code: 0\nstdout:\nbuild ok\nstderr:\n'],
  ];

  for (const [name, args, output] of EVIDENCE) {
    it(`P2: след работы «${name}» + серия noop-повторов → ран завершается штатно`, async () => {
      const evidence = stubSpec(name, output);
      const noop = stubSpec('backlog_update_task', JSON.stringify({
        ok: false, noop: true, reason: 'noop', message: 'Изменений нет', applied: {}, skipped: [],
      }));
      const { llm } = fakeLlm([
        { text: '', toolCalls: [{ id: 'w1', name, arguments: args }] },
        ...repeatCalls('backlog_update_task', { id: 'VL-1', type: 'feature' }, 10),
      ]);
      const res = await runLoop({ llm, messages: USER_MSG, tools: [evidence.spec, noop.spec] });
      assert.equal(evidence.state.calls, 1, 'след работы выполнен');
      assert.equal(res.is_error, false, `работа сделана — ран не падает: ${String(res.result).slice(0, 300)}`);
      assert.ok(res.progress, 'блок прогресса приложен к результату');
    });
  }
});

describe('P3 — отказ всегда несёт готовый следующий шаг', () => {
  // Набор форм отказа: hint, retryWith, только error, noop+missing. Свойство:
  // директива повтора несёт машиночитаемый следующий шаг (JSON `next.*`) либо
  // — в плоской форме loop detection — имя инструмента и текст отказа самого
  // инструмента. Формулировки директивы не проверяются.
  const CASES = [
    {
      label: 'ackError + hint',
      response: JSON.stringify({
        ok: false, error: 'git_commit: чужой путь', hint: 'Добавь в вызов `allowForeign: true`.',
      }),
      toolText: 'Добавь в вызов `allowForeign: true`.',
    },
    {
      label: 'ackError + retryWith',
      response: JSON.stringify({
        ok: false, error: 'git_commit: чужой путь', retryWith: { allowForeign: true },
      }),
      toolText: '"allowForeign":true',
    },
    {
      label: 'ackError только с error',
      response: JSON.stringify({ ok: false, error: 'git_commit: чужой путь; передай allowForeign: true' }),
      toolText: 'передай allowForeign: true',
    },
    {
      label: 'noop + missing',
      response: JSON.stringify({
        ok: false, noop: true, reason: 'noop', message: 'Изменений нет',
        applied: {}, skipped: [],
        missing: [{ field: 'content', reason: 'тело урока не заполнено' }],
        hint: 'Добавь в вызов `content`.',
      }),
      toolText: 'content',
    },
  ];

  for (const { label, response, toolText } of CASES) {
    it(`P3: отказ «${label}» → директива несёт следующий шаг`, async () => {
      const { spec } = stubSpec('git_commit', response);
      const { llm } = fakeLlm(repeatCalls('git_commit', { paths: ['CHANGELOG.md'], message: 'docs' }, 3));
      const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
      const directives = toolMessages(res).filter((t) => t.includes('Loop detection') || t.includes('"outcome"'));
      assert.ok(directives.length > 0, `директива повтора отправлена: ${toolMessages(res).join(' ⏎ ')}`);
      const last = directives[directives.length - 1];
      let machineReadable = false;
      try {
        const parsed = JSON.parse(last);
        const next = parsed.next ?? parsed;
        machineReadable = Boolean(
          (next.retryWith && Object.keys(next.retryWith).length > 0)
          || (typeof next.hint === 'string' && next.hint !== '')
          || (Array.isArray(next.missing) && next.missing.length > 0),
        );
      } catch {
        machineReadable = false;
      }
      // Плоская форма loop detection: имя инструмента + текст отказа инструмента
      // (данные инструмента, а не проза директивы).
      const flatWithStep = last.includes('git_commit') && last.includes(toolText);
      assert.ok(
        machineReadable || flatWithStep,
        `директива несёт готовый следующий шаг: ${last}`,
      );
    });
  }
});

describe('P4 — необязательный шаг фазы (уроки) не роняет фазу', () => {
  it('P4: отказ необязательного шага уроков не мешает завершить фазу', async () => {
    const lesson = stubSpec('lesson_update', JSON.stringify({
      ok: false, reason: 'error',
      error: 'Тело урока не заполнено — в вызове нет `content`.',
      applied: {}, skipped: [],
      missing: [{ field: 'content', reason: 'тело урока не заполнено' }],
      hint: 'Добавь в вызов `content` с непустым markdown.',
    }));
    const finish = stubSpec('backlog_finish_phase', JSON.stringify({
      ok: true, message: 'Фаза завершена', applied: { status: 'Review' }, skipped: [],
    }));
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'c1', name: 'lesson_update', arguments: { id: 'lesson-1', verifiedBy: 'agent' } }] },
      { text: '', toolCalls: [{ id: 'c2', name: 'backlog_finish_phase', arguments: { id: 'VL-1', comment: 'отчёт' } }] },
      { text: 'Готово' },
    ]);
    // Фаза, отличная от close: в close отчёт обязателен (VL-368), и свойство
    // проверялось бы вместе с гейтом отчёта, а не само по себе.
    const res = await runLoop({ llm, messages: USER_MSG, tools: [lesson.spec, finish.spec], phase: 'code' });
    assert.equal(res.is_error, false, `ран не должен падать: ${res.result}`);
    assert.equal(res.result, 'Готово', 'модель дошла до финального текста');
    assert.equal(finish.state.calls, 1, 'отчёт фазы записан');
  });

  it('P4: серия отказов уроков при записанном отчёте не роняет ран', async () => {
    // Кап MAX_ERROR_REPEATS_PER_RUN исчерпан, но отчёт фазы уже записан —
    // работа в ране выполнена, ран завершается штатно (VL-357 шаг 5).
    const lesson = stubSpec('lesson_update', JSON.stringify({
      ok: false, reason: 'error', error: 'Тело урока не заполнено.', applied: {}, skipped: [],
    }));
    const finish = stubSpec('backlog_finish_phase', JSON.stringify({
      ok: true, message: 'Фаза завершена', applied: { status: 'Review' }, skipped: [],
    }));
    const { llm } = fakeLlm([
      { text: '', toolCalls: [{ id: 'f1', name: 'backlog_finish_phase', arguments: { id: 'VL-1', comment: 'отчёт' } }] },
      ...repeatCalls('lesson_update', { id: 'lesson-1', verifiedBy: 'agent' }, 10),
    ]);
    const res = await runLoop({ llm, messages: USER_MSG, tools: [lesson.spec, finish.spec], phase: 'code' });
    assert.equal(res.is_error, false, `отчёт записан — ран не падает: ${String(res.result).slice(0, 300)}`);
    assert.ok(res.progress, 'блок прогресса приложен к результату');
  });
});
