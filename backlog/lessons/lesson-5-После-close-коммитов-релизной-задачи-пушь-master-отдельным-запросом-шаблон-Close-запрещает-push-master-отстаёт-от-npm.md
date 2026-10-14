---
id: lesson-5
title: 'После close-коммитов релизной задачи пушь master отдельным запросом — шаблон Close запрещает push, master отстаёт от npm'
status: active
tags:
  - release
  - git
  - close
source_tasks:
  - VL-159
linked_tasks:
  - VL-159
created_date: 2026-10-14
updated_date: 2026-10-14
supersedes: ''
---
## Проблема

В VL-127 после Фазы Close master не был запушен: npm-релиз ушёл, тег ушёл, а gitverse-master навсегда отстал от опубликованного кода — шаблон Close запрещает push, и автоматически этот шаг не делает никто.

## Решение

После docs(task)-коммитов закрытой релизной задачи выполняй `git push` отдельным запросом (комментарием пользователю или follow-up фазой) и подтверждай `git ls-remote origin refs/heads/master`. В отчёте Close всегда перечисляй незапушенные коммиты явно.

## Пример

```bash
# Фаза Close закоммитила docs(task) — но не пушит (шаблон запрещает):
git log origin/master..master --oneline   # что осталось не запушенным
# Отдельный запрос: git push origin master && git ls-remote origin refs/heads/master
```
