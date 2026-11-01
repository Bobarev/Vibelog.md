---
id: lesson-165
title: 'Сверяй git status по backlog/docs перед закрытием: doc-*, изменённые через MCP в Code, не попадают в Code-коммит'
status: active
tags:
  - close
  - docs
  - git
  - фазы
  - documentation
source_tasks:
  - VL-294
linked_tasks:
  - VL-294
created_date: 2026-11-02
updated_date: 2026-11-02
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Фаза Code коммитит только код (`git add` по путям из modified_files), а документацию `backlog/docs/doc-*` правили через MCP-инструменты `document_update` — эти правки лежат в рабочем дереве главного репозитория и остаются незакоммиченными после Code-коммита. Задача переходит в Review с «грязным» docs-файлом, и если Close их не заметит, документация уезжает в мастер только случайным коммитом.

## Решение

В фазе Close всегда выполнять `git status --porcelain` по `backlog/` до шагов с коммитами и отдельно проверять `git status --porcelain -- "backlog/docs/"`. Изменённые doc-* (кроме файла самой задачи — его коммитит framework) добавлять явными путями и коммитить с префиксом `docs: <ID> — ...` ДО шага backlog_finish_phase; в отчёте фазы указывать хэш этого коммита.

## Пример

VL-294: `doc-8-MCP-справочник-Vibelogmd.md` (перечень типов reference) и `doc-21-...-спецификация.md` были изменены и остались `M` в git status после Code-коммита e26c6a5. Close закоммитил их как `docs: VL-294 — ...` (3807a21), в отчёте указал хэш; при этом файлы дочерних задач VL-295…VL-300, изменённые параллельно другой фазой, в коммит НЕ включались.