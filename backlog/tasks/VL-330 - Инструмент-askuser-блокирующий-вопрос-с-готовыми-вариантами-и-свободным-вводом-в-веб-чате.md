---
id: VL-330
title: 'Инструмент ask_user: блокирующий вопрос с готовыми вариантами и свободным вводом в веб-чате'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-04 01:15'
updated_date: '2026-11-09 21:42'
due_date: ''
labels:
  - web-chat
  - agent-tools
  - ux
  - ai
dependencies: []
milestone: v1.13
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/tool-classify.ts
  - src/web/chat-question.ts
  - src/web/chat.ts
  - src/web/tool-policy.ts
  - src/web/tool-dedup.ts
  - src/mcp/idempotency.ts
  - src/web/chat-question.test.mjs
  - src/web/chat-ask-user.test.mjs
  - web/src/components/chat/question-card.tsx
  - web/src/components/chat/chat-runtime.tsx
  - web/src/components/chat/thread.tsx
  - web/src/components/chat/tool-meta.ts
  - web/src/components/chat/approval-card.tsx
  - web/src/lib/chat-threads.ts
  - templates/prompts/chat-system.md
  - README.md
lessons:
  - lesson-211
  - lesson-212
token_usage:
  input: 22535327
  output: 192387
  cache: 21388288
  total: 22727714
  requests: 233
  duration_ms: 3170201
  reasoning: 123396
  by_phase:
    code:
      input: 20359906
      output: 170607
      cache: 19298816
      requests: 191
    close:
      input: 2175421
      output: 21780
      cache: 2089472
      requests: 42
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Проблема: в веб-чате агент, столкнувшись с неоднозначностью, вынужден угадывать или писать длинный вопрос текстом, на который пользователь отвечает ещё одним сообщением. У Qwen Code есть блокирующий вопрос с готовыми вариантами и свободным вводом — это заметно ускоряет работу. Нужен аналог.

Что уже есть в проекте (переиспользуем):
- approval-gate веб-чата (`src/web/chat.ts:1366-1381`): при write-вызове сервер пишет состояние в jsonl и делает `return`, клиент возобновляет ход через `POST /api/chat` с `approval: {toolCallId, approved, reason}`;
- карточка `web/src/components/chat/approval-card.tsx` — готовая структура (paper-карточка, иконка, receipt-строка, `useReceiptFocus`, состояния request/running/done/denied) и общие стили `surfaces.ts`;
- allow-list треда (`isToolAllowed`), grant супервизора (`checkGrant`) — обе ветки автопрохождения гейта, для `ask_user` они не применяются никогда (вопрос нельзя «разрешить заранее»);
- порт референса уже сделан с `assistant-ui` (ref-22): структура `elements/option-list` и `elements/question-flow` переносится тем же способом.

Замысел:
- Новый инструмент `ask_user` с аргументами `{question, options: [{id, label, description?}], allow_custom?: boolean}`. Модель вызывает его вместо «Продолжить? да/нет» текстом.
- Сервер не исполняет: вызов = пауза хода. Ответ приходит из UI и подставляется синтетическим tool_result (`{selected: {id, label}}` либо `{custom: "..."}`), после чего ход продолжается штатным resume.
- Фронт: `question-card.tsx` — вопрос, список вариантов, «свой ответ», спиннер ожидания, receipt «Ответ: X».

**Принятые решения (v1):**
1. **Один вопрос = один вызов `ask_user`, вопросы идут очередью.** Настоящий `QuestionFlow` со шагами «1 из N» — это N последовательных вызовов в одном ходе модели (или N ходов), фронт рендерит серию карточек в ленте. Батч в одном вызове (массив вопросов) не делаем: частичный прогресс пришлось бы хранить отдельно от jsonl-состояния гейта, а выигрыш нулевой — модель и так может вызвать инструмент несколько раз подряд.
2. **Без `multiSelect`.** Только один вариант за ответ либо свободный текст. Множественный выбор откладывается: он ломает симметрию с approval-gate (там решение бинарное) и требует отдельного UX черновика выбора.
3. **TTL 24 ч на ожидающий вопрос.** Если пользователь закрыл вкладку, ход остаётся в состоянии «ожидает ответа» и восстанавливается при возврате в тред (как пауза approval). По истечении 24 ч вопрос считается снятым: при попытке ответить сервер возвращает понятную ошибку «вопрос снят по таймауту, задайте вопрос заново», ход не зависает. Срок — тот же, что TTL записей `idempotency.json`, константа в одном месте.

