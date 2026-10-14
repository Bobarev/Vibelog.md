---
id: VL-144
title: '#workflow Нужен механизм отказа от задачи'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-13 14:35'
updated_date: '2026-10-14 22:59'
due_date: ''
labels: []
dependencies: []
milestone: v1.8
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/store.ts
  - src/core/config.ts
  - src/web/phase-prompt.ts
  - src/web/orchestrator.ts
  - src/web/api.ts
  - src/web/assets.ts
  - src/cli/commands/task.ts
  - src/cli/router.ts
  - src/bot/rich.ts
  - src/bot/handlers.ts
  - templates/qwen-commands/reject.md
  - src/core/reject.test.mjs
  - src/web/reject-task.test.mjs
  - src/cli/cli.test.mjs
  - src/cli/config-cli.test.mjs
  - src/bot/rich.test.mjs
  - src/web/phase-prompt.test.mjs
  - src/web/static.test.mjs
  - README.md
  - CHANGELOG.md
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#workflow Нужен механизм отказа от задачи. Если задача находится в To Do, то помимо кнопки Spec должна быть ещё одна Reject по её нажатию задача получает статус Rejected и должна уйти в папку completed. Можно ещё дополнительно команду сделать reject VL-N <опциональный комментарий> - которая будет закрывать задачи в других статусах. Рассмотреть вопрос о том нужно ли здесь вообще LLM модель использовать? Если задача не была в статусе Code, то и откатывать ничего не надо.

## Уточнение (Фаза 1 Spec)

Открытый вопрос про LLM решён: если задача НИКОГДА не была в статусе Code, reject — чисто механическая операция (статус Rejected + перенос файла в backlog/completed/), без LLM. Если задача хотя бы один раз начинала выполняться в статусе Code — для reject используется отдельный промпт (LLM), который выполняет отказ с учётом начатых изменений.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Веб-кнопка Reject для задач в To Do: по нажатию статус Rejected + перенос файла в backlog/completed/
- [x] #2 CLI-команда vibelog task reject <id> [комментарий] для задач в любых статусах (опциональный комментарий добавляется в задачу)
- [x] #3 Разделение механики и LLM: задача никогда не бывшая в Code — reject без LLM; бывшая хотя бы раз в Code — отдельный промпт (фаза reject) с откатом начатых изменений, статус Rejected + архив после завершения фазы
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План реализации VL-144 — механизм отказа от задачи (Rejected)

Тип: task. Статус Rejected + перенос файла в backlog/completed/; LLM-откат — только для задач, хотя бы раз бывших в Code (детектор wasInCode).

## Архитектура (ключевые решения)

1. **Механика и LLM разделены**: `rejectTaskFile` (core, чистая механика: статус Rejected + опциональный комментарий + архив) и `rejectTask` (оркестратор, решает путь): если `wasInCode(task) === false` — только механика; иначе — запуск новой фазы `reject` (LLM-откат начатых изменений), а механика (статус+архив) выполняется в onExit завершения фазы.
2. **Детектор `wasInCode(task)`**: true, если есть комментарий с префиксом «Фаза 3 (Code)» (отчёт завершённой Code-фазы), ИЛИ статус ∈ {In Progress, Review} (код шёл/после Code), ИЛИ непустые `implementationNotes`/`finalSummary` (заполняются фазой Code). Ложноположительный срабатывает в безопасную сторону → лишний LLM-запуск; ложноотрицательный недопустим (пропуск отката) — потому набор признаков широкий.
3. **Кнопка Reject — в двух интерфейсах**: (а) Telegram-бот, rich-карточка — там реально есть кнопка «Spec» (next-кнопка, VL-72); (б) web-доска (assets.ts) — по AC из Spec («веб-кнопка Reject для To Do»). Обе — только для статуса «To Do», обе зовут `rejectTask`.
4. **CLI** `vibelog task reject <id> [комментарий]` — для задач в любых статусах; LLM-путь поддержан через `startPhase('reject')` с onExit (child держит event loop процесса CLI, принудительного process.exit после подкоманд нет — router.ts:109 только для неизвестной команды).

## Файлы для изменения (порядок работ)

