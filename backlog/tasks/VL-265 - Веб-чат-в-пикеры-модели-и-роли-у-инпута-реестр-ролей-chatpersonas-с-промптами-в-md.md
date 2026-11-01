---
id: VL-265
title: 'Веб-чат (в): пикеры модели и роли у инпута, реестр ролей chat_personas с промптами в md'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 17:01'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - web
  - chat
  - personas
  - ref-22
dependencies: []
milestone: v1.11
references: []
priority: high
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/models.ts
  - src/core/models.test.mjs
  - src/web/personas.ts
  - src/web/personas.test.mjs
  - src/web/chat.ts
  - src/web/chat.test.mjs
  - src/web/api.ts
  - src/web/models-api.test.mjs
  - templates/prompts/personas/helper.md
  - templates/prompts/personas/architect.md
  - templates/prompts/personas/orchestrator.md
  - templates/prompts/chat-system.md
  - scripts/npm-smoke.mjs
  - web/src/components/chat/pickers.tsx
  - web/src/components/chat/chat-runtime.tsx
  - web/src/components/chat/thread.tsx
  - web/src/components/chat/thread-sidebar.tsx
  - web/src/components/settings/api.ts
  - web/dist/index.html
  - README.md
lessons:
  - lesson-117
  - lesson-113
token_usage:
  input: 23538427
  output: 76672
  cache: 23126016
  total: 23615099
  requests: 230
  duration_ms: 2113597
  reasoning: 21810
  by_phase:
    plan:
      input: 10247931
      output: 31963
      cache: 10034176
      requests: 88
    code:
      input: 11942006
      output: 39340
      cache: 11785216
      requests: 112
    close:
      input: 1348490
      output: 5369
      cache: 1306624
      requests: 30
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст (из диалога)

Пункт (в) разбиения доработок веб-чата по референсу ref-22. Запрос пользователя: «Переключение модели должно быть как в референсе у инпута сообщений (сейчас он в сайдбаре). И там же должен быть переключатель ассистента (разный системный промпт — разные роли типа: помощник/кодер), эти роли чуть позже вынесем в настройки и там же будем задавать разрешения и промпты».

Решения, согласованные с пользователем:
- Q0: в модель settings.json добавить необязательное `description` — да.
- Q1: реестр ролей сразу в `settings.json`, но **без UI-настройки** (только файл). Тексты промптов — в `.md` с переопределением проектом. Дают 3 дефолтные роли + возможность создать роль на уровне проекта.
- Q2: разрешения (`allow_tools`) — только шов: поле в схеме, чтение и валидация; фильтрация отдельной задачей.
- Q3: роль не задаёт модель.
- Q4: 3 дефолтные роли (helper/architect/orchestrator) + 2 проектные роли в `.vibelog/settings.json` этого проекта как пример (researcher/auditor).
- Q5: всегда helper по умолчанию при старте (без localStorage).

## Установлено по коду

- Модель: `ModelSwitcher` в `web/src/components/chat/thread-sidebar.tsx` (shadcn `<Select>`, `fetchModels()` → `GET /api/models`), выбор пишется в module-state `setActiveModelId` (`web/src/components/chat/chat-runtime.tsx`) → `body.model` → `src/web/chat.ts:351` валидирует через `resolveModelById`. `GET /api/models` (`src/web/api.ts:197`) отдаёт `{ id, label, provider, api_mode }` — описания нет.
- Системный промпт: `buildSystemPrompt` (`src/web/chat.ts:219`) = `loadChatSystemTemplate(cwd)` (резолвер в `src/web/tool-policy.ts:280`: `<cwd>/.vibelog/prompts/chat-system.md` → `templates/prompts/chat-system.md`, fail-closed) + динамический блок globalSearch по последнему сообщению.
- Статус создаваемой задачи: `executeTool` в `src/web/chat.ts` вызывает `handleToolCall(name, args, cwd, { defaultStatus: 'Spec' })` — сейчас константа, роль должна её менять (helper → Spec, architect → Planned).
- Запрещённые в чате инструменты: `CHAT_DISALLOWED_TOOLS` (`src/web/tool-policy.ts`) — `backlog_finish_phase`, `reference_sync`, `milestone_remove`. Для «Оркестратора» это ключевое ограничение: запускать фазы он не сможет до отдельной задачи.
- UI-компоненты: `web/src/components/ui/dropdown-menu.tsx` есть; стиль пикеров — `ModelPicker`/`SearchModePicker` в `apps/docs/components/pages/examples/perplexity.tsx` (ref-22), эталонный `elements/model-selector.tsx` в том же репозитории.

## Роли и их смысл (из диалога)

