---
id: VL-171
title: Исправить vibelog agent --resume и добавить команду бота resume
status: Done
assignee: []
reporter: ''
created_date: '2026-10-15 14:12'
updated_date: '2026-10-25 09:12'
due_date: ''
labels:
  - agent
  - cli
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
  - src/agent/interactive.ts
  - src/cli/commands/agent.ts
  - src/cli/router.ts
  - src/bot/commands.ts
  - src/bot/handlers.ts
  - src/bot/registry.ts
  - src/bot/registry.test.mjs
  - src/bot/commands.test.mjs
  - src/agent/interactive.test.mjs
  - src/cli/cli.test.mjs
  - README.md
lessons:
  - lesson-18
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Не работает `vibelog agent --resume vb:agent-1792057147372`: вместо продолжения существующей сессии агент стартует новую TUI-сессию.

Дополнительно: добавить команду бота `resume vb:session_id <необязательный комментарий>` для возобновления сессии из бота.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Диагноз (корень бага)

Команда vibelog agent --resume vb:agent-XXX роутится так: parseArgs (src/cli/args.ts:65-90) кладёт значение флага в flags.resume, subcommand пустой. Далее runAgent (src/cli/commands/agent.ts:37-51) уходит в ветку TUI-чата и игнорирует флаги (параметр _flags не используется). runInteractiveAgent (src/agent/interactive.ts:63-91) всегда делает createSessionId с пустой историей. Headless-путь vibelog-agent (src/agent/cli.ts:324-334) поддерживает --resume штатно — баг только в интерактивном vibelog agent.

## Изменения

### Часть 1 — CLI vibelog agent --resume
1. src/agent/interactive.ts: новый экспорт loadResumeHistory(sessionsDir, resumeRef) — Promise с sessionId и history: срезает префикс vb:, вызывает loadSession, фильтрует system из истории; кидает понятную ошибку «Сессия не найдена». В runInteractiveAgent добавить resume в options; вместо createSessionId (строка 91) — sessionId из loadResumeHistory, history — загруженная. Ошибка загрузки — stderr и exit 1 до рендера TUI.
2. src/cli/commands/agent.ts (ветка чата, строки 37-51): читать flags.resume через getFlag; boolean вместо строки (--resume без значения) — ошибка; передать taskRef и resume в runInteractiveAgent. Обновить JSDoc.
3. src/cli/router.ts (help-текст agent, строки 289-300): добавить строку vibelog agent --resume session-ref — TUI-чат продолжает сохранённую сессию.

### Часть 2 — команда бота /resume
4. src/bot/commands.ts (после parseAnalyzeCommand, около строки 490): parseResumeCommand(text, commandWord) — первый токен session-ref в формате extractSessionRef (строка 517+): vb:agent-N и agent-N дают agent vb, qwen:UUID и UUID дают agent qwen; остаток — необязательный комментарий; суффикс :agent как у /prompt; возвращает sessionId, agent, comment либо error с подсказкой.
5. src/bot/handlers.ts: bot.command с массивом resume, resume:qwen, resume:vb — ПОСЛЕ хендлера /analyze (около строки 982) и ДО catch-all пина (около строки 1396, ловушка порядка grammy VL-37): requireBind, parseResumeCommand, startResume(cwd, sessionId, comment или «Продолжи», onExit — sendPhaseResult, agent), затем сообщение «Сессия возобновлена, PID». Фолбэк-hears (строка 984): добавить resume в regex.
6. src/bot/registry.ts (BOT_COMMANDS, после analyze, около строки 49): запись resume с usage /resume session-ref [комментарий] и примерами — help и меню собираются из реестра (lesson-8).

### Тесты (lesson-9: в той же итерации)
7. src/bot/registry.test.mjs: длина реестра 21 до 22 (строка 17), presence и usage команды resume.
8. src/bot/commands.test.mjs: describe parseResumeCommand (после строки 350): vb и голый agent-N; qwen-UUID; комментарий сохраняется; пусто — error; битый ref — error; суффикс :vb.
9. src/agent/interactive.test.mjs: describe loadResumeHistory (tmp-каталог с jsonl): возобновление и фильтр system; срез vb:; «не найдена» — throw.
10. src/cli/cli.test.mjs: негатив runAgent с resume=true — ошибка; чат-ветка в не-TTY по-прежнему падает на TTY-проверке (регрессия VL-158).

### Документация
11. README.md (строка 237): добавить /resume в список команд бота.
12. backlog/docs/doc-6 (руководство пользователя): раздел команд бота — /resume с примером.
13. CHANGELOG — запись VL-171 (в code-итерации по принятой практике).

## Порядок и проверки
1. Правки части 1, затем части 2, затем тесты, затем доки.
2. pnpm build && pnpm test:fast; точечно vitest run для registry, commands, interactive, cli тестов.
3. Ручной smoke в реальном TTY (lesson-2, headless непроверяем): vibelog agent --resume vb:agent-<существующая> — TUI открывается с историей, ход дописывается в тот же jsonl; --resume vb:agent-404 — ошибка до TUI.
4. Smoke бота: /resume vb:agent-XXX — «Сессия возобновлена», ответ уходит в ту же сессию; reply-resume (VL-93) не сломан.

