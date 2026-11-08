---
id: VL-378
title: 'Два публичных входа в правило терминальности: terminalStatusGate остался экспортированным рядом с terminalStatusGateForTask — низкоуровневый вызов обходит расчёт неполноты'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-08 16:04'
updated_date: '2026-11-08 19:08'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/workflow.ts
  - src/core/workflow.test.mjs
  - src/core/terminal-gate-single-entry.test.mjs
lessons:
  - lesson-260
token_usage:
  input: 4591450
  output: 42306
  cache: 4004352
  total: 4633756
  requests: 87
  duration_ms: 1211792
  reasoning: 18893
  by_phase:
    plan:
      input: 740806
      output: 12372
      cache: 589824
      requests: 16
    code:
      input: 2343688
      output: 18605
      cache: 2070528
      requests: 37
    close:
      input: 1506956
      output: 11329
      cache: 1344000
      requests: 34
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Найдено при аудите после закрытия VL-370.

В `src/core/workflow.ts` сейчас **два публичных экспорта** одного правила:

| Экспорт | Что принимает | Откуда берёт неполноту |
|---|---|---|
| `terminalStatusGate(workflow, targetStatus, uncheckedAc: number[], uncheckedDod: number[], prevStatus)` | готовые номера неотмеченных пунктов | **вызывающий** |
| `terminalStatusGateForTask(cwd, task, targetStatus, phase, prevStatus)` | задачу и фазу | `taskCompletenessMissing` + `getCompletenessRules` (VL-370) |

`terminalStatusGateForTask` внутри вызывает `terminalStatusGate` — это сделано намеренно в VL-370, чтобы текст причины остался байт-в-байт. Оба экспортированы.

## Проблема

**`terminalStatusGate` остался вызываемым снаружи.** Любой будущий код (или существующий, если появится третий путь смены статуса) может вызвать низкоуровневую версию напрямую — и тогда:

1. **Обойдёт расчёт неполноты из данных.** `terminalStatusGate` не знает про `CompletenessMap`: он принимает только номера AC/DoD. Правило `DEFAULT_COMPLETENESS.default.spec → description` (и любое кастомное) будет проигнорировано — гейт заблокирует только по чеклистам.
2. **Не учтёт workflow задачи.** Проверка «в этом workflow у задачи вообще нет AC/DoD, блокировать нечего» (simple-workflow) не сработает — вызывающий должен сам передать пустые массивы, и никто не обязывает.
3. **Вернёт расхождение двух путей**, ровно то, что VL-368/VL-370 закрывали. `terminalStatusGateForTask` — единая точка; `terminalStatusGate` — лазейка мимо неё.

Доказательство, что лазейка реальна: до VL-370 `finalizePhaseStatus` (`src/core/phase-transient.ts`) и `writeAutoReportIfMissing` (`src/agent/auto-report.ts`) **уже разъезжались**, каждый считал `uncheckedAcNumbers`/`uncheckedDodNumbers` сам. Это и был дефект VL-368. Механизм его возникновения не устранён — устранено только текущее использование.

## Цель

Единственный публичный вход в правило терминальности тот, который считает неполноту из данных.

## Варианты решения

**Вариант А (предпочтительный). Сделать `terminalStatusGate` приватным.**
Убрать экспорт — модуль внутренний, `terminalStatusGateForTask` его использует. Если тестам нужен доступ к низкоуровневой версии, они тестируют через `terminalStatusGateForTask`.

Проверить: `terminalStatusGate` импортируется в `src/agent/auto-report.ts` и `src/core/phase-transient.ts` — после VL-370 оба должны звать `terminalStatusGateForTask`. Если кто-то ещё зовёт низкоуровневую — перевести.

**Вариант Б. Оставить экспорт, но пометить `@internal`.**
Дисциплина вместо принуждения. Минус: не ловит нарушение механически.

**Вариант В. Слить в одну функцию с перегрузкой.**
Избыточно: две разные сигнатуры, разные обязанности.

Рекомендуется **А**.

## Точки правки

