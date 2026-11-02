---
id: lesson-169
title: Перезапись файла с накопленными данными делай через temp+rename в том же каталоге
status: active
tags:
  - files
  - atomicity
  - experiments
  - node
source_tasks:
  - VL-296
linked_tasks:
  - VL-296
created_date: 2026-11-02
updated_date: 2026-11-02
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Данные прогона (например `results.jsonl`, `meta.json`) обновляются upsert-ом: файл перезаписывается целиком. Прямая запись `writeFileSync` не атомарна — SIGINT/падение процесса посреди записи оставляют файл на половину, и все накопленные результаты теряются (в эксперименте это часы ручных прогонов).

## Решение

Пиши через temp-файл в **том же каталоге** + `rename`: он атомарен только в пределах одной файловой системы. Каталог `tmpdir()` не годится — там `rename` может дать `EXDEV`. При ошибке temp убирай, исходный файл не трогай.

```ts
const tmp = join(dirname(file), `.${basename(file)}.tmp-${process.pid}`);
try {
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);            // атомарная подмена
} catch (err) {
  rmSync(tmp, { force: true });     // исходный файл цел
  throw err;
}
```

## Пример

VL-296: `rewriteResultsJsonl` и `writeMetaJson` в `src/core/results.ts` / `src/core/experiment.ts`; тест «rewrite атомарен» проверяет, что при сбое записи исходный `results.jsonl` остался валидным.
