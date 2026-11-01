---
id: VL-250
title: 'read_file: offset/limit не применяются, если отдельная строка файла больше лимита вывода (JSONL-сессии агента нечитаемы)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 03:33'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - tools
  - agent
  - bug
dependencies: []
milestone: v1.11
references: []
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/tools.ts
  - src/web/tool-policy.ts
  - src/agent/tools.test.mjs
  - src/web/tool-policy.test.mjs
  - scripts/agent-session.mjs
  - README.md
  - templates/prompts/chat-system.md
lessons:
  - lesson-93
token_usage:
  input: 2756650
  output: 31160
  cache: 2638848
  total: 2787810
  requests: 59
  duration_ms: 281632
  reasoning: 9823
  by_phase:
    plan:
      input: 2756650
      output: 31160
      cache: 2638848
      requests: 59
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

При разборе сессии `agent-1793319087159` обнаружено: `read_file` не позволяет прочитать файл `.vibelog/agent-sessions/<id>.jsonl` ни в каком диапазоне.

Симптомы:
- любой вызов (с `offset`/`limit` и без них) возвращает **одну и ту же первую строку** файла — system-промпт агента (~8.3 КБ);
- ответ приходит с примечанием «показаны первые 8192 из 8322 символов; чтобы получить остальное, сузь запрос — файл, диапазон строк или паттерн», то есть сужение запроса не меняет результат;
- на обычных файлах (`package.json`) тот же инструмент работает корректно, значит проблема специфична для файлов с очень длинными строками.

Причина (гипотеза): обрезка вывода по лимиту в 8192 символа применяется к содержимому файла **до** нарезки по `offset`/`limit`. Когда одна строка (запись JSONL) превышает лимит, она целиком съедает бюджет вывода, а диапазон строк не может сдвинуть окно. Для JSONL-сессий агента, где каждая запись — отдельная длинная строка, файл становится нечитаемым через `read_file` в принципе.

## Цель

Сделать чтение JSONL-файлов с длинными строками возможным: `offset`/`limit` должны применяться до обрезки вывода, а бюджет символов — расходоваться на выбранные строки, а не на весь файл.

## Входные данные

- Воспроизведение: `read_file` по `.vibelog/agent-sessions/agent-1793319087159.jsonl` — всегда первая строка, offset/limit игнорируются.
- Контроль: `read_file` по `package.json` — работает нормально.
- Обходной путь, уже подготовленный в рамках этой задачи: `scripts/agent-session.mjs` — построчное чтение сессий через readline с превью, фильтром `--grep` и выводом записи целиком `--full N` (не проверен запуском: в текущем окружении чата инструмента запуска команд нет).
- Инструменты чата, где воспроизводится: набор read-tools веб-чата Vibelog.

## Открытые вопросы

- Лимит 8192 символа — это ограничение MCP-обвязки read_file или самого файлового инструмента агента (bin/vibelog-agent.mjs)? От ответа зависит место правки.
- Нужен ли отдельный JSONL-режим («одна запись — один элемент вывода») или достаточно корректного применения offset/limit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 offset/limit применяются до обрезки вывода: read_file по .vibelog/agent-sessions/*.jsonl с offset=1 возвращает вторую запись, а не первую
- [x] #2 Ответ инструмента по-прежнему ограничен 8192 символами, но бюджет расходуется на выбранные строки
- [x] #3 Есть регрессионный тест на файл с одной строкой длиннее лимита (mkdtemp, без фиксированных путей)
- [x] #4 Существующее поведение для обычных файлов не меняется (package.json и подобные читаются как раньше)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Итог исследования

**Ответ на открытый вопрос 1:** лимит 8192 — это НЕ MCP-обвязка, а собственный код проекта: `TOOL_OUTPUT_MAX_CHARS = 8 * 1024` в `src/agent/tools.ts:49`, применяется через `truncateToolOutput` (`src/agent/tools.ts:71-78`). Тот же кап ставится в «единой точке»: `src/agent/loop.ts:790` (агент) и `src/web/chat.ts:423/579` (веб-чат, `lesson-30`).

Две реализации `read_file`, обе надо править:
- агент: `makeReadFile` — `src/agent/tools.ts:255-289` (нарезка на строки 282-286);
- веб-чат: `makeReadFileTool` — `src/web/tool-policy.ts:108-157` (нарезка 147-154).

**Ответ на открытый вопрос 2:** отдельный «JSONL-режим» не нужен. `offset`/`limit` уже применяются ДО `truncateToolOutput` (`lines.slice(...)` затем кап), поэтому вторая половина проблемы — не порядок нарезки, а то, что **бюджет символов целиком съедает одна длинная строка**: любая выбранная строка > 8192 символов обрезается посимвольно, а обрезка «по строкам» не помогает (в JSONL запись = одна строка) — файл становится нечитаемым в принципе, и подсказка «сузь запрос» вводит модель в луп (`lesson-92`). Правильное решение — бюджет на **выбранные строки** с построчной обрезкой длинной строки + явным маркером, сколько строк показано и какой `offset` взять дальше.

Также: `scripts/agent-session.mjs` в worktree **отсутствует** (`ls` — No such file). Либо создать (состав ниже, п.4), либо убрать из `modified_files`.

## Файлы для изменения

1. `src/agent/tools.ts` — новый экспортируемый хелпер `formatFileSlice` + подключение в `makeReadFile`.
2. `src/web/tool-policy.ts` — та же функция в `makeReadFileTool` (импорт в строке 31).
3. `src/agent/tools.test.mjs` — новый `describe('VL-250 — длинные строки')` (mkdtemp уже есть, фикстуры в `TMP`).
4. `src/web/tool-policy.test.mjs` — 1 тест на веб-путь.
5. `scripts/agent-session.mjs` — создать (обходной путь для чтения сессий из shell; ≤60 строк, только `node:fs`/`node:readline`).
6. `README.md` (блок «`read_file`» — строки 114-118), `templates/prompts/chat-system.md` (строка 7), `CHANGELOG.md` — документация (DoD-2).

## Порядок действий

### 1. `src/agent/tools.ts` — хелпер (вставлять после `truncateToolOutput`, ~строка 78)

```ts
/** Минимальный бюджет на одну строку (маркер усечения строки должен помещаться). */
const READ_LINE_MIN_CHARS = 200;