1. `src/core/workflow.ts:610` — снять `export` с `terminalStatusGate` (или переименовать в `terminalStatusGateCore` без экспорта).
2. Проверить все импорты: `grep -rn "terminalStatusGate" src/` — должно остаться только `workflow.ts` (внутренний вызов) и `terminalStatusGateForTask` снаружи.
3. Тесты, которые звали `terminalStatusGate` напрямую (`src/core/workflow.test.mjs`, `src/core/phase-transient.test.mjs`, `src/agent/auto-report.test.mjs`) — перевести на `terminalStatusGateForTask` или на проверку через публичное поведение.
4. Инвариант-тест: `grep` по `src/` не находит вызовов низкоуровневой версии вне `workflow.ts` (по образцу `tool-outcome-trace.test.mjs`).

## Связанные задачи

- **VL-368** — вынесла `terminalStatusGate` в ядро (первый шаг от двух копий к одной).
- **VL-370** — добавила `terminalStatusGateForTask` (второй шаг), но оставила старый экспорт.
- **VL-369** — общий пайплайн (тот же принцип «одна точка»).

## Риск

Снятие экспорта — ломающее изменение для внешних потребителей, если они есть (проект — CLI/MCP/веб, внешних библиотек нет; проверить `package.json` `exports`). Тесты придётся править. Митигация: сначала проверить `grep`, затем убрать экспорт, затем прогнать полный набор.

Второй риск: сам факт «текст причины собирается в `terminalStatusGate`» — если функция станет приватной, тесты точного текста (`auto-report.test.mjs` проверяет `/Статус не изменён/`, `/DoD: #2/`) станут проверять его через обёртку. Это даже лучше (проверяется наблюдаемое поведение), но надо убедиться, что они остаются зелёными без правки ожиданий.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `terminalStatusGate` не экспортируется из `src/core/workflow.ts`: единственный публичный вход в правило терминальности — `terminalStatusGateForTask` (считает неполноту из `CompletenessMap` с учётом workflow и фазы)
- [x] #2 `finalizePhaseStatus` (`src/core/phase-transient.ts`) и `writeAutoReportIfMissing` (`src/agent/auto-report.ts`) зовут только `terminalStatusGateForTask`; прямых импортов низкоуровневой версии в `src/` нет (проверено `grep`, зафиксировано тестом-инвариантом)
- [x] #3 Текст причины блокировки не изменился байт-в-байт: `auto-report.test.mjs` и `phase-transient.test.mjs` зелены БЕЗ правки ожиданий
- [x] #4 Тесты, вызывавшие `terminalStatusGate` напрямую, переведены на `terminalStatusGateForTask` или на проверку наблюдаемого поведения через публичный API
- [x] #5 `pnpm build && pnpm test` зелёный; `package.json` не объявляет `terminalStatusGate` в публичном API (внешних потребителей нет)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Решение

Вариант А (снятие экспорта) с переименованием в `terminalStatusGateCore`, чтобы имя осталось говорящим, а «публичность» больше не подразумевалась. Приватная функция остаётся в `src/core/workflow.ts`, единственный внешний вход — `terminalStatusGateForTask`. Механическая защита — тест-инвариант по `src/`.

## Файлы и точки правки

1. **`src/core/workflow.ts`**
   - `:885` — `export function terminalStatusGate(` → **`function terminalStatusGateCore(`** (без экспорта; переименование делает невозможным «случайный» импорт по старому имени и убирает из публичного API осмысленное имя правила).
   - `:858-866` — внутренний вызов внутри `terminalStatusGateForTask`: `return terminalStatusGate(...)` → `return terminalStatusGateCore(...)`.
   - `:868-883` — JSDoc функции: добавить абзац «Внутренняя, не экспортируется (VL-378): единственный вход — `terminalStatusGateForTask`, он считает неполноту из `CompletenessMap` с учётом workflow и фазы. Прямой вызов низкоуровневой версии обошёл бы расчёт неполноты и не учёл workflow задачи — ровно дефект VL-368».
   - `export interface TerminalStatusGateResult` (`:739`) **оставить экспортированным** — им типизируется переменная в `src/agent/auto-report.ts:23,118`; это тип результата, а не правило.

