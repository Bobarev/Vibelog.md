---
id: VL-19
title: 'VL-19: docs/user-guide.md — полное руководство пользователя'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 01:55'
updated_date: '2026-10-01 02:07'
due_date: ''
labels: []
dependencies: []
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
Полное руководство пользователя Vibelog.md — единый вход для новичка от установки до продвинутых сценариев.

Файл: docs/user-guide.md (или docs/guide.md — единый файл, ~400-500 строк; разбивать на несколько не нужно — читается через оглавление).

Структура:
1. Установка и init (включая --skills, --no-mcp, автонастройку MCP)
2. Задачи: create (все флаги: --ac/--dod/--priority/--type/--milestone/--project/--parent/--ordinal/--plan/--notes/--final-summary/--draft/--no-dod-defaults), list (--status/--type/--labels/--ready/--sort/--limit/--skip/--json), view, edit (все флаги включая batch --check-ac 1,3), complete/archive
3. Вехи (milestone add/list/rename/remove/archive, --task-handling)
4. Типы задач (types в конфиге, --type)
5. Документы (doc create/list/view/update/search)
6. Черновики (draft .../promote)
7. Решения ADR (decision ...)
8. Конфиг (config get/set/list, типы значений)
9. Поиск (search с фильтрами)
10. Доска и веб-интерфейс (board, browser)
11. Форматы файлов (frontmatter задач, вех, документов, решений)

Все примеры — реальные рабочие команды (сверять с help: node bin/vibelog.mjs <cmd> --help). Источник истины — код/справка, не выдумывать флаги.

Файлы: docs/user-guide.md (новый), README.md (раздел «Документация» со ссылками).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 docs/user-guide.md существует и покрывает: установка/init, полный жизненный цикл задачи (create с ВСЕМИ флагами, list с фильтрами, view/edit со всеми флагами, complete/archive), вехи, типы, документы, черновики, решения, конфиг, поиск, доску/браузер
- [x] #2 Каждый раздел содержит рабочие примеры команд с выводом или пояснением; форматы файлов (frontmatter задач/вех/документов) описаны
- [x] #3 README.md содержит раздел-навигацию со ссылками на user-guide (MCP-SETUP.md уже есть); все ссылки ведут на существующие файлы
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: docs/user-guide.md (VL-19)

1. **Источники истины** (сбор перед написанием):
   - Все help: `node bin/vibelog.mjs <cmd> --help` для init/task/board/search/browser/instructions/mcp/milestone/doc/config/draft/decision/doctor
   - Форматы файлов: taskToMarkdown (task.mjs:108-135), milestone/document/decision (уже известны из VL-3/11/14)
   - README.md (183 строки) — существующие секции, чтобы не дублировать

2. **Создать docs/user-guide.md** (~400-500 строк) с оглавлением:
   - Установка и init (--skills, --no-mcp, автонастройка MCP)
   - Задачи: create (все флаги), list (фильтры+--limit/--skip), view, edit (включая --check-ac 1,3 и --final-summary), complete/archive
   - Вехи, типы, документы, черновики (promote), решения ADR
   - Конфиг (get/set/list, типы значений), поиск (фильтры), board/browser
   - Форматы файлов (frontmatter задач/вех/документов/решений — по реальному выводу)
   - Каждый раздел — рабочие примеры команд

3. **README.md**: раздел «Документация» со ссылками (user-guide; best-practices/cli-reference добавит VL-21).

4. **Проверки**: node-скрипт — все markdown-ссылки из README/user-guide ведут на существующие файлы; pnpm test (docs не ломают тесты).

Риски: не выдумывать флаги — всё сверять с help; длинный файл — писать через write_file скелетом + edit (паттерм памяти).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 02:07
---
Фаза 3 завершена. 3/3 AC.
Создан docs/user-guide.md (360 строк, 12 разделов с оглавлением): установка/init (включая --skills/--no-mcp), задачи (таблицы ВСЕХ флагов create/list/edit по реальному help), вехи, типы, документы, черновики, ADR, конфиг, поиск, board/browser, форматы файлов (frontmatter всех 5 сущностей), диагностика. Источник истины — дамп help всех 13 команд (сверено запуском --help).
README.md: раздел «Документация» с навигацией. Проверка всех markdown-ссылок node-скриптом — битых нет; pnpm test без падений.
---
<!-- COMMENTS:END -->