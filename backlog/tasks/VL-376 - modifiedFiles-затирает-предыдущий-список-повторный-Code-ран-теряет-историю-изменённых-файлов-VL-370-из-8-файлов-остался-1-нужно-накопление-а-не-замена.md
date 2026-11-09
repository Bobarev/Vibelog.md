---
id: VL-376
title: 'modifiedFiles затирает предыдущий список: повторный Code-ран теряет историю изменённых файлов (VL-370: из 8 файлов остался 1) — нужно накопление, а не замена'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-08 16:03'
updated_date: '2026-11-09 21:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.13
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/tools.ts
  - src/mcp/update-pipeline.test.mjs
  - src/mcp/git-commit.test.mjs
lessons:
  - lesson-255
token_usage:
  input: 9185135
  output: 63260
  cache: 8086016
  total: 9248395
  requests: 115
  duration_ms: 926520
  reasoning: 32487
  by_phase:
    plan:
      input: 1434542
      output: 20294
      cache: 1177600
      requests: 22
    code:
      input: 6628715
      output: 36123
      cache: 5982208
      requests: 68
    close:
      input: 1121878
      output: 6843
      cache: 926208
      requests: 25
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Механика найдена при аудите после закрытия VL-370.

**Симптом:** в `modified_files` задачи VL-370 остался **один** файл — `src/mcp/update-pipeline.test.mjs`. Фактически фаза Code меняла **8 файлов** (`src/core/workflow.ts`, `src/core/workflow.test.mjs`, `src/core/phase-transient.ts`, `src/agent/auto-report.ts`, `src/mcp/tools.ts`, `src/mcp/update-pipeline.ts`, `src/mcp/update-pipeline.test.mjs`, `src/mcp/write-ack.test.mjs`).

**Причина:** `modifiedFiles` работает как **полная замена** в обоих инструментах:

```ts
// src/mcp/tools.ts:1378 — backlog_update_task
if (args.modifiedFiles !== undefined) updates.modified_files = args.modifiedFiles as string[];

// src/mcp/tools.ts:1902-1909 — backlog_finish_phase
// modifiedFiles — полная замена modified_files (как в toolUpdateTask)
if (args.modifiedFiles !== undefined) {
  ...
  updates.modified_files = files;
```

VL-370 выполнялась дважды: первый Code-ран (8 файлов), затем падение Close, затем повторный Code-ран (1 файл — правка теста). Второй ран передал `modifiedFiles: ["src/mcp/update-pipeline.test.mjs"]` → список перезаписался, история первого рана исчезла.

## Почему это важно

**1. `git_commit` проверяет пути против `modified_files`.** `src/mcp/git-commit.ts` отклоняет пути вне `modified_files` задачи (с подсказкой `allowForeign`). После затирания легитимные правки первого рана стали «чужими» — повторный Close не смог бы их закоммитить без `allowForeign`.

**2. Регресс-тесты читают это поле.** `backlog_search {modifiedFiles}` фильтрует задачи по подстроке в `modified_files`. Затирание делает задачу ненаходимой по реально изменённым файлам — то есть поиск «какие задачи трогали `src/core/workflow.ts`» даёт неполный ответ.

**3. История задачи искажается.** `finalSummary`/отчёт Close ссылается на список файлов; после затирания он не соответствует действительности.

**4. Это класс, а не единичный случай.** Любой повторный ран фазы (авто-resume после падения, ручной перезапуск Code, повторный Close) затирает список. Происходит при каждой аварии — то есть регулярно.

## Цель

`modified_files` должны **накапливаться** по ходу задачи, а не заменяться последним вызовом.

## Варианты решения

**Вариант А (предпочтительный). Слияние с дедупликацией.**
`modifiedFiles` из аргументов объединяется с текущим `task.modified_files`; дубликаты убираются, порядок — существующие первыми, затем новые.

Плюс: сохраняет историю, не ломает существующие вызовы (передача того же набора — no-op).
Минус: нельзя **убрать** файл из списка. Для этого нужен отдельный явный механизм (см. ниже).

