---
id: VL-219
title: 'Ассистент: read_file/write_file, обновление задач, полный доступ MCP'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-29 17:48'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - agent
  - mcp
dependencies: []
milestone: v1.11
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/tool-policy.ts
  - src/web/tool-policy.test.mjs
  - templates/prompts/chat-system.md
  - src/web/chat.ts
  - src/web/chat.test.mjs
  - src/agent/tools.ts
  - src/mcp/tools.ts
  - src/mcp/v11.test.mjs
  - web/src/components/chat/thread.tsx
  - scripts/npm-smoke.mjs
  - README.md
  - CHANGELOG.md
lessons:
  - lesson-81
token_usage:
  input: 22616601
  output: 193767
  cache: 21294400
  total: 22810368
  requests: 223
  duration_ms: 2258189
  reasoning: 102349
  by_phase:
    spec:
      input: 0
      output: 0
      cache: 0
      requests: 3
    plan:
      input: 12475976
      output: 58800
      cache: 11847104
      requests: 48
    prompt:
      input: 535637
      output: 8703
      cache: 267712
      requests: 9
    comment:
      input: 9604988
      output: 126264
      cache: 9179584
      requests: 163
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Ассистент Vibelog.md сейчас имеет только инструменты таск-менеджера (backlog_search, backlog_view_task, backlog_create_task) и не может читать/писать файлы проекта. Из-за этого правки вроде добавления модели в .vibelog/settings.json приходится передавать пользователю готовым фрагментом.

Нужно дать ассистенту два новых инструмента:

1. **read_file** — чтение файлов проекта без подтверждения пользователя («по проекту без спроса»). Путь к файлу, опционально диапазон строк. Работает для любых файлов в пределах проекта.

2. **write_file** — запись файла с обязательным подтверждением пользователя при каждом вызове, аналогично механизму backlog_create_task: вызов приостанавливает диалог → пользователь подтверждает или отклоняет (Allow/Deny) → после Allow запись выполняется, после Deny — диалог продолжается без записи. Молчаливая запись без подтверждения запрещена.

Оба инструмента нужно описать в системной инструкции ассистента (имя, параметры, поведение). Доступ — только в пределах директории проекта.

## Дополнение

### 1. Статус Spec при создании задач

Задачи, создаваемые через ассистента, должны сразу помещаться в статус **Spec** — то есть ассистент при `backlog_create_task` фактически выполняет фазу spec:

- при создании задачи статус по умолчанию = Spec (а не статус из конфига);
- description должен содержать результат spec-фазы: контекст, цель, входные данные из диалога с пользователем;
- критерии приёмки (acceptanceCriteria) заполняются на этом же шаге, если данные есть в диалоге;
- если пользователь явно передал другой статус — действует его указание.

### 2. Инструмент редактирования задач: backlog_update_task

Ассистент должен уметь редактировать существующие задачи (сейчас только создание/просмотр/поиск):

- принимает `id` задачи + изменяемые поля (title, description, status, priority, labels, acceptanceCriteria, assignee и т.д.);
- возвращает обновлённое представление задачи;
- запись изменений — с подтверждения пользователя (Allow/Deny), как у `write_file` и `backlog_create_task`;
- попытка изменения несуществующего id — понятная ошибка;
- описать инструмент в системной инструкции ассистента.

### 3. Полный доступ к инструментам и настройкам MCP Vibelog

Ассистент должен иметь доступ не только к задачам, но и ко всем остальным инструментам и настройкам, которые предоставляет MCP Vibelog:

- **Чтение** — все MCP-инструменты (поиск и просмотр lessons, references, documents, конфигов проекта и т.д.) доступны без подтверждения, как read_file;
- **Запись/изменение** — все MCP-инструменты изменения данных (создание/редактирование lessons, references, documents, настроек проекта и прочего) доступны с подтверждения пользователя (Allow/Deny), как write_file и backlog_create_task;
- распознавать «read-инструменты» и «write-инструменты» нужно по природе операции (побочные эффекты есть → подтверждение), а не по жёсткому списку имён;
- новые MCP-инструменты, появляющиеся в будущем, подключаются к этой же схеме без правки инструкции ассистента;
- ограничение доступа пределами проекта сохраняется.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 read_file возвращает содержимое файла и работает без подтверждения пользователя
- [x] #2 read_file принимает путь к файлу, опционально — диапазон строк
- [x] #3 read_file ограничен файлами проекта (выход за пределы — запрещён)
- [x] #4 write_file при вызове приостанавливает диалог и запрашивает подтверждение пользователя (Allow/Deny), аналогично backlog_create_task
- [x] #5 после Allow файл записывается, после Deny — диалог продолжается без записи
- [x] #6 write_file никогда не выполняется молча без явного подтверждения
- [x] #7 write_file ограничен файлами проекта (выход за пределы — запрещён)
- [x] #8 оба инструмента описаны в системной инструкции ассистента (параметры, поведение, ограничения)
- [x] #9 тесты проходят, нет регрессий
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# Фаза 2 (Plan) — Ассистент веб-чата: read_file/write_file, backlog_update_task, полный доступ MCP

## Контекст

«Ассистент» из описания задачи — **веб-чат VL-204** (`src/web/chat.ts`): у него сейчас ровно 3 инструмента (`CHAT_TOOL_NAMES`), approval только для `backlog_create_task`, инструментов чтения/записи файлов нет. Локальные инструменты `read_file`/`write_file` агента (`src/agent/tools.ts`) сюда не подходят напрямую: у них нет approval-гейта (нужен для write) — но их валидация путей (`resolveInProject`) переиспользуется.