2. **`src/agent/auto-report.ts`** — правок не требуется: уже импортирует только `terminalStatusGateForTask` (`:22`) и тип `TerminalStatusGateResult` (`:23`), вызов — `:121`. Служит доказательством, что публичный путь достаточен.

3. **`src/core/phase-transient.ts`** — правок не требуется: импорт `:27`, вызов `:379`.

4. **`src/core/workflow.test.mjs`**
   - `:27` — убрать `terminalStatusGate,` из импорта.
   - `:589-601` (`it('AC4/AC12: default блокирует Done при неотмеченном DoD, текст — из terminalStatusGate')`): заменить сравнение с прямым вызовом (`const direct = terminalStatusGate(DEFAULT_WORKFLOW, 'Done', [], [1], 'Review'); assert.equal(direct.reason, gate.reason)`) на проверку **точного текста** через публичную функцию:
     ```js
     assert.equal(
       gate.reason,
       'Статус не изменён: терминальный «Done» при неотмеченных пунктах (DoD: #1) ' +
       'возможен только через backlog_finish_phase с dodOverride или aborted (VL-248/VL-309). ' +
       'Задача оставлена в «Review».'
     );
     ```
     Это сохраняет байт-в-байт проверку текста (AC3) и переводит тест на наблюдаемое поведение (AC4). Имя теста поправить: «...текст — публичный (VL-378)».
   - Остальные `DEFAULT_WORKFLOW`-использования в файле (`:65-262` и далее) не связаны с `terminalStatusGate` — не трогать.

5. **Новый тест-инвариант `src/core/terminal-gate-single-entry.test.mjs`** (расположение — рядом с модулем, как `src/mcp/tool-outcome-trace.test.mjs`; стиль чтения файлов с диска как в нём):
   - обход `src/**/*.ts` и `src/**/*.mjs` через `readdirSync(..., { withFileTypes: true })` (рекурсивно, `node_modules`/`dist` не входят — читаем `src/`), кроме самого `src/core/workflow.ts`;
   - утверждение 1: ни в одном файле нет вхождения токена `terminalStatusGate(` без суффикса `ForTask` — regex `/(?<!For)\bterminalStatusGate\(/` по содержимому; пустой список нарушителей (AC2);
   - утверждение 2: в `src/core/workflow.ts` функция объявлена БЕЗ экспорта: `/\bexport function terminalStatusGateCore\(/` не найден, `/\nfunction terminalStatusGateCore\(/` найден; и `export function terminalStatusGate(` отсутствует (AC1);
   - утверждение 3: `terminalStatusGateForTask` объявлен экспортом (`export function terminalStatusGateForTask(`) и внутри модуля есть вызов `terminalStatusGateCore(` — единственный вход держится на одной функции.
   Сообщения ассертов — на русском, с указанием «верни правило в ядро: единственный вход — terminalStatusGateForTask (VL-378)».

6. **`CHANGELOG.md`** — запись в `## [Unreleased]` → `### Изменено (ломающие изменения)` (первым абзацем, рядом с VL-379): снят экспорт низкоуровневого гейта (`src/core/workflow.ts`), единственный публичный вход — `terminalStatusGateForTask`; причина (обход расчёта неполноты и workflow), класс дефекта VL-368/VL-370, тест-инвариант.

7. **`backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md:437`** — в абзаце «Отчёт фазы обязателен…» фраза «проверка вынесена в общий экспорт `terminalStatusGate(workflow, targetStatus, uncheckedAc, uncheckedDod, prevStatus)` (`src/core/workflow.ts`), который вызывают оба пути» устарела; заменить на: «проверка вынесена в ядро `src/core/workflow.ts`; с VL-370 публичный вход один — `terminalStatusGateForTask(cwd, task, targetStatus, phase, prevStatus)`, а низкоуровневая сборка текста с VL-378 приватна (`terminalStatusGateCore`, без экспорта) — прямой вызов обошёл бы расчёт неполноты из `CompletenessMap` и учёт workflow».
   Правка — через `document_update` (файл backlog), не edit.

