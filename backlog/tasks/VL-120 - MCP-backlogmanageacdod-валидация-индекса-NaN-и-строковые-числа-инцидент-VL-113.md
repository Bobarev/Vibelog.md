---
id: VL-120
title: 'MCP backlog_manage_ac/dod: валидация индекса — NaN и строковые числа (инцидент VL-113)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-12 19:13'
updated_date: '2026-10-12 20:48'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/tools.ts
  - src/mcp/v11.test.mjs
  - src/mcp/server.test.mjs
  - src/agent/mcp-client.test.mjs
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Инцидент VL-113 (запись сессии): модель передала manage_ac/manage_dod индекс не того типа — два вызова упали «Неверный индекс: NaN», фаза потеряла ходы на повтор с исправлением (агент потом передал шесть корректных вызовов параллельно).

Решение: валидация на границе MCP-инструмента — index парсить через parseInt (принимать и число, и строку-число); при NaN/пустой/дроби — ошибка с подсказкой формата и текущим количеством пунктов чек-листа, чтобы модель могла исправиться с первого раза.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 сервер: index нормализуется через parseInt — 3 и '3' принимаются; NaN/пусто/дробь → ошибка с подсказкой формата («индекс — целое число, начиная с 1») и текущим количеством пунктов
- [x] #2 server.test.mjs/mcp-client.test.mjs: кейсы index='3' (успех), 'NaN' и 2.5 (понятная ошибка)
- [x] #3 pnpm test зелёный; CHANGELOG: запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Суть

В `manageChecklist` (src/mcp/tools.ts) индекс нормализуется через `.map(Number)`: `Number('')` → 0 (не NaN!), `Number('NaN')` → NaN, `Number('2.5')` → 2.5. Валидация `Number.isInteger(idx)` частично ловит это, но (а) пустая строка даёт «Неверный индекс: 0» (путает — 0 вне диапазона, но причина в пустом вводе), (б) сообщение не содержит подсказки формата и количества пунктов в виде, пригодном для автоисправления моделью. Решение по инциденту VL-113: валидация на границе MCP-инструмента с самодостаточной ошибкой.

Важно: parseInt('2.5') = 2 — «тихое» срезание дроби недопустимо (AC: дробь → ошибка). Поэтому хелпер принимает строку только строго по /^\d+$/ (после trim), число — только целое.

## Файлы для изменения

1. **src/mcp/tools.ts**
   - Новый хелпер `parseChecklistIndexes(raw, listLength): number[]` рядом с `manageChecklist` (~строка 600):
     - raw: одиночное значение или массив; для каждого элемента:
       - `typeof v === 'number'` и `Number.isInteger(v)` → ок;
       - `typeof v === 'string'` и `/^\d+$/` по `v.trim()` → `parseInt(v, 10)`;
       - иначе (NaN, '', дробь, 'abc', null, undefined) → throw `Неверный индекс: <JSON ввода>. Индекс — целое число, начиная с 1 (текущих пунктов чек-листа: <listLength>). Пример: index: 2 или index: "3".`;
     - после нормализации: `1 <= v <= listLength`, иначе throw той же формы ошибки с текущим вводом и listLength.
   - **Строки 634-640** (case 'check'/'uncheck'): заменить `const indexes = (...).map(Number); for (...) { ... }` на `const indexes = parseChecklistIndexes(args.index, list.length);` — оба цикла валидации удаляются.
   - **Строки 654-660** (case 'remove'): та же замена.
   - **Строки 161 и 175** (inputSchema `index` для manage_ac и manage_dod): расширить anyOf — `{ type: 'number' } | { type: 'string' } | { type: 'array', items: anyOf: [{type:'number'},{type:'string'}] }`, описание «Номер(а) критерия с 1; строка-число ("3") тоже принимается — массив для check/uncheck/remove». Это снижает шанс, что модель вообще передаст строку, несмотря на схему.

2. **src/mcp/v11.test.mjs** (юнит через handleToolCall, блоки manage_ac ~153-201, manage_dod ~192-208) — добавить `it`-кейсы:
   - `index: '3'` (check со строкой) — успех, пункт отмечен (после add трёх критериев);
   - `index: 'NaN'` — rejects с текстом, содержащим «целое число, начиная с 1» и количество пунктов;
   - `index: 2.5` — rejects той же формы;
   - (гард) `index: ''` — rejects, а не «Неверный индекс: 0».

3. **src/mcp/server.test.mjs** (интеграция через JSON-RPC callMcp, спавн реального CLI) — один кейс: задача с 2 AC, tools/call backlog_manage_ac `{action:'check', index:'NaN'}` → ответ `isError: true`, текст содержит подсказку «целое число»; и tools/call с `index:'2'` (строка) → успех без isError. Схему tools/list (21 инструмент) не трогать.

4. **src/agent/mcp-client.test.mjs** (интеграция через McpClient) — один кейс: callTool backlog_manage_dod `{action:'check', index:'2.5'}` → результат с isError/текстом подсказки (паттерн существующего «isError-инструмент» теста в этом файле).

5. **CHANGELOG.md** — запись в `## [Unreleased]` → `### Исправлено` (или существующая секция с фиксами): «VL-120: MCP manage_ac/dod — валидация index на границе инструмента: строка-число ("3") принимается, NaN/пусто/дробь → ошибка с подсказкой формата и количеством пунктов (инцидент VL-113)».

