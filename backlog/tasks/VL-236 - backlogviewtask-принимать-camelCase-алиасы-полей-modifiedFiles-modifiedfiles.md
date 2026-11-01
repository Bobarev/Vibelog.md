---
id: VL-236
title: 'backlog_view_task: принимать camelCase-алиасы полей (modifiedFiles → modified_files)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 00:49'
updated_date: '2026-10-30 02:00'
due_date: ''
labels:
  - mcp
  - tools
  - ergonomics
dependencies: []
milestone: ''
references: []
priority: low
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/tools.ts
  - src/mcp/view-task-fields.test.mjs
  - MCP-SETUP.md
lessons: []
token_usage:
  input: 1537652
  output: 18640
  cache: 1440000
  total: 1556292
  requests: 45
  duration_ms: 234918
  reasoning: 5548
  by_phase:
    plan:
      input: 359965
      output: 5233
      cache: 335360
      requests: 13
    code:
      input: 1177687
      output: 13407
      cache: 1104640
      requests: 32
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

При чтении задачи VL-147 в чате был передан фильтр полей `fields: ["id", "modifiedFiles"]` — инструмент вернул ошибку `Неизвестные поля: modifiedFiles. Допустимые: … modified_files, …`. Пришлось делать повторный вызов (лишний ход + сожжённые токены на перечисление всех допустимых полей).

Причина — расхождение конвенций: модель и большинство API оперируют camelCase (TypeScript-тип `Task`), а `backlog_view_task` принимает только ключи интерфейса Task в snake_case (`modified_files`). Правило шаблонно-предсказуемое, но не выводится из имени инструмента.

## Цель

Убрать класс ошибок «поле названо в camelCase → отказ»: нормализовать имена, а не наказывать за конвенцию.

## Предлагаемое решение

В обработчике `backlog_view_task` (и в любых других MCP-инструментах с параметром `fields`) — нормализация перед валидацией:
1. точное совпадение с ключом Task — принять;
2. иначе — приведение к snake_case (`camelToSnake`) и повторная проверка;
3. иначе — нынешняя ошибка с перечнем допустимых полей (текст сохранить).

Не менять возвращаемое представление: нормализация касается **только входа**.

## Места правки (проверить в Plan)

- `src/mcp/tools.ts` — валидация/резолв `fields` в `toolViewTask` (или аналоге); единая функция нормализации;
- схема инструмента — описание `fields` с примером `["id","title","modified_files"]`;
- тесты MCP (`src/mcp/*.test.mjs`) — кейсы camelCase и мусорного имени.

## Риски

Низкие: изменение аддитивное, поведение при точном совпадении не меняется. Единственный нюанс — не «схлопывать» пары полей, различающиеся только регистром (в `Task` таких нет, проверить при правке).

## Входные данные

Инцидент: два вызова `backlog_view_task` подряд (VL-147, VL-137) с `fields: ["modifiedFiles"]`; в обоих — ошибка валидации вместо данных.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации

Тип: enhancement (обычная задача, не эпик). Правка аддитивная, только вход `fields` в `backlog_view_task`; возвращаемое представление не меняется.

### 1. `src/mcp/tools.ts` — хелпер нормализации (рядом с `toolViewTask`, модульный уровень)

- Добавить функцию `camelToSnake(name: string): string` — `name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()`. JSDoc на русском с «почему»: VL-236, конвенции camelCase (TS-тип `Task`) vs snake_case-ключи в ответе.
- Добавить `resolveFieldName(field: string, valid: string[]): string | undefined`:
  1. `valid.includes(field)` → `field` (точное совпадение приоритетно, поведение VL-162 не меняется);
  2. иначе `const snake = camelToSnake(field)`; если `valid.includes(snake)` → `snake`;
  3. иначе `undefined`.
- Инварианты (проверено командой `node -e` по списку ключей `Task`): в `Task` нет пар полей, различающихся только регистром/подчёркиваниями, поэтому «схлопывания» не будет. `snake(k) !== k` только для 5 ключей тела: `acceptanceCriteria→acceptance_criteria`, `definitionOfDone→definition_of_done`, `implementationPlan→implementation_plan`, `implementationNotes→implementation_notes`, `finalSummary→final_summary`; для frontmatter-ключей (`modified_files`, `parent_task_id`, …) нормализация идемпотентна.

