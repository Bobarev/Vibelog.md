---
id: lesson-68
title: Изолируй spawn-тесты обновления через TMPDIR и фейковый npm в PATH-обёртке
status: superseded
tags:
  - тесты
  - cli
  - spawn
  - изоляция-окружения
source_tasks: []
linked_tasks: []
created_date: 2026-10-27
updated_date: 2026-10-27
supersedes: ''
---
## Проблема

Тест уведомления о новой версии должен проверить реальный spawn CLI, но сеть и глобальный `$TMPDIR/vibelog-update-check.json` недоступны/общие (VL-206).

## Решение

В spawn-тестах изолируй и npm, и кэш: (1) каталог-обёртка с фейковым `npm` — node-скрипт с shebang `#!/usr/bin/env node` и `chmod 0o755`, подставляется первым в `PATH` (execFile резолвит через PATH; внешние рантаймы запрещены); (2) свой `mkdtemp`-каталог в `TMPDIR` — кэш изолирован, повторный spawn с тем же TMPDIR проверяет «раз в сутки тихо». Уведомление проверяй по stderr отдельно от stdout — регрессия «протекает в stdout» ловится только так.

## Пример

```js
const tmp = mkdtempSync(join(tmpdir(), 'vibelog-test-'));
spawnSync(process.execPath, ['bin/vibelog.mjs', 'browser', '--help'], {
  env: { ...process.env, TMPDIR: tmp, PATH: `${wrapper}:${process.env.PATH}` },
});
```