## Риски
- Порядок регистрации grammy: /resume обязан быть до catch-all пина — ставим рядом с /analyze.
- --resume без значения: args.ts даёт boolean true — валидируем в runAgent.
- saveSession в interactive — полная перезапись jsonl: при возобновлении файл перезаписывается историей и новыми ходами — согласовано с паттерном VL-95.
- Guard startResume (VL-145): повторный /resume той же живой сессии отклоняется «Запуск уже выполняется» — ожидаемо.
- Qwen-сессии в /resume: голый UUID уходит в qwen --resume — семантика как у reply-resume (VL-93), отдельной валидации нет.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-15 14:14
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Исправить vibelog agent --resume и добавить команду бота resume» (убран session-id из примера, добавлена вторая часть задачи). Масштаб: task. Уточнено: две части — (1) починить `vibelog agent --resume` (сейчас стартует новую TUI-сессию вместо продолжения), (2) добавить команду бота `resume vb:session_id [комментарий]`; добавлены 3 проверяемых AC. Labels: agent, cli, bot (тег #agent перенесён из заголовка/описания). References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-15 14:39
---
Фаза 2 (Plan) выполнена. Тип: task. Диагноз: vibelog agent --resume уходит в ветку TUI-чата (runAgent, src/cli/commands/agent.ts:37-51) и игнорирует flags (параметр _flags), runInteractiveAgent всегда создаёт новую сессию — headless vibelog-agent --resume работает штатно, баг только в интерактивном пути. План записан: 2 части — (1) починка CLI: loadResumeHistory в interactive.ts + прокидка flags.resume через runAgent + help в router.ts; (2) команда бота /resume: parseResumeCommand (commands.ts), хендлер после /analyze до catch-all пина (handlers.ts), запись в BOT_COMMANDS (registry.ts). Файлов: 6 код + 4 теста + 2 доки. Тесты: registry (21→22), parseResumeCommand, loadResumeHistory, cli-негативы. Риски: порядок регистрации grammy (до catch-all пина), boolean-значение --resume без значения, ожидаемый guard двойного запуска VL-145. Ручной TUI-smoke в код-фазе (lesson-2).
---
author: @agent
created: 2026-10-15 15:58
---
Фаза 3 (Code) выполнена. Изменено 11 файлов, коммит 1c3a6f6 (ветка vb/vl-171).
Часть 1 — CLI vibelog agent --resume (баг-фикс): runAgent теперь читает flags.resume (boolean без значения → явная ошибка до TTY-check; --resume с analyze → явная ошибка), прокидывает resume в runInteractiveAgent; новый экспорт loadResumeHistory в interactive.ts грузит jsonl (срез vb:, фильтр system), ошибка «сессия не найдена» — stderr + exit 1 до рендера TUI; history возобновлённой сессии вливается в диалог, ходы дописываются в тот же файл.
Часть 2 — команда бота /resume: parseResumeCommand в commands.ts (ref формата extractSessionRef: vb:agent-N → vb, qwen-UUID → qwen; суффикс :<agent> перекрывает; комментарий необязателен, дефолт «Продолжи»); хендлер resume/resume:qwen/resume:vb в handlers.ts — после /analyze, до catch-all пина (ловушка порядка grammy VL-37), спавн через startResume (guard VL-145, мета worktree VL-110); запись resume в BOT_COMMANDS (registry.ts) — help/меню из реестра (lesson-8), registry.test.mjs обновлён в той же итерации (lesson-9).
Тесты: registry.test.mjs (21→22, usage/resume + help-строка), commands.test.mjs (+8 parseResumeCommand), interactive.test.mjs (+3 loadResumeHistory), cli.test.mjs (+4 негатива --resume). Полный pnpm test: 1151 passed, 4 skipped, 0 failed — регрессий нет (DoD 1, 3).
Документация: README.md — /resume в списке команд бота + пример vibelog agent --resume. Доки backlog/docs и CHANGELOG по правилам фазы не трогал — допишет Close.
Урок: lesson-18 (трассировка CLI-флагов через слои роутинга), связан с задачей.
Ручной TUI-smoke в реальном терминале не выполнялся (агент работает headless) — рекомендация владельцу: vibelog agent --resume vb:agent-<существующая> в TTY, --resume vb:agent-404 → ошибка; /resume vb:agent-XXX из бота.
---
author: @agent
created: 2026-10-15 16:47
---
Фаза Close прервана: конфликт слияния vb/vl-171 → master. Merge не начался: в главном репо уже висит незавершённый merge (MERGE_HEAD = 93ac7e5 «docs: VL-163 — документация и CHANGELOG») с нерешённым конфликтом CHANGELOG.md (статус UU); git merge отклонён с «you have unmerged files». Конфликтные файлы оставлены как есть (файлы: UU CHANGELOG.md + незакоммиченные изменения web/*, README.md, refs, lessons от предыдущего merge). Разреши конфликт вручную (заверши или abort предыдущего merge) и повтори Фазу Close: worktree .vibelog/worktrees/vl-171 на месте (чистый, кроме untracked-симлинков node_modules/refs), ветка vb/vl-171 содержит 1 коммит 1c3a6f6 для слияния.
---
author: @agent
created: 2026-10-25 09:12
---
Фаза Close выполнена. Ветка vb/vl-171 слита в master (1 коммит 1c3a6f6, merge f799ac4), сборка и тесты после merge прошли (pnpm build && pnpm test — exit 0), worktree удалена (--force: только untracked-симлинки node_modules/refs), ветка удалена. DoD: тесты проходят, документация обновлена (README из ветки, CHANGELOG.md и doc-6 — коммит 661929c), регрессий нет. Lesson-18 создан и связан (коммит c3303ae).
---
<!-- COMMENTS:END -->