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
  - VL-393
created_date: 2026-10-30
updated_date: 2026-11-09
supersedes: lesson-99
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
`pnpm test 2>&1 | tail -25` показывает хвост вывода, но `$?` отражает exit code `tail`, а не самого прогона. В фазе Close это даёт ложное «exit code: 0» при упавших тестах — или наоборот маскирует причину повторного прогона в отчёте. Отдельная ловушка: `pnpm test` проекта — это две последовательные команды (`vitest run --exclude src/web/static.test.mjs` и затем `vitest run src/web/static.test.mjs`), поэтому `tail` показывает короткий прогон static.test.mjs (8 тестов, ~1 с) и полностью скрывает сводку основного прогона из 203 файлов: видно «Test Files 1 passed», а судить о полном прогоне по этому хвосту нельзя.

## Решение
Перенаправляй весь вывод в файл, печатай `$?` сразу после команды и грепни сводку. Файл лога держи в `.vibelog/tmp/` (VL-329: временные файлы не пишутся в корень проекта), а не в `/tmp` — инструменты песочницы в проектном каталоге отвергают абсолютные пути вне проекта. Сводку основной части прогона греппай по `Test Files|Tests ` с конца файла или читай read_file с диапазоном, а не через `tail`: у `pnpm test` две команды vitest, и хвост принадлежит второй, короткой. Признак успеха основного прогона без явной сводки — отсутствие в логе строк `Failed Tests`/`FAIL`.

## Пример
VL-242: `env -u VIBELOG_CWD pnpm test > .vibelog-test.log 2>&1; echo "EXIT=$?"` → `EXIT=0`, `Test Files 88 passed`.

VL-393 (Close): `pnpm test 2>&1 | tail -18` показал только `static.test.mjs 8 passed` — сводка основного прогона (203 файла) осталась за пределами хвоста; вердикт пришлось подтверждать тем, что вторая команда `&&`-цепочки вообще выполнилась (первый vitest и build вернули 0). Правильно: `pnpm test > .vibelog/tmp/run.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " .vibelog/tmp/run.log`.