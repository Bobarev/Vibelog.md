---
id: VL-343
title: 'docs: актуализировать MCP-SETUP.md (29 → 45 инструментов, добавить lesson_*/project_map/supervisor/git_commit) и удалить пустой doc-15'
status: In Progress
assignee: []
reporter: ''
created_date: '2026-11-05 13:23'
updated_date: '2026-11-07 10:27'
due_date: ''
labels:
  - docs
  - mcp
  - repo-hygiene
dependencies: []
milestone: ''
references: []
priority: ''
type: docs
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - MCP-SETUP.md
lessons: []
token_usage:
  input: 1247077
  output: 16804
  cache: 1135104
  total: 1263881
  requests: 33
  duration_ms: 322944
  reasoning: 10683
  by_phase:
    code:
      input: 876941
      output: 14538
      cache: 785920
      requests: 22
    close:
      input: 370136
      output: 2266
      cache: 349184
      requests: 11
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Мелочи документации из doc-22 §1.4 и §2.1/§2.2. Нулевой риск для релиза: правки только в `.md`, ни строки кода — можно ставить в любой момент параллельно задачам doc-25.

**Проблема 1 — `MCP-SETUP.md` отстал на 16 инструментов.** Строка 37: «Всего 29 инструментов. Полный список с параметрами — в MCP-справочнике». Фактически в реестре 45 (`src/mcp/tools.ts`, `doctor.ts` ждёт 45). В таблице отсутствуют все `lesson_*` (8 + `lesson_classify`), `project_map`, `backlog_trigger_phase`, `backlog_phase_status`, `backlog_auto_queue`, `backlog_supervisor`, `backlog_finish_phase`, `git_commit`. MCP-SETUP.md — первое, что читает новый пользователь.

**Проблема 2 — пустая запись в корпусе документов.** `doc-15`: `title: ""`, `content: ""`, создан 2026-10-29 — мусор, который виден в `document_list`.

**Цель:** привести MCP-SETUP.md в соответствие с реестром (и заодно сверить doc-8), удалить doc-15. Никакой код не меняется.

**Связанные:** VL-340 (инварианты doctor вместо числа) — эта задача снимает часть той же боли со стороны документации; выполнять можно независимо.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `MCP-SETUP.md`: строка «Всего 29 инструментов» заменена на фактическое число из реестра (`listTools()`), в тексте больше нет устаревших счётчиков
- [x] #2 `MCP-SETUP.md`: в таблицу добавлены отсутствующие группы — все `lesson_*` (включая `lesson_classify`), `project_map`, `backlog_trigger_phase`, `backlog_phase_status`, `backlog_auto_queue`, `backlog_supervisor`, `backlog_finish_phase`, `git_commit`
- [x] #3 `MCP-SETUP.md`: набор имён в таблице сверен с `listTools()` программно (grep/скрипт), расхождений нет — имена совпадают посимвольно
- [x] #4 `MCP-SETUP.md`: строки, описывающие поведение инструментов, не переписаны заново — только отсутствующее добавлено, существующие описания сохранены
- [ ] #5 doc-15 (пустой документ: `title: ""`, `content: ""`) удалён из корпуса; `document_list` больше его не показывает, `document_view doc-15` отдаёт «не найден»
- [x] #6 Проверено, что на doc-15 нет ссылок: `search_files` по `doc-15` в `backlog/`, `src/`, `web/src/`, `templates/` — при наличии ссылок они обновлены или явно указаны в итоговом отчёте
- [x] #7 Документ `doc-8` (MCP-справочник) сверен с реестром на тот же дрейф; расхождения либо исправлены, либо перечислены в комментарии к задаче
- [ ] #8 CHANGELOG.md обновлён (строка `docs`)
- [x] #9 `pnpm build && pnpm test` зелёные (правка документации не должна ломать тесты счётчиков — если тест ловит число в MCP-SETUP.md, он обновлён осознанно)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

- `MCP-SETUP.md` — правка таблицы и счётчика.
- `doc-8` (MCP-справочник) — сверка, при необходимости дополнение.
- `backlog/docs/doc-15...md` — удаление (файл пустой; имя файла уточнить листингом `backlog/docs/`).
- `CHANGELOG.md`.

## Шаг 1. Получить фактический список инструментов

Источник правды — `listTools()` из `src/mcp/tools.ts`:

