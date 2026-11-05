---
id: VL-343
title: 'docs: актуализировать MCP-SETUP.md (29 → 45 инструментов, добавить lesson_*/project_map/supervisor/git_commit) и удалить пустой doc-15'
status: Planned
assignee: []
reporter: ''
created_date: '2026-11-05 13:23'
updated_date: '2026-11-05 13:24'
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
modified_files: []
lessons: []
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
- [ ] #1 `MCP-SETUP.md`: строка «Всего 29 инструментов» заменена на фактическое число из реестра (`listTools()`), в тексте больше нет устаревших счётчиков
- [ ] #2 `MCP-SETUP.md`: в таблицу добавлены отсутствующие группы — все `lesson_*` (включая `lesson_classify`), `project_map`, `backlog_trigger_phase`, `backlog_phase_status`, `backlog_auto_queue`, `backlog_supervisor`, `backlog_finish_phase`, `git_commit`
- [ ] #3 `MCP-SETUP.md`: набор имён в таблице сверен с `listTools()` программно (grep/скрипт), расхождений нет — имена совпадают посимвольно
- [ ] #4 `MCP-SETUP.md`: строки, описывающие поведение инструментов, не переписаны заново — только отсутствующее добавлено, существующие описания сохранены
- [ ] #5 doc-15 (пустой документ: `title: ""`, `content: ""`) удалён из корпуса; `document_list` больше его не показывает, `document_view doc-15` отдаёт «не найден»
- [ ] #6 Проверено, что на doc-15 нет ссылок: `search_files` по `doc-15` в `backlog/`, `src/`, `web/src/`, `templates/` — при наличии ссылок они обновлены или явно указаны в итоговом отчёте
- [ ] #7 Документ `doc-8` (MCP-справочник) сверен с реестром на тот же дрейф; расхождения либо исправлены, либо перечислены в комментарии к задаче
- [ ] #8 CHANGELOG.md обновлён (строка `docs`)
- [ ] #9 `pnpm build && pnpm test` зелёные (правка документации не должна ломать тесты счётчиков — если тест ловит число в MCP-SETUP.md, он обновлён осознанно)
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