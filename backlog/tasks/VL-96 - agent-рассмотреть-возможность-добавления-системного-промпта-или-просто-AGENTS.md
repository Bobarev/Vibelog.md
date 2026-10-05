---
id: VL-96
title: '#agent рассмотреть возможность добавления системного промпта или просто AGENTS'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-06 00:46'
updated_date: '2026-10-06 01:52'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Рассмотреть возможность добавления системного промпта или просто AGENTS.md в агента из VL-75 (мини-LLM-агент с TUI на Ink).

Цель 1 (системный промпт): у агента VL-75 должен быть системный промпт — либо встроенный в агента, либо читаемый из AGENTS.md проекта, — чтобы LLM получала контекст проекта при выполнении задач.

Цель 2 (кэш-токены): Использует ли агент кэш-токены? Сейчас в результатах фазы работы агента кэш-токены всегда 0. Если не использует — диагностировать причину и реализовать использование prompt caching в запросах к LLM API.

При планировании рассмотреть, как это реализовано в референсах, созданных в VL-76.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Системный промпт (встроенный и/или AGENTS.md проекта) подключён к агенту VL-75 и передаётся в запросы LLM при работе агента
- [x] #2 Причина нулевых cache-токенов в результатах фаз агента диагностирована; если prompt caching не используется — он реализован, и cache-токены в результатах становятся ненулевыми
- [x] #3 Существующие сценарии работы агента (команды, фазы) не сломаны — нет регрессий
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
ЦЕЛЬ 1 — системный промпт / AGENTS.md

Что выяснено в коде:
- cli.ts:323 собирает messages = [...resumedMessages, { role: 'user', content: prompt }] — системного сообщения НЕТ вообще. ChatMessage в llm.ts:24-28 уже допускает роль system, но никто её не создаёт.
- toWireMessages (llm.ts:196-212) пропускает system-сообщение как есть — wire-формат поддерживается без правок.
- runLoop (loop.ts:95) копирует options.messages и работает с любой ролью — правок не нужно.
- Референсы (VL-76): qwen-code читает AGENTS.md из корня рабочего каталога + ~/.qwen/ (workspace-memory.ts:516-560, config.ts); opencode подключает инструкции через instructions-конфиг и system-prompt-части с cache_control. Решение: минимальный вариант qwen-code — читать AGENTS.md из cwd проекта, без иерархии вверх по дереву (как упоминает памятка проекта: cwd агента = корень проекта Vibelog).

Решение (архитектура):
1. Новый модуль src/agent/system-prompt.ts:
   - buildSystemPrompt(cwd: string): string — собирает системный промпт: (а) встроенная базовая часть (роль агента Vibelog, язык вывода, правила работы с инструментами, кратко); (б) содержимое AGENTS.md проекта, если файл существует в cwd (читается синхронно через node:fs, отсутствие — не ошибка, просто базовая часть).
   - Лимит размера AGENTS.md-вставки (например 8000 символов) с обрезкой и пометкой — чтобы огромный AGENTS.md не съедал контекст.
   - Ошибка чтения (EACCES и т.п.) — предупреждение в stderr, промпт строится без AGENTS.md (фаза не должна падать).
2. cli.ts (место ~line 323): перед сборкой messages вызвать buildSystemPrompt(cwd) и вставить { role: 'system', content } ПЕРЕД resumedMessages. При resume системный промпт вставляется заново (в истории он мог быть сохранён старой версией — принять, что на headless-фазах это не критично; более консервативно: если resumedMessages[0] уже system — заменить его свежесобранным).
3. Проверка кэша-токенов НЕ зависит от system-промпта (см. Цель 2) — system добавляется в любом случае.

Файлы ЦЕЛИ 1:
- src/agent/system-prompt.ts (новый) — buildSystemPrompt + чтение AGENTS.md.
- src/agent/system-prompt.test.mjs (новый) — тесты: без AGENTS.md (только базовая часть), с AGENTS.md (вставка включена), обрезка по лимиту, ошибка чтения не роняет сборку.
- src/agent/cli.ts (~line 323 и parseArgs/cwd) — вставка system-сообщения; log-строка «системный промпт: N символов (AGENTS.md: да/нет)».
- src/agent/cli.test.mjs — тест на то, что в messages первый элемент role=system (через фейковый llm-клиент, как существующие тесты loop/cli).

