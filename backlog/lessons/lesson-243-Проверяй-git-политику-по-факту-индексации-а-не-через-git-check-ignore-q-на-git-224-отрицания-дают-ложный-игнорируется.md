---
id: lesson-243
title: 'Проверяй git-политику по факту индексации, а не через `git check-ignore -q`: на git 2.24 отрицания дают ложный «игнорируется»'
status: active
tags:
  - git
  - тесты
  - gitignore
  - catalina
source_tasks: []
linked_tasks:
  - VL-348
created_date: 2026-11-07
updated_date: 2026-11-07
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Проверка git-политики `.vibelog/.gitignore` (VL-329) через `git check-ignore -q <path>` на git 2.24 (macOS 10.15 Catalina) даёт код 0 и для путей, которые на самом деле НЕ игнорируются, если путь совпал с `!`-правилом (отрицанием). То есть тест «`.vibelog/settings.json` не игнорируется» проходит ложно, и политика остаётся непроверенной.

## Решение

Проверяй политику по факту индексации: `git add -A` во временном репозитории, затем `git ls-files` — путь в индексе значит «не игнорируется», отсутствует — «игнорируется». Это ровно то, что делает первый коммит `vb init`, поэтому проверка совпадает с реальным поведением.

## Пример

```js
// вместо git check-ignore -q (ложные срабатывания на git 2.24)
spawnSync('git', ['add', '-A'], { cwd });
const tracked = spawnSync('git', ['ls-files'], { cwd }).stdout;
assert.ok(!tracked.includes('.env'));                       // игнорируется
assert.ok(tracked.includes('.vibelog/settings.json'));      // не игнорируется
assert.ok(tracked.includes('.vibelog/billing/x.json'));     // не игнорируется
```
