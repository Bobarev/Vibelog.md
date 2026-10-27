---
id: lesson-66
title: Интеграционные spawn-тесты update-check изолируй через mkdtemp-TMPDIR и PATH-обёртку с фейковым npm
status: active
tags:
  - тесты
  - spawn
  - update-check
  - изоляция
  - flaky
source_tasks:
  - VL-206
linked_tasks:
  - VL-206
created_date: 2026-10-27
updated_date: 2026-10-27
supersedes: lesson-68
---
## Проблема

Интеграционный тест уведомления о новой версии должен увидеть свежий устаревший кэш `$TMPDIR/vibelog-update-check.json`, но общий TMPDIR в параллельном vitest (fileParallelism) приводит к протеканию кэша между тестами и флакам.

## Решение

- В spawn-тесте изолируй кэш через собственный `mkdtemp`-каталог: `spawnSync(..., { env: { ...process.env, TMPDIR: tmpDir } })`.
- Фейковый `npm` — только node-скрипт с shebang `#!/usr/bin/env node` + `chmod 0o755`, положи в PATH-обёртку первым (запрет внешних рантаймов, execFile резолвит через PATH).
- Берни безопасный режим команды (`browser --help`), который завершается до старта сервера.

## Пример

VL-206: `src/cli/cli.test.mjs` — PATH-обёртка с фейковым npm печатает `9.9.9`, TMPDIR-изоляция даёт три сценария: уведомление в stderr → повторный запуск тихо → `VIBELOG_SKIP_UPDATE_CHECK=true` тихо.