---
id: lesson-218
title: 'Дополняй секции settings.json слиянием «недостающие ключи», чтобы не перетирать пользовательские значения'
status: active
tags:
  - settings-json
  - idempotency
  - cli
  - init
source_tasks:
  - VL-336
linked_tasks:
  - VL-336
created_date: 2026-11-05
updated_date: 2026-11-05
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

`vibelog init` пишет `.vibelog/settings.json`, который коммитится в git (VL-329) и содержит пользовательские секции (`models`, `chats`, `providers`, `mcpServers`, `workflows`). Прямая запись секции `components` затирала бы чужие ключи и давала шумный diff при каждом прогоне.

## Решение

Новую секцию пиши через read-modify-write со слиянием «дополнить недостающее»: существующие `registries`/`aliases` побеждают, дописываются только отсутствующие ключи; полная замена — только по явному `--force`. Сериализуй JSON детерминированно (стабильный порядок ключей), иначе повторный прогон меняет файл байт-в-байт и идемпотентность-тест (два прогона → побайтное равенство) падает. Lock-файл создавай только при отсутствии, существующий не перезаписывай.

## Пример

VL-336: `applyComponentsStep` в `src/core/setup.ts` вызывает `writeComponentsConfig(cwd, mergeComponentsConfig(existing, defaultComponentsConfig(cwd)))`; при `--force` — запись дефолтов без слияния. Тест `src/cli/init-components.test.mjs` проверяет два прогона (файл идентичен), сохранение `models`/`chats`/неизвестных ключей и неприкосновенность существующего `installed.lock.json`.