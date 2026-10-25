---
id: VL-169
title: Добавить необязательный комментарий к команде analyze
status: Done
assignee: []
reporter: ''
created_date: '2026-10-15 14:10'
updated_date: '2026-10-25 09:41'
due_date: ''
labels:
  - bot
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/bot/commands.ts
  - src/bot/handlers.ts
  - src/bot/registry.ts
  - src/cli/commands/agent.ts
  - src/cli/router.ts
  - src/web/orchestrator.ts
  - templates/qwen-commands/phase-analyze.md
  - src/bot/commands.test.mjs
  - src/bot/registry.test.mjs
  - src/web/orchestrator.test.mjs
  - src/web/phase-prompt.test.mjs
lessons:
  - lesson-8
  - lesson-9
  - lesson-21
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
К команде analyze нужно добавить необязательный комментарий — как у фаз: при выполнении команды можно передать текст комментария (по аналогии с backlog_finish_phase), а можно обойтись без него.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# VL-169: Необязательный комментарий к команде analyze

## Суть

Сейчас `/analyze vb:agent-XXX` принимает только session-ref. Нужно, как у фаз (VL-80 для /plan, /code): после session-ref можно передать текст комментария — он подставляется в промпт фазы analyze ({{comment}}); без комментария команда работает как раньше. Плюс CLI-паритет `vibelog agent analyze <ref> [комментарий]`.

Учитывая lessons: правка usage/description в BOT_COMMANDS (lesson-8) синхронно с registry.test.mjs (lesson-9).

## Файлы для изменения

1. **src/bot/commands.ts**
   - Интерфейс `AnalyzeCommand` (строки 97-104): добавить необязательное поле `comment?: string` (как в `PlanCommand`).
   - `parseAnalyzeCommand` (строки ~469-491): после `extractAgent` и нормализации session-ref — хвост после первого пробела → необязательный comment (паттерн `parsePlanCommand`, строки 245-252): `vb:agent-123 проверь wall-убийства` → `{sessionId:'agent-123', comment:'проверь wall-убийства'}`. Ключ `comment` добавлять ТОЛЬКО при непустом хвосте (иначе сломаются deepEqual-тесты). Обновить hint: `Синтаксис: /analyze[:agent] vb:agent-<id> [комментарий] (префикс vb: необязателен)`.
   - Обновить JSDoc: «session-ref [комментарий]».

2. **src/web/orchestrator.ts** — `startAnalyze` (строки ~348-404)
   - Сигнатура: добавить 5-й необязательный параметр `comment?: string` (после `agent` — минимальный churn в вызывающих).
   - В `renderPrompt('analyze', …)` (строка ~388) добавить `comment: comment ?? ''` в extraVars — тогда {{comment}} в шаблоне всегда подставится (пустая строка без комментария).
   - Обновить JSDoc.

3. **templates/qwen-commands/phase-analyze.md**
   - После строки 12 («Задача-владелец сессии…») добавить:
     ```
     Дополнительный комментарий пользователя к разбору: {{comment}}
     Если комментарий пуст — проигнорируй строку и работай по шагам.
     ```

4. **src/bot/handlers.ts** — хендлер analyze (строки 955-981)
   - Вызов `startAnalyze(deps.cwd, parsed.sessionId, onExit, agent)` (строка ~974) → передать `parsed.comment`.

5. **src/cli/commands/agent.ts**
   - Подкоманда analyze (строки 57-81): `const comment = positional.slice(1).join(' ').trim()` → передать в `startAnalyze` 5-м параметром. Обновить printError-синтаксис: `vibelog agent analyze <session-ref> [комментарий]` и JSDoc.

6. **src/cli/router.ts**
   - Справка agent (строки ~289-297): usage `vibelog agent analyze <session-ref> [комментарий]`, упомянуть необязательный комментарий.
   - Короткая строка help (строка 127): опционально уточнить `analyze <ref> [комментарий]`.

