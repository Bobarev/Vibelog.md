---
id: VL-256
title: 'Веб-чат: при нескольких write-вызовах в одном ходе подтверждение теряется — «Отменено: не было подтверждения пользователя» без показа Allow/Deny'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 12:11'
updated_date: '2026-10-30 21:29'
due_date: ''
labels:
  - web
  - tools
  - bug
  - permissions
dependencies: []
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/chat.ts
  - src/web/chat.test.mjs
  - web/src/components/chat/chat-runtime.tsx
  - templates/prompts/chat-system.md
  - README.md
lessons:
  - lesson-118
token_usage:
  input: 9183428
  output: 112274
  cache: 8965632
  total: 9295702
  requests: 159
  duration_ms: 3142456
  reasoning: 79434
  by_phase:
    plan:
      input: 7544476
      output: 104965
      cache: 7387136
      requests: 117
    close:
      input: 1638952
      output: 7309
      cache: 1578496
      requests: 42
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В веб-чате при отправке **нескольких write-вызовов в одном ходе** часть из них отменяется без запроса подтверждения. Пользователь получает ошибку `Отменено: не было подтверждения пользователя`, хотя Allow/Deny не показывался.

Воспроизведение (сессия правки VL-254, обсуждаемый чат):
1. Ход с тремя write-вызовами: `backlog_update_task(VL-254, title+type)` → успешно; `backlog_update_task(VL-254, labels+priority)` → `Отменено: не было подтверждения пользователя`; `backlog_create_task(...)` → та же ошибка.
2. Пользователь явно подтвердил, что запроса Allow/Deny он не видел и Deny не нажимал.
3. Повторная отправка того же `backlog_create_task` отдельным ходом прошла нормально (создана VL-255) — то есть проблема не в содержимом вызова, а в группировке подтверждений.

Побочный эффект: задача частично обновлена (title/type сменились, labels/priority — нет), и по ответу инструмента невозможно отличить «пользователь отказал» от «подтверждение потерялось».

## Цель

Сделать подтверждение детерминированным: на каждый write-вызов в ходе пользователь видит отдельный запрос (или один запрос со списком всех вызовов и явным выбором по каждому), а отказ/потеря подтверждения различимы в ответе.

## Предлагаемое решение (уточнить в Plan)

1. Воспроизвести на минимальном кейсе: один ход с двумя-тремя write-вызовами; зафиксировать, сколько Allow/Deny-диалогов реально показывается и как ответ мапится на вызовы (по `call.id` или по индексу).
2. Если подтверждение сейчас ключуется не по вызову — привязать к `tool_call_id` и хранить состояние «ожидает подтверждения» на каждый вызов; после Allow выполнять именно этот вызов.
3. Не отменять «лишние» вызовы молча: если подтверждение для вызова не получено (диалог не показан/потерян), возвращать отдельный, отличимый текст ошибки (например `Подтверждение не получено — повторите вызов`) вместо `Отменено: не было подтверждения пользователя`.
4. Тест: в одном ходе два write-вызова; оба получают подтверждение и выполняются; при отказе на второй — первый выполнен, второй возвращает явный отказ, состояние задачи согласовано.
5. Логировать в метрику/лог: сколько подтверждений запрошено и сколько получено за ход — чтобы такие потери были видны в диагностике.

## Известные риски

- Батч из десятков write-вызовов: показывать N отдельных диалогов может быть неудобно — тогда один диалог со списком и чекбоксами, но с явным результатом по каждому вызову.
- Не должно ломать режим «авто-исполнителя» (агент-петля пишет без подтверждений) — правка только для веб-чата.

## Связанное

VL-255 (дедуп и лимит tool-вызовов в веб-чате — соседняя проблема в том же слое), VL-219 (права/подтверждения веб-чата).
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Диагноз (по коду, не гипотеза)

Подтверждения теряются **на сервере**, а не во фронте. Три точки:

