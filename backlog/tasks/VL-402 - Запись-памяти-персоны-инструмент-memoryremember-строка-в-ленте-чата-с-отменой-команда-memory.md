---
id: VL-402
title: 'Запись памяти персоны: инструмент memory_remember, строка в ленте чата с отменой, команда /memory'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-10 10:59'
updated_date: '2026-11-16 16:02'
due_date: ''
labels: []
dependencies:
  - VL-401
milestone: v1.14
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/persona-memory.ts
  - src/core/tool-classify.ts
  - src/web/chat-memory.ts
  - src/web/chat-memory.test.mjs
  - src/web/tool-policy.ts
  - src/web/chat.ts
  - src/web/api.ts
  - src/web/chat-commands.ts
  - src/web/chat-commands.test.mjs
  - src/web/personas.ts
  - templates/prompts/chat-system.md
  - web/src/components/chat/memory-card.tsx
  - web/src/components/chat/chat-runtime.tsx
  - web/src/components/chat/thread.tsx
  - web/src/lib/chat-threads.ts
lessons:
  - lesson-256
token_usage:
  input: 12631384
  output: 98982
  cache: 12349952
  total: 12730366
  requests: 162
  duration_ms: 2572026
  reasoning: 56398
  by_phase:
    code:
      input: 10245772
      output: 86708
      cache: 10014720
      requests: 114
    close:
      input: 2385612
      output: 12274
      cache: 2335232
      requests: 48
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст (обсуждение roadmap 2026-11-09, пункт «Agent memory» → память персоны).

VL-401 даёт чтение памяти: файл `.vibelog/prompts/personas/<prompt>.memory.md` подставляется в системный промпт веб-чата блоком `## Память персоны`. Но заполнять его пока можно только руками. Эта задача — запись.

Ключевое решение из обсуждения: у чата нет «конца», где можно вызвать инструмент (в отличие от фазы Close). Поэтому запись происходит **в процессе**, но не молча: пользователь жаловался, что Qwen auto-memory «неконтролируем» — запомнило непонятно что, и обнаруживается это через месяц. Компромисс: запись применяется сразу (не блокирует разговор карточкой Allow/Deny), но видна в ленте как событие с кнопкой «Убрать».

Второй канал — явная команда `/memory`: пользователь сам решает, что разговор был содержательным, и просит обновить память по сессии. Это же способ дозаписать то, что модель по ходу не заметила.

Формат записи — список строк с датой в конце: `- Не использовать англицизмы без перевода. (2026-11-10)`.

Зависимость: VL-401 (чтение памяти, лимит `persona_memory.max_chars`, `loadPersonaMemory`). Без неё писать некуда.

Связанные: VL-401, VL-314 (реестр слэш-команд), VL-330 (`ask_user` — образец инструмента, которого нет в headless), VL-219 (классификация read/write).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Инструмент `memory_remember {text}` доступен модели только в веб-чате (в headless-фазах и TUI его нет — как `ask_user`, VL-330); аргумент валидируется: пустой текст, текст длиннее лимита, дубль существующей записи → понятная ошибка tool-результатом, файл не меняется
- [x] #2 Запись применяется сразу (не блокирует разговор), но в ленте чата появляется событие `memory` с текстом записи и кнопкой «Убрать»; нажатие удаляет строку из файла и помечает событие отменённым
- [x] #3 Формат записи — `- <текст>. (YYYY-MM-DD)`; при превышении `persona_memory.max_chars` запись НЕ добавляется, модель получает ошибку с текущим размером и лимитом (не молчаливая обрезка)
- [x] #4 Команда `/memory` в реестре слэш-команд: без аргументов — показать текущую память персоны и её размер; `/memory add <текст>` — добавить; `/memory remove <N>` — удалить запись по номеру; `/memory clear` — очистить с подтверждением
- [x] #5 `/memory` работает и в approval-паузе, и во время стриминга — либо явно отказывает с причиной (решение зафиксировать в плане; по умолчанию — отказ, как у остальных команд VL-314)
- [x] #6 Память пишется только в файл текущей персоны треда; смена персоны в пикере не даёт писать в чужую память
- [x] #7 Тесты: валидация аргументов, запись и отмена, лимит, `/memory` все подкоманды, отсутствие инструмента в headless-режиме, изоляция по персонам
- [x] #8 Документация: doc-6 (память персоны — запись и команда), doc-8 (инструмент `memory_remember`), CHANGELOG
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## ВАЖНО: сверить с кодом после VL-401

