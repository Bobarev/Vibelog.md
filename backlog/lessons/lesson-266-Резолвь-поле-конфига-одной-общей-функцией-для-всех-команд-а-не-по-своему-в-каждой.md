---
id: lesson-266
title: 'Резолвь поле конфига одной общей функцией для всех команд, а не по-своему в каждой'
status: active
tags:
  - config
  - cli
  - create
  - install
  - registries
source_tasks: []
linked_tasks:
  - VL-385
created_date: 2026-11-09
updated_date: 2026-11-09
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
В `vb create` alias реестра (`vibelog.md`) подставлялся в поле owner при построении URL клонирования, тогда как `vb install` через `resolveInstallContext` брал настоящий owner из `registries[alias].owner` (`Vibelog-md`). Две команды по-разному понимали одно и то же поле конфига, и пользователь видел «repository not found» вместо ошибки настройки.

## Решение
Если два места читают одну секцию конфига, резолв должен быть один: вынеси его в общую функцию (`resolveTemplateRegistry` по образцу `resolveInstallContext`) и переиспользуй в обеих командах, а не дублируй чтение конфига. Резолв выполняй до создания временных каталогов и любых сетевых/git-вызовов, чтобы ошибка конфигурации печаталась без шума; при отсутствии секции подставляй дефолт из существующей функции (`defaultComponentsConfig`), а не хардкод.