1. `src/web/chat.ts:534-538` — цикл LLM: встретив ПЕРВЫЙ write-вызов, пушит `approval` и делает `return`. Остальные вызовы того же хода остаются без tool-result (это корректно — ход на паузе).
2. `src/web/chat.ts:435-470` (resume) — исполняет ТОЛЬКО `target` и сразу вызывает `closeRemainingPending(..., target.id)`.
3. `src/web/chat.ts:573-608` (`closeRemainingPending`) — остальные write-вызовы закрывает синтетическим `ackDenied('not_confirmed')` **не показав диалог**. Отсюда «Отменено: не было подтверждения пользователя» без Allow/Deny (инцидент VL-254: 1-й update применился, 2-й и create — нет).

Референс semantics: `backlog/references/data/assistant-ui/apps/docs/content/docs/runtimes/custom/local-runtime.mdx:579-604` — гейт живёт на tool-call part; run завершается `requires-action`, adapter вызывается заново на КАЖДОЕ решение; «Once every pending approval on the message is decided … the runtime invokes your adapter again». То есть модель assistant-ui естественно поддерживает последовательные гейты: одно решение → один resume. Это и выбираем (вместо батч-диалога с чекбоксами — см. «Риски»).

## Решение

**Последовательные гейты:** после решения по вызову N сервер НЕ закрывает остальные write-вызовы, а выдаёт `approval` для следующего по порядку вызова N+1 (порядок = порядок `tool_calls` в assistant-сообщении, детерминирован). Read-only вызовы между write исполняются сразу (как сейчас). `not_confirmed` остаётся только для реальной потери (пользователь написал новое сообщение вместо решения — путь `closePendingToolCalls` / предохранитель при лимитах).

## Файлы и точки правок

### 1. `src/web/chat.ts` (основное)

- `pendingToolCalls()` (`:195`) — без изменений (порядок уже детерминирован).
- Новая функция `advanceToNextApproval(history, cwd, threadId, queue, skipId): Promise<string | null>` (заменяет текущий `closeRemainingPending`):
  - идёт по `pendingToolCalls(history)`, пропуская `skipId`;
  - read-only (`!isWriteOperation`) → `tool_start` + execute + `tool_end` (текущая реализация сохраняется дословно, `:590-607`);
  - первый встреченный **write** → вернуть `tc` (НЕ закрывать, НЕ исполнять);
  - если write не встретился — вернуть `null`.
- Resume-ветка `:435-470`:
  - после записи tool-result для `target` (Allow/Deny) вызвать
    `const next = await advanceToNextApproval(history, cwd, threadId, queue, target.id);`
  - если `next !== null` → `queue.push({ type: 'approval', toolCallId: next.id, name: next.name, args: next.arguments }); recordApproval(...,'requested'); return;` — ход снова на паузе, ожидается решение по следующему вызову;
  - иначе — провалиться в LLM-цикл (прежнее поведение).
- Счётчик/лог подтверждений (п.4 цели задачи):
  - `recordApprovalLog(cwd, threadId, entry)` — append JSONL в `<chatSessionsDir(cwd)>/<threadId>.approvals.jsonl`, запись `{ ts, turn, event: 'requested' | 'decided', toolCallId, tool, approved? }`; обёрнуто в try/catch (сбой лога не рвёт чат).
  - `export function loadApprovalLog(cwd, threadId)` — чтение с пропуском битых строк (паттерн `loadChatHistory`), нужен тестам и диагностике.
  - `turn` = число user-сообщений в истории на старте `produce` — группировка «сколько запрошено/получено за ход».
  - Вызовы: `requested` — в цикле перед `queue.push({type:'approval'})` (`:535`) и в новой ветке `advanceToNextApproval`; `decided` — в resume-ветке сразу после определения `approved`.
- Лимиты (`:495-512`, `:516-527`): перед `return` по превышению итераций/времени, если есть висящие write-вызовы, закрыть их `ackDenied('not_confirmed')` (payload остаётся валидным для провайдера) + запись `event: 'not_confirmed'` в лог. Сейчас в этой ветке хвост остаётся без результатов.
- Тексты: `ackDenied` не трогаем — `denied` (пользователь отказал) vs `not_confirmed` (подтверждение не получено) уже различимы машиночитаемо (`src/mcp/tool-result.ts:83-115`, VL-262), менять контракт не нужно.