### 1. `src/core/store.ts` (около строк 178–215, рядом с completeTaskFile)
- Новый экспорт `wasInCode(task: Task): boolean` — детектор по критериям выше (comments[].text по /^Фаза 3 \(Code\)/m, status, implementationNotes, finalSummary).
- Новый экспорт `rejectTaskFile(cwd: string, id: string, comment?: string): Task` — по образцу `completeTaskFile` (строки 206–214): если comment → `addComment(cwd, id, comment)`; затем `updateTaskFile(cwd, id, { status: 'Rejected' })` → `archiveTaskFile(cwd, id)`.

### 2. `src/web/phase-prompt.ts` (строки 19–31)
- `PHASES` += `'reject'`; `PHASE_FILES.reject = 'reject.md'`. Обновить JSDoc у PHASES/renderPrompt.

### 3. `templates/qwen-commands/reject.md` (новый файл)
Шаблон по образцу `phase-comment.md`: заголовок «Фаза Reject: отказ от задачи с учётом начатых изменений», подстановки `{{taskId}}`, `{{taskStatus}}`, `{{taskDescription}}`, `{{taskModifiedFiles}}`, `{{taskLastComment}}`, `{{comment}}` (причина отказа от пользователя, фолбэк — если пусто, не выдумывать). Шаги:
1. Блок задачи подставлен — backlog_view_task не нужен.
2. `git status`/`git diff` в текущем каталоге — определить начатые изменения задачи.
3. Откатить НЕЗАКОММИЧЕННЫЕ изменения, принадлежащие задаче: только поимённо из git status/diff (`git restore <file>` по одному файлу); запрещены reset/checkout широкого охвата, commit/push; backlog/ и чужие файлы не трогать. Невозможные к откату файлы — перечислить.
4. Оставить итог: `backlog_add_comment {"id":"{{taskId}}","author":"@agent","comment":"Фаза Reject выполнена: откачано <файлы>; не откачано: <если есть>; причина: {{comment}}"}`.
5. Статус НЕ менять и файл задачи НЕ архивировать — это делает механика после фазы.

### 4. `src/web/orchestrator.ts` (после startPhase, ~строка 155)
- Новый экспорт `rejectTask(cwd, id, comment?, opts?: { onExit?: PhaseExitCallback; agent? }): { rejected: true; task: Task } | StartResult`:
  - задача не найдена → `{ error }`;
  - `!wasInCode(task)` → `rejectTaskFile(cwd, id, comment)` → `{ rejected: true, task }`;
  - иначе → `startPhase(cwd, id, 'reject', (run) => { rejectTaskFile(cwd, id, comment); opts?.onExit?.(run); }, { comment: comment ?? '' }, agent)` → StartResult (запуск; статус+архив — в onExit).
- Фаза `reject` идёт по общим правилам worktree (spawnQwenRun): при существующем worktree откат идёт в worktree задачи; флагов MCP — как у comment (без `--allowed-mcp-server-names`; для отката+MCP-комментария нужен vibelog MCP → добавить `'reject'` в условие phaseFlags на строке ~394: `phase === 'spec' || phase === 'plan' || phase === 'reject'`).

### 5. `src/cli/commands/task.ts` (switch — строки 43–57; help в router)
- `case 'reject':` → новая функция `taskReject(positional, cwd)` (рядом с `taskComplete`, строка ~511):
  - `id = positional[0]`, `comment = positional.slice(1).join(' ')` (пусто — без комментария);
  - `rejectTask(cwd, id, comment, { onExit: (run) => printSuccess(...) , agent })`: механика → сразу printSuccess «Задача <id> отклонена (Rejected) и архивирована»; LLM → printInfo «Запуск отката через LLM, PID …; после завершения задача будет переведена в Rejected и архивирована».
- Импорт `rejectTask` из `../web/orchestrator.js` (параллельно существующим импортам из `../core/...`).

### 6. `src/cli/router.ts` (help-блок task, строки ~179–186)
- Добавить строку: `reject <id> [комментарий]  — отклонить задачу (Rejected + completed/; если задача была в Code — предварительный откат через LLM)`.

### 7. `src/web/api.ts` (после trigger-блока, строки 60–76)
- `POST /api/tasks/:id/reject` (матч до generic PATCH): body `{ comment?, agent? }` → `rejectTask(...)`; ответ: 200 `{ rejected: true }` (механика) | 202 `{ started, pid }` (LLM-путь) | 404 задача | 409 занят/ошибка. onExit не нужен — механика уже внутри rejectTask (LLM: архив в onExit, передать onExit, делающий nothing, либо omit).

