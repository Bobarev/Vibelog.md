---
id: lesson-209
title: 'Для вложенного каталога с собственной git-политикой первым правилом ставь `*` и `!*/`, иначе `!`-исключения не действуют на глубокие пути'
status: active
tags:
  - gitignore
  - git
  - vibelog-dir
source_tasks:
  - VL-329
linked_tasks:
  - VL-329
created_date: 2026-11-04
updated_date: 2026-11-04
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

`.vibelog/` целиком лежал в корневом `.gitignore`, поэтому `config.json`, `installed.lock.json`, `settings.json`, `prompts/` и `billing/` нельзя было закоммитить. При переходе на собственный `.vibelog/.gitignore` недостаточно написать `!config.json`: правило `*` игнорирует и сами каталоги, а git не заходит в игнорированный каталог и не видит вложенных исключений.

## Решение

В файле `.vibelog/.gitignore` первыми двумя строками ставь `*` и `!*/` — второе возвращает видимость всем каталогам, после чего `!config.json`, `!prompts/`, `!prompts/**` работают на любой глубине. Политику обязательно проверяй механически через `git check-ignore -v <путь>` на обоих классах путей: коммитуемые (config.json, settings.json, prompts/personas/x.md, billing/VL-1.json) должны быть под отрицающим правилом, игнорируемые (agent-sessions/a.jsonl, tmp/x, idempotency.json) — под `*`. Такой тест стоит закрепить в тестах проекта.

## Пример

```
*
!*/
!.gitignore
!config.json
!installed.lock.json
!settings.json
!prompts/
!prompts/**
!billing/
!billing/**
```