## Порядок действий

1. Хелпер + правки manageChecklist в src/mcp/tools.ts.
2. Правки схемы index (строки 161, 175).
3. Тесты v11.test.mjs → server.test.mjs → mcp-client.test.mjs.
4. `pnpm build && pnpm test` — всё зелёное (841+ тестов, +5-7 новых).
5. CHANGELOG.md.

## Как проверить

```bash
pnpm build && pnpm test
node --test src/mcp/v11.test.mjs src/mcp/server.test.mjs src/agent/mcp-client.test.mjs
```

## Риски

- **Назначение имени в сообщении ошибки**: если указать только `args.index` без исходного ввода, для 'NaN' выводился бы «Неверный индекс: NaN» — этого избегаем, текст ошибки пишем шаблоном с JSON-представлением ввода и listLength.
- **Совместимость**: старое поведение «NaN → 'Неверный индекс: NaN. Доступно: 1-N'» меняется на более подробное — существующие тесты (batch-checklist.test.mjs:166-170 ловит общий Error) проверяют только факт throw, не текст; после правки прогнать src/cli/batch-checklist.test.mjs.
- **anyOf в схеме**: часть MCP-клиентов кэширует tools/list — расширение схемы обратносовместимо (number остаётся допустимым).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-12 20:11
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу: 5 файлов (src/mcp/tools.ts — хелпер parseChecklistIndexes + замена .map(Number) в check/uncheck/remove (строки 634-660) + расширение схемы index (строки 161, 175); v11.test.mjs — юнит-кейсы '3'/NaN/2.5/''; server.test.mjs и mcp-client.test.mjs — интеграционные кейсы; CHANGELOG.md). Риски: изменение текста ошибки (батч-тесты проверяют только факт throw — прогнать batch-checklist.test.mjs); расширение anyOf схемы обратносовместимо.
---
author: @agent
created: 2026-10-12 20:35
---
Фаза 3 (Code) выполнена. Тип: task. Реализовано по Implementation Plan:
**Код:**
- `src/mcp/tools.ts`: новый хелпер `parseChecklistIndexes(raw, listLength)` — нормализация индекса на границе MCP-инструмента: целое число и строка-число по `/^\d+$/` (trim) принимаются; NaN/пусто/дробь/'abc'/null → самодостаточная ошибка с JSON-вводом, подсказкой формата («индекс — целое число, начиная с 1») и текущим количеством пунктов чек-листа. Дробь НЕ срезается тихо до целого (parseInt('2.5')=2 недопустим — AC). В check/uncheck/remove старые циклы валидации заменены на хелпер. Схема `index` в backlog_manage_ac/dod расширена anyOf: number | string | array[number|string] с обновлённым описанием.
**Тесты (+7):**
- `src/mcp/v11.test.mjs`: unit — index '3' (успех), 'NaN' (ошибка с подсказкой и лимитом), 2.5 (ошибка + пункт не отмечен), '' (ошибка, а не «Неверный индекс: 0»); manage_dod — '2' успех и '2.5' ошибка.
- `src/mcp/server.test.mjs`: интеграция JSON-RPC — 'NaN' → isError с подсказкой «целое число, начиная с 1» и «пунктов чек-листа: 2», '2' (строка) → успех.
- `src/agent/mcp-client.test.mjs`: McpClient — manage_dod index '2.5' → isError-результат с подсказкой.
**Проверки:** `pnpm build` зелёный; `pnpm test` — 859/859 зелёный (было 841+); целевые файлы + `src/cli/batch-checklist.test.mjs` (риск из плана — текст ошибки изменился, батч-тесты зелёные) прогнаны отдельно.
**Коммит:** 9eae6d9 (ветка vb/vl-120).
**Что осталось (не отмечено в AC/DoD):**
- AC #3 / DoD #2: запись в CHANGELOG.md и обновление документации — по регламенту Фазы 3 не делается, пишет Фаза Close после merge (VL-126); в коммит запись не включена.
- Замечание: MCP-сервер этой сессии (main repo dist) ещё со старой валидацией — при попытке отметить AC массивом инструмент ответил «Неверный индекс: NaN» (что и демонстрирует проблему VL-113 в дистрибутиве до пересборки); отметки сделаны по одному вызову, после сборки/merge поведение исправится.
---
author: @agent
created: 2026-10-12 20:48
---
Фаза Close выполнена. Ветка vb/vl-120 слита в master (1 коммит 9eae6d9, merge без конфликтов), worktree удалена (только untracked-симлинки node_modules/refs → remove --force), ветка удалена. После merge в главном репо: pnpm build и pnpm test зелёные (859/859). Документация (шаг VL-126): CHANGELOG.md — запись в Unreleased → Исправлено (валидация index на границе manage_ac/dod, инцидент VL-113); backlog/docs/doc-8-MCP-справочник — тип параметра index расширен (number | string | array) с описанием ошибок валидации. Docs-коммит: 5ac23fe. DoD: все 3 пункта отмечены (тесты проходят, документация обновлена, нет регрессий); AC: все 3 отмечены (pnpm test зелёный + CHANGELOG — закрыто здесь).
---
<!-- COMMENTS:END -->