### 8. `src/web/assets.ts`
- CSS: класс `.btn-reject` (красный) рядом с `.btn` (~строки 40–44).
- `createCard` (~строки 163–184): если `task.status === 'To Do'` — в карточку добавить кнопку `<button class="btn btn-reject">✖ Reject</button>`; обработчик: `e.stopPropagation()` (карточка кликом открывает модалку), `confirm('Отклонить <id>?')` → `fetch('/api/tasks/'+id+'/reject', {method:'POST'})` → `loadData()`.

### 9. `src/bot/rich.ts` (строки 333–343, кнопки карточки)
- После формирования next-кнопки: если `task.status === 'To Do'` — `buttons.push('<tg-button type="callback_data" style="danger" data="reject:${task.id}">✖ Reject</tg-button>')` (перед «💬 Комментарий»). Стиль `danger` проверить по `rich.d.ts` (использованы primary/success — если danger не поддержан, взять default).

### 10. `src/bot/handlers.ts` (bot.on('callback_query'), ветки до next: ~строка 1037)
- Новая ветка `data.startsWith('reject:')` (паттерн ветки `comment:`, строки 967–992): requireBind → getTask → answerCallbackQuery → `rejectTask(deps.cwd, id, '', { onExit, agent: resolveDefaultAgent(deps.cwd) })` → механика: sendMd «<id> отклонён (Rejected) и архивирован»; LLM: sendMd «Фаза Reject запущена, PID …», onExit → sendMd итог (паттерн notifyPhaseDone, но без карточки фазы).

### 11. Конфиг статусов
- `src/core/config.ts:32` — DEFAULT statuses += `'Rejected'` (в конец списка).
- `backlog/config.yml` — statuses += `Rejected`: `vibelog config set statuses "Backlog,To Do,Spec,Planned,In Progress,Review,Done,Blocked,Rejected"` (CLI config set, router.ts:242 — массивы через запятую); фолбэк — точечная правка YAML. Зачем: колонка/фильтр/board и select в web-модалке; отклонённая задача сразу архивируется, поэтому доска не «засоряется».

### 12. Тесты (Vitest, `*.test.mjs` → импорт dist)
- Новый `src/core/reject.test.mjs`: `rejectTaskFile` — статус Rejected, файл в completed/, комментарий добавлен, ошибка на несуществующей задаче; `wasInCode` — 4 кейса (отчёт «Фаза 3 (Code)» → true; статус In Progress → true; непустые finalSummary → true; To Do без признаков → false).
- `src/cli/cli.test.mjs`: в tmp-проекте `task reject <id> «причина»` → файл ушёл в completed/, статус Rejected, комментарий в файле; help содержит `reject <id>`.
- `src/bot/rich.test.mjs`: `renderTaskRich` для To Do содержит `data="reject:VL-N"`; для Spec/In Progress — не содержит.
- `src/web/phase-prompt.test.mjs`: `renderPrompt('reject', 'VL-1', { comment: 'x' })` не бросает, содержит текст задачи и «x».
- `src/web/static.test.mjs`: в assets присутствуют `btn-reject` и `/reject`-fetch.
- `src/web/orchestrator.test.mjs` (или новый `src/web/reject-task.test.mjs`): `rejectTask` с never-in-Code задачей — синхронный механический путь (без спавна).

### 13. Документация
- README: подраздел CLI `task`-команд (reject), строка про web-кнопку Reject и кнопку бота, краткое правило «Code → LLM-откат, иначе механика».
- CHANGELOG: запись VL-144 (в фазе Code).

## Порядок действий
1. core (store.ts: wasInCode, rejectTaskFile) + тест reject.test.mjs.
2. phase-prompt.ts (PHASES/PHASE_FILES) + шаблон reject.md + тест phase-prompt.
3. orchestrator.ts (rejectTask, phaseFlags) + тест rejectTask.
4. CLI task.ts + router.ts help + cli.test.
5. web api.ts + assets.ts (кнопка/CSS) + static.test.
6. бот rich.ts + handlers.ts + rich.test.
7. конфиги (config.ts + backlog/config.yml через `vibelog config set`).
8. README + CHANGELOG.
9. Проверки.

