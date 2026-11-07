---
id: ref-26
title: 'GitVerse Public API — общая информация (base URL, авторизация, заголовки, ошибки)'
type: url
url: 'https://gitverse.ru/docs/developers/public-api'
tags:
  - gitverse
  - api
  - auth
  - pagination
  - errors
  - upstream
created_date: 2026-11-07
linked_tasks:
  - VL-363
  - VL-365
cached_path: references/cache/ref-26.md
cached_at: '2026-11-07T16:54:34.344Z'
source_hash: db4137b92fa8b937be84078201cf188a82ce1458254389ae14191f34542c913b
---
## Что это

Общая часть документации Публичного API GitVerse: авторизация, обязательные заголовки, пагинация, формат ошибок. Нужна как база для интеграции Vibelog с GitVerse Issues (автоматизация баг-репортов между проектами).

## Ключевые факты (проверено по документации)

- **Base URL API: `https://api.gitverse.ru`** — не `gitverse.ru`. Пути без версии: `/repos/{owner}/{repo}/issues`.
- **Обязательный заголовок 1:** `Authorization: Bearer YOUR_TOKEN`. Токен создаётся в https://gitverse.ru/settings/tokens, показывается один раз.
- **Обязательный заголовок 2:** `Accept: application/vnd.gitverse.object+json;version=1`. Кастомный MIME-тип отделяет ответы API от обычного JSON.
- **Пагинация:** параметры `page` и `per_page`; навигация — заголовок `Link` с `rel="next"|"prev"|"first"|"last"`. Документация рекомендует ходить по URL из `Link`, а не собирать параметры вручную.
- **Формат ошибки:** `{"error": {"code": "BAD_REQUEST", "message": "...", "documentation_url": "...", "status": 400}}`. Ответы с ошибками НЕ содержат диагностики, стеков и уточнений — только машиночитаемый код и краткое сообщение.

## Отличие от уже известного нам поведения GitVerse

`src/core/registry-fetch.ts` (VL-335) работает с другим хостом и другой схемой: `https://gitverse.ru/api/repos/{owner}/{repo}/raw/branch/{branch}/{path}`, где отсутствующий файл отдаёт **400** (а не 404), а успешный ответ приходит с `content-type: text/plain`. Для Issues-API это не действует: здесь `api.gitverse.ru`, нормальный JSON и стандартные HTTP-статусы. Переиспользовать `registry-fetch` напрямую нельзя — общими остаются только приёмы (таймаут через `AbortController`, ретраи на 5xx, лимит тела).