VL-401 меняет `src/web/personas.ts` (добавляет `loadPersonaMemory`, `readPersonaMemoryLimit`, `PERSONA_MEMORY_SUFFIX`, `PERSONA_MEMORY_DEFAULT_MAX_CHARS`) и `src/web/chat.ts` (блок `## Память персоны` в `buildSystemPrompt`). Номера строк ниже — по состоянию ДО VL-401. Перед реализацией: `git log --oneline -5` + прочитать актуальные `src/web/personas.ts` и `src/web/chat.ts`, затем уточнить места правок. Не полагаться на номера строк из этого плана.

## Проверено по коду (состояние до VL-401)

| Утверждение | Где видно |
|---|---|
| Реестр слэш-команд: `ChatCommand {name, description, usage, examples?, run?}`, точка перехвата — `produce()` в `src/web/chat.ts` до `history.push` | `src/web/chat-commands.ts:1-60`, `src/web/chat.ts` (`produce`) |
| Команды не исполняются во время стриминга и в approval-паузе (проверка в `chat.ts`) | `src/web/chat-commands.ts` (шапка), `src/web/chat.ts` |
| `ask_user` — образец инструмента, доступного только в веб-чате: категория `interactive` в классификаторе, сервер не исполняет, пауза + resume | `src/core/tool-classify.ts` (`isInteractiveTool`), `src/web/chat.ts` (`pauseOnToolCall`), `src/web/chat-question.ts` |
| `chatToolDefs()` собирает инструменты модели: MCP-реестр минус `CHAT_DISALLOWED_TOOLS` + локальные | `src/web/tool-policy.ts` (`chatToolDefs`, `CHAT_DISALLOWED_TOOLS`) |
| `isWriteOperation` — классификация по маркерам имени, неизвестное → write (fail-safe) | `src/core/tool-classify.ts` |
| События SSE чата: `text`, `done`, `error`, `question`, `pricing` — клиент рендерит по типу | `src/web/chat.ts` (`ChatEvent`), `web/src/components/chat/thread.tsx` |
| Память персоны: путь, лимит, формат — из VL-401 | `src/web/personas.ts` (после VL-401) |

## Шаги

1. **Ядро записи — `src/core/persona-memory.ts`** (новый модуль, без HTTP и без LLM, по образцу `src/core/lesson.ts`):
   - `readMemoryEntries(cwd, persona): { entries: {index, text, date, raw}[], chars, limit }` — парсит файл построчно; строка, не начинающаяся с `- `, считается продолжением предыдущей записи (многострочные записи допустимы).
   - `appendMemoryEntry(cwd, persona, text): {ok, chars, limit} | {ok: false, reason}` — валидация: пустой текст, дубль (нормализованное сравнение без даты), превышение лимита → отказ с причиной. Формат строки: `- <text>. (YYYY-MM-DD)`; точку в конце не дублировать, если текст уже кончается на `.`/`!`/`?`.
   - `removeMemoryEntry(cwd, persona, index)` — удаление по номеру (1-based, как в `/memory`), с перенумерацией.
   - `clearMemory(cwd, persona)`.
   - Все операции — read-modify-write файла целиком (файл маленький, ≤ лимита), атомарно через temp+rename (паттерн `writeJsonAtomic` из `src/core/components-config.ts`).

2. **Инструмент `memory_remember`** — `src/web/tool-policy.ts`:
   - `ToolDef` + handler, добавляется в `chatToolDefs()` **только для веб-чата** (как `ask_user`): в headless-фазах и TUI его нет.
   - Классификация: **не** write (иначе карточка Allow/Deny на каждую запись — разговор превращается в тыканье). Новая категория или явное исключение в `isWriteOperation` — решение зафиксировать в коде комментарием со ссылкой на эту задачу. Обоснование: запись обратима (кнопка «Убрать»), в отличие от `write_file`.
   - Handler получает `persona` из контекста хода (не из аргументов модели — модель не должна выбирать, в чью память писать).

3. **Событие `memory` в SSE** — `src/web/chat.ts`:
   - После успешной записи — событие `{type: 'memory', entry: {index, text, date}, personaId}`.
   - Клиент (`web/src/components/chat/thread.tsx`): строка «Запомнил: <текст>» с кнопкой «Убрать» → `POST /api/chat/threads/:id/memory/remove {index}` (новый роут) → удаление + пометка события отменённым.
   - Восстановление при F5: событие живёт в jsonl треда (как `question`), поэтому после перезагрузки строка снова видна; если запись уже удалена — кнопка неактивна.

