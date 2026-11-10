---
id: VL-409
title: 'Субагенты-персоны: инструмент ask_persona — консультация другой роли из чата (глубина 1, свой allow_tools, настройки стоимости)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-10 15:39'
updated_date: '2026-11-10 16:47'
due_date: ''
labels: []
dependencies:
  - VL-407
milestone: ''
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/subagents.ts
  - src/core/tool-classify.ts
  - src/agent/llm.ts
  - src/web/chat-subagent.ts
  - src/web/chat-subagent-usage.ts
  - src/web/chat-subagent.test.mjs
  - src/web/chat.ts
  - src/web/personas.ts
  - src/web/tool-policy.ts
  - templates/prompts/chat-system.md
  - web/src/components/chat/chat-runtime.tsx
  - web/src/components/chat/thread.tsx
  - web/src/components/chat/tool-meta.ts
  - web/src/components/chat/subagent-card.tsx
  - web/src/components/personas/persona-detail.tsx
lessons:
  - lesson-282
token_usage:
  input: 28593653
  output: 126806
  cache: 28133376
  total: 28720459
  requests: 253
  duration_ms: 2705398
  reasoning: 65102
  by_phase:
    code:
      input: 26203823
      output: 114670
      cache: 25792000
      requests: 210
    close:
      input: 2389830
      output: 12136
      cache: 2341376
      requests: 43
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст (обсуждение 2026-11-10, после реализации памяти персон).

Идея пользователя: субагент — это не роль фазы, а **персона, вызываемая из персоны**. Пример: в проекте ведения личных дел основная роль «Помощник» может позвать «Психолога» или «Бизнес-наставника» для отдельных вопросов.

Почему не роли фаз: специализация фаз уже есть (отдельные шаблоны `templates/phases/*.md` + переопределение проектом), а боль, видимая в CHANGELOG (зацикливания, payload-лимиты, пустые Close), субагенты не лечат. Ценность здесь другая — **разные экспертизы в одном разговоре**.

Выбранный вариант (согласован): **консультация через инструмент**. Помощник вызывает `ask_persona`, сервер делает отдельный запрос к модели с промптом и памятью консультанта, возвращает ответ как результат инструмента. Помощник продолжает разговор, зная мнение консультанта.

Отвергнутые варианты:
- переключение роли внутри треда — ломает VL-283 (роль фиксируется за тредом), смешивает историю и память;
- отдельный тред — пользователь теряет контекст, надо пересказывать.

Оговорки, согласованные с пользователем:
- глубина вложенности 1 (консультант не зовёт консультанта);
- консультант не пишет в свою память;
- у консультанта свой `allow_tools` (по умолчанию только чтение) — стало возможным после VL-407;
- отображение настраивается: раскрываемый вызов инструмента (дефолт) или виджет-карточка;
- стоимость настраивается в settings с дефолтами.

Зависимости: VL-407 (`allow_tools` реально фильтрует — без неё консультант получит право писать файлы), VL-401/VL-402 (память персоны — консультант читает свою), VL-404 (уроки в чате — консультант видит уроки проекта).