ЦЕЛЬ 2 — диагностика нулевых cache-токенов и prompt caching

Что выяснено в коде:
- llm.ts mapUsage (строки 107-122) читает cache_read_input_tokens / cache_read_tokens. Если Cloud.ru отдаёт кэш под другим именем (OpenAI-стиль prompt_tokens_details.cached_tokens, или prompt_cache_hit_tokens) — мы всегда видим 0, хотя кэш работает. Это ГИПОТЕЗА №1 и её надо проверить первой.
- ГИПОТЕЗА №2: провайдер требует явного маркирования кэшируемых частей (cache_control: ephemeral как в opencode transform.ts:373, но это Anthropic-формат). Для OpenAI-совместимого endpoint Cloud.ru явный cache_control может быть либо игнорирован, либо отклонён (400). Реализуем только после подтверждения по ответу API.
- ГИПОТЕЗА №3: кэш не работает потому, что prefix запроса нестабилен (tools приходят в разном порядке из MCP/локальных, нет system-промпта как стабильного префикса). Упорядочивание tools (сортировка по имени в toWireTools или перед вызовом) + стабильный system-промпт улучшают шанс автоматического prefix-caching.
- ГИПОТЕЗА №4: минимальный размер префикса для кэша у Cloud.ru (как у OpenAI — 1024 токена). Короткие промпты фаз spec/comment могут не достигать порога — тогда кэш появится только на длинных фазах (code/plan). Это норма, не баг.

Порядок диагностики и реализации:
1. Добавить в llm.ts отладочный дамп: env VIBELOG_LLM_DEBUG_USAGE=1 → в stderr печатать usage-объект как есть (JSON) на каждой итерации. Это подтвердит/опровергнет гипотезу №1 без изменения маппинга.
2. Расширить mapUsage: читать ВСЕ известные варианты кэш-полей:
   - cache_read_input_tokens / cache_read_tokens (текущие)
   - prompt_tokens_details.cached_tokens (OpenAI-стиль, вложенное)
   - prompt_cache_hit_tokens (DeepSeek-стиль)
   Приоритет: прямые поля > вложенное. Это безопасно и покрывает гипотезу №1.
3. Стабильный prefix (гипотеза №3): сортировать tools по имени перед отправкой (в loop.ts или cli.ts перед runLoop) — одинаковый порядок между итерациями и сессиями.
4. Явный cache_control (гипотеза №2) — ТОЛЬКО если по VIBELOG_LLM_DEBUG_USAGE видно, что провайдер отдаёт кэш-поля в нестандартном виде или по документации Cloud.ru подтверждён Anthropic-протокол. Иначе — не добавляем (риск 400 на несовместимом endpoint).
5. Тесты mapUsage в llm.test.mjs: новые варианты полей usage → корректный cache_read_input_tokens.

Файлы ЦЕЛИ 2:
- src/agent/llm.ts — mapUsage (строки ~107-122) + дамп по env; возможно toWireTools/сортировка.
- src/agent/llm.test.mjs — тесты mapUsage на всех вариантах usage-полей.
- src/agent/loop.ts или cli.ts — сортировка tools (если выбран путь стабильного prefix).
- docs/agent.md — раздел о системном промпте, AGENTS.md и VIBELOG_LLM_DEBUG_USAGE.
- CHANGELOG.md — запись об изменениях.

ПОРЯДОК ДЕЙСТВИЙ (Фаза Code)
1. Построить system-prompt.ts + тесты (Цель 1, независимо от Цели 2).
2. Вставить system в cli.ts + тест cli.test.mjs.
3. Добавить VIBELOG_LLM_DEBUG_USAGE дамп + расширить mapUsage + тесты (Цель 2, шаги 1-2, 5).
4. Реальный прогон против Cloud.ru с debug-дампом — определить, какие поля usage реально приходят, и принять решение по cache_control и сортировке tools.
5. Сортировка tools + тесты (если гипотеза №3 подтверждена или как профилактика — дёшево и безопасно).
6. Документация + CHANGELOG.

