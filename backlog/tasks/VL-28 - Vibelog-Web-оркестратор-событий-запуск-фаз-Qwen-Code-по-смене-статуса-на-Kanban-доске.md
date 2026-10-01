---
id: VL-28
title: 'Vibelog Web: оркестратор событий — запуск фаз Qwen Code по смене статуса на Kanban-доске'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 11:36'
updated_date: '2026-10-01 14:45'
due_date: ''
labels: []
dependencies:
  - VL-27
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
Реализовать event-driven оркестратор: перемещение карточки на Kanban-доске запускает фазу работы Qwen Code (аналоги /vibelog:spec, /vibelog:plan, /vibelog:code). 1) Расширить статусы конфига: Backlog, Spec, Planned (код уже читает статусы из конфига). 2) Новый эндпоинт POST /api/tasks/:id/trigger — сервер запускает qwen (child_process.spawn) с промптом из templates/qwen-commands/, в промпт подставляется ID задачи, контекст: vibelog task view + комментарии. 3) Qwen по инструкции промпта выполняет фазу, оставляет отчёт через backlog_add_comment и меняет статус. 4) Сервер подхватывает изменения файла задачи и отображает комментарий на доске. Статус-триггеры: Backlog→Spec (Фаза 1), Spec/Planned→In Progress (Фаза 2), In Progress→Review (Фаза 3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Статусы Backlog, Spec, Planned добавлены в backlog/config.yml; Kanban отображает их отдельными колонками
- [x] #2 POST /api/tasks/:id/trigger приходит с параметром phase (spec|plan|code); сервер запускает qwen через child_process.spawn с промптом из templates/qwen-commands/phase-N.md, подставляя ID задачи
- [x] #3 После завершения qwen сервер читает обновлённый файл задачи: отчёт-комментарий отображается в вебе, статус меняется согласно инструкции промпта (spec→Planned, plan→In Progress, code→Review)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Факты из исследования

- **Headless-запуск qwen**: `qwen -p "<prompt>" --approval-mode yolo` (проверено через `qwen --help`: -p non-interactive, --approval-mode yolo = авто-принятие всех действий). Без yolo в headless TTY нет — согласия невозможны.
- **MCP в spawned-сессии**: qwen запускается с cwd=проекта → читает .qwen/settings.json → vibelog MCP доступен (это подтверждает рабочая связка скиллов spec/plan/code, которыми я пользуюсь).
- **templates/qwen-commands/**: spec.md (28), plan.md (35), code.md (28) — интерактивные ({{args}}, «ЖДИ ПОДТВЕРЖДЕНИЯ»). Для оркестратора НЕ подходят → создаём phase-1/2/3.md (headless).
- **api.ts** (81 строка): handleApi — СИНХРОННЫЙ,通用 regex /^\/api\/tasks\/(.+)$/ (строки 57-75) перехватит «VL-28/trigger» как id — новые роуты ставить ДО общих.
- **server.ts**: url.startsWith('/api/') → handleApi (строки 52-61); spawn не требует await — можно вернуть 202 синхронно.
- **Комментарии**: TaskComment {author, created, text} (task.ts:43), секция COMMENTS:BEGIN/END; listTasks парсит их → /api/tasks уже отдаёт comments[] → веб увидит отчёт после refresh.
- **Конфиг**: config.ts:28 DEFAULT_STATUSES = ['To Do','In Progress','Review','Done','Blocked']; тест config-cli.test.mjs:51 asserting эту строку → дефолт для НОВЫХ проектов НЕ меняем (совместимость с Backlog.md). AC1 — правка backlog/config.yml ЭТОГО проекта.
- **Триггеры** (из description): попадание в Spec → Фаза 1, в In Progress → Фаза 2, в Review → Фаза 3. Завершение фаз: spec→Planned, plan→In Progress (уже там), code→Review (уже там).

## Изменяемые/создаваемые файлы

### 1. backlog/config.yml — статусы (AC1)
statuses → `['Backlog', 'To Do', 'Spec', 'Planned', 'In Progress', 'Review', 'Done', 'Blocked']` (Backlog первым = колонка слева; To Do сохраняем — в нём задачи). config.ts НЕ трогаем.

### 2. templates/qwen-commands/phase-1.md, phase-2.md, phase-3.md (новые, headless)
Структура каждого: без frontmatter-скилла, без «жди подтверждения». Общий каркас:
- «Ты — автоматический исполнитель Vibelog-фазы N для задачи {{taskId}}. Работай через Vibelog MCP без интерактива.»
- Инструкции фазы (по мотивам соответствующего скилла, но с авто-шагами):
  - **phase-1 (spec)**: backlog_view_task → изучить репозиторий (grep/sed, не читать >200 строк целиком) → разбить на 2-3 подзадачи через backlog_create_task (AC, priority, dependencies) → backlog_add_comment с отчётом (список созданных ID) → backlog_update_status на Planned.
  - **phase-2 (plan)**: backlog_view_task → изучить файлы → backlog_update_task {plan} → backlog_add_comment с кратким резюме плана → статус остаётся In Progress (подтверждение — перенос пользователя).
  - **phase-3 (code)**: backlog_view_task (читать plan) → реализовать (bash+edit) → pnpm test → backlog_add_comment с отчётом (что сделано, результаты тестов) → backlog_update_status на Review.
- Правила: Node.js только, без python; НЕ менять статус, кроме указанного финального; отчёт — всегда комментарием.

### 3. src/web/orchestrator.ts (новый)
- `const templatesDir = fileURLToPath(new URL('../../templates/qwen-commands/', import.meta.url))` (паттерн webDistDir из VL-26).
- `renderPrompt(phase, taskId): string` — чтение phase-N.md, замена {{taskId}} (чистая функция — юнит-тест).
- `startPhase(cwd, taskId, phase): {started: true, pid} | {error}`:
  - валидация phase ∈ {spec, plan, code}; проверка задачи (getTask) — 404-логика на уровне api.ts;
  - double-trigger guard: Map<taskId, ChildProcess> — если запущена, вернуть {error: 'уже выполняется'};
  - бинарь: `process.env.VIBELOG_QWEN_BIN || 'qwen'` (тесты подменяют на заглушку);
  - spawn(bin, ['-p', prompt, '--approval-mode', 'yolo'], {cwd, stdio: 'pipe'}) — логи копим (последние ~50 строк в памяти);
  - on('close') → убрать из Map, сохранить exitCode/лог-хвост.
- `getRun(taskId): {running, exitCode?, finishedAt?, logTail?} | null`.
- Запись в файлы оркестратор НЕ делает — всё через MCP-инструменты qwen (файлы меняет он).

### 4. src/web/api.ts — два роута (ДО общего getMatch, строки ~57+)
- `POST /api/tasks/:id/trigger` body {phase}: getTask → 404 если нет; orchestrator.startPhase → 202 {started:true,pid} или 409 {error} (double-trigger/невалидный phase).
- `GET /api/tasks/:id/trigger`: orchestrator.getRun → 200 {running:false} если нет записи, иначе состояние (+exitCode/logTail).
- Импорт orchestrator.js; остальное не трогаем.

### 5. web/src/types/kanban.ts — lastComment
KanbanTask += `lastComment: { author: string; text: string } | null`.

### 6. web/src/components/kanban/api.ts
- toKanbanTask: lastComment = comments.length ? {author: comments.at(-1).author, text: ...} : null.
- `triggerPhase(id, phase): Promise<{started:boolean}>` — POST trigger (409 → throw с текстом).
- `getTriggerStatus(id): Promise<{running:boolean, exitCode?:number}>` — GET trigger.

### 7. web/src/components/kanban/kanban.tsx
- Карта триггеров: `const PHASE_BY_STATUS: Record<string,string> = { Spec: 'spec', 'In Progress': 'plan', 'Review': 'code' }`.
- В handleDragEnd после успешного PATCH: если newStatus в карте → void triggerPhase(task.id, phase); при ошибке console.error (доску не откатываем — статус уже сохранён).
- Поллинг: после успешного trigger — setInterval 3c → getTriggerStatus; running:false → clearInterval + load() (доска подхватывает комментарий/статус из файлов); защита от утечки таймера при размонтировании.
- Индикация запущенной фазы: в состоянии `runningPhases: Set<taskId>` — карточка получает пропс isRunning (маленький спиннер/подпись «фаза выполняется…» в футере карточки).

### 8. web/src/components/kanban/task-card.tsx
- Проп isRunning → индикатор в футере.
- lastComment → одна строка под описанием/в футере: «💬 author: text (обрезка 80 символов, title=полный)» — выполнение AC3 «отчёт-комментарий отображается в вебе».

### 9. README.md + CHANGELOG.md
- README (раздел browser): оркестратор — перенос в Spec/In Progress/Review запускает фазу qwen; требует `qwen` в PATH; VIBELOG_QWEN_BIN для подмены.
- CHANGELOG [Unreleased]: запись VL-28.

### 10. web/dist — `pnpm web:build` (коммитится)

## Тесты (корень, *.test.mjs → dist/)

### src/web/orchestrator.test.mjs (новый)
- renderPrompt: подстановка {{taskId}}, ошибка при отсутствующем шаблоне.
- startPhase с VIBELOG_QWEN_BIN=node и заглушкой (node-скрипт в /tmp, пишет маркер и выходит 0): 202-логика, double-trigger 409, getRun показывает running→после close exitCode:0. Каталог теста — /tmp (память: findBacklogDir).
- Валидация phase: 'deploy' → error.

### src/web/static.test.mjs (дополнить)
- handleApi POST /api/tasks/:id/trigger с битым bin → не 500-краш сервера (error в теле); GET trigger → 200 {running:false}.

## Порядок действий
1. backlog/config.yml (статусы)
2. templates/qwen-commands/phase-{1,2,3}.md
3. src/web/orchestrator.ts + orchestrator.test.mjs
4. api.ts (роуты) + дополнение static.test.mjs
5. pnpm build + pnpm test
6. web: types → api.ts → kanban.tsx → task-card.tsx; pnpm web:build
7. README + CHANGELOG
8. Ручная проверка (см. ниже)

## Верификация
- `pnpm build` (tsc корня), `pnpm test` (включая новые тесты оркестратора), `pnpm web:build`.
- `grep -rn "use client\|next/" web/src/` — пусто.
- Ручная (chrome-devtools MCP): создать тестовую задачу → перетащить в Spec → в network POST trigger 202 → в консоли сервера (лог-хвост GET trigger) qwen запустился → доска показывает индикатор фазы. На машине Pavel qwen настоящий — полный прогон фазы spec на тестовой задаче; проверить комментарий + статус Planned в файле; тестовую задачу удалить.
- Конфиг: `node bin/vibelog.mjs config list` показывает новые статусы.

## Риски
1. **--approval-mode yolo**: qwen получает полный доступ (правки файлов, коммиты). Это осознанный выбор для автоматизации; промпт ограничивает действия Vibelog-фазой. Mitigation: phase-промпты явно запрещают git-операции и работу вне проекта.
2. **Долгие фазы**: spec/plan/code — минуты; сервер не блокируется (spawn + polling), но при рестарте vibelog browser связка «поллинг→авто-refresh» теряется (сам qwen продолжит и запишет файл — просто доска не обновится сама; кнопка «Обновить» спасает). Known limitation, вне скоупа.
3. **qwen не в PATH / нет auth** — spawn упадёт с exit != 0; лог-хвост в GET trigger покажет причину; README фиксирует требование.
4. **Двойной trigger** — guard Map + 409; после close задача снова триггерится.
5. **Порядок роутов api.ts** — trigger-роуты обязаны быть ДО /^\/api\/tasks\/(.+)$/ (иначе id = 'VL-28/trigger'). Покрыто тестом.
6. **Совместимость**: backlog/config.yml этого проекта расширен, дефолт config.ts не тронут → CLI/MCP-тесты и compat с Backlog.md не задеты.
<!-- SECTION:PLAN:END -->