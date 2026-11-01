---
id: VL-210
title: 'init: интерактивный wizard настройки проекта (консольный + web /setup)'
status: Spec
assignee: []
reporter: ''
created_date: '2026-10-29 10:21'
updated_date: '2026-10-29 10:29'
due_date: ''
labels:
  - cli
  - web
dependencies: []
milestone: ''
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
token_usage:
  input: 82149
  output: 2758
  cache: 53632
  total: 84907
  requests: 3
  duration_ms: 62137
  reasoning: 2252
  by_phase:
    spec:
      input: 82149
      output: 2758
      cache: 53632
      requests: 3
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас vibelog init создаёт только backlog/ и settings.json с дефолтами. Не настраивает: агента(ов), LLM (провайдер, модель), где хранить ключи, Telegram-бота, MCP. Новый пользователь не понимает, что делать дальше.

Нужен интерактивный wizard: консольный (readline) + web (/setup при первом запуске). Порядок вопросов — от агента(ов) к LLM (если vb) и боту. Wizard работает в двух режимах: fresh init (нет backlog/) и upgrade/migrate (backlog/ уже есть).

## Режимы работы

### Режим fresh init
backlog/ нет. Wizard создаёт с нуля: backlog/, backlog/config.yml, .vibelog/settings.json, AGENTS.md, .env (если выбран).

### Режим upgrade/migrate
backlog/ уже есть (проект уже использовал Backlog.md или Vibelog.md). Wizard:
- Читает существующий backlog/config.yml (project_name, task_prefix, statuses, labels, types, priorities, definition_of_done, workflows).
- Читает существующий .vibelog/settings.json (если есть: providers, models, workflows, task_workflows, chats, default_agent, env, mcpServers, branch_mode, compact, code_same_session, git_user_name).
- Показывает текущие значения как дефолты (Enter — оставить, изменить — ввести новое).
- НЕ перезаписывает существующие задачи, docs, lessons, references, decisions, milestones, completed/.
- Дополняет: providers (если нет), models (если нет), workflows (если нет), mcpServers (если нет), env (если нет).
- Если что-то уже настроено — не трогает без явного изменения.
- Лог: «Режим: upgrade (backlog/ найден). Существующие настройки: providers=да, models=2, workflows=default+simple. Дополняю недостающее».

Переключение режима — автоопределение по наличию backlog/ (или флаг --mode fresh|upgrade для явного выбора).

## Что спрашивает wizard (порядок)

### 1. Имя проекта и prefix
Имя (по умолчанию — из backlog/config.yml или директория), prefix (по умолчанию — из config.yml или VL).
В режиме upgrade — показать текущие, Enter — оставить.

### 2. Агент(ы) — множественный выбор (галочки)

Проверить наличие папок в проекте:
- .qwen/ → предложить qwen (галочка по умолчанию отмечена).
- .opencode/ → предложить opencode (галочка по умолчанию отмечена; если opencode adapter ещё не реализован — disabled с подсказкой «Скоро», галочка не ставится).
- .claude/ → предложить claude (disabled, «Скоро»).

Если папки .opencode/ или .claude/ нет — НЕ показывать соответствующий пункт (не disabled, а вообще скрыть). Только реально доступные агенты в списке.

Галочки (множественный выбор, ни одна не обязательна):
[ ] vb (встроенный Vibelog-агент, нужен LLM) — по умолчанию не отмечен
[ ] qwen (внешний Qwen Code) — отмечен, если есть .qwen/
[ ] opencode (внешний OpenCode) — отмечен, если есть .opencode/ (disabled, если adapter не реализован)
[ ] claude (disabled, «Скоро») — показывать, только если есть .claude/

Если ни одна галочка не отмечена — проект без агента (только таск-менеджер: CLI + MCP + веб). Валидный сценарий. Wizard пропускает LLM-настройку (шаг 5), MCP-настройку (шаг 6) и ping LLM (шаг 7).

default_agent: если отмечен ровно один агент — он default (не спрашивать). Если больше одного — вопрос «Какой по умолчанию?». Если ни одного — default_agent не пишется (или пустая строка). В режиме upgrade — текущий default_agent показан как дефолт.

Дальше:
- vb отмечен → LLM-настройка (шаг 5).
- qwen/opencode отмечены → MCP-настройка (шаг 6).
- Ни одного — пропустить шаги 5 и 6.

### 3. Где хранить ключи

Вопрос: «Где хранить API-ключи и токены?»
- .env (gitignore) — ключи в .env файле проекта. Рекомендуется.
- settings.json (секция env, gitignore) — ключи в .vibelog/settings.json. Удобно, если .env нет.
- Оба (по умолчанию: .env, fallback на settings.json env) — VL-143.

По умолчанию — .env. В режиме upgrade — если .env уже есть и содержит ключи, показать «Секреты: .env (N ключей). Оставить?» Да → оставить. Нет → выбрать заново.
При выборе сохранить ключ (LLM, bot) — wizard пишет в выбранное место.
Если .env нет — создать с комментарием-шапкой.

### 4. Telegram-бот
«Настроить Telegram-бота?» Да → токен, чаты (опционально). Нет → пропустить.
В режиме upgrade — если env.telegram_token уже задан, показать «Бот уже настроен (чаты: N). Перенастроить?» Да → токен, чаты. Нет → оставить.

