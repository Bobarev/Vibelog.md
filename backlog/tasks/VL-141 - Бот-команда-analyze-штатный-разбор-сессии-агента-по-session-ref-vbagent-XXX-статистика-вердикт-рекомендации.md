---
id: VL-141
title: 'Бот-команда /analyze: штатный разбор сессии агента по session-ref (vb:agent-XXX) — статистика, вердикт, рекомендации'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-13 13:51'
updated_date: '2026-10-13 13:51'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Владелец регулярно просит разобрать сессию агента («проанализируй agent-XXX») — ручной цикл повторён уже 6+ раз за два дня (VL-98, VL-113, VL-117, VL-134, VL-122, VL-137): парсинг jsonl, подсчёт убийств wall-time/resume, профиль tool-вызовов, вердикт «объём задачи vs тупик», рекомендации. Нужна штатная команда.

Реализация: бот-команда /analyze vb:agent-XXX (session-ref в том же формате, что resume; поддержать и bare agent-XXX) → фаза analyze — headless-фаза без задачи (как prompt, runKey вида analyze-<sessionId>); taskId/фаза/cwd берутся из meta.json сессии (VL-114). Промпт-шаблон phase-analyze.md даёт агенту ДЕТЕРМИНИРОВАННЫЙ протокол: сначала node-скрипт статистики по jsonl (длительность, прогоны по «Продолжи», wall-убийства, «Пустой ответ модели», NaN-индексы, профиль вызовов по именам, топ tool-выводов, edit/read по файлам), затем вердикт и рекомендации (с проверкой, не заведена ли уже задача на найденную проблему — ссылки на существующие VL). То, что делал ассистент вручную, — в штатной команде.

CLI-паритет: vibelog agent analyze <ref> для запуска без бота. Реестр команд бота пополняется (учесть чек-лист BOT_COMMANDS + registry.test).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 templates/qwen-commands/phase-analyze.md: шаблон анализа — детерминированная статистика jsonl (node-скрипт: длительность, прогоны/resume, wall-убийства, пустые финалы, NaN-индексы, профиль tool-вызовов, топ больших tool-выводов, чтения/правки по файлам) + вердикт (объём задачи vs тупик/расточительство) + рекомендации со ссылками на уже открытые задачи; финал — одно слово «Готово»
- [ ] #2 orchestrator: фаза analyze в PHASES/PHASE_FILES; запуск БЕЗ задачи (как prompt); taskId из meta.json сессии для контекста (фаза/задача); session-ref принимается вида vb:agent-XXX и agent-XXX
- [ ] #3 src/bot: parseAnalyzeCommand (+тесты commands.test), bot.command('analyze'), запись в BOT_COMMANDS реестра (registry.test: длина + help-строка)
- [ ] #4 CLI: vibelog agent analyze <session-ref> — тот же путь через startPhase('analyze'); тест в cli.test
- [ ] #5 docs/README: упоминание команды; pnpm test зелёный; CHANGELOG: запись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->