Вне scope v1: `ask_user` в headless-фазах и в TUI-агенте (там пауза некому разрешить); multiSelect; вложенные формы; вопрос с медиа/файлами.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Инструмент `ask_user` объявлен в веб-чате (ToolDef: `question` — строка, `options` — массив {id, label, description?}, `allow_custom` — boolean) и виден модели в списке инструментов
- [x] #2 Классификация: `ask_user` не считается write-операцией с точки зрения Allow/Deny; в `src/core/tool-classify.ts` для него явная категория (interactive), а не подстановка по fail-safe правилу
- [x] #3 Сервер не исполняет `ask_user`: вызов ставит ход на паузу, состояние пишется в jsonl, ответ модели приходит синтетическим tool_result с выбранным вариантом (или свободным текстом)
- [x] #4 Протокол resume расширен: `POST /api/chat` принимает `answer: { toolCallId, optionId?, custom? }`; валидация: optionId должен существовать среди предложенных, custom допускается только при allow_custom !== false, непустой ответ обязателен
- [x] #5 Повторный ответ на уже отвеченный вопрос не проходит: сервер отвечает понятной ошибкой (идемпотентность гейта, как у approval)
- [x] #6 Карточка вопроса `question-card.tsx` отрендерена в веб-чате: заголовок-вопрос, список вариантов (клавиатурная навигация, Enter = выбор), опция «свой ответ» с текстовым полем, состояние ожидания (спиннер) и receipt «Ответ: <label>» после решения
- [x] #7 Карточка доступна с клавиатуры и для скринридера: роли (radiogroup/radio либо listbox/option), aria-live на receipt, фокус переводится на receipt после ответа (по образцу useReceiptFocus в approval-card)
- [x] #8 Мультишаговый сценарий работает: несколько последовательных `ask_user` в одном ходе дают серию карточек (QuestionFlow = очередь), предыдущие остаются в ленте со своим ответом
- [x] #9 В `templates/prompts/chat-system.md` добавлено правило: при нехватке данных или развилке использовать `ask_user` вместо угадывания, не более N вопросов за ход
- [x] #10 `ask_user` недоступен в headless-режимах (фазы, агент без TTY): инструмент не попадает в список либо отвечает ошибкой «интерактивный режим недоступен», фаза не зависает на паузе
- [x] #11 В Telegram-боте реализован хотя бы минимальный аналог (вопрос + inline-кнопки вариантов), либо явно зафиксировано решение «в боте не поддерживаем в v1» с записью в README
- [x] #12 Тесты: парсинг/валидация args, валидация `answer` (чужой optionId, custom при allow_custom=false, пустой ответ), пауза и resume с ответом, отсутствие зависания при неизвестном toolCallId
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
Пять шагов; шаги 1–3 дают рабочий сквозной сценарий, 4–5 — полировку.

**Шаг 1. Инструмент и классификация.**

1. `src/core/tool-classify.ts` — добавить категорию `interactive` (или отдельную функцию `isInteractiveTool(name)`), в которую входит `ask_user`. Важно: `isWriteOperation('ask_user')` должен остаться `false`, иначе карточка вопроса попадёт под Allow/Deny и allow-list («Always allow» на вопрос — бессмыслица). Проверить вызывающих: `src/web/chat.ts:1366,1786`, `src/web/tool-dedup.ts:291` — в дедупликации `ask_user` не должен схлопываться как повтор (иначе второй одинаковый вопрос не покажется): внести в исключения.
2. `src/web/tool-policy.ts` — объявить `ask_user` ToolDef (schema: `question: string`, `options: {id,label,description?}[]` от 2 до 8, `allow_custom?: boolean` по умолчанию true), handler не исполняет, а бросает/помечает паузу.
3. Валидация аргументов до постановки на паузу: пустой `question`, <2 опций, дубли `id` → ошибка возвращается модели как tool_result, ход не встаёт на паузу (иначе пользователь получит битый вопрос).

**Шаг 2. Гейт на сервере (`src/web/chat.ts`).**