### 5. LLM: провайдер и модель (только если vb отмечен)

Провайдер: выбор из providers в settings.json (если есть) или добавить новый (id, base_url, api_key_env). Ключ — проверить, что переменная окружения задана (или ввести — сохранить в выбранное место, шаг 4).
Модель: выбор из available для выбранного провайдера или добавить новую (model id, label, api_mode chat|responses, pricing опционально). default — выбранная модель.
В режиме upgrade — если providers/models уже есть, показать текущий default и список available, Enter — оставить.

### 6. MCP (если qwen или opencode отмечены)
«Настроить vibelog MCP в .qwen/settings.json (и .opencode/ при наличии)?» Да → записать mcpServers.vibelog. Нет → пропустить.
В режиме upgrade — если mcpServers.vibelog уже есть, показать «MCP уже настроен (trust: true). Оставить?» Да → оставить. Нет → перенастроить.

### 7. Проверка
- Если vb — ping LLM (POST chat/completions или responses), показать модель, задержку, usage.
- Если qwen — which qwen, версия >= 0.24.
- Если opencode — which opencode, версия.
- Если бот — getMe (проверка токена).
Ошибки — понятные, предложить исправить.

## Консольный wizard

readline (или prompts-подобный на чистом Node). Галочки — интерактивный список (space — toggle, enter — confirm). Каждый шаг — вопрос с дефолтом (Enter — дефолт). Валидация: пустое имя, неверный prefix, несуществующий провайдер, неверный api_mode, недоступный LLM, qwen не в PATH, бот getMe упал.

Флаги для non-interactive:
--yes (все дефолты, без вопросов)
--mode fresh|upgrade (автоопределение по backlog/, если не указан)
--project-name, --prefix
--agents vb,qwen,opencode (список через запятую; пустая строка — без агентов)
--default-agent vb|qwen|opencode (только если больше одного)
--bot (настроить), --bot-token, --bot-chats
--secrets-location env|settings|both (по умолчанию env)
--provider <id>, --base-url, --api-key-env
--model <id>, --api-mode chat|responses
--no-mcp, --skip-llm-check, --skip-bot-check, --force (перезаписать существующее)

При --yes: дефолты (агенты — автоопределение по папкам .qwen/.opencode; vb не добавляется автоматически; если папок нет — без агентов; без бота, .env для секретов, vibelog MCP если qwen/opencode, ping LLM опционально --skip-llm-check). В режиме upgrade --yes: дополнить недостающее, не перезаписывать существующее.

## Web wizard /setup

При vibelog init — открыть браузер на /setup (или /#/setup).
Форма (React + shadcn/ui): пошагово (Stepper) или секциями.
Агенты — чекбоксы (ни одна не обязательна; qwen/opencode показывать только при наличии папок; vb всегда в списке).
Секреты — radio: .env | settings.json | оба.
Сохраняет в backlog/config.yml + .vibelog/settings.json + .env (если выбран).
Ping LLM — кнопка «Проверить», показывает модель, задержку, usage.
После сохранения — редирект на #/ (канбан) с тостом «Проект настроен».
Если backlog/ или settings.json уже есть — /setup в режиме upgrade: показывает текущие значения (редактирование), не перезаписывает существующие задачи/docs/lessons/references/decisions/milestones/completed.

## Интеграция с существующим

- providers, models (settings.json) — источник для выбора (предыдущая задача).
- MCP (VL-149) — .qwen/settings.json mcpServers.
- Telegram (VL-143) — settings.json env.telegram_token / chats.
- API-ключ — .env (loadDotEnv) или env-секция settings.json (по выбору шага 4).
- init --skills (удалён VL-188) — не возвращать.
- Upgrade-режим: не трогать backlog/tasks/, backlog/completed/, backlog/docs/, backlog/lessons/, backlog/references/ (кроме metadata, если дополняем), backlog/decisions/, backlog/milestones/.

## Валидация и ошибки

- Провайдер не существует → «Провайдер X не найден. Добавьте: vibelog provider add ...».
- api_key_env не задан в env/.env → «Переменная X не задана. Введите ключ или добавьте в .env».
- Модель не существует → список доступных.
- LLM ping упал → показать статус, тело ответа (обрезка), предложить исправить base_url/api_key/model.
- qwen не в PATH → «qwen не найден. Установите: npm i -g @qwen-code/qwen-code».
- opencode не в PATH → «opencode не найден. Установите по инструкции».
- Бот getMe упал → «Токен невалиден. Проверьте TELEGRAM_BOT_TOKEN» или прокси.
- Upgrade-режим: если backlog/ есть, но config.yml битый → «backlog/config.yml повреждён. Восстановите вручную или --force для перезаписи».

## Логи и диагностика

Лог wizard: «Режим: fresh/upgrade. Агенты: qwen (default). Провайдер: —, модель: —. Секреты: .env. Бот: нет. MCP: да».
При ошибке — понятное сообщение, не стектрейс.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-29 10:29
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Тип: feature. Масштаб: task. Приоритет: Medium. Уточнено: критерии приёмки (3 проверяемых — консольный wizard с порядком вопросов и автоопределением режима, upgrade-режим без перезаписи существующего, web /setup + non-interactive флаги), тип и приоритет. Labels: cli, web. References: нет. Вопросов нет.
---
<!-- COMMENTS:END -->