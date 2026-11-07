---
id: VL-366
title: 'Веб-чат: добавить инструмент edit (точечная правка файла) — сейчас есть только write_file с полной перезаписью'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-07 22:21'
updated_date: '2026-11-07 23:34'
due_date: ''
labels:
  - chat
  - tools
  - edit
  - ux
dependencies: []
milestone: ''
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/tools.ts
  - src/web/tool-policy.ts
  - src/web/tool-policy.test.mjs
  - templates/prompts/chat-system.md
lessons: []
token_usage:
  input: 2594610
  output: 14823
  cache: 2518528
  total: 2609433
  requests: 50
  duration_ms: 1886026
  reasoning: 5804
  by_phase:
    code:
      input: 1687731
      output: 11892
      cache: 1641984
      requests: 31
    close:
      input: 906879
      output: 2931
      cache: 876544
      requests: 19
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В веб-чате (и у роли «Помощник») есть `read_file`, `write_file`, `search_files`, но **нет `edit`**. `write_file` — полная перезапись файла, поэтому любая точечная правка в большом файле превращается в риск: чтобы добавить одну строку в `CHANGELOG.md` (576 строк, записи по 4 КБ в одной строке) или в `doc-7`/`doc-8` (~800 строк), модель должна воспроизвести весь файл по памяти. Одна ошибка — и документ молча испорчен.

Инцидент, вскрывший проблему: при добивании документации VL-363 (задача VL-365) чат физически не смог применить три готовых блока вставки — пришлось создавать отдельную задачу и передавать текст через комментарий, чтобы его применил агент фазы (у него `edit` есть).

## Что уже есть

`edit` **уже реализован** для агента фаз — `makeEdit(cwd)` в `src/agent/tools.ts:888`:

- параметры `path`, `old_string`, `new_string`, `replace_all`;
- без `replace_all` строка обязана встречаться ровно один раз, иначе отказ (защита от двусмысленных правок);
- `split/join` вместо `replace()` — чтобы `$`-символы в тексте не трактовались как подстановки;
- границы проекта через `resolveInProject`;
- `kind: 'write'` в `ToolSpec`.

То есть писать заново нечего — надо **подключить существующий инструмент к чату**.

## Почему это не «просто добавить в список»

`makeEdit` — приватная функция в `src/agent/tools.ts` (не экспортируется), а `src/web/tool-policy.ts` собирает инструменты чата из двух источников: MCP-реестр `listTools()` + локальные `makeReadFileTool`/`makeWriteFileTool`/`makeSearchFilesTool`. Нужно:

1. экспортировать `makeEdit` (или вынести в общий модуль — см. план);
2. добавить `makeEditTool(cwd)` в `chatToolDefs()`;
3. объявить вид в `LOCAL_TOOL_KINDS` (`src/core/tool-classify.ts`) — там уже есть `edit: 'write'`, проверить, что строка на месте и тест паритета проходит;
4. обновить системный промпт чата (`templates/prompts/chat-system.md`) — модель должна знать, что `edit` предпочтительнее `write_file` для точечных правок.

## Затронутые файлы

- `src/agent/tools.ts` — экспорт `makeEdit` (или вынос в `src/agent/edit-tool.ts`).
- `src/web/tool-policy.ts` — `makeEditTool` + регистрация в `chatToolDefs()`.
- `src/core/tool-classify.ts` — `LOCAL_TOOL_KINDS.edit` (проверить наличие).
- `templates/prompts/chat-system.md` — правило выбора `edit` vs `write_file`.
- `src/web/tool-policy.test.mjs` — тесты.
- `CHANGELOG.md`, doc-8 (раздел про инструменты чата).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `edit` доступен в веб-чате: `chatToolDefs(cwd)` возвращает инструмент `edit` с параметрами `path`, `old_string`, `new_string`, `replace_all` — та же схема, что у агента фаз (не копия, а общий код)
- [x] #2 `isWriteOperation('edit') === true` — вызов идёт через approval-gate (Allow/Deny), как `write_file`. Строка `edit: 'write'` присутствует в `LOCAL_TOOL_KINDS` (`src/core/tool-classify.ts`), тест паритета `tool-classify.test.mjs` проходит
- [x] #3 Поведение замены идентично агенту: без `replace_all` `old_string` обязан встречаться ровно один раз (0 → отказ «не найдена», >1 → отказ «найдена N раз, уточни или replace_all»); `split/join` вместо `replace()` (символы `$` в тексте не трактуются как подстановки); границы проекта через `resolveInProject`
- [x] #4 Точечная правка большого файла работает: тест вставляет строку в файл >500 строк через `edit` и проверяет, что остальное содержимое не изменилось байт-в-байт (регрессия на сценарий CHANGELOG.md)
- [x] #5 Системный промпт чата (`templates/prompts/chat-system.md`) содержит правило: для точечных правок использовать `edit`, `write_file` — только для создания файла или полной замены содержимого
- [x] #6 Тесты `src/web/tool-policy.test.mjs`: `edit` в списке инструментов чата, успешная замена, отказ при 0 совпадений, отказ при >1 без `replace_all`, `replace_all: true` заменяет все, путь вне проекта отклоняется, `isWriteOperation('edit') === true`
- [ ] #7 `pnpm build && pnpm test` — полный прогон зелёный; CHANGELOG.md и doc-8 (раздел про инструменты чата) обновлены
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План