1. **helper «Помощник»** — работа с backlog; по итогу может создать задачу в статусе **Spec**. Минимальная трата токенов и скорость ответа/результата (по сути текущее поведение чата).
2. **architect «Архитектор»** — работа с backlog и кодом проекта; более глубокие исследования; по итогу создаёт задачу сразу в статусе **Planned**. По сути аналог фазы plan, но в чат-режиме.
3. **orchestrator «Оркестратор»** — «умный auto»: согласовывает в чате, какие задачи брать в исполнение, и оркестрирует их до конца, запуская фазы; определяет, какие задачи можно запустить сейчас, параллельно или последовательно, какие не конфликтуют при слиянии; обработка ошибок (продолжить или создать баг-задачу). **Пока только промпт** — реализация отдельной задачей.
4. **researcher «Ресёрчер»** (проектная, пример в settings.json) — ищет информацию, предлагает задачи.
5. **auditor «Аудитор»** (проектная, пример в settings.json) — находит несоответствия, создаёт задачи на фикс.

## Объём работ

1. **`src/core/models.ts`** — необязательное `description` в `models.available`; проброс в `GET /api/models` (`src/web/api.ts`), тип `ModelInfo` в `web/src/components/settings/api.ts`.
2. **Новый модуль реестра ролей** (например `src/web/personas.ts`): встроенные 3 дефолтные роли + слияние с `settings.json.chat_personas` (переопределение по id и добавление новых); валидация секции (объект, обязательные `label`, `prompt`; `allow_tools` — массив известных имён инструментов; `default_status` — существующий статус); резолвер шаблона промпта роли по схеме `loadChatSystemTemplate`: `<cwd>/.vibelog/prompts/personas/<prompt>.md` → `templates/prompts/personas/<prompt>.md`, fail-closed.
3. **`templates/prompts/personas/{helper,architect,orchestrator}.md`** — тексты ролей; общие правила (доступ read/write, список инструментов, границы проекта) остаются в `templates/prompts/chat-system.md` и не дублируются.
4. **`src/web/chat.ts`**: `persona` в `ChatRequestBody` и валидация (неизвестный id → error-событие, ход не начинается; отсутствие → helper); `buildSystemPrompt` получает блок роли; `defaultStatus` в `executeTool` берётся из роли (helper → Spec, architect → Planned), явный статус в аргументах вызова приоритетнее.
5. **`GET /api/personas`** (`src/web/api.ts`) — `[{ id, label, description }]` для пикера, без текстов промптов.
6. **Клиент**: `PersonaPicker` (по образцу `SearchModePicker`) и `ModelPicker` (по образцу `ModelPicker` из perplexity) — оба в нижней строке `ComposerPrimitive.Root`; module-state `activePersona` (дефолт всегда `helper`, без localStorage); `body.persona` в `chat-runtime.tsx`; удалить `ModelSwitcher` из `thread-sidebar.tsx`.
7. **Секция `chat_personas` в `.vibelog/settings.json` этого проекта** — пример с ролями `researcher` и `auditor` (промпты-файлы в `.vibelog/prompts/personas/`).
8. **Тесты** (`src/web/personas.test.mjs`, дополнения в `chat.test.mjs`, `models.test.mjs`, api-тесты): реестр, переопределение/добавление, невалидная секция, fail-closed, валидация persona, маппинг defaultStatus, GET /api/personas, description в models.
9. **Документация**: README, `templates/prompts/chat-system.md` (роль — отдельный блок), описание схемы `chat_personas`.

## Вне скоупа

- Реализация оркестрации (запуск фаз из чата, параллельность, разрешение конфликтов слияния) — отдельная задача; сейчас только промпт и оговорка в нём, что инструменты фаз недоступны.
- Фильтрация инструментов по `allow_tools` — отдельная задача.
- UI-редактор ролей в `#/settings` — по решению Q1 пока не делаем.
- Лимиты хода и авто-продолжение, стиль сообщений и tool-карточки — другие задачи (VL-263, VL-264).

## Референсы

