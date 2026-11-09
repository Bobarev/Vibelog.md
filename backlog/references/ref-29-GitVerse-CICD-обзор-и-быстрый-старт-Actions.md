---
id: ref-29
title: GitVerse CI/CD — обзор и быстрый старт (Actions)
type: url
url: 'https://gitverse.ru/docs/cicd/quick-start'
urls:
  - 'https://gitverse.ru/docs/cicd/introduction'
tags:
  - gitverse
  - cicd
  - actions
  - workflow
  - upstream
created_date: 2026-11-08
linked_tasks: []
cached_path: references/cache/ref-29.md
cached_at: '2026-11-08T09:16:42.803Z'
source_hash: 98993a316f927fcdd28c005178aba2499905aeef9e22d016c969d2eaa38b438f
---
## Что это

Документация GitVerse CI/CD (Actions): обзор, быстрый старт, синтаксис workflow. Нужна для задачи VL-375 — CI-валидация путей в репозитории-инбоксе `upstream-reports` (проверка, что изменённые файлы принадлежат префиксу автора).

## Зачем

Без реального контракта (директория workflow-файлов, формат YAML, доступные экшены) писать CI нельзя — получится догадка вроде `per_page` вместо `limit` (VL-367). Этот reference — источник фактов.

## Где применяется

VL-375 (git-транспорт баг-репортов): workflow `.gitverse/workflows/validate-paths.yml` (путь уточнить по документации), проверяющий инварианты:
- изменённые файлы ⊆ `reports/<prefix автора>/**`;
- в чужих файлах разрешена правка только полей `status`/`accepted_as`.