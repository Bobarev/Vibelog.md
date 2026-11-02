---
id: VL-305
title: vibelog agent run — запуск фазы без отдельного бинаря
status: Planned
assignee: []
reporter: ''
created_date: '2026-11-02 18:50'
updated_date: '2026-11-02 18:50'
due_date: ''
labels:
  - agent
  - cli
  - ux
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
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Сейчас запуск фазы агентом требует отдельного бинаря `vibelog-agent`:

```bash
vibelog-agent plan VL-111 --model routerai/... --headless
```

При этом `vibelog agent` — это TUI-чат, и `vibelog agent plan VL-111` падает с «Неизвестная подкоманда agent: plan». Пользователь ожидает обратного: `vibelog agent <что-то> <параметры>`. На этом уже потеряно время при первом прогоне эксперимента (VL-293/exp-1).

## Цель

Добавить в `vibelog agent` подкоманду `run`, которая делегирует запуск фазы в существующий агентский CLI. `vibelog-agent` как отдельный бинарь **остаётся** — его спавнит оркестратор (`src/web/orchestrator.ts:960-963`, qwen-совместимый контракт: промпт позиционным аргументом, в stdout только JSON `type=result`).

## Почему не мердж в один бинарь

`bin/vibelog.mjs` перед роутингом делает проверку обновлений (`npm view`, до 3 с) и печатает заголовки — в headless-фазе это мусор в stdout и лишняя задержка. Плюс `dist/cli/router.js` статически тянет 24 модуля команд (включая grammy/bot). Поэтому `vibelog-agent` остаётся тонким входом для спавна, а `vibelog agent run` — удобный UX-путь для человека.

## Решение

`vibelog agent run <phase> <task-id> [флаги агента]` → вызов `main(argv)` из `dist/agent/cli.js` с аргументами `[phase, taskId, ...флаги]`.

Ключевая деталь: **флаги нельзя переинтерпретировать** парсером `vibelog` (`src/cli/args.ts`). Нужен доступ к сырому argv — сейчас `route(args)` его имеет, но `runAgent(subcommand, positional, flags, cwd)` — нет. Передавать сырой массив в `runAgent` (additive-параметр), а не собирать обратно из `flags` (иначе потеряются повторяющиеся флаги, порядок и значения с пробелами).

## Границы

- Не менять `bin/vibelog-agent.mjs` и `src/agent/cli.ts` (кроме, при необходимости, экспорта `main` — он уже экспортирован).
- Не менять спавн в оркестраторе.
- Не переносить `analyze` в новую схему (он уже работает как `vibelog agent analyze`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 vibelog agent run <phase> <task-id> [флаги] запускает headless-фазу через main() из dist/agent/cli.js и возвращает его exit code
- [ ] #2 Флаги фазы (--model, --headless, --comment, --max-tool-calls, --resume и др.) передаются в агент без потерь и без переинтерпретации парсером vibelog
- [ ] #3 vibelog agent run без аргументов печатает справку по фазам и exit 1 (не падает стектрейсом)
- [ ] #4 vibelog agent run с неизвестной фазой → понятная ошибка со списком фаз (текст от агента, не от роутера)
- [ ] #5 Существующее поведение vibelog agent (чат) и vibelog agent analyze не изменилось — регрессионные тесты зелёные
- [ ] #6 vibelog-agent остаётся отдельным бинарём и продолжает использоваться оркестратором (spawn не тронут)
- [ ] #7 Справка vibelog agent и help-текст дополнены строкой run <phase> <task-id>
- [ ] #8 CHANGELOG.md обновлён
- [ ] #9 pnpm build && pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->