/**
 * Точечная правка тела документа + защита от молчаливой потери тела (VL-399).
 *
 * Почему модуль существует: до VL-399 единственным способом поправить абзац
 * документа был `document_update {content}`, где `content` — ПОЛНАЯ замена
 * тела. Модель присылала короткий «исправленный» текст, инструмент молча
 * переписывал файл, а ответ (`applied.content` = длина тела) выглядел
 * успешным: падение с 60 КБ до 1 КБ не отличалось от нормальной записи
 * (инцидент 2026-11-10 на doc-10 — утрачены §3–§12). Это дефект интерфейса,
 * а не ошибка модели: не было ни точечной операции, ни сигнала о потере.
 *
 * Здесь две чистые функции без файлового ввода-вывода (их зовут из
 * `src/mcp/tools.ts`): `applyBodyEdit` — семантика файлового `edit`
 * (`makeEdit` в `src/agent/tools.ts`), `contentShrinkCheck` — эвристика
 * «подозрительного сжатия» для guard'а `document_update`.
 *
 * Логика вынесена из `tools.ts` в отдельный модуль, чтобы её можно было
 * проверить юнит-тестом без mkdtemp-каталога и без MCP-обвязки.
 */

/**
 * Порог «подозрительного сжатия» тела: новый текст короче текущего менее чем
 * на 60% (то есть сжатие больше 40%) считается подозрительным, если в нём не
 * сохранено начало текущего текста.
 *
 * Значение — данные, а не разбросанные по коду магические числа: осознанная
 * правка порога делается одной строкой.
 */
export const DOC_SHRINK_RATIO = 0.6;

/** Сколько символов начала тела проверяем на сохранность (первая непустая строка). */
const HEAD_PROBE_LENGTH = 60;

/** Результат проверки «content выглядит как случайная потеря тела». */
export interface ShrinkCheck {
  /** true — переданный текст похож на случайную потерю: нужен full_replace. */
  suspicious: boolean;
  /** Длина текущего тела. */
  bodyLengthBefore: number;
  /** Длина переданного content. */
  bodyLengthAfter: number;
  /** На сколько процентов короче (0 — не короче). */
  shrinkPercent: number;
}

/**
 * Проверяет, выглядит ли присланный `content` как случайная потеря тела.
 *
 * Правило (AC4): подозрительно, если текст короче текущего более чем на 40%
 * И при этом НЕ содержит начала текущего текста. Второе условие отделяет
 * осознанную правку «переписал вступление и сократил середину» от случайной
 * «прислал только тот абзац, который правил»: во втором случае начало тела
 * (первая непустая строка) в `content` не попадает никогда.
 *
 * Частный, но важный случай: `content: ''` при непустом теле — всегда
 * подозрительно (очистка тела требует явного `full_replace: true`). Молчаливая
 * очистка — ровно тот же класс потери, что и усечение.
 *
 * @param currentBody — текущее тело документа
 * @param newContent — присланный content
 */
export function contentShrinkCheck(currentBody: string, newContent: string): ShrinkCheck {
  const bodyLengthBefore = currentBody.length;
  const bodyLengthAfter = newContent.length;
  const shrinkPercent = bodyLengthBefore === 0
    ? 0
    : Math.max(0, Math.round(((bodyLengthBefore - bodyLengthAfter) / bodyLengthBefore) * 100));
  // Пустое тело переписывать нечем: любой content — рост, а не потеря.
  if (bodyLengthBefore === 0) {
    return { suspicious: false, bodyLengthBefore, bodyLengthAfter, shrinkPercent };
  }
  const shorter = bodyLengthAfter < bodyLengthBefore * DOC_SHRINK_RATIO;
  if (!shorter) {
    return { suspicious: false, bodyLengthBefore, bodyLengthAfter, shrinkPercent };
  }
  const head = currentBody
    .split('\n')
    .map(line => line.trim())
    .find(line => line !== '') ?? '';
  const probe = head.slice(0, HEAD_PROBE_LENGTH);
  const keepsHead = probe !== '' && newContent.includes(probe);
  return { suspicious: !keepsHead, bodyLengthBefore, bodyLengthAfter, shrinkPercent };
}

/**
 * Результат точечной правки тела.
 *
 * Отказы различают два случая, потому что подсказка модели разная: «не найдено»
 * → искать точный текст (document_view, возможно файл восстановлен из git);
 * «неоднозначно» → уточнить old_string или включить replace_all.
 */
export type BodyEditResult =
  | { ok: true; body: string; replaced: number }
  | { ok: false; reason: 'not_found' | 'ambiguous'; count: number };

/**
 * Точечная замена в теле документа — семантика файлового `edit`.
 *
 * Повторяет `makeEdit` (`src/agent/tools.ts`: «без replace_all old_string
 * обязан встречаться ровно один раз») буквально, включая способ замены:
 * `split/join`, а не `String.replace` — `replace` со строкой трактует
 * `$&`, `$1`, `$$` в `new_string` как подстановки, и вставленный текст
 * молча портился бы (в документах проекта такие последовательности реальны:
 * например `$& $1 $$` во фрагменте кода или шаблона).
 *
 * @param body — текущее тело документа
 * @param oldString — точный текст для поиска (пустой отсекается вызывающим)
 * @param newString — текст замены
 * @param replaceAll — заменить все вхождения (иначе требуется ровно одно)
 */
export function applyBodyEdit(
  body: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): BodyEditResult {
  const count = body.split(oldString).length - 1;
  if (count === 0) return { ok: false, reason: 'not_found', count };
  if (!replaceAll && count > 1) return { ok: false, reason: 'ambiguous', count };
  return { ok: true, body: body.split(oldString).join(newString), replaced: replaceAll ? count : 1 };
}