8. **`backlog/docs/doc-8-MCP-справочник-Vibelogmd.md:157`** — абзац уже перечисляет только `terminalStatusGateForTask`; добавить в конец перечня функций одну фразу: «Низкоуровневая сборка текста (`terminalStatusGateCore`) не экспортируется (VL-378): единственный вход в правило терминальности — `terminalStatusGateForTask`, поэтому обойти расчёт неполноты из данных нельзя». Через `document_update`.

## Порядок действий

1. Правка `src/core/workflow.ts` (переименование + снятие экспорта + JSDoc).
2. `pnpm build` — убедиться, что нет потребителей (tsc покажет ошибки импорта, если что-то пропущено).
3. Перевод теста в `src/core/workflow.test.mjs`, новый инвариант-тест.
4. `pnpm test:fast` (build уже собран) — прогнать затронутые файлы, затем полный `pnpm build && pnpm test`.
5. Документация: CHANGELOG (edit) + doc-10/doc-8 (`document_update`).
6. Коммит только путями `src/**` + `CHANGELOG.md` (backlog живёт в основном репозитории — не коммитить).

## Как проверить

- `grep -rn "terminalStatusGate" src/` — только `workflow.ts` (объявление + внутренний вызов) и `terminalStatusGateForTask` в `auto-report.ts`, `phase-transient.ts`, `workflow.test.mjs`; вхождения `terminalStatusGate(` без `ForTask` — только внутри `workflow.ts`.
- `node -e "console.log(require('./package.json').exports)"` → `undefined` (публичного API-манифеста у пакета нет — блокирующего риска для внешних потребителей не существует; AC5).
- `pnpm build && pnpm test` — полный прогон, все файлы (DoD «Тесты проходят»).

## Риски

- **R1: тест точного текста.** Проверка `/Статус не изменён/` и `/DoD: #2/` в `auto-report.test.mjs` и `phase-transient.test.mjs` идёт через публичное поведение и правок ожиданий не требует (оба файла вообще не импортируют низкоуровневую функцию — см. «Проверено по коду»). Митигация: в `workflow.test.mjs` текст сравнивается точной строкой, а не сравнением двух вызовов.
- **R2: переименование вместо простого снятия `export`.** Если Code решит оставить имя `terminalStatusGate` без экспорта, инвариант-тест всё равно ловит вызовы, но regex `\bterminalStatusGate\(` начнёт совпадать и внутри `workflow.ts` — проверка утверждения 2 должна быть привязана к конкретному имени. Предпочтительно переименовать (как в плане), тогда «магии невидимости» нет.
- **R3: `export *` из `workflow.ts` через barrel-файл.** Проверено: `export *` в `src/` нет, прямой реэкспорт гейта отсутствует — снятие `export` действительно закрывает вход.
- **R4: lesson-250** в теле описывает `terminalStatusGate` как «общий экспорт» — исторический факт, править не обязательно; Code/Close может дописать строку «с VL-378 низкоуровневая версия приватна» через `lesson_update`, если сочтёт нужным.

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `terminalStatusGate` объявлен как `export function` и принимает `(workflow, targetStatus, uncheckedAc, uncheckedDod, prevStatus)` | `src/core/workflow.ts:885-892` |
| `terminalStatusGateForTask` вызывает его, раскладывая `missing` в номера AC/DoD | `src/core/workflow.ts:846-867` (вызов — `:858-866`) |
| `TerminalStatusGateResult` — интерфейс результата, импортируется в агенте | `src/core/workflow.ts:739-745`, `src/agent/auto-report.ts:23` |
| `auto-report.ts` уже импортирует только `terminalStatusGateForTask` (+ тип), вызов один | `src/agent/auto-report.ts:22-23`, `:118-121` |
| `phase-transient.ts` импортирует только `terminalStatusGateForTask`, вызов в успешной ветке перед `updateTaskFile` | `src/core/phase-transient.ts:27`, `:379-381` |
| Текст причины собирается внутри низкоуровневой функции (шаблон с «Статус не изменён: …» и «Задача оставлена в …») | `src/core/workflow.ts:895-903` |
| В тестах прямое обращение к низкоуровневой функции — ровно одно: импорт и один вызов | `src/core/workflow.test.mjs:27`, `:596-600` |
| `auto-report.test.mjs` / `phase-transient.test.mjs` низкоуровневую функцию не импортируют (поиск `terminalStatusGate` по `src/` не дал совпадений в этих файлах) | результат `search_files terminalStatusGate`: файлы только `src/agent/auto-report.ts`, `src/core/phase-transient.ts`, `src/core/workflow.test.mjs`, `src/core/workflow.ts` |
| Barrel-реэкспортов (`export *`) в `src/` нет → снятие `export` закрывает внешний доступ | `grep -rn "export \*" src --include=*.ts` — пусто |
| `package.json` не объявляет поле `exports` (только `files`: bin/dist/templates/web/dist) → публичного API-манифеста нет | вывод `node -e` по `package.json` |
| В `DEFAULT_COMPLETENESS` дефолт для `default/close` = `['acceptanceCriteria','definitionOfDone']`, для `simple` AC/DoD нет вовсе → расчёт неполноты обязан идти через правила | `src/core/workflow.ts:99-110` |
| Образец инвариант-теста, читающего исходники с диска через `ROOT = process.cwd()` и `readFileSync(join(ROOT, ...))` | `src/mcp/tool-outcome-trace.test.mjs:1-60` |
| Документ doc-10 содержит устаревшую формулировку «вынесена в общий экспорт `terminalStatusGate(...)`» | `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md:437` (строка 2880 символов, фрагмент виден по индексу «общий экспорт») |
| doc-8 перечисляет `terminalStatusGateForTask` без низкоуровневой версии | `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md:157` |