ref-22 (assistant-ui): `apps/docs/components/pages/examples/perplexity.tsx` (`ModelPicker`, `SearchModePicker`), `packages/ui/src/components/react/assistant-ui/elements/model-selector.tsx`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В models.available settings.json поддерживается необязательное поле description; GET /api/models отдаёт его в ModelInfo (undefined, если не задано); отсутствие поля не ломает текущие настройки и тесты
- [x] #2 Пикер модели перенесён из сайдбара тредов в нижнюю строку композера (справа, рядом с кнопкой Send) и выглядит как ModelPicker в perplexity.tsx: ghost-кнопка с названием модели + ChevronDownIcon, дропдаун со списком (галочка у выбранного, name + description во второй строке, минимальная ширина 240px)
- [x] #3 Из thread-sidebar.tsx удалён ModelSwitcher и весь его код; сайдбар больше не содержит селект модели
- [x] #4 В нижней строке композера слева — пикер роли (PersonaPicker) в стиле SearchModePicker: иконка + название + ChevronDownIcon, дропдаун с name + description и галочкой у выбранной роли
- [x] #5 Все 5 ролей доступны в пикере: 3 дефолтные (helper «Помощник», architect «Архитектор», orchestrator «Оркестратор») + 2 проектные (researcher «Ресёрчер», auditor «Аудитор») — последние заданы в .vibelog/settings.json этого проекта как пример
- [x] #6 Промпты дефолтных ролей лежат в templates/prompts/personas/{helper,architect,orchestrator}.md; переопределение проекта читается из .vibelog/prompts/personas/<id>.md; отсутствие шаблона — fail-closed ошибка с понятным текстом (схема loadChatSystemTemplate)
- [x] #7 Общая часть системного промпта (правило доступа read/write, список инструментов, границы проекта) остаётся в chat-system.md и НЕ дублируется в файлах ролей; сборка итогового промпта — общая часть + блок роли + контекст globalSearch
- [x] #8 Реестр ролей в settings.json: секция chat_personas, где ключ — id роли, значение — { label, description, prompt, allow_tools?, default_status? }; проект может добавить новую роль или переопределить дефолтную; невалидная секция (не объект, нет label/prompt) даёт понятную ошибку валидации, а не падение
- [x] #9 Дефолтные роли работают без секции chat_personas в settings.json (реестр в коде + встроенные шаблоны); секция только переопределяет и добавляет
- [x] #10 Поле allow_tools присутствует в схеме реестра, читается и валидируется (массив строк, существующие имена инструментов), но фильтрация инструментов по роли НЕ применяется — это отдельная задача (шов на будущее)
- [x] #11 Тело POST /api/chat принимает persona (id роли); неизвестный id → error-событие «Неизвестная роль: <id>» без выполнения хода; отсутствие persona → роль helper
- [x] #12 Роль влияет на defaultStatus создаваемой задачи: helper → Spec, architect → Planned; явно переданный в вызове задачи статус имеет приоритет над ролью (сохраняется текущая семантика defaultStatus)
- [x] #13 GET /api/personas отдаёт список ролей для пикера: id, label, description (без текста промптов); выбор роли на клиенте хранится в module-state (как activeModelId) и уходит в body.persona следующего запроса
- [x] #14 При старте/перезагрузке страницы всегда активна роль helper (без localStorage), смена роли не сбрасывает выбранную модель
- [x] #15 Роль НЕ задаёт модель: пикеры модели и роли независимы, при смене роли модель остаётся прежней
- [x] #16 Роль «Оркестратор» реализована только как промпт: инструменты фаз (finish_phase и прочие из CHAT_DISALLOWED_TOOLS) в чате по-прежнему недоступны, реализация оркестрации — отдельная задача; в промпте это явно оговорено
- [x] #17 Пустая и заполненная роль не ломают стриминг: смена роли посреди треда применяется к следующему сообщению, история треда не переписывается
- [x] #18 Тесты: резолвер реестра ролей (дефолты, переопределение, добавление проектной роли, невалидная секция, fail-closed при отсутствии шаблона), валидация persona в теле запроса (известная/неизвестная/отсутствует), маппинг defaultStatus по роли, GET /api/personas, description в GET /api/models
- [x] #19 Документация: README/templates (секция chat_personas, каталоги промптов ролей, схема переопределения), templates/prompts/chat-system.md (упоминание, что роль добавляется отдельным блоком); web/npm run build и npm run lint проходят
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель

Пикеры модели и роли (persona) в нижней строке композера чата + реестр ролей `chat_personas` в `.vibelog/settings.json` с промптами в `.md`, плюс необязательный `description` у моделей.

## Архитектурные решения

1. **Новый модуль `src/web/personas.ts`** (по образцу `src/web/tool-policy.ts`): встроенные роли в коде + слияние с `settings.json.chat_personas` по id (переопределение дефолтной, добавление проектной). Валидация терпимая (паттерн `loadSettings`): битые записи отбрасываются, ошибки собираются в список и отдаются в `GET /api/personas` (поле `errors`) — падения нет.
2. **Резолвер промпта роли** — по схеме `loadChatSystemTemplate`: `<cwd>/.vibelog/prompts/personas/<prompt>.md` → встроенный `templates/prompts/personas/<prompt>.md`; оба отсутствуют → fail-closed `throw` с текстом «Шаблон роли <id> не найден: … (проект) и … (пакет)».
3. **`allow_tools` — только шов**: поле в схеме реестра, читается и валидируется (массив непустых строк, каждое имя ∈ `listTools()` ∪ локальные `read_file/write_file/search_files`); НЕ применяется к `chatToolDefs` (фильтрация — отдельная задача). Нарушение — ошибка валидации в `errors`, роль всё равно активна (без фильтрации).
4. **`default_status`** валидируется по `loadConfig(cwd).statuses` (`src/core/config.ts`, ключи `statuses`); невалидный → `errors` + роль остаётся с дефолтом `Spec`.
5. **Порядок сборки системного промпта** (AC7): общая часть `chat-system.md` → блок роли (`## Текущая роль: <label>` + текст файла роли) → динамический контекст globalSearch (как сейчас).
6. **Валидация `persona` в теле запроса** — в начале `produce` до чтения истории: не строка/пустая → `error` «Некорректная роль: ожидается строка id из chat_personas»; неизвестный id → `error` «Неизвестная роль: <id>» и `return` (ход не начинается, jsonl не пишется). Отсутствие поля → `helper`.
7. **Роль не задаёт модель** (AC15): пикеры независимы, `body.model` и `body.persona` валидируются раздельно.

