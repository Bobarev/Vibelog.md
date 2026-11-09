---
id: ref-31
title: 'GitVerse CI/CD — контекст выполнения (переменные, данные события и коммитов)'
type: url
url: 'https://gitverse.ru/docs/cicd/docs/context'
tags:
  - gitverse
  - cicd
  - context
  - variables
  - upstream
created_date: 2026-11-08
linked_tasks: []
cached_path: references/cache/ref-31.md
cached_at: '2026-11-08T09:17:40.835Z'
source_hash: 8c69c6dd5a98b7311cb3e6d2f0d94de5849e4af64c10497530eba8effe34152c
---
## Что это

«Контекст GitVerse» — встроенная структура данных, доступная в любом шаге workflow через синтаксис `${{ ... }}`.

## Зачем для VL-375

CI-валидация путей в репозитории-инбоксе `upstream-reports` требует: узнать автора изменения (сопоставить с префиксом) и получить SHA для `git diff`.

## Проверенные факты

**Синтаксис:** `${{ <контекст>.<поле> }}`, работает в `if:`, `run:`, `env:`.

**Контексты:**

| Контекст | Описание | Пример |
|---|---|---|
| `gitverse` | Информация о событии, репозитории и т.д. | `${{ gitverse.repository }}` |
| `github` | **То же самое, для обратной совместимости** | `${{ github.repository }}` |
| `env` | Переменные окружения | `${{ env.MY_VAR }}` |
| `job` / `jobs` | Данные о текущей / всех job | `${{ job.build.result }}` |
| `runner` | Среда выполнения (ОС, архитектура) | `${{ runner.os }}` |
| `secrets` | Секреты репозитория | `${{ secrets.TOKEN }}` |
| `strategy` / `matrix` | Matrix-сборка | `${{ matrix.python-version }}` |
| `steps` | Результаты предыдущих шагов | `${{ steps.test.outputs.coverage }}` |
| `inputs` | Входные параметры `workflow_call` | `${{ inputs.name }}` |
| `vars` | Переменные репозитория/организации | `${{ vars.ENVIRONMENT }}` |

**Подтверждённые поля события** (из примеров документации):
- `${{ gitverse.actor }}` — инициатор события (автор push/PR);
- `${{ gitverse.ref_name }}` — имя ветки;
- `${{ gitverse.event_name }}` — тип события (`push`, `pull_request`);
- `${{ gitverse.repository }}` — полное имя репозитория.

Пример из документации:
```yaml
- name: Выведем ветку и инициатора пуша
  run: echo "Commit by ${{ gitverse.actor }} on branch ${{ gitverse.ref_name }}"
```

Пример с условием:
```yaml
if: ${{ gitverse.ref_name == 'master' && gitverse.event_name == 'push' }}
```

## Что НЕ подтверждено (проверить при реализации)

- Есть ли `gitverse.event.pull_request.base.sha` / `head.sha` (аналог GitHub). Документация даёт только примеры полей, полного перечня нет — возможно, придётся получать SHA через `git rev-parse` в шаге `run`.
- Есть ли `gitverse.event.before` (SHA до push) — без него для триггера `push` список изменённых файлов придётся брать как `git diff --name-only HEAD~1 HEAD` (неверно для merge-коммитов с несколькими родителями).
- Различаются ли `gitverse.actor` (инициатор) и автор коммита (`gitverse.event.head_commit.author.username`).

**Практический вывод:** имена полей `gitverse.*` документированы фрагментарно, поэтому в workflow надо сначала сделать диагностический шаг с `toJson(gitverse)` — вывести весь контекст в лог и посмотреть реальную структуру, а не угадывать.