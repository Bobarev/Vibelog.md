---
id: ref-27
title: 'GitVerse Public API — задачи (issues) и метки: создание, список, комментарии, закрытие'
type: url
url: 'https://gitverse.ru/docs/developers/public-api/pull-and-issues_2/issues_2/api-post-create-issue'
urls:
  - 'https://gitverse.ru/docs/developers/public-api/pull-and-issues_2/general-methods/api-get-issues'
  - 'https://gitverse.ru/docs/developers/public-api/pull-and-issues_2/general-methods/api-get-repos-issues-index'
  - 'https://gitverse.ru/docs/developers/public-api/pull-and-issues_2/general-methods/api-patch-issues'
  - 'https://gitverse.ru/docs/developers/public-api/pull-and-issues_2/general-methods/api-post-issues-number-comments'
  - 'https://gitverse.ru/docs/developers/public-api/pull-and-issues_2/general-methods/api-get-repo-issues-index-comments'
  - 'https://gitverse.ru/docs/developers/public-api/pull-and-issues_2/general-methods/api-post-repos-labels'
  - 'https://gitverse.ru/docs/developers/public-api/pull-and-issues_2/general-methods/api-get-repos-labels'
tags:
  - gitverse
  - api
  - issues
  - labels
  - comments
  - upstream
  - bug-report
created_date: 2026-11-07
linked_tasks:
  - VL-363
  - VL-365
  - VL-367
cached_path: references/cache/ref-27.md
cached_at: '2026-11-07T16:54:47.267Z'
source_hash: 7a156895f0730e1c9c470d8bbd7892cbc253e6d4cd5e3c87e6e80c9faa8d3123
---
## Что это

Эндпоинты Публичного API GitVerse для работы с задачами (issues) и метками (labels) — транспорт для автоматизации баг-репортов между проектами Vibelog. Кэш склеен секциями в порядке ссылок.

## Состав (порядок секций кэша)

1. `POST /repos/{owner}/{repo}/issues` — создать задачу.
2. `GET /repos/{owner}/{repo}/issues` — список задач (фильтры, пагинация).
3. `GET /repos/{owner}/{repo}/issues/{issue_number}` — одна задача.
4. `PATCH /repos/{owner}/{repo}/issues/{issue_number}` — изменить задачу.
5. `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` — комментарий (ack).
6. `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` — комментарии.
7. `POST /repos/{owner}/{repo}/labels` — создать метку.
8. `GET /repos/{owner}/{repo}/labels` — список меток.

## Проверенные факты по API (читать перед реализацией)

**Создание задачи** — `POST /repos/{o}/{r}/issues`, тело JSON:
- `title` (обязателен, не пустой), `body` (markdown), `type` (`task|bug|story|epic`, необязателен — иначе тип по умолчанию), `labels` (**массив строк**, метки ДОЛЖНЫ уже существовать в репозитории), `assignees` (логины), `due_date` (RFC 3339), `milestone` (integer id), `project_id`/`project_status_id`.
- Заголовки: `Authorization: Bearer <token>`, `Accept: application/vnd.gitverse.object+json;version=1`, `Content-Type: application/json`.
- Токен: права **Запись** на репозиторий.

**Список задач** — `GET /repos/{o}/{r}/issues`, query:
- `state=open|closed` (`open` = статус не «Done», `closed` = «Done»), `q` (поиск по заголовку/номеру), `labels=bug,ui` (через запятую, И-логика; `-high` — исключить), `type`, `created_by`, `assigned_by`, `milestones`, `sort=created|updated|comments|due_date`, `direction=asc|desc`, `since`/`before` (RFC 3339), `per_page` (**макс. 100**, дефолт 30), `page`.
- Токен: права **Чтение**. Приватный репозиторий без доступа → `404`.

**Обновление задачи** — `PATCH /repos/{o}/{r}/issues/{n}`, все поля опциональны:
- `title`, `body`, `type`, `labels` (полная замена; `[]` очищает), `assignees`, `milestone`, `due_date`, `project_id`, `project_status_id`.
- ⚠️ **`state` для задачи ИГНОРИРУЕТСЯ** — состояние задачи определяется статусом проекта (`project_status_id`). `state: open|closed` работает только для pull request. Это ломает наивный сценарий «закрыть issue через PATCH state=closed»: нужно либо знать id статуса «Done» проекта, либо закрывать через веб/иной путь.

**Комментарий** — `POST /repos/{o}/{r}/issues/{n}/comments`, тело: `body` (обязателен), опционально `is_review`, `is_thread`, `reply_to`, `thread_id`. Токен: **Запись**.

**Метки** — `POST /repos/{o}/{r}/labels`, тело: `name` (**макс. 20 символов**), `color` (hex без `#`), `description` (макс. 100), `exclusive`. Ответ `201 Created`. Нет прав → `404`.

## Следствия для дизайна

- Метки `upstream` (8) и `from-ui` (7) укладываются в лимит 20 символов; создавать их надо заранее (`POST labels`), иначе `POST issues` с несуществующей меткой не сработает.
- Дедуп и импорт — через `GET issues?labels=upstream&state=open&per_page=100` + пагинация по `Link`.
- Ack — `POST comments` с номером задачи Vibelog.
- Закрытие issue после исправления требует `project_status_id` статуса «Done» — его надо получить из настроек проекта GitVerse (эндпоинт проектов/статусов в этот кэш не входит; при необходимости — отдельный reference).