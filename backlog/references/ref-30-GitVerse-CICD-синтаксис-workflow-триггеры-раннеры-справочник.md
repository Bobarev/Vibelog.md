---
id: ref-30
title: 'GitVerse CI/CD — синтаксис workflow, триггеры, раннеры (справочник)'
type: url
url: 'https://gitverse.ru/docs/cicd/docs/workflow'
urls:
  - 'https://gitverse.ru/docs/cicd/docs/triggers'
  - 'https://gitverse.ru/docs/cicd/docs/runners'
  - 'https://gitverse.ru/docs/cicd/docs'
tags:
  - gitverse
  - cicd
  - workflow-syntax
  - triggers
  - runners
  - upstream
created_date: 2026-11-08
linked_tasks: []
cached_path: references/cache/ref-30.md
cached_at: '2026-11-08T09:17:08.078Z'
source_hash: 290217c0bd9fa480816c0e92fcf90e0a1ca04f84bf3d0c716d78829ed228ede8
---
## Что это

Справочная документация GitVerse CI/CD: синтаксис workflow, триггеры, раннеры. Нужна для VL-375 — CI-валидация путей в репозитории-инбоксе `upstream-reports`.

## Проверенные факты (читать перед написанием workflow)

**Директория:** `.gitverse/workflows/`, каждый файл — отдельный workflow, YAML, расширение `.yaml`/`.yml`.

**Структура** (совместима с GitHub Actions):
```yaml
name: Validate paths
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: <shell>
```

**Триггеры и фильтры путей** — поддерживаются:
- `on.push.branches` / `branches-ignore`
- `on.push.tags` / `tags-ignore` (glob: `v[0-9]+.[0-9]+.[0-9]+`)
- `on.push.paths` / `paths-ignore`
- `on.pull_request.*` — то же самое
- `on.pull_request_target.*`
- `on.workflow_call` (переиспользуемые workflow, с `secrets` и `inputs`)
- cron, ручной запуск, webhook

Пример с фильтрацией:
```yaml
on:
  push:
    branches: [master]
    paths:
      - 'sub-project/**'
      - '!sub-project/docs/**'
```

**Секреты и переменные:**
- `${{ secrets.NAME }}` — из настроек репозитория/организации;
- `${{ vars.NAME }}` — переменные репозитория/организации;
- `env:` — на уровне workflow, job и step;
- `$GITVERSE_OUTPUT` — файл для передачи значений между шагами (`echo "key=value" >> "$GITVERSE_OUTPUT"`).

**jobs:** поддерживаются `needs` (зависимости), `matrix` (в т.ч. `matrix.<name>.env`), `outputs`, `if`.

## Что НЕ покрыто этой документацией

- Имена переменных окружения по умолчанию (время, workspace, токен) — смотреть ref-31 (контекст).
- Обязательные status checks и branch protection — это настройка репозитория, не workflow.
- Доступные образы раннеров кроме `ubuntu-latest` — страница runners обзорная.