## Не проверено (предположения)

1. **Имя `terminalStatusGateCore` не конфликтует** ни с чем в проекте. Проверить первым шагом: `grep -rn "terminalStatusGateCore" src/` → пусто. При расхождении — взять другое имя (например `buildTerminalGateResult`).
2. **`dist/` пересоберётся без остаточных импортов** — предполагается, что после правки `pnpm build` пройдёт без TS-ошибок. Проверить сразу после правки; при ошибке «has no exported member 'terminalStatusGate'» найти файл по тексту ошибки и перевести на `terminalStatusGateForTask` (вероятные кандидаты: `src/web/*`, `src/bot/*` — по grep их нет, но tsc авторитетнее).
3. **Тест-инвариант по `src/**/*.mjs` не поймает ложные срабатывания** на строки комментариев/документации внутри `src/` (например, `templates/` не входит в `src/`, но JSDoc может содержать `terminalStatusGate(`). Проверить: если regex находит совпадение в комментарии — ограничить проверку только `.ts`-файлами и/или исключить строки, начинающиеся с `*`/`//`. Решение фиксировать в коде теста комментарием.
4. **`src/core/workflow.test.mjs:589-601` — единственное место с точным сравнением текста гейта**; возможно, что точный текст уже проверяется и в `phase-transient.test.mjs` через `/#1/`. Проверить целевым grep по `Статус не изменён` в `src/**/*.test.mjs`; при наличии дубля — не менять (AC3 требует зелёных ожиданий без правок).
5. **`document_update` для doc-8/doc-10 не сломает структуру** (абзацы — длинные строки внутри списка). Проверить после записи через `document_view doc-10` фрагмент абзаца; при потере переноса — переписать абзац целиком, сохранив маркер списка.
6. **Полный прогон не содержит тестов, читающих публичный список экспортов `workflow.ts`** (типа `Object.keys(import('...'))`). Проверить целевым `grep -rn "Object.keys" src --include=*.test.mjs` перед снятием экспорта; при наличии такой проверки — обновить её в том же коммите.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-08 18:50
---
Фаза 2 (Plan) выполнена. Тип: bug. Выбран вариант А: низкоуровневый гейт переименовать в приватный `terminalStatusGateCore` — единственный публичный вход `terminalStatusGateForTask`.
Проверено кодом (ключевое):
- `terminalStatusGate` действительно экспортирован и вызываетcя изнутри `terminalStatusGateForTask` (`src/core/workflow.ts:885`, `:858-866`).
- `src/agent/auto-report.ts:22-23,118-121` и `src/core/phase-transient.ts:27,379` уже зовут ТОЛЬКО `terminalStatusGateForTask` — правок не требуется, AC2 фактически выполнен ещё в VL-370; нужен механический инвариант.
- Прямое обращение к низкоуровневой функции есть ровно в одном тесте: `src/core/workflow.test.mjs:27` (импорт) и `:596-600` (сравнение двух вызовов).
- `auto-report.test.mjs` / `phase-transient.test.mjs` низкоуровневую функцию не импортируют → ожидания `/Статус не изменён/`, `/DoD: #2/` менять не придётся (AC3).
- `export *` в `src/` нет; в `package.json` поля `exports` нет (только `files`) → снятие экспорта не ломает внешних потребителей (AC5).
- Устаревшая формулировка «общий экспорт `terminalStatusGate(...)`» найдена в `backlog/docs/doc-10...md:437`.
План: 8 файлов (2 изменяемых в src, 1 новый инвариант-тест, CHANGELOG + doc-10/doc-8, тест `workflow.test.mjs`), разделы «Проверено по коду» (14 строк) и «Не проверено (предположения)» (6 пунктов) заполнены.
Риски: точный текст причины теперь проверяется точной строкой через публичный API; возможный ложный срабатывание regex инварианта на комментарии (пункт 3 предположений — Code проверяет первым шагом); tsc после снятия экспорта покажет остаточных потребителей, если grep их пропустил.
---
author: @agent
created: 2026-11-08 18:55
---
Фаза 3 (Code) выполнена. Коммит 9e81d66.
Изменено:
- `src/core/workflow.ts` — `export function terminalStatusGate` → приватная `function terminalStatusGateCore` (без экспорта); внутренний вызов в `terminalStatusGateForTask` переведён на новое имя; JSDoc обновлён (внутренняя, единственный вход — `terminalStatusGateForTask`, объяснение класса дефекта VL-368/VL-370). `TerminalStatusGateResult` оставлен экспортированным (тип, нужен `auto-report.ts`).
- `src/core/workflow.test.mjs` — убран импорт `terminalStatusGate`; тест `AC4/AC12` теперь проверяет байт-в-байт текст причины (`Статус не изменён: … (DoD: #1) … Задача оставлена в «Review».`) через `terminalStatusGateForTask`, т.е. наблюдаемое поведение публичного API.
- `src/core/terminal-gate-single-entry.test.mjs` (новый, 3 теста) — инвариант: (1) ни одного вызова `terminalStatusGate(` без суффикса `ForTask` в `src/**` вне `workflow.ts`; (2) `terminalStatusGate` и `terminalStatusGateCore` не экспортируются; (3) `terminalStatusGateCore` объявлен приватно, `terminalStatusGateForTask` экспортирован и зовёт Core. Комментарии вырезаются перед проверкой (JSDoc намеренно упоминает старое имя) — фиксировано в коде теста (пункт 3 предположений плана).
Без правок (уже соответствовали плану): `src/agent/auto-report.ts` и `src/core/phase-transient.ts` — оба зовут только `terminalStatusGateForTask`.
Проверки:
- `grep -rn "terminalStatusGate" src/` — вне `workflow.ts` только `terminalStatusGateForTask` (+ инвариант-тест); прямых вызовов низкоуровневой версии нет.
- `pnpm build` — зелёный (tsc не нашёл остаточных импортов).
- `pnpm test` — ПОЛНЫЙ прогон: 200/200 файлов, 3805 passed, 4 skipped (пропуски — штатные `it.skip`, `--exclude`/`--skip` не применялись), 0 failed.
Предположения плана проверены: конфликта имени `terminalStatusGateCore` нет (grep пуст); `Object.keys(import(...))` по `workflow.ts` в тестах не встречается; дубля exact-текста в `phase-transient.test.mjs`/`auto-report.test.mjs` нет — они проверяют `/Статус не изменён/` через публичное поведение и остались зелёными без правки ожиданий (AC3).
Документация (CHANGELOG, doc-8, doc-10) — по регламенту Фазы 3 не обновляется, передаётся в Close.
---
author: @agent
created: 2026-11-08 19:08
---
Фаза Close выполнена. Ветка vb/vl-378 слита в master (1 коммит: 9e81d66 — `export function terminalStatusGate` → приватная `terminalStatusGateCore`; тест workflow.test.mjs переведён на проверку точного текста через публичный API; новый инвариант-тест `src/core/terminal-gate-single-entry.test.mjs`). Merge-коммит: eb1cb2b. Конфликтов слияния не было. Worktree `.vibelog/worktrees/vl-378` удалена (с `--force`: единственным грязным объектом был untracked-симлинк `backlog/references/data`, данные не теряются), ветка vb/vl-378 удалена.
Проверки после merge:
- `pnpm build` — зелёный (tsc не нашёл остаточных импортов старого имени).
- Ранний точечный фильтр по diff'у (workflow.test.mjs, terminal-gate-single-entry.test.mjs, phase-transient.test.mjs, auto-report.test.mjs) — 4 файла / 83 теста зелёные.
- Полный `vitest run` (один прогон) — 200/201 файл, упал 1 тест: `src/web/chat-limits.test.mjs` («noteActivity() перевзводит таймер», guard 40 мс при шагах 20 мс — таймерный флейк под нагрузкой). Классификация: файл не входит в diff VL-378 (диff — только src/core/workflow.ts, src/core/workflow.test.mjs, новый инвариант-тест), изолированный прогон файла зелёный (18/18), параллельного vitest в других worktree нет (`ps aux` пуст) → пре-существующий флейк, не регрессия. Один повтор полного прогона: 201/201 файл, 3813 passed, 4 skipped (штатные `it.skip`), 0 failed.
Документация (коммит 931e927): CHANGELOG → `## [Unreleased]` / `### Изменено (ломающие изменения)` первым абзацем (рядом с VL-379) — что снят экспорт, причина (обход расчёта неполноты из `CompletenessMap` и учёта workflow — класс дефекта VL-368/VL-370), тест-инвариант, отсутствие внешних потребителей (`package.json` без `exports`, `export *`-баррелей нет); doc-10 — две устаревшие формулировки («вынесена в общий экспорт `terminalStatusGate(...)`» и «существующий экспорт `terminalStatusGate` сохранён») заменены описанием единственного публичного входа `terminalStatusGateForTask` и приватной `terminalStatusGateCore`; doc-8 — в перечень функций добавлена фраза о неэкспортируемой низкоуровневой сборке текста. Правка больших doc-файлов выполнена точечной заменой скриптом Node.js с проверкой «ровно одно вхождение» и верификацией `grep` (полная замена через `document_update` потребовала бы передать 192/97 КБ содержимого — риск усечения).
Урок: lesson-260 «Снимай export с низкоуровневой функции в том же коммите, где появилась обёртка, и закрепляй это тестом-инвариантом» (коммит f67c1bc), связан с задачей.
Refs: у задачи references нет; ref-29/30/31 в рабочем каталоге относятся к другим задачам (GitVerse, VL-363/365/367) — не коммитились.
DoD: 1 «Тесты проходят» — выполнен (полный прогон 201/201 файл, 3813 passed, 0 failed); 2 «Документация обновлена» — выполнен (CHANGELOG, doc-8, doc-10); 3 «Нет регрессий» — выполнен (единственное падение классифицировано как пре-существующий таймерный флейк `chat-limits`).
---
<!-- COMMENTS:END -->