```
node -e "import('./dist/mcp/tools.js').then(m=>console.log(m.listTools().map(t=>t.name).sort().join('\n')))"
```

(после `pnpm build`). Число и набор имён — из этого вывода, а не из задачи: к моменту выполнения реестр может вырасти.

## Шаг 2. Сверка MCP-SETUP.md

1. Заменить «Всего 29 инструментов» на «Всего N инструментов» по факту (или на формулировку без числа — «полный список ниже», чтобы не заводить новый дрейф; предпочтительно второе + число в одном месте).
2. Добавить в таблицу отсутствующие строки, сохранив существующий формат колонок и стиль описаний: `lesson_list`, `lesson_create`, `lesson_view`, `lesson_update`, `lesson_search_lessons`, `lesson_link`, `lesson_supersede`, `lesson_audit`, `lesson_classify`, `project_map`, `backlog_trigger_phase`, `backlog_phase_status`, `backlog_auto_queue`, `backlog_supervisor`, `backlog_finish_phase`, `git_commit` (плюс всё, что найдётся при сверке).
3. Механическая проверка расхождений: скрипт grep по `MCP-SETUP.md` на каждое имя из `listTools()` — каждое должно встречаться; и обратно — каждое имя в таблице должно быть в реестре. Расхождение → правка.

## Шаг 3. Сверка doc-8

Тот же скрипт по `backlog/docs/doc-8-*.md`. doc-8 исторически актуален (VL-164, VL-235, VL-291 его правили), но проверить надо: перечислить расхождения в комментарии к задаче даже если править не пришлось.

## Шаг 4. Удалить doc-15

1. `read_file("backlog/docs")` — найти файл с пустым frontmatter (`title: ""`).
2. `search_files` по `doc-15` в `backlog/`, `src/`, `web/src/`, `templates/`, `MCP-SETUP.md`, `README.md` — убедиться, что ссылок нет.
3. Удалить файл (через `write_file` нельзя — это удаление; использовать shell `rm` в фазе Code, это write-операция с подтверждением).
4. Проверить `document_list` — doc-15 отсутствует, `document_view doc-15` — ошибка «не найден».

## Шаг 5. CHANGELOG и проверка

- Строка в `### Изменено` (или `### Добавлено`): «документация MCP-SETUP.md актуализирована (N инструментов вместо 29), удалён пустой doc-15».
- `pnpm build && pnpm test`: если какой-то тест читает число из MCP-SETUP.md — обновить его осознанно (grep `MCP-SETUP` в `src/**/*.test.mjs`).

## Риски

