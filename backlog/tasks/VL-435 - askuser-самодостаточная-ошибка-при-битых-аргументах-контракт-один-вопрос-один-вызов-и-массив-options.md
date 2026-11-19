---
id: VL-435
title: 'ask_user: самодостаточная ошибка при битых аргументах + контракт «один вопрос = один вызов» и массив options'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-19 11:46'
updated_date: '2026-11-19 12:41'
due_date: ''
labels:
  - web-chat
  - agent-tools
  - ux
  - ai
  - audit
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
  - src/web/chat-question.ts
  - src/web/tool-policy.ts
  - src/web/chat-question.test.mjs
  - src/web/chat-ask-user.test.mjs
  - templates/prompts/chat-system.md
lessons:
  - lesson-301
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 80
  duration_ms: 2797042
  by_phase:
    plan:
      input: 0
      output: 0
      cache: 0
      requests: 18
    code:
      input: 0
      output: 0
      cache: 0
      requests: 34
    close:
      input: 0
      output: 0
      cache: 0
      requests: 28
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст: из чатов жалобы агентов — «ask_user работает только с одним вопросом (второй — пустой question → ошибка), пришлось спрашивать текстом» и «на ask_user сначала приходит ошибка, приходится повторять».

Цель: сделать ошибку ask_user самодостаточной для модели (она видит, что реально получено, и что чинить) и закрыть контракт «один вопрос = один вызов» на уровне описания инструмента.

Доказательства (аудит, подтверждено):
1. Тред .vibelog/chat-sessions/chat-mwlriz6x-c6wscopj.jsonl: 3 вызова ask_user подряд → {"error":"ask_user: поле question обязательно и не может быть пустым"}, агент: «спрошу текстом» — отказ от инструмента. В аргументах модель упаковала ДВА вопроса в один вызов (поле question_), сериализация склеилась.
2. Тред .vibelog/chat-sessions/chat-mwkjnzrv-jjge0jkm.jsonl: серии ошибок 2, затем 10–11 подряд (строки 390–442) — слепые ретраи без самокоррекции.
3. Живое воспроизведение 3/3 в текущем сеансе: ask_user с options-массивом падает с той же ошибкой — на сервер приходит options строкой (двойное кодирование), валидатор не сообщает полученный тип.

Механизм (корень):
- src/agent/llm.ts:276 parseToolArguments при битом JSON возвращает {__raw: raw} — сырьё не доходит до модели в ответе ask_user;
- src/web/chat-question.ts parseAskUserArgs: вариант «аргументы не разобраны» и «options — строка» неотличимы от «question пуст» — модель получает утверждение, противоречащее тому, что она послала, и повторяет ту же битую сериализацию;
- src/web/tool-policy.ts makeAskUserTool: «один вопрос = один вызов» сказано только в комментарии кода (chat-question.ts:11), формат options (массив объектов, НЕ JSON-строка) — только в описании свойства схемы, которое модель игнорирует при паковке второго вопроса.

Смежное (не входит в эту задачу, отдельно): ask_user не исключён из consultantTools в src/web/chat-subagent.ts — при allow_tools роли с ask_user консультант получит инструмент без механики паузы во вложенном запросе.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 parseAskUserArgs различает три случая: (а) поле question отсутствует/пусто, (б) аргументы не разобраны (битый JSON / не объект — ключ __raw), (в) options не массив (передана строка) — каждая ошибка называет фактически полученный тип/значение
- [x] #2 Ошибка при битых аргументах включает эхо __raw (первые ~200 символов того, что реально пришло) и ожидаемый формат: question — строка, options — массив 2–8 объектов {id,label}, один вызов = один вопрос
- [x] #3 В описании makeAskUserTool явно указано: один вызов — один вопрос (серию вопросов — очередью вызовов); options — массив объектов, а не JSON-строка
- [x] #4 Тест-регресс на оба воспроизведения из тредов: (1) options пришло строкой с question внутри — понятная ошибка про формат options; (2) склейка двух вопросов в один вызов (битый JSON) — ошибка с эхом __raw и подсказкой «задавайте по одному вопросу»
- [x] #5 Существующие тесты chat-question обновлены под новые тексты ошибок; npm test зелёный
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План (Фаза 2: Plan) — VL-435: самодостаточная ошибка ask_user + контракт «один вопрос = один вызов»

