/**
 * VL-357 (шаг 3) — единый детектор повторов.
 *
 * До VL-357 пороги и директивы жили в трёх местах (loop.ts, repeat-tracker.ts,
 * web/tool-dedup.ts) с разными значениями и разными словарями. Теперь источник
 * один: `REPEAT_LIMITS` + `callSignature`/`repeatKey` здесь, остальные слои —
 * потребители.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  REPEAT_LIMITS,
  MAX_APPLIED_REPEATS_PER_RUN,
  MAX_ERROR_REPEATS_PER_RUN,
  MAX_UNCHANGED_REPEATS_PER_RUN,
  NON_SEMANTIC_ARGS,
  DIRECTIVE_MAX_BYTES,
  callSignature,
  repeatKey,
  loopDetectionDirective,
  appliedRepeatDirective,
  parsedAckNext,
  parsedErrorText,
  clipErrorText,
} from '../../dist/agent/repeat-tracker.js';

describe('VL-357 — пороги повторов объявлены один раз', () => {
  it('именованные константы согласованы с REPEAT_LIMITS', () => {
    assert.equal(MAX_APPLIED_REPEATS_PER_RUN, REPEAT_LIMITS.applied);
    assert.equal(MAX_UNCHANGED_REPEATS_PER_RUN, REPEAT_LIMITS.unchanged);
    assert.equal(MAX_ERROR_REPEATS_PER_RUN, REPEAT_LIMITS.error);
    assert.equal(REPEAT_LIMITS.error, 5, 'порог отказа выше: модели нужно время применить подсказку');
    assert.equal(REPEAT_LIMITS.applied, 3);
    assert.equal(REPEAT_LIMITS.unchanged, 3);
  });
});

describe('VL-357 — единая сигнатура вызова', () => {
  it('служебные аргументы вырезаются: смена idempotencyKey не делает вызов новым', () => {
    assert.deepEqual(NON_SEMANTIC_ARGS, ['idempotencyKey']);
    const a = callSignature('backlog_update_task', { id: 'VL-1', idempotencyKey: 'k1' });
    const b = callSignature('backlog_update_task', { id: 'VL-1', idempotencyKey: 'k2' });
    assert.equal(a, b, 'сигнатуры совпадают — это тот же вызов');
  });

  it('порядок ключей не важен', () => {
    assert.equal(
      callSignature('x', { a: 1, b: 2 }),
      callSignature('x', { b: 2, a: 1 }),
    );
  });

  it('semantic-аргументы по-прежнему различают вызовы', () => {
    assert.notEqual(callSignature('x', { a: 1 }), callSignature('x', { a: 2 }));
  });

  it('repeatKey тоже игнорирует idempotencyKey', () => {
    assert.equal(
      repeatKey('read_file', { path: 'src/a.ts', idempotencyKey: 'k1' }),
      repeatKey('read_file', { path: 'src/a.ts', idempotencyKey: 'k2' }),
    );
    assert.equal(repeatKey('grep_search', { pattern: 'foo' }), 'grep_search|foo');
  });
});

describe('VL-357 — директивы повторов: один словарь', () => {
  it('loopDetectionDirective: маркер и следующий шаг на месте', () => {
    const text = loopDetectionDirective('backlog_view_task', 3);
    assert.match(text, /Loop detection/);
    assert.match(text, /Следующий шаг/);
  });

  it('loopDetectionDirective с retryWith выдаёт готовый вызов', () => {
    const text = loopDetectionDirective('git_commit', 3, 'чужой путь', false, { allowForeign: true }, { paths: ['a.ts'] });
    assert.match(text, /Повтори так: git_commit /);
    assert.match(text, /allowForeign/);
    // VL-371: порог берётся из единственной константы, а не копией числа.
    assert.ok(
      Buffer.byteLength(text, 'utf8') <= DIRECTIVE_MAX_BYTES,
      `директива укладывается в DIRECTIVE_MAX_BYTES (${Buffer.byteLength(text, 'utf8')})`,
    );
  });

  // VL-413: единственная директива повтора write-вызова. Исхода `noop` больше
  // нет (неизменяющая запись — успех с `unchanged`), поэтому отдельная
  // noop-директива удалена: серия повторов считается по сигнатуре.
  it('VL-413: appliedRepeatDirective — исход applied и маркер «уже применён»', () => {
    const parsed = JSON.parse(appliedRepeatDirective('lesson_update'));
    assert.match(parsed.message, /уже применён/);
    assert.equal(parsed.outcome, 'applied', 'повтор применённого вызова — не ошибка');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.applied_repeat, true, 'флаг причины');
  });

  // VL-410: директива называет конкретный следующий шаг фазы, а не общую фразу.
  // Текст шага приходит готовым из `phaseNextStep` (workflow + completeness) —
  // имена фаз в директивах больше не сравниваются.
  it('VL-410: appliedRepeatDirective несёт готовый следующий шаг фазы', () => {
    const step = 'Фаза close не завершена — вызови backlog_finish_phase.';
    const parsed = JSON.parse(appliedRepeatDirective('lesson_update', undefined, step, 'close'));
    assert.match(parsed.message, /backlog_finish_phase/, 'имя следующего инструмента');
    assert.equal(parsed.phase, 'close', 'фаза проброшена машиночитаемо');
    // Без шага — прежняя общая формулировка (обратная совместимость)
    const plain = JSON.parse(appliedRepeatDirective('lesson_update'));
    assert.match(plain.message, /Переходи к следующему пункту фазы/);
    assert.equal(plain.phase, undefined);
  });

  it('VL-361: директива несёт missing/hint/retryWith последнего ответа инструмента', () => {
    const lastAck = {
      missing: [{ field: 'content', reason: 'тело урока не заполнено' }],
      hint: 'Добавь в вызов `content` с непустым markdown.',
      retryWith: { content: '## Проблема\n…' },
    };
    const parsed = JSON.parse(appliedRepeatDirective('lesson_update', lastAck));
    assert.deepEqual(parsed.missing, [{ field: 'content', reason: 'тело урока не заполнено' }]);
    // VL-413: hint в next не попадает — канал следующего шага это блок phase.
    assert.equal(parsed.hint, undefined);
    assert.deepEqual(parsed.retryWith, { content: '## Проблема\n…' });
  });

  it('VL-369: parsedAckNext читает ПЛОСКУЮ форму (serializeAck разворачивает next в корень)', () => {
    // Реальная форма ответа инструмента: поля в корне JSON.
    const flat = JSON.stringify({
      ok: false, outcome: 'noop',
      missing: [{ field: 'content', reason: 'r' }], hint: 'h',
      retryWith: { content: 'x' },
    });
    assert.deepEqual(parsedAckNext(flat), {
      missing: [{ field: 'content', reason: 'r' }], hint: 'h', retryWith: { content: 'x' },
    });
    // Ответ без next-полей → null (директива не выдумывает следующий шаг)
    assert.equal(parsedAckNext(JSON.stringify({ ok: true, outcome: 'applied' })), null);
    assert.equal(parsedAckNext('плоский текст'), null);
    assert.equal(parsedAckNext(JSON.stringify({ ok: true })), null);
  });

  it('VL-369: вложенная форма next больше не разбирается (её не производит serializeAck)', () => {
    const nested = JSON.stringify({ outcome: 'noop', next: { missing: [{ field: 'content', reason: 'r' }], hint: 'h' } });
    assert.equal(parsedAckNext(nested), null, 'вложенного next в выводе нет — разбор удалён как мёртвый');
  });

  it('parsedErrorText читает retryWith и hint из плоской формы ответа', () => {
    const flat = JSON.stringify({ outcome: 'rejected', ok: false, error: 'нет content', hint: 'Добавь content', retryWith: { allowForeign: true } });
    const parsed = parsedErrorText(flat);
    assert.equal(parsed.text, 'Добавь content', 'hint идёт первым');
    assert.equal(parsed.fromHint, true);
    assert.deepEqual(parsed.retryWith, { allowForeign: true });
    // Старая форма (VL-353, поля в корне) тоже читается
    const v1 = JSON.stringify({ ok: false, error: 'чужой путь', retryWith: { allowForeign: true } });
    assert.deepEqual(parsedErrorText(v1).retryWith, { allowForeign: true });
  });

  it('clipErrorText сохраняет хвост длинного текста (готовая подсказка в конце)', () => {
    const long = `${'а'.repeat(200)} передай allowForeign: true`;
    const clipped = clipErrorText(long);
    assert.ok(clipped.length <= 100, `длина ${clipped.length}`);
    assert.match(clipped, /allowForeign/);
    assert.equal(clipErrorText('короткий', false), 'короткий');
  });
});
