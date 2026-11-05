---
id: lesson-220
title: Обновляй installedAt и lock только при реальной записи файлов — иначе повторный install даёт diff в git
status: active
tags:
  - install
  - idempotency
  - lock
  - vb-cli
source_tasks:
  - VL-337
linked_tasks:
  - VL-337
created_date: 2026-11-05
updated_date: 2026-11-05
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

Повторный запуск идемпотентной команды установки (пользователь забыл, что уже ставил) переписывал lock-файл: обновлялся `installedAt`, менялся порядок/сериализация — каждый запуск давал шумный diff в git, хотя содержимое проекта не менялось.

## Решение

Обновлять `installedAt` и переписывать lock **только при реальной записи файлов**. Если все файлы в состоянии `skip-identical` и сериализованная запись lock совпадает с существующей (version, dependencies, хеши) — lock не трогать, вывести «уже установлено, изменений нет», код `0`. Тест — побайтовое сравнение lock-файла после двух прогонов подряд.

## Пример

VL-337, `applyInstallPlan` в `src/core/install.ts`: тест «идемпотентность: второй прогон не меняет lock побайтово» — читает `installed.lock.json` до и после второго `vb install` и сравнивает буферы.