Референсов у задачи нет. Уроки учтены: lesson-10 (счётчики tools.length), lesson-13 (VIBELOG_CWD в branch-mode), lesson-30 (единая точка капа вывода), lesson-34 (валидация аргументов на границе), lesson-35 (JSON-строка массива), lesson-37 (общий модуль вместо копий), lesson-63 (не читать большие docs в фазе), lesson-74/75 (валидация tool_call до записи).

## Архитектурные решения

**Р1. Классификация read/write — по природе операции, не по списку имён.** Операция write = имеет побочный эффект (изменяет файловую систему / данные backlog / settings). Классификатор `isWriteOperation(name, args)` в новом модуле `src/web/tool-policy.ts`:
- по умолчанию для известных MCP-инструментов — по префиксам-семантике: write, если имя содержит `create|update|add|remove|rename|archive|manage|finish|supersede|link|sync|cache` (list/view/search/ready/get — read);
- локальные файловые: `write_file`, `edit`, `run_shell_command` — write; `read_file`, `grep_search`, `glob` — read;
- правило-фолбэк (для будущих MCP-инструментов без правки инструкции): неизвестное имя считается write, **кроме** случая, когда в inputSchema нет обязательных полей с побочными эффектами… упрощённо: неизвестное имя → write (fail-safe: подтверждение лучше молчаливой записи). Точнее: неизвестное имя → write всегда. Read-only будущие инструменты придут с пометкой в description? Нет — по ТЗ: «распознавать по природе операции… новые MCP-инструменты подключаются без правки инструкции». Фолбэк «неизвестное = write» соответствует ТЗ (защита от молчаливой записи), а известные read-инструменты покрывают все текущие чтения. Но это сломает «чтение без подтверждения» для будущих read-инструментов. Компромисс: известные write-маркеры в имени (create/update/…) → write; известные read-глаголы (list/view/search/get/read/ready) → read; **неизвестное имя → write** (безопасный дефолт) + в JSDoc/инструкции указано, что новые чисто-чтальные инструменты подключаются автоматически, если их имя начинается с read-глагола. Это соответствует ТЗ буквально («побочные эффекты есть → подтверждение») и не требует правки инструкции.
- Аргумент-зависимость не требуется: побочный эффект у инструмента — свойство операции, а не аргументов.

**Р2. Доступ ко всем MCP-инструментам без дублирования схем.** `chatToolDefs()` вместо `CHAT_TOOL_NAMES` берёт **всё** `listTools()` из `src/mcp/tools.ts` + локальные `read_file`/`write_file`. Конфликт имён отсутствует (в `listTools()` файловых инструментов нет — проверено по списку case в handleToolCall).

**Р3. read_file/write_file — не переиспользовать `src/agent/tools.ts` целиком, а переиспользовать его экспорт `resolveInProject`.** Сейчас `resolveInProject` — приватная функция. План: **экспортировать** её из `src/agent/tools.ts` (rename не требуется, просто `export`), в `src/web/chat.ts` (или tool-policy) описать `read_file`/`write_file` как ToolDef с handler'ом, вызывающим `resolveInProject(cwd, path)` + `readFileSync`/`writeFileSync` + `truncateToolOutput` (единая точка капа, lesson-30 — кап уже стоит в точке выдачи tool_end ниже? см. Р4).

**Р4. Кап вывода.** Все tool-result чата уже проходят через `truncateToolOutput`? Нет — сейчас `handleToolCall` результат уходит как есть. Точки капа: в `runChat` при `tool_start/tool_end` и в resume-ветке — обернуть `result` в `truncateToolOutput(result)` в **одной** функции-хелпере `emitToolResult`, чтобы read_file и MCP-выводы кэпились одинаково (lesson-30: единая точка после handler).

**Р5. Spec-статус при `backlog_create_task` из чата.** Не трогать глобальный `toolCreateTask` (его используют CLI/MCP-агент — там статус из конфига штатен). Вместо этого: `handleToolCall` получает опциональный 4-й параметр `opts?: { defaultStatus?: string }` — чат передаёт `defaultStatus: 'Spec'`, все остальные вызывающие — без opts (поведение не меняется). В `toolCreateTask`: `status: (args.status as string) || opts?.defaultStatus || ''` (пустая строка → фолбэк конфига в createTask, как сейчас). Схема `status` в description уточняется: «по умолчанию Spec в веб-чате, иначе из конфига».
Плюс в системной инструкции чата (см. Р7) — требование к модели: при создании задачи заполнять description результатом spec-фазы (контекст/цель/входные) и AC, если они есть в диалоге.