**Вариант Б. Отдельный аргумент `modifiedFilesReplace: true`.**
По умолчанию — слияние; явный флаг — замена. Полный контроль без потери удобства.

**Вариант В. Только накопление, без возможности сброса.**
Проще всего, но тупиково: если файл попал по ошибке (опечатка в пути), убрать его нельзя, кроме ручной правки файла задачи.

Рекомендуется **Б**: слияние по умолчанию (правильное поведение для повторов), замена — осознанным флагом.

## Точки правки

1. `src/mcp/tools.ts:1378` (`buildTaskUpdates` / `backlog_update_task`) — слияние вместо присваивания.
2. `src/mcp/tools.ts:1902-1909` (`toolFinishPhase`) — то же.
3. Схемы инструментов (`:233`, `:467`) — описание «полная замена» заменить на «накопление с дедупликацией; `modifiedFilesReplace: true` — полная замена».
4. `src/mcp/git-commit.ts` — проверка остаётся, но теперь список полнее (правок не требует, проверить).
5. Тесты: слияние при повторе; дедупликация; замена по флагу; `git_commit` после двух ранов видит файлы обоих.

## Связанные задачи

- **VL-370** — задача, на которой симптом проявился.
- **VL-369** — общий пайплайн (`taskSpec.fields` содержит `modifiedFiles`; поле идемпотентно-неприменимо как обычное, требует спец-обработки).

## Риск

Слияние меняет поведение: тесты, ожидающие точный список после вызова, могут упасть. Проверить `grep modified_files` по тестам. Также `sameFieldsUpToDate` (noop-сверка) увидит «изменение» при слиянии, даже если набор фактически тот же — проверить, что повтор с тем же набором даёт noop, а не ложную запись.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `backlog_update_task`: `modifiedFiles` объединяется с текущим `task.modified_files` (существующие первыми, новые в конце, без дубликатов) вместо полной замены
- [x] #2 `backlog_finish_phase`: то же поведение — повторный вызов добавляет файлы, а не затирает список
- [x] #3 Повторный вызов с тем же набором даёт `noop` (не ложную запись): сверка «уже так» учитывает нормализованный объединённый набор
- [x] #4 Есть явный способ ПОЛНОЙ замены (`modifiedFilesReplace: true` или эквивалент) — случай опечатки в пути остаётся исправимым без ручной правки файла задачи
- [x] #5 Регресс-тест на сценарий VL-370: два последовательных рана (8 файлов, затем 1 файл) → в задаче 8 файлов; `git_commit` по путям первого рана проходит без `allowForeign`
- [x] #6 Тесты, ожидающие точный список после вызова, приведены в соответствие; `backlog_search {modifiedFiles}` находит задачу по файлу из первого рана
- [x] #7 Схемы инструментов (`tools.ts:233`, `:467`) описывают накопление, а не «полная замена»; `pnpm build && pnpm test` зелёный
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

**Вариант Б** из задачи: по умолчанию `modifiedFiles` **сливается** с текущим `modified_files` (существующие первыми, новые в конце, без дубликатов), полная замена — явным флагом `modifiedFilesReplace: true`. Одно поведение в двух точках записи (`backlog_update_task` и `backlog_finish_phase`), одна общая функция слияния — чтобы через полгода точки не разъехались (класс VL-369: «одна логика в двух копиях»).

## Файлы и точки правки

### 1) `src/mcp/tools.ts` — общая функция слияния (новый хелпер рядом с `buildTaskUpdates`, ~перед `:1350`)

```ts
/** Слияние modified_files: существующие первыми, новые в конце, без дублей (VL-376). */
function mergeModifiedFiles(current: unknown, incoming: string[]): string[] {
  const base = Array.isArray(current) ? current.map(String) : [];
  const out: string[] = [];
  for (const p of [...base, ...incoming]) {
    const path = p.trim();
    if (path !== '' && !out.includes(path)) out.push(path);
  }
  return out;
}
```
Пустые строки отбрасываются (иначе `git_commit`/`backlog_search` получат мусорный путь). Порядок: текущие → новые, дедуп по точному совпадению строк.