7. **src/bot/registry.ts** (строка 48, lesson-8)
   - `usage: '/analyze[:agent] <session-ref> [комментарий]'`, в description — `[комментарий]` после session-ref, examples: добавить `'/analyze vb:agent-1a2b сверь объём с AC'`.

8. **Тесты**
   - **src/bot/registry.test.mjs** (lesson-9, в той же итерации): строка 91 — ожидаемый usage `/analyze[:agent] <session-ref> [комментарий]`; строка 99 — строка /help: заменить `/analyze[:agent] <session-ref>` → `/analyze[:agent] <session-ref> [комментарий]`.
   - **src/bot/commands.test.mjs**: новые кейсы parseAnalyzeCommand: (а) `parseAnalyzeCommand('vb:agent-123 проверь wall', 'analyze')` → `{sessionId:'agent-123', comment:'проверь wall'}`; (б) без хвоста — comment-ключа нет (deepEqual, как строки 312-317); (в) `agent-123` с суффиксом `analyze:vb` и комментарием.
   - **src/web/orchestrator.test.mjs**: у блока analyze-тестов (~строки 1450-1505) — (а) `startAnalyze` с comment → в собранном промпте есть текст комментария; (б) без comment → промпт содержит пустую подстановку (не literal `{{comment}}`).

## Порядок действий

1. commands.ts (интерфейс + парсер + hint).
2. orchestrator.ts (параметр + extraVars).
3. phase-analyze.md (строка {{comment}}).
4. handlers.ts и cli/commands/agent.ts (передача comment в startAnalyze).
5. router.ts + registry.ts (справка, lesson-8).
6. Тесты: commands.test.mjs, registry.test.mjs, orchestrator.test.mjs (lesson-9).
7. Сборка и прогоны.

## Проверка

```bash
pnpm build
pnpm test:fast            # или адресно:
npx vitest run src/bot/commands.test.mjs src/bot/registry.test.mjs src/web/orchestrator.test.mjs
```

Ручная проверка парсинга: `node --input-type=module -e "import('./dist/bot/commands.js').then(m => console.log(m.parseAnalyzeCommand('vb:agent-123 проверь wall-убийства', 'analyze')))"` — ожидается `{sessionId:'agent-123', comment:'проверь wall-убийства'}`.

## Риски

