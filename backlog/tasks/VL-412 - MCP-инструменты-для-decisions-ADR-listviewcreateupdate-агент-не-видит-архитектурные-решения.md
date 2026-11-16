---
id: VL-412
title: 'MCP-инструменты для decisions (ADR): list/view/create/update — агент не видит архитектурные решения'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-10 17:16'
updated_date: '2026-11-16 16:02'
due_date: ''
labels: []
dependencies: []
milestone: v1.14
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/decision.ts
  - src/core/search.ts
  - src/core/tool-kinds.ts
  - src/mcp/decision-tools.ts
  - src/mcp/decision-tools.test.mjs
  - src/mcp/tools.ts
  - src/mcp/write-ack-contract.test.mjs
  - src/mcp/documents.test.mjs
  - src/mcp/reference-tools.test.mjs
  - src/mcp/server.test.mjs
  - src/core/compat-full.test.mjs
  - src/cli/commands/doctor.ts
  - src/cli/commands/instructions.ts
  - src/cli/diagnostics.test.mjs
  - src/web/chat.ts
lessons:
  - lesson-284
token_usage:
  input: 17260208
  output: 107691
  cache: 16932352
  total: 17367899
  requests: 179
  duration_ms: 1913359
  reasoning: 53189
  by_phase:
    code:
      input: 14829799
      output: 97997
      cache: 14556672
      requests: 134
    close:
      input: 2430409
      output: 9694
      cache: 2375680
      requests: 45
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Пробел, обнаруженный при обсуждении субагентов: в MCP нет ни одного инструмента для работы с decisions (ADR).

Проверено по коду:
- `src/core/decision.ts` — полноценное ядро: `writeDecision`, `listDecisions`, `getDecision`, `DECISION_STATUSES`, ADR-секции (Context/Decision/Consequences/Alternatives), формат `backlog/decisions/<id>-<slug>.md`;
- `src/cli/commands/decision.ts` — CLI `vibelog decision create|list|view`;
- `src/mcp/` — **ни одного упоминания `decision`** (grep по каталогу: 0 совпадений);
- `src/core/search.ts:300` — в комментарии `globalSearch` прямо написано: «Decisions НЕ ищутся (не используются активно)».

Следствие: агент в чате и в фазах не может ни прочитать архитектурные решения проекта, ни зафиксировать новое. При этом в проекте 12 файлов решений, и они содержат ключевые договорённости (стек фронтенда, доставка компонентов, формат реестра). Агент, планируя задачу, эти договорённости не видит — и может предложить отвергнутое.

Побочный дефект, найденный при проверке: в `backlog/decisions/` **два файла с `id: decision-10`**:
- `decision-10-Версионирование-скопированного-кода-хеши-в-manifest-json.md`
- `decision-10-Версионирование-скопированного-кода-хеши-в-installed-lock-json.md`

Второй — устаревшая версия (ROADMAP: «`manifest.json` для lock-файла — отказались в пользу `installed.lock.json`»). `nextDecisionId` берёт max+1, поэтому новые id не ломаются, но `getDecision('decision-10')` вернёт первый попавшийся, а `listDecisions` покажет оба как разные решения.

Связанные: VL-14 (CLI decisions), VL-185 (globalSearch), VL-192 (ROADMAP — там зафиксирован отказ от manifest.json), doc-25 (спецификация UI Kit — decision-6…decision-11).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Новые MCP-инструменты: `decision_list` (read, фильтр по статусу), `decision_view` (read, по id), `decision_create` (write, title + опциональные context/decision/consequences/alternatives/status), `decision_update` (write, точечная правка статуса и/или ADR-секций)
- [x] #2 Инструменты зарегистрированы в реестре `listTools()` и в `TOOL_KINDS` (`src/core/tool-kinds.ts`): list/view → read, create/update → write; счётчик реестра в `doctor` и тестах обновлён
- [x] #3 `decision_create` возвращает JSON-ack по контракту `{ok, applied, skipped}` с id созданного решения; `decision_update` — снимок фактически изменённых полей
- [x] #4 `decision_update` не перезаписывает тело целиком: правка секции — точечная (по имени секции `## Context`/`## Decision`/`## Consequences`/`## Alternatives`), отсутствующая секция добавляется, существующая заменяется целиком только при явной передаче
- [x] #5 Валидация до записи: пустой title, неизвестный id, недопустимый статус (сверка с `DECISION_STATUSES`) → понятная ошибка, файл не меняется
- [x] #6 `globalSearch` включает decisions в результаты (сейчас в `src/core/search.ts` явно написано «Decisions НЕ ищутся»); лимиты групп сохранены, тип результата расширен полем `decisions`
- [x] #7 Дубли id в `backlog/decisions/` (сейчас два файла с `id: decision-10`) обнаруживаются: `decision_list` помечает конфликт, `vibelog doctor` даёт предупреждение; `getDecision` при дубле возвращает первый и сообщает о неоднозначности
- [x] #8 Тесты: CRUD через MCP, точечная правка секций, валидация, дубли id, decisions в globalSearch, счётчик инструментов
- [x] #9 Документация: doc-8 (раздел decisions), doc-7 (если CLI расширяется update), CHANGELOG
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Проверено по коду