### 2) `src/mcp/tools.ts:1376-1378` — `buildTaskUpdates`

```ts
// VL-376: накопление, а не замена — повторный ран фазы больше не стирает историю
if (args.modifiedFiles !== undefined) {
  const files = args.modifiedFiles as string[];
  updates.modified_files = args.modifiedFilesReplace === true
    ? files
    : mergeModifiedFiles(current.modified_files, files);
}
```
`current` уже приходит в `build(args, cwd, current)` — см. `src/mcp/update-pipeline.ts:194`.

### 3) `src/mcp/tools.ts:1902-1910` — `toolFinishPhase`

Заменить присваивание на ту же ветку (сигнатура `task` доступна: читается в начале функции, `:1803`):
```ts
const files = args.modifiedFiles as string[];
updates.modified_files = args.modifiedFilesReplace === true ? files : mergeModifiedFiles(task.modified_files, files);
filesPart = `файлов: ${(updates.modified_files as string[]).length}`;
```
`filesPart` показывает **итоговый** размер списка (существующий тест `server.test.mjs:447` ждёт `файлов: 1` на пустой задаче — итог совпадает).

### 4) `src/mcp/tools.ts:2005` — авто-отчёт фазы

`files:` в `buildAutoReport` сейчас берёт `args.modifiedFiles ?? task.modified_files`. Заменить на `updates.modified_files ?? task.modified_files` — отчёт должен называть **итоговый** набор, иначе он снова врёт (симптом «finalSummary ссылается на неполный список»).

### 5) `src/mcp/tools.ts:107-111` — `UPDATE_TASK_FIELDS`

Добавить `'modifiedFilesReplace'` в список. **Без этого** флаг попадёт в `skipped` как «неизвестное поле» (`collectSkipped`/`unknownFields`, `src/mcp/update-pipeline.ts:279-292`) и ответ будет утверждать, что флаг не применён. Порядок — рядом с `modifiedFiles`.

### 6) Схемы (`src/mcp/tools.ts:233` и `:467`)

- `:233` (`backlog_update_task`): `description: 'Изменённые файлы: накопление с дедупликацией (существующие первыми, новые в конце); modifiedFilesReplace: true — полная замена'`
- то же для `:467` (`backlog_finish_phase`).
- В обе схемы добавить свойство `modifiedFilesReplace: { type: 'boolean', description: 'true — ПОЛНАЯ замена modified_files вместо накопления (исправление ошибочного пути)' }`.

### 7) `src/mcp/git-commit.ts` — правок НЕ требует (проверить)

`foreignPaths` (`:168-187`) читает `task.modified_files` и сверяет по правилу «точное совпадение или префикс-директория». Более полный список только ослабляет отказ — регрессии нет.

## Порядок действий

1. Хелпер `mergeModifiedFiles` + две точки записи (п. 2, 3) + `filesPart`/авто-отчёт (п. 3, 4) — это ядро AC1/AC2.
2. `UPDATE_TASK_FIELDS` (п. 5) — иначе флаг «молча skipped».
3. Схемы (п. 6).
4. Тесты (ниже).
5. `pnpm build && pnpm test` — полный прогон (DoD «Тесты проходят»).
6. Документация — через MCP `document_update` (doc-8 уже открыт: строки `102` и `224`), см. ниже.

## Тесты

