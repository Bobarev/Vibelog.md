---
id: decision-12
title: 'Пересмотр инварианта VL-329: Telegram-секреты и каналы — в .vibelog/comms.yaml, .env остаётся legacy-fallback'
date: 2026-11-18
status: accepted
---
## Context

Инвариант VL-329 (2026-10): «Секреты и chat_id — только .env» — токены, API-ключи и TELEGRAM_CHAT_IDS живут в .env, секция env в settings.json больше не читается и не пишется, settings.json коммитится в git. VL-428 (каналы interbot) добавляет структурированную конфигурацию межпроектной связи: секреты telegram (токен, прокси), список чатов, сущности каналов (group_id, addressing, approval, admin_chat), default_channel и sync_timeout_sec — всё это неудобно и небезопасно размазывать по строкам .env и невозможно валидировать.
## Decision

Новый файл .vibelog/comms.yaml становится источником Telegram-секретов и конфигурации каналов: секции secrets.telegram, chats, channels, default_channel, sync_timeout_sec. Миграция одноразовая и обратно-совместимая: при первом запуске init-wizard и при старте бота TELEGRAM_BOT_TOKEN/TELEGRAM_PROXY/TELEGRAM_CHAT_IDS переносятся из .env в comms.yaml (паттерн upsertDotEnv — построчное чтение с сохранением комментариев, temp+rename), после чего дубли в .env не поддерживаются. Порядок чтения: shell env → comms.yaml → legacy .env с предупреждением. comms.yaml не коммитится (секреты вне git). Инвариант VL-329 пересматривается в части Telegram: для токена/прокси/chat_ids источник — comms.yaml, .env остаётся legacy-fallback; прочие секреты (API-ключи LLM и т.п.) по-прежнему только в .env.
## Consequences

Старые проекты получают автоматическую миграцию без ручных действий; после миграции правки токена делаются в comms.yaml, а не в .env (иначе shell env/comms.yaml перекроют legacy). Риск: comms.yaml содержит секрет — файл должен быть вне git (политика .vibelog/.gitignore по умолчанию запрещает коммитить) и не должен дублироваться в settings.json/.env после миграции. Валидация канала при чтении даёт понятные ошибки («несколько каналов без default»). Тесты миграции (init-wizard.test) закрепляют поведение: .env очищается от TELEGRAM_*, токен уезжает в comms.yaml.
## Alternatives

1) Оставить всё в .env — отклонено: строки .env не дают структуры для каналов (addressing/approval/admin_chat), валидация и чтение из нескольких процессов (бот ≠ MCP-сервер) становятся хрупкими. 2) Хранить в .vibelog/settings.json — отклонено: settings.json коммитится в git, секреты в нём недопустимы (тот же класс ошибки, что убрал VL-329). 3) Отдельный .env-comms — отклонено: третий файл-«почти-env» без структуры и без валидации.