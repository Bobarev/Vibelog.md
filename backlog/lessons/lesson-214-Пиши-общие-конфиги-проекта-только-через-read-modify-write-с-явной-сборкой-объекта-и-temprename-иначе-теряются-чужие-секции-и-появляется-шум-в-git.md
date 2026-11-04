---
id: lesson-214
title: 'Пиши общие конфиги проекта только через read-modify-write с явной сборкой объекта и temp+rename, иначе теряются чужие секции и появляется шум в git'
status: active
tags:
  - settings
  - config
  - атомарность
  - git
  - components
source_tasks:
  - VL-333
linked_tasks:
  - VL-333
created_date: 2026-11-04
updated_date: 2026-11-04
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Общие файлы состояния проекта (`.vibelog/settings.json`, `.vibelog/installed.lock.json`) содержат секции разных подсистем и коммитятся в git. Дописывание секции «с нуля» затирает `chats`, `models`, `providers`, `workflows`, `mcpServers`; прямая запись поверх файла оставляет его битым при сбое; разный порядок ключей даёт шумные diff'ы в истории.

## Решение

1. Пиши только через read-modify-write: читать весь файл, заменять ровно один ключ, остальные секции сохранять как есть.
2. Собирай записываемый объект явно (фиксированный порядок ключей), не полагайся на порядок из `JSON.parse`.
3. Пиши атомарно: temp-файл `<path>.tmp-<pid>-<rand>` в том же каталоге → `fsync` → `rename` поверх целевого; при ошибке temp удалить, целевой не трогать.
4. Валидацию относительных путей делай через `path.resolve` + `path.relative`, отбрасывая `..` и абсолютные пути — на границе (алиасы из конфига) и повторно при склейке с внешним `target`.

## Пример

`writeComponentsConfig(cwd, config)` в `src/core/components-config.ts`: `loadSettings(cwd)` → `{...current, components: normalize(config)}` → `writeJsonAtomic(settingsPath(cwd), next)`. Тест на файле с посторонними ключами проверяет их сохранение, тест идемпотентности — байт-в-байт совпадение при повторной записи.
