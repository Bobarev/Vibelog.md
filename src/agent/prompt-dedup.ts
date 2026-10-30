/**
 * Дедупликация неизменного блока задачи в промпте resume-рана (VL-258).
 *
 * Проблема: `.vibelog/agent-sessions/<id>.jsonl` хранит по строке на
 * сообщение, и при каждом `--resume` в user-сообщение заново вставляется
 * полный промпт фазы — вместе с блоком «Задача (подставлена автоматически):»
 * (описание + план + AC/DoD, в разобранной сессии VL-235 одна строка доходила
 * до 22–23 КБ). Текст блока при этом чаще всего НЕ меняется: он дублируется
 * в транскрипте столько раз, сколько было ранов.
 *
 * Решение: перед записью промпта resume-рана в историю сравниваем блок задачи
 * с блоками из уже сохранённых user-сообщений по хэшу содержимого. Совпал —
 * заменяем тело блока одной строкой-ссылкой («без изменений с рана N»); не
 * совпал (например, план записан в фазе Plan и Code-ран должен его видеть) —
 * оставляем полный текст.
 *
 * Модуль чистый (без fs и без MCP, как repeat-tracker.ts/session-summary.ts):
 * на вход строка промпта и массив предыдущих сообщений, на выход — новый текст.
 * Чтение транскрипта и запись jsonl — в CLI (`src/agent/cli.ts`).
 */

import { createHash } from 'node:crypto';
import type { ChatMessage } from './llm.js';

/**
 * Заголовок блока задачи — общий для всех templates/phases/*.md (VL-137).
 * Меняется синхронно с шаблонами: по нему режется блок при дедупликации.
 */
export const TASK_BLOCK_HEADING = 'Задача (подставлена автоматически):';

/** Заголовок следующей секции шаблона: блок задачи кончается перед ним. */
const NEXT_SECTION_MARKER = '## ';

/** Маркер строки-ссылки, заменяющей неизменный блок (AC5: виден в jsonl). */
export const DEDUP_MARKER = 'без изменений с рана';

/** Найденный в промпте блок задачи: текст + позиции в исходной строке. */
export interface PromptBlock {
  /** Текст блока целиком (от заголовка до последнего непустого перед секцией). */
  block: string;
  /** Индекс первого символа блока в промпте. */
  start: number;
  /** Индекс символа сразу за блоком (начало остатка промпта). */
  end: number;
}

/** Результат дедупликации промпта resume-рана. */
export interface DedupResult {
  /** Текст, который уходит в messages и в jsonl. */
  text: string;
  /** true ⇔ блок задачи заменён ссылкой (дубликат найден). */
  deduped: boolean;
  /** Хэш блока задачи (8 hex) либо null, если блока в промпте нет. */
  hash: string | null;
  /** Номер предыдущего user-сообщения с тем же блоком (1-based) либо null. */
  fromLine: number | null;
}

/**
 * Находит блок «Задача (подставлена автоматически):» в тексте промпта.
 *
 * Границы: от строки-заголовка (первое точное совпадение после trimStart) до
 * первой следующей строки, начинающейся с `## ` — в шаблонах фаз сразу за
 * блоком идёт `## Шаги`. Промпт бота/фазы prompt блока не содержит → null
 * (дедупликация не применяется, промпт уходит как есть).
 *
 * @returns блок с позициями в исходной строке либо null
 */
export function findTaskBlock(prompt: string): PromptBlock | null {
  const start = prompt.indexOf(TASK_BLOCK_HEADING);
  if (start === -1) return null;
  // Заголовок должен быть отдельной строкой, а не серединой фразы.
  const lineStart = prompt.lastIndexOf('\n', start) + 1;
  if (prompt.slice(lineStart, start).trim() !== '') return null;
  // Ищем начало следующей секции шаблона после заголовка.
  let end = prompt.length;
  let cursor = start + TASK_BLOCK_HEADING.length;
  while (cursor < prompt.length) {
    const nl = prompt.indexOf('\n', cursor);
    if (nl === -1) break;
    const lineFrom = nl + 1;
    if (prompt.startsWith(NEXT_SECTION_MARKER, lineFrom)) {
      end = lineFrom;
      break;
    }
    cursor = lineFrom;
  }
  // Хвост блока: от заголовка до найденной границы, обрезанный по последнему
  // непустому символу — хэш не должен зависеть от лишних пустых строк.
  const raw = prompt.slice(start, end);
  const trimmed = raw.replace(/\s+$/, '');
  return { block: trimmed, start, end: start + trimmed.length };
}

/**
 * Короткий детерминированный хэш блока (8 hex): печатается в строке-ссылке
 * и в stderr-диагностике, поэтому должен быть стабильным между ранами.
 */
export function hashBlock(block: string): string {
  return createHash('sha256').update(block, 'utf8').digest('hex').slice(0, 8);
}

/**
 * Заменяет неизменный блок задачи в промпте resume-рана ссылкой.
 *
 * `previous` — уже сохранённая история сессии (при resume: то, что прочитано
 * из jsonl до нового промпта). Перебираем только user-сообщения: блок задачи
 * встречается исключительно в промптах фаз. Первое совпадение по хэшу даёт
 * номер рана/строки — ссылка указывает, где искать полный текст.
 *
 * @param prompt — собранный промпт текущего рана
 * @param previous — история сессии (user-сообщения прошлых ранов)
 */
export function dedupeResumePrompt(prompt: string, previous: ChatMessage[]): DedupResult {
  const found = findTaskBlock(prompt);
  if (found === null) return { text: prompt, deduped: false, hash: null, fromLine: null };
  const hash = hashBlock(found.block);

  let matchLine: number | null = null;
  let matchRun = 0;
  let runIndex = 0;
  for (let i = 0; i < previous.length; i += 1) {
    const m = previous[i];
    if (m.role !== 'user') continue;
    const text = typeof m.content === 'string' ? m.content : '';
    // Номер рана считаем по маркерам промптов: каждое user-сообщение с блоком
    // задачи — это ран (блок подставляется только в стартовый промпт фазы).
    const block = findTaskBlock(text);
    if (block === null) continue;
    runIndex += 1;
    if (hashBlock(block.block) !== hash) continue;
    matchLine ??= i + 1; // 1-based номер строки jsonl
    matchRun = runIndex;
  }

  if (matchLine === null) {
    // Блок изменился (или раньше его не было) — полный текст остаётся.
    return { text: prompt, deduped: false, hash, fromLine: null };
  }

  const replacement =
    `${TASK_BLOCK_HEADING} ${DEDUP_MARKER} ${matchRun} (строка ${matchLine} транскрипта, хэш ${hash}) — ` +
    'полный текст блока уже есть в истории сессии выше.';
  const text = prompt.slice(0, found.start) + replacement + prompt.slice(found.end);
  return { text, deduped: true, hash, fromLine: matchLine };
}