## Файлы и конкретные места

| № | Файл | Что делаем |
|---|------|------------|
| 1 | `src/core/models.ts` | `ModelConfig` (строка ~40): += `description?: string` с JSDoc. В `loadModels` (в блоке сборки `conf`, рядом с `label` ~строка 118): `if (typeof mm.description === 'string' && mm.description !== '') conf.description = mm.description;` |
| 2 | `src/web/personas.ts` (новый) | Экспорты: `PersonaConfig {id,label,description?,prompt,allowTools?,defaultStatus?}`, `PersonaSummary {id,label,description?}`, `BUILTIN_PERSONAS` (helper/architect/orchestrator с default_status Spec/Planned/Spec), `loadPersonas(cwd): {personas, errors}`, `resolvePersona(cwd,id): PersonaConfig|null`, `listPersonas(cwd): {personas: PersonaSummary[], errors}`, `loadPersonaPrompt(cwd, persona): string` (fail-closed), `validatePersonasConfig(cwd): string[]`, `PROJECT_PERSONAS_DIR = join('.vibelog','prompts','personas')`, `DEFAULT_PERSONA_ID = 'helper'`, `resolveDefaultStatus(persona): string`. Жёсткие требования к секции: не объект → ошибка «settings.json: секция chat_personas должна быть объектом»; запись без `label` или без `prompt` → ошибка с id. Слияние: `{...BUILTIN, ...изSettings}` (порядок: встроенные в порядке объявления, затем проектные). |
| 3 | `templates/prompts/personas/helper.md`, `architect.md`, `orchestrator.md` (новые) | Только роль-специфика: helper — работа с backlog, скорость/минимум токенов, создание задачи в Spec; architect — исследование кода, задача сразу в Planned, аналогия с фазой plan; orchestrator — «умный auto» (выбор задач, параллельность, конфликты слияния, обработка ошибок) + явная оговорка «инструменты фаз (finish_phase и прочие из CHAT_DISALLOWED_TOOLS) в чате недоступны; оркестрация — отдельная задача». Правило read/write, список инструментов и границы проекта НЕ дублируются (они в `chat-system.md`). |
| 4 | `src/web/chat.ts` | (а) `ChatRequestBody` (~строка 47): += `persona?: unknown` с JSDoc; (б) импорт из `./personas.js` (`resolvePersona`, `loadPersonaPrompt`, `resolveDefaultStatus`, `DEFAULT_PERSONA_ID`); (в) `buildSystemPrompt` (строка 366) — сигнатура `(cwd, lastUser, persona: PersonaConfig)`; parts: `[loadChatSystemTemplate(cwd), `## Текущая роль: ${persona.label}\n\n${loadPersonaPrompt(cwd, persona)}`, globalSearch-контекст]`; (г) в `produce` (строка 483) — после загрузки `history`/до создания LLM-клиента: валидация `body.persona` (см. решение 6), результат в `const persona`; (д) `executeTool` (строка 575): `handleToolCall(name, args, cwd, { defaultStatus: resolveDefaultStatus(persona) })` — явный `args.status` внутри `toolCreateTask` по-прежнему приоритетнее (семантика `src/mcp/tools.ts:820` не меняется); (е) в LLM-цикле (~строка 660) `buildSystemPrompt(cwd, lastUserText(history), persona)`. |
| 5 | `src/web/api.ts` | (а) `GET /api/models` (строка 233): в мапу `available` добавить `description: m.description` (undefined, если не задано — JSON-сериализация выкинет ключ; это допустимо по AC1); (б) новый `GET /api/personas` рядом с `/api/models`: `{ personas: listPersonas(cwd).personas, default: 'helper', errors }` — тексты промптов НЕ отдаются (AC13). Добавить строку в шапку-доклист файла (~строка 18). |
| 6 | `src/web/personas.test.mjs` (новый) | Тесты: встроенные 3 роли без секции; переопределение label/prompt дефолтной; добавление проектной роли; невалидная секция (не объект / нет label / нет prompt) → errors + встроенные живы; `allow_tools` не массив / неизвестное имя инструмента → ошибка валидации; невалидный `default_status`; fail-closed при отсутствии шаблона (пустой tmp-cwd без templates + фикстура) и приоритет проектного шаблона из `<cwd>/.vibelog/prompts/personas/`; `resolveDefaultStatus` (helper→Spec, architect→Planned, явный — приоритетнее); `GET /api/personas` через `handleApi` (id/label/description, без текстов промптов). Каталоги — `mkdtempSync` (AGENTS.md). |
| 7 | `src/web/chat.test.mjs` | +кейсы: `persona: 'architect'` → в system-сообщении есть «Текущая роль: Архитектор» и текст `architect.md`; роль влияет на defaultStatus (create без явного статуса при architect → Planned, при helper → Spec, явный status приоритетнее); `persona: 'nope'` → error «Неизвестная роль: nope», jsonl треда не создан/не изменён; `persona` не строка → error; отсутствие `persona` → helper-поведение (Spec); смена роли посреди треда не переписывает историю (AC17). Фикстуры ролей — писать `templates/prompts/personas/*.md` в tmp-cwd через `.vibelog/prompts/personas/` (без записи в репо). |
| 8 | `src/core/models.test.mjs`, `src/web/models-api.test.mjs` | +тест: `description` читается `loadModels` и отдаётся `GET /api/models`; отсутствие поля не ломает текущие ожидания (ключ отсутствует/undefined). |
| 9 | `web/src/components/settings/api.ts` | `ModelInfo` += `description?: string`; новый `PersonaInfo {id,label,description?}`, `PersonasData {personas, default, errors?}`, `fetchPersonas()`. |
| 10 | `web/src/components/chat/pickers.tsx` (новый) | `ModelPicker` и `PersonaPicker` по образцу ref-22 (`apps/docs/components/pages/examples/perplexity.tsx:219-294`): `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent` (`web/src/components/ui/dropdown-menu.tsx`), ghost-кнопка h-8 с названием + `ChevronDownIcon`, `CheckIcon` у выбранного, name + description во второй строке, `min-w-60` (≈240px). ModelPicker: `align="end"`, данные `fetchModels()` (берём `data.default` как текущее значение, onChange → `setActiveModelId`); при недоступности API — тихий fallback, компонент не рендерится. PersonaPicker: `align="start"`, иконка роли (`Sparkles`/`Bot`/`Network`/`Telescope`/`ScanSearch` из lucide — проверить наличие, lesson-15), onChange → `setActivePersonaId`. |
| 11 | `web/src/components/chat/chat-runtime.tsx` | Рядом с `activeModelId` (строка 110): `let activePersonaId: string = "helper"` (дефолт всегда helper, БЕЗ localStorage — AC14) + `setActivePersonaId(id)`. В тело запроса нового хода (~строка 312): `persona: activePersonaId` (всегда, не только при отличии). |
| 12 | `web/src/components/chat/thread.tsx` | `Composer` (строки 417-448): в `ComposerPrimitive.Root` добавить нижнюю строку `flex items-center justify-between gap-1` — слева `<PersonaPicker />`, справа `flex items-center gap-1` с `<ModelPicker />` и блоком Send/Cancel (существующий `div.relative.size-8` переносится туда). Input остаётся первой строкой (`flex-1`). Второй композер (EmptyState) переиспользует тот же `Composer` — дубля нет. Не трогать `useCtrlEnterNewline` (lesson-111). |
| 13 | `web/src/components/chat/thread-sidebar.tsx` | Удалить `ModelSwitcher` (строки 54-99), импорты `Select*`/`fetchModels`/`ModelsData`/`setActiveModelId`, и рендер `<ModelSwitcher />` с обёрткой (строки 210-223). Сайдбар больше не содержит селект модели (AC3). |
| 14 | `.vibelog/settings.json` (gitignored) + `.vibelog/prompts/personas/{researcher,auditor}.md` | Пример секции `chat_personas` с ролями `researcher` («Ресёрчер») и `auditor` («Аудитор»), `default_status: Spec`. **Важно:** `.vibelog/` в `.gitignore` (строка 9) — файлы не коммитятся; тот же пример продублировать в README, а Code-фазе применить секцию к `<repo>/.vibelog/settings.json` (main repo, VIBELOG_CWD направлен туда) и зафиксировать путь в отчёте. |
| 15 | `templates/prompts/chat-system.md` | В конец — 2-3 строки: «Далее в системном промпте идёт блок роли (chat_personas): он уточняет стиль и приоритеты, но НЕ отменяет правила доступа и границы проекта, описанные выше». |
| 16 | `README.md` | Секция веб-чата: описание пикеров в композере (модель + роль), схема `chat_personas` (поля `label`/`description`/`prompt`/`allow_tools`/`default_status`), каталоги промптов `.vibelog/prompts/personas/<id>.md` → `templates/prompts/personas/<id>.md`, fail-closed, «allow_tools читается, фильтрация — отдельная задача», пример researcher/auditor. |
| 17 | `scripts/npm-smoke.mjs` | Добавить `check('шаблоны ролей chat_personas в пакете', ['helper','architect','orchestrator'].every(p => existsSync(join(pkg,'templates','prompts','personas', p + '.md'))))` рядом со строкой 164. |

