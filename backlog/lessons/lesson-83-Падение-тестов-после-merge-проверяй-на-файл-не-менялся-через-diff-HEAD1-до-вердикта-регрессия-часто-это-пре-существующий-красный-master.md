---
id: lesson-83
title: Падение тестов после merge проверяй на «файл не менялся» через diff HEAD^1 до вердикта «регрессия» — часто это пре-существующий красный master
status: active
tags:
  - close
  - tests
  - regression
  - merge
  - verification
source_tasks:
  - VL-212
linked_tasks:
  - VL-212
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

После merge ветки в шаге 5 Фазы Close `pnpm test` упал: 24 теста в `src/agent/llm.test.mjs` (VL-216). Легко принять за регрессию своего merge и прервать закрытие.

## Решение

Проверь, трогал ли merge упавший файл и его исходник:

```
git show --stat --oneline HEAD               # состав merge-коммита
git diff HEAD^1 HEAD --stat -- src/agent/   # пусто → merge не менял каталог
git show HEAD^1:src/agent/llm.ts | diff -q - src/agent/llm.ts        # идентичен
git show HEAD^1:src/agent/llm.test.mjs | diff -q - src/agent/llm.test.mjs
npx vitest run src/agent/llm.test.mjs        # падает и сам по себе
```

Если файл и его src байт-в-байт равны pre-merge состоянию (`HEAD^1`) и падают в одиночном прогоне — это пре-существующее падение master, НЕ регрессия задачи. Тогда: прогони целевые тесты своей задачи (`npx vitest run <свои файлы>`) и продолжай Close, честно записав в отчёт, что полный `pnpm test` красный по чужой причине.

## Пример

VL-212: merge затронул только `src/bot/*`, а падение было в `src/agent/llm.test.mjs` → `git diff HEAD^1 HEAD -- src/agent/` пуст + одиночный прогон тоже 24 failed → вывод «пре-существующее, не регрессия»; целевые `src/bot/*` — 218 passed.