---
id: lesson-195
title: 'Держи один владелец stdin на интерактивную сессию: readline и raw-mode на одном потоке дают «тихое» падение процесса'
status: active
tags:
  - cli
  - tui
  - readline
  - stdin
  - wizard
source_tasks:
  - VL-320
linked_tasks:
  - VL-320
created_date: 2026-11-03
updated_date: 2026-11-03
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Консольный wizard `vibelog init` аварийно завершался посреди шага «Где хранить API-ключи»: промпт печатался и процесс умирал — без стек-трейса, без ошибки. Причина: на всю сессию создавался один `readline.Interface` над `process.stdin`, а мультивыбор агентов отдельно переводил тот же stdin в raw-mode и на выходе делал `stdin.pause()` + `stdin.setEncoding('utf8')`. После `pause()` буфер readline переставал пополняться, event loop оставался без активных ресурсов — и Node штатно завершал процесс, «проглотив» следующий `rl.question`.

## Решение

Один владелец stdin на всю интерактивную сессию. В нашем случае readline убран совсем: `src/cli/prompt.ts` реализует текстовый ввод и списки поверх единственного raw-mode обработчика (`input.on('data')`), декодируя Buffer вручную (`toString('utf8')`, без `setEncoding`, иначе поток переключается на строки и ломает потребителей). Восстановление режима — строго в `finally` (`removeListener` → `setRawMode(wasRaw)` → `pause()`), отмена — исключение `PromptCancelledError`, а не «тихий» резолв пустым значением.

## Пример

```ts
function rawScope<T>(run): Promise<T> {
  const wasRaw = input.isRaw === true;
  input.setRawMode(true);
  input.resume();
  input.on('data', onData);
  return run(...).finally(() => {
    input.removeListener('data', onData);
    input.setRawMode(wasRaw);
    input.pause();
  });
}
```

Если readline всё же нужен — не смешивать: `rl.pause()` перед raw-блоком и `rl.resume()` после, `setRawMode` трогать только через readline-интерфейс, а не напрямую у stdin.
