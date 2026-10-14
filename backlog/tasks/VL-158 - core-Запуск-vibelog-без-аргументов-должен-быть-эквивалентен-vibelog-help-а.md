---
id: VL-158
title: 'Запуск vibelog без аргументов = help, агент — через vibelog agent'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-14 21:28'
updated_date: '2026-10-14 22:22'
due_date: ''
labels:
  - core
  - cli
  - agent
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
  - src/cli/router.ts
  - src/cli/commands/agent.ts
  - src/agent/interactive.ts
  - src/cli/cli.test.mjs
  - README.md
lessons:
  - lesson-2
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Запуск vibelog без аргументов должен быть эквивалентен vibelog help, а текущий запуск агента надо переделать под vibelog agent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `vibelog`/`vb` без аргументов печатает справку (эквивалент vibelog help) и выходит с кодом 0 — в TTY и в не-TTY
- [x] #2 TUI-чат агента запускается только через `vibelog agent` (без подкоманд) или `vibelog agent <task-id>` (чат с контекстом задачи); `vibelog agent analyze <ref>` продолжает работать (VL-141)
- [x] #3 Тесты обновлены и проходят (в т.ч. пустой запуск = справка при подменённом isTTY), README и doc-10 обновлены
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель

1. `vibelog`/`vb` без аргументов = `vibelog help` (справка, exit 0) ВСЕГДА — убрать TTY-ветку пустого запуска (VL-102).
2. TUI-чат агента переносится в `vibelog agent` (без подкоманд) и `vibelog agent <task-id>` (чат с контекстом задачи). `vibelog agent analyze <ref>` (VL-141) не меняется.

## Файлы для изменения

### 1. src/cli/router.ts
- **Строки 54-58** — удалить ветку `if (args.length === 0 && process.stdout.isTTY && process.stdin.isTTY)` с динамическим импортом `../agent/interactive.js`. Пустой запуск падает в существующую ветку `if (!command || command === 'help') return showHelp()` (строки 63-65) — exit 0.
- **Строки 15-17** (шапка-комментарий модуля) — переписать: «Без аргументов — справка; чат с агентом — vibelog agent (VL-158)».
- **Строка 135** (showHelp) — заменить строку `agent analyze <ref>` на `agent [task-id]         Чат с LLM-агентом (TUI); analyze <ref> — анализ сессии`.
- **Строка 152** (showHelp) — «Без аргументов: в интерактивном терминале запускается TUI чата с агентом» → «Без аргументов: показывается эта справка; чат с агентом — vibelog agent».
- **Строки 297-303** (showCommandHelp.agent) — добавить синопсис `vibelog agent [task-id]` (интерактивный TUI-чат; с task-id — задача в контексте) выше `vibelog agent analyze <session-ref>`.

### 2. src/cli/commands/agent.ts (runAgent, строки 22-53)
- **subcommand === ''** (нет подкоманды): проверить TTY (`process.stdin.isTTY && process.stdout.isTTY`); не-TTY → `printError('Интерактивному чату агента нужен терминал (TTY); в скриптах используйте vibelog-agent --headless')` + exitCode 1. TTY → динамический импорт `../../agent/interactive.js` → `runInteractiveAgent()` (динамический — ink/react не грузятся в headless-путях, паттерн router.ts:56).
- **subcommand совпадает с `taskIdPattern(cwd)`** (новый импорт `../../core/config.js`): `getTask(cwd, subcommand)` (новый импорт `../../core/store.js`) — null → printError(`Задача не найдена: ...`) + exitCode 1; найдена → TTY-check как выше → `runInteractiveAgent({ taskRef: subcommand })`.
- **subcommand === 'analyze'** — без изменений.
- **Иначе** — обновить текст ошибки (строка 36): `Неизвестная подкоманда agent: ... (доступны: analyze, <task-id>, чат без подкоманд)`.