Связанные: VL-265 (реестр персон), VL-283 (роль фиксируется за тредом), VL-330 (`ask_user` — образец инструмента только веб-чата), VL-403 (страница «Персоны» — там же настраивать роли-консультанты).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Инструмент `ask_persona {persona, question}` доступен модели только в веб-чате (в headless-фазах и TUI его нет — как `ask_user`/`memory_remember`); `persona` валидируется по реестру, неизвестная роль → понятная ошибка tool-результатом, ход продолжается
- [x] #2 Консультация выполняется отдельным LLM-запросом с системным промптом роли-консультанта (её промпт + её память + её уроки), без истории треда целиком — только переданный вопрос плюс опциональный контекст
- [x] #3 Глубина вложенности 1: роль-консультант НЕ получает инструмент `ask_persona` (иначе лавина запросов и непредсказуемая стоимость)
- [x] #4 Роль-консультант получает инструменты по своему `allow_tools` (VL-407); по умолчанию — только чтение (`read_file`, `search_files`, `backlog_search`, `backlog_view_task`, `project_map`, `lesson_search_lessons`)
- [x] #5 Роль-консультант НЕ пишет в свою память при консультации: `memory_remember` ей не выдаётся, память пишется только когда роль — основная роль треда
- [x] #6 Пользователь видит вызов в ленте как обычный tool-call с раскрытием: вопрос и полный ответ консультанта (переиспользован `ToolCall` из `web/src/components/chat/tool-call.tsx`, подписи в `tool-meta.ts`); режим отображения настраивается (`inline` — раскрываемый вызов, `widget` — карточка как у создания задачи), дефолт `inline`
- [x] #7 Настройки в `.vibelog/settings.json`, секция `subagents`: `enabled` (дефолт true), `display` (`inline`|`widget`, дефолт `inline`), `max_calls_per_turn` (дефолт 2), `max_depth` (дефолт 1, значения >1 отклоняются с сообщением), `timeout_ms` (дефолт 60000), `max_tokens` (дефолт 2000); битые значения → дефолт + сообщение в errors, чат не падает
- [x] #8 При превышении `max_calls_per_turn` следующий вызов получает отказ с причиной и текущим лимитом (не молчаливое игнорирование)
- [x] #9 Таймаут консультации не роняет ход: по истечении модель получает tool-результат «консультант не ответил за N мс», ход продолжается
- [x] #10 Токены консультации учитываются в billing треда с пометкой роли-консультанта (не смешиваются с токенами основного хода)
- [x] #11 Тесты: валидация аргументов, неизвестная роль, глубина 1 (у консультанта нет `ask_persona`), allow_tools консультанта, отсутствие записи в память, лимит вызовов на ход, таймаут, настройки и битые значения, учёт токенов, отсутствие инструмента в headless
- [x] #12 Документация: doc-6 (субагенты-персоны — как настроить и как это выглядит), doc-8 (инструмент `ask_persona`), doc-31 (системный промпт и вложенный запрос), CHANGELOG
- [x] #13 Поведение при отсутствии роли-консультанта настраивается: `subagents.on_missing_persona` = `error` (дефолт) | `skip`; при `error` модель получает tool-результат с ошибкой и списком доступных ролей, при `skip` — нейтральный результат «роль не найдена, отвечай сам» без ошибки в ленте
- [x] #14 Настройка `on_missing_persona` валидируется: неизвестное значение → дефолт `error` + сообщение в errors (не молчаливое приведение)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## ВАЖНО: сверить с кодом после VL-407

VL-407 меняет `chatToolDefs` (фильтрация по `allowTools`) и `executeTool` (отказ вне списка). Номера строк ниже — по состоянию ДО неё. Перед реализацией прочитать актуальные `src/web/tool-policy.ts`, `src/web/chat.ts`, `src/web/personas.ts`.

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `chatToolDefs(cwd, persona)` собирает MCP-реестр + локальные + `ask_user` + `memory_remember` | `src/web/tool-policy.ts:312-330` |
| `executeTool` — единая точка исполнения (обычный цикл, resume, advanceToNextApproval) | `src/web/chat.ts:1513-1545` |
| `localHandlers` — карта локальных инструментов с handler | `src/web/chat.ts:1484-1486` |
| `memory_remember` — образец инструмента только веб-чата: `makeMemoryRememberTool(cwd, persona)`, роль приходит параметром | `src/web/chat-memory.ts:62` |
| `ask_user` — образец интерактивного инструмента: категория `interactive`, сервер не исполняет, пауза | `src/core/tool-classify.ts` (`isInteractiveTool`), `src/web/chat-question.ts` |
| Рендер tool-call с раскрытием Request/Result | `web/src/components/chat/tool-call.tsx` (`ToolCall`), `tool-meta.ts` (`formatRequest`, `formatResult`) |
| Подписи инструментов — таблица `TOOL_LABELS` | `web/src/components/chat/tool-meta.ts` |
| Память роли: `loadPersonaMemory(cwd, persona)` | `src/web/personas.ts` (VL-401) |
| Промпт роли: `loadPersonaPrompt(cwd, persona)` | `src/web/personas.ts` |
| Уроки по тексту: `selectLessonsForText` | `src/core/lesson.ts` (VL-404) |
| `createLlmClient` + `streamChat` — единственный путь к модели | `src/agent/llm.ts`, `src/web/chat.ts:1327` |
| Учёт токенов треда | `src/core/billing.ts`, `src/web/chat.ts` (usage) |
| Реестр ролей: `loadPersonas` / `resolvePersona` | `src/web/personas.ts` |

## Шаги

