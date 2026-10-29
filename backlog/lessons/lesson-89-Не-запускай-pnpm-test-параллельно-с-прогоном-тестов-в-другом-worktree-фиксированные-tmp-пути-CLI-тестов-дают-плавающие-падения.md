---
id: lesson-89
title: Не запускай pnpm test параллельно с прогоном тестов в другом worktree — фиксированные /tmp-пути CLI-тестов дают плавающие падения
status: superseded
tags:
  - tests
  - vitest
  - close-phase
  - worktree
  - tmp
  - flaky
source_tasks:
  - VL-227
linked_tasks:
  - VL-227
  - VL-241
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

В Фазе Close VL-227 полный `pnpm test` падал с плавающим набором падений (29 → 7 → 33 → 12 тестов, разные файлы в каждом прогоне: `llm.test.mjs`, `cli/config-cli.test.mjs`, `cli/create-flags.test.mjs`, `cli/search-cli.test.mjs`, `web/reject-task.test.mjs`). Диагностика заняла 6 прогонов.

Причина оказалась двойной:
1. Локальный `.vibelog/settings.json` (под .gitignore, есть только в главном репо) с `models.default` и `api_mode: responses` — `llm.test.mjs` читает его через `process.cwd()` и уходит на `/responses` вместо `/chat/completions` (это уже описано в lesson-78).
2. Параллельно в другом worktree (`vl-233`) шёл `vitest run`, и CLI-тесты используют **фиксированные** пути: `/tmp/vibelog-config-cli-test`, `/tmp/vibelog-search-cli-test`, `.test-create-flags`, `.test-batch`. Два одновременных прогона затирают эти каталоги друг другу → случайные падения `AssertionError: 0 !== 1` в любом CLI-тесте.

## Решение

Перед вердиктом о тестах в Фазе Close:

1. Проверь параллельные прогоны: `ps aux | grep "[v]itest"` — если в другом worktree идёт прогон, дождись его окончания (цикл со `sleep`), не гоняй свой параллельно.
2. Временно убери локальный `.vibelog/settings.json` (`mv` в бэкап) — это отделяет конфиг-зависимые падения llm-тестов от реальных.
3. Только потом сравнивай diff падений с родительским коммитом (lesson-79/lesson-83).

## Пример

```bash
# 1) Ждём, пока чужой прогон закончится
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  N=$(ps aux | grep "[v]l-233/node_modules/.bin" | wc -l | tr -d ' ')
  [ "$N" = "0" ] && break
  sleep 20
done

# 2) Прогон без локального settings.json, с гарантированным возвратом файла
mv .vibelog/settings.json .vibelog/settings.json.bak
pnpm test; RC=$?
mv .vibelog/settings.json.bak .vibelog/settings.json
```

После обоих шагов прогон VL-227 стал зелёным: 85 файлов, 1584 passed, 4 skipped, 0 failed.