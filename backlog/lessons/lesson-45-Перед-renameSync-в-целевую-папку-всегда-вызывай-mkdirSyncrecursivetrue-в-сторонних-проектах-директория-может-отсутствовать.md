---
id: lesson-45
title: 'Перед renameSync в целевую папку всегда вызывай mkdirSync(recursive:true) — в сторонних проектах директория может отсутствовать'
status: active
tags:
  - store
  - fs
  - robustness
  - reject
source_tasks:
  - VL-190
linked_tasks:
  - VL-190
created_date: 2026-10-26
updated_date: 2026-10-26
supersedes: ''
---
## Проблема

`archiveTaskFile` в `src/core/store.ts` делал `renameSync(filePath, dest)` в `backlog/completed/` без предварительного создания директории — в стороннем проекте без `init` (папки `backlog/completed/` нет) reject/complete падали с `ENOENT: no such file or directory, rename` (VL-190).

## Решение

Перед любым `renameSync` в целевую директорию вызывай `mkdirSync(destDir, { recursive: true })` — идемпотентно и дёшево; точки `draft.ts` и `milestone.ts` уже так делали, а `archiveTaskFile` был упущен.

## Пример

```ts
// VL-190: в сторонних проектах backlog/completed/ может не существовать
mkdirSync(completedDir(backlogDir), { recursive: true });
renameSync(filePath, dest);
```

Тест-воспроизведение: `rmSync(completedDir, { recursive: true, force: true })` → `rejectTaskFile` → assert папка создалась и файл в ней.