### 2. `src/mcp/tools.ts`, `toolViewTask` (~строки 824–842)

Текущая валидация (строки 833–837) заменяется на нормализацию:

- `if (fields === undefined || (Array.isArray(fields) && fields.length === 0))` → полное представление (строка 827) — **без изменений**;
- `if (!Array.isArray(fields))` → ошибка «Параметр `fields` должен быть массивом имён полей.» (строки 830–831) — без изменений; дополнительно проверить, что каждый элемент — строка (`typeof f !== 'string'` → та же ошибка), иначе `camelToSnake(null)` даст TypeError;
- построить `const resolved: string[] = []` и `const unknown: string[] = []`: для каждого `f` вызвать `resolveFieldName`; найденное — в `resolved`, не найдённое — в `unknown`;
- `unknown.length > 0` → та же ошибка с сохранением текста: `Неизвестные поля: ${unknown.join(', ')}. Допустимые: ${valid.join(', ')}.` (строка 837, текст не менять — на него завязан тест vf-5);
- дедуп: если один канонический ключ пришёл дважды (`['modified_files','modifiedFiles']`) — оставить первое вхождение (не отдавать ключ дважды в JSON);
- сборка `picked` идёт по `resolved` (канонические ключи), порядок ключей = порядок `fields` — контракт VL-162 сохранён.

### 3. `src/mcp/tools.ts`, схема инструмента (~строки 130–135)

- `description` параметра `fields`: добавить пример и явное правило приёма алиасов, например: `Имена полей Task (ключи интерфейса Task), напр. ["id","title","modified_files"]; camelCase-алиасы принимаются и приводятся к ключу Task (modifiedFiles → modified_files); без параметра или при пустом массиве — полное представление`.

### 4. `src/mcp/view-task-fields.test.mjs` — новые кейсы в существующем `describe`

- `camelCase-алиас возвращает канонический ключ`: `fields: ['id','modifiedFiles']` → ключи ответа `['id','modified_files']` (значение = массив), ошибки нет (инцидент VL-147/VL-137);
- `алиас поля тела`: `fields: ['id','implementationPlan']` → ключи `['id','implementation_plan']` (и симметрично `acceptanceCriteria`/`definitionOfDone` — проверить хотя бы один);
- `смешанный список и порядок`: `fields: ['title','modifiedFiles','id']` → порядок ключей ответа `['title','modified_files','id']`;
- `дубль alias+canonical`: `fields: ['modified_files','modifiedFiles']` → ключ один раз;
- `мусорное имя всё ещё ошибка`: `fields: ['id','nopeField']` → ошибка «Неизвестные поля: nopeField.» + перечень допустимых;
- (опционально) `fields: [null]` → ошибка «массивом имён полей», не TypeError.

Существующие 6 кейсов остаются зелёными (регресс-гарантия: точные имена, полное представление, `fields: []`, ошибка на неизвестное поле).

### 5. Документация

- `CHANGELOG.md` — пункт `VL-236` в секции Unreleased (пишет фаза Close; в Code — только код + тесты).
- `MCP-SETUP.md`, таблица инструментов: строка `backlog_view_task` — дополнить «…, `fields` с camelCase-алиасами». Правка одной строки, выполняется в фазе Code.

### Порядок действий

1. `src/mcp/tools.ts`: хелперы `camelToSnake` + `resolveFieldName`.
2. `toolViewTask`: нормализация + дедуп, текст ошибки сохранить.
3. Схема `fields`: описания с примером snake_case и правилом алиасов.
4. Тесты в `src/mcp/view-task-fields.test.mjs` (+5–6 кейсов).
5. `MCP-SETUP.md` — строка таблицы.

### Как проверить

```bash
pnpm build && npx vitest run src/mcp/view-task-fields.test.mjs   # целевой набор
pnpm test:fast                                                    # весь набор, dist уже собран
```

Ручная проверка контракта (после build): вызов `handleToolCall('backlog_view_task', {id, fields:['id','modifiedFiles']})` в node-скрипте или через MCP — ответ без ошибки, ключ `modified_files`.

### Риски