1. **Ядро — `src/core/subagents.ts`** (новый модуль, без HTTP):
   - `readSubagentSettings(cwd, errors?)` → `{enabled, display, maxCallsPerTurn, maxDepth, timeoutMs, maxTokens, onMissingPersona}` из секции `subagents`; битые значения → дефолт + сообщение (паттерн `readLessonSettings`).
   - `onMissingPersona`: `'error'` (дефолт) | `'skip'`; неизвестное значение → `'error'` + сообщение в `errors` (не молчаливое приведение).
   - `resolveConsultant(cwd, id)` → `PersonaConfig | null`; отказ, если роль не найдена или это та же роль, что основная (сам себя не консультирует).
   - `DEFAULT_CONSULTANT_TOOLS` — список только-чтения: `read_file`, `search_files`, `backlog_search`, `backlog_view_task`, `backlog_list_tasks`, `project_map`, `lesson_search_lessons`, `lesson_view`, `document_view`, `document_list`.

2. **Инструмент — `src/web/chat-subagent.ts`** (новый, по образцу `chat-memory.ts`):
   - `makeAskPersonaTool(deps)` → `ChatLocalTool` с handler.
   - Аргументы: `{persona: string, question: string, context?: string}`. Валидация: пустой вопрос, роль = текущая, превышение `maxCallsPerTurn` → отказ с причиной.
   - **Отсутствующая роль** — по `onMissingPersona`:
     - `error` (дефолт): tool-результат с ошибкой `Роль "<id>" не найдена` + перечень доступных ролей (id + label). Модель видит, что ошиблась, и может выбрать правильную.
     - `skip`: нейтральный результат `Роль "<id>" не найдена — отвечай сам` без пометки ошибки; в ленте вызов не выделяется как неудачный.
   - Handler:
     1. Собирает системный промпт консультанта: `loadPersonaPrompt` + `loadPersonaMemory` + `selectLessonsForText(question)` (блоки как в основном чате, но без `## Текущая роль` — консультант знает, кто он).
     2. Собирает инструменты консультанта: `chatToolDefs(cwd, consultant)` с фильтром по `consultant.allowTools ?? DEFAULT_CONSULTANT_TOOLS`, **минус** `ask_persona` (глубина 1) и **минус** `memory_remember`.
     3. Запускает мини-цикл `streamChat` с `maxTokens` и `timeoutMs` (AbortController). Цикл — до 3 итераций (консультант может прочитать файл и ответить), без вложенных консультаций.
     4. Возвращает текст ответа консультанта как результат инструмента.
   - Таймаут → результат «консультант не ответил за N мс», ход продолжается (не исключение).
   - Токены консультации — в billing треда с пометкой `persona: <id>` (не смешивать с основным ходом).

3. **Регистрация — `src/web/tool-policy.ts`.** В `chatToolDefs` добавить `ask_persona` при условиях: `persona` задана, `subagents.enabled`, роль не является консультантом (глубина 1). Имя — в `LOCAL_CHAT_TOOLS` (`src/web/personas.ts`), чтобы его можно было указать в `allow_tools`.

4. **Классификация — `src/core/tool-classify.ts`.** `ask_persona` — **не write** (как `memory_remember`): консультация не меняет файлы. Добавить в исключения; закрепить тестом, чтобы правка классификатора не сломала.

5. **Событие в ленте — `src/web/chat.ts`.** После успешной консультации публиковать событие `subagent` с `{personaId, personaLabel, question, answer, tokens}`. Клиент рендерит:
   - `display: 'inline'` (дефолт) — обычный tool-call part с раскрытием: вопрос в Request, ответ в Result. Переиспользовать `ToolCall`; добавить подписи в `TOOL_LABELS`: `ask_persona: ["Спросил <роль>", "Спрашиваю <роль>"]`.
   - `display: 'widget'` — карточка по образцу `approval-card.tsx`: заголовок «Консультация: <роль>», вопрос, ответ, свёрнуто/развёрнуто.

6. **Промпт — `templates/prompts/chat-system.md`.** Правило: «когда вопрос выходит за твою экспертизу и в проекте есть подходящая роль — вызови `ask_persona`; не вызывай без нужды, не вызывай одну роль дважды за ход». Без правила модель либо не будет звать, либо будет звать на каждый вопрос.

7. **Страница «Персоны» (VL-403).** В детальной странице роли — подсказка: «эта роль может быть консультантом; её `allow_tools` определяет, что она может делать во время консультации».

## Как проверить

