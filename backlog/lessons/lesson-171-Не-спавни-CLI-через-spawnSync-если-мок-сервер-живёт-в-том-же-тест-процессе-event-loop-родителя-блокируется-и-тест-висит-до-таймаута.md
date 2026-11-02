---
id: lesson-171
title: 'Не спавни CLI через spawnSync, если мок-сервер живёт в том же тест-процессе — event loop родителя блокируется и тест висит до таймаута'
status: active
tags:
  - tests
  - cli
  - mock-server
  - vitest
  - async-spawn
source_tasks:
  - VL-298
linked_tasks:
  - VL-298
created_date: 2026-11-02
updated_date: 2026-11-02
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Тест CLI поднимал `node:http`-мок провайдера на loopback в том же процессе, а дочерний CLI запускал через `spawnSync`. Прогон `npx vitest run <файл>` повис и был убит по SIGKILL через 300 с: `spawnSync` блокирует event loop родителя, мок-сервер не успевает принять соединение и ответить, дочерний процесс ждёт ответа.

## Решение

Если в тест-процессе есть сервер (мок провайдера, веб-сервер, loopback-заглушка), а CLI/бинарник запускается дочерним процессом — использовать `spawn` + `await new Promise(resolve => child.on('close', resolve))`, а сами `it(...)` делать асинхронными.

## Пример

```js
function runCli(args) {
  return new Promise(resolve => {
    const child = spawn('node', [cliPath, ...args], { cwd: testRoot, env: testSpawnEnv() });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}
// и в тесте:
it('...', async () => { const res = await runCli(['experiment', 'judge', 'exp-1']); ... });
```

Смежный симптом: мок-сервер «сбоя провайдера» (500) даёт ~7.5 с прогона — это ретраи клиента (`maxRetries`), а не зависание.