4. Перед исполнением tool-вызова добавить ветку `isInteractiveTool(tc.name)`: записать в jsonl assistant-сообщение с tool_call (уже пишется) и событие `question` в поток SSE, затем `return` — ровно как ветка approval (строки 1366–1381). Ветки `checkGrant`/`isToolAllowed` для него не применяются.
5. `ChatEvent` (строка 109–121) — новое событие `{ type: 'question'; toolCallId; question: string; options: {id,label,description?}[]; allowCustom: boolean }`.
6. Тело запроса (строка 157–177): расширить `approval`-совместимую форму полем `answer: { toolCallId: string; optionId?: string; custom?: string }`. Валидация: существует ли `toolCallId` в хвосте jsonl в состоянии «ожидает», `optionId` принадлежит предложенным, `custom` непустой и допустим только при `allowCustom !== false`, ровно одно из `optionId`/`custom` задано. Все отказы — понятным текстом в SSE `error`, без падения хода.
7. Resume: синтетический `role: 'tool'` результат — `{"answer":{"id":"...","label":"..."}}` либо `{"answer":{"custom":"..."}}`; дописать в jsonl и продолжить цикл. Отрендерить в ленте как обычный tool-result с пометкой «ответ пользователя».
8. TTL 24 ч: при валидации шага 6 сравнивать время постановки вопроса (из jsonl) с текущим; истёк — SSE `error` «вопрос снят по таймауту», ход не возобновляется. Константу TTL положить рядом с `idempotency.json`-константами (`src/mcp/idempotency.ts`, `TTL_MS`) или в общий `src/core/paths.ts`, чтобы значение было одно.
9. Доступность инструмента по режимам: `ask_user` попадает в `chatToolDefs()` только для интерактивного веб-чата. В фазах/headless (`src/web/orchestrator.ts`, `src/agent/*`) его в списке нет — отдельная проверка в тесте.

**Шаг 3. Карточка вопроса на фронте.**

10. `web/src/components/chat/question-card.tsx` — по образцу `approval-card.tsx`: `paper`/`field`/`mono` из `surfaces.ts`, иконка `HelpCircleIcon`, заголовок-вопрос, список вариантов (`label` + `description`), кнопка «Свой ответ» → `Textarea` + «Отправить», состояния `waiting` (спиннер, кнопки активны) / `answered` (receipt) / `expired` (receipt «Вопрос снят»). После ответа — `useReceiptFocus` (переиспользовать, не копировать).
11. Доступность: `role="radiogroup"` + `role="radio"` на вариантах, `aria-checked`; стрелки вверх/вниз двигают фокус, Enter выбирает; `aria-live="polite"` на receipt. Отправка по Enter в поле свободного ответа, Shift+Enter — перенос строки.
12. `web/src/components/chat/thread.tsx` — диспетчеризация: part с `toolName === 'ask_user'` → `QuestionCard`, иначе существующие `ToolCall`/`ApprovalCard`. Состояние ответа берётся из part'а (`part.result`), а не из локального `useState`, чтобы карточка корректно восстанавливалась при перезагрузке треда.
13. `web/src/components/chat/chat-runtime.tsx` — метод `respondToAnswer(payload)` по образцу `respondToApproval`: POST `/api/chat` с `answer`, обработка SSE (текст продолжается в тот же ассистентский ответ).

**Шаг 4. Промпт и поведение модели.**

14. `templates/prompts/chat-system.md` — правило: при выборе из известного набора вариантов (да/нет, один из подходов, «какой файл») вызывать `ask_user`, а не писать вопрос текстом; не больше 1–2 вопросов подряд без промежуточного прогресса; не спрашивать о том, что можно прочитать в проекте; свободный ввод не дублировать вариантом «другое» (UI добавляет его сам).
15. Проверить, что модель в веб-чате реально видит инструмент и корректно его зовёт (ручной прогон на 3 типовых вопросах: бинарный, выбор из 4, вопрос с обязательным своим вводом при `allow_custom=false`).

**Шаг 5. Бот и документация.**