- **Новый дрейф.** Число в тексте снова отстанет при следующем инструменте. Поэтому в п.2 шага 2 предпочтительна формулировка без числа + таблица как единственный источник. Радикальное решение (генерация таблицы из `listTools()`) — вне этой задачи, кандидат в отдельную.
- **Удаление doc-15 через `rm`** — write-операция с подтверждением; если файл окажется не пустым (проверить `content` перед удалением), задачу вернуть в Plan, а не удалять «на всякий случай».
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-07 10:06
---
Фаза 3 (Code) выполнена. Коммит 676ace1.
**Что сделано**
- `MCP-SETUP.md`: счётчик «Всего 29 инструментов» → «Всего 45 инструментов» (факт из `listTools()` после `pnpm build`). В таблицу добавлен 21 отсутствовавший инструмент: `document_list/view/create/update/search`, `lesson_list/view/create/update/search_lessons/link/supersede/audit/classify`, `project_map`, `git_commit`, `backlog_trigger_phase/phase_status/finish_phase/auto_queue/supervisor`. Существующие 28 строк не переписаны — только добавлено отсутствующее.
- `backlog/docs/doc-15.md` удалён (`rm`, файл содержал только frontmatter `title:` пустой, `content: ""` — проверено перед удалением). Удаление зафиксировано в ветке `vb/vl-343` коммитом 676ace1.
**Программная сверка (AC3)**
Скрипт по `dist/mcp/tools.js`: `listTools()` = 45 имён. Расхождений нет в обе стороны: `missing in MCP-SETUP: (none)`; в таблице 49 строк-кандидатов, из них 45 — имена реестра, 4 «лишних» (`command`, `args`, `env`, `enabled`) — это таблица полей конфига сторонних MCP-серверов, не инструменты. Дублей нет.
**Сверка doc-8 (AC7)**
`doc-8-MCP-справочник-Vibelogmd.md` дрейфа не имеет: все 45 имён реестра присутствуют, счётчик в документе — «45 инструмент(ов)». Правок не потребовалось.
**Ссылки на doc-15 (AC6)**
`search_files` по `doc-15`: ссылок в `src/`, `web/src/`, `templates/`, `MCP-SETUP.md`, `README.md` нет. Упоминания есть только в (а) `doc-22` §1.4 — это текст самого предложения «удалить doc-15» (историческая запись каталога предложений, правка не требуется) и (б) комментариях задач VL-214/VL-215/VL-217 — исторические отчёты фаз, не редактируются.
**Проверки**
`pnpm build` — успешно; `pnpm test:fast` (полный прогон vitest, без исключений) — 179 файлов, 3401 тест passed, 4 skipped, 0 failed. Тестов, читающих число из `MCP-SETUP.md`, нет (grep `MCP-SETUP` по `src/**/*.test.mjs` — пусто).
**Что осталось / оговорки**
- AC5 в части «`document_list` больше не показывает doc-15»: MCP читает backlog главного репозитория, поэтому до merge ветки `vb/vl-343` в master `document_list`/`document_view doc-15` ещё отдают пустую запись. Удаление зафиксировано в ветке и вступит в силу при слиянии — AC не отмечен, чтобы не закрывать его задним числом.
- AC8 (CHANGELOG.md) не выполнен: по правилам фазы Code CHANGELOG и документы backlog/docs пишет фаза Close после слияния. Строка для Close: «документация MCP-SETUP.md актуализирована (45 инструментов вместо 29), удалён пустой doc-15».
- Риск нового дрейфа счётчика остаётся: радикальное решение (генерация таблицы из `listTools()`) — вне этой задачи, кандидат в отдельную (пересекается с VL-340).
---
author: @agent
created: 2026-11-07 10:07
---
Фаза Close прервана: конфликт слияния vb/vl-343 → master в файле MCP-SETUP.md (git status --porcelain: `UU MCP-SETUP.md`). Merge остановлен на середине: `git merge --no-ff vb/vl-343` применил удаление backlog/docs/doc-15.md, но MCP-SETUP.md остался в состоянии конфликта (обе стороны правили таблицу инструментов — master получил правки от параллельных задач doc-25/VL-340, ветка — 21 добавленную строку и счётчик 45).
Что нужно сделать вручную, чтобы повторить фазу Close:
1. Разрешить конфликт в MCP-SETUP.md в главном репозитории: сохранить актуальный счётчик инструментов из `listTools()` (после `pnpm build`) и объединить таблицу — существующие строки master + добавленные в ветке `document_*`, `lesson_*` (включая `lesson_classify`), `project_map`, `git_commit`, `backlog_trigger_phase/phase_status/finish_phase/auto_queue/supervisor`. Программная сверка: каждое имя из `listTools()` должно встречаться в таблице, и наоборот.
2. `git add MCP-SETUP.md && git commit` (завершить merge-коммит) либо `git merge --abort` и перезапустить Close после ручного сведения ветки с master.
3. Повторить Фазу Close.
DoD, статус и документация (CHANGELOG) не трогались — задача остаётся в статусе Review.
---
author: @agent
created: 2026-11-07 10:27
---
Фаза: авто-отчёт (comment не передан моделью)
Статус: In Progress
AC отмечено: 7 из 9
DoD отмечено: 3 из 3
AC не отмечены (2): 5. doc-15 (пустой документ: `title: ""`, `content: ""`) удалён из корпуса; `document_list` больше его не показывает, `document_view doc-15` отдаёт «не найден»; 8. CHANGELOG.md обновлён (строка `docs`)
Файлы (1): MCP-SETUP.md
Фрагмент плана: ## Файлы - `MCP-SETUP.md` — правка таблицы и счётчика. - `doc-8` (MCP-справочник) — сверка, при необходимости дополнение. - `backlog/docs/doc-15...md` — удаление (файл пустой; имя файла уточнить листингом `backlog/docs/`). - `CHANGELOG.md`. ## Шаг 1. Получить фактический список инструментов Источник…
Отчёт собран сервером автоматически (VL-253): модель не передала comment.
---
<!-- COMMENTS:END -->