**Р6. Инструмент редактирования — `backlog_update_task` уже есть в MCP-реестре** (inputSchema с id + полями, включая acceptanceCriteria? — нет: в update_task нет `acceptanceCriteria` напрямую, AC — через `backlog_manage_ac`. В схему `backlog_update_task` **добавить** поле `acceptanceCriteria` (полная замена, массив строк → `{text, checked:false}` — симметрия с create; lesson-35: парсить JSON-строку массива). Ошибка несуществующего id — уже есть в `updateTaskFile` («Задача X не найдена») — понятная ошибка (AC). Ничего не изобретать — чат просто получает этот инструмент через `listTools()` с классификацией write → approval.

**Р7. Системная инструкция ассистента.** Сейчас у чата **нет** отдельной системной инструкции — system-сообщение пересобирается на каждый ход и содержит только `globalSearch`-контекст (внутри produce). Добавить в `src/web/chat.ts` константу `CHAT_SYSTEM_PROMPT` (шаблоном можно не делать — в веб-чате нет механизм переопределения, держим строкой в коде с JSDoc) и склеивать: `CHAT_SYSTEM_PROMPT + "\n\nКонтекст проекта:\n" + JSON.stringify(globalSearch(...))`. В инструкции: read_file (путь, offset/limit, без подтверждения, только в пределах проекта), write_file (только с подтверждением Allow/Deny, в пределах проекта), backlog_create_task (Spec-статус + заполнение description/AC из диалога), backlog_update_task, общее правило read/write по природе операции (все read — сразу, все write — с подтверждением), пределы проекта.

**Р8. Границы проекта для write_file.** `resolveInProject` уже запрещает `../` и абсолютные пути наружу. Дополнительно запретить запись в `.vibelog/chat-sessions/` и `backlog/` через write_file? Нет — backlog как раз может правиться, но task-данные лучше через MCP-инструменты. Не усложняем: write_file работает как в агенте (только resolveInProject), а в инструкции указано: задачи/lessons/references/docs — через MCP-инструменты, не через write_file.

## Файлы для изменения

| # | Файл | Что делаем |
|---|---|---|
| 1 | `src/web/tool-policy.ts` | **Новый модуль.** Экспорты: `isWriteOperation(name: string): boolean` (семантика имен + fail-safe write для неизвестных), `CHAT_LOCAL_TOOLS: ToolDef[]`-билдер или функция `chatToolDefs(): ToolDef[]` (все listTools() + read_file + write_file), `buildChatSystemPrompt(): string`. Классификатор — чистая функция, тестируется отдельно (lesson-37: общий модуль, не копии). |
| 2 | `src/web/chat.ts` | (а) удалить `CHAT_TOOL_NAMES` (строка ~63) → вызывать `chatToolDefs()` из tool-policy (сейчас `chatToolDefs` объявлен внутри chat.ts ~249 — перенести в tool-policy); (б) в цикле исполнения (~519): условие `tc.name === 'backlog_create_task'` заменить на `isWriteOperation(tc.name)` — первый write → событие approval; read → исполнение сразу; (в) в resume-ветке (~436): `approved` → `handleToolCall(...)` (с opts defaultStatus — create уже в этом вызове), deny → ошибка с причиной по умолчанию «Пользователь отклонил изменение» (текст «создание задачи» оставить для create? обобщить: «Пользователь отклонил операцию» — проверить тесты: chat.test.mjs матчит 'Пользователь отклонил создание задачи' — заменить текст в тесте тоже, или различить по имени: если name === 'backlog_create_task' старый текст, иначе новый; проще обобщить и обновить тест); (г) `closeRemainingPending` (~555): `tc.name === 'backlog_create_task'` → `isWriteOperation(tc.name)` (синтетический отказ для всех write без подтверждения); (д) система: `CHAT_SYSTEM_PROMPT + globalSearch` в produce; (е) `truncateToolOutput` — единая обёртка выдачи tool_end/tool-result (одна функция-хелпер). |
| 3 | `src/mcp/tools.ts` | (а) inputSchema `backlog_update_task` (~154): добавить `acceptanceCriteria: {type:'array', items:{type:'string'}}` (полная замена, unchecked); обработка в `toolUpdateTask` — map строки → `{text, checked:false}`, симметрия create; JSON-строка массива — разбор (lesson-35, общий хелпер с create, вынести `parseStringArray`); (б) `handleToolCall(name, args, cwd, opts?)` — опциональный параметр `{ defaultStatus?: string }`, проброска в `toolCreateTask`; description поля `status` в `backlog_create_task` — уточнить. |
| 4 | `src/agent/tools.ts` | `export` для `resolveInProject` (сейчас приватная, строка ~104). Больше ничего не менять — read_file/write_file чата собираются в tool-policy поверх неё + `truncateToolOutput`. |
| 5 | `templates/agent-prompt.md` | Не менять (это системный промпт `vibelog-agent`, не веб-чата). |
| 6 | `web/src/components/chat/thread.tsx` | Карточка approval уже универсальна (tool-call part + кнопки Allow/Deny из VL-204) — проверить, что заголовок/описание карточки не захардкожены под «Создание задачи»: если захардкожено — показывать имя инструмента + JSON аргументов (write_file: путь; backlog_update_task: id + поля). Фронт-фикс минимальный, если хардкод найден. |
| 7 | `README.md` | Секция «Веб-чат (#/chat)» → «Инструменты модели»: все MCP-инструменты (read — сразу, write — с подтверждением) + read_file/write_file, Spec-статус, пределы проекта. |
| 8 | `CHANGELOG.md` | Запись VL-219 в Unreleased → Добавлено. |
| 9 | `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md` | Обновить таблицу `backlog_create_task` (status: дефолт Spec в веб-чате) и `backlog_update_task` (новое поле acceptanceCriteria). |
| 10 | Тесты | см. ниже |

## Тесты

| Файл | Что добавить |
|---|---|
| `src/web/tool-policy.test.mjs` (новый) | `isWriteOperation`: write-глаголы (create/update/add/remove/rename/archive/manage/finish/supersede/link/sync + write_file/edit/run_shell_command) → true; read (list/view/search/get/ready + read_file/grep_search/glob) → false; неизвестное имя → true (fail-safe). `chatToolDefs()`: содержит все имена `listTools()` + read_file + write_file; схемы совпадают с реестром. |
| `src/web/chat.test.mjs` (дописать) | (1) инструменты модели = все MCP + read_file/write_file (AC8: оба описаны в схеме; проверка `state.tools` на read_file/write_file с required-полями); (2) read_file исполняется без approval: tool_start/tool_end, содержимое файла в result; (3) write_file → событие approval, файл не создан; resume approved:true → файл записан; approved:false → не записан (AC4-7); (4) выход за пределы проекта в read_file/write_file → tool-result с ошибкой «Путь выходит за пределы» (AC3/AC7); (5) `backlog_update_task` → approval; approved:true → поля обновлены, возвращает обновлённое представление; несуществующий id → tool-result с «не найдена» (дополнение §2); (6) `backlog_create_task` без status → задача со статусом Spec (конфиг с default_status 'To Do' в beforeAll — наличие Spec в statuses фикстуры нужно добавить); (7) create с явным status → его статус; (8) в системном сообщении есть описание read_file/write_file (AC8): первый LLM-вызов содержит маркеры «read_file»/«write_file» в system-части — `state.messages[0][0].role === 'system'`. |
| `src/mcp/types.test.mjs` или `v11.test.mjs` (дописать) | `backlog_update_task` с `acceptanceCriteria: ['a','b']` → чеклист unchecked; строка-JSON `'["a"]'` → тоже массив (lesson-35); create с `opts.defaultStatus='Spec'` → status Spec; без opts → как раньше. |
| `src/core/config.test.mjs` | Не трогаем. |

Фикстура `chat.test.mjs`: в beforeAll добавить `'Spec'` в `statuses` и оставить `default_status: 'To Do'` — тесты на дефолтный To Do не сломаются, Spec-тест валиден.

## Порядок действий

1. `src/agent/tools.ts`: export `resolveInProject`; `pnpm build`.
2. `src/mcp/tools.ts`: поле `acceptanceCriteria` в update_task + обработка (+ JSON-строка); `opts` в `handleToolCall` → `toolCreateTask`; description поля status. Тесты mcp.
3. `src/web/tool-policy.ts`: новый модуль (isWriteOperation, chatToolDefs, buildChatSystemPrompt). Тест tool-policy.test.mjs.
4. `src/web/chat.ts`: подключить tool-policy, approval по isWriteOperation во всех трёх точках, системный промпт, единый кап tool-result, opts в handleToolCall. Тесты chat.
5. Фронт `thread.tsx` — проверка хардкода заголовка карточки; правка при необходимости.
6. Документация: README, doc-8, CHANGELOG.
7. Проверки (см. ниже), коммит в vb/vl-219.

## Как проверить

```bash
pnpm build && pnpm test:fast        # все тесты
node -e "..."                        # не нужен — проверки в тестах
pnpm build && npx vitest run src/web/chat.test.mjs src/web/tool-policy.test.mjs src/mcp/v11.test.mjs src/mcp/types.test.mjs  # точечно
```
Ручная проверка (по желанию Code-фазы): `vibelog browser` → `#/chat` → «прочитай README.md» (читается без карточки), «запиши файл x.txt» (карточка Allow/Deny), «измени title задачи VL-N» (карточка; Allow → обновлено).

## Риски

1. **Системный промпт растёт** — глобальный поиск + инструкция на каждый ход. Митигация: инструкция компактная (~1–1.5KB), globalSearch лимитирован (20 результатов).
2. **Fail-safe «неизвестное имя = write»** может поставить approval на будущий read-инструмент. Приемлемо: подтверждение не ломает UX критично; при добавлении read-инструмента его имя матчит read-глагол или правится одна строка классификатора (без правки инструкции — ТЗ соблюдён).
3. **Регрессия тестов chat на текст deny-сообщения** — обобщение текста «создание задачи» → «операцию» потребует правки матча в chat.test.mjs (учтено в тестах).
4. **`opts.defaultStatus` — совместимость**: все существующие вызовы handleToolCall без opts — поведение не меняется; тесты mcp это покрывают (регрессия на To Do из конфига).
5. **Чат получает destructive-инструменты** (`backlog_finish_phase`, `reference_remove`, `milestone_remove`) — все под approval, риск минимален; в инструкции указать: фазы и релизные операции не выполнять из чата.
6. **worktree**: backlog живёт в основном репо (MCP), код — в worktree vb/vl-219; файлы backlog/ не коммитить.
<!-- SECTION:PLAN:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
## Уточнения по комментарию Pavel (2026-10-29 19:05) — внесены в план

### У1. Р7 исправлен (критично): расширять существующую buildSystemPrompt
Фактура подтверждена: `buildSystemPrompt(cwd, lastUser)` — `src/web/chat.ts:215`, статическая часть (роль + описания 3 инструментов) — строковый литерал в коде, динамический контекст globalSearch по последнему user-сообщению дописывается поверх (строки 227–243), вызов — строка 488. Пункт Р7 плана заменён: **не** создавать CHAT_SYSTEM_PROMPT с нуля, а:
- вынести статическую часть в шаблон (у2) и читать её в buildSystemPrompt;
- расширить текст шаблона описаниями: read_file (путь, offset/limit, без подтверждения, только в пределах проекта), write_file (путь, content, только Allow/Deny, только в пределы проекта), backlog_update_task (id + поля, с подтверждением), общее правило read-сразу/write-с-подтверждением по природе операции, уточнение backlog_create_task (дефолт Spec, description = контекст/цель/входные из диалога, AC если данные есть в диалоге);
- динамический контекст globalSearch остаётся в buildSystemPrompt, поверх шаблона (контекст в шаблон НЕ выносить).

### У2. Статическая часть — в шаблон templates/prompts/chat-system.md с переопределением
Паттерн VL-188 (зеркало loadPhaseTemplate из `src/web/phase-prompt.ts:103–118`):
- встроенный шаблон: `templates/prompts/chat-system.md` (путь вычисляется `fileURLToPath(new URL('../../templates/prompts/chat-system.md', import.meta.url))`, как templatesDir фаз);
- переопределение: `<cwd>/.vibelog/prompts/chat-system.md` — приоритетнее встроенного (PROJECT_CHAT_SYSTEM_PATH = join('.vibelog', 'prompts', 'chat-system.md'));
- резолвер `loadChatSystemTemplate(cwd)`: project → bundled → throw «Шаблон chat-system.md не найден: .vibelog/prompts/chat-system.md (проект) и templates/prompts/chat-system.md (пакет)» (fail-closed, как у loadAgentPrompt/loadPhaseTemplate);
- подстановок {{...}} в шаблоне нет — статический текст + отдельная вставка контекста в buildSystemPrompt (контекст рантаймовый);
- `package.json.files` уже содержит `"templates"` (подкаталог templates/prompts/ попадает автоматически) — пункт уточнения закрыт без правки files; **scripts/npm-smoke.mjs** дополнить проверкой `templates/prompts/chat-system.md` в пакете (после проверки agent-prompt.md, строка ~160);
- тесты (в chat.test.mjs или отдельный chat-system-prompt.test.mjs): переопределение проектом имеет приоритет; удаление обоих файлов → throw «Шаблон chat-system.md не найден»; встроенный шаблон содержит описания read_file/write_file/backlog_update_task/backlog_create_task.

### У3. Конкретный handler read_file/write_file в tool-policy.ts
Новые экспортируемые функции в `src/web/tool-policy.ts` (ToolSpec-подобные, но для ToolDef чата — handler возвращает string):
- `makeReadFileTool(cwd)` → ToolDef `{name:'read_file', description, inputSchema:{path required, offset?, limit?}}` + `handler(args)`: `resolveInProject(cwd, args.path)` (экспорт из src/agent/tools.ts — уточнение исходного плана сохранено) → `readFileSync(abs,'utf8')` (ошибка ENOENT/EISDIR — текстом) → split('\n') → slice(offset, offset+limit) как в makeReadFile агента → `truncateToolOutput(slice.join('\n'))` (единая точка капа, lesson-30). Вызывается в tool-цикле чата **без approval** (isWriteOperation('read_file') === false).
- `makeWriteFileTool(cwd)` → ToolDef `{name:'write_file', description, inputSchema:{path required, content required}}` + `handler(args)`: `resolveInProject(cwd, args.path)` → `mkdirSync(dirname(abs), {recursive:true})` → `writeFileSync(abs, content, 'utf8')` → `Файл записан: <rel> (N байт)` (как в makeWriteFile агента). Исполняется **только** через approval-gate (isWriteOperation('write_file') === true → в resume-ветке после Allow).
- Логика handler'ов — переиспользование кода агента: вынести общие хелперы `readFileRange`/`writeFileContent` в tool-policy (не дублировать текстом, lesson-37), либо — если вынос дороже — вызывать существующие make-фабрики агента с фильтрацией handler'а; решение за Code-фазой, критерий — нет копипасты строк.

### У4. Запрещённые в чате инструменты — вариант (c) гибрид
- `CHAT_DISALLOWED_TOOLS = ['backlog_finish_phase', 'reference_sync', 'milestone_remove']` в tool-policy.ts; фильтрация в `chatToolDefs()`: `listTools().filter(t => !CHAT_DISALLOWED_TOOLS.includes(t.name))` + read_file + write_file. Модель этих имён не видит — технический запрет, надёжнее инструкции.
- Обоснование выбора: backlog_finish_phase — атомарно меняет статус + токены, побочный эффект фазового workflow не откатывается ни Allow, ни Deny на уровне чата (фазы запускаются оркестратором, не чатом); reference_sync — сетевые запросы + клонирование, выходит за пределы проекта (нарушение границы доступа); milestone_remove — необратимая переназначка/очистка задач. Остальные destructive (backlog_update_status, lesson/document remove и т.п.) — обратимы и уже под approval (variant b достаточен для них; variant a избыточен).
- В шаблон chat-system.md — текст: «Инструменты фаз (finish), синхронизация референсов и удаление вех недоступны в чате — это делается рабочим процессом Vibelog; остальные изменяющие операции требуют подтверждения Allow/Deny.» (соответствует варианту c).

### Обновлённый порядок действий (с учётом у1–у4)
1. `src/agent/tools.ts`: export `resolveInProject`; `pnpm build`.
2. `src/mcp/tools.ts`: acceptanceCriteria в backlog_update_task + JSON-строка массива (lesson-35); `opts` в handleToolCall → toolCreateTask (Spec-дефолт). Тесты mcp.
3. `src/web/tool-policy.ts`: isWriteOperation, CHAT_DISALLOWED_TOOLS, chatToolDefs (с фильтром + read_file/write_file), makeReadFileTool/makeWriteFileTool (у3). Тест tool-policy.test.mjs.
4. `templates/prompts/chat-system.md` (новый, у2) + резолвер в buildSystemPrompt (расширение, не дублирование, у1); `scripts/npm-smoke.mjs` — проверка шаблона в пакете. Тесты шаблона (приоритет/fail-closed/содержание).
5. `src/web/chat.ts`: подключить tool-policy; approval по isWriteOperation во всех трёх точках (~519, ~436, ~555); единый кап tool-result; Spec-opts в handleToolCall. Тесты chat (8 кейсов из исходного плана).
6. Фронт `thread.tsx`: TOOL_LABELS/TOOL_ICONS — хардкод под 3 инструмента подтверждён (строки ~76–84), pending-card «Создать задачу?» — обобщить на любой write-инструмент (заголовок из TOOL_LABELS с фолбэком на имя, detail — path/id/title, подпись «Выполнить операцию?»).
7. Документация: README (секция Веб-чат), doc-8 (Spec-дефолт + acceptanceCriteria в update_task + запрещённые инструменты), CHANGELOG (VL-219).
8. Проверки: `pnpm build && pnpm test` + точечно chat/tool-policy/mcp; `node scripts/npm-smoke.mjs` (после добавления проверки шаблона). Коммит в vb/vl-219, backlog/ не коммитить.
<!-- SECTION:NOTES:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-29 18:00
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Ассистент: read_file/write_file, обновление задач, полный доступ MCP» (отражает полный объём задачи после дополнений). Тип: feature. Масштаб: task. Приоритет: Medium (описание полное, приоритет неочевиден). Уточнено: критерии приёмки переработаны с учётом дополнений — статус Spec при backlog_create_task, инструмент backlog_update_task с подтверждением, полный доступ к MCP-инструментам с разделением read/write по природе операции; зафиксированы границы доступа (только пределы проекта) и обязательность подтверждения для write-операций. Labels: agent, mcp. References: нет (внешние источники не упоминались). Вопросов нет.
---
author: @agent
created: 2026-10-29 18:46
---
Фаза plan не удалась (код выхода 1): ] фаза: запросов=6, payload последнего запроса=244913 байт (макс 244913), usage={"input_tokens":200171,"output_tokens":2810,"cache_read_input_tokens":141440,"total_tokens":202981,"reasoning_tokens":0} — статус возвращён к Spec.
---
author: @agent
created: 2026-10-29 18:51
---
Фаза 2 (Plan) выполнена. Тип: feature. План записан в задачу (Implementation Plan). Объём: 10 файлов — новый модуль src/web/tool-policy.ts (isWriteOperation по природе операции + fail-safe write для неизвестных имён, chatToolDefs = все MCP-инструменты listTools() + read_file/write_file, системная инструкция чата), src/web/chat.ts (approval-gate по isWriteOperation во всех трёх точках цикла, системный промпт, единый кап tool-result), src/mcp/tools.ts (acceptanceCriteria в backlog_update_task + opts.defaultStatus для Spec-статуса create из чата), export resolveInProject в src/agent/tools.ts, фронт thread.tsx (проверка хардкода карточки), README, doc-8, CHANGELOG, тесты (tool-policy.test.mjs новый, chat.test.mjs +8 кейсов, mcp-тесты). Ключевые решения: классификация read/write по семантике имени с fail-safe «неизвестное = write» (новые MCP-инструменты подключаются без правки инструкции); Spec-статус через опциональный opts в handleToolCall (поведение CLI/MCP не меняется); переиспользование resolveInProject для границ проекта. Риски: рост system-промпта, fail-safe может требовать approval для будущих read-инструментов, правка текста deny в тестах, доступ к destructive-инструментам под approval.
---
author: Pavel Bobarev
created: 2026-10-29 19:05
---
План принят. Перед Code — четыре уточнения. Первое критично (в плане ошибка), остальные — дополнения.
1. Р7 неверен — системный промпт уже есть.
В chat.ts уже существует функция buildSystemPrompt(cwd, lastUser) (строка ~295): статическая часть (роль + описания 3 инструментов) + динамический контекст из globalSearch по последнему сообщению. Не добавлять CHAT_SYSTEM_PROMPT с нуля и не дублировать — расширить существующую buildSystemPrompt:
- добавить описания read_file (путь, offset/limit, без подтверждения, только в пределах проекта);
- добавить write_file (путь, content, только с подтверждением Allow/Deny, только в пределах проекта);
- добавить backlog_update_task (id + поля, с подтверждением);
- добавить общее правило: read-операции — сразу, write — с подтверждением (по природе операции, не по списку имён);
- уточнить backlog_create_task: статус по умолчанию Spec, description заполнять результатом spec-фазы (контекст / цель / входные из диалога), acceptanceCriteria — если данные есть в диалоге.
2. Хардкод системного промпта — вынести в templates/ с переопределением.
Сейчас buildSystemPrompt собирает статическую часть строкой прямо в коде. Вынести её в файл шаблона по той же схеме, что уже работает для промптов фаз (VL-188):
- встроенный шаблон: templates/prompts/chat-system.md (markdown, подстановки {{...}} по необходимости — например {{tools}}, {{context}}, если удобно; или статический текст + отдельная вставка контекста в buildSystemPrompt);
- переопределение проектом: .vibelog/prompts/chat-system.md (приоритетнее встроенного — как .vibelog/prompts/phases/phase-<name>.md для фаз);
- резолвер: сначала .vibelog/prompts/chat-system.md, потом templates/prompts/chat-system.md, иначе — ошибка «Шаблон chat-system.md не найден» (fail-closed, как у renderPrompt);
- buildSystemPrompt читает статическую часть из шаблона и добавляет динамический контекст (globalSearch) поверх — контекст не выносить в шаблон, он формируется в рантайме;
- добавить путь templates/prompts/ в package.json.files (чтобы шаблон попадал в npm-пакет);
- обновить scripts/npm-smoke.mjs: проверять наличие templates/prompts/chat-system.md в пакете;
- тест: переопределение через .vibelog/prompts/chat-system.md имеет приоритет; удаление обоих файлов → понятная ошибка; встроенный шаблон содержит описания read_file/write_file/backlog_update_task/backlog_create_task.
3. Конкретный handler для read_file/write_file в tool-policy.ts.
В плане этого нет. Уточнить: какая функция, какие аргументы, как вызывает resolveInProject(cwd, path) (экспортировать из src/agent/tools.ts), readFileSync/writeFileSync, truncateToolOutput (единая точка капа, lesson-30). read_file — без approval; write_file — с approval (по isWriteOperation). Оба — в пределах проекта.
4. Запрещённые в чате инструменты — технически или через approval?
В Риске 5 плана сказано «в инструкции указать: фазы и релизные операции не выполнять из чата» — это инструкция модели, а не техническое ограничение. Модель может проигнорировать. Выбрать и обосновать:
- (a) технический фильтр: CHAT_DISALLOWED_TOOLS = ['backlog_finish_phase', 'reference_sync', 'milestone_remove', 'run_shell_command', ...], фильтровать в chatToolDefs() — этих инструментов модель вообще не видит;
- (b) оставить все с approval (они и так write) + в инструкции «не выполнять»;
- (c) гибрид: destructive (backlog_finish_phase, milestone_remove, reference_sync) — технически запретить, остальные — с approval.
Выбрать вариант, обосновать, добавить в план и в системный шаблон (chat-system.md) соответствующий текст.
---
author: @agent
created: 2026-10-29 19:13
---
Уточнения из комментария Pavel (2026-10-29 19:05) обработаны, в Implementation Plan внесены (пункты «Уточнения по комментарию Pavel»):
1. **Р7 исправлен (критично)** — фактура подтверждена: buildSystemPrompt(cwd, lastUser) уже есть в src/web/chat.ts:215 (строковый литерал статической части + контекст globalSearch поверх, вызов на строке 488). План меняется с «создать CHAT_SYSTEM_PROMPT с нуля» на «расширить существующую buildSystemPrompt»: описания read_file/write_file/backlog_update_task, общее правило read-сразу/write-с-подтверждением по природе операции, уточнение backlog_create_task (дефолт Spec, description = контекст/цель/входные, AC если данные есть в диалоге).
2. **Шаблон с переопределением** — зеркало loadPhaseTemplate (phase-prompt.ts:103–118): templates/prompts/chat-system.md (встроенный) → .vibelog/prompts/chat-system.md (приоритетнее) → fail-closed «Шаблон chat-system.md не найден»; контекст globalSearch остаётся в buildSystemPrompt поверх шаблона. package.json.files уже содержит "templates" (подкаталог попадает) — правка files не нужна; npm-smoke.mjs дополнить проверкой наличия chat-system.md в пакете; тесты: приоритет переопределения, ошибка при отсутствии обоих, наличие описаний 4 инструментов во встроенном шаблоне.
3. **Handler read_file/write_file** — конкретика внесена в план: сигнатуры makeReadFileTool/makeWriteFileTool в tool-policy.ts, resolveInProject (export из src/agent/tools.ts), readFileSync/writeFileSync/mkdirSync, truncateToolOutput как единую точку капа (lesson-30); read_file без approval, write_file — только через approval-gate; без копипасты кода агента (lesson-37).
4. **Запрещённые инструменты — вариант (c) гибрид, обоснован**: backlog_finish_phase (атомарная смена статуса + токенов, побочный эффект фазового workflow не откатывается решением в чате), reference_sync (сетевые запросы и клонирование — выход за пределы проекта), milestone_remove (необратимая переназначка задач) — технический фильтр CHAT_DISALLOWED_TOOLS в chatToolDefs(), модель их не видит; остальные destructive-операции обратимы и уже покрыты approval. Текст запрета — в шаблон chat-system.md.
Порядок действий и файлы обновлены (8 шагов). Готов к фазе Code.
---
author: @agent
created: 2026-10-29 19:33
---
Фаза 3 (Code) выполнена. Изменено: src/web/tool-policy.ts (новый — isWriteOperation по природе операции с fail-safe write для неизвестных имён, CHAT_DISALLOWED_TOOLS = backlog_finish_phase/reference_sync/milestone_remove, chatToolDefs = все listTools() минус запрещённые + read_file/write_file, makeReadFileTool/makeWriteFileTool поверх экспортированного resolveInProject + truncateToolOutput, loadChatSystemTemplate с переопределением .vibelog/prompts/chat-system.md → templates/prompts/chat-system.md и fail-closed), templates/prompts/chat-system.md (новый — описания read_file/write_file/backlog_update_task/backlog_create_task с дефолтным Spec, общее правило read-сразу/write-с-подтверждением, текст запрета destructive-инструментов), src/web/chat.ts (approval-gate по isWriteOperation во всех трёх точках, buildSystemPrompt поверх шаблона, единая точка капа executeTool, Spec-opts), src/agent/tools.ts (export resolveInProject), src/mcp/tools.ts (HandleToolCallOpts.defaultStatus → Spec, acceptanceCriteria в backlog_update_task + parseAcList с JSON-строкой и фолбэком []), src/web/tool-policy.test.mjs (новый, 9 тестов), src/web/chat.test.mjs (+10 тестов VL-219, fixture statuses += Spec), src/mcp/v11.test.mjs (+3 теста), web/src/components/chat/thread.tsx (карточка approval обобщена на любую write-операцию), scripts/npm-smoke.mjs (проверка chat-system.md в пакете), README.md (секция «Веб-чат»), CHANGELOG.md, backlog/docs/doc-8 (через MCP — статус Spec в create, acceptanceCriteria в update_task), web/dist (пересборка фронта). Коммит 532c590 (без backlog/). Проверки: pnpm build (tsc чисто), pnpm test — 85 файлов 1544 passed + 4 skipped + 7 static (0 падений, регрессий нет), pnpm web:build (vite собрался). AC 1–9 закрыты (read без подтверждения, offset/limit, границы проекта read/write, write approval Allow/Deny без молчаливой записи, описания в системной инструкции через шаблон chat-system.md, тесты проходят). DoD 1–3 закрыты. Что осталось: ничего обязательного; ручной smoke в браузере (#/chat: прочитать файл без карточки, записать с Allow/Deny, создать задачу со статусом Spec) — по желанию, автотестами покрыто.
---
author: @agent
created: 2026-10-29 20:21
---
Фаза close не удалась (код выхода 1):  фаза: запросов=10, payload последнего запроса=184436 байт (макс 184436), usage={"input_tokens":350528,"output_tokens":5548,"cache_read_input_tokens":284864,"total_tokens":356076,"reasoning_tokens":0} — статус возвращён к Review.
---
author: @agent
created: 2026-10-29 23:43
---
Фаза Close прервана: конфликт слияния vb/vl-219 → master (файлы: UU CHANGELOG.md). Разреши конфликт вручную и повтори Фазу Close.
Детали: ветка vb/vl-219 содержит 1 коммит (532c590 feat: VL-219 — ассистент веб-чата: read_file/write_file, backlog_update_task, полный доступ MCP). Merge --no-ff прошёл по всем файлам кода (src/web/*, src/mcp/*, src/agent/tools.ts, web/**, templates/prompts/chat-system.md, scripts/npm-smoke.mjs) без конфликтов, конфликт только в CHANGELOG.md (обе стороны правили раздел Unreleased). Конфликтные маркеры в CHANGELOG.md оставлены как есть — не резолвились и не откатывались. Статус и DoD не изменены.
---
author: Pavel Bobarev
created: 2026-10-29 23:58
---
Разреши конфликт и сделай коммит
---
author: @agent
created: 2026-10-30 00:01
---
Фаза Comment выполнена.
**Конфликт разрешён, коммит сделан** (ветка `vb/vl-219`).
- `git merge master` → единственный конфликт в `CHANGELOG.md`, секция Unreleased → «Добавлено»: обе записи (VL-219 из ветки и VL-223 из master) сохранены, порядок по свежести — VL-219, затем VL-223; маркеры конфликта удалены, остальные разделы файла смержены автоматически.
- Коммит merge: `3524cdb Merge branch 'master' into vb/vl-219` (родители `532c590` — VL-219, `4df1b9b` — master).
- Проверки после мержа: `pnpm build` — ok; полный `vitest run` — **86 файлов / 1564 теста passed, 4 skipped**, регрессий нет (в т.ч. точечно `chat.test.mjs`, `tool-policy.test.mjs`, `v11.test.mjs`, `types.test.mjs`, `phase-prompt.test.mjs`, `loop.test.mjs`, `session.test.mjs` — 249 passed).
- `backlog/` в коммит не включался (backlog живёт в основном репозитории; файлы master пришли только самим merge-коммитом, код-диффа по `backlog/` относительно master нет).
Статус не меняется: в комментарии просьбы о смене статуса не было.
---
author: @agent
created: 2026-10-30 00:22
---
Фаза Close выполнена. Ветка `vb/vl-219` слита в master (2 коммита ветки: `532c590` feat + `3524cdb` merge master→ветка), конфликт `CHANGELOG.md` разрешён подстановкой блоба из merge-коммита ветки → коммит `c589e7c`; сверка деревьев `<master-merge>` vs `<branch-merge>` — пусто. Документация: `30e7690` — README (секция «Веб-чат»: все MCP-инструменты, правило read/write по природе операции, read_file/write_file, Spec-дефолт, backlog_update_task/acceptanceCriteria, пределы проекта, CHAT_DISALLOWED_TOOLS, шаблон системной инструкции) и doc-8 (status в create_task: Spec в веб-чате; новое поле acceptanceCriteria в update_task). Lessons: `lesson-81` создан и связан (`29d435e`). Проверки: `pnpm build` — ok; полный `vitest run` на дереве ветки (идентично master-merge, код-дифф пуст) — 86 файлов / 1564 passed, 4 skipped; после merge менялась только документация, код не тронут. Worktree и ветка удаляются следом. DoD: 1) тесты проходят — да; 2) документация обновлена — да (README, doc-8, CHANGELOG); 3) регрессий нет — да (сверка деревьев + полный прогон).
---
author: @agent
created: 2026-10-30 00:24
---
Фаза Close завершена полностью — все изменения VL-219 в **master**.
История master:
- `c589e7c` merge: VL-219 (конфликт CHANGELOG.md разрешён подстановкой блоба из merge-коммита ветки `3524cdb`; сверка деревьев `<master-merge>` vs `<branch-merge>` — пусто)
- `30e7690` docs: VL-219 — README (секция «Веб-чат»: полный набор MCP-инструментов, правило read/write по природе операции, read_file/write_file, Spec-дефолт при создании задачи, backlog_update_task + acceptanceCriteria, пределы проекта, CHAT_DISALLOWED_TOOLS, шаблон системной инструкции) и doc-8 (status в create_task: Spec в веб-чате; новое поле acceptanceCriteria в update_task)
- `29d435e` docs(task): VL-219 — refs и lessons (`lesson-81`)
- `34148a1` docs(task): VL-219 — закрытие задачи (Done)
Уборка: worktree `.vibelog/worktrees/vl-219` удалён (`worktree prune` подтвердил — в списке worktrees его нет), ветка `vb/vl-219` удалена.
Состояние master: рабочее дерево чистое по отслеживаемым файлам; статус задачи — Done, отчёт о закрытии уже в файле задачи (коммит `34148a1`).
---
<!-- COMMENTS:END -->