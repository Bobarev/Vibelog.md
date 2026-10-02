---
id: VL-37
title: 'Telegram-бот: поддержка прокси (TELEGRAM_PROXY, undici ProxyAgent)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 20:08'
updated_date: '2026-10-02 20:50'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
При ручной проверке VL-34 обнаружено: Telegram API (149.154.166.110) недоступен напрямую с сети Pavel (TCP 443 таймаут — блокировка), но доступен через системный прокси macOS 127.0.0.1:7070 (проверено curl -x: getMe → ok, @my_agent_007_robot). Node fetch и grammy не используют системный прокси macOS.

Решение: TELEGRAM_PROXY env → telegram_proxy в .vibelog/bot.yml; при заданном значении — undici ProxyAgent + кастомный fetch в клиенте grammy (new Bot(token, { client: { fetch } })). undici — чистый JS (совместим с Catalina).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Бот поддерживает прокси: TELEGRAM_PROXY (env) → telegram_proxy в .vibelog/bot.yml; при заданном прокси запросы к Telegram идут через него (undici ProxyAgent, клиент grammy)
- [x] #2 Без прокси — поведение не меняется; unit-тест resolveProxy (env → файл → null)
- [x] #3 Ручная проверка: TELEGRAM_PROXY=http://127.0.0.1:7070 vibelog bot — getMe проходит, /start с пином привязывает чат, /tasks /task /board отвечают
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->