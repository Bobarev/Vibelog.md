---
id: VL-20
title: 'VL-20: docs/best-practices.md — практики и производительность'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 01:56'
updated_date: '2026-10-01 02:09'
due_date: ''
labels: []
dependencies:
  - VL-19
milestone: ''
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Best practices и производительность: как Vibelog ускоряет работу соло-разработчика и AI-воркфлоу.

Файл: docs/best-practices.md (~250-350 строк).

Секции:
1. Workflow с Qwen Code: /vibelog:spec → /vibelog:plan → /vibelog:code, подтверждения на фазах, как ставить задачи агенту (AC формулировать проверяемыми)
2. Dogfooding: примеры из этого репозитория (VL-1..VL-18, backlog/tasks/) — как вести эпики (VL-2 → VL-3/VL-4), закрывать AC
3. Организация работ: приоритеты, метки (v1.3/v1.4), зависимости (--deps, --ready), вехи для релизов, типы для фильтрации
4. Batch: --check-ac 1,3; --limit/--skip; --json для скриптов
5. Производительность: сценарии было/стало с количеством шагов (см. AC)
6. Интеграция с git: коммиты по задачам, что коммитить (docs(task) vs feat), backlog/ в репозитории

Файлы: docs/best-practices.md (новый), README.md (ссылка), docs/user-guide.md (ссылка — делается после VL-19 или параллельно с учётом зависимости).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 docs/best-practices.md существует: workflow spec→plan→code с Qwen Code (по AGENTS.md/vibelog:* командам), dogfooding (как этот проект ведёт свои задачи), приоритеты/метки/зависимости для потоков, batch-операции (--check-ac 1,3, --limit/--skip), вехи для релизов
- [x] #2 Раздел «Производительность»: 4-6 конкретных сценариев «было/стало» (например: захват идеи draft→promote вместо ручного файла; batch-отметка AC вместо 3 вызовов; --ready вместо ручной проверки зависимостей; поиск с фильтрами вместо grep по backlog/) с оценкой экономии шагов
- [x] #3 Ссылки из docs/user-guide.md и README.md на best-practices.md
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: docs/best-practices.md (VL-20)

1. **Источники**: AGENTS.md (workflow spec→plan→code, правила проекта), backlog/tasks/ (реальные примеры VL-2→VL-3/VL-4, AC), help (batch-флаги), features из user-guide (VL-19).

2. **Создать docs/best-practices.md** (~250-350 строк):
   - Workflow с Qwen Code: /vibelog:spec → plan → code, подтверждения, как формулировать AC (проверяемыми, из этого проекта)
   - Dogfooding: VL-2 (epic) → VL-3/VL-4 (подзадачи), закрытие AC через MCP, docs(task)-коммиты — реальные коммиты репозитория
   - Организация: приоритеты, метки, --deps/--ready, вехи для релизов, типы
   - Batch: --check-ac 1,3; --limit/--skip; --json для скриптов
   - **Производительность**: 5 сценариев «было/стало» с шагами:
     1. Идея → задача: ручной файл/заметка (3-4 шага) vs draft create + promote (2 команды)
     2. Отметка критериев: 3 вызова edit vs 1 --check-ac 1,2,3
     3. «Что готово к работе»: ручной просмотр зависимостей vs task list --ready
     4. Поиск по backlog: grep -r по файлам vs vibelog search --status --type
     5. Релиз-чек-лист: ручной обход задач vs milestone + фильтр по вехе
   - Git-интеграция: что коммитить (feat/docs(task)), backlog/ в репозитории, не пушить без подтверждения

3. **Ссылки**: README + user-guide (VL-19 уже сделал README-секцию — дописать best-practices).

4. **Проверки**: ссылки (node-скрипт), pnpm test.

Риски: цифры «экономии шагов» — честные (считать реальные команды, не маркетинг).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 02:08
---
Фаза 3 завершена. 3/3 AC.
Создан docs/best-practices.md (158 строк, 7 секций): workflow spec→plan→code (как ставить задачи агенту, проверяемые AC), dogfooding на реальных примерах проекта (VL-2→VL-3/VL-4, коммиты feat/docs(task)/fix), организация работ (метки+вехи, --deps/--ready), batch-операции, раздел «Производительность» — 6 сценариев «было/стало» с честным подсчётом шагов (draft→promote, --check-ac 1,2,3, --ready, поиск с фильтрами vs grep, релиз-чек-лист по вехе, персистентный контекст агента), git-интеграция, чего избегать.
Ссылки из user-guide.md и README.md — проверены node-скриптом.
---
<!-- COMMENTS:END -->