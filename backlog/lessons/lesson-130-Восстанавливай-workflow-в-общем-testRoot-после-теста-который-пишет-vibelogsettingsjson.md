---
id: lesson-130
title: 'Восстанавливай workflow в общем testRoot после теста, который пишет .vibelog/settings.json'
status: active
tags:
  - tests
  - vitest
  - settings
  - workflow
  - orchestrator
source_tasks:
  - VL-274
linked_tasks:
  - VL-274
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

Тест оркестратора создаёт `.vibelog/settings.json` в общем `testRoot` (permissive-workflow задан там же функцией `allowAllPhases`, которая пишет секцию `workflows` в тот же файл). В `finally` тест делал `rmSync('.vibelog/settings.json')` — вместе с лимитами сносил и `workflows`, и последующие тесты падали нестандартно: `{"error":"Фаза code недопустима из статуса Spec"}` в пяти кейсах, далеко от места правки.

## Решение

После теста, который перезаписывает общий settings.json, восстанавливай заведомо нужные секции: `rmSync(...)` + повторный `allowAllPhases(root)` (или патч merge вместо полной перезаписи). Симптом «недопустимая фаза из статуса» в unrelated-тестах — сигнал, что предыдущий тест снёс `workflows`.

## Пример

VL-274: `src/web/orchestrator.test.mjs` — новый кейс `--idle-timeout` писал settings.json без секции workflows; в finally добавлен `allowAllPhases(testRoot)` после удаления файла, пять unrelated-падений исчезли.