**Новые в `src/mcp/update-pipeline.test.mjs`** (файл уже изолирует фазовый env через `clearPhaseEnv()` на уровне файла — VL-374; новый `describe` класть в него, не создавая свой env-хак):
1. AC1: `backlog_update_task` дважды — сначала 8 путей, затем 1 → в задаче 9? **Нет:** сценарий VL-370 — второй набор **входит** в первый. Сначала `['a.ts','b.ts','c.ts']`, затем `['c.ts']` → итог `['a.ts','b.ts','c.ts']` (порядок текущих первым), `applied.modified_files` тот же.
2. AC1: дедупликация — `['a.ts']`, затем `['b.ts','a.ts']` → `['a.ts','b.ts']`.
3. AC3: повтор с тем же набором → `outcome: 'noop'` (не ложная запись). Механика: `merged` совпадёт с `current`, `sameFieldsUpToDate` сравнивает `modified_files` как множество (`SET_FIELDS`, `src/mcp/tool-result.ts:403`) → `unchanged = true` (`src/mcp/update-pipeline.ts:227`). Это уже работает без правок пайплайна — тест фиксирует.
4. AC4: `modifiedFilesReplace: true` → список заменён ровно переданным; повторная замена на другой набор тоже заменяет.
5. AC4: `modifiedFilesReplace` **не** попадает в `skipped`.

**Новые в `src/mcp/server.test.mjs`** (блок `backlog_finish_phase`):
6. AC2: два вызова `backlog_finish_phase` с `['src/a.ts','src/b.ts']`, затем `['src/b.ts']` → в файле оба; сводка второго — `файлов: 2`.
7. AC5 (регресс VL-370): создать задачу, `finish_phase` с 3 путями (первый ран), `finish_phase` со 1 путём из них (второй ран); затем `commitFiles`/`foreignPaths` по путям первого рана → `foreignPaths === []` (коммит без `allowForeign`). Тест удобнее положить в `src/mcp/git-commit.test.mjs` (там уже есть фикстура git-репозитория и импорт `foreignPaths`, `:30-32`) — тогда `backlog_finish_phase` вызывается через тот же `handleToolCall`, доступный в файле (`:30`).
8. AC6: `backlog_search { modifiedFiles: ['<путь первого рана>'] }` находит задачу.