## Порядок действий

1. `src/core/models.ts` (+`description`) → тест в `models.test.mjs` → `GET /api/models` в `api.ts` → тест в `models-api.test.mjs`; `web/src/components/settings/api.ts` (`ModelInfo.description`). `pnpm build`.
2. Новый `src/web/personas.ts` + `templates/prompts/personas/{helper,architect,orchestrator}.md` + `src/web/personas.test.mjs`.
3. `src/web/chat.ts`: `persona` в теле → валидация → блок в `buildSystemPrompt` → `defaultStatus` из роли; дополнения в `chat.test.mjs`.
4. `GET /api/personas` в `src/web/api.ts` + тест.
5. Клиент: `pickers.tsx`, `chat-runtime.tsx` (`activePersonaId` + `body.persona`), `thread.tsx` (нижняя строка композера), удаление `ModelSwitcher` из `thread-sidebar.tsx`.
6. Секция `chat_personas` + проектные промпты в `.vibelog/` (локально, gitignored) и в README.
7. Документация: `chat-system.md`, README, `npm-smoke.mjs`.
8. Проверки (см. ниже).

## Как проверить

```bash
pnpm build && pnpm test          # полный прогон обязателен для DoD
cd web && npm install && npm run build && npm run lint   # lesson-6: install в worktree обязателен
node scripts/npm-smoke.mjs       # шаблоны ролей в tarball
```

