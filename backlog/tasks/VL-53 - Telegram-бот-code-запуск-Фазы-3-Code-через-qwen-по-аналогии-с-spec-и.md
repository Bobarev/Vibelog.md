---
id: VL-53
title: 'Telegram-бот: /code — запуск Фазы 3 (Code) через qwen (по аналогии с /spec и…'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-03 00:00'
updated_date: '2026-10-04 18:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.6
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Telegram-бот: /code — запуск Фазы 3 (Code) через qwen (по аналогии с /spec и /plan)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /code VL-N в привязанном чате: задача существует → startPhase(cwd, id, 'code', onExit), ответ «🚀 Фаза Code запущена для VL-N, PID N»
- [x] #2 Задача не найдена → сообщение, qwen не стартует; guard «уже выполняется» → в чат
- [x] #3 По завершении фазы (onExit, VL-48-паттерн): статус + лог qwen (pre ≤3000) + карточка sendTaskView; юнит-тесты parseCodeCommand, pnpm test без регрессий
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы для изменения
- src/bot/commands.ts (167 строк) — интерфейс CodeCommand + parseCodeCommand
- src/bot/commands.test.mjs — describe('parseCodeCommand (VL-53)')
- src/bot/handlers.ts (360 строк) — импорт + bot.command('code') + справка
- CHANGELOG.md — запись в [Unreleased]→«Добавлено»

## 1. commands.ts
**Интерфейс** — вставить после PlanCommand (строки 35–38), перед `/** Снятие окружающих кавычек. */`:
```
/** Результат разбора /code. */
export interface CodeCommand {
  id: string;
}
```

**Функция** — в КОНЕЦ файла (после parsePlanCommand, строка 167):
```
/**
 * Разбирает /code: «VL-1» — только ID задачи (первое слово).
 *
 * @param text — аргументы команды (без слова /code)
 * @returns {id} или {error} с подсказкой
 */
export function parseCodeCommand(text: string): CodeCommand | { error: string } {
  const hint = 'Синтаксис: /code VL-<id>';
  const trimmed = text.trim();
  if (!trimmed) return { error: hint };
  const id = trimmed.split(/\s+/)[0];
  if (!id) return { error: hint };
  return { id };
}
```
Идентично parsePlanCommand (строки 159–167) — lenient-парсинг, первое слово.

## 2. commands.test.mjs
- Импорт (строки 8–14): добавить `parseCodeCommand,` (по алфавиту после parseCommentCommand, строка 10).
- describe — в КОНЕЦ файла (после describe parsePlanCommand, ~строка 112): 4 кейса как у VL-50 — обычный ID, окружающие пробелы, хвост игнорируется, пусто → error с /\/code/.

## 3. handlers.ts
- **Импорт** (строки 24–30): добавить `parseCodeCommand,` (после parseCommentCommand, строка 25).
- **Обработчик** — вставить ПЕРЕД комментарием «Ввод пина» (строка 340), ПОСЛЕ /plan (строки 298–338). Копия /plan с заменами: `bot.command('code'`, `parseCodeCommand`, `startPhase(deps.cwd, task.id, 'code', onExit)`, тексты «Фаза Code завершена/запущена». Логика: requireBind → parse → getTask (не найдена → сообщение, escapeMarkdownV2) → onExit (VL-48-паттерн: head ✅/⚠️ + лог qwen pre ≤3000 + sendTaskView) → startPhase → error → `⚠️ ${escapeMarkdownV2(result.error)}` → успех → `🚀 Фаза Code запущена для *${task.id}*, PID ${result.pid}`.
- **Справка** (строки 123, 353): заменить `/spec, /plan` → `/spec, /plan, /code` (split/join по уникальному хвосту `команд, /spec, /plan'`).

## 4. CHANGELOG.md
В [Unreleased]→«Добавлено»: после записи VL-51 (строка 12):
`- **VL-53: /code — запуск Фазы 3 (Code) через headless qwen** — команда /code <id> для существующей задачи; по завершении фазы бот шлёт статус, лог qwen и карточку задачи. По аналогии с /spec (VL-42/48) и /plan (VL-51).`

## Порядок действий
1. commands.ts (интерфейс + функция) → commands.test.mjs (импорт + describe) → node --test src/bot/commands.test.mjs
2. handlers.ts (импорт + обработчик + справка ×2) → pnpm build
3. Smoke VL-53 (по образцу VL-51: create → /code → уведомление; VL-999; guard; exit-3) с VIBELOG_QWEN_BIN заглушками
4. CHANGELOG → pnpm test
5. Отметить AC, комментарий, Done → diff → ждать «да» на коммит

## Как проверить
```bash
pnpm build && node --test src/bot/commands.test.mjs
VIBELOG_QWEN_BIN=/bin/echo node /tmp/vl53-smoke.mjs   # 11 проверок
pnpm test   # ожидаем 374/374
```

## Риски
- Низкий: полная копия проверенного /plan-паттерна; различия — только phase и тексты.
- Вставка обработчика перед строкой 340: якорь — полный комментарий «Ввод пина…» (уникален).
- Guard «уже выполняется» триггерится только при живом запуске — в smoke использовать long-running заглушку (урок VL-51).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-03 00:23
---
Фаза 3 (Code) выполнена. parseCodeCommand + CodeCommand в src/bot/commands.ts (как parsePlanCommand, hint «Синтаксис: /code VL-<id>»); bot.command('code') в handlers.ts — генерация из текста /plan заменами (phase 'code', «Фаза Code»), до catch-all message:text; справка /start ×2 += /code; CHANGELOG-запись VL-53. Юнит-тесты: +4 кейса (парсеры 21/21). Smoke 11/11 (старт+PID, уведомление, лог pre, rich-карточка, строка фазы code, VL-999, guard, exit-3). pnpm test 374/374. Приоритет выставлен High (поле было пустым).
---
author: @agent
created: 2026-10-03 00:27
---
Важно (регрессия поймана и исправлена): при генерации /code скрипт slice-ом заменил блок /plan на /code вместо вставки после него — обработчик /plan пропал (pnpm test и smoke этого не ловят: хендлеры без юнит-тестов). Восстановлен обратными заменами из /code-блока. Верификация после фикса: 10 bot.command на месте (grep), smoke /plan VL-51 11/11, smoke /code VL-53 11/11, pnpm test 374/374 (отдельный чистый прогон; первый «fail 1» оказался флаки временнóй гонки smoke+тестов). Вывод для будущих патчей: при генерации обработчика из соседнего — вставлять ДО целевого якоря, не заменять диапазон; после правок хендлеров гонять smoke обеих смежных команд.
---
<!-- COMMENTS:END -->