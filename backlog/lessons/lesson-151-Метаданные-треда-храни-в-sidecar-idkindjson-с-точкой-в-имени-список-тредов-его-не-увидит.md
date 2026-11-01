---
id: lesson-151
title: 'Метаданные треда храни в sidecar `<id>.<kind>.json` с точкой в имени — список тредов его не увидит'
status: active
tags:
  - web
  - chat
  - sidecar
  - idempotency
source_tasks:
  - VL-283
linked_tasks:
  - VL-283
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Нужно хранить метаданные чат-треда (роль, allow-list, счётчик повторов) рядом с jsonl-историей, не ломая формат истории и не порождая фантомных тредов в списке `GET /api/chat/threads`.

## Решение

Держи метаданные в sidecar-файле `<threadId>.<kind>.json` в `.vibelog/chat-sessions/`. `listChatThreads` фильтрует по расширению `.jsonl`, поэтому точка в имени делает sidecar невидимым для списка — треды не задваиваются, формат jsonl не трогается (образцы: `<id>.allow.json` VL-264, `<id>.repeat.json` VL-255, `<id>.persona.json` VL-283).

Функцию записи делай **идемпотентной**: есть файл — вернуть сохранённое значение и не перезаписывать (последний писатель не перетирает первый, гонки безвредны). Фиксацию свойства выполняй строго ПОСЛЕ валидации входного значения и ДО тяжёлой работы (LLM-цикла): иначе ошибка валидации навсегда испортит сущность дефолтом. При чтении значения, которого больше нет в реестре (удалённая роль), — fallback на дефолт БЕЗ перезаписи sidecar и с `console.warn`: так возврат значения в реестр восстановит поведение.

## Пример

```ts
export function fixThreadPersona(cwd: string, threadId: string, personaId: string): string {
  if (!THREAD_ID_RE.test(threadId)) return personaId;
  const existing = readThreadPersona(cwd, threadId);
  if (existing) return existing;              // идемпотентно: не перезаписываем
  try {
    mkdirSync(chatSessionsDir(cwd), { recursive: true });
    writeFileSync(personaFile(cwd, threadId), JSON.stringify({ persona: personaId, fixedAt: new Date().toISOString() }) + '\n');
  } catch { /* сбой записи не рвёт диалог */ }
  return personaId;
}
```
