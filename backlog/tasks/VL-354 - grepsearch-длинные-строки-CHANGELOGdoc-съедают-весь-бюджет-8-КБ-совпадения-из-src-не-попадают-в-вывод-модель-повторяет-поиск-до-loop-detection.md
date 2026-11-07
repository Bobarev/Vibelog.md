---
id: VL-354
title: 'grep_search: длинные строки CHANGELOG/doc-* съедают весь бюджет 8 КБ — совпадения из src/ не попадают в вывод, модель повторяет поиск до loop detection'
status: Planned
assignee: []
reporter: ''
created_date: '2026-11-07 15:07'
updated_date: '2026-11-07 15:07'
due_date: ''
labels:
  - agent
  - tools
  - bug
dependencies: []
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Фаза Code VL-353 упала кодом 1 (сессия `agent-1794052713009`): модель трижды повторила `grep_search` с одним паттерном, получила блокировку loop detection и ран прервался.

```
grep_search {pattern:"lastErrorBySignature|parsedErrorText|loopDetectionDirective|errorRepeatOutcome"}
→ вывод (обрезан)
× 3 → Loop detection → fail
```

Повтор был **осмысленным**: результат поиска оказался бесполезен — нужного файла в нём не было.

## Корень

`grep_search` (`src/agent/tools.ts:1415`) собирает совпадения в порядке `walkFiles`, а тот возвращает `out.sort()` — **алфавитный порядок**. Значит `CHANGELOG.md` и `backlog/docs/*` идут раньше `src/`.

Дальше `truncateToolOutput` (`src/agent/tools.ts:92`) режет вывод по **символам** — первые 8 КБ (`TOOL_OUTPUT_MAX_CHARS = 8 * 1024`). А строка `CHANGELOG.md:106` (запись VL-323) — это **одна строка длиной ~4 КБ**, `doc-10:421` — ещё ~2 КБ.

Итог: первые 8 КБ выдачи — две-три строки из CHANGELOG и doc-10. Файл `src/agent/loop.ts`, ради которого модель искала, **в вывод не попал вообще**.

## Три дефекта

1. **`truncateToolOutput` режет по символам, а не по строкам.** Одна гигантская строка съедает весь бюджет. В `read_file` такая защита есть (`READ_LINE_MIN_CHARS`, усечение длинных строк), в `grep_search` — нет.
2. **Порядок выдачи алфавитный, а не по релевантности.** `src/` — в конце, `CHANGELOG.md` — в начале. Для поиска символов это неправильный приоритет.
3. **Маркер обрезки не говорит, что потеряно.** `…[вывод обрезан: показаны первые 8192 из N символов]` — модель не понимает, что именно выпало (файлы `src/`), и повторяет запрос.

## Почему это важно

`grep_search` — один из основных инструментов агента. Пока CHANGELOG и doc-* содержат длинные строки (а они содержат: записи задач пишутся абзацами), любой поиск по общим терминам возвращает мусор вместо кода. Это же касается `search_files` — проверить, есть ли там та же проблема.

## Связанные задачи

VL-353 (инцидент-источник), VL-229 (порог повторов поиска), VL-250/VL-252 (усечение вывода `read_file` — образец решения).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `grep_search` усекает КАЖДУЮ строку-совпадение до разумного предела (по образцу `read_file`: `READ_LINE_MIN_CHARS`/маркер усечения строки), а не только общий вывод — одна гигантская строка не съедает бюджет 8 КБ
- [ ] #2 Маркер усечения строки содержит путь и номер строки, чтобы модель могла прочитать её через `read_file "файл:N"`
- [ ] #3 Порядок выдачи приоритезирован: файлы `src/` идут раньше `backlog/` и корня (или сортировка по числу совпадений в файле убыв.), а не чистый алфавит `walkFiles`
- [ ] #4 Маркер общей обрезки сообщает, сколько совпадений/файлов НЕ показано, и подсказывает сузить `path`/`glob`
- [ ] #5 Регресс-тест на сессию `agent-1794052713009`: поиск по паттерну, встречающемуся в `CHANGELOG.md` (строка ~4 КБ) и в `src/agent/loop.ts`, возвращает совпадения из `src/` в пределах 8 КБ
- [ ] #6 Тест: одна строка-совпадение длиной 20 КБ усекается, остальные совпадения в выдаче присутствуют (сейчас тест `tools.test.mjs:493` проверяет только наличие маркера обрезки)
- [ ] #7 Тест: порядок выдачи — `src/...` раньше `CHANGELOG.md` при равном числе совпадений
- [ ] #8 `pnpm build && pnpm test` проходят без регрессий
- [ ] #9 Документация: doc-10 (поведение `grep_search`: усечение строк, приоритет выдачи), CHANGELOG.md
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

