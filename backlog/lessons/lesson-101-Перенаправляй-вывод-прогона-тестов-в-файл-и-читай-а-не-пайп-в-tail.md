---
id: lesson-101
title: 'Перенаправляй вывод прогона тестов в файл и читай $?, а не пайп в tail'
status: active
tags:
  - тесты
  - shell
  - exit-code
source_tasks:
  - VL-242
linked_tasks:
  - VL-242
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: lesson-99
---
## Проблема

`pnpm test 2>&1 | tail -25` показывает хвост вывода, но `$?` отражает exit code `tail`, а не самого прогона. В фазе Close это даёт ложное «exit code: 0» при упавших тестах — или наоборот маскирует причину повторного прогона в отчёте.

## Решение

Перенаправляй весь вывод в файл, печатай `$?` сразу после команды и грепни сводку:

```bash
pnpm test > /tmp/run.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests  " /tmp/run.log
```

Так exit code прогона не подменяется пайпом, а сводка остаётся компактной.

## Пример

VL-242: `env -u VIBELOG_CWD pnpm test > .vibelog-test.log 2>&1; echo "EXIT=$?"` → `EXIT=0`, `Test Files 88 passed`.
