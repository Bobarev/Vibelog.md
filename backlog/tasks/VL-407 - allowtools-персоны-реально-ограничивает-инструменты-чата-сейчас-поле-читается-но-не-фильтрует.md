---
id: VL-407
title: 'allow_tools персоны реально ограничивает инструменты чата (сейчас поле читается, но не фильтрует)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-10 15:03'
updated_date: '2026-11-10 15:27'
due_date: ''
labels: []
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
  - src/web/tool-policy.ts
  - src/web/chat.ts
  - src/web/personas.ts
  - src/web/personas-api.ts
  - src/web/personas.test.mjs
  - src/web/persona-allow-tools.test.mjs
  - web/src/components/personas/persona-detail.tsx
  - web/dist/index.html
  - web/dist/assets/index-DEK7zZgz.js
  - web/dist/assets/index-DWfTMWtm.css
lessons:
  - lesson-281
token_usage:
  input: 6943423
  output: 32341
  cache: 6814720
  total: 6975764
  requests: 99
  duration_ms: 1288916
  reasoning: 12628
  by_phase:
    code:
      input: 5409633
      output: 25057
      cache: 5317632
      requests: 66
    close:
      input: 1533790
      output: 7284
      cache: 1497088
      requests: 33
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Дефект: поле `allow_tools` у персоны читается, валидируется и редактируется на странице «Персоны» (VL-403), но **не влияет ни на что**. Любая роль получает полный набор инструментов чата: `edit`, `write_file`, `backlog_update_task`, `git_commit` и т.д.

Проверено по коду:
- `src/web/personas.ts:257` — `allow_tools` читается в `PersonaConfig.allowTools`;
- `src/web/personas-api.ts` — CRUD и валидация имён;
- `src/web/chat.ts` — `allowTools` **не встречается вообще**;
- `src/web/tool-policy.ts:312` — `chatToolDefs(cwd, persona)` использует персону только для `memory_remember`;
- тест `src/web/personas.test.mjs:163` называется «allow_tools: шов без фильтрации (AC10)»;
- CHANGELOG VL-265: «`allow_tools` — только шов: читается и валидируется, фильтрация инструментов по роли — отдельная задача».

Практическое следствие: в `.vibelog/settings.json` у роли `auditor` стоит `allow_tools: ["backlog_search", "read_file", "search_files"]`, но под этой ролью доступны `edit` и `write_file`. Ограничение — фикция.

Почему это блокер для субагентов: идея «Помощник вызывает Психолога» требует, чтобы у роли-консультанта был урезанный набор инструментов (обычно только чтение). Без работающего `allow_tools` консультант получит право писать файлы и менять задачи.

