---
id: VL-124
title: 'Политика инструментов vb: нативные read_file/edit/write_file против патч-скриптов (doc-2)'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-12 19:13'
updated_date: '2026-10-26 00:13'
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
modified_files: []
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Противоречие после VL-105 (раздел AGENTS.md «Чтение файлов — только shell» удалён, 15391cf): backlog/docs/doc-2 по-прежнему описывает патч-скрипты на Node.js как ЕДИНСТВЕННЫЙ путь правки файлов репозитория, но агент VL-113 в phase-фазе работал нативным edit-инструментом (13 точечных правок за 13 ходов — быстрее патч-скриптов на 2-3 хода на файл) и это оказалось корректно и эффективно.

Нужно решение владельца: (а) разрешить vb-агенту нативные read_file/edit/write_file для точечных правок (патч-скрипты оставить для массовых/хрупких/многоякорных операций, где важна атомарность); или (б) оставить патч-скрипты как единственный путь и запретить edit/write в agent-prompt.md. Результат отразить в doc-2 и agent-prompt.md, чтобы промпты, документация и фактическая практика не расходились. Вопрос к владельцу в комментарии задачи перед Фазой 3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 решение владельца зафиксировано: backlog/docs/doc-2 (раздел о патч-скриптах) и templates/agent-prompt.md отражают выбранную политику
- [ ] #2 pnpm test зелёный (правки только docs/промпта)
- [ ] #3 комментарий задачи: решение и мотивация
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: Pavel Bobarev
created: 2026-10-26 00:13
---
Этот doc-2 теперь уже не актуален для vibelog агента. Он использовался для агента qwen code и если снова пользоваться им, то тогда можно пользоваться этой документацией.
---
<!-- COMMENTS:END -->