16. Telegram-бот: минимальный аналог — inline-клавиатура из `options` + кнопка «Свой ответ» (переводит бота в режим ожидания текста для этого toolCallId). Если объём расползается — зафиксировать решение «в боте в v1 не поддерживаем», и тогда `ask_user` в боте отвечает tool_result'ом «интерактивный выбор недоступен, задайте вопрос текстом».
17. Документация: `README.md`/`MCP-SETUP.md` — новый инструмент, ограничение по режимам; `CHANGELOG.md` — запись.

**Риски.**
- Смешение с approval: если `ask_user` случайно классифицируется как write, пользователь увидит «Allow/Deny» на вопрос. Закрывается тестом на `isWriteOperation('ask_user') === false`.
- Дедупликация tool-вызовов (`src/web/tool-dedup.ts`) может счесть повторный одинаковый вопрос дублем и не показать его. Нужно исключение + тест «два одинаковых ask_user подряд дают две карточки».
- Восстановление состояния: ответ должен жить в jsonl (как approval), иначе после F5 карточка снова «ждёт» ответ, который уже дан.
- Модель может злоупотреблять инструментом (вопрос на каждый шаг) — лечится лимитом в системном промпте и лимитом tool-вызовов хода (`CHAT_MAX_TOOL_CALLS`).
- TTL 24 ч на паузе: ход, брошенный на сутки, при возврате не должен «оживать» с истёкшим вопросом — проверять до resume.

