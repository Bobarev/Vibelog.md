---
id: VL-98
title: '#bot При отчёте Фаза X завершена нужно добавить идентификатор задачи VL-N'
status: Planned
assignee: []
reporter: ''
created_date: '2026-10-06 01:02'
updated_date: '2026-10-06 01:19'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#bot При отчёте Фаза X завершена нужно добавить идентификатор задачи VL-N
Так же надо немного поправить форматирование:
1. Ответ модели надо обернуть в цитирование (сейчас он в большинстве случаев просто "Готово")
2. Информация про токены в основном в одну строку, надо перенос строк сделать
3. Добавить отдельный вывод с расчётом Входные токены минус Кэш-токены
4. Время форматировать из мс в более понятный формат минут и секунд
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План реализации VL-98 (Фаза 2 Plan)

## Файлы для изменения
1. `src/web/orchestrator.ts`
2. `src/bot/rich.ts`
3. `src/bot/formatting.ts`
4. `src/bot/rich.test.mjs`
5. `src/bot/formatting.test.mjs`
6. `src/web/orchestrator.test.mjs`
7. `docs/user-guide.md`

## Шаги

### 1. src/web/orchestrator.ts — taskId в PhaseRun
- Строки 34-47 (интерфейс `PhaseRun`): добавить поле
  `/** ID задачи запуска (VL-98); 'prompt'/'resume' — undefined. */ taskId?: string;`
- Строки ~374-383 (`record: PhaseRun` в `finish()`): добавить
  `taskId: runKey === 'prompt' || runKey === 'resume' ? undefined : runKey,`
- Зачем: рендеры отчёта получают taskId из `run` без смены сигнатур
  `sendPhaseResult`/`notifyPhaseDone`; `/prompt` и resume остаются без
  идентификатора (задачи там нет).

### 2. src/bot/rich.ts — renderPhaseResultRich (строки 548-592)
- ~562-565 (status): если задан `run.taskId` — приклеить к заголовку
  ` — ${run.taskId}` → `# Фаза code: завершена (код 0) — VL-98`.
- ~573-574 (body): обернуть ответ модели в blockquote GFM:
  `body.split('\n').map((l) => '> ' + l).join('\n')`; обрезка до 1500 символов сохраняется.
- ~576-587 (lines): между строками токенов вставить пустые строки (в rich-парсере
  Telegram одиночный `\n` схлопывается в пробел — причина жалобы «в одну строку»).
  После «Кэш-токены» добавить новую строку
  `**Входные токены минус Кэш-токены:** ${res.usage.input_tokens - res.usage.cache_read_input_tokens}`.
  Строка времени: `**Общее время:** ${formatDuration(res.duration_ms)} (api: ${formatDuration(res.duration_api_ms)})`
  — импорт `formatDuration` из `../agent/tui-format.js` (чистая функция, уже
  протестирована в src/agent/tui-format.test.mjs: MM:SS / H:MM:SS).
- Строка 591 (session_id) — без изменений, остаётся последней
  (VL-93: extractSessionRef смотрит последние две строки).

### 3. src/bot/formatting.ts — formatPhaseResult (строки 163-207)
- ~168-171 (status): то же ` — ${escapeMarkdownV2(run.taskId)}` — taskId
  экранируется ('-' — спецсимвол MarkdownV2 → `VL\-98`).
- ~188-192 (body): цитата MarkdownV2 — сначала `escapeMarkdownV2(body)`, затем
  каждую строку префиксовать `> ` (непрефиктированная строка → 400 от Telegram).
- ~194-200: добавить строку «Входные токены минус Кэш-токены» (то же вычисление);
  время — через `formatDuration` (`:` вне списка экранируемых символов MDV2).

### 4. Тесты
- `src/bot/rich.test.mjs` (344-430): в `okRun` добавить `taskId: 'VL-98'`;
  обновить assertions: заголовок с `— VL-98`; body в blockquote (`^> понг`);
  строка «Входные токены минус Кэш-токены:** 12» (10956−10944);
  время `00:42 (api: 00:42)`; пустые строки между метриками токенов;
  отдельный тест — run без `taskId`: заголовок без суффикса;
  ошибочные пути (exitCode 1, is_error, fallback без result) — сохранить.
- `src/bot/formatting.test.mjs` (144-245): аналогично для MarkdownV2:
  суффикс с экранированием `VL\-98`, `> понг`, новая строка «минус Кэш»,
  время `00:42`, отсутствие суффикса без taskId.