## Файлы для изменения

1. `src/web/chat-question.ts` — три различимых ошибки в `parseAskUserArgs`
2. `src/web/tool-policy.ts` — описание `makeAskUserTool` (контракт для модели)
3. `src/web/chat-question.test.mjs` — обновление текстов + тесты-регрессии на оба воспроизведения
4. `src/web/chat-ask-user.test.mjs` — сквозной тест ошибки с `__raw` (необязательно, укрепляет AC4)
5. `templates/prompts/chat-system.md` — абзац `ask_user` (документация контракта, DoD «Документация обновлена»)

## Конкретные места и что меняем

### 1. `src/web/chat-question.ts` — `parseAskUserArgs` (строки 75–118)

Порядок проверок (новый):

1. **Кейс (б) — аргументы не разобраны:** если `'__raw' in raw` (ключ создаёт `parseToolArguments` при битом JSON / не-объекте) → ошибка с эхом `String(raw.__raw).slice(0, 200)` и ожидаемым форматом: «question — строка, options — массив 2–8 объектов {id,label}; один вызов = один вопрос — задавайте по одному вопросу, серию — очередью вызовов».
2. **Кейс (в′) — options пришло строкой (двойное кодирование):** `typeof raw.options === 'string'` → ошибка про формат options ДО проверки question (воспроизведение №1 из треда: строка содержит question внутри, поле question может отсутствовать — тогда без приоритета этой проверки сработал бы кейс (а) и модель не увидела бы про options). Эхо: первые ~200 символов строки, подсказка «options — массив объектов, а не JSON-строка; распарсите её сами нельзя — перешлите массивом».
3. **Кейс (а) — question отсутствует/пуст:** текущая проверка (строки 77–79), но текст называет фактически полученное: `typeof raw.question` / `JSON.stringify` значения (усечённый) либо «поле отсутствует», плюс тот же блок ожидаемого формата.
4. **Кейс (в) — options не массив (прочие типы):** текущая проверка (строки 81–84) с фактическим типом/значением в тексте (`typeof`, усечённый JSON).

Вспомогательная функция-хелпер в этом же файле (не экспортируемая): `describeReceived(value)` → «отсутствует» / `строка "…"` (усечёнка) / `число 42` / `объект {…}` и т.п. — единый формат во всех ошибках.

Последующие проверки (длина вариантов, дубли id, пустые id/label) — без изменений.

### 2. `src/web/tool-policy.ts` — `makeAskUserTool` (строки 264–298)

В `description` (строки 269–276) добавить явно:
- «Один вызов — ровно один вопрос. Серию вопросов задавай очередью отдельных вызовов, не упаковывай два вопроса в один вызов.»
- «`options` передавай МАССИВОМ объектов `[{id,label}, …]`, а не JSON-строкой: значение-строка — ошибка.»

В `description` свойства `options` (строки 281–283) усилить: «массив объектов {id,label}; JSON-строка недопустима».

### 3. `src/web/chat-question.test.mjs`

- Обновить существующие негативные тесты под новые тексты (строки 86–91 «пустой question», 106–108 «options не массив»): матчить не только `/question/`, `/options/`, но и фактический тип/эхо.
- **Тест-регресс №1 (воспроизведение из треда 1 / живое 3/3):** `parseAskUserArgs({ question: 'Вопрос?', options: '{"question":…}' })` (строка с question внутри) → ошибка про формат options, содержит эхо строки и «не JSON-строка».
- **Тест-регресс №2 (склейка двух вопросов → битый JSON):** `parseAskUserArgs({ __raw: '{"question":"Первый вопрос?"…' })` → ошибка содержит эхо `__raw` (первые символы) и подсказку «по одному вопросу»/«один вызов = один вопрос».
- Тест кейса (а): ошибки с фактическим значением (например `question: 42` → в тексте `42`).