**Ревизия существующих ожиданий** (по grep `modifiedFiles`/`modified_files` в `src/**/*.test.mjs`):
- `server.test.mjs:291` (update_task на пустой задаче → `['src/a.ts','docs/b.md']`) — слияние с `[]` даёт тот же результат, правка не нужна.
- `server.test.mjs:451` и `:509` — то же (задачи без `modified_files`).
- `write-ack.test.mjs`, `write-ack-contract.test.mjs`, `update-invariant.test.mjs` — упоминаний `modifiedFiles` нет (проверено grep'ом), правок не ожидается.

## Документация (DoD)

`backlog/docs/doc-8-MCP-справочник-Vibelogmd.md` через `document_update`:
- строка `102` (`backlog_update_task`): «Изменённые файлы (**накопление с дедупликацией**; `modifiedFilesReplace: true` — полная замена; Фаза 3 пишет, Фаза Close читает)»;
- строка `224` (`backlog_finish_phase`): то же;
- строка `134` (раздел про noop): уточнить, что `modifiedFiles` сравнивается как множество **после слияния**, поэтому повтор с тем же набором — noop;
- в таблицу `backlog_finish_phase` добавить строку `modifiedFilesReplace`.

README не трогать (лимит 150 строк и белый список H2 закреплён `src/web/readme-standard.test.mjs`).

## Риски

1. **Ложная запись вместо noop** (риск из задачи). Снят конструкцией: `updates.modified_files` = объединение → при повторе множество равно текущему → `sameFieldsUpToDate` даёт `unchanged` → noop. Обязательный тест — п. 3 выше.
2. **`finish_phase` всегда пишет файл** (комментарий/статус), поэтому noop там недостижим — это норма, но `filesPart` не должен врать: показываем итог.
3. **Разрастание списка при повторных ранах с опечатками.** Лечится флагом `modifiedFilesReplace`, но модель о нём знает только из описания схемы — формулировку в схеме писать явно (п. 6).
4. **`applied` в ответе теперь возвращает объединённый список**, а не переданный. Тестов, ожидающих обратное, не найдено (grep), но при падении — правка ожидания обоснована (иначе `applied` врёт).
5. **Авто-отчёт** (`:2005`) после правки показывает итоговый набор — существующие проверки ищут подстроку `src/a.ts`, проходят.
6. **Идемпотентность** (`withIdempotency` на `backlog_update_task`) не конфликтует: кэш по `idempotencyKey`, а слияние идемпотентно само по себе.

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `backlog_update_task`: `modified_files` присваивается целиком (полная замена) | `src/mcp/tools.ts:1376-1378` |
| `backlog_finish_phase`: `updates.modified_files = files` — полная замена | `src/mcp/tools.ts:1902-1910` |
| `filesPart` формируется из переданного массива | `src/mcp/tools.ts:1909`, вывод в сводке `:2153` |
| Авто-отчёт берёт `args.modifiedFiles` иначе `task.modified_files` | `src/mcp/tools.ts:2005` |
| `build` вызывается с текущей сущностью: `spec.build(args, cwd, current)` | `src/mcp/update-pipeline.ts:194` |
| `taskSpec.build` = `buildTaskUpdates`, `snapshot` = сама сущность | `src/mcp/tools.ts:1417-1428` |
| Сверка «уже так»: `sameFieldsUpToDate(spec.snapshot(current), comparable, spec.setFields)` | `src/mcp/update-pipeline.ts:221-227` |
| `modified_files` входит в `SET_FIELDS` (сравнение как множества) | `src/mcp/tool-result.ts:403`, `sameValue` `:436-448` |
| Noop-ветка возвращает `ackNoopDetailed` при `unchanged` | `src/mcp/update-pipeline.ts:229-243` |
| `UPDATE_TASK_FIELDS` — список из 19 полей, `modifiedFilesReplace` в нём нет | `src/mcp/tools.ts:107-111` |
| Неизвестное имя поля попадает в `skipped` через `unknownFields` | `src/mcp/update-pipeline.ts:279-292` |
| Схема `backlog_update_task`: `modifiedFiles` — «полная замена modified_files» | `src/mcp/tools.ts:233` |
| Схема `backlog_finish_phase`: то же | `src/mcp/tools.ts:467` |
| `foreignPaths` сверяет пути с `modified_files` задачи (пустой список пропускает проверку) | `src/mcp/git-commit.ts:168-187` |
| `toolFinishPhase` читает `task` в начале, до сборки `updates` | `src/mcp/tools.ts:1800-1803` |
| Тесты фиксируют точный список после одного вызова (`['src/a.ts','docs/b.md']`, `['src/a.ts']`) — на задачах с пустым `modified_files` | `src/mcp/server.test.mjs:291`, `:451`, `:509` |
| `update-pipeline.test.mjs` снимает фазовый env через `clearPhaseEnv()` на уровне файла | `src/mcp/update-pipeline.test.mjs:47-56` |
| doc-8 описывает `modifiedFiles` как «полная замена» в двух таблицах | `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md:102`, `:224` |

## Не проверено (предположения)

1. **`updateTaskFile` не нормализует и не сортирует `modified_files`** (просто пишет массив). Проверить: чтение `src/core/store.ts` (`updateTaskFile`) и `src/core/task.ts:351` (парсинг frontmatter). Если нормализация есть — учитывать её в `mergeModifiedFiles` (иначе двойной дедуп не повредит, но порядок может не сохраниться и тест на порядок упадёт). Действие: сверить фактический порядок в написанном файле задачи.
2. **`modifiedFiles` в `backlog_finish_phase` не проходит через `EntitySpec`** — это отдельная ручная сборка (`toolFinishPhase`), поэтому `spec.comparable` к ней не применим и noop там не будет. Подтверждено чтением: `:1902-1910` внутри `toolFinishPhase`, не в `taskSpec`. Если в файле окажется иной путь записи — план дополнить.
3. **В `templates/phases/*.md` нет формулировки «полная замена modified_files»** (видел только `phase-code.md:44-48` и `phase-do.md:36-40` с «только явные пути ВНЕ backlog/»). Проверить `grep -n "полная замена" templates/` — если найдётся, поправить формулировку вместе со схемами.
4. **Нет иных мест записи `modified_files`, кроме двух точек.** Проверено grep'ом по `src/`: прочие вхождения — чтение (`git-commit.ts:173`, `auto-report.ts:136`, `tools.ts:2005`), фильтр поиска (`tools.ts:2225`, `search.ts:205-213`), парсинг/сериализация (`core/task.ts`). Если Code найдёт ещё одну запись — применить ту же ветку слияния.
5. **`additionalProperties` у схем `backlog_update_task`/`backlog_finish_phase` не задан** (ограничение `false` есть только у `tokenUsage`, `tools.ts:487`), поэтому добавление `modifiedFilesReplace` в схему не потребует правок валидации на входе. Проверить, что MCP-сервер не отбрасывает неизвестные аргументы до `handleToolCall`.
6. **Ни один существующий тест не ожидает `applied.modified_files` равным ровно переданному набору на непустой задаче.** Проверено grep'ом по `src/**/*.test.mjs`; при падении полного прогона — правка ожидания с обоснованием в отчёте фазы.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-08 16:29
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача).
План записан в задачу. Решение — **Вариант Б**: `modifiedFiles` сливается с текущим `modified_files` (текущие первыми, новые в конце, без дублей), полная замена — флагом `modifiedFilesReplace: true`; общий хелпер `mergeModifiedFiles` на обе точки записи.
Файлы к правке (6 → 1 «проверить, правок не требует»):
- `src/mcp/tools.ts` — хелпер слияния; `buildTaskUpdates:1376-1378`; `toolFinishPhase:1902-1910` (+`filesPart` по итоговому списку); авто-отчёт `:2005`; `UPDATE_TASK_FIELDS:107-111` (+`modifiedFilesReplace`, иначе флаг попадёт в `skipped`); схемы `:233`, `:467`.
- `src/mcp/git-commit.ts` — правок не требует (проверено: `foreignPaths:168-187`, полный список только ослабляет отказ).
- Тесты: `src/mcp/update-pipeline.test.mjs` (5 новых: накопление, дедуп, noop при повторе, замена по флагу, флаг не в `skipped`), `src/mcp/server.test.mjs` + `src/mcp/git-commit.test.mjs` (AC2/AC5 регресс VL-370, AC6 `backlog_search`).
- Документация: `doc-8` строки 102/224/134 + строка `modifiedFilesReplace` в таблице `finish_phase` (через `document_update`).
Риски: (1) ложная запись вместо noop — снят конструкцией (объединение сравнивается как множество `SET_FIELDS`, `update-pipeline.ts:227`), обязательный тест; (2) `applied.modified_files` теперь отдаёт объединённый список — тестов с обратным ожиданием не найдено; (3) рост списка при опечатках лечится только флагом, поэтому описание схемы должно называть его явно; (4) `finish_phase` всегда пишет файл — noop там недостижим по природе, `filesPart` показывает итог.
Проверено по коду: 18 утверждений с ссылками `файл:строка` в разделе плана «Проверено по коду». Не проверено (6 предположений для Code-фазы первым шагом): нормализация `modified_files` в `updateTaskFile`/`core/task.ts:351`; отсутствие иных точек записи поля; формулировки «полная замена» в `templates/phases/*.md`; `additionalProperties` у схем; отсутствие тестов на `applied` с точным переданным набором.
---
author: @agent
created: 2026-11-08 16:35
---
Фаза 3 (Code) выполнена. Изменено 3 файла, коммит 60ef1a5.
**Реализация (Вариант Б из плана):**
- `src/mcp/tools.ts` — новый хелпер `mergeModifiedFiles(current, incoming)`: пути trim, пустые отбрасываются, дубли убираются, порядок «существующие первыми, новые в конце».
  - `buildTaskUpdates`: `modified_files` теперь слияние с `current.modified_files`; `modifiedFilesReplace === true` → полная замена.
  - `toolFinishPhase`: то же поведение; `filesPart` показывает ИТОГОВЫЙ размер списка.
  - Авто-отчёт фазы (`buildAutoReport.files`) получает итоговый набор `updates.modified_files`.
  - `UPDATE_TASK_FIELDS` += `modifiedFilesReplace` — без этого флаг попадал в `skipped` как неизвестное поле (проверено тестом).
  - Схемы обоих инструментов: описание «накопление с дедупликацией; `modifiedFilesReplace: true` — полная замена» + свойство `modifiedFilesReplace`.
