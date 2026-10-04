---
id: VL-71
title: Изменить формат созданного отчёта в задаче VL-63 на RichMessage…
status: Done
assignee: []
reporter: ''
created_date: '2026-10-03 23:40'
updated_date: '2026-10-04 18:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.6
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
Изменить формат созданного отчёта в задаче VL-63 на RichMessage (sendRichMessage как у команды task).

Контекст (Фаза 1 Spec, 2026-10-03):

Отчёт о завершении фазы (шаблон VL-63: статус + результат qwen + токены + время + session_id) собирает formatPhaseResult в src/bot/formatting.ts и шлёт через sendText (MarkdownV2 + plain-фолбэк) в двух местах src/bot/handlers.ts:
- notifyPhaseDone — уведомления завершения фаз comment/spec/plan/code/close;
- onExit у /prompt.

Проблема: MarkdownV2 требует экранирования спецсимволов (escapeMarkdownV2), из-за чего жирное начертание и код в отчёте ломаются или сообщение уходит plain. В rich-сообщениях /task (VL-39: sendRichMessage + GFM, лимит 32768) этой боли нет.

Изменение (по образцу /task):
1. Новый рендер renderPhaseResultRich(run) в src/bot/rich.ts — GFM без MarkdownV2-экранирования: заголовок, **жирный**, моноширинный session_id; фолбэк-данные (logTail при отсутствии result) — в ```-блоке.
2. Хелпер отправки в handlers.ts: sendRichMessage + chunkRich, фолбэк на MarkdownV2 (formatPhaseResult + sendText) — тот же паттерн, что sendTaskView → formatTaskDetail.
3. notifyPhaseDone и onExit /prompt используют новый хелпер. Карточка задачи и команда /task не меняются.
4. Тесты: rich.test.mjs — renderPhaseResultRich (успех, фолбэк без result, ошибка/ненулевой код, session_id); существующие тесты formatPhaseResult остаются (MarkdownV2-фолбэк сохраняется).
5. CHANGELOG.md + docs/user-guide.md (раздел «Telegram-бот»).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Информационное сообщение-отчёт фазы отправляется через sendRichMessage (GFM) вместо sendText (MarkdownV2); фолбэк на sendText сохраняется
- [x] #2 Шаблон содержимого отчёта сохранён по VL-65 (статус, результат, токены, время, session_id); MarkdownV2-экранирование из текста отчёта убрано
- [x] #3 pnpm build и pnpm test проходят; есть тест на rich-рендер отчёта фазы
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации (VL-71 — отчёт фазы → RichMessage)

### Файлы для изменения

1. **src/bot/rich.ts** (130 строк)
   - Строка 16: в импорт из `'../core/task.js'` добавить `PhaseRun` из `'../web/orchestrator.js'` (поля: phase, exitCode, result: QwenResult, logTail; QwenResult — result/is_error/num_turns/duration_ms/duration_api_ms/session_id/usage.{input,output,cache_read,total}_tokens, src/web/qwen-result.ts:22-34).
   - Новый экспорт `renderPhaseResultRich(run: PhaseRun): string` — вставить после `renderTaskRich` (перед `chunkRich`, строка 115). Шаблон VL-63/VL-65 сохраняется, но в GFM без `escapeMarkdownV2`:
     - Заголовок: `# Фаза <phase>: завершена (код 0)` либо `# Фаза <phase>: ошибка (код N)` + ` (ошибка qwen)` при `res.is_error === true` (логика строк 76-82 src/bot/formatting.ts).
     - Успех: тело `res.result` (обрезка до 1500 символов + `…`, как formatting.ts:100-101), меты `**Входные токены:**` / `**Сгенерированные токены:**` / `**Кэш-токены:**` / `**Всего токенов:**`, `**Общее время:** N мс (api: N мс)`, `**Количество запросов:** N`; `session_id` в одинарных backticks (пустой — строку не шлём).
     - Фолбэк без `res`: строка `**Данные результата недоступны**` + `logTail` обрезан до 800 символов в ```-блоке (использовать существующий helper `fenceSafe`, строки 28-30).
2. **src/bot/handlers.ts** (499 строк)
   - Строка 21: `import { chunkRich, renderTaskRich } from './rich.js';` → добавить `renderPhaseResultRich`.
   - Новый async-хелпер `sendPhaseResult(bot: Bot, chatId: number, run: PhaseRun): Promise<void>` — сразу после `sendTaskView` (строка 107), паттерн идентичен sendTaskView: try `chunkRich(renderPhaseResultRich(run))` → `bot.api.sendRichMessage(chatId, { markdown: part })`; catch → `console.error('sendRichMessage не прошёл, фолбэк на MarkdownV2:', err)` + `sendText(bot, chatId, formatPhaseResult(run))` (MarkdownV2-рендер сохраняется как фолбэк).
   - Строка 139 (в `notifyPhaseDone`): `await sendText(bot, chatId, formatPhaseResult(run));` → `await sendPhaseResult(bot, chatId, run);`.
   - Строка 434 (`onExit` у `/prompt`): `void sendText(bot, notifyChat, formatPhaseResult(run));` → `void sendPhaseResult(bot, notifyChat, run);`.
   - JSDoc `notifyPhaseDone` (строки 130-133): уточнить — информационное сообщение шлётся rich-путём (VL-71).
3. **src/bot/rich.test.mjs** (115 строк)
   - Импорт (строка 9): добавить `renderPhaseResultRich`.
   - Новый `describe('renderPhaseResultRich (VL-71)')` после describe renderTaskRich (перед `describe('chunkRich')`, строка ~91) с фикстурой `okRun` (phase='comment', exitCode=0, result с `result: 'понг (тест) [скобки]'`, usage по 4 полям, session_id='a470c7dd-2ca8-4510-9d81-b184f932af76') и кейсами:
     1. Успех: `# Фаза comment: завершена (код 0)`, литеральные скобки без `\(`-экранирования, `**Входные токены:** 10956`, session_id в backticks.
     2. Фолбэк без result: `logTail` в ```-блоке, строка «Данные результата недоступны».
     3. Ошибка: `exitCode: 1` → «ошибка (код 1)»; отдельно `exitCode: 0` + `is_error: true` → «(ошибка qwen)».
     4. Пустой `session_id` → строки с ним нет.
     5. `result` длиннее 1500 символов → обрезка + `…`.
4. **CHANGELOG.md** — в `## [Unreleased]` перед `### Исправлено` (строка 23) вставить `### Изменено` с буллетом: VL-71 — информационный отчёт о завершении фазы (notifyPhaseDone + onExit /prompt) отправляется через sendRichMessage (GFM, renderPhaseResultRich); фолбэк на sendText/MarkdownV2 (formatPhaseResult) сохраняется.
5. **docs/user-guide.md** — раздел «### Ответ по завершении фазы — 2 сообщения (VL-63)» (строки 306-327): п.2 — информационное сообщение шлётся RichMessage (GFM) через sendRichMessage, MarkdownV2 — фолбэк для старых клиентов; пример обновить на GFM-форму (`**Фаза comment: завершена (код 0)**` и т.д.); фолбэк-хвост лога — в ```-блоке (без экранирования MarkdownV2).