| Утверждение | Где видно |
|---|---|
| Ядро decisions: `writeDecision`, `listDecisions`, `getDecision`, `DECISION_STATUSES`, `decisionFilename`, `nextDecisionId` | `src/core/decision.ts` |
| ADR-секции собираются в `buildBody`: `## Context` / `## Decision` / `## Consequences` / `## Alternatives` | `src/core/decision.ts` (`buildBody`) |
| Формат файла: `backlog/decisions/<id>-<slug>.md`, фронтматтер `id/title/date/status` | `src/core/decision.ts` (шапка), `src/core/paths.ts:107` (`decisionsDir`) |
| CLI: `create` / `list` / `view`, статусы из `DECISION_STATUSES` | `src/cli/commands/decision.ts`, `src/cli/router.ts:165` |
| В `src/mcp/` нет ни одного упоминания `decision` | grep по каталогу — 0 совпадений |
| `globalSearch` явно исключает decisions | `src/core/search.ts:300` (комментарий), `:316` (`globalSearch`) |
| Реестр инструментов и классификация | `src/mcp/tools.ts` (`listTools`), `src/core/tool-kinds.ts` (`TOOL_KINDS`) |
| Контракт write-ответа | `src/mcp/tool-result.ts` (`ackOk`/`ackNoop`/`ackError`), VL-306 |
| Дубли id: два файла с `id: decision-10` | `backlog/decisions/decision-10-…manifest-json.md`, `…installed-lock-json.md` |

## Шаги

1. **Ядро — `src/core/decision.ts`.** Добавить недостающее:
   - `updateDecision(backlogDir, id, patch)` — точечная правка: `status` (валидация по `DECISION_STATUSES`), `title` (переименование файла через `decisionFilename`), и ADR-секции. Правка секции — по имени заголовка: найти `## <Name>`, заменить тело до следующего `## ` или конца; секции нет — добавить в конец в порядке Context → Decision → Consequences → Alternatives.
   - `findDuplicateIds(entries)` — список id, встречающихся больше одного раза (для шага 6).
   - `getDecision` при дубле: вернуть первый, но добавить в результат признак `ambiguous: true` (аддитивное поле, старые вызовы не ломаются).

2. **MCP-инструменты — `src/mcp/decision-tools.ts`** (новый модуль, по образцу `src/mcp/upstream-tool.ts`):
   - `decision_list {status?}` → read. Возвращает `{decisions: [{id, title, date, status}], duplicates?: string[]}`.
   - `decision_view {id}` → read. Возвращает `{decision, body, ambiguous?}`; неизвестный id → `ackError` со списком доступных.
   - `decision_create {title, status?, context?, decision?, consequences?, alternatives?}` → write. Возвращает `ackOk` с `applied: {id, title, status}`.
   - `decision_update {id, status?, title?, context?, decision?, consequences?, alternatives?}` → write. Возвращает `ackOk` с `applied` — только фактически изменённые поля; ничего не изменилось → `ackNoop`.
   - Валидация до записи: пустой title, неизвестный id, недопустимый статус → `ackError`, файл не меняется.

3. **Регистрация — `src/mcp/tools.ts`.** Добавить 4 инструмента в `listTools()` с описаниями и `inputSchema`. Обновить счётчик реестра в `doctor` (`src/cli/commands/doctor.ts`) и в тестах (`compat-full`, `server`, `reference-tools`, `documents`, `diagnostics`).

4. **Классификация — `src/core/tool-kinds.ts`.** `decision_list`/`decision_view` → `read`, `decision_create`/`decision_update` → `write`. Проверить, что `isWriteOperation` даёт правильный результат (маркеры `create`/`update` уже в списке write-маркеров — вероятно, работает автоматически, но закрепить тестом).

5. **`globalSearch` — `src/core/search.ts`.** Добавить группу `decisions`:
   - `searchDecisions(backlogDir, query)` — substring по `id`/`title`/`body`, case-insensitive (по образцу `searchDocuments`).
   - В `GlobalSearchResults` добавить поле `decisions`; лимиты групп сохранить (`SEARCH_PER_TYPE_LIMIT`), пересчитать `others` в формуле лимита задач.
   - Обновить комментарий в шапке `globalSearch` (сейчас там написано «Decisions НЕ ищутся»).
   - Потребители: `src/web/chat.ts` (`buildSystemPrompt` — контекст поиска), `backlog_search` (если использует globalSearch), тесты.

