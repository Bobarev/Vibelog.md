/**
 * Свойство P5 (VL-371): директива повтора не растёт по числу повторов.
 *
 * Заменяет шесть независимых копий байтового порога (`< 400` / `< 1200`) в
 * `loop.test.mjs` и одну в `repeat-tracker-vl357.test.mjs`. Те пороги
 * проверяли РАЗМЕР СТРОКИ, а не отсутствие зацикливания: любая правка
 * формулировки директивы роняла тест при неизменном поведении, а порог
 * успевал разъехаться (400 в шести местах, 1200 в одном).
 *
 * Здесь проверяется то, что действительно важно: payload не раздувается по
 * числу повторов, и директива ограничена единственной константой
 * `DIRECTIVE_MAX_BYTES` (`src/agent/repeat-tracker.ts`).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { runLoop } from '../../dist/agent/loop.js';
import { DIRECTIVE_MAX_BYTES, retryDirective } from '../../dist/agent/repeat-tracker.js';

const USER_MSG = [{ role: 'user', content: 'задача' }];

/** Фейковый LLM: очередь ответов (копия хелпера из loop.test.mjs). */
function fakeLlm(script) {
  const state = { calls: 0 };
  const llm = {
    async streamChat() {
      const step = script[state.calls] ?? script[script.length - 1];
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

/**
 * Допуск на «не растёт»: директивы одной серии могут отличаться на длину
 * имени инструмента и на номер повтора в тексте, но не на порядок.
 */
const TOLERANCE_BYTES = 64;

/**
 * Проверяет свойство «директива не растёт по числу повторов».
 *
 * Два условия одновременно: последняя директива серии не длиннее первой
 * (с допуском) И каждая укладывается в потолок `2 × DIRECTIVE_MAX_BYTES`
 * (потолок, а не точный лимит: JSON-контракт ack с `missing`/`hint` длиннее
 * плоской строки, и это осознанно — VL-361).
 */
function assertNotGrowing(directives) {
  assert.ok(directives.length >= 3, `серия состоялась (${directives.length})`);
  const sizes = directives.map((d) => Buffer.byteLength(String(d), 'utf8'));
  const first = sizes[0];
  const last = sizes[sizes.length - 1];
  assert.ok(
    last <= first + TOLERANCE_BYTES,
    `директива не растёт по числу повторов: ${first} → ${last} (${sizes.join(', ')})`,
  );
  for (const size of sizes) {
    assert.ok(
      size <= 2 * DIRECTIVE_MAX_BYTES,
      `директива ограничена (${size} ≤ ${2 * DIRECTIVE_MAX_BYTES})`,
    );
  }
}

describe('P5 — размер директивы повтора', () => {
  it('P5: серия noop-повторов — директивы не растут', async () => {
    // Оговорка: директивы noop-повторов собираются `serializeAck` с постоянным
    // набором полей, поэтому «не растёт» здесь выполняется почти по построению.
    // Тест страхует от появления переменной части (накопления истории в
    // директиву); основную нагрузку несут два следующих теста.
    const spec = {
      name: 'backlog_update_task',
      description: 'write-заглушка',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      handler: async () => JSON.stringify({
        ok: false, noop: true, reason: 'noop', message: 'Изменений нет', applied: {}, skipped: [],
      }),
    };
    const same = { id: 'VL-1', type: 'feature' };
    const { llm } = fakeLlm(Array.from({ length: 10 }, (_, i) => ({
      text: '',
      toolCalls: [{ id: `c${i + 1}`, name: 'backlog_update_task', arguments: same }],
    })));
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    const directives = res.messages
      .filter((m) => m.role === 'tool' && /noop_repeat|applied_repeat/.test(String(m.content)))
      .map((m) => String(m.content));
    assertNotGrowing(directives);
  });

  it('P5: серия повторов ackError с длинным текстом ошибки — директивы не растут', async () => {
    // Основной тест свойства: текст отказа длинный (12 повторов фразы), и
    // именно он раньше раздувал директиву. Усечение обязано держать размер
    // постоянным, а не накапливать текст по числу повторов.
    const spec = {
      name: 'git_commit',
      description: 'write-заглушка с длинной ошибкой',
      inputSchema: { type: 'object', properties: { paths: { type: 'array' } } },
      handler: async () => JSON.stringify({
        ok: false,
        error: `git_commit: ${'очень длинное описание причины отказа '.repeat(12)}передай allowForeign: true`,
        hint: 'Добавь в вызов `allowForeign: true`.',
      }),
    };
    const same = { paths: ['backlog/docs/doc-10.md'], message: 'docs' };
    const { llm } = fakeLlm(Array.from({ length: 10 }, (_, i) => ({
      text: '',
      toolCalls: [{ id: `c${i + 1}`, name: 'git_commit', arguments: same }],
    })));
    const res = await runLoop({ llm, messages: USER_MSG, tools: [spec] });
    const directives = res.messages
      .filter((m) => m.role === 'tool' && String(m.content).includes('Loop detection'))
      .map((m) => String(m.content));
    assertNotGrowing(directives);
  });

  it('P5: retryDirective с длинными кириллическими путями укладывается в DIRECTIVE_MAX_BYTES', async () => {
    // Прямая проверка реального усечения: `retryDirective` перебирает варианты
    // (все пути → первый путь → пустой список), сохраняя `retryWith`.
    const longPaths = [
      'backlog/docs/doc-10-Агент-Vibelog-vibelog-agent-очень-длинное-имя.md',
      'backlog/lessons/lesson-198-Повторяй-текст-последнего-ackError-и-готовое-исправление.md',
      'backlog/references/ref-25-Очень-длинное-имя-внешнего-источника-знаний.md',
    ];
    const text = retryDirective(
      'git_commit',
      { allowForeign: true },
      { paths: longPaths, message: 'docs: VL-371 — длинные кириллические пути в директиве' },
    );
    assert.ok(
      Buffer.byteLength(text, 'utf8') <= DIRECTIVE_MAX_BYTES,
      `директива укладывается в DIRECTIVE_MAX_BYTES (${Buffer.byteLength(text, 'utf8')})`,
    );
    assert.match(text, /"allowForeign":true/, 'смысл директивы (retryWith) сохранён при усечении');
  });
});