4. **Команда `/memory`** — `src/web/chat-commands.ts`:
   - `/memory` — показать записи с номерами, размер и лимит.
   - `/memory add <текст>` — добавить (та же валидация, что у инструмента).
   - `/memory remove <N>` — удалить по номеру.
   - `/memory clear` — очистить (требует `/memory clear yes` — двухшаговое подтверждение, чтобы не стереть случайно).
   - Во время стриминга и в approval-паузе — отказ с причиной (как остальные команды VL-314).

5. **Изоляция по персонам.** Память пишется только в файл персоны текущего хода. Смена персоны в пикере меняет целевой файл следующего хода; уже записанное остаётся в файле прежней персоны.

6. **Промпт.** В `templates/prompts/chat-system.md` — короткая инструкция: «когда пользователь поправляет тебя в том, что касается стиля общения или его предпочтений (а не кода проекта), вызови `memory_remember`; не записывай то, что относится к коду проекта — для этого есть lessons». Без этого правила модель либо не будет писать, либо будет писать всё подряд.

## Как проверить

- `pnpm build && pnpm test` (полный прогон).
- Ручной кейс: в веб-чате сказать «не пиши англицизмами» → модель вызывает `memory_remember` → в ленте строка «Запомнил: …» → открыть новый тред → поправка действует (блок памяти в промпте).
- Отмена: нажать «Убрать» → строка исчезла из файла, в новом треде поправки нет.
- `/memory` в новом треде → список записей с номерами и размером.
- Лимит: заполнить память до `max_chars` → следующая запись отклоняется с понятной ошибкой, файл не меняется.
- Headless: `vibelog agent` (TUI) и фаза — инструмента `memory_remember` в списке нет.

## Риски