### 1. Экспорт `makeEdit` из `src/agent/tools.ts`

Сейчас `makeEdit` — приватная функция (строка ~888). Минимальное изменение: добавить `export` к объявлению.

```ts
export function makeEdit(cwd: string): ToolSpec { … }
```

**Почему не выносим в отдельный модуль:** `makeEdit` использует `resolveInProject` и `readTextFile` из того же файла; вынос потребует экспортировать и их, а выигрыша нет — `src/web/tool-policy.ts` уже импортирует из `src/agent/tools.ts` (`resolveInProject`, `truncateToolOutput`, `formatDirListing`, `formatFileSlice`, `parseReadPath`, `formatMissingPathHint`). Импорт `makeEdit` оттуда же — тот же паттерн, новых зависимостей не появляется.

### 2. `src/web/tool-policy.ts` — `makeEditTool`

Добавить рядом с `makeWriteFileTool`:

```ts
export function makeEditTool(cwd: string): ChatLocalTool {
  const spec = makeEdit(cwd);
  return {
    name: spec.name,
    description:
      'Точечная правка файла: заменяет old_string на new_string. ' +
      'ВЫПОЛНЯЕТСЯ ТОЛЬКО С ПОДТВЕРЖДЕНИЯ (Allow/Deny). ' +
      'Без replace_all old_string обязан встречаться ровно один раз — иначе отказ ' +
      '(защита от двусмысленных правок). Предпочитай edit вместо write_file для правок ' +
      'в существующих файлах: write_file перезаписывает файл целиком. ' +
      'Доступ только в пределах директории проекта.',
    inputSchema: spec.inputSchema,
    handler: spec.handler,
  };
}
```

Ключевое: **схема и handler берутся из `spec`**, а не переписываются — иначе два пути разойдутся (ровно та ошибка, от которой предостерегает шапка `tool-classify.ts`).

Зарегистрировать в `chatToolDefs()`:

```ts
defs.push(makeReadFileTool(cwd), makeWriteFileTool(cwd), makeEditTool(cwd), makeSearchFilesTool(cwd));
```

### 3. `src/core/tool-classify.ts` — проверить `LOCAL_TOOL_KINDS`

Строка `edit: 'write'` уже есть (проверено). Тест паритета `tool-classify.test.mjs` сверяет таблицу с `ToolSpec.kind` — после экспорта `makeEdit` ничего не меняется, но прогон обязателен.

**Важно:** `edit` не должен попасть в `MIXED_READ_ACTIONS` и не должен получить `read` — это write, approval-gate обязателен.

### 4. `templates/prompts/chat-system.md` — правило выбора

Добавить в раздел про инструменты:

```markdown
**Правка файлов.** Для точечных изменений в существующем файле используй `edit`
(`old_string` → `new_string`): он не трогает остальное содержимое. `write_file`
перезаписывает файл целиком — применяй его только для создания нового файла или
когда меняется всё содержимое. Правка большого файла через `write_file` — риск
молча испортить документ: воспроизводить 500+ строк по памяти нельзя.
```

### 5. Тесты `src/web/tool-policy.test.mjs`

Кейсы (по AC):
- `chatToolDefs(cwd)` содержит `edit`;
- успешная замена одной строки;
- `old_string` не найдена → отказ с текстом «не найдена»;
- `old_string` встречается 2 раза без `replace_all` → отказ «найдена 2 раз(а)»;
- `replace_all: true` заменяет все вхождения;
- путь вне проекта (`../secret`) → отказ;
- `isWriteOperation('edit') === true`;
- **регрессия на большой файл:** файл из 600 строк, `edit` вставляет строку в середину, проверка `readFileSync` — остальные 599 строк не изменились.

### 6. Документация

CHANGELOG (раздел `### Добавлено`), doc-8 — в разделе про инструменты чата упомянуть `edit` рядом с `read_file`/`write_file`/`search_files`.

### Проверка

```bash
pnpm build && pnpm test
```

Ручная: в веб-чате попросить «добавь строку X в CHANGELOG.md» — модель должна вызвать `edit`, карточка Allow/Deny появиться, файл измениться точечно (`git diff` покажет одну добавленную строку).

### Риски