- **Регистр/схлопывание пар полей** — проверено: в `Task` таких пар нет; нормализация только расширяет множество допустимых имён.
- **Изменение текста ошибки** — запрещено: тест vf-5 и подсказки модели завязаны на текущую формулировку.
- **Non-string элементы `fields`** — закрывается явной проверкой (`typeof f === 'string'`), иначе TypeError из `camelToSnake` (lesson-34).
- **Дубли ключей в ответе** — закрывается дедупом при нормализации; порядок определяется первым вхождением.
- **Регресс полного представления** — ветки `fields === undefined` / `[]` / не-массив не трогаем.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 01:21
---
Фаза 2 (Plan) выполнена. Тип: enhancement (обычная задача, не эпик) — план записан в задачу.
Изучено: `src/mcp/tools.ts` (toolViewTask, строки 824–842; схема инструмента 130–135), `src/core/task.ts` (интерфейс Task, строки 54–101), `src/mcp/view-task-fields.test.mjs` (6 существующих кейсов VL-162), grep по `backlog_view_task` в документации (README — упоминаний `fields` нет, релевантный артефакт — `MCP-SETUP.md`:14 и `CHANGELOG.md`).
Решение: единый хелпер `camelToSnake` + `resolveFieldName` (точное совпадение → snake_case → undefined), нормализация перед валидацией в `toolViewTask`, дедуп канонических ключей, проверка «элемент — строка» (иначе TypeError из `camelToSnake`, lesson-34). Текст ошибки сохраняется без изменений.
Файлы плана (5): `src/mcp/tools.ts` (хелперы + toolViewTask + схема `fields`), `src/mcp/view-task-fields.test.mjs` (+5–6 кейсов), `MCP-SETUP.md` (строка таблицы инструментов), `CHANGELOG.md` (пишет Close).
Ключевая проверка инварианта (node -e по списку ключей Task): пар полей, различающихся только регистром/подчёркиваниями, нет — «схлопывания» не будет; `snake(k) !== k` только у 5 полей тела (acceptanceCriteria, definitionOfDone, implementationPlan, implementationNotes, finalSummary), frontmatter-ключи идемпотентны.
Риски: низкие — расширение множества допустимых имён, ветки полного представления (`fields === undefined` / `[]` / не-массив) не трогаются; изменение текста ошибки запрещено (тест vf-5). Проверка: `pnpm build && npx vitest run src/mcp/view-task-fields.test.mjs`, затем `pnpm test:fast`.
---
author: @agent
created: 2026-10-30 01:24
---
Фаза 3 (Code) выполнена. Коммит 9380c60.
Изменено (3 файла, +163/−5):
- `src/mcp/tools.ts`: хелперы `camelToSnake` и `resolveFieldName` (каскад: точное совпадение → snake_case → поиск по нормализованной форме); в `toolViewTask` — нормализация имён перед валидацией + дедуп канонических ключей + явная проверка «элементы fields — строки» (иначе TypeError, lesson-34). Текст ошибки «Неизвестные поля: … Допустимые: …» сохранён дословно. Описание параметра `fields` в схеме дополнено примером snake_case и правилом алиасов.
- `src/mcp/view-task-fields.test.mjs`: новый describe VL-236 (7 кейсов): `modifiedFiles → modified_files` (инцидент VL-147/VL-137), alias поля тела (`implementation_plan → implementationPlan`), alias чеклиста (`acceptance_criteria → acceptanceCriteria`), порядок ключей при смешанном списке, дубль alias+canonical, мусорное имя, не-строковый элемент. Итого 13 кейсов в файле.
- `MCP-SETUP.md`: строка таблицы `backlog_view_task` дополнена упоминанием `fields` и алиасов.
Отклонение от плана (осознанное, план уточнён по факту): канонические ключи `Task` для полей тела — camelCase (`acceptanceCriteria`, `implementationPlan`, `definitionOfDone`, `implementationNotes`, `finalSummary`), snake_case — только frontmatter. Поэтому одного `camelToSnake` недостаточно: каскад резолва дополнен обратным поиском `valid.find(key => camelToSnake(key) === camelToSnake(field))`, иначе `fields: ['implementation_plan']` из README/CHANGELOG-описаний VL-162 отвергался бы. Схлопывания пар полей нет — проверено по списку ключей `Task`.
Проверки: `pnpm build` — чисто; `npx vitest run src/mcp/view-task-fields.test.mjs` — 13/13 зелёные; полный `npx vitest run` — 86 файлов / 1595 тестов passed, 4 skipped, 0 failed.
Что осталось: CHANGELOG.md (пункт VL-236) — по правилам фазы пишет Close. CHANGELOG не трогал.
---
author: @agent
created: 2026-10-30 02:00
---
Фаза Close прервана: merge vb/vl-236 слит в master (8dd2207, 1 коммит — 9380c60), но сборка/тесты падают. Статус и DoD не менял (остаются Review / без изменений), worktree и ветка НЕ удалены — нужно разобраться и повторить Фазу Close.
## Что сделано до остановки
- Worktree `.vibelog/worktrees/vl-236` был чист (только untracked-симлинки `node_modules`, `backlog/references/data` от оркестратора), коммитить было нечего.
- Ветка содержала 1 коммит: `9380c60 feat: VL-236 — backlog_view_task принимает alias-имена полей`.
- Merge `--no-ff` прошёл БЕЗ конфликтов: `MCP-SETUP.md` (+2/-2…), `src/mcp/tools.ts` (+62/-5), `src/mcp/view-task-fields.test.mjs` (+104), суммарно +163/−5.
- `pnpm build` — чисто (tsc без ошибок).
## Причина остановки: `pnpm test` красный
`Test Files 1 failed | 84 passed (85)`, `Tests 24 failed | 1567 passed | 4 skipped`.
Падает ТОЛЬКО `src/agent/llm.test.mjs` (24 из 52 кейсов), например:
- `createLlmClient / streamChat (VL-83) > собирает текст по onToken из SSE-потока` — `AssertionError: actual '' vs expected 'Привет, мир!'`;
- `только фантомы + content=null → сообщение вырезано из wire целиком` — `TypeError: Cannot read properties of undefined (reading 'length')` (body.messages пуст).
## Диагноз: НЕ регрессия VL-236, а протечка локального `.vibelog/settings.json` в тесты
Проверки:
1. `git diff HEAD^1 HEAD --name-only | grep agent` — пусто: merge-коммит VL-236 не трогал `src/agent/*`; `src/agent/llm.ts` последний раз менялся в `c20bce8` (VL-230), тест — в `e4033e9` (VL-216), обе до этой ветки.
2. Целевой набор задачи: `npx vitest run src/mcp/view-task-fields.test.mjs` — 13/13 passed.
3. Изоляция настроек: при временно убранном `.vibelog/settings.json` тот же файл даёт `52 passed (52)`, затем файл восстановлен на место (`.vibelog/settings.json`, 3669 байт).
4. Изоляция через env не сработала (`VIBELOG_CWD=.../noenv` → всё равно 24 failed), что согласуется с `resolveActiveModel(options.cwd ?? process.cwd())` — тестовый cwd остаётся корнем репо.
Механизм: в главном репо `.vibelog/settings.json` → `models.default = routerai/deepseek/deepseek-v4.1-flash@baidu` c `api_mode: "responses"`. `createLlmClient` (VL-209/VL-205) резолвит `apiMode = options.apiMode ?? active?.apiMode ?? 'chat'` → тесты, создающие клиент с `CLIENT_OPTS` без `apiMode`, уходят на `/responses` и парсят ответ Responses-формата, тогда как моки `sseResponse`/`jsonResponse` собраны под Chat Completions. Отсюда пустой текст и пустой `messages` на wire. На чистом окружении (без активной модели в settings.json) файл зелёный.
Замечание: это состояние master унаследовано от предыдущих фаз/репо, но исправить его нужно отдельной задачей (например: `apiMode: 'chat'` явно в `CLIENT_OPTS` тестов либо приоритет env над settings.json в тестовом режиме) — в рамках Close VL-236 править код нельзя.
## Что осталось невыполненным
- шаг 6: `git worktree remove .vibelog/worktrees/vl-236`, `git branch -d vb/vl-236` — не выполнялись;
- шаг 7.5–7.6: lessons/refs не фиксировались;
- шаг 8: CHANGELOG.md — пункт VL-236 НЕ добавлен;
- шаг 9–10: статус/DoD не менялись, файл задачи не закоммичен.
---
<!-- COMMENTS:END -->