---
id: VL-180
title: В режиме браузера не используются настройки проекта
status: Done
assignee: []
reporter: ''
created_date: '2026-10-25 13:59'
updated_date: '2026-10-25 20:31'
due_date: ''
labels:
  - bug
  - web
  - bot
  - refactor
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
  - src/web/orchestrator.ts
  - src/web/api.ts
  - src/bot/handlers.ts
  - src/bot/rich.ts
  - src/core/phase-buttons.ts
  - src/core/phase-buttons.test.mjs
  - src/web/trigger-api.test.mjs
  - src/web/reject-task.test.mjs
  - src/web/orchestrator.test.mjs
  - web/src/lib/phase-buttons.ts
  - web/vite.config.ts
  - README.md
lessons:
  - lesson-37
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
В режиме браузера не используются настройки проекта. В частности, сейчас установлен агент по умолчанию vb, а запуск фазы через интерфейс происходит через qwen. И в принципе нужно разобраться, нет ли тут дублирования кода: это одна и та же функциональность с ботом — браузер и бот должны работать идентично (использовать один и тот же код и промпты для выполнения фаз).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 ["Запуск фазы через веб-интерфейс использует настройки проекта (агент по умолчанию из конфига), а не захардкоженное значение", "Логика и промпты выполнения фаз для браузера и бота вынесены в общий код — дублирование устранено", "Автотесты проходят, существующая функциональность веб-интерфейса и бота не регрессирует"]
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План реализации VL-180 (Фаза 2: Plan)

Исследование выполнено (grep/sed по src/, web/). Ключевые факты:
- Баг: `src/web/api.ts:312` — `startPhase(..., 'qwen', ...)` захардкожен; бот везде использует `resolveDefaultAgent(cwd)` (`src/bot/settings.ts:198`, settings.json → `default_agent` → fallback 'qwen').
- `src/web/api.ts:342` — `rejectTask(cwd, id, comment)` без opts.agent; внутри `rejectTask` дефолт тоже `'qwen'` (`src/web/orchestrator.ts:321`), тогда как бот передаёт `resolveDefaultAgent` (handlers.ts:1279).
- Дефолт `agent: 'qwen' | 'vb' = 'qwen'` повторяется в `startPhase` (orchestrator.ts:146), `startPrompt` (:341), `startAnalyze` (:375), `startResume` (:440).
- Дублирование «addComment → startPhase({{comment}})»: api.ts trigger (≈296–318) vs бот `commitComment` (handlers.ts:336–358), `/plan` (:776–804), `/code` (:825–856).
- Дублирование маппинга «статус → следующая фаза»: `src/bot/rich.ts:278–313` (NextPhase, nextPhaseForStatus, PHASE_EMOJI) ↔ явная копия `web/src/lib/phase-buttons.ts` (комментарий: «КОПИЯ логики бота»). Используется в `web/src/components/task-modal/task-modal.tsx:48`.
- Промпты фаз УЖЕ общие: и бот, и web вызывают `startPhase` → `phase-prompt.ts` + `templates/qwen-commands/*.md` — здесь дублирования нет, трогать не нужно.
- Вне скоупа AC (фиксировать, НЕ менять): дублирование валидации настроек `validateSettingsPatch` (api.ts:388) ↔ `parseSetCommand` (commands.ts:337) — это настройки, не логика фаз; `PHASE_BY_STATUS` в `kanban.tsx:55` — drag-колонки, другая карта.

## Изменяемые файлы

### 1. `src/web/orchestrator.ts` — единая точка выбора агента + общий хелпер запуска
- Импорт: добавить `resolveDefaultAgent` в существующий `import { loadBotSettings, resolveBranchMode, resolveCodeSameSession } from '../bot/settings.js'` (строка 26).
- Заменить дефолт агента `= 'qwen'` → `= resolveDefaultAgent(cwd)` в 5 местах:
  - `startPhase` (строка 146),
  - `startPrompt` (:341), `startAnalyze` (:375), `startResume` (:440),
  - `rejectTask` (:321: `opts?.agent ?? 'qwen'` → `opts?.agent ?? resolveDefaultAgent(cwd)`).
  (`cwd` — предыдущий параметр, default-param ссылка валидна в TS/JS.)