6. **Дубли id.** `vibelog doctor` — новая проверка `decision_duplicates`: список id, встречающихся больше одного раза, с путями файлов. Не блокирующая (как `task_integrity`). `decision_list` возвращает `duplicates` в ответе.

7. **CLI (опционально, если объём позволяет).** `vibelog decision update <id> [-s status] [--context ...]` — тонкая обёртка над `updateDecision`. Если не влезает — вынести отдельной задачей, но зафиксировать в CHANGELOG, что CLI отстаёт от MCP.

## Как проверить

- `pnpm build && pnpm test`.
- Ручной кейс: `decision_list` в чате → 12 решений (включая дубль decision-10, помеченный в `duplicates`); `decision_view decision-6` → тело ADR про Svelte.
- `decision_create` с title и context → файл создан, id = max+1 (decision-12), `ackOk` с id.
- `decision_update decision-12 -s accepted` → статус изменён, тело не тронуто; повтор того же вызова → `ackNoop`.
- `decision_update` с `context` → секция `## Context` заменена, остальные секции целы.
- Валидация: пустой title, `decision-99`, `status: "мусор"` → `ackError`, файл не меняется.
- `globalSearch` в чате по «Svelte» → в контексте появляется decision-6.
- `vibelog doctor` → предупреждение о дубле decision-10.

## Риски

