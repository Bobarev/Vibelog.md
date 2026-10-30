---
id: lesson-93
title: Применяй offset/limit и построчное усечение до бюджета символов — иначе одна длинная строка (JSONL) делает файл нечитаемым
status: active
tags:
  - agent
  - tools
  - read_file
  - truncation
  - jsonl
source_tasks:
  - VL-250
linked_tasks:
  - VL-250
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

`read_file` обрезал содержимое файла по бюджету символов (8192, `TOOL_OUTPUT_MAX_CHARS`) до применения `offset`/`limit`. В `.vibelog/agent-sessions/*.jsonl` каждая запись — одна строка на 8–30 КБ, поэтому любая первая строка съедала весь бюджет: файл не читался ни в каком диапазоне, а ответ приходит с подсказкой «сузь запрос» → модель зацикливается (`lesson-92`).

## Решение

Форматировать срез как чистую функцию: сначала `lines.slice(offset, offset+limit)`, затем проверка «срез влезает в бюджет?» → вернуть дословно (регрессия обычных файлов гарантирована), иначе копить строки с построчной обрезкой слишком длинной строки и явным маркером (`…[вывод обрезан: показаны строки X–Y из N; продолжение — offset=Y+1]`). В конце — жёсткий `slice(0, MAX)` как инвариант длины.

Держать это одним экспортируемым хелпером и подключать в обе реализации (агент `src/agent/tools.ts` и веб-чат `src/web/tool-policy.ts`) — дубль логики разъезжается (`lesson-37`).

## Пример

```ts
export function formatFileSlice(content, offsetRaw, limitRaw) {
  const lines = content.split('\n');
  const slice = lines.slice(offset, offset + limit);
  const joined = slice.join('\n');
  if (joined.length <= TOOL_OUTPUT_MAX_CHARS) return joined;
  // ...построчная сборка с маркером и следующим offset
  return out.slice(0, TOOL_OUTPUT_MAX_CHARS);
}
```