## Как проверить
- `pnpm build` — сборка strict TS.
- `pnpm test` — vitest (build + все *.test.mjs).
- Smoke CLI: во временной копии backlog — `node bin/vibelog.mjs task create "X" && node bin/vibelog.mjs task reject VL-N "причина" && ls backlog/completed/` — файл переехал, статус Rejected.
- Веб: `node bin/vibelog.mjs browser` → chrome-devtools MCP: карточка To Do содержит ✖ Reject → клик (confirm) → POST /api/tasks/:id/reject 200 → доска обновилась, файл в backlog/completed/.
- Бот: карточка /task для To Do содержит кнопку Reject (визуально/тест rich.test.mjs).

## Риски
1. **onExit при падении LLM-фазы**: если колбэк не вызовется при ошибке спавна, задача не архивируется. Mitigation: onExit вызывается в close-обработчике spawnQwenRun (паттерн VL-58) — покрыть тестом/ручной проверкой; иначе ветка «фаза не запустилась» возвращается синхронно как `{ error }` и rejectTask не остаётся «висеть».
2. **Откат в главном репо**: если у бывшей в Code задачи нет worktree (ветки до VL-107), runCwd = главный каталог — шаблон запрещает широкий restore и чужие файлы; приемлемо, но подчеркнуто в промпте.
3. **wasInCode ложноположительный** (notes/finalSummary от чужих операций) → лишний LLM-запуск; безопасная сторона, экономичность — вторична.
4. **`style="danger"` в tg-button** — проверить rich.d.ts (fallback: без style-атрибута).
5. **Статус Rejected отсутствует в config.yml старых проектов** — задача и так архивируется; колонка просто не отобразится; добавление — через `config set`.
6. **CLI и event loop**: LLM-путь в `task reject` держит процесс до onExit (child stdio pipe) — проверить, что после подкоманды нет раннего process.exit.
7. **Guard параллельных запусков**: reject задачи с активной фазой → `{ error: 'Запускается уже выполняется' }` → показать пользователю, ничего не архивировать.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-13 14:40
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Масштаб: не определён (описание неполное).
Основная постановка ясна: кнопка Reject в вебе для задач в To Do (помимо Spec), команда `reject VL-N [комментарий]` в CLI для задач в других статусах, статус Rejected, перенос файла задачи в папку completed/. Однако в описании открыто стоит нерешённый вопрос про использование LLM и откат для задач в статусе Code — поведение в этом случае не определено, а оно влияет на объём задачи. Жду ответов на вопросы:
### 1. Как поступать при отклонении задачи в статусе Code — нужен ли откат изменений и LLM?
- [ ] Просто закрыть без отката — reject всегда механический, LLM не используется (в т.ч. для Code)
- [ ] Откатывать изменения задачи (по modified_files) без LLM
- [ ] Запускать фазу close с LLM, как при обычном завершении задачи
- [ ] Другое → 
### Дополнительные комментарии
→ 
---
author: @agent
created: 2026-10-13 15:50
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Масштаб: task. Уточнено: открытый вопрос про LLM решён по ответу пользователя — reject задач, которые НИКОГДА не были в статусе Code, чисто механический (статус Rejected + перенос в backlog/completed/, без LLM); reject задач, хотя бы раз бывших в Code, выполняется через отдельный промпт (LLM) с учётом начатых изменений. Описание дополнено, тип — task, добавлены 3 критерия приёмки (веб-кнопка Reject для To Do, CLI-команда reject VL-N [комментарий] для любых статусов, разделение механики и LLM-промпта по факту нахождения в Code). Вопросов нет.
---
author: @agent
created: 2026-10-13 19:27
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: 13 разделов, ~12 файлов для изменения (core/store.ts — wasInCode + rejectTaskFile; web/orchestrator.ts — rejectTask; web/phase-prompt.ts + новый шаблон templates/qwen-commands/reject.md; cli/commands/task.ts + cli/router.ts — команда reject; web/api.ts + web/assets.ts — POST /api/tasks/:id/reject и веб-кнопка Reject для To Do; бот rich.ts + handlers.ts — кнопка reject:<id> в rich-карточке рядом с кнопкой Spec; core/config.ts + backlog/config.yml — статус Rejected; тесты *.test.mjs; README/CHANGELOG). Ключевые решения: механика (Rejected + архив) отделена от LLM-пути; детектор wasInCode (отчёт «Фаза 3 (Code)» / статус In Progress,Review / notes/finalSummary) выбирает путь: никогда не была в Code → только механика, иначе фаза reject (LLM-откат начатых изменений в worktree) + механика в onExit. Добавлены 3 AC (веб-кнопка, CLI-команда, разделение механики/LLM). Риски: onExit при падении LLM-фазы (архив не произойдёт — покрыть проверкой), откат в главном репо при отсутствии worktree (шаблон ограничивает restore поимённо), ложноположительный wasInCode → лишний LLM-запуск (безопасная сторона), поддержка style=danger в rich.d.ts, event loop CLI при LLM-пути.
---
author: Pavel Bobarev
created: 2026-10-13 21:59
---
Сессия агента упала, продолжи реализацию фазы Code
---
author: @agent
created: 2026-10-13 22:17
---
Фаза 3 (Code) выполнена. Коммит fb0c9e4 (ветка vb/vl-144, worktree). Реализовано по плану: core (wasInCode-детектор + rejectTaskFile в store.ts), оркестратор rejectTask (механика синхронно / LLM-фаза reject через startPhase с onExit для бывших в Code), PHASES+='reject' + шаблон templates/qwen-commands/reject.md (поимённый git restore, без commit/push), CLI vibelog task reject <id> [комментарий] + help в router, POST /api/tasks/:id/reject (200/202/404/409), web-кнопка ✖ Reject (только To Do, .btn-reject), кнопка Reject в Telegram-карточке (style danger, обработчик reject:<id> в handlers.ts), DEFAULT statuses += Rejected (config.ts). Проверки: pnpm build (strict tsc) — ок; pnpm test — 54 файла/917 тестов проходят, включая новые reject.test.mjs, reject-task.test.mjs и расширения cli/rich/phase-prompt/static тестов; в процессе фазы исправлен упавший тест «task reject без ID» (printError пишет в console.error, а в vitest mockRestore очищает mock.calls — чтение вынесено до restore). Документация: README (CLI reject, web-кнопка, кнопка бота, правило Code→LLM-откат). Что осталось (вне кода): (1) backlog/config.yml проекта — статус Rejected не добавлен: backlog/ правится только через MCP, а инструмента конфига в MCP нет; владелецу — vibelog config set statuses "...,Rejected" в главном репо (по риску №5 плана задача и так архивируется, колонка просто не отобразится); (2) CHANGELOG не обновлял по правилам фазы (пишет Фаза Close, VL-126); (3) ручная веб-проверка через chrome-devtools MCP в этой сессии недоступна — покрыто статическим тестом assets; (4) LLM-путь reject (спавн фазы) проверен типами/контрактами и кодом onExit-обёрткой по паттерну VL-58, живой запуск qwen — при ревью.
---
author: @agent
created: 2026-10-13 22:39
---
Фаза Close прервана: конфликт слияния vb/vl-144 → master (файлы: README.md, src/bot/handlers.ts, src/cli/cli.test.mjs, src/web/orchestrator.ts, src/web/phase-prompt.ts). Merge оставлен в промежуточном состоянии (MERGE_HEAD), конфликты НЕ резолвлены и НЕ откатывались — разреши конфликт вручную и повтори Фазу Close.
---
author: @agent
created: 2026-10-13 22:50
---
Фаза Close выполнена. Ветка vb/vl-144 слита в master (1 коммит fb0c9e4), worktree удалена, ветка удалена. Слияние потребовало ручного разрешения конфликтов с параллельной веткой VL-141 (analyze): PHASES/PHASE_FILES/phaseFlags — объединены обе фазы (analyze + reject), импорты orchestrator в handlers.ts — объединены, cli.test.mjs — объединён импорт fs (writeFileSync/chmodSync + readdirSync), README — объединено описание команд бота (analyze + кнопка Reject). После разрешения: pnpm build (strict tsc) ок, pnpm test — 55 файлов / 949 тестов зелёные. DoD отмечены полностью (3/3): тесты проходят, документация обновлена (README из ветки + CHANGELOG-запись VL-144, коммит c2fd305), регрессий нет (весь существующий набор тестов, включая VL-141, проходит). Изменённые файлы: src/core/store.ts, src/core/config.ts, src/web/phase-prompt.ts, src/web/orchestrator.ts, src/web/api.ts, src/web/assets.ts, src/cli/commands/task.ts, src/cli/router.ts, src/bot/rich.ts, src/bot/handlers.ts, templates/qwen-commands/reject.md + 7 тестовых файлов + README.md + CHANGELOG.md.
---
<!-- COMMENTS:END -->