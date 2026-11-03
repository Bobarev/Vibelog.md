/**
 * Компакшн wire-истории: общий модуль (VL-122 → VL-314).
 *
 * Функция родилась в `src/agent/loop.ts` (VL-122) для агента фаз и теперь
 * нужна ещё и веб-чату (`/trim`, `/compact` — VL-314). Держать копию в
 * `src/web/chat-compaction.ts` нельзя: орфан-гард (хвост не может начинаться
 * с `tool` без парного `assistant(tool_calls)`) — единственное место, где
 * payload становится валидным для провайдера; две копии разъедутся и одна
 * из них тихо сломает запрос. Поэтому функция вынесена сюда, а `loop.ts`
 * реэкспортирует её (публичный API модуля не меняется — тесты
 * `loop.test.mjs` импортируют `compactWireMessages` из `dist/agent/loop.js`).
 */

import type { ChatMessage } from './llm.js';

/**
 * Строит wire-копию истории для LLM-запроса (VL-122): system-сообщения +
 * первое user-сообщение (постановка) + сообщения с липкого якоря `from`.
 *
 * `messages` и jsonl-транскрипт НЕ мутируются — возвращается новый массив,
 * усекается только payload, уходящий в провайдер. Первый user в копии
 * получает дописанную служебную заметку об усечении; число опущенных
 * вычисляется детерминированно из якоря и не меняется между запросами
 * (append-only префикс — prefix-caching провайдера стабилен; маркер ломает
 * префикс ровно один раз — в момент сдвига якоря).
 *
 * Орфан-гард: хвост не должен начинаться с `role: 'tool'` без парного
 * assistant(tool_calls) — провайдер отклонит payload; начало хвоста
 * сдвигается вперёд, пока `messages[start].role === 'tool'`.
 *
 * Если отсекать нечего (якорь не за первым user / хвост пуст после
 * орфан-гарда) — возвращается исходный массив без маркера.
 */
export function compactWireMessages(messages: ChatMessage[], from: number): ChatMessage[] {
  // Отсекать нечего: якорь за пределами диапазона
  if (from <= 0 || from >= messages.length) return messages;
  // Первый user — «постановка задачи», сохраняем дословно (с заметкой)
  const firstUserIdx = messages.findIndex((m) => m.role === 'user');
  if (firstUserIdx === -1 || from <= firstUserIdx + 1) return messages;
  // Орфан-гард: хвост не начинается с tool-сообщения без парного assistant
  let start = from;
  while (start < messages.length && messages[start].role === 'tool') start++;
  // Хвост целиком состоит из tool-сообщений — компакшн пропускается
  if (start >= messages.length) return messages;
  const omitted = start - firstUserIdx - 1;
  const note = `[История усечена: опущено ${omitted} сообщений. Полный транскрипт — в сессии.]`;
  const head = messages.slice(0, firstUserIdx + 1);
  head[firstUserIdx] = { role: 'user', content: `${messages[firstUserIdx].content}\n\n${note}` };
  return [...head, ...messages.slice(start)];
}
