---
id: lesson-242
title: 'Запускай git с -c core.quotepath=false везде, где сравниваешь пути из вывода git с путями из кода'
status: active
tags:
  - git
  - mcp
  - unicode
  - paths
source_tasks: []
linked_tasks:
  - VL-360
created_date: 2026-11-07
updated_date: 2026-11-07
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

`git_commit` (`src/mcp/git-commit.ts`) отказывал с «в индексе уже есть посторонние файлы», если среди staged-файлов был путь с кириллицей: локальный `git()` запускал git без `-c core.quotepath=false`, поэтому `git diff --cached --name-only` отдавал octal-экранирование (`"\320\232..."`), а сравнение с читаемыми `paths` из кода шло как со строками — совпадения не было никогда, и повтор с теми же путями давал ту же ошибку (тупик).

## Решение

Любой вызов git, чей вывод сравнивается с путями из кода, запускай с `-c core.quotepath=false` (единый стиль `src/core/git.ts`, `src/core/status.ts`, `src/mcp/git-commit.ts`). Дополнительно нормализуй строки вывода чистой функцией `unquoteGitPath` (снять обрамляющие кавычки, раскрыть C-style escape `\ooo` → байты → UTF-8) и приведи обе стороны к одному виду (`\` → `/`, снять ведущий `./`) — это защищает от чужого `core.quotepath=true` в конфиге репозитория.

## Пример

```ts
const res = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd });
// ...
const staged = out.split('\n').map(unquoteGitPath).map(normalizePath);
```