### 2. `src/web/chat.test.mjs`

- **Обновить** тест `'второй write того же хода без подтверждения → reason=not_confirmed'` (`:400-427`): поведение меняется по замыслу задачи. Новая проверка: после Allow по 1-му вызову приходит событие `approval` по 2-му (а не `not_confirmed`).
- Новые тесты:
  1. `ход с тремя write → три последовательных гейта`: turn 1 даёт `approval` tc1; resume approve tc1 → в потоке `tool_end`/нет ошибки и **событие `approval` tc2**; resume approve tc2 → `approval` tc3; resume deny tc3 → ход завершается `done`, в jsonl у tc3 `{denied:true, reason:'denied'}`, обе задачи 1-2 изменены, 3-я нет.
  2. `read-only между write исполняется сразу`: [write, backlog_search, write] → в первом ходе пауза на write-1; после Allow в потоке `tool_start/tool_end` для search и снова `approval` для write-2.
  3. `лог подтверждений`: после сценария (1) `loadApprovalLog` содержит 3 записи `requested` и 3 `decided` с одинаковым `turn`; при Deny — `decided` с `approved:false`.
  4. `регресс: прежний not_confirmed остаётся для отмены хода` — новое user-сообщение при висящем approval: `closePendingToolCalls` по-прежнему даёт `denied` (существующий тест «guard сирот», `:489-512`, не ломать).
- `mkdtemp`-фикстура уже есть (`:31-42`) — новых каталогов не вводить, лог пишется в `cwd` теста.

### 3. `web/src/components/chat/chat-runtime.tsx`

