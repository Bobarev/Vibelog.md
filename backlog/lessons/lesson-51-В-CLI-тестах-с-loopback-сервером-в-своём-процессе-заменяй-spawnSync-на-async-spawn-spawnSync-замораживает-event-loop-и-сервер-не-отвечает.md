---
id: lesson-51
title: 'В CLI-тестах с loopback-сервером в своём процессе заменяй spawnSync на async spawn — spawnSync замораживает event loop, и сервер не отвечает'
status: active
tags:
  - tests
  - cli
  - nodejs
source_tasks:
  - VL-194
linked_tasks:
  - VL-194
created_date: 2026-10-26
updated_date: 2026-10-26
supersedes: ''
---
## Проблема

В CLI-тесте (spawn дочернего процесса) поднят loopback-HTTP-сервер для проверки фичи скачивания. Использовался `spawnSync` — он блокирует event loop тестового процесса, сервер не успевает отвечать, дочерний CLI получает `The operation was aborted due to timeout` (AbortSignal.timeout в fetch). Тест падал с ошибкой, не связанной с логикой фичи.

## Решение

Для CLI-тестов с любым сервером/mock'ом в том же тестовом процессе — асинхронный запуск (`spawn` с промисой: собираем stdout/stderr, резолвим по `close`). `spawnSync` оставлять только для тестов без взаимодействия с процессом теста (git, чистый CLI-вывод).

```js
function runCliAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, ...args], { cwd, env });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}
```