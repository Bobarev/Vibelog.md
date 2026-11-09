---
id: ref-32
title: 'GitVerse Public API — содержимое файла репозитория (GET /repos/{owner}/{repo}/contents/{path})'
type: url
url: 'https://gitverse.ru/docs/developers/public-api/repositories/api-get-repo-contents'
tags:
  - gitverse
  - api
  - contents
  - registry
  - upstream
created_date: 2026-11-09
linked_tasks:
  - VL-382
cached_path: references/cache/ref-32.md
cached_at: '2026-11-09T07:57:05.436Z'
source_hash: f17f6b09564f2a878e16f326453f9385661bb71c1ea74f895ef99649776b0017
---
## Что это

Документация Публичного API GitVerse: получение содержимого файла репозитория — эндпоинт `GET /repos/{owner}/{repo}/contents/{path}`. Нужна как контракт для `vb install` (скачивание `public/r/<name>.json` и файлов компонентов).

## Почему это важно

Спайк 2026-11-09 показал: старый путь `https://gitverse.ru/api/repos/{owner}/{repo}/raw/branch/{branch}/{path}` **непригоден** — отдаёт HTTP 429 «Unauthenticated requests rate-limit exceeded» для ВСЕХ схем авторизации (анонимно, `Authorization: Bearer`, `PRIVATE-TOKEN`, `?private_token=`), то есть это rate-limited веб-эндпоинт, а не API. Токен его не разблокирует.

Рабочий путь — Публичный API: `https://api.gitverse.ru/repos/{owner}/{repo}/contents/{path}?ref={branch}` с обязательными заголовками `Authorization: Bearer` и `Accept: application/vnd.gitverse.object+json;version=1`. Без кастомного `Accept` сервер отвечает `415 UNSUPPORTED_MEDIA_TYPE`.

## Ключевое отличие от raw

Ответ — JSON-объект файла (как в GitHub Contents API): `name`, `path`, `sha`, `size`, `content` (base64), `encoding`. Содержимое приходит **base64-закодированным**, а не сырым текстом. Значит `vb install` должен декодировать base64 и, возможно, проверять `sha` (для сверки с хешами lock-файла — но там sha256 файла, а тут git blob sha1, так что сверка не прямая).

## Связанное

- ref-26 — общая часть Публичного API GitVerse (base URL, авторизация, заголовки, формат ошибок).
- VL-380 — общий транспорт GitVerse (`gitverse-http.ts`), токен `GITVERSE_TOKEN`.
- VL-335 / VL-337 / VL-338 — реестр и установка компонентов.
- doc-25 §5.1 (сеть), §4.3 шаг 3 (скачивание элемента).