- `src/agent/tools.ts` — `makeGrepSearch` (~:1415), `truncateToolOutput` (~:92).
- `src/agent/search-files.ts` — проверить `searchProjectFiles` на ту же проблему.
- Тесты: `src/agent/tools.test.mjs`, `src/agent/search-files.test.mjs`.
- Документация: `backlog/docs/doc-10`, `CHANGELOG.md`.

## Шаг 1. Усечение длинных строк-совпадений

`src/agent/tools.ts`, в `makeGrepSearch` при сборке `matches`:

```ts
const MATCH_LINE_MAX_CHARS = 300;   // бюджет одной строки выдачи
const line = lines[i];
const shown = line.length <= MATCH_LINE_MAX_CHARS
  ? line
  : `${line.slice(0, MATCH_LINE_MAX_CHARS)}…[строка усечена: ${line.length} символов, читай read_file "${file.relOut}:${i + 1}"]`;
matches.push(`${file.relOut}:${i + 1}:${shown}`);
```

Почему 300: при 8 КБ бюджета это ~25 совпадений в выдаче вместо 2–3. Маркер содержит готовый `path` для `read_file` — модель не гадает.

## Шаг 2. Приоритет выдачи

`walkFiles` возвращает `out.sort()` (алфавит). В `makeGrepSearch` после сбора `rootFiles` — переупорядочить:

```ts
const PRIORITY_PREFIXES = ['src/', 'templates/', 'scripts/', 'web/src/'];
function pathPriority(rel: string): number {
  const idx = PRIORITY_PREFIXES.findIndex(p => rel.startsWith(p));
  return idx === -1 ? PRIORITY_PREFIXES.length : idx;
}
rootFiles.sort((a, b) => pathPriority(a.relOut) - pathPriority(b.relOut) || a.relOut.localeCompare(b.relOut));
```

Порядок: код (`src/`, `templates/`, `scripts/`, `web/src/`) → остальное (`backlog/`, корень) по алфавиту. `walkFiles` не трогать — он общий с `glob`/`search_files`, менять его сортировку нельзя.

## Шаг 3. Маркер обрезки с потерями

`truncateToolOutput` (`:92`) — общий для всех инструментов, менять его сигнатуру не нужно. В `makeGrepSearch` считать, сколько совпадений реально попало в вывод:

```ts
const joined = matches.join('\n') + suffix;
const out = truncateToolOutput(joined);
if (out.length < joined.length) {
  const shownCount = out.split('\n').length - 1;   // без строки-маркера
  return out + `\n…[показано ${shownCount} из ${matches.length} совпадений; сузь path или glob]`;
}
return out;
```

Маркер `…[вывод обрезан` (lesson-76, на него матчат тесты) сохраняется — он приходит из `truncateToolOutput`.

## Шаг 4. Проверить `search_files`

`src/agent/search-files.ts:242` — `searchProjectFiles` использует тот же `walkFiles` и тот же `truncateToolOutput`. Проверить:

- есть ли усечение длинных строк (вероятно, нет);
- какой порядок выдачи.

Если проблема та же — применить те же два приёма (усечение строки + приоритет). Если `search_files` уже усекает строки — зафиксировать тестом и не трогать.

## Шаг 5. Тесты

`src/agent/tools.test.mjs`:

- **регресс `agent-1794052713009`**: файл `CHANGELOG.md` со строкой 4 КБ, содержащей паттерн, + `src/agent/loop.ts` с тем же паттерном → выдача содержит `src/agent/loop.ts`, длина ≤ 8 КБ + маркер;
- одна строка 20 КБ усекается, остальные совпадения присутствуют (существующий тест `:493` проверяет только маркер — расширить);
- порядок: `src/...` раньше `CHANGELOG.md`;
- маркер обрезки содержит «показано N из M совпадений».

`src/agent/search-files.test.mjs` — аналогичный кейс, если шаг 4 выявил проблему.

## Шаг 6. Проверка и документация

- `pnpm build && pnpm test` — полный прогон.
- Ручная проверка: `grep_search {pattern:"loopDetectionDirective"}` → в выдаче есть `src/agent/loop.ts`, а не только CHANGELOG.
- `backlog/docs/doc-10`: поведение `grep_search` — усечение строк, приоритет выдачи, маркер потерь.
- `CHANGELOG.md` → `## [Unreleased]` / «Исправлено».

## Риски

- **Усечение строки может отрезать само совпадение.** Если паттерн встретился в позиции 5000 длинной строки, в первых 300 символах его не будет — модель увидит «совпадение есть», но не поймёт контекст. Смягчение: маркер с `read_file "файл:N"` даёт точный путь; при желании — центрировать окно вокруг позиции совпадения (усложнение, решить по факту).
- **Приоритет по префиксу — эвристика.** Проект может иметь другую структуру; список префиксов вынести в константу с комментарием.
- **`truncateToolOutput` общий** — не менять его поведение, иначе поедут тесты `read_file`/`run_shell_command`.
- **`search_files` может иметь ту же проблему** — шаг 4 обязателен, иначе фикс закроет половину инцидента.
<!-- SECTION:PLAN:END -->