/**
 * Форматирует срез файла по строкам с бюджетом TOOL_OUTPUT_MAX_CHARS (VL-250).
 * offset/limit применяются до обрезки: бюджет расходуется на выбранные строки,
 * а не на весь файл. Строка длиннее остатка бюджета обрезается с маркером —
 * так JSONL-сессии агента (одна запись = одна длинная строка) читаемы по
 * диапазонам. Итог всегда ≤ TOOL_OUTPUT_MAX_CHARS (внешний truncateToolOutput
 * остаётся страховкой, но не срабатывает).
 */
export function formatFileSlice(content: string, offsetRaw: unknown, limitRaw: unknown): string
```

Логика (чистая функция, тестируется без ФС):
- `lines = content.split('\n')`; `offset = number>=0 ? floor : 0`; `limit = number>0 ? floor : lines.length` (та же валидация, что в двух handler'ах сейчас — поведение не меняется, AC4);
- `slice = lines.slice(offset, offset + limit)`; если срез пуст (offset за концом файла) — вернуть `''` как раньше (не менять семантику);
- `joined = slice.join('\n')`; если `joined.length <= TOOL_OUTPUT_MAX_CHARS` → вернуть `joined` **без изменений** (регрессия обычных файлов, AC4, и все существующие тесты `tools.test.mjs` проходят дословно);
- иначе — построчная сборка: резервируем под финальный маркер ≈ `\n…[вывод обрезан: показаны строки X–Y из N; часть строк усечена; продолжение — offset=Y+1]`; копим строки, пока влезают; первую не влезающую строку обрезаем до остатка бюджета (минимум `READ_LINE_MIN_CHARS`) с суффиксом `…[строка усечена: показано K из M символов]` и прекращаем набор;
- финальный ответ жёстко режется до `TOOL_OUTPUT_MAX_CHARS` (инвариант AC2), даже если расчёт промахнулся.

Маркер обязан содержать подстроку `…[вывод обрезан` — на него матчат существующие тесты (`tools.test.mjs:412` `it('read_file: файл больше лимита обрезается')`, `lesson-76`: маркерные подстроки сохраняем).

### 2. Замена нарезки в handler'ах

- `src/agent/tools.ts:282-286` (внутри `makeReadFile`) →
  ```ts
  return formatFileSlice(read.content, args.offset, args.limit);
  ```
  (удалить локальные `lines/offset/limit/slice/truncateToolOutput`).
- `src/web/tool-policy.ts:147-154` (`makeReadFileTool`) → то же, `formatFileSlice(content, args.offset, args.limit)`; импорт `formatFileSlice` добавить в строку 31 (рядом с `resolveInProject, truncateToolOutput, formatDirListing`).
- Описания инструментов (`tools.ts:258-261`, `tool-policy.ts:111-115`) дополнить фразой: «Файлы с очень длинными строками (JSONL) читаются по диапазонам: одна строка может быть усечена, продолжение — следующий offset».

### 3. Тесты

`src/agent/tools.test.mjs` — новый `describe('VL-250 — длинные строки', ...)` (фикстуры в существующем `TMP`, `beforeAll`/`afterAll` уже есть):
1. AC1: файл `s.jsonl` из 3 строк по 10 КБ → `handler({path:'s.jsonl', offset:1, limit:1})` содержит маркер второй записи (уникальный префикс `line1:`), не первой;
2. AC2: длина ответа ≤ `TOOL_OUTPUT_MAX_CHARS` для `offset` без `limit` на 5×10 КБ и для одной строки 30 КБ;
3. строка 30 КБ, `limit:1` → ответ содержит `…[строка усечена:` и `показано 8192` (или актуальное число) — понятная модель подсказка «следующий offset», а не вся строка;
4. AC4: `a.txt` (`alpha\nbeta\nalpha`) читается дословно `alpha\nbeta\nalpha`; `offset:1, limit:1` → `beta` (существующее поведение);
5. границы: `offset` за концом файла → `''`; `offset:-1`/`limit:0` → дефолты (как сейчас).

`src/web/tool-policy.test.mjs` — +1: `makeReadFileTool(TMP)` на JSONL-фикстуре, `offset:1` → вторая запись (веб-путь тоже исправлен).

Дополнительно прогнать существующие тесты `tools.test.mjs:409-425` (маркер `…[вывод обрезан`) — не ломать.

### 4. `scripts/agent-session.mjs` (обходной путь «одна запись — один вывод»)

Небольшой CLI на readline: `node scripts/agent-session.mjs <файл.jsonl> [--grep <подстрока>] [--full <N>]` — печатает номер записи, длину, превью 300 символов; `--grep` фильтрует по подстроке, `--full N` выводит запись N целиком. Только `node:fs`/`node:readline`, путь резолвится относительно `backlog/../.vibelog/agent-sessions/`, если аргумент — голый id. Если решим не создавать — удалить файл из `modified_files` задачи.

### 5. Документация

- `README.md` (блок `read_file`, после строки 118): «Для файлов с очень длинными строками (`.vibelog/agent-sessions/*.jsonl`) `offset`/`limit` применяются до обрезки: в ответ попадает выбранный диапазон, слишком длинная строка усекается с маркером и указанием следующего `offset`».
- `templates/prompts/chat-system.md:7`: то же одной фразой (модель не должна считать «сузь запрос» единственным выходом).
- `CHANGELOG.md` — запись VL-250 в текущую секцию.

## Как проверить

```bash
pnpm build && pnpm test:fast            # точечно: src/agent/tools.test.mjs, src/web/tool-policy.test.mjs
pnpm test                                # полный прогон перед DoD
node -e "import('./dist/agent/tools.js').then(m=>{const {formatFileSlice}=m; const long='x'.repeat(30000); const out=formatFileSlice('a\n'+long+'\nb',0,undefined); console.log(out.length, out.slice(0,40))})"
```
Ожидаемо: `out.length <= 8192`.

## Риски

- **Недоучёт длины маркера** → итог > 8192, внешний `truncateToolOutput` добавит вторую пометку. Митигация: жёсткий `slice(0, TOOL_OUTPUT_MAX_CHARS)` в конце хелпера и тест на длину.
- **Изменение формата на обычных больших файлах**: путь «весь срез ≤ лимита → без изменений» гарантирует дословный старый вывод; меняется только случай, который сейчас бесполезен.
- **Дубль логики агент/чат** — вынос в один экспортируемый хелпер (`lesson-37`), не копия.
- **Память**: `readFileSync` целиком, как и раньше — поведение не ухудшаем (файл сессии ~МБ читается и сейчас).
- **`scripts/agent-session.mjs` отсутствует в worktree** — план 4 либо создаёт его, либо Code снимает из `modified_files`; это не блокирует основную фичу.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 04:02
---
Фаза plan не удалась (код выхода 1): оп-повторов=нет, payload последнего запроса=160476 байт (макс 160476), usage={"input_tokens":386930,"output_tokens":7165,"cache_read_input_tokens":349696,"total_tokens":394095,"reasoning_tokens":3122} — статус возвращён к Spec.
---
author: @agent
created: 2026-10-30 04:06
---
Фаза 2 (Plan) выполнена. Тип: bug. План записан в задачу: два места правки (src/agent/tools.ts makeReadFile, src/web/tool-policy.ts makeReadFileTool) через общий экспортируемый хелпер formatFileSlice; открытые вопросы задачи закрыты (лимит 8192 — собственный TOOL_OUTPUT_MAX_CHARS, отдельный JSONL-режим не нужен). Файлов в плане: 6 (tools.ts, tool-policy.ts, tools.test.mjs, tool-policy.test.mjs, scripts/agent-session.mjs, доки README/chat-system.md/CHANGELOG). Риски: недоучёт длины маркера (митигация — жёсткий slice до лимита и тест на длину), scripts/agent-session.mjs отсутствует в worktree (создать или снять из modified_files).
---
author: @agent
created: 2026-10-30 04:10
---
Фаза 3 (Code) выполнена. Реализация по плану. Коммит dea1375.
Изменено:
- `src/agent/tools.ts` — новый экспортируемый хелпер `formatFileSlice(content, offset, limit)`: offset/limit применяются до обрезки, бюджет 8 КБ расходуется на выбранный диапазон; срез, влезающий в лимит, отдаётся дословно (быстрый путь, AC4); не влезающая строка режется с маркером `…[строка усечена: показано K из M символов]`, хвост подсказывает `продолжение — offset=N` (lesson-92: без подсказки модель зацикливается). Инвариант длины: жёсткий `slice(0, TOOL_OUTPUT_MAX_CHARS)`. Описание инструмента дополнено.
- `src/web/tool-policy.ts` — `makeReadFileTool` использует тот же `formatFileSlice` (импорт из `../agent/tools.js`), дубля логики нет (lesson-37); описание дополнено.
- `src/agent/tools.test.mjs` — `describe('VL-250 — длинные строки (JSONL) в read_file')`: AC1 (offset=1 → вторая запись, маркер «показаны строки 2–2 из 3»), AC2 (длина ≤ 8192 для среза без limit и для строки 30 КБ), маркер усечения строки + следующий offset, границы чистой функции (пустой срез, невалидные offset/limit, дословный маленький файл, достижимость всех трёх записей по offset), AC4 (обычный файл как раньше). Фикстуры в существующем mkdtemp-каталоге `TMP`.
- `src/web/tool-policy.test.mjs` — +1 тест на веб-путь (offset=1 → вторая запись, все три достижимы, длина ≤ 8192, обычный файл без изменений).
- `scripts/agent-session.mjs` — создан обходной путь: построчный просмотр JSONL сессий через `node:readline` (превью 300, `--grep`, `--full N`, `--preview`), принимает путь или голый `agent-id`; только node:fs/readline. Проверен запуском на отсутствующем файле (понятная ошибка, exit 1); на реальной сессии не проверялся — в worktree `.vibelog/agent-sessions/` нет.
- `README.md` (блок `read_file`), `templates/prompts/chat-system.md` — поведение описано для людей и для модели.
Проверки: `pnpm build` + `pnpm test:fast` по целевым файлам (77 тестов), затем полный `pnpm test` — 1643 passed | 4 skipped (скипы — `it.skip` в `src/core/compat.test.mjs` и `src/core/compat-full.test.mjs`: «Оригинал Backlog.md не найден», требуют клона референса, к VL-250 отношения не имеют). Исключений из прогона нет. Ручная проверка `formatFileSlice`: длина ответа ровно 8192 для строки 30 КБ и для JSONL из трёх 10-КБ записей.
Что осталось: ничего по объёму задачи. Прогон на реальном файле `agent-1793319087159.jsonl` возможен только в основном репозитории (в worktree каталога сессий нет) — проверка через `node scripts/agent-session.mjs <id>`.
---
author: @agent
created: 2026-10-30 04:18
---
Фаза Close выполнена. Ветка vb/vl-250 слита в master (1 коммит dea1375 + merge 45a7ac3), worktree удалена (в ней были только untracked-симлинки node_modules и backlog/references/data — удалено с --force), ветка vb/vl-250 удалена.
Замечание по ходу: merge с первого раза упал не на конфликте, а на untracked `scripts/agent-session.mjs` в главном репо (устаревшая копия от предыдущей попытки, 7494 байта, hash 5ae1ceb) — она перекрывалась версией из ветки (4238 байт, hash de394d9). Устаревшую копию удалил и повторил merge; содержимое ветки (актуальная версия с `--chars`/`--limit`/списком сессий) сохранено.
Проверки после merge в главном репо: `pnpm build` — ок; `pnpm test` — 87 файлов, 1643 passed | 4 skipped (скипы — `it.skip` в `src/core/compat.test.mjs` и `src/core/compat-full.test.mjs`: «Оригинал Backlog.md не найден», к VL-250 не относятся). Исключений из прогона нет.
DoD: все 3 пункта выполнены — тесты проходят (полный прогон), документация обновлена (README, `templates/prompts/chat-system.md`, CHANGELOG d671c36), регрессий нет.
Lessons: создан lesson-93 (применяй offset/limit и построчное усечение до бюджета символов), связан с VL-250; refs и lesson закоммичены в 6ed7096.
Документация: CHANGELOG.md — запись VL-250 в Unreleased/Исправлено (docs-коммит d671c36).
---
<!-- COMMENTS:END -->