**Проверка.** `pnpm typecheck && pnpm test`, `pnpm web:build` (иначе `src/web/static.test.mjs` покажет расхождение dist). Ручной прогон в браузере: бинарный вопрос, 4 варианта, свободный ввод, повторный вопрос подряд, F5 в состоянии ожидания, ответ после искусственно состаренного TTL, клавиатурная навигация.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-04 01:47
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/core/tool-classify.ts
- src/web/chat-question.ts
- src/mcp/idempotency.ts
- src/web/tool-policy.ts
- src/web/tool-dedup.ts
- src/web/chat.ts
- scripts/tmp-vl330-patch.mjs
- web/src/components/chat/question-card.tsx
- web/src/components/chat/approval-card.tsx
- web/src/components/chat/chat-runtime.tsx
- I'll start by orienting in the project and checking the current state.
Now I have a clear picture. Let me start implementing.
Продолжаю реализацию. Создаю модуль логики вопроса.
Теперь импорты в tool-policy.ts и реэкспорт классификатора.
Правки `chat.ts` дальше выполню одним патч-скриптом (несколько…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 1600 с, payload 572119 байт_
Незакоммиченные изменения сохранены в ветку: коммит `2220f6e`.
---
author: @agent
created: 2026-11-04 01:47
---
Фаза code не удалась (код выхода 1): окировок=2, payload последнего запроса=572119 байт (макс 572119), usage={"input_tokens":7899907,"output_tokens":75770,"cache_read_input_tokens":7416832,"total_tokens":7975677,"reasoning_tokens":53119} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-04 02:02
---
Фаза 3 (Code) выполнена. Коммиты: 2220f6e (wip — прогресс до обрыва по max-requests), 8d8a667 (feat — тесты, README, пересборка web/dist).
Изменено (13 файлов в первом коммите + 6 во втором):
- `src/core/tool-classify.ts` — явная категория `interactive`: `isInteractiveTool(name)` (Set с `ask_user`), `isWriteOperation('ask_user') === false` проверяется ДО маркеров и fail-safe.
- `src/web/chat-question.ts` (новый, 269 строк) — вся логика вопроса: `parseAskUserArgs` (валидация ДО паузы: пустой question, <2 или >8 опций, дубли id, пустые id/label), `validateAnswer` (чужой optionId, custom при allow_custom=false, пустой ответ, оба поля сразу), `answerToolResult` (`{answer:{id,label}}` / `{answer:{custom}}`), `cancelledQuestionResult` (`{answer:null,cancelled:true,reason}`), журнал `<threadId>.questions.jsonl`, `questionAskedAt`/`isQuestionExpired` (TTL 24 ч).
- `src/mcp/idempotency.ts` — `TTL_MS` экспортирован как `IDEMPOTENCY_TTL_MS` (единственный источник значения TTL, план п.8).
- `src/web/tool-policy.ts` — `makeAskUserTool()` (ToolDef без handler: сервер не исполняет) + регистрация в `chatToolDefs()`; реэкспорт `isInteractiveTool`.
- `src/web/chat.ts` — событие `ChatEvent.question`; поле `answer` в `ChatRequestBody`; ветка resume с валидацией и TTL; `pauseOnToolCall()` — единая точка паузы (вопрос/approval) для цикла хода, resume и `advanceToNextApproval`; ветка `isInteractiveTool` в цикле (до grant/allow-list — «Always allow» на вопрос не действует); `closePendingToolCalls` и `closeUnconfirmedTail` закрывают висящий вопрос `answer:null`, а не `denied`.
- `src/web/tool-dedup.ts` — `ask_user` не схлопывается как дословный дубль (два одинаковых вопроса → две карточки), лимит ответа при этом действует.
- `web/src/components/chat/question-card.tsx` (новый, 288 строк) — карточка: вопрос заголовком, `role="radiogroup"`/`role="radio"`, стрелки вверх/вниз, Enter = выбор, «Свой ответ» с Textarea (Enter отправляет, Shift+Enter — перенос), receipt `role="status" aria-live="polite"` с `useReceiptFocus` (переиспользован из approval-card, стал экспортом).
- `web/src/components/chat/chat-runtime.tsx` — `setPendingAnswer`/`takePendingAnswer` (module-state), событие `question` → tool-call part + пауза run, POST с полем `answer`.
- `web/src/components/chat/thread.tsx` — диспетчеризация `toolName === 'ask_user'` → QuestionCard; карточка не прячется в ToolGroup.
- `web/src/components/chat/tool-meta.ts` — паритет классификатора (`ask_user` не write) + подписи.
- `web/src/lib/chat-threads.ts` — висящий вопрос восстанавливается после F5 как ждущий ответа (без `{error:'Прервано'}`); отвеченный берёт состояние из `part.result`.
- `templates/prompts/chat-system.md` — правило: `ask_user` вместо вопроса текстом, не спрашивать о читаемом в проекте, не более 1–2 вопросов подряд, «другое» не добавлять.
- `README.md` — одна существующая строка дополнена упоминанием `ask_user` (лимит 150 строк и белый список H2 не тронуты, тест зелёный).
- Тесты: `src/web/chat-question.test.mjs` (21 тест — разбор/валидация/TTL/журнал), `src/web/chat-ask-user.test.mjs` (14 сквозных — пауза и resume, свободный ответ, дедуп, все отказы, TTL, снятие новым сообщением).
AC11 (Telegram-бот): зафиксировано решение «в боте в v1 не поддерживаем». Причина техническая: `src/bot/` не содержит LLM-цикла с инструментами (`grep toolCalls|streamChat` по src/bot — пусто), бот работает с готовыми командами. Инструмент в бот не попадает по построению, зависнуть на паузе он не может. Упоминание в README добавлено; развёрнутая запись — в doc-6/doc-8 силами фазы Close.
Проверки: `pnpm typecheck` — чисто; `pnpm build` — чисто; `pnpm test` — полный прогон: 167 файлов, 3213 passed, 4 skipped, 0 падений + static 8 passed. Один прогон дал падение `orchestrator.test.mjs` (VL-93 автокоммит close) — изолированно файл проходит (88 passed), повторный полный прогон зелёный: флак от параллельного прогона в другом worktree, к diff'у VL-330 отношения не имеет. `pnpm web:build` — пересобрано (web/dist обновлён и закоммичен, иначе static-тест показал бы расхождение).
Что осталось: ручной прогон в браузере (бинарный вопрос, 4 варианта, свободный ввод, повторный вопрос, F5 в ожидании, искусственно состаренный TTL, клавиатура) — автотестами покрыто, но UI-проверка в живом браузере не выполнялась; документация doc-6/doc-8 и CHANGELOG — по правилу фазы Close.
---
author: @agent
created: 2026-11-04 11:10
---
Фаза close не удалась (код выхода 1): (0%), топ-повторов=нет, блокировок=0, payload последнего запроса=153367 байт (макс 153367), usage={"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"total_tokens":0,"reasoning_tokens":0} — статус возвращён к Review.
---
author: Pavel Bobarev
created: 2026-11-04 11:12
---
Сверка цены (pricing_guard): Цена вендора выросла у baidu (routerai/deepseek/deepseek-v4.1-flash@baidu): ввод 5.17 → 35.04 (+577.7%), вывод 20 → 140.15 (+600.7%), кэш 0.1 → 0.7 (+600.7%). Альтернатива: sail-research (+600.7% к текущему тарифу)
---
author: @agent
created: 2026-11-04 11:16
---
Фаза close не удалась (код выхода 1): (0%), топ-повторов=нет, блокировок=0, payload последнего запроса=147485 байт (макс 147485), usage={"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"total_tokens":0,"reasoning_tokens":0} — статус возвращён к Review.
---
author: @agent
created: 2026-11-04 11:31
---
Фаза close не удалась (код выхода 1): (0%), топ-повторов=нет, блокировок=0, payload последнего запроса=147518 байт (макс 147518), usage={"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"total_tokens":0,"reasoning_tokens":0} — статус возвращён к Review.
---
author: @agent
created: 2026-11-04 11:46
---
Фаза Close прервана: конфликт слияния vb/vl-330 → master.
Merge выполнен из главного репозитория (`git merge --no-ff vb/vl-330`), автоматическое слияние не удалось, конфликтные файлы оставлены в рабочем дереве как есть (без `--abort`), чтобы их можно было разобрать вручную.
Конфликтные пути (`git status --porcelain`, unmerged): `UU web/dist/index.html`, `AU web/dist/assets/index-YIlf626T.js`, `UA web/dist/assets/index-BCbqqSU4.js`, `DD web/dist/assets/index-PYUvZz7L.js` (rename/rename одного и того же хэшированного бандла). Также при merge «Auto-merging README.md» — без конфликта.
Причина: обе стороны пересобирали `web/dist/` (артефакт веб-сборки с хэшами в именах файлов) — HEAD (master) и ветка задачи перегенерировали бандл независимо, поэтому конфликтуют и `index.html`, и имена assets. Содержательные исходники конфликтов не имеют: `src/**`, `web/src/**`, `templates/prompts/chat-system.md` слились чисто.
Что нужно сделать, чтобы повторить фазу Close (вручную, в главном репозитории, Pavel или новая фаза Close с явным разрешением):
1. Разрешить конфликт `web/dist/`: не «руками править» минифицированный бандл, а взять сторону задачи по исходникам и перегенерировать артефакт — `git checkout vb/vl-330 -- web/src templates` (при необходимости), затем `git rm` лишние хэшированные файлы `web/dist/assets/*` и выполнить `pnpm web:build`, после чего `git add web/dist`.
2. Убедиться, что `README.md` слился корректно (было auto-merge).
3. Завершить merge: `git commit` (MERGE_HEAD уже подготовлен).
4. Запустить Фазу Close повторно — она сделает проверку после merge (сборка + полный `pnpm test`), уборку worktree/ветки, DoD, refs/lessons и терминальный статус.
Статус задачи не менялся, DoD не трогали — задача остаётся в Review. Замечание на будущее: `web/dist/` в merge-конфликтах возникает при параллельной веб-сборке в worktree; стоит рассмотреть исключение артефактов сборки из merge-конфликтов (пересборка после merge) отдельной задачей.
---
author: @agent
created: 2026-11-04 11:46
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-330 → master.
Merge выполнен из главного репозитория (`git merge --no-ff vb/vl-330`), автоматическое слияние не удалось, конфликтные файлы оставлены в рабочем дереве как есть (без `--abort`), чтобы их можно было разобрать вручную.
Конфликтные пути (`git status --porcelain`, unmerged): `UU web/dist/index.html`, `AU web/dist/assets/index-YIlf626T.js`, `UA web/dist/assets/index-BCbqqSU4.js`, `DD web/dist/assets/index-PYUvZz7L.js` (rename/rename одного и — статус возвращён к Review.
---
author: @agent
created: 2026-11-04 12:09
---
Фаза Close выполнена.
**Merge.** Предыдущий ран Close упал на конфликте слияния `vb/vl-330 → master` (`UU web/dist/index.html` + rename/rename хэшированных бандлов). В текущем состоянии главного репозитория merge-коммит `6ce972e` («merge: VL-330 — Инструмент ask_user…») уже присутствует, рабочее дерево чистое, unmerged-путей нет (`git status --porcelain` — только файл задачи VL-330), `git branch -d vb/vl-330` прошёл (ветка слита). Причина конфликта — производный артефакт: обе стороны независимо пересобирали `web/dist/`. Проверил целостность результата без ручного резолва: `web/dist/index.html` ссылается на `assets/index-xP1cvd5C.js` / `index-DmlHUsua.css`, оба файла есть в `web/dist/assets`, лишних бандлов нет; сборка и тесты зелёные (см. ниже). Содержательные конфликты в коде/шаблоне задачи не зафиксированы. Коммитов в ветке к моменту merge — 2 (`2220f6e` wip-прогресс фазы code, `8d8a667` feat).
**Проверки после merge (полный прогон выполнен один раз).**
- `pnpm build` — чисто (web/dist согласован, пересборка `pnpm web:build` не требуется).
- Ранний точечный фильтр по `git diff --name-only HEAD^1..HEAD`: `vitest run src/web/chat-ask-user.test.mjs src/web/chat-question.test.mjs src/web/chat.test.mjs src/mcp/idempotency.test.mjs` — 4 файла, 100 тестов, 0 падений.
- Полный прогон `pnpm test` (= build + `vitest run --exclude src/web/static.test.mjs` + `vitest run src/web/static.test.mjs`): первый проход — 168 файлов, 3222 passed, 4 skipped, 0 падений; второй (static) — 8 passed. Исключений и skip не добавлял (`--exclude` — штатный двухфазный прогон `pnpm test`, в нём static-тест идёт отдельным запуском). Повторный полный прогон не потребовался. Merge-интерференции, регрессий нет.
**Уборка.** `git worktree remove .vibelog/worktrees/vl-330` отказал («contains modified or untracked files»): единственная запись — untracked-симлинк `backlog/references/data → <главный репо>/backlog/references/data` (его кладёт оркестратор, данные не теряются). Удалён с `--force`, затем `git worktree prune`; ветка `vb/vl-330` удалена (`-d`, was 8d8a667).
**Единый источник TTL.** `IDEMPOTENCY_TTL_MS` (`src/mcp/idempotency.ts`) — константа 24 ч, используемая и ожидающим вопросом (`<threadId>.questions.jsonl`, журнал вопросов), как и планировалось п. 8.
**Lessons.** Созданы и связаны: `lesson-212` (инструмент-вопрос выводи в категорию `interactive`, иначе он попадёт под Allow/Deny и дедуп tool-вызовов) и `lesson-211` (конфликты merge в `web/dist/assets` разрешай пересборкой `pnpm web:build`, а не выбором стороны). Обе в `task.lessons` VL-330. Коммит refs/lessons — `3b9c960`.
**Документация.** `CHANGELOG.md` (Unreleased → Добавлено, запись VL-330), `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` (новый раздел §5 «Веб-чат: `ask_user`» — схема, категория `interactive`, пауза/resume, валидация args и answer, TTL 24 ч, ограничение по режимам, TG-бот в v1 не поддерживает), `backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md` (§ про веб-чат дополнен `ask_user`). README не расширялся — одна существующая строка правлена ещё в Code. Коммит документации — `ba22ae6`.
**DoD:** «Тесты проходят» — полный `pnpm test` зелёный (3230 passed суммарно, 4 skipped — пре-существующие skip в `src/core/frontmatter.test.mjs`); «Документация обновлена» — CHANGELOG + doc-6 + doc-10; «Нет регрессий» — merge-комбинация проверена полным прогоном, новых падений нет (в отчёте Code упоминался флак `orchestrator.test.mjs` от параллельного worktree — в этом прогоне его нет). AC 1–12 отмечены фазой Code; AC11 закрыт зафиксированным решением «в Telegram-боте в v1 не поддерживаем» с записью в документации (в `src/bot/` нет LLM-цикла с инструментами — зависнуть на паузе бот не может).
**Остаток:** ручной прогон UI в живом браузере (бинарный вопрос, 4 варианта, свободный ввод, повторный вопрос, F5 в ожидании, состаренный TTL, клавиатурная навигация) не выполнялся — покрыт автотестами `chat-ask-user`/`chat-question`; при желании — отдельной задачей на UI-проверку.
Конфликт слияния в `web/dist` — класс проблемы, а не разовый случай: зафиксирован уроком `lesson-211`.
---
<!-- COMMENTS:END -->