### 4. `src/web/chat-ask-user.test.mjs` (сквозной, укрепление AC4)

- В `describe «VL-330 — отказы валидации»` (строки 164–176): кейс `arguments: { __raw: '…битый JSON…' }` → `tool_end isError:true`, в `result` эхо `__raw`; существующий тест строк 169–176 оставить зелёным (он матчит `/question/` — новый текст кейса (а) сохраняет слово «question»).

### 5. `templates/prompts/chat-system.md` — строка 38 (абзац `ask_user`)

Добавить в абзац: «Один вызов — ровно один вопрос; несколько вопросов — очередью вызовов. `options` — массив объектов `{id,label}`, не JSON-строка.» (DoD «Документация обновлена».)

## Порядок действий

1. Правка `chat-question.ts` (хелпер + 4 кейса в порядке выше).
2. Правка `tool-policy.ts` (description + description свойства options).
3. Правка `chat-system.md` (абзац ask_user).
4. Обновление существующих и добавление регрессионных тестов (`chat-question.test.mjs`, `chat-ask-user.test.mjs`).
5. `pnpm build && pnpm test` — полный прогон.

## Как проверить

- `pnpm build` — сборка strict TS без ошибок.
- `pnpm test` — полный прогон (DoD «Тесты проходят»), особенно `src/web/chat-question.test.mjs`, `src/web/chat-ask-user.test.mjs`, `src/web/tool-policy.test.mjs`, `src/web/chat.test.mjs`.
- Ручная сверка текстов ошибок на самодостаточность: модель в ответе видит, что реально получено, и что конкретно чинить (AC1–AC2).

## Риски

- **Смена текстов ошибок** сломает тесты с точными матчами → охват: grep по тестам на старые тексты выполнен (совпадений полных строк в тестах нет; матчи только `/question/`, `/options/`, `/от 2 до 8/` — сохраняются в новых текстах).
- **Порядок проверок** «options-строка до question»: если в валидном вызове с пустым question и нестроковым options сработает раньше кейс (а) — нет, строковая проверка узкая (`typeof === 'string'`), не перехватывает валидные вызовы.
- **Эхо `__raw` в UI**: resume-ветка (`chat.ts:1800`) покажет «Вопрос повреждён: …» пользователю — усечение 200 символов держит сообщение читаемым.
- Смежное (просрочено, НЕ в этой задаче): `ask_user` не исключён из `consultantTools` в `src/web/chat-subagent.ts` — не трогаем.

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `parseToolArguments` при битом JSON/не-объекте возвращает `{__raw: raw}` | `src/agent/llm.ts:276-287` |
| Текущая ошибка «question обязательно» — без фактического значения | `src/web/chat-question.ts:77-79` |
| Текущая ошибка «options … массивом» — без фактического типа | `src/web/chat-question.ts:81-84` |
| «Один вопрос = один вызов» сказан только в комментарии кода | `src/web/chat-question.ts:11-13` |
| Ошибка модели уходит как tool_result `{error}` с `isError:true` до паузы | `src/web/chat.ts:2052-2060` (аналогично 2714-2721 и 2554-2559) |
| Resume-ветка показывает ту же ошибку как «Вопрос повреждён: …» | `src/web/chat.ts:1800-1803` |
| `makeAskUserTool`: description строками 269-276, схема options 281-293, required 296 | `src/web/tool-policy.ts:264-298` |
| Старых полных текстов ошибок в тестах нет (матчи только `/question/`, `/options/`) | `src/web/chat-question.test.mjs:86-91,106-108` |
| Сквозной тест битых аргументов матчит `/question/` | `src/web/chat-ask-user.test.mjs:164-176` |
| Тесты схемы `makeAskUserTool` не дублируют description дословно | `src/web/chat-ask-user.test.mjs:88-94` |
| Абзац `ask_user` в промпте — строка 38 | `templates/prompts/chat-system.md:38` |
| `ask_user` отсутствует в MCP-реестре (headless) — не меняем | `src/web/chat-ask-user.test.mjs:96-98` |

## Не проверено (предположения)