КАК ПРОВЕРИТЬ
- pnpm build (tsc → dist)
- pnpm test (build + node --test src) — все *.test.mjs зелёные, новые тесты system-prompt и mapUsage проходят.
- Ручной прогон: VIBELOG_LLM_DEBUG_USAGE=1 node bin/vibelog.mjs agent --headless --no-mcp "короткий промпт" — в stderr виден usage JSON; в stdout JSON result с cache_read_input_tokens (после фикса — ненулевой на второй итерации loop, если кэш провайдером поддерживается).
- Проверить, что TUI-режим и headless не сломаны (нет регрессий по AC#3).

РИСКИ
- Cloud.ru может не поддерживать prompt caching на своём endpoint — тогда cache-токены останутся 0 и AC#2 не выполнится на стороне провайдера. Митигация: диагностика дампом до реализации; в комментарии фазы зафиксировать фактические поля usage и решение.
- Явный cache_control на несовместимом OpenAI-endpoint → 400. Митигация: не добавлять без подтверждения.
- Сортировка tools меняет порядок в запросе — модель видит другой порядок; на практике безопасно, но тесты loop/cli могут завязаться на порядке — проверить.
- Системный промпт + AGENTS.md увеличивают input-токены каждой итерации — учитывать лимит контекста; лимит вставки 8000 символов.
- Файлы src/agent/* параллельно меняются другими фазами (VL-95 сессии уже в cli.ts) — перед правкой сверять текущие сигнатуры (памятка: verify plan assumptions against landed code).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-06 00:47
---
Фаза 1 (Spec) выполнена. Масштаб: task. Уточнено: описание дополнено целями обеих частей — (1) подключить системный промпт или AGENTS.md проекта к агенту VL-75, (2) диагностировать причину нулевых cache-токенов и реализовать prompt caching, если он не используется; добавлены 3 критерия приёмки (системный промпт передаётся в запросы LLM; cache-токены становятся ненулевыми; нет регрессий). Референсы VL-176 упомянуты в задаче как ориентир для Фазы 2. Вопросов нет.
---
author: @agent
created: 2026-10-06 00:47
---
Поправка к предыдущему комментарию: опечатка — имелись в виду референсы VL-76 (не VL-176). В описании задачи указано верно.
---
author: @agent
created: 2026-10-06 00:59
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в implementationPlan (10 файлов, 2 цели).
Ключевые находки по коду:
- cli.ts:323 собирает messages БЕЗ system-сообщения вообще (только user-промпт + resume-история); ChatMessage и toWireMessages роль system уже поддерживают — вставка тривиальна.
- mapUsage в llm.ts читает только cache_read_input_tokens/cache_read_tokens — если Cloud.ru отдаёт кэш как prompt_tokens_details.cached_tokens (OpenAI-стиль) или prompt_cache_hit_tokens, мы всегда видим 0. Это гипотеза №1, проверяется дампом VIBELOG_LLM_DEBUG_USAGE.
- Референсы VL-76: opencode использует cache_control ephemeral (Anthropic-формат, transform.ts:373); qwen-code читает AGENTS.md из корня проекта (workspace-memory.ts). Решение: минимальный вариант qwen-code — AGENTS.md из cwd + встроенный базовый промпт.
Архитектурные решения плана:
1. Новый src/agent/system-prompt.ts — buildSystemPrompt(cwd): встроенный промпт + AGENTS.md (лимит вставки 8000 символов, ошибка чтения не роняет фазу).
2. cli.ts — system-сообщение перед resume-историей; при resume — замена устаревшего system свежим.
3. Диагностика кэша: сначала debug-дамп raw usage, затем расширение mapUsage на все варианты полей, сортировка tools для стабильного prefix; явный cache_control — только после подтверждения совместимости endpoint.
Риски: Cloud.ru может не поддерживать caching на своём endpoint (тогда AC#2 не выполнится на стороне провайдера — зафиксировать фактические поля usage в отчёте Фазы 3); cache_control может дать 400 на несовместимом endpoint; src/agent/* параллельно меняются VL-95 — сверять сигнатуры перед правкой.
---
author: Pavel Bobarev
created: 2026-10-06 01:15
---
Надо учесть что qwen работая на той же модели и провайдере - активно использует кэш токены. В его отчетных выводах по фазе всегда есть количество кэш токенов.
---
author: @agent
created: 2026-10-06 01:37
---
Фаза 3 (Code) выполнена.
**Изменено:**
- `src/agent/system-prompt.ts` (новый) — `buildSystemPrompt(cwd)`: встроенный базовый промпт (роль Vibelog-agent, русский язык, границы cwd, запрет необратимых действий) + AGENTS.md проекта из cwd (лимит вставки 8000 символов с обрезкой и пометкой; ошибка чтения — предупреждение в stderr, фаза продолжается).
- `src/agent/cli.ts` — system-сообщение вставляется перед resume-историей; при resume сохранённый system заменяется свежесобранным; лог «Системный промпт: N символов (AGENTS.md: да/нет)».
- `src/agent/llm.ts` — `mapUsage` расширен: читаются все варианты кэш-полей (прямые `cache_read_input_tokens`/`cache_read_tokens`/`prompt_cache_hit_tokens` + вложенное `prompt_tokens_details.cached_tokens`, приоритет прямых); отладочный дамп по env `VIBELOG_LLM_DEBUG_USAGE=1` (сырой usage в stderr).
- `src/agent/loop.ts` — tools сортируются по имени перед отправкой (стабильный префикс запроса → prefix-caching).
- Тесты: `system-prompt.test.mjs` (новый, 4), `llm.test.mjs` (+4: варианты кэш-полей + debug-дамп), `loop.test.mjs` (+1: сортировка tools), `cli.test.mjs` (+3: system первым сообщением, AGENTS.md в /tmp-проекте, лог stderr; обновлены длины сообщений/строк сессий VL-95 под system).
- Docs: `docs/agent.md` (раздел 3.2 «Системный промпт и кэш-токены», строка `VIBELOG_LLM_DEBUG_USAGE` в env-таблице), `CHANGELOG.md`.
**Диагностика нулевых cache-токенов (AC#2) — гипотеза №1 подтверждена:** реальный прогон с `VIBELOG_LLM_DEBUG_USAGE=1` против Cloud.ru показал, что провайдер отдаёт кэш во вложенном OpenAI-поле `prompt_tokens_details.cached_tokens` («usage raw: {…,\"prompt_tokens_details\":{\"cached_tokens\":2944},…}» на 2-й итерации) — прежний `mapUsage` читал только прямые поля и всегда видел 0. Явный `cache_control` НЕ понадобился — кэш работает автоматически при стабильном префиксе. Сортировка tools реализована как профилактика (гипотеза №3).
**Проверки AC#2 вживую:** (1) пробник — два одинаковых запроса: 2-я итерация cache_read=2944 из 2947 input-токенов; (2) фазовый прогон с tool calls (2 хода): JSON-результат `"cache_read_input_tokens":7616` — ненулевой. На однотурных запросах кэш остаётся 0 — это норма провайдера (хранилище создаётся первым запросом, читается со следующего с тем же префиксом).
**Проверки:** pnpm build OK; pnpm test — 692/692 (включая регрессионные VL-95/93/92 по сессиям и CLI). TUI не тронута (счётчики получают cache_read из того же mapUsage). Коммит не выполнялся (по правилам фазы).
**Отступления от плана:** отсутствуют; реализация точь-в-точь по плану Фазы 2 (включая замену system при resume — консервативный вариант плана).
---
author:  @agent
created: 2026-10-06 01:52
---
Фаза Close выполнена. Статус: Done. Коммит feat: 99588ca «feat: VL-96 — системный промпт агента (AGENTS.md) и учёт cache-токенов во всех вариантах usage» (10 файлов: src/agent/system-prompt.ts + тесты, cli.ts, llm.ts, loop.ts + тесты, docs/agent.md, CHANGELOG.md). modified_files в задаче были пусты — файлы взяты из отчёта Фазы 3 и сверены с git status; чужие файлы (src/bot/*, templates/*, docs/cli-reference.md, backlog-файлы параллельных задач) в коммит не добавлялись. Подзадач-батча нет (type=task).
---
<!-- COMMENTS:END -->