- **deepEqual-тесты** на parseAnalyzeCommand: ключ comment добавлять только при наличии (опыт VL-80 — иначе падают старые проверки).
- **{{comment}} без подстановки**: если забыть extraVars в startAnalyze, агент увидит literal `{{comment}}`; поэтому подставлять всегда (`comment ?? ''`) и шаблон с фолбэком «если пусто — проигнорируй».
- **Хвост после session-ref**: `vb:agent-123` — session-ref без пробелов, разбор «первый токен = ref, остальное = comment» однозначен; UUID-сессии qwen по-прежнему отклоняются.
- **Синхронность справки**: bot /help собирается из BOT_COMMANDS (lesson-8) — править registry.ts и registry.test.mjs одной итерацией (lesson-9).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-15 14:12
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Добавить необязательный комментарий к команде analyze» (снят ведущий тег #bot, суммаризирован). Масштаб: task. Уточнено: цель — необязательный параметр comment у команды analyze с семантикой как у команд фаз (backlog_finish_phase): при выполнении можно передать текст комментария, без него команда работает как раньше; добавлено 3 проверяемых AC. Labels: bot (выбран из списка + тег пользователя #bot). References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-15 14:19
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: 8 файлов (commands.ts, orchestrator.ts, phase-analyze.md, handlers.ts, cli/commands/agent.ts, cli/router.ts, registry.ts + 3 тест-файла). Суть: необязательный comment у /analyze (и CLI vibelog agent analyze) по паттерну VL-80 (parsePlanCommand) — хвост после session-ref → {{comment}} в шаблоне phase-analyze.md, всегда подставляется (пустая строка без комментария). Учтены lesson-8/9: registry.ts и registry.test.mjs правятся в одной итерации. Риски: deepEqual-тесты (ключ comment только при наличии), literal {{comment}} при забытой подстановке extraVars, синхронность строки /help.
---
author: @agent
created: 2026-10-15 14:33
---
Фаза 3 (Code) выполнена. Коммит 6c304c3 (ветка vb/vl-169). Изменено 11 файлов: src/bot/commands.ts (AnalyzeCommand.comment + parseAnalyzeCommand: хвост после session-ref → необязательный comment, ключ только при непустом хвосте — deepEqual-контракт VL-80), src/web/orchestrator.ts (startAnalyze: 5-й параметр comment → comment ?? '' в extraVars, без literal {{comment}}), templates/qwen-commands/phase-analyze.md (строка «Дополнительный комментарий…» + фолбэк «пусто — проигнорируй»), src/bot/handlers.ts и src/cli/commands/agent.ts (передача comment в startAnalyze; CLI: vibelog agent analyze <session-ref> [комментарий]), src/cli/router.ts и src/bot/registry.ts (справка, lesson-8). Тесты (lesson-9, той же итерацией): commands.test.mjs (4 новых deepEqual-кейса VL-169), registry.test.mjs (usage + строка /help), orchestrator.test.mjs (comment в промпте есть/пустой без него), phase-prompt.test.mjs (renderPrompt с comment; исправлен падавший VL-141-кейс — в extraVars добавлена подстановка comment). Проверки: pnpm build — ок; полный прогон pnpm test:fast — 66 файлов, 1138 passed, 4 skipped, 0 failed; ручная проверка парсинга — {sessionId:'agent-123',comment:'проверь wall-убийства'} и без хвоста без ключа comment. References не использовались.
---
author: @agent
created: 2026-10-15 16:46
---
Фаза Close прервана: merge vb/vl-169 не выполнен — в главном репозитории уже присутствует незавершённое слияние (MERGE_HEAD=93ac7e5 «docs: VL-163 — документация и CHANGELOG») с неразрешённым конфликтом в CHANGELOG.md (статус UU). git merge vb/vl-169 отклонён с «unmerged files». Конфликтные файлы оставлены как есть для ручного разбора (git merge --abort не выполнялся, чужое слияние не тронуто). Ветка vb/vl-169 содержит 1 коммит 6c304c3, worktree .vibelog/worktrees/vl-169 на месте и чиста (только untracked-симлинки). Разреши конфликт CHANGELOG.md (заверши или abort слияния VL-163) и повтори Фазу Close.
---
author: @agent
created: 2026-10-25 09:24
---
Фаза Close прервана: конфликт слияния vb/vl-169 → master (файлы: src/bot/registry.test.mjs, src/bot/registry.ts, src/cli/commands/agent.ts, src/cli/router.ts — все UU). Слияние оставлено в промежуточном состоянии (MERGE_HEAD), конфликтные файлы не тронуты, git merge --abort не выполнялся. Разреши конфликт вручную и повтори Фазу Close.
---
author: @agent
created: 2026-10-25 09:41
---
Фаза Close выполнена. Ветка vb/vl-169 слита в master (1 коммит 6c304c3; merge-коммит 53a5f66 — конфликты справок с параллельной VL-171 в registry.ts/registry.test.mjs/agent.ts/router.ts разрешены объединением обеих сторон по явному запросу пользователя), worktree .vibelog/worktrees/vl-169 удалена (только untracked-симлинки), ветка удалена. Сборка и тесты зелёные после merge: pnpm build + pnpm test — 65 файлов, 1149 passed, 4 skipped. Lessons: создан lesson-21 (резолв конфликтов справок при merge параллельных веток), связанны lesson-8/9; refs у задачи нет. Документация: docs-коммит 82d74af (CHANGELOG Unreleased, README, doc-10). DoD: 1 — тесты проходят (полный прогон), 2 — документация обновлена (CHANGELOG/README/doc-10), 3 — нет регрессий (сборка+тесты зелёные, help-строки склеены без потери команд VL-171).
---
<!-- COMMENTS:END -->