- `pnpm build && pnpm test` + `cd web && npm run build && npm run lint`.
- Ручной кейс: создать роль «Психолог» с промптом и `allow_tools: ["read_file"]`. В чате под Помощником спросить что-то по её теме → Помощник вызывает `ask_persona`, в ленте раскрываемый вызов с вопросом и ответом.
- **Отсутствующая роль, `on_missing_persona: error`** (дефолт): попросить позвать несуществующую роль → tool-результат с ошибкой и списком доступных ролей.
- **Отсутствующая роль, `on_missing_persona: skip`**: тот же вызов → нейтральный результат, модель продолжает отвечать сама, в ленте нет пометки ошибки.
- Глубина 1: в промпте консультанта нет `ask_persona` (проверить в тесте с подменным LLM — переданные `tools` не содержат имени).
- Память: консультация не создаёт записей в `.memory.md` консультанта.
- Лимит: `max_calls_per_turn: 1` → второй вызов за ход получает отказ с причиной.
- Таймаут: `timeout_ms: 100` → результат «не ответил», ход продолжается, в ленте видно.
- Настройки: битые значения в секции `subagents` (включая неизвестный `on_missing_persona`) → дефолты + сообщения в errors, чат работает.
- Headless: `vibelog agent` и фаза — инструмента нет.

## Риски