### Порядок действий

1. rich.ts: импорт PhaseRun + `renderPhaseResultRich`.
2. handlers.ts: импорт, хелпер `sendPhaseResult`, замена вызовов на строках 139 и 434, правка JSDoc.
3. rich.test.mjs: фикстура + 5 кейсов.
4. `pnpm build && pnpm test` — сборка strict TS и все тесты.
5. CHANGELOG.md + docs/user-guide.md.
6. Отметить AC/DoD, статус → Review.

### Как проверить

- `pnpm build` — tsc (strict) без ошибок; `renderPhaseResultRich` экспортируется в dist/bot/rich.js.
- `pnpm test` — все тесты зелёные, включая существующие `formatPhaseResult` в formatting.test.mjs:122+ (MarkdownV2-рендер НЕ меняется — он остаётся фолбэком) и новые кейсы rich.test.mjs.
- grep-проверка: `formatPhaseResult` в handlers.ts используется только внутри `sendPhaseResult` (фолбэк); прямых `sendText(...formatPhaseResult...)` больше нет.

### Риски

- `sendRichMessage` уже используется в sendTaskView (строка 93) — метод проверен в проде VL-39; риск низкий.
- Старый Telegram-клиент может не понимать rich — catch-фолбэк на sendText/MarkdownV2 отрабатывает по паттерну sendTaskView (логируется в консоль).
- `fenceSafe` в logTail: лог с ``` станет `` ` ` ` `` — принятый паттерм рендера (rich.ts:28-30), читаемость сохраняется.
- Обрезки сохраняются идентичными MarkdownV2-пути (результат 1500, хвост лога 800) — контент отчёта совпадает на обоих путях, шаблон VL-65 не меняется.
- formatPhaseResult / formatTaskDetail / renderTaskRich не трогаются — регрессий на /task и MarkdownV2-фолбэк не ожидается.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-03 23:41
---
Фаза 1 (Spec) выполнена. Тип: task.
Краткое описание уточнения: фича укладывается в одну задачу — заменить способ отправки информационного отчёта фазы (formatPhaseResult) с sendText (MarkdownV2 + escapeMarkdownV2) на sendRichMessage (GFM), как уже сделано для карточки задачи в sendTaskView. Уточнены детали: новый rich-рендер отчёта (formatting.ts/rich.ts), правка notifyPhaseDone в handlers.ts (chunkRich + фолбэк на sendText), шаблон VL-65 сохраняется. Дополнено описание контекстом и затронутыми файлами, добавлены 3 критерия приёмки.
---
author: @agent
created: 2026-10-03 23:42
---
Фаза 1 (Spec) выполнена. Тип: task.
Краткое описание уточнения:
**Что меняем:** информационный отчёт о завершении фазы (`formatPhaseResult`, шаблон VL-63: статус + результат qwen + токены + время + session_id) переносится с MarkdownV2 (`sendText`) на RichMessage (`sendRichMessage` + GFM) — по образцу команды `/task` (VL-39).
**Где сейчас шлётся отчёт (2 места в handlers.ts):**
- `notifyPhaseDone` — уведомления завершения фаз comment/spec/plan/code/close;
- `onExit` у `/prompt`.
**Зачем:** MarkdownV2 требует `escapeMarkdownV2` — жирное начертание/код в отчёте ломаются или сообщение уходит plain (жалоба на формат в VL-63). GFM в RichMessage (лимит 32768) этих ограничений не имеет.
**План изменений (Фаза 2):**
1. `src/bot/rich.ts` — новый рендер `renderPhaseResultRich(run)`: GFM без экранирования (заголовок, **жирный**, моноширинный session_id; фолбэк-данные logTail — в ```-блоке).
2. `src/bot/handlers.ts` — хелпер отправки: `sendRichMessage` + `chunkRich`, фолбэк на существующий MarkdownV2-путь (`formatPhaseResult` + `sendText`); используют `notifyPhaseDone` и `/prompt`.
3. Карточка задачи и `/task` не меняются.
4. Тесты: `rich.test.mjs` — кейсы `renderPhaseResultRich` (успех, фолбэк без result, ошибка, session_id); существующие тесты `formatPhaseResult` остаются.
5. `CHANGELOG.md` + `docs/user-guide.md` (раздел «Telegram-бот»).
**AC (оставлены существующие, дубликат не создавал):** sendRichMessage вместо sendText с фолбэком; шаблон VL-65 сохранён, экранирование убрано; pnpm build/test + тест rich-рендера.
Масштаб: одна задача (единый слой бота: рендер + путь отправки + тесты + доки).
---
author: @agent
created: 2026-10-03 23:52
---
Фаза 2 (Plan) выполнена. Тип: task (без блокера — фича укладывается в один слой бота).
**План записан в задачу (Implementation Plan).** Краткая сводка:
- **Изменяемые файлы (5):**
  1. `src/bot/rich.ts` — новый экспорт `renderPhaseResultRich(run)`: GFM-рендер отчёта по шаблону VL-63/65 без MarkdownV2-экранирования (заголовок `# Фаза …`, `**жирный**` меты токенов/времени, session_id в backticks, фолбэк-logTail в ```-блоке через fenceSafe); импорт `PhaseRun`.
  2. `src/bot/handlers.ts` — хелпер `sendPhaseResult` (sendRichMessage + chunkRich, фолбэк → formatPhaseResult + sendText, паттерн sendTaskView) сразу после sendTaskView (строка ~107); замена двух вызовов: notifyPhaseDone (строка 139) и onExit у /prompt (строка 434); импорт на строке 21.
  3. `src/bot/rich.test.mjs` — describe `renderPhaseResultRich (VL-71)`: 5 кейсов (успех с литеральными скобками, фолбэк без result, ошибка код≠0 / is_error, пустой session_id, обрезка >1500).
  4. `CHANGELOG.md` — секция `### Изменено` в Unreleased (перед Исправлено, строка 23).
  5. `docs/user-guide.md` — раздел «Ответ по завершении фазы — 2 сообщения (VL-63)» (строки 306-327): rich-отправка + GFM-пример.
- **Проверка:** `pnpm build && pnpm test`; grep — formatPhaseResult в handlers.ts остаётся только фолбэком внутри sendPhaseResult; существующие тесты formatPhaseResult (formatting.test.mjs:122+) сохраняются.
- **Риски:** sendRichMessage проверен в проде VL-39 (строка 93); старые клиенты — catch-фолбэк на MarkdownV2; обрезки (1500/800) идентичны MarkdownV2-пути — контент отчёта не меняется, меняется только способ доставки.
Карточка задачи и /task не затрагиваются. Статус не меняю — ждёт одобрения плана.
---
author: @agent
created: 2026-10-04 00:05
---
Фаза 3 (Code) выполнена. Изменено: src/bot/rich.ts (новый экспорт renderPhaseResultRich — GFM-рендер отчёта фазы по шаблону VL-63/65 без MarkdownV2-экранирования: # заголовок, **жирный**, session_id в backticks, фолбэк-logTail в ```-блоке через fenceSafe; импорт PhaseRun), src/bot/handlers.ts (хелпер sendPhaseResult: sendRichMessage + chunkRich, фолбэк → formatPhaseResult + sendText — паттерн sendTaskView; notifyPhaseDone и onExit /prompt переведены на него; formatPhaseResult остался ТОЛЬКО фолбэком — проверено grep'ом), src/bot/rich.test.mjs (describe renderPhaseResultRich: 5 кейсов — успех без экранирования скобок, фолбэк без result, ошибка код≠0 / is_error при коде 0, пустой session_id, обрезка >1500; после первого прогона исправлен regex-фикс assertions фолбэк-кейса — ``` в logTail на своей строке, между ` ` ` и текстом \n), CHANGELOG.md (секция ### Изменено в Unreleased), docs/user-guide.md (раздел «Ответ по завершении фазы»: rich-отправка + GFM-пример). Проверки: pnpm build OK (tsc strict), pnpm test 446/446. Что осталось: смока в реальном Telegram-чате (отправка rich-отчёта + фолбэк-путь) — юнит-тесты рендера и grep-контроль пройдены, поведение API проверяется только в проде.
---
author: @agent
created: 2026-10-04 00:17
---
Фаза Close выполнена. Статус: Done. Коммит feat: 3b2ae1b «feat: VL-71 — отчёт фазы через sendRichMessage (GFM) вместо MarkdownV2» (5 файлов: rich.ts, handlers.ts, rich.test.mjs, CHANGELOG.md, docs/user-guide.md).
---
<!-- COMMENTS:END -->