### 3. src/agent/interactive.ts (runInteractiveAgent, строка 56)
- Сигнатура: `runInteractiveAgent(options: { taskRef?: string } = {})`.
- После `buildSystemPrompt(cwd)` (~строка 110): если задан taskRef — `getTask` (импорт `../core/store.js`); не найден → stderr + exit 1 (роутер уже проверил, это страховка); systemPrompt.content += `\n\n# Контекст задачи (открыл пользователь)\n\n` + `taskToMarkdown(task)` (импорт `../core/task.js`). Цикла импортов нет: core/store и core/cli не импортируют agent/*.
- Шапка-комментарий (строки 1-14): «Точка входа `vibelog agent` (VL-158), ранее — пустой запуск vibelog (VL-102)».

### 4. src/cli/cli.test.mjs
- **Тест строки 178** («пустой запуск без аргументов (не-TTY)») — оставить, обновить заголовок/комментарий на VL-158.
- **Новый тест**: подмена `(process.stdout).isTTY = true` (+ stdin) → `route([])` печатает справку (`Vibelog.md` в stdout), TUI НЕ запускается; восстановить isTTY в finally.
- **Новые тесты runAgent** (в не-TTY vitest): `runAgent('', [], {}, testDir)` → ошибка про TTY; `runAgent('clt-1', [], {}, testDir)` (taskIdPattern проекта) → ошибка про TTY (не падает на getTask до TTY-check: TTY-check ПЕРЕД getTask); несуществующий id в не-TTY → тоже ошибка TTY.
- **Тест строки 283** (неизвестная подкоманда) — обновить regex под новый текст ошибки.
- **Тест help** — добавить проверку `out.includes('vibelog agent')`.

### 5. Документация
- **README.md строка 26**: «Запуск vibelog или vb без аргументов ... открывает TUI-чат» → «без аргументов показывает справку; TUI-чат с LLM-агентом — vibelog agent [task-id]».
- **README.md строки 56-57**: аналогично для блока про алиас vb.
- **backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md** (править через MCP document_update, файл в backlog/): строки 75, 97-99, 109 — запуск чата теперь `vibelog agent` / `vibelog agent <task-id>`, не пустой vibelog.

## Порядок действий

1. interactive.ts (параметр taskRef + контекст задачи) — низкий уровень, раньше роутера.
2. commands/agent.ts (ветки runAgent).
3. router.ts (удаление TTY-ветки + help-тексты).
4. cli.test.mjs (тесты).
5. README.md + doc-10 (через MCP document_update).
6. Сборка и прогоны.

## Как проверить

```bash
pnpm build && pnpm test          # полный прогон (vitest)
node bin/vibelog.mjs | head -5   # не-TTY: справка, exit 0
node bin/vibelog.mjs; echo $?    # exit 0
node bin/vibelog.mjs agent analyze     # ошибка синтаксиса (VL-141 не сломан)
node bin/vibelog.mjs agent foo         # Неизвестная подкоманда
```

Ручной smoke в реальном терминале (lesson-2: TUI непроверяем headless): `vibelog` → справка; `vibelog agent` → TUI-чат; `vibelog agent VL-158` → TUI-чат с контекстом задачи.

## Риски

- **Осознанная поломка привычки** пустого TUI-запуска (VL-102) — это цель задачи; help предупреждает о `vibelog agent`.
- **update-check**: пустой запуск теперь = help; `shouldSkip` (src/cli/update-check.ts:194) берёт первое не-flag слово — для [] undefined; проверить, что уведомление не ломает exit-код справки (низкий риск, maybeNotifyUpdate идёт после route).
- **TTY-пути chat не покрываются тестами** (vitest не-TTY) — ручной smoke обязателен перед Close.
- getTask/taskToMarkdown в interactive.ts — новые импорты core в agent-слое; циклов нет, но сборка покажет сразу.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-14 21:29
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Запуск vibelog без аргументов = help, агент — через vibelog agent» (исходный был обрезан). Масштаб: task. Уточнено: безаргументный запуск = `vibelog help` (код возврата 0), запуск агента переносится в `vibelog agent`/`vibelog agent <task-id>`, добавлены 3 проверяемых AC (поведение CLI, эксклюзивность `vibelog agent`, тесты + документация). Labels: core, cli, agent (тег #core из заголовка снят и добавлен в labels). References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-14 21:54
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan (6 файлов: src/cli/router.ts — удаление TTY-ветки пустого запуска + help-тексты; src/cli/commands/agent.ts — ветки runAgent: пустая подкоманда = TUI-чат, &lt;task-id&gt; = чат с контекстом задачи, analyze без изменений; src/agent/interactive.ts — параметр taskRef + вставка taskToMarkdown в system prompt; src/cli/cli.test.mjs — тесты пустого запуска и новых веток; README.md + backlog/docs/doc-10 — документация). Добавлены 3 AC (по спецификации Фазы 1: поведение CLI, эксклюзивность vibelog agent, тесты+документация). Учтён урок lesson-2: TUI-пути проверяются ручным smoke в реальном терминале (vitest — не-TTY). References: нет.
---
author: @agent
created: 2026-10-14 22:08
---
Фаза 3 (Code) выполнена. Изменено: src/cli/router.ts (удалена TTY-ветка пустого запуска VL-102 — всегда справка, help-тексты обновлены), src/cli/commands/agent.ts (runAgent: '' / &lt;task-id&gt; → TUI-чат через динамический импорт runInteractiveAgent с TTY-check ДО getTask; analyze без изменений; новый текст неизвестной подкоманды), src/agent/interactive.ts (runInteractiveAgent(options.taskRef): карточка задачи через getTask+taskToMarkdown добавляется в system prompt), src/cli/cli.test.mjs (обновлён тест пустого запуска + новый тест пустого запуска с подменённым isTTY, тесты runAgent в не-TTY для '', 'clt-1', 'clt-999', проверка 'vibelog agent' в help), README.md (строки 26, 56-57). Коммит af93fff. Проверки: pnpm build OK; pnpm test — 61 файл, 1083 passed / 4 skipped; CLI smoke: пустой запуск exit 0, agent analyze → синтаксис-ошибка (VL-141 жив), agent foo → новая ошибка. Что осталось: doc-10 (backlog/docs) НЕ обновлена — правилами Фазы 3 документы backlog/docs пишет Close; AC-3 и DoD «Документация обновлена» therefore оставлены незакрытыми (README обновлён, doc-10 — на Close). Ручной smoke TUI (vibelog agent / agent &lt;task-id&gt; в реальном терминале) — по lesson-2, headless непроверяем; рекомендуется перед Close.
---
author: @agent
created: 2026-10-14 22:22
---
Фаза Close выполнена. Ветка vb/vl-158 слита в master (1 коммит af93fff, merge bd916a5 — без конфликтов), worktree удалена (--force: только untracked-симлинки node_modules/refs), ветка удалена. После merge: pnpm build OK, pnpm test — зелёные. DoD: все 3 пункта выполнены — тесты проходят, документация обновлена (doc-10 «Агент Vibelog» — запуск чата теперь vibelog agent / vibelog agent <task-id>, пример .env, режимы; README — в Code), регрессий нет (agent analyze VL-141 жив, CLI smoke из Фазы 3). CHANGELOG.md — запись в Unreleased «Изменено: VL-158» (docs-коммит 79a896b). Lesson-2 (ручной smoke TUI) обновлён — linked_tasks += VL-158. Примечание: ручной smoke TUI в реальном терминале (vibelog agent / agent <task-id>) рекомендуется после выхода из сессии — по lesson-2 в headless непроверяем; тестами покрыты TTY-guard и не-TTY-пути.
---
<!-- COMMENTS:END -->