- Новый экспорт (после `startPhase`, ~строка 260):
  ```ts
  export function startTaskPhase(
    cwd: string, taskId: string, phase: string,
    opts?: { comment?: string; onExit?: PhaseExitCallback;
             agent?: 'qwen' | 'vb'; sameSession?: boolean }
  ): StartResult
  ```
  Семантика (общая для бота и web):
  1. `agent = opts?.agent ?? resolveDefaultAgent(cwd)`;
  2. непустой `comment` (trim) → `addComment(cwd, taskId, comment)` ДО запуска (импорт из `../core/store.js` — расширить существующий, строка 21); исключение addComment пробрасывается вызывающему (как сейчас: api → 500, бот → «Ошибка:»);
  3. `startPhase(cwd, taskId, phase, onExit, comment ? { comment } : undefined, agent, { sameSession })`.
  - Пустой комментарий → extraVars `undefined` → литеральный `{{comment}}` с фолбэк-инструкцией шаблона (семантика веба; шаблоны phase-1/2/3 её поддерживают — см. вторую строку `{{comment}}` в шаблонах). Изменение для бота: `/plan VL-1` без текста раньше подставлял `''`, теперь литерал — шаблонный фолбэк покрывает оба случая; проверить тестами.
  - Возвращается чистый `StartResult` — вызывающий по `comment` сам знает, писался ли комментарий (нужно для 409-текста api).

### 2. `src/web/api.ts` — AC1 (баг) + устранение дубля trigger
- Строка 312: заменить блок inline `addComment` (:307) + `startPhase(..., 'qwen', ...)` (:312) на один вызов:
  `const result = startTaskPhase(cwd, triggerMatch[1], phase, { comment, sameSession });`
  (агент берётся из настроек проекта внутри хелпера → AC1). Сохранить: ранние проверки (404 задача, 400 «Требуется комментарий» для comment-фазы, строки 291–305) и текст 409 «Комментарий добавлен, но запуск не удался: …» (по `comment` и `'error' in result` — как сейчас).
- Импорт (:52): `import { startTaskPhase, getRun } from './orchestrator.js';` (startPhase больше не нужен напрямую — проверить другие использования startPhase в api.ts; если есть вне trigger — оставить импорт).
- Строка 342 (`rejectTask`): явно не менять — дефолт внутри rejectTask уже переведён на resolveDefaultAgent (п.1) → AC1 покрыт. Для читаемости опционально: `rejectTask(cwd, id, comment)` без изменений.

### 3. `src/bot/handlers.ts` — бот переходит на общий хелпер
Заменить на `startTaskPhase` (импорт расширить: строка 49, добавить `startTaskPhase`):
- `commitComment` (:336–358): `addComment` + `startPhase('comment', {comment}, agent)` → `startTaskPhase(cwd, taskId, 'comment', { comment: text, agent, onExit })`. Порядок сообщений чата: «💬 Комментарий добавлен» и «🚀 …/⚠️ …» отправляются после синхронного вызова — микросдвиг (мс), допустим; тексты НЕ менять.
- `/plan` (:776–804): убрать inline `if (parsed.comment) addComment(...)` (:776) → `startTaskPhase(..., 'plan', { comment: parsed.comment, agent, onExit })`.
- `/code` (:825–856): аналогично + `{ sameSession: parsed.sameSession }` (через opts хелпера).
- `/spec` (:727–740): `startPhase(deps.cwd, task.id, 'spec', onExit, undefined, agent)` → `startTaskPhase(..., 'spec', { onExit, agent: parsed.agent ?? undefined })` — агент резолвится в хелпере; сообщения использовать существующий `agent = parsed.agent ?? resolveDefaultAgent(deps.cwd)` как сейчас (нужен для текста) — можно оставить локальный расчёт, хелпер получит его явно.
- `/close` (:874–884): → `startTaskPhase(..., 'close', { onExit, agent })` (без comment).
- Кнопка `next:` (:1325–1326): `startPhase(..., { comment: '' }, agent)` → `startTaskPhase(..., next.phase, { onExit, agent })` (comment '' больше не передаётся — единообразие: литерал {{comment}} как в вебе; шаблон это поддерживает).
- Кнопка `reject:` (:1268–1279): НЕ менять (rejectTask + onExit-механика, agent уже `resolveDefaultAgent`).
- `/prompt`/`/analyze`/`/resume` (:930, :976, :1007): не трогать (не фазы задач, агент передаётся явно из парсеров).