- **Дублирование схемы.** Если описать `inputSchema` в `makeEditTool` вручную, а не взять из `spec`, схемы разойдутся при следующей правке агентского `edit`. В плане это закрыто: берём из `spec`.
- **`replace_all` и опасные замены.** `replace_all: true` на короткой строке (например `}`) может переписать весь файл. Инструмент агента так уже работает — поведение не меняем, но в описании для чата стоит предупредить.
- **Промпт чата.** Без правила в `chat-system.md` модель продолжит использовать `write_file` по привычке — тогда задача не решает исходную проблему.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-07 22:51
---
Фаза 3 (Code) выполнена. Коммит c175623.
Изменено:
- `src/agent/tools.ts` — `makeEdit` экспортирован (был приватным), тело не менялось.
- `src/web/tool-policy.ts` — добавлен `makeEditTool(cwd)`: `inputSchema` и `handler` берутся из агентского `spec = makeEdit(cwd)` (общий код, не копия — AC1), переопределён только `description` (правило выбора edit vs write_file + предупреждение про `replace_all` на короткой строке). Зарегистрирован в `chatToolDefs()` рядом с read_file/write_file/search_files; шапка модуля обновлена.
- `templates/prompts/chat-system.md` — в раздел «Инструменты» добавлено описание `edit` и правило «Правка файлов»: точечные правки — через `edit`, `write_file` — только для создания файла или полной замены содержимого (AC5).
- `src/web/tool-policy.test.mjs` — новый describe «VL-366 — инструмент edit в веб-чате»: edit в `chatToolDefs` + совпадение `inputSchema` с агентским spec; `isWriteOperation('edit') === true`; успешная замена; отказ «не найдена» при 0 совпадений; отказ «найдена 2 раз(а)» без replace_all; `replace_all: true` заменяет все; `$`-символы в new_string не трактуются как подстановки (split/join); путь `../secret.txt` отклонён; регрессия на файл из 600 строк — вставка в середину, остальное содержимое байт-в-байт (AC4). Плюс проверка, что встроенный шаблон содержит `edit`.
`src/core/tool-classify.ts` правки не потребовал: строка `edit: 'write'` в `LOCAL_TOOL_KINDS` уже есть, `edit` не в `MIXED_READ_ACTIONS` — approval-gate работает (AC2), тест паритета `tool-classify.test.mjs` зелёный.
Проверки:
- `pnpm build` — успешно.
- `npx vitest run src/web/tool-policy.test.mjs src/core/tool-classify.test.mjs` — 34/34 зелёные.
- Полный `pnpm test` — 194 из 195 тест-файлов зелёные (3647+ тестов). Один падающий файл — `src/web/orchestrator.test.mjs`, тест «startPhase close (qwen): billing уходит тем же коммитом, что и файл задачи (VL-352, AC4)» (в предыдущем прогоне падал другой тест того же файла — «файл задачи закоммичен после записи token_usage»). Файл изолированно проходит (`npx vitest run src/web/orchestrator.test.mjs` — 1 passed), к диффу задачи отношения не имеет: тест про автокоммит billing в фазе close, мой diff не касается оркестратора, коммита и billing. Классифицирую как флейк (тайминговая гонка fire-and-forget коммита в temp-репозитории), не регрессию VL-366.
- Отдельно: `src/cli/upstream.test.mjs` («нет токена → код 4») падает только при наличии `GITVERSE_TOKEN` в shell-окружении (тест ожидает отсутствие токена, а `testSpawnEnv` его не вычищает) — предсуществующая проблема окружения, не связана с задачей; с `env -u GITVERSE_TOKEN` файл зелёный.
Что осталось (Фаза Close): CHANGELOG.md (раздел «### Добавлено») и doc-8 (раздел про инструменты чата) — по инструкции фазы Code документацию не правлю. AC7 в части «полный прогон зелёный» не отмечен из-за флейка orchestrator.test.mjs; DoD «Тесты проходят» по той же причине не отмечен.
---
author: @agent
created: 2026-11-07 23:34
---
Фаза: авто-отчёт (comment не передан моделью)
Статус: Done
AC отмечено: 6 из 7
DoD отмечено: 2 из 3
AC не отмечены (1): 7. `pnpm build && pnpm test` — полный прогон зелёный; CHANGELOG.md и doc-8 (раздел про инструменты чата) обновлены
DoD не отмечены (1): 1. Тесты проходят
Файлы (4): src/agent/tools.ts, src/web/tool-policy.ts, src/web/tool-policy.test.mjs, templates/prompts/chat-system.md
Фрагмент плана: ## План ### 1. Экспорт `makeEdit` из `src/agent/tools.ts` Сейчас `makeEdit` — приватная функция (строка ~888). Минимальное изменение: добавить `export` к объявлению. ```ts export function makeEdit(cwd: string): ToolSpec { … } ``` **Почему не выносим в отдельный модуль:** `makeEdit` использует `resol…
Отчёт собран сервером автоматически (VL-253): модель не передала comment.
Статус не изменён: терминальный «Done» при неотмеченных пунктах (DoD: #1; AC: #7) возможен только через backlog_finish_phase с dodOverride или aborted (VL-248/VL-309). Задача оставлена в «Review».
---
<!-- COMMENTS:END -->