1. **Форма аргументов в тредах-воспроизведениях** (двойное кодирование: строка-options с question внутри — приходит ли валидно разобранным объектом `{question, options: "…"}` или `{__raw}`). Проверить чтением строк тредов `.vibelog/chat-sessions/chat-mwlriz6x-c6wscopj.jsonl` и `chat-mwkjnzrv-jjge0jkm.jsonl` (поиском по `ask_user`) В ПЕРВЫЙ же шаг Code. Порядок проверок в плане покрывает оба варианта (`__raw` → строка-options → question), при расхождении — скорректировать только тест-фикстуру, не логику.
2. **Что других тестов с дословными текстами ошибок нет** — подтвердить прогоном `pnpm test` после правки (grep по `*.test.mjs` на старые строки уже выполнен: совпадений нет).
3. **Что prompt-тесты (`tool-policy.test.mjs`, `persona-memory.test.mjs`) не матчат абзац `ask_user` дословно** — подтвердить полным прогоном; при расхождении — поправить ожидание теста, а не отказаться от правки промпта.
4. **Сквозной кейс `__raw` в `chat-ask-user.test.mjs`**: `fakeLlm` прокидывает `arguments` как есть (без `parseToolArguments`) — поведение проверяется чтением `fakeLlm`/`runChat` при добавлении теста; расхождение → оставить регресс на уровне юнит-теста `chat-question.test.mjs` (AC4 выполняется им).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-19 11:55
---
Фаза 2 (Plan) выполнена. Тип: bug. План записан в Implementation Plan: 5 файлов (src/web/chat-question.ts — три различимых ошибки parseAskUserArgs с эхом __raw/фактическим типом; src/web/tool-policy.ts — контракт «один вызов = один вопрос» и «options — массив, не JSON-строка» в описании makeAskUserTool; templates/prompts/chat-system.md — абзац ask_user; src/web/chat-question.test.mjs — обновление текстов + 2 теста-регрессии на воспроизведения из тредов; src/web/chat-ask-user.test.mjs — сквозной кейс __raw). Проверено по коду: таблица 12 утверждений с файл:строка (llm.ts:276-287, chat-question.ts:77-84, chat.ts:2052-2060/1800-1803, tool-policy.ts:264-298 и др.); предположения — 4 (форма аргументов в тредах, отсутствие дословных матчей текстов в тестах, prompt-тесты, поведение fakeLlm). Риски: смена текстов ошибок (grep-овередж выполнен), порядок проверок «options-строка до question», эхо __raw в UI (усечение 200 символов). Смежное вне scope: ask_user в consultantTools (chat-subagent.ts).
---
author: @agent
created: 2026-11-19 12:13
---
Фаза 3 (Code) выполнена. Изменено: src/web/chat-question.ts, src/web/tool-policy.ts, src/web/chat-question.test.mjs, src/web/chat-ask-user.test.mjs, templates/prompts/chat-system.md; коммит 1654542.
Реализация по плану:
- parseAskUserArgs (chat-question.ts): порядок проверок (б) __raw → (в′) options-строка → (а) question → (в) options не массив; хелперы describeReceived/truncateEcho; каждая ошибка называет фактическое значение («поле отсутствует»/«пустая строка»/«число 42»/эхо строки до 200 символов) и несёт блок EXPECTED_FORMAT (question — строка, options — массив 2–8 {id,label}, один вызов = один вопрос, серия — очередью).
- makeAskUserTool (tool-policy.ts): в description закреплено «Один вызов — ровно один вопрос: серию задавай очередью отдельных вызовов» и «options МАССИВОМ объектов, а не JSON-строкой»; description свойства options уточнён (НЕ JSON-строка).
- templates/prompts/chat-system.md: в абзац ask_user добавлены тот же контракт (один вызов = один вопрос; options — массив, не JSON-строка).
- Тесты: chat-question.test.mjs — обновлены негативные кейсы под новые тексты + регрессии №1 (options строкой с question внутри) и №2 (__raw-склейка: эхо + «по одному вопросу» + ожидаемый формат); chat-ask-user.test.mjs — сквозной кейс __raw → tool_end isError с эхом, паузы нет.
Проверки: pnpm build — ок; полный pnpm test — ЗЕЛЁНЫЙ (238 + 1 файл, 4585 + 8 тестов, 4 skipped; пропусков/исключений тест-файлов нет). Промежуточный прогон ловил 2 флаки orchestrator.test.mjs (finish()/meta.json) — вне затронутого diff, в изоляции и в полном прогоне проходят.
Предположения плана проверены: форма аргументов в треде подтверждена чтением (chat-mwlriz6x: options строкой, question отсутствует — кейс в′ с приоритетом над (а) корректен); дословных матчей старых текстов в тестах не было; prompt-тесты не упали.
Смежное вне scope (не тронуто): ask_user не исключён из consultantTools в src/web/chat-subagent.ts.
---
author: @agent
created: 2026-11-19 12:28
---
Фаза Close прервана: полный pnpm test красный после классификации — недетерминированные флаки ВНЕ diff VL-435. Прогон 1: 2 failed в src/web/orchestrator.test.mjs (VL-352: в коммите billing+файл задачи — timing fire-and-forget). Единственный разрешённый повтор после классификации: 1 failed в ДРУГОМ файле src/web/chat-usage-sse.test.mjs (VL-313: кумулятивная сумма input 120k≠180k). Классификация: коммит 1654542 затрагивает только src/web/chat-question.ts, src/web/tool-policy.ts, src/web/chat-question.test.mjs, src/web/chat-ask-user.test.mjs, templates/prompts/chat-system.md — оба упавших модуля кодово равны HEAD^1; в изоляции всё зелёное (orchestrator 89/89, chat-usage-sse 5/5, тесты задачи chat-question/ask-user/tool-policy/chat 123/123); параллельного vitest в другом worktree нет; сборка прошла. Что сделать, чтобы фазу повторить: НОВЫМ раном фазы Close выполнить полный pnpm test — при зелёном прогоне продолжить стандартные шаги Close (код уже закоммичен feat 1654542, правок не требуется); если флаки повторятся — устранить нестабильность src/web/orchestrator.test.mjs и src/web/chat-usage-sse.test.mjs при fileParallelism/isolate:false (VL-139/140) отдельной задачей и повторить Close.
---
author: @agent
created: 2026-11-19 12:29
---
Фаза close прервана агентом (aborted): Фаза Close прервана: полный pnpm test красный после классификации — недетерминированные флаки ВНЕ diff VL-435. Прогон 1: 2 failed в src/web/orchestrator.test.mjs (VL-352: в коммите billing+файл задачи — timing fire-and-forget). Единственный разрешённый повтор после классификации: 1 failed в ДРУГОМ файле src/web/chat-usage-sse.test.mjs (VL-313: кумулятивная сумма input 120k≠180k). Классификация: коммит 1654542 затрагивает только src/web/chat-question.ts, src/web/tool-policy.ts, src/web/chat-quest — статус возвращён к Review.
---
author: @agent
created: 2026-11-19 12:40
---
Фаза Close выполнена. Статус: Done. Коммиты: fix 1654542 (код + тесты + промпт, из Фазы Code), docs 6c80bed (CHANGELOG: запись Unreleased/Исправлено про самодостаточные ошибки ask_user и контракт паковки), docs a94f5b1 (урок lesson-301). Остатков кода не было: все modified_files (chat-question.ts, tool-policy.ts, 2 тест-файла, chat-system.md) уже закоммичены в 1654542. Проверка после коммита: pnpm build + полный pnpm test — 238 файлов / 4585 тестов зелёные (4 skipped), флаки предыдущего рана (orchestrator VL-352, chat-usage-sse VL-313) не повторились; ранний точечный фильтр покрыт зелёным полным прогоном. Документация: CHANGELOG запись добавлена; backlog/docs не менялось (ask_user нигде не описан, prompt-правки — в templates/prompts/chat-system.md, коммитились в Code); README не тронут. Урок: lesson-301 (создан, связан, закоммичен). Подзадач и refs нет. Не закоммичено: нет (файл задачи VL-435 коммитит framework после token_usage).
---
<!-- COMMENTS:END -->