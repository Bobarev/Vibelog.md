---
id: lesson-88
title: Прогоняй pnpm test в агентской сессии через env -u VIBELOG_CWD — иначе CLI-тесты видят корень основного репо
status: active
tags:
  - tests
  - cli
  - worktree
  - env
  - vitest
source_tasks:
  - VL-233
linked_tasks:
  - VL-233
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

В сессии vb-агента (особенно в worktree задачи) в окружении выставлен `VIBELOG_CWD` на главный репозиторий. Тесты, которые спавнят CLI (`spawnSync('node', [bin/vibelog.mjs, ...], { cwd: testDir, env: {...process.env} })`), наследуют эту переменную — CLI резолвит backlog не в своей временной директории `/tmp/...`, а в основном репозитории. Итог: ложные падения вида

```
AssertionError: 'Ошибка: Backlog-директория не найдена. Выполните "vibelog init"…' !== 'nvim'
AssertionError: дефолт1: ✗ Задача fl-1 не найдена.
```

при полностью рабочем коде (`config-cli`, `create-flags`, `search-cli`, `batch-checklist`). Тот же прогон без `VIBELOG_CWD` — зелёный.

## Решение

Запускать полный прогон в агентской сессии с явным снятием переменной:

```bash
env -u VIBELOG_CWD pnpm test        # build + vitest run
env -u VIBELOG_CWD pnpm test:fast   # без сборки, dist уже собран
```

## Пример (VL-233)

`pnpm test` в worktree vl-233: 2–3 упавших файла из 85, каждый раз разные (config-cli, create-flags, search-cli, batch-checklist), потому что параллельные файлы гоняются за один и тот же главный backlog. `env -u VIBELOG_CWD pnpm test` — 85 файлов / 1591 тест зелёные.

Правило: падения CLI-тестов, связанные с «директория не найдена»/«задача не найдена», сначала проверяй повторным прогоном с `env -u VIBELOG_CWD`, а не правкой кода.