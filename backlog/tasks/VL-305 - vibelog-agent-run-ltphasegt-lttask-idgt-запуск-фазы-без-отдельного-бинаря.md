---
id: VL-305
title: vibelog agent run — запуск фазы без отдельного бинаря
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 18:50'
updated_date: '2026-11-03 04:00'
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
modified_files:
  - src/cli/commands/agent.ts
  - src/cli/router.ts
  - src/cli/cli.test.mjs
lessons:
  - lesson-186
token_usage:
  input: 4735722
  output: 37666
  cache: 4329984
  total: 4773388
  requests: 80
  duration_ms: 827858
  reasoning: 21851
  by_phase:
    code:
      input: 3260541
      output: 30645
      cache: 3035136
      requests: 46
    close:
      input: 1475181
      output: 7021
      cache: 1294848
      requests: 34
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
- [x] #1 vibelog agent run <phase> <task-id> [флаги] запускает headless-фазу через main() из dist/agent/cli.js и возвращает его exit code
- [x] #2 Флаги фазы (--model, --headless, --comment, --max-tool-calls, --resume и др.) передаются в агент без потерь и без переинтерпретации парсером vibelog
- [x] #3 vibelog agent run без аргументов печатает справку по фазам и exit 1 (не падает стектрейсом)
- [x] #4 vibelog agent run с неизвестной фазой → понятная ошибка со списком фаз (текст от агента, не от роутера)
- [x] #5 Существующее поведение vibelog agent (чат) и vibelog agent analyze не изменилось — регрессионные тесты зелёные
- [x] #6 vibelog-agent остаётся отдельным бинарём и продолжает использоваться оркестратором (spawn не тронут)
- [x] #7 Справка vibelog agent и help-текст дополнены строкой run <phase> <task-id>
- [x] #8 CHANGELOG.md обновлён
- [x] #9 pnpm build && pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 03:56
---
Фаза 3 (Code) выполнена. Реализовано без отдельного плана (минимально достаточная реализация).
Изменено (коммит 259749e):
- `src/cli/commands/agent.ts` — новая ветка `run` в `runAgent`, идёт ДО чат-ветки: `runAgent` получил additive-параметр `rawArgs` (сырой argv процесса), из него вырезается хвост после `run` и передаётся в `main()` из `dist/agent/cli.js` (динамический импорт — агентский стек не грузится в чат/analyze путях). Exit code агента возвращается процессу как есть (main сам ставит `process.exitCode`). Без аргументов / с одним позиционным / с флагом первым — `printRunHelp()` + exit 1 (AC3), `--help`/`-h` — справка и exit 0. Справка печатает фазы из общего реестра `PHASES` (`web/phase-prompt.ts`), а не хардкодом. Подсказка «Неизвестная подкоманда agent» дополнена `run <фаза> <task-id>`.
- `src/cli/router.ts` — `runAgent(subcommand, positional, flags, cwd, args)` — сырой argv пробрасывается (флаги НЕ собираются обратно из `flags`: сохраняются порядок, повторы и значения с пробелами, AC2). Строка справки `agent` и help-текст `vibelog agent --help` дополнены `run <фаза> <task-id>` (AC7).
- `src/cli/cli.test.mjs` — +6 тестов: справка без аргументов и exit 1; один позиционный → справка и exit 1; `run --help` → справка без ошибки; неизвестная фаза → ошибка АГЕНТА (`Неизвестная фаза` + список фаз из `renderPrompt`, а не текст роутера, AC4; тест делает chdir в тестовый проект — main работает от `process.cwd()`); передача флагов без переинтерпретации через `parseArgs` агентского CLI (`--model` со значением с пробелом, `--comment`, `--max-tool-calls`, `--headless`); подсказка неизвестной подкоманды упоминает `run`.
Проверки (полный прогон, без --exclude/--skip):
- `pnpm build` ✓
- `pnpm test` — 153 файла, **2853 passed, 4 skipped, 0 failed**. Первый прогон в ветке падал на `src/web/readme-standard.test.mjs` («README должен начинаться с H1») — падение унаследованное, не от правок: ветка vb/vl-305 отстала от master, где фикс уже есть (коммит 6bf8a29 «README-инвариант принимает HTML-H1 под логотипом»). Сделал `git merge master` в ветку — тест зелёный, полный прогон повторён после merge.
- Ручная проверка: `node bin/vibelog.mjs agent run` → справка по фазам + exit 1 (без стектрейса); `node bin/vibelog.mjs agent run deploy VL-305` → exit 1, в stderr текст агента.
Границы соблюдены: `bin/vibelog-agent.mjs`, `src/agent/cli.ts` и спавн в `src/web/orchestrator.ts` не тронуты (AC6 — отдельный бинарь на месте); `analyze` не переносился.
Не отмечено:
- AC8 (CHANGELOG.md) — по правилам фазы Code итоговую документацию (CHANGELOG, doc-7/doc-10) пишет Фаза Close после merge.
- DoD «Документация обновлена» — частично: справка CLI в коде обновлена, но doc-7/doc-10/CHANGELOG остаются на Close.
Что осталось: Фаза Close — CHANGELOG + doc-7 (`agent run`) и doc-10 (запуск фазы без бинаря), merge ветки.
---
author: @agent
created: 2026-11-03 03:59
---
Фаза Close выполнена. Ветка vb/vl-305 слита в master (1 коммит, merge c647222), worktree удалена (force — в ней был только untracked-симлинк backlog/references/data), ветка vb/vl-305 удалена.
Проверки после merge (полный прогон, без --exclude/--skip):
- `pnpm build` ✓
- ранний точечный фильтр: `npx vitest run src/cli/cli.test.mjs` — 35 passed ✓
- полный `npx vitest run` — 154 файла, **2861 passed, 4 skipped, 0 failed** ✓ (один прогон, повторов не было)
Документация (коммит e7ec711):
- `CHANGELOG.md` — запись в Unreleased (AC8 закрыт);
- `backlog/docs/doc-7-CLI-справочник-Vibelogmd.md` — новый раздел `agent` (чат / analyze / run) с описанием делегирования в `main()` и передачи сырого argv;
- `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` — режим «запуск фазы без отдельного бинаря (VL-305)».
Lessons: создан lesson-186 «Пробрасывай сырой argv в делегирующую подкоманду, а не собирай флаги обратно из разобранного объекта» (коммит d0a56fb), связан с задачей.
DoD: 1 «Тесты проходят» ✓, 2 «Документация обновлена» ✓ (CHANGELOG + doc-7 + doc-10), 3 «Нет регрессий» ✓. Все пункты выполнены, override не требуется. Подзадач у VL-305 нет.
---
<!-- COMMENTS:END -->