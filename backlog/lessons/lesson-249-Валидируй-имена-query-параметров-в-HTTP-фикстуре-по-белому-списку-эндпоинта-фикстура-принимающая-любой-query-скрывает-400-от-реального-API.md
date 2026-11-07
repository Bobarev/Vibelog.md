---
id: lesson-249
title: 'Валидируй имена query-параметров в HTTP-фикстуре по белому списку эндпоинта — фикстура, принимающая любой query, скрывает 400 от реального API'
status: active
tags:
  - тесты
  - фикстуры
  - http
  - api
  - gitverse
source_tasks:
  - VL-367
linked_tasks:
  - VL-367
created_date: 2026-11-08
updated_date: 2026-11-08
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

`vibelog upstream report` падал на реальном GitVerse с `400 [VALIDATION_ERROR]`, хотя все тесты были зелёными: `listLabels` слал `/labels?per_page=100`, а у этого эндпоинта параметр называется `limit` (`per_page` — параметр `/issues`). HTTP-фикстура на `node:http` принимала любой query и отвечала `200`, поэтому расхождение контракта с реальным API не проявлялось ни в одном тесте — тест проверял только разбор ответа, но не запрос.

## Решение

Фикстура обязана валидировать запрос, а не только отдавать ответ: пропиши белый список допустимых query-параметров **по пути** (взяв его из документации эндпоинта) и отвечай `400 VALIDATION_ERROR`, как реальный API, на любой параметр вне списка. Ставь проверку в общий обработчик сервера, а не в отдельный тест, — тогда контракт проверяют все существующие кейсы, а не только новый. Дополнительно закрепи регрессионными тестами сам запрос: `assert.match(paths[0], /[?&]limit=100/)` и `assert.doesNotMatch(paths[0], /per_page/)` — по одному на каждую пару «правильный параметр / перепутанный». Белый список не расширяй «чтобы прошло»: упавший тест — это найденное расхождение, сверяй с документацией.

## Пример

```js
const ALLOWED_QUERY = {
  labels: ['page', 'limit', 'sort'],
  issues: ['state', 'q', 'labels', 'per_page', 'page' /* … */],
};

function rejectUnknownQuery(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const kind = url.pathname.endsWith('/labels') ? 'labels'
             : url.pathname.endsWith('/issues') ? 'issues' : null;
  if (kind === null) return false;
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_QUERY[kind].includes(key)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', status: 400 } }));
      return true;
    }
  }
  return false;
}

it('listLabels шлёт limit, а не per_page (VL-367)', async () => {
  handler = json(200, [{ name: 'upstream' }]);
  await listLabels(cfg(), opts());
  assert.match(paths[0], /[?&]limit=100/);
  assert.doesNotMatch(paths[0], /per_page/);
});
```