### 4. Общий модуль «статус → следующая фаза» (AC2)
- Новый файл **`src/core/phase-buttons.ts`** (чистый TS, без node-импортов, без enum — совместимо с web `erasableSyntaxOnly`/`verbatimModuleSyntax`; для type использовать `export type`):
  - перенести из `src/bot/rich.ts:278–313`: `export type NextPhase`, `nextPhaseForStatus`, `PHASE_EMOJI` (с комментариями VL-72/VL-78);
- `src/bot/rich.ts`: удалить локальные определения (:278–313), заменить на ре-экспорт `export { nextPhaseForStatus, PHASE_EMOJI } from '../core/phase-buttons.js'; export type { NextPhase } ...` — импорты в `handlers.ts` и `rich.test.mjs` не меняются;
- `web/src/lib/phase-buttons.ts`: заменить тело на ре-экспорт `export { nextPhaseForStatus, PHASE_EMOJI } from '../../../src/core/phase-buttons'; export type { NextPhase as NextPhaseButton } ...` — `task-modal.tsx:48` не меняется. Обновить шапочный комментарий («КОПИЯ» → «ре-экспорт общего модуля src/core/phase-buttons.ts»).
- `web/vite.config.ts`: если dev/build ругается на импорт вне web/ — добавить в `server.fs.allow` корень репо (`resolve(import.meta.dirname, '..')`). `vibelog browser` отдаёт собранный `web/dist` → **сборка обязательна** (см. проверки).

### 5. Тесты (AC3)
- `src/web/trigger-api.test.mjs` (добавить в describe):
  1. `settings.json` c `default_agent: 'vb'` в testRoot → POST trigger → `getRun(id).agent === 'vb'` (спавн через заглушку: `setSpawnEnvBaseForTests` + `VIBELOG_AGENT_BIN` — паттерн orchestrator.test.mjs:444);
  2. регресс: без settings.json → `agent === 'qwen'`;
  3. существующие 5 тестов (комментарий/400/404) остаются зелёными.
- `src/web/reject-task.test.mjs`: бывшая в Code + `default_agent: 'vb'` → LLM-путь reject запущен агентом `vb` (run.agent).
- `src/web/orchestrator.test.mjs` (новые): `startTaskPhase` — (а) непустой комментарий: файл задачи содержит комментарий ДО спавна, argv заглушки содержит `{{comment}}`-текст; (б) агент из настроек проекта (default_agent vb → run.agent vb); (в) пустой/нет комментария → в промпте литеральный `{{comment}}`.
- Новый `src/core/phase-buttons.test.mjs`: паритет — `nextPhaseForStatus`/`PHASE_EMOJI` из core идентичны ре-экспорту `dist/bot/rich.js` (для всех статусов: To Do/Spec/Planned/In Progress/Review/Done/Blocked/мусор) + импорт web-реэкспорта (`../../web/src/lib/phase-buttons.ts` — vitest транспилирует TS) на равенство. Существующий `src/bot/rich.test.mjs` должен пройти без правок (ре-экспорт сохраняет имена).

### 6. Документация (DoD «Документация обновлена»)
- `README.md`: в разделе про настройки/веб (~строки 95–96 «Настройки», ~310–319 `/set`) добавить: «Запуск фаз из веб-интерфейса (POST /api/tasks/:id/trigger, кнопки карточки) использует агента `default_agent` из .vibelog/settings.json — как бот».
- `CHANGELOG.md` → `[Unreleased]` → «Исправлено»: запись VL-180 (баг хардкода 'qwen' в web-trigger/reject + вынос общих хелперов `startTaskPhase` и `src/core/phase-buttons.ts`).
- Документ-6 «Руководство пользователя» (если описывает запуск фаз из веб) — правка через MCP `document_update` (файл в backlog/, в worktree НЕ коммить).