Связанные: VL-265 (шов), VL-403 (страница «Персоны» — редактирование поля), VL-391 (upstream-инструменты и роли), VL-219 (классификация read/write), VL-330 (`ask_user` — инструмент только веб-чата).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `chatToolDefs(cwd, persona)` фильтрует итоговый список по `persona.allowTools`, если поле задано: в списке остаются только перечисленные имена
- [x] #2 `allow_tools` не задан (undefined) → доступ ко всем инструментам, как сейчас (обратная совместимость: встроенные роли и старые конфиги не ломаются)
- [x] #3 `allow_tools: []` (пустой массив) → ни одного инструмента, кроме всегда-доступных; поведение зафиксировать в плане и документации (не путать с «не задан»)
- [x] #4 Инструменты, которых нет в MCP-реестре (`read_file`, `write_file`, `edit`, `search_files`, `ask_user`, `memory_remember`), тоже участвуют в фильтрации — их имена валидны в `allow_tools` (сейчас валидация в `personas.ts` их уже принимает через LOCAL_CHAT_TOOLS)
- [x] #5 `memory_remember` не отваливается при заданном `allow_tools`, если роль — текущая роль треда: либо он добавляется всегда, либо его имя должно быть в списке — решение зафиксировать и покрыть тестом
- [x] #6 Модель не видит отфильтрованные инструменты в `tools` запроса (не только отказ при вызове) — иначе она будет пытаться их вызвать и получать ошибки
- [x] #7 Попытка вызвать инструмент вне списка (например через прямой tools/call или устаревший tool_call в истории) даёт понятный отказ, а не молчаливое исполнение
- [x] #8 Тесты: фильтрация по списку, отсутствие списка → всё, пустой список, локальные инструменты, `memory_remember`, отсутствие отфильтрованных имён в wire-запросе, отказ при прямом вызове
- [x] #9 Документация: doc-6 (роли — `allow_tools` реально ограничивает), doc-8 (если меняется поведение инструментов), CHANGELOG
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
| `allow_tools` читается в `PersonaConfig.allowTools` | `src/web/personas.ts:257` (`if (allowed) persona.allowTools = allowed`) |
| Валидация имён: MCP-реестр + `LOCAL_CHAT_TOOLS` (`read_file`, `write_file`, `search_files`) | `src/web/personas.ts` (`parseAllowTools`, `LOCAL_CHAT_TOOLS`) |
| `chatToolDefs(cwd, persona)` собирает: `listTools()` минус `CHAT_DISALLOWED_TOOLS` минус неактивный upstream, плюс `read_file`/`write_file`/`edit`/`search_files`, плюс `ask_user`, плюс `memory_remember` при наличии роли | `src/web/tool-policy.ts:312-330` |
| Персона используется ТОЛЬКО для `memory_remember` | `src/web/tool-policy.ts:329` (`if (persona) defs.push(makeMemoryRememberTool(...))`) |
| `allowTools` в `src/web/chat.ts` не встречается | grep по `src/web/chat.ts` — 0 совпадений |
| Вызов сборки инструментов | `src/web/chat.ts:1481` (`const tools = chatToolDefs(cwd, activePersona)`) |
| Тест фиксирует текущее поведение как «шов без фильтрации» | `src/web/personas.test.mjs:163` |
| `edit` есть в локальных инструментах чата | `src/web/tool-policy.ts` (`makeEditTool`), `src/agent/tools.ts` (`makeEdit`) |

## Шаги

1. **`src/web/tool-policy.ts` — фильтрация.** В конце `chatToolDefs`, после сборки полного списка:
   ```
   const allow = persona?.allowTools;
   if (allow === undefined) return defs;          // не задан → всё (совместимость)
   const allowed = new Set(allow);
   return defs.filter(d => allowed.has(d.name));
   ```
   - Фильтр применяется к **итоговому** списку, а не к `listTools()`: локальные инструменты (`read_file`, `write_file`, `edit`, `search_files`) и `ask_user` тоже должны отсекаться.
   - `allow_tools: []` → пустой список. Это осознанное решение: пустой массив — «ничего не разрешено», а не «всё разрешено». Зафиксировать комментарием и тестом (иначе путаница с `undefined`).
   - `memory_remember`: **добавлять всегда при наличии роли**, независимо от `allow_tools`. Обоснование: это не инструмент проекта, а механизм памяти самой роли; если его отсечь, роль не сможет запоминать предпочтения пользователя. Зафиксировать комментарием. Альтернатива (требовать имя в списке) отвергнута: пользователь не должен помнить про служебный инструмент при настройке роли.

2. **`src/web/chat.ts` — отказ при вызове вне списка.** Даже если модель не видит инструмент в `tools`, в истории треда может остаться старый `tool_call` (тред начат под другой ролью — хотя VL-283 фиксирует роль, история могла быть до фиксации). В `executeTool` перед исполнением:
   ```
   if (activePersona.allowTools !== undefined && !activePersona.allowTools.includes(name) && name !== MEMORY_REMEMBER_TOOL) {
     return ackError(`Инструмент "${name}" не разрешён роли "${activePersona.label}"`);
   }
   ```
   - Использовать существующий контракт отказа (`ackError` из `src/mcp/tool-result.ts`), а не свободный текст — модель должна видеть машиночитаемый отказ.
   - Проверка идёт ПОСЛЕ guard'а повторов и grant-а (порядок как сейчас), но ДО `localHandlers.get`/`handleToolCall`.

3. **Проверить, что отфильтрованные имена не уходят в wire-запрос.** `tools` передаётся в `llm.streamChat(...)` (`src/web/chat.ts:1750`). После шага 1 фильтрация происходит до этого вызова — проверить тестом, что в переданном массиве нет запрещённых имён.

