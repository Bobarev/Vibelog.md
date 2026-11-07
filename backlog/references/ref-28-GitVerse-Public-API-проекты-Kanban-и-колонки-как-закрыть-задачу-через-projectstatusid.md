---
id: ref-28
title: 'GitVerse Public API — проекты (Kanban) и колонки: как закрыть задачу через project_status_id'
type: url
url: 'https://gitverse.ru/docs/developers/public-api/pull-and-issues_2/project/api-get-repos-owner-repo-projects'
urls:
  - 'https://gitverse.ru/docs/developers/public-api/pull-and-issues_2/project/api-get-repos-owner-repo-projects-project_id'
  - 'https://gitverse.ru/docs/developers/public-api/pull-and-issues_2/project/api-patch-repos-owner-repo-issues-index'
  - 'https://gitverse.ru/docs/developers/public-api/pull-and-issues_2/project/api-post-repos-owner-repo-projects-project_id-columns'
  - 'https://gitverse.ru/docs/developers/public-api/pull-and-issues_2/project/api-patch-repos-owner-repo-projects-project_id-columns-column_id'
tags:
  - gitverse
  - api
  - projects
  - kanban
  - columns
  - upstream
  - close-issue
created_date: 2026-11-07
linked_tasks:
  - VL-363
  - VL-365
cached_path: references/cache/ref-28.md
cached_at: '2026-11-07T17:02:27.572Z'
source_hash: 02a3d3d64444b3a18c133b6949748ba29e42238b75cf01d2c9c47bf46c391d4d
---
## Что это

Эндпоинты Публичного API GitVerse для проектов (Kanban-досок) и колонок. Нужны, чтобы **закрыть задачу (issue) программно**: в GitVerse состояние задачи определяется не полем `state`, а колонкой проекта (`project_status_id`).

## Состав (порядок секций кэша)

1. `GET /repos/{owner}/{repo}/projects` — список проектов репозитория.
2. `GET /repos/{owner}/{repo}/projects/{project_id}` — проект **со списком колонок** (здесь берутся `project_status_id`).
3. `PATCH /repos/{owner}/{repo}/issues/{index}` — перемещение задачи в проект/колонку.
4. `POST /repos/{owner}/{repo}/projects/{project_id}/columns` — создать колонку.
5. `PATCH /repos/{owner}/{repo}/projects/{project_id}/columns/{column_id}` — обновить колонку.

## Как закрыть задачу — проверенный рецепт

**Шаг 1.** `GET /repos/{o}/{r}/projects` → найти нужный проект, взять `id`.
**Шаг 2.** `GET /repos/{o}/{r}/projects/{project_id}` → в ответе `columns[]`, каждая колонка: `{id, title, color, default, sorting}`. Найти колонку с `title === "Done"` (или настроенным именем), взять её `id` — это и есть `project_status_id`.
**Шаг 3.** `PATCH /repos/{o}/{r}/issues/{n}` с телом `{"project_id": <id проекта>, "project_status_id": <id колонки Done>}`.

Ответ `200 OK` — объект Issue. Токен: права **Запись**.

## Матрица поведения `PATCH issues/{index}`

| `project_id` | `project_status_id` | Результат |
|---|---|---|
| `<id>` | `<id колонки>` | задача перемещается в указанную колонку указанного проекта |
| `<id>` | не передан | задача добавляется в проект (в колонку по умолчанию) |
| `null` | не передан | задача убирается из проекта (не удаляется) |
| не передан | `<id колонки>` | задача перемещается в колонку **текущего** проекта |

Последняя строка важна: если задача уже в проекте, достаточно передать только `project_status_id`.

## Ограничения и подводные камни

- Задача может быть **только в одном проекте**; перемещение в новый разрывает привязку к прежнему.
- `project_status_id` должен принадлежать проекту из `project_id`; несуществующая/удалённая колонка → ошибка.
- Перемещение **не меняет** `number`, `state` и прочие стандартные поля. В ответе `state` остаётся `"open"` — это НЕ признак незакрытости.
- **Признак закрытия — колонка.** Фильтр `GET issues?state=closed` определён как «статус равен Done» (ref-27), то есть после перемещения в Done задача попадает в `state=closed` выборку, хотя поле `state` в объекте остаётся `open`.
- Коды: `200` успех, `400` некорректное тело, `401` токен, `403` нет прав, `404` репозиторий/задача/проект не найдены, `500` сервер.
- Формат ошибки в этом разделе отличается от общего: `{"message": "Not Found", "documentation_url": "..."}` — без обёртки `error`. Парсер ошибок должен поддерживать обе формы.

## Следствия для реализации

- Нужен резолвер «id колонки Done»: `GET projects` → `GET projects/{id}` → поиск колонки по имени. Кэшировать в `.vibelog/settings.json` (`upstream.project_id`, `upstream.done_status_id`), чтобы не делать 2 лишних запроса на каждое закрытие.
- Имя колонки «Done» настраиваемое: в конфиге `upstream.done_column` (дефолт `"Done"`), иначе на русскоязычной доске будет «Готово».
- Если задача не привязана к проекту — сначала `PATCH` с `project_id` + `project_status_id` (обе поля), это допустимая комбинация.
- Закрытие = перемещение в Done + `POST comments` с итогом (ack для дочернего проекта).