Ручная/браузерная проверка (`vibelog browser` + chrome-devtools): оба пикера в нижней строке композера, в сайдбаре селекта модели нет; смена роли не сбрасывает модель; перезагрузка страницы → активна «Помощник»; при `#/chat` в консоли нет ошибок (`list_console_messages`). Клик по Radix-контролу — полной pointer-последовательностью (lesson-71), без скриншотов (VL-178).

## Риски

- **`.vibelog/` в `.gitignore`**: пример секции `chat_personas` и проектные промпты не попадут в коммит — в README обязателен копируемый YAML/JSON-пример, а Code-фаза применяет их локально к main repo (иначе AC5 «5 ролей в пикере» не подтвердить в worktree; проверить с `VIBELOG_CWD` на main repo).
- **Fail-closed на промпт роли**: если проект задал роль в `chat_personas`, но не положил `<prompt>.md`, каждый ход падает ошибкой — так задумано (AC6); в тексте ошибки указать оба пути и id роли.
- **Дословные тексты ошибок/поведение `chat.test.mjs`**: 731 строка тестов матчит текущие тексты (Spec-дефолт, VIBELOG_LLM_*); вставки делать только аддитивно.
- **Порядок блоков промпта**: контекст globalSearch должен остаться последним (он рантаймовый); блок роли — строго между общей частью и контекстом.
- **`allow_tools` не фильтрует** — риск ожиданий пользователя: явно оговорить в README и в отчёте (AC10, «шов»).
- **Вёрстка композера**: два ряда в `ComposerPrimitive.Root` не должны ломать `lesson-112`-инвариант (`documentElement.scrollHeight === clientHeight`) и Enter/Ctrl+Enter (`lesson-111`).
- **lucide-иконки**: проверить наличие (`lesson-15`), иначе сборка web падает.
- Отсутствие UI-редактора ролей (Q1) — не ошибка, вне скоупа.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 20:06
---
Фаза 2 (Plan) выполнена. Тип: task (обычная задача, не epic). План записан в Implementation Plan.
Что изучено: `src/core/models.ts` (ModelConfig/loadModels — место для `description`), `src/web/tool-policy.ts` (схема резолвера `loadChatSystemTemplate` и `CHAT_DISALLOWED_TOOLS` — эталон для нового `src/web/personas.ts`), `src/web/chat.ts` (ChatRequestBody ~47, buildSystemPrompt 366, produce 483, executeTool 575 `defaultStatus: 'Spec'`, валидация body.model), `src/web/api.ts` (GET /api/models 233), `web/src/components/chat/thread-sidebar.tsx` (ModelSwitcher 54-99 + рендер 220), `web/src/components/chat/thread.tsx` (Composer 417-448), `web/src/components/chat/chat-runtime.tsx` (activeModelId 110, body 312), `web/src/components/settings/api.ts` (ModelInfo), `templates/prompts/chat-system.md`, ref-22 (`backlog/references/data/assistant-ui/apps/docs/components/pages/examples/perplexity.tsx`: ModelPicker 262-294, SearchModePicker 219-252).
Ключевые решения: (1) новый `src/web/personas.ts` — встроенные helper/architect/orchestrator + слияние с `settings.json.chat_personas`, терпимая валидация со списком `errors` (не падение); (2) промпт роли — резолвер по схеме chat-system (`<cwd>/.vibelog/prompts/personas/<prompt>.md` → `templates/prompts/personas/<prompt>.md`, fail-closed); (3) `allow_tools` — только шов (поле, чтение, валидация имён через `listTools()` + локальные, без фильтрации); (4) порядок промпта: общая часть → блок роли → globalSearch-контекст (последним, он рантаймовый); (5) `persona` валидируется в `produce` до чтения истории — неизвестный id даёт error и ход не начинается; (6) `defaultStatus` берётся из роли через `resolveDefaultStatus`, явный `args.status` приоритетнее (семантика `src/mcp/tools.ts:820` не меняется); (7) роль и модель независимы, `activePersonaId` всегда стартует с 'helper' без localStorage.
Объём: 17 позиций (5 новых файлов: `src/web/personas.ts`, `src/web/personas.test.mjs`, `web/src/components/chat/pickers.tsx`, 3 шаблона `templates/prompts/personas/*.md`; правки: models.ts, chat.ts, api.ts, chat.test.mjs, models.test.mjs, models-api.test.mjs, web settings/api.ts, chat-runtime.tsx, thread.tsx, thread-sidebar.tsx, chat-system.md, README.md, npm-smoke.mjs, `.vibelog/settings.json` + проектные промпты).
Риски: `.vibelog/` в `.gitignore` — пример секции `chat_personas` и проектные промпты не коммитятся, в README обязателен копируемый пример, а Code-фазе ставить их локально в main repo (иначе AC5 «5 ролей в пикере» не подтвердить в worktree); fail-closed промпта роли (нужны оба пути в тексте ошибки); 731 строка `chat.test.mjs` матчит текущие тексты — вставки только аддитивные; вёрстка двухрядного композера не должна нарушать lesson-111/lesson-112; проверка наличия lucide-иконок (lesson-15). Проверки для Code: `pnpm build && pnpm test` (полный), `cd web && npm install && npm run build && npm run lint` (lesson-6), `node scripts/npm-smoke.mjs`, браузерная проверка пикеров без скриншотов (VL-178, lesson-71).
---
author: @agent
created: 2026-10-30 20:21
---
Фаза code не удалась (код выхода 1): models.ts×2, payload последнего запроса=613329 байт (макс 613329), usage={"input_tokens":9874306,"output_tokens":27692,"cache_read_input_tokens":9799168,"total_tokens":9901998,"reasoning_tokens":1907} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-30 20:39
---
Фаза 3 (Code) выполнена. Коммит df3e92a (24 файла).
Что сделано:
1. `src/core/models.ts` — `ModelConfig.description?` + чтение в `loadModels`; `GET /api/models` отдаёт `description`, если задано (ключа нет при отсутствии); `ModelInfo.description?` в `web/src/components/settings/api.ts`.
2. `src/web/personas.ts` (новый, 296 строк) — реестр ролей: `BUILTIN_PERSONAS` (helper/architect/orchestrator), слияние с `settings.json.chat_personas` по id (переопределение + добавление проектных в конец), терпимая валидация с накоплением `errors` (`label`/`prompt` обязательны; `allow_tools` — массив известных имён: `listTools()` + read_file/write_file/search_files; `default_status` — должен быть в `statuses` backlog/config.yml), `resolvePersona`, `listPersonas` (сводки без промптов), `resolveDefaultStatus`, `loadPersonaPrompt` (fail-closed: `<cwd>/.vibelog/prompts/personas/<prompt>.md` → `templates/prompts/personas/<prompt>.md`, ошибка с id роли и обоими путями). `allow_tools` — только шов (не фильтрует).
3. `templates/prompts/personas/{helper,architect,orchestrator}.md` — только роль-специфика (общие правила не дублируются); orchestrator явно оговаривает недоступность инструментов фаз.
4. `src/web/chat.ts` — `ChatRequestBody.persona`, валидация ДО чтения истории (неизвестный id → `error` «Неизвестная роль: <id>», LLM не вызывается, jsonl не создаётся; отсутствие → helper; не строка → «Некорректная роль…»), `buildSystemPrompt(cwd, lastUser, persona)` = общая часть + `## Текущая роль: <label>` + текст роли + контекст globalSearch последним, `executeTool` использует `resolveDefaultStatus(activePersona)` (явный `args.status` по-прежнему приоритетнее).
5. `GET /api/personas` — `{personas:[{id,label,description}], default:'helper', errors}` без текстов промптов.
6. Клиент: `web/src/components/chat/pickers.tsx` — `ModelPicker` (align=end, ghost-кнопка + ChevronDownIcon, галочка, description второй строкой, min-w-60) и `PersonaPicker` (align=start, иконка роли + название + ChevronDownIcon); `chat-runtime.tsx` — module-state `activePersonaId` (дефолт 'helper', без localStorage) + `body.persona` в каждом ходе; `thread.tsx` — композер двумя рядами: ввод сверху, снизу PersonaPicker слева + ModelPicker и Send справа; из `thread-sidebar.tsx` удалены `ModelSwitcher`, импорты Select/fetchModels/setActiveModelId и обёртка рендера.
7. `.vibelog/settings.json` — секция `chat_personas` с researcher/auditor + промпты в `.vibelog/prompts/personas/`; применено и к worktree, и к main repo (`VIBELOG_CWD`), т.к. `.vibelog/` в .gitignore (пример продублирован в README).
8. Тесты: новый `src/web/personas.test.mjs` (17 тестов), +7 в `src/web/chat.test.mjs` (блок роли в промпте, проектный промпт, defaultStatus architect→Planned/helper→Spec, приоритет явного status, неизвестная/нестроковая persona, смена роли посреди треда), +1 в `src/core/models.test.mjs`, +1 в `src/web/models-api.test.mjs`.
9. Документация: README (пикеры у инпута + секция «Роли ассистента (chat_personas)» со схемой и примером), `templates/prompts/chat-system.md` (правило приоритета общей части над блоком роли), `scripts/npm-smoke.mjs` (3 проверки шаблонов ролей в tarball).
Проверки:
- `pnpm build` — OK.
- Полный `pnpm test` (102 файла + static) — 1878 passed, 4 skipped, 0 failed. Прогон запускался как `env -u VIBELOG_RUN_PHASE -u VIBELOG_PHASE_NAME -u VIBELOG_CWD pnpm test`: без этого унаследованный `VIBELOG_RUN_PHASE=plan` из окружения агента подменяет фазу в `src/mcp/server.test.mjs:851` (тест токенов VL-198) — падение среды, а не регрессия (проверено: на коде без моих правок тест падает так же; с очищенным env проходит).
- `web: npm run build` и `npm run lint` — OK (lint-замечание react-hooks/static-components исправлено через компонент `PersonaIcon`).
- `node scripts/npm-smoke.mjs` — 30/30 PASS, включая три новых шаблона ролей.
- Браузерная проверка (`vibelog browser`, chrome-devtools, без скриншотов): оба пикера в нижней строке композера, дропдауны по 240px, 5 ролей (Помощник/Архитектор/Оркестратор/Ресёрчер/Аудитор) с описаниями и галочкой; в сайдбаре селекта модели нет; смена роли не сбрасывает модель (mimo → модель сохранилась); после reload активна «Помощник»; `documentElement.scrollHeight === clientHeight`; консоль без ошибок/warn.
Вне скоупа (как согласовано): фильтрация инструментов по `allow_tools`, UI-редактор ролей, реальная оркестрация фаз — отдельные задачи.
---
author: @agent
created: 2026-10-30 20:44
---
Фаза Close выполнена. Ветка vb/vl-265 слита в master (1 коммит df3e92a, merge 1c98fdd), worktree .vibelog/worktrees/vl-265 удалена (force — внутри были только untracked-симлинки node_modules/refs), ветка vb/vl-265 удалена.
Проверки после merge (главный репо):
- `pnpm build` — OK.
- Ранний точечный фильтр по diff merge: `src/core/models.test.mjs`, `src/web/models-api.test.mjs`, `src/web/personas.test.mjs`, `src/web/chat.test.mjs` — 80 passed.
- Полный `pnpm test` (102 файла + static-набор) — 1878 passed, 4 skipped, 0 failed. Прогон запускался как `env -u VIBELOG_RUN_PHASE -u VIBELOG_PHASE_NAME -u VIBELOG_CWD pnpm test`: унаследованный из окружения агента `VIBELOG_RUN_PHASE` подменяет фазу в `src/mcp/server.test.mjs` (тест токенов VL-198) — падение среды, не регрессия (lesson-113).
DoD: все 3 пункта выполнены — тесты проходят (полный прогон зелёный), документация обновлена (README, `templates/prompts/chat-system.md`, `scripts/npm-smoke.mjs` в фазе Code; CHANGELOG записью VL-265 в этой фазе, коммит 4dac284), регрессий нет.
Lessons: создан lesson-117 (дефолты реестра в коде + терпимое слияние с конфигом, errors в ответе API), обновлён lesson-113 (linked VL-265); связь зафиксирована в задаче. Коммиты: 26b271f (refs/lessons), 4dac284 (docs+CHANGELOG).
---
<!-- COMMENTS:END -->