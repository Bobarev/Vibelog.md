---
id: lesson-139
title: 'Откатывай эксперимент копией файла, а не git checkout -- : незакоммиченные правки worktree теряются молча'
status: active
tags:
  - tests
  - git
  - worktree
source_tasks:
  - VL-247
linked_tasks:
  - VL-247
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема
Проверяя негативный кейс теста (AC «тест падает при удалении сигнала»), я временно испортил шаблон и восстанавливал его командой `git checkout -- templates/phases/phase-close-worktree.md`. В worktree правки были **ещё не закоммичены** — `git checkout` откатил файл к HEAD и молча снёс все 5 правок фазы. Восстанавливать пришлось вручную по памяти.

## Решение
Экспериментируй над файлом через копию: `cp file file.bak` → правка → прогон → `mv -f file.bak file`. Возврат к копии не зависит от состояния индекса и HEAD. `git checkout -- <path>` безопасен только для файла, чьи изменения уже в коммите.

## Пример
```bash
# верно: копия переживает любой git-статус
cp templates/phases/x.md templates/phases/x.md.bak
node --input-type=module -e "...порча файла..."
npx vitest run <тест>   # ждём красный
mv -f templates/phases/x.md.bak templates/phases/x.md

# ошибка: снесёт незакоммиченные правки
git checkout -- templates/phases/x.md
```

Проверять повреждение стоит на **заведомо ложной** подстроке (не на части собственной формулы) `node -e`-строкой на весь файл: тогда первая ошибка теста гарантированно про удалённый сигнал, а не про постороннюю строку файла.