- `src/web/orchestrator.test.mjs`: новый тест — record фазы содержит
  `taskId` = runKey задачи; `startPrompt`/`startResume` → `taskId: undefined`.
  Переиспользовать существующий паттерн заглушки `VIBELOG_QWEN_BIN` (VL28_STUB_MARKER).

### 5. Документация
- `docs/user-guide.md`, раздел «Ответ по завершении фазы — 2 сообщения (VL-63)»
  (строки 402-424): обновить пример — заголовок с идентификатором задачи,
  ответ модели в цитате, метрики токенов с переносами строк и строкой
  «Входные токены минус Кэш-токены», время в формате MM:SS.

## Порядок действий
1. orchestrator.ts (поле + record).
2. rich.ts (renderPhaseResultRich).
3. formatting.ts (formatPhaseResult — MarkdownV2-фолбэк).
4. Тесты: rich.test.mjs, formatting.test.mjs, orchestrator.test.mjs.
5. `pnpm build && pnpm test`.
6. docs/user-guide.md (пример отчёта).
7. Финальная сборка и полный прогон тестов.

## Как проверить
- `pnpm build` — tsc в strict-режиме, без ошибок.
- `pnpm test` (= build + `node --test src`) — все тесты зелёные.
- Точечно: `node --test src/bot/rich.test.mjs src/bot/formatting.test.mjs src/web/orchestrator.test.mjs` после сборки.
- Ручной smoke: `vibelog bot` → `/plan VL-98` → в чате отчёт с идентификатором
  задачи, цитатой ответа, переносами токенов, строкой «минус Кэш-токены» и
  временем MM:SS (недоступно в этой среде — выполняется в Фазе Code).

## Риски
- Telegram rich-парсер схлопывает одиночный `\n` — исправлено `\n\n`;
  требует ручного smoke в Code-фазе (вживую в этой среде не проверяется).
- MarkdownV2-цитата: каждая строка обязана начинаться с `>` — все строки
  префиксируются ПОСЛЕ экранирования, иначе Telegram отклоняет сообщение.
- `chunkRich` может разрезать цитату по `\n\n` внутри обрезанного body
  (>1500 символов) — косметический edge-case, приемлем.
- Новый межслойный импорт `formatDuration` (bot → agent); альтернатива —
  локальный helper в formatting.ts (решение на усмотрение Фазы Code).
- Теоретически `cache_read_input_tokens > input_tokens` — вычислять через
  `Math.max(0, input - cache)`.
- Старые сообщения в истории чата (без taskId) не затрагиваются — поле
  опциональное.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-06 01:02
---
Фаза 1 (Spec) выполнена. Масштаб: task (все правки касаются одного отчёта «Фаза X завершена»). Уточнено: добавлен идентификатор задачи VL-N в отчёт; критерии приёмки по четырём пунктам форматирования (цитирование ответа модели, переносы строк для токенов, расчёт «Входные токены минус Кэш-токены», время в минуты/секунды). Вопросов нет.
---
author: Pavel Bobarev
created: 2026-10-06 01:19
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу (раздел ## Implementation Plan). Охват: 7 файлов — src/web/orchestrator.ts (поле taskId в PhaseRun + запись в record по runKey), src/bot/rich.ts (renderPhaseResultRich: суффикс — VL-N в заголовке, ответ модели в blockquote GFM, пустые строки между метриками токенов, новая строка «Входные токены минус Кэш-токены», время MM:SS через formatDuration из src/agent/tui-format.ts), src/bot/formatting.ts (то же для MarkdownV2-фолбэка: экранированный суффикс, префикс '> ' после escapeMarkdownV2), тесты rich.test.mjs / formatting.test.mjs / orchestrator.test.mjs, docs/user-guide.md (пример отчёта в разделе VL-63). Риски: одиночный \n схлопывается rich-парсером Telegram (решение \n\n — нужен ручной smoke в Фазе Code); MarkdownV2-цитата требует '> ' на каждой строке после экранирования; cache_read > input — защита Math.max(0, …); новый межслойный импорт bot → agent (альтернатива — локальный helper). Проверка: pnpm build && pnpm test. MCP-инструменты в этой среде недоступны — backlog обновлён через CLI vibelog (тот же бэкенд, файлы backlog/tasks/VL-98…md).
---
<!-- COMMENTS:END -->