- `src/mcp/git-commit.ts` — правок не потребовалось (проверено: `foreignPaths` сверяет пути с `modified_files`, более полный список только ослабляет отказ).
**Тесты (6 новых):**
- `src/mcp/update-pipeline.test.mjs` (+6 тестов, describe «VL-376»): AC1 накопление с порядком; AC1 дедупликация; AC3 повтор (в т.ч. другой порядок того же набора) → `noop`, а не ложная запись; AC4 `modifiedFilesReplace: true` убирает ошибочный путь; AC4 флаг не попадает в `skipped`; AC2 `backlog_finish_phase` дважды → список не сокращается, сводка «файлов: 2»; AC6 `backlog_search {modifiedFiles}` находит задачу по файлу ПЕРВОГО рана.
- `src/mcp/git-commit.test.mjs` (+1): AC5 регресс VL-370 — два рана (3 файла, затем 1) → `foreignPaths(root, taskId, [все 3])` пуст, т.е. `git_commit` по путям первого рана проходит без `allowForeign`.
**Проверки:** `pnpm build` — успешно; полный `pnpm test` — 198 файлов, 3741 тест прошёл, 4 skipped (пропуски предсуществующие, в файлах не связанных с задачей; прогон полный). Регрессий нет: существующие ожидания (`server.test.mjs:291/451/509`) не потребовали правок — они работают на задачах с пустым `modified_files`, где слияние даёт тот же результат.
**Что осталось:** документация `doc-8` (строки 102/224/134 + строка `modifiedFilesReplace` в таблице `backlog_finish_phase`) — по правилам фазы Code документы backlog/docs не правятся, их обновляет Close. Это DoD «Документация обновлена» — не отмечаю.
**Замечание по процессу:** изначально схема `backlog_finish_phase` была повреждена (правка вырезала свойство `acChecks`) — файл восстановлен из git и переприменён одним атомарным патч-скриптом; проверено `grep` и сборкой.
---
author: @agent
created: 2026-11-08 16:41
---
Фаза Close выполнена. Ветка vb/vl-376 слита в master (1 коммит `60ef1a5` + merge `3deca12`, дифф: src/mcp/tools.ts, src/mcp/update-pipeline.test.mjs, src/mcp/git-commit.test.mjs). Worktree `.vibelog/worktrees/vl-376` удалена (`--force`: в ней оставался только untracked-симлинк `backlog/references/data`, данных не терялось), ветка `vb/vl-376` удалена (`-d`, была слита).
**Проверки после merge:** `pnpm build` — успешно; ранний точечный фильтр (`update-pipeline`, `git-commit`, `server`, `write-ack` — 133 теста) — зелёный; полный `vitest run` — **199 файлов, 3749 тестов прошли, 4 skipped** (пропуски предсуществующие, вне затронутых модулей). Merge-конфликтов не было, повторных прогонов не потребовалось.
**Документация (DoD 2):** doc-8 (MCP-справочник) — `modifiedFiles` в таблицах `backlog_update_task` и `backlog_finish_phase` описан как накопление с дедупликацией, добавлено свойство `modifiedFilesReplace`; в разделе про noop уточнено, что сверка идёт по итоговому объединённому набору (повтор с тем же набором — `noop`). CHANGELOG — запись в Unreleased. Коммит `8b4a2ab`.
**Урок:** создан lesson-255 «Поле-накопитель в задаче сливай с текущим значением на всех точках записи…», связан с задачей; коммит `04a25d6`.
DoD: тесты проходят (полный прогон зелёный), документация обновлена (doc-8 + CHANGELOG), регрессий нет (существующие ожидания `server.test.mjs:291/451/509` не потребовали правок — они на задачах с пустым `modified_files`).
---
<!-- COMMENTS:END -->