- **Стоимость.** Каждая консультация — отдельный запрос с полным промптом роли + память + уроки. Митигация: `max_calls_per_turn` (дефолт 2), `max_tokens` (дефолт 2000), учёт в billing с пометкой роли.
- **Модель зовёт консультанта без нужды.** Главный риск качества. Митигация: правило в промпте (шаг 6) + лимит вызовов.
- **Рекурсия.** Глубина 1 обязательна: без неё консультант может позвать консультанта, и стоимость становится непредсказуемой. Проверять тестом, а не только кодом.
- **Консультант пишет в память.** Инструмент не выдаётся (шаг 2.2), но проверить тестом.
- **Зависание.** Консультация — вложенный LLM-запрос внутри хода. Без таймаута зависший провайдер повесит весь ход. `timeoutMs` обязателен, дефолт 60 с.
- **`skip` маскирует опечатку.** При `skip` модель не узнает, что роль названа неверно, и может повторять вызов. Поэтому дефолт — `error`; `skip` выбирается осознанно, когда роли в проекте необязательны.
- **Совместимость с VL-407.** Если VL-407 не смержена, `allow_tools` консультанта не работает — консультант получит полный доступ. Зависимость проставлена.
- **Отображение.** `inline` переиспользует существующий рендер (дёшево), `widget` — новый компонент (дороже). Дефолт `inline`.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 16:17
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/core/subagents.ts
- src/web/chat-subagent.ts
- src/agent/llm.ts
- src/web/tool-policy.ts
- src/web/personas.ts
- src/web/chat.ts
- src/web/chat-subagent-usage.ts
- src/core/tool-classify.ts
- templates/prompts/chat-system.md
- web/src/components/chat/tool-meta.ts
- I'll start by orienting in the project and reading the key files mentioned in the plan.
Now I have enough context. Let me write the core module.
Превышен лимит --max-requests (80) — фаза прервана.
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 1208 с, payload 658756 байт_
Незакоммиченные изменения сохранены в ветку: коммит `7d96c0f`.
---
author: @agent
created: 2026-11-10 16:17
---
Фаза code не удалась (код выхода 1): окировок=1, payload последнего запроса=658756 байт (макс 658756), usage={"input_tokens":9703974,"output_tokens":47789,"cache_read_input_tokens":9554432,"total_tokens":9751763,"reasoning_tokens":28386} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-10 16:38
---
Фаза 3 (Code) выполнена. Коммит 243aabf.
**Новые модули**
- `src/core/subagents.ts` — `readSubagentSettings` (секция `subagents`: enabled/display/max_calls_per_turn/max_depth/timeout_ms/max_tokens/on_missing_persona; битые значения → дефолт + сообщение в errors, `max_depth > 1` отклоняется, неизвестный `on_missing_persona` → `error` + сообщение, не молчаливое приведение), `DEFAULT_CONSULTANT_TOOLS` (только чтение), `ASK_PERSONA_TOOL`.
- `src/web/chat-subagent.ts` — `makeAskPersonaTool(deps)`: валидация аргументов (пустой вопрос, роль = текущая, лимит вызовов), `on_missing_persona` error/skip, промпт консультанта (его промпт + память + уроки по вопросу, без истории треда), инструменты консультанта (`allow_tools` ?? только чтение, минус `ask_persona`, минус `memory_remember`, минус write), мини-цикл до 3 итераций, AbortController-таймаут (результат «не ответил за N мс», ход продолжается).
- `src/web/chat-subagent-usage.ts` — учёт токенов консультаций в sidecar `<threadId>.subagents.json` с пометкой роли (не смешивается с токенами основного хода).
**Правки**
- `src/web/tool-policy.ts` — `ask_persona` в `chatToolDefs` при известной роли и `subagents.enabled`.
- `src/web/personas.ts` — имя в `LOCAL_CHAT_TOOLS` (можно указать в `allow_tools`).
- `src/core/tool-classify.ts` — `ask_persona` не write (закреплено тестом).
- `src/agent/llm.ts` — `StreamChatOptions.maxTokens` (max_tokens / max_output_tokens по режиму API).
- `src/web/chat.ts` — событие `subagent` (с `display`), сборка handler'а, чтение настроек с логом ошибок.
- `templates/prompts/chat-system.md` — правило вызова `ask_persona`.
- Фронт: `tool-meta.ts` (подписи `ask_persona`, `persona` как primary arg, ответ консультанта в Result, не-write в fallback-классификаторе), `chat-runtime.tsx` (событие + `CHAT_SUBAGENT_PART`), `thread.tsx` (рендер карточки), новый `subagent-card.tsx` (режим `widget`), `persona-detail.tsx` (подсказка «роль может быть консультантом»).
**Проверки**
- `pnpm build` — ок.
- `pnpm test` — полный прогон, exit 0, без `--exclude`/`--skip`.
- `cd web && npm run build` — ок; `npx eslint` по изменённым файлам — чисто (общий `npm run lint` падает на предсуществующей ошибке `activity-item.tsx:107`, не связанной с задачей).
**Что осталось**
- AC12 (документация doc-6/doc-8/doc-31/CHANGELOG) — по правилам фазы Code документацию пишет Close после слияния; не отмечен.
- DoD «Документация обновлена» — по той же причине не отмечен.
---
author: @agent
created: 2026-11-10 16:47
---
Фаза Close выполнена. Ветка vb/vl-409 слита в master (2 коммита: 243aabf feat + 7d96c0f wip), merge-коммит без конфликтов, worktree удалена (force — только untracked-симлинк backlog/references/data на главный репо), ветка vb/vl-409 удалена.
**Проверки после merge**
- `pnpm build` — ок (один раз за фазу).
- Ранний точечный фильтр по diff: `src/web/chat-subagent.test.mjs`, `src/core/tool-classify.test.mjs`, `src/agent/llm.test.mjs`, `src/web/personas.test.mjs`, `src/web/tool-policy.test.mjs` — 146 тестов, все зелёные.
- Полный прогон `npx vitest run` — 221 файл, 4252 passed, 4 skipped, exit 0. Без `--exclude`/`--skip`, повторов не было.
**Документация (AC12, DoD2)**
- CHANGELOG.md — запись в Unreleased: VL-409 (субагенты-персоны, `ask_persona`, настройки `subagents`, глубина 1, allow_tools консультанта, учёт токенов, фронт).
- doc-6 §10 — новый подраздел «Субагенты-персоны: консультация другой роли (VL-409)»: как настроить роль-консультанта, инструменты по умолчанию (только чтение), глубина 1, память, что видит консультант, отображение inline/widget, полная секция `subagents`, `on_missing_persona`, таймаут, стоимость, «только веб-чат».
- doc-8 — раздел «Инструменты только веб-чата» дополнен `ask_persona` (таблица параметров, отказы, глубина 1, учёт токенов).
- doc-31 §8 — новый подраздел «Вложенный запрос консультации (VL-409)»: сборка промпта консультанта, инструменты, мини-цикл, таймаут, sidecar токенов, настройки, изоляция от headless.
- Коммит документации: 01996fb.
**Lessons**
- Создан lesson-282 (проверка фронта через `npx eslint` по изменённым файлам: общий `npm run lint` в `web/` красный из-за предсуществующей ошибки `activity-item.tsx:107`), связан с задачей. Коммит: 1a68eaf.
**DoD:** 1 (тесты проходят) — полный прогон зелёный; 2 (документация обновлена) — CHANGELOG + doc-6/doc-8/doc-31; 3 (нет регрессий) — полный прогон без падений, сборка ок. Все три выполнены.
---
<!-- COMMENTS:END -->