4. **Страница «Персоны» (VL-403) — подсказка.** В секции `allow_tools` добавить пояснение: «пусто — роль получает все инструменты; отметьте хотя бы один, чтобы ограничить». Сейчас мультиселект не объясняет семантику пустого значения.

5. **Валидация при сохранении.** `src/web/personas-api.ts` уже проверяет имена по реестру. Добавить: если массив непустой и содержит только `memory_remember` — предупредить (роль фактически без инструментов). Не блокировать, только предупреждение в ответе.

## Как проверить

- `pnpm build && pnpm test` + `cd web && npm run build && npm run lint`.
- Ручной кейс: в `.vibelog/settings.json` у роли `auditor` стоит `allow_tools: ["backlog_search", "read_file", "search_files"]`. Открыть чат под Аудитором, попросить отредактировать файл → модель не видит `edit` в инструментах, при попытке вызова — отказ «не разрешён роли».
- Роль без `allow_tools` (helper) → полный набор, как раньше.
- `allow_tools: []` → в `tools` только `memory_remember`; попытка любого другого вызова — отказ.
- `memory_remember` работает при заданном `allow_tools` без упоминания в списке.
- Wire-запрос: в тесте с подменным LLM проверить, что `tools` не содержит запрещённых имён.

## Риски

- **Сломать существующие конфиги.** Если у кого-то `allow_tools` задан «на будущее» и неполон, роль внезапно потеряет инструменты. Митигация: в CHANGELOG и doc-6 явно написать, что поле теперь действует; в `vibelog doctor` — предупреждение, если `allow_tools` задан и не содержит ни одного write-инструмента (возможно, это не задумано).
- **`memory_remember` вне списка.** Решение «всегда добавлять» может удивить: пользователь ограничил роль, а инструмент всё равно есть. Митигация: комментарий в коде + строка в doc-6.
- **Пустой массив.** Семантика «ничего не разрешено» может быть неожиданной. Альтернатива — трактовать `[]` как `undefined`. Решение зафиксировать в плане реализации и в UI-подсказке; выбран вариант «ничего», потому что он предсказуем и не даёт скрытого полного доступа.
- **История треда.** Роль фиксируется за тредом (VL-283), но старые треды без sidecar получают `helper` — там `allow_tools` обычно не задан, ограничений не будет. Проверить, что отказ по шагу 2 не ломает resume старых тредов.
- **`ask_user`.** Интерактивный инструмент тоже отсекается при заданном списке. Если роль должна уметь задавать вопросы — его имя надо добавить в `allow_tools`. Упомянуть в doc-6.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 15:19
---
Фаза 3 (Code) выполнена. Коммит 2d94998.
**Реализация**
- `src/web/tool-policy.ts` — `chatToolDefs(cwd, persona)` фильтрует ИТОГОВЫЙ список по `persona.allowTools`: `undefined` → полный набор (совместимость), `[]` → только `memory_remember`, непустой массив → ровно перечисленные имена. Фильтр применён после сборки (MCP-реестр + локальные read_file/write_file/edit/search_files + ask_user + memory_remember), поэтому локальные инструменты тоже отсекаются. `memory_remember` добавляется всегда при наличии роли (механизм памяти роли, а не инструмент проекта) — зафиксировано комментарием.
- `src/web/chat.ts` — `personaDeniedAck(persona, name)` (модульная функция) отдаёт машиночитаемый `ackError` «Инструмент "X" не разрешён роли "Y"». Проверка стоит в `executeTool` после guard'а повторов и grant'а, ДО `localHandlers.get`/`handleToolCall`; в цикле хода — до approval-гейта (запрещённый write не открывает Allow/Deny); в `advanceToNextApproval` — для хвоста хода/resume (новый параметр `persona`).
- `src/web/personas.ts` — `LOCAL_CHAT_TOOLS` расширен до `read_file, write_file, edit, search_files, ask_user, memory_remember` (имена берутся из `ASK_USER_TOOL`/`MEMORY_REMEMBER_TOOL`, не копией строк); обновлён JSDoc `allowTools` (семантика трёх значений).
- `src/web/personas-api.ts` — предупреждение (не блокировка) в ответе PUT/POST, если непустой `allow_tools` состоит только из `memory_remember`.
- `web/src/components/personas/persona-detail.tsx` — подсказка у мультиселекта: пусто — все инструменты, отметьте хотя бы один, чтобы ограничить; `memory_remember` доступен всегда.
**Тесты**
- Новый `src/web/persona-allow-tools.test.mjs` (10 тестов): фильтрация по списку, отсутствие списка → всё, пустой список, локальные инструменты, `memory_remember` (и его отсутствие без роли), отсутствие отфильтрованных имён в wire-запросе (подменный LLM), отказ при вызове вне списка без approval-карточки, работа `memory_remember` при заданном списке.
- `src/web/personas.test.mjs` — заголовок блока «шов без фильтрации» заменён на «чтение и валидация (фильтрация — VL-407)».
**Проверки**
- `pnpm build` — ок.
- `pnpm test` — полный прогон: 219 файлов, 4218 passed, 4 skipped, 0 failed.
- `cd web && pnpm install --frozen-lockfile && npm run build` — ок (артефакты `web/dist` пересобраны и закоммичены).
- `cd web && npm run lint` — 1 error + 1 warning, оба ВНЕ diff'а этой задачи: `web/src/components/activity/activity-item.tsx:107` (react-hooks/immutability) и warning в `grant-scope.tsx`; в затронутом `persona-detail.tsx` замечаний нет.
**Что осталось (Фаза Close)**
- AC9 — документация: doc-6 (роли: `allow_tools` реально ограничивает, семантика `[]`, `memory_remember` и `ask_user` вне списка), doc-8 (видимость инструментов чата), CHANGELOG. По инструкции фазы Code документы и CHANGELOG не правятся — это работа Close.
- Риск из плана (миграция существующих конфигов: роль с неполным `allow_tools` внезапно теряет инструменты) стоит отразить в CHANGELOG/doc-6; предупреждение в `vibelog doctor` не делалось — в плане оно указано как митигация, отдельного AC на него нет.
---
author: @agent
created: 2026-11-10 15:27
---
Фаза Close выполнена. Ветка vb/vl-407 слита в master (1 коммит, merge cf63444), worktree удалена (force — только untracked `backlog/references/data` от оркестратора), ветка vb/vl-407 удалена.
**Проверки после merge**
- `pnpm build` — ок.
- Ранний точечный фильтр по diff: `src/web/persona-allow-tools.test.mjs`, `personas.test.mjs`, `tool-policy.test.mjs`, `chat.test.mjs` — 120 passed.
- Полный прогон `npx vitest run` — 220 файлов, 4226 passed, 4 skipped, 0 failed. Повторных прогонов не было.
**Документация (AC9, DoD 2)**
- doc-6 §10 — новый подраздел «`allow_tools` реально ограничивает инструменты роли (VL-407)»: три значения поля (`undefined` → всё, непустой массив → ровно перечисленные, `[]` → только `memory_remember`), фильтрация итогового списка включая локальные инструменты и `ask_user`, `memory_remember` вне списка, отказ при вызове вне списка, подсказка в UI, предупреждение при сохранении, миграционный риск для неполных конфигов.
- doc-8 — в разделе «Инструменты только веб-чата» добавлен абзац «Видимость зависит от роли (VL-407)»: фильтр в `chatToolDefs`, `ackError` до `localHandlers`/approval-гейта.
- CHANGELOG.md — запись в Unreleased → «Исправлено» (VL-407), с миграционным риском.
- Коммит документации: c487409.
**DoD**
1. Тесты проходят — да (полный прогон 4226 passed, 0 failed).
2. Документация обновлена — да (doc-6, doc-8, CHANGELOG).
3. Нет регрессий — да (полный прогон зелёный, точечный фильтр зелёный).
**AC9** отмечен выполненным (документация).
**Lessons**
- Создан lesson-281 «Проверяй, что настройка доходит до точки применения, а не только читается и валидируется» (sourceTasks VL-407, связан с задачей), коммит bbd8fe9.
**Не делалось (вне AC)**
- Предупреждение в `vibelog doctor` про `allow_tools` без write-инструментов — в плане указано как митигация, отдельного AC нет; риск отражён в CHANGELOG и doc-6.
- `cd web && npm run lint` в фазе Code дал 1 error + 1 warning вне diff'а задачи (`activity-item.tsx`, `grant-scope.tsx`); в затронутом `persona-detail.tsx` замечаний нет.
---
<!-- COMMENTS:END -->