- **Счётчик инструментов.** Каждый новый MCP-инструмент ломает тесты счётчиков (`doctor`, `compat-full`, `server`, `diagnostics`). Обновить все сразу — иначе полный прогон красный.
- **Точечная правка секций.** Правка «до следующего `## `» ломается, если в теле есть `## ` внутри кода или цитаты. Митигация: искать заголовки только на уровне строки, начинающейся ровно с `## ` (без отступа), и не трогать содержимое fenced-блоков (```).
- **Дубли id.** `getDecision` возвращает первый — при дубле это может быть устаревшая версия. Поэтому `ambiguous: true` в ответе и предупреждение в `doctor`; автоматическое удаление дубля — НЕ делать (решение принимает человек).
- **`globalSearch` и лимиты.** Добавление пятой группы меняет формулу лимита задач (`SEARCH_TOTAL_LIMIT - others`). Проверить, что при пустых остальных группах задачи по-прежнему добираются до 20 (инвариант VL-185).
- **Совместимость с Backlog.md.** Decisions — сущность оригинала, формат совместим. Новые MCP-инструменты не меняют формат файлов, только добавляют доступ.
- **`decision_update` и переименование.** Смена `title` переименовывает файл (`decisionFilename`). Если файл с новым именем уже существует — отказ, а не перезапись.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 17:41
---
Фаза code не удалась (код выхода 1): окировок=3, payload последнего запроса=596887 байт (макс 596887), usage={"input_tokens":6675830,"output_tokens":46940,"cache_read_input_tokens":6545408,"total_tokens":6722770,"reasoning_tokens":24909} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-10 17:48
---
Фаза 3 (Code) выполнена. Коммит 696a315.
**Ядро — `src/core/decision.ts`:**
- `updateDecision(backlogDir, id, patch)` — точечная правка: `status` (валидация по `DECISION_STATUSES`), `title` (переименование файла через `decisionFilename`, отказ при занятом имени-цели), ADR-секции. Возвращает `changed[]` — фактически изменённые поля.
- `replaceDecisionSection(body, name, content)` — замена секции по имени заголовка: идём по строкам, отслеживаем fenced-состояние (``` / ~~~), заголовком считаем только строку, начинающуюся ровно с `## ` (без отступа) — `## ` внутри кода/цитаты секцию не режет. Отсутствующая секция добавляется в каноническом порядке Context → Decision → Consequences → Alternatives.
- `findDuplicateIds(entries)` — id, встречающиеся >1 раза.
- `searchDecisions(backlogDir, query)` — substring по id/title/телу, case-insensitive.
- `getDecision` при дубле возвращает первый файл и помечает `ambiguous: true` (аддитивное поле).
**MCP — `src/mcp/decision-tools.ts` (новый модуль, по образцу `workflow-tools.ts`):**
- `decision_list {status?}` → read, `{decisions: [{id,title,date,status}], duplicates?}`;
- `decision_view {id}` → read, `{decision, body, path, ambiguous?}`, неизвестный id → `ackError` со списком доступных;
- `decision_create {title, status?, context?, decision?, consequences?, alternatives?}` → write, `ackOk` с `applied: {id, title, status}`;
- `decision_update {id, status?, title?, context?, decision?, consequences?, alternatives?}` → write, `applied` — только изменённые поля, повтор → `ackNoop`.
- Валидация ДО записи: пустой title, неизвестный id, недопустимый статус → `ackError`, файл не меняется. Write-ветки обёрнуты в `withIdempotency`.
**Регистрация:** `listTools()` (+4), `TOOL_KINDS` (list/view → read, create/update → write), группа «Решения (ADR)» в `MCP_GROUPS` (instructions), префикс `decision_` в политике doctor. Счётчик реестра 52 → 56 обновлён в `compat-full`, `documents`, `reference-tools`, `server`; `EXPECTED_MCP_TOOLS` в `diagnostics` дополнен.
**`globalSearch` (`src/core/search.ts`):** пятая группа `decisions` (`SearchDecisionHit`), лимиты сохранены (PER_TYPE=5, задачи добираются до TOTAL − others, others ≤ 4×5). Комментарий «Decisions НЕ ищутся» заменён. `src/web/chat.ts` — решения попадают в контекст поиска (до 3).
**doctor:** неблокирующая проверка `decision_duplicates` — id + имена файлов, hint про ручное решение (автоудаления нет).
**Тесты:** новый `src/mcp/decision-tools.test.mjs` (17 кейсов: регистрация/TOOL_KINDS, CRUD, точечная правка секций, fenced-блок, переименование, валидация, дубли id, decisions в globalSearch); кейсы дублей в `diagnostics.test.mjs`; сценарии ack/noop/partial для новых write-инструментов в `write-ack-contract.test.mjs`.
**Проверки:** `pnpm build` — чисто; полный `pnpm test` — 221 файл, 4263 passed, 4 skipped (пропуски предсуществующие, в `frontmatter.test.mjs`), 0 failed. Исключённых/пропущенных файлов прогона нет.
**Что осталось (вне скоупа фазы Code):**
- AC9 (документация: doc-8 раздел decisions, doc-7, CHANGELOG) — по правилам фазы Code документация пишется в Close.
- Шаг 7 плана (CLI `vibelog decision update`) — опциональный; не реализован, CLI отстаёт от MCP (create/list/view). Зафиксировать в CHANGELOG при Close или вынести отдельной задачей.
- Дубль `decision-10` в `backlog/decisions/` НЕ удалён осознанно: какая версия актуальна, решает человек; инструменты и doctor лишь сообщают о конфликте.
---
author: @agent
created: 2026-11-10 18:09
---
Фаза Close выполнена. Ветка vb/vl-412 слита в master (1 коммит 696a315, merge --no-ff без конфликтов), worktree удалена (--force: единственный untracked-путь — симлинк backlog/references/data от оркестратора), ветка vb/vl-412 удалена.
**Проверки после merge:** `pnpm build` — чисто. Ранний точечный фильтр по diff (7 файлов тестов: decision-tools, diagnostics, compat-full, documents, reference-tools, server, write-ack-contract) — 155 passed. Полный `npx vitest run` — 222 файла, 4281 passed, 4 skipped (предсуществующие в frontmatter.test.mjs), 0 failed.
**Классификация единственного падения в первом полном прогоне:** `src/web/orchestrator.test.mjs` («в коммите правка token_usage рана») — файл диффом не затронут, изолированный прогон 89/89 passed, параллельного vitest в других worktree не было. Причина — флак тайминга: тест ждёт fire-and-forget коммит в цикле с дедлайном 4 с под нагрузкой 222 параллельных файлов. Сделан ровно один повтор полного прогона с этой причиной — зелёный. Регрессии нет.
**Документация (коммит 5e25797):** doc-8 — счётчик 49 → 56 инструментов и новый раздел «Решения (decisions, ADR)» (4 инструмента с таблицами параметров, статусы, точечная правка секций, дубли id и doctor, поиск); doc-7 — раздел `decision`: зафиксировано, что CLI отстаёт от MCP (подкоманды `update` нет, ядро `updateDecision` готово, обёртка вынесена отдельной задачей); CHANGELOG.md — запись в Unreleased.
**Урок:** lesson-284 «Упавший в полном прогоне тест сначала прогони изолированно — флак тайминга не регрессия» (коммит a1d469c), связан с задачей.
**DoD:** тесты проходят (полный прогон зелёный), документация обновлена (doc-7, doc-8, CHANGELOG), регрессий нет.
**Вне скоупа, зафиксировано:** шаг 7 плана (CLI `vibelog decision update`) не реализован — отражено в doc-7 и CHANGELOG. Дубль `decision-10` в `backlog/decisions/` осознанно не удалён: какая версия актуальна, решает человек; инструменты и `vibelog doctor` лишь сообщают о конфликте.
---
<!-- COMMENTS:END -->