- `applyEvent`, ветка `approval` (`:181-192`): перед `parts.push` — если part с таким `toolCallId` уже есть (повторное событие того же гейта), заменить его `approval`, а не дублировать (сейчас два part'а с одним id дадут два диалога и `findIndex` в `tool_end` сработает по первому).
- Комментарий шапки файла: уточнить, что гейты последовательные (один write за ход-паузу), а не «первый write хода».

### 4. Документация

- `templates/prompts/chat-system.md` — в правило доступа добавить: «если в одном ходе несколько write-вызовов, подтверждение запрашивается по одному последовательно; отказ по одному вызову не отменяет остальные — каждый получает своё решение».
- `README.md` — секция «Веб-чат»: абзац о последовательных подтверждениях + файл лога `.vibelog/chat-sessions/<threadId>.approvals.jsonl`.
- `CHANGELOG.md` — запись VL-256 (одним пунктом, в стиле соседних).

## Порядок действий

1. `src/web/chat.ts`: лог-хелперы (`recordApprovalLog`/`loadApprovalLog`) + `advanceToNextApproval` + правка resume-ветки и лимитов.
2. `pnpm build && pnpm test:fast -- src/web/chat.test.mjs` (быстрый цикл на одном файле).
3. Обновить/добавить тесты в `src/web/chat.test.mjs` (п.2), добиться зелёного.
4. `chat-runtime.tsx` (защита от дубля part'а) + `pnpm --dir web typecheck` (и `pnpm web:build` для проверки сборки web).
5. Документация (п.4).
6. Полный `pnpm test` перед DoD (обязательно: `src/` затронут; правило AGENTS.md).
7. Ручная проверка в браузере (chrome-devtools, без скриншотов): `vibelog browser`, ход с 2 write-вызовами → два последовательных Allow/Deny, проверить `evaluate_script`-чтением карточек и `list_console_messages` (ошибок нет).

## Как проверить

```bash
pnpm build && pnpm test:fast -- src/web/chat.test.mjs
pnpm web:build
pnpm test            # полный прогон — критерий DoD «Тесты проходят»
```

## Риски

- **Батч из десятков write**: N последовательных диалогов утомительны. Выбран осознанно: альтернатива (один диалог со списком и чекбоксами) требует нового события `approvals[]` в SSE, нового контракта resume (массив решений) и переделки UI-карточки — отдельная задача, если понадобится. Прежняя «молчаливая отмена» недопустима (потеря данных + неотличимость от Deny).
- **Регресс DoD «Нет регрессий»**: тест `:400` меняет ожидаемое поведение — это осознанная правка контракта, требуется обновить его, а не «подогнать» код.
- **Авто-исполнитель (`vibelog-agent`, оркестратор)**: правка только в `src/web/chat.ts` (веб-чат), `src/agent/loop.ts` не трогаем — петля агента пишет без подтверждений, как и раньше.
- **Повторная отправка решения после reload**: `sentApprovals` — module-state, при перезагрузке страницы решения из восстановленной истории могут уйти повторно; сервер ответит «Согласование не найдено» (`:441`). Вне объёма задачи (упомянуть в CHANGELOG/README как известное ограничение; при желании — отдельная задача).
- **Размер jsonl**: tool-result write-вызовов и так пишется; новых записей в историю не добавляем (лог — отдельный файл, gitignored `.vibelog/`).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 14:04
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача, план в этой же задаче).
**Диагноз по коду:** подтверждения теряются на сервере, не во фронте. В `src/web/chat.ts` цикл LLM при ПЕРВОМ write-вызове пушит `approval` и делает `return` (`:534-538`); resume-ветка исполняет только `target` (`:435-470`) и сразу вызывает `closeRemainingPending` (`:573-608`), который остальные write-вызовы закрывает синтетическим `ackDenied('not_confirmed')` **не показав диалог**. Отсюда «Отменено: не было подтверждения пользователя» без Allow/Deny (инцидент правки VL-254: 1-й update применился, 2-й и create — нет).
**Решение:** последовательные гейты по образцу ref-22 (`backlog/references/data/assistant-ui/apps/docs/content/docs/runtimes/custom/local-runtime.mdx:579-604` — гейт на tool-call part, adapter вызывается заново на КАЖДОЕ решение). Вместо `closeRemainingPending` — `advanceToNextApproval`: read-only вызовы исполняет, первый встреченный write возвращает → сервер снова пушит `approval` и ставит ход на паузу. `not_confirmed` остаётся только для реальной потери (новое сообщение вместо решения / предохранитель при лимитах итераций и времени, где хвост сейчас вообще без результатов).
**План записан (5 файлов):**
1. `src/web/chat.ts` — `advanceToNextApproval` вместо `closeRemainingPending`, повторный `approval` в resume-ветке, лог подтверждений `recordApprovalLog`/`loadApprovalLog` → `.vibelog/chat-sessions/<threadId>.approvals.jsonl` (`requested`/`decided`/`not_confirmed` + `turn`), закрытие хвоста `not_confirmed` при срабатывании лимитов.
2. `src/web/chat.test.mjs` — обновить тест `:400` (поведение меняется осознанно) + 4 новых: три write → три последовательных гейта с Allow/Allow/Deny; read-only между write исполняется сразу; лог 3×requested + 3×decided; регресс guard'а сирот.
3. `web/src/components/chat/chat-runtime.tsx` — не дублировать tool-call part при повторном `approval` (сейчас два part'а с одним id дадут два диалога и `findIndex` в `tool_end` попадёт в первый).
4. `templates/prompts/chat-system.md` — правило последовательных подтверждений.
5. `README.md` + `CHANGELOG.md` — описание поведения и файла лога.
**Риски:** N последовательных диалогов при батче write (альтернатива «один диалог со списком» требует нового SSE-события и массива решений в resume — отдельная задача); осознанная смена контракта в тесте `:400`; авто-исполнитель (`vibelog-agent`/`loop.ts`) не затрагивается; `sentApprovals` — module-state, после reload решение может уйти повторно → «Согласование не найдено» (известное ограничение, вне объёма).
Блокеров и дочерних задач не требуется — задача укладывается в один диф. Проверка: `pnpm build && pnpm test:fast -- src/web/chat.test.mjs`, `pnpm web:build`, полный `pnpm test` (DoD «Тесты проходят»), ручная проверка в браузере через evaluate_script/list_console_messages.
---
author: @agent
created: 2026-10-30 14:30
---
Фаза close не удалась (код выхода 1): оп-повторов=нет, payload последнего запроса=171829 байт (макс 171829), usage={"input_tokens":560341,"output_tokens":2057,"cache_read_input_tokens":534528,"total_tokens":562398,"reasoning_tokens":1029} — статус возвращён к Review.
---
author: @agent
created: 2026-10-30 16:03
---
Фаза 3 (Code) — работа завершена, фиксирую отчёт (статус Review уже стоял).
**Суть:** в `src/web/chat.ts` `closeRemainingPending` заменён на `advanceToNextApproval`: после решения по вызову N read-only вызовы хвоста исполняются сразу, а первый встреченный write НЕ отменяется молча — для него приходит отдельное событие `approval` (последовательные гейты, ref-22 local-runtime.mdx §Approval gates). Добавлен диагностический лог `.vibelog/chat-sessions/<threadId>.approvals.jsonl` (`requested`/`decided`/`not_confirmed` + номер хода; `recordApprovalLog`/`loadApprovalLog`): запрос без решения = потерянное подтверждение. Предохранитель лимитов итераций/времени закрывает висящий хвост машиночитаемым `ackDenied('not_confirmed')`. `web/src/components/chat/chat-runtime.tsx` не дублирует tool-call part при повторном approval по тому же id.
**Коммиты:** 3a7cbe8 (feat — chat.ts, chat.test.mjs, chat-runtime.tsx; слит merge-коммитом 26dd8a5), 5319ee0 (docs — README + templates/prompts/chat-system.md).
**Тесты:** обновлён тест VL-262 (второй write получает свой гейт, Deny по нему → `reason: 'denied'`) + 2 новых: три write → Allow/Allow/Deny с проверкой состояния задач и лога (3 requested / 3 decided, один turn); read-only между write исполняется сразу, затем гейт следующего write.
**Проверки:** `pnpm build` — ок; `npx vitest run src/web/chat.test.mjs` — 30 passed; `pnpm --dir web typecheck` — ок; полный `pnpm test` — 97 файлов / 1814 passed, 4 skipped, затем static.test.mjs 7 passed (исключений и частичных прогонов нет).
**Документация:** README (секция «Веб-чат» — последовательные подтверждения и файл лога), templates/prompts/chat-system.md (правило: подтверждение по одному, отказ не отменяет остальные). CHANGELOG — по правилу фазы остаётся Фазе Close.
**Не сделано:** ручная проверка в браузере через chrome-devtools (пункт 7 плана) — поведение покрыто тестами на уровне SSE-событий; известное ограничение `sentApprovals` после reload — вне объёма.
---
author: @agent
created: 2026-10-30 21:28
---
Фаза Close выполнена. Статус: Done.
**Коммиты:** feat — не требовался: код VL-256 уже закоммичен в Фазе Code (3a7cbe8, слит merge-коммитом 26dd8a5) вместе с docs-коммитом 5319ee0; незакоммиченных изменений в src/web/chat.ts, src/web/chat.test.mjs, web/src/components/chat/chat-runtime.tsx, templates/prompts/chat-system.md, README.md нет. docs — 7f539b9 (CHANGELOG: запись VL-256 в разделе «Исправлено»).
**Проверки:** `pnpm build` — ок; точечный фильтр `npx vitest run src/web/chat.test.mjs` — 37 passed; полный `pnpm test` — 1905 passed, 4 skipped, затем `src/web/static.test.mjs` 8 passed (исключений и частичных прогонов нет, повторных полных прогонов не было).
**Не закоммичено:** нет (все файлы задачи зафиксированы в docs(task)-коммитах этой фазы).
**Lessons:** ранее похожих не было — создан lesson-118 (последовательные approval-гейты вместо синтетического not_confirmed, замена part'а по toolCallId), связан с задачей.
**Известное ограничение** (вне объёма, отражено в отчёте Code): `sentApprovals` после reload может отправить решение повторно — сервер ответит «Согласование не найдено».
---
<!-- COMMENTS:END -->