- **Модель пишет мусор.** Главный риск: «запомнил, что пользователь спросил про X». Митигация — правило в промпте (шаг 6) + видимость в ленте + лимит. Если после обкатки мусора много — добавить второй фильтр: запись применяется, но помечается «предложено» и попадает в промпт только после явного `/memory accept`.
- **Классификация read/write.** Если `memory_remember` попадёт в write, каждая запись потребует Allow/Deny — это убьёт затею. Если в read — потеряется контроль. Решение (не write, но с отменой) надо явно закрепить тестом, иначе следующая правка классификатора всё сломает.
- **Гонка двух вкладок.** Два хода в разных вкладках пишут в один файл — read-modify-write может потерять запись. Митигация: атомарная запись + повторное чтение перед записью; полноценный lock не нужен (конфликт редок, потеря одной записи не катастрофа).
- **Совместимость с VL-401.** Если VL-401 ещё не смержена — эта задача не стартует. Зависимость проставлена.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 11:16
---
Фаза code не удалась (код выхода 1): окировок=0, payload последнего запроса=427362 байт (макс 427362), usage={"input_tokens":1773190,"output_tokens":27527,"cache_read_input_tokens":1696768,"total_tokens":1800717,"reasoning_tokens":17338} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-10 11:19
---
Фаза code не удалась (код выхода 1): т, блокировок=0, payload последнего запроса=266095 байт (макс 266095), usage={"input_tokens":538753,"output_tokens":2094,"cache_read_input_tokens":508416,"total_tokens":540847,"reasoning_tokens":1111} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-10 11:40
---
Фаза 3 (Code) выполнена. Коммит af60fbc.
Что сделано:
- `src/core/persona-memory.ts` (новый) — ядро записи: `readMemoryEntries` (парсинг построчно, многострочные записи, preamble сохраняется), `appendMemoryEntry` (формат `- <текст>. (YYYY-MM-DD)`, точка не дублируется; отказы: пустой текст, дубль по нормализованному сравнению, превышение `persona_memory.max_chars` с текущим размером и лимитом — файл не меняется), `removeMemoryEntry` (1-based, перенумерация), `clearMemory`; read-modify-write целиком, атомарно temp+rename. Сюда же переехали `PROJECT_PERSONAS_DIR`/`PERSONA_MEMORY_SUFFIX`/`PERSONA_MEMORY_DEFAULT_MAX_CHARS`/`readPersonaMemoryLimit` (реэкспорт из `src/web/personas.ts` сохранён — публичный API не изменился, копий логики нет).
- `src/web/chat-memory.ts` (новый) — `makeMemoryRememberTool` (ToolDef+handler, роль приходит параметром, а не из аргументов модели), `runMemoryCommand` (`/memory`, `add`, `remove <N>`, `clear` + `clear yes`), `removeMemoryByEvent` (удаление по тексту, номер — фолбэк: номера сдвигаются), sidecar `<threadId>.memory.json` с отменёнными записями.
- `src/web/tool-policy.ts` — `chatToolDefs(cwd, persona?)`: `memory_remember` добавляется только при известной роли (в headless/TUI его нет — в MCP-реестре имени нет).
- `src/core/tool-classify.ts` — `REVERSIBLE_WRITE_TOOLS` (`memory_remember` не write: запись обратима кнопкой «Убрать»); решение закреплено тестом.
- `src/web/chat.ts` — событие `memory` в `ChatEvent`, публикуется в `executeTool` (единая точка: обычный цикл, resume, advanceToNextApproval), `chatToolDefs(cwd, activePersona)`, `/memory` в `runChatCommand` (до проверки настроек сжатия), `persona` в `CommandDeps`.
- `src/web/api.ts` — `POST /api/chat/threads/:id/memory/remove` (роль из треда, AC6) и `memoryRemovals` в ответе истории треда (после F5 кнопка неактивна).
- `src/web/chat-commands.ts` — команда `memory` в реестре (справка `/help` и `GET /api/chat/commands` собираются из реестра).
- Фронт: `web/src/components/chat/memory-card.tsx` (строка «Запомнил: …» + «Убрать»), событие `memory` → data-часть `chat-memory` в `chat-runtime.tsx`, восстановление карточки из jsonl в `chat-threads.ts`, рендер в `thread.tsx`, module-state отмен `setMemoryRemovals`/`isMemoryRemoved`.
- `templates/prompts/chat-system.md` — правило: когда вызывать `memory_remember` и что в память не писать (код проекта → lessons, разовые факты — нет).
Проверки: `pnpm build` — ок; `pnpm typecheck` (корень и `web/`) — ок; полный `pnpm test` — 212 файлов, 4115 тестов passed, 4 skipped (пропуски — штатные `it.skip` в существующих файлах, не связаны с задачей); новых тестов 24 в `src/web/chat-memory.test.mjs` (валидация, формат, лимит, событие memory, отмена, все подкоманды `/memory`, отказ в approval-паузе, изоляция по персонам, отсутствие инструмента в MCP-реестре).
Что осталось (не входит в Code): AC8 — документация doc-6/doc-8 и CHANGELOG пишет фаза Close после слияния (в Code правка docs/CHANGELOG запрещена).
---
author: @agent
created: 2026-11-10 11:57
---
Фаза Close выполнена. Ветка vb/vl-402 слита в master (1 коммит af60fbc, merge 7658872), worktree удалена (force — только untracked backlog/references/data от оркестратора), ветка vb/vl-402 удалена.
Проверки после merge: `pnpm build` — ок. Ранний точечный фильтр (chat-memory, chat-commands, personas, tool-classify) — 101 тест passed. Полный `npx vitest run` — первый прогон дал 1 падение (src/core/report.test.mjs, тест «пишет report.md в каталог рана»), второй прогон — 213 файлов, 4123 passed, 4 skipped. Классификация: падение не связано с diff'ом VL-402 — файл не импортирует изменённые модули, изолированно и вместе с orchestrator.test.mjs зелёный, параллельного vitest в других worktree не было (ps aux пуст); в первом прогоне падал другой тайминг-зависимый тест (orchestrator.test.mjs:1378, spawn git + waitDone 6 с) — признак флейка нагрузки, а не регрессии. Причина повтора зафиксирована; урок дополнен (lesson-256).
Документация (AC8, DoD2): CHANGELOG.md — запись в Unreleased; doc-6 §10 — новый подраздел «Запись памяти: memory_remember и /memory» (инструмент, классификация read/write, валидация, событие memory с отменой, все подкоманды /memory, изоляция по персонам, правило промпта); doc-8 — новый раздел «Инструменты только веб-чата» с memory_remember. Коммит 2fd9139.
DoD: 1 (тесты проходят) — выполнен полным прогоном; 2 (документация обновлена) — выполнен; 3 (нет регрессий) — выполнен. AC8 закрыт документацией.
---
<!-- COMMENTS:END -->