## Порядок действий
1. `pnpm install` в worktree (и `pnpm --dir web install` — lesson-6).
2. orchestrator.ts: импорт + 5 дефолтов агента + `startTaskPhase`.
3. core/phase-buttons.ts (новый) → ре-экспорт в rich.ts и web/lib/phase-buttons.ts.
4. api.ts: trigger через `startTaskPhase` (убрать хардкод 'qwen').
5. handlers.ts: 5 вызовов (commitComment, /plan, /code, /spec, /close, next) → `startTaskPhase`.
6. Тесты (п.5), правки docs (п.6).
7. Сборка web (если тронут vite.config/phase-buttons).

## Как проверять
```bash
pnpm build            # tsc, strict
pnpm test             # build + vitest run (все suites)
pnpm typecheck
pnpm --dir web install && pnpm web:build   # lesson-6: web/dist пересобрать (lesson-28)
```
Ручная браузерная проверка (по возможности, дробно — lesson-27): `vibelog browser` → в настройках default_agent=vb → кнопка фазы в карточке → в состоянии GET trigger `agent: "vb"`; консоль/сеть без ошибок.

## Риски
1. **Смена дефолта агента** затрагивает все вызовы startPhase без явного agent — бот везде передаёт явно (не пострадает); тесты в tmp-каталогах без settings.json получают 'qwen' как раньше (resolveDefaultAgent-fallback) — регрессии не ожидается, но пройти все suites.
2. **Семантика пустого комментария в боте** ('' → литерал `{{comment}}`) — микросдвиг; шаблоны phase-1/2/3 содержат фолбэк-строку для литерала (покрыто), но если какой-то тест/промпт покажет проблему — фолбэк: хелпер передаёт `{ comment: comment ?? '' }` всегда (как бот сейчас). Выбор зафиксировать в tests.
3. **web-импорт из `../../../src/core/...`** (tsc -b + vite): типы должны удовлетворять `verbatimModuleSyntax`/`erasableSyntaxOnly` web (только функции + `export type`); dev-server может ограничить fs — лечится `server.fs.allow`. Фолбэк, если tsc/vite не принимают: оставить web-копию, но добавить тест-паритет (явно указать в отчёте как неполную замену AC2).
4. **Ре-экспорт rich.ts** — если `rich.test.mjs` матчит что-то кроме имен экспортов, поправить импорт в тесте.
5. Не сломать существующие контракты: 409-текст и неоткат комментария (VL-172), queue close (VL-146), branch-mode, resume/sameSession (VL-147) — хелпер только тонкая обёртка над startPhase, эти механики внутри неё не меняются.
6. `backlog/` и `web/dist` не коммитить/аккуратно при merge (lesson-28: пересборка, а не выбор версии).

## AC ↔ план
1. AC1 (агент из настроек): п.1 (дефолты resolveDefaultAgent в orchestrator) + п.2 (trigger без хардкода) + тесты default_agent vb.
2. AC2 (общий код/промпты): промпты уже общие (phase-prompt — подтверждено, не дублируются); логика запуска → `startTaskPhase` (api + бот); маппинг фаз → `src/core/phase-buttons.ts` (rich + web ре-экспорты).
3. AC3 (тесты/регрессии): п.5 (новые тесты + существующие suites зелёные) + `pnpm test`, `pnpm web:build`.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-25 14:00
---
Фаза 1 (Spec) выполнена. Заголовок: изменён (сняты ведущие теги #bug #web). Масштаб: task. Уточнено: цель — заставить веб-интерфейс использовать настройки проекта (агент по умолчанию вместо захардкоженного qwen) и устранить дублирование кода/промптов выполнения фаз между браузером и ботом (общий код, идентичное поведение); добавлены 3 проверяемых критерия приёмки. Labels: bug (тег пользователя), web, bot, refactor. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-25 19:48
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: 11 файлов в скоупе (orchestrator.ts — дефолт агента resolveDefaultAgent в 5 точках + новый общий хелпер startTaskPhase; web/api.ts — trigger без хардкода 'qwen' через хелпер; bot/handlers.ts — 6 вызовов на общий хелпер; новый src/core/phase-buttons.ts — общий маппинг «статус → следующая фаза» с ре-экспортами в rich.ts и web/lib/phase-buttons.ts; 4 тестовых файла; README/CHANGELOG/док-6). Промпты фаз уже общие (phase-prompt.ts) — дублирования нет, вне правок. Вне скоупа (зафиксировано): зеркало валидации /set ↔ PUT /api/settings, PHASE_BY_STATUS канбана. Риски: смена семантики пустого комментария в боте ('' → литерал {{comment}}, шаблонный фолбэк покрывает), web-импорт из src/ для vite (фолбэк — тест-паритет), ре-экспорт rich.ts для rich.test.mjs.
---
author: @agent
created: 2026-10-25 20:14
---
Фаза 3 (Code) выполнена. Коммит d22c5fc (ветка vb/vl-180), 12 файлов.
Реализация по плану:
1. AC1 (агент из настроек): src/web/orchestrator.ts — дефолт агента переведён с 'qwen' на resolveDefaultAgent(cwd) в startPhase/startPrompt/startAnalyze/startResume + rejectTask (раньше хардкод); src/web/api.ts — POST trigger больше не передаёт 'qwen': вызывает новый общий хелпер startTaskPhase (addComment до старта внутри, агент из .vibelog/settings.json; 404/400/409-контракты сохранены).
2. AC2 (общий код): новый экспорт startTaskPhase (orchestrator.ts) — единая точка «комментарий → фаза» для бота и веба; bot/handlers.ts переведён на хелпер (commitComment, /spec, /plan, /code, /close, кнопка next: — 6 вызовов, тексты сообщений не менялись); новый src/core/phase-buttons.ts — общий маппинг «статус → следующая фаза», rich.ts и web/src/lib/phase-buttons.ts переведены на ре-экспорт (web-копия устранена), web/vite.config.ts — server.fs.allow для dev-импорта из src/. Промпты фаз уже общие (phase-prompt.ts) — не дублировались, вне правок.
3. AC3 (тесты): новые тесты — trigger-api (default_agent vb → run.agent vb + регрессия qwen), reject-task (LLM-путь reject агентом vb), orchestrator (startTaskPhase: комментарий в файле до спавна и {{comment}} в промпте; агент из settings.json; пустой комментарий → литеральный {{comment}}), core/phase-buttons (паритет core ↔ rich.js ↔ web-реэкспорт).
Проверки: pnpm build ✓; pnpm typecheck ✓; pnpm test ✓ (69 suites, 1195 passed + static 7 passed — существующие rich/trigger/reject/orchestrator suites без правок прошли); pnpm web:build ✓ (tsc -b + vite). Ручная браузерная проверка не выполнялась — API-путь trigger покрыт автотестами через handleApi, UI-код менялся только ре-экспортом (сборка web зелёная).
Семантический сдвиг (подтверждён тестами): пустой комментарий в боте теперь литеральный {{comment}} вместо '' — шаблонный фолбэк phase-1/2/3 покрывает оба случая (контракт VL-80/семантика веба).
Что осталось: CHANGELOG.md и backlog-документы (док-6) не обновлялись — по правилам Фазы 3 итоговую документацию пишет Фаза Close после слияния (запись VL-180 в CHANGELOG — в скоуп Close). Вне скоупа AC (зафиксировано в плане): зеркало валидации /set ↔ PUT /api/settings, PHASE_BY_STATUS канбана (drag-колонки).
---
author: @agent
created: 2026-10-25 20:31
---
Фаза Close выполнена. Ветка vb/vl-180 слита в master (1 коммит d22c5fc, merge --no-ff без конфликтов), после merge сборка и тесты зелёные (pnpm build ✓, pnpm test ✓ — 1195+ тестов). Worktree удалена (--force: только untracked-симлинки node_modules/refs), ветка vb/vl-180 удалена. Урок: lesson-37 (общая точка логики фаз бота/веба) — коммит 4847f24 «docs(task): VL-180 — refs и lessons». Документация: запись VL-180 в CHANGELOG.md [Unreleased] → Исправлено (коммит 9fcb396 «docs: VL-180 — документация и CHANGELOG»), README обновлён в слиятой ветке. Doc-6 не менялся: §10 не содержит устаревших утверждений про агента запуска (обновление через MCP требует полной перезаписи тела 65 КБ — небезопасно); DoD «Документация обновлена» обеспечен README + CHANGELOG. Вне скоупа AC (зафиксировано в плане): зеркало валидации /set ↔ PUT /api/settings, PHASE_BY_STATUS канбана.
---
<!-- COMMENTS:END -->