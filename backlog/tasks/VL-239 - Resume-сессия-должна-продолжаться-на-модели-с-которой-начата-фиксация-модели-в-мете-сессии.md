---
id: VL-239
title: 'Resume-сессия должна продолжаться на модели, с которой начата (фиксация модели в мете сессии)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 00:50'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - agent
  - sessions
  - llm
dependencies:
  - VL-209
milestone: v1.11
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/models.ts
  - src/core/models.test.mjs
  - src/agent/llm-env.ts
  - src/agent/llm-env.test.mjs
  - src/agent/session.ts
  - src/agent/session.test.mjs
  - src/agent/cli.ts
  - src/agent/cli.test.mjs
  - src/web/orchestrator.test.mjs
lessons:
  - lesson-145
token_usage:
  input: 15563869
  output: 282057
  cache: 14848512
  total: 15845926
  requests: 173
  duration_ms: 1444686
  reasoning: 232748
  by_phase:
    plan:
      input: 3644049
      output: 125850
      cache: 3387136
      requests: 49
    code:
      input: 10551731
      output: 149399
      cache: 10144000
      requests: 98
    close:
      input: 1368089
      output: 6808
      cache: 1317376
      requests: 26
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст (ответ на вопрос пользователя)

Вопрос: «если сессия начата с одной моделью, при прерывании она должна продолжиться с той же моделью?»

**Ответ по коду: сейчас — НЕТ.**

- Сессия продолжается та же (`--resume <sessionId>`, история из `.vibelog/agent-sessions/<id>.jsonl`), а модель при этом резолвится заново:
  - `src/agent/cli.ts` → `createLlmClient({ sessionId, cwd: settingsCwd, apiMode: opts.apiMode ?? loadApiMode(settingsCwd) })`;
  - `src/agent/llm.ts` → `options.model ?? active?.model ?? process.env.VIBELOG_LLM_MODEL`, где `active = resolveActiveModel(cwd)` читает **текущие** settings.json.
- `meta.model` пишется только пост-фактум в post-run (`updateSessionMeta`) и при resume не читается как источник.
- `api_mode` тоже перечитывается (`loadApiMode`).

Следствия:
1. Смена `models.default` (VL-209) между фазами plan и code — при включённом `code_same_session` (VL-147/VL-187) — незаметно меняет модель на середине задачи, история продолжается «чужой» моделью.
2. Кэш промптов провайдера не переиспользуется через границу фаз.
3. `meta.model` отражает модель последнего рана, а не исходную — диагностика (`/analyze`, billing) искажает картину: токены рана считаются по тарифу фактической модели, хотя задача планировалась на другой.
4. При смене провайдера (`base_url`) в settings.json resume уходит на другой endpoint с историей от прежнего — риск отказа/несовместимости формата.

## Цель

Зафиксировать модель на сессии: продолжение сессии идёт на той модели, с которой она начата, если явно не попросили иное.

## Предлагаемое решение (проверить в Plan)

1. **Запись при создании**: в CLI, в точке создания `sessionId` (ветка `isNewSession`) — резолвить активную модель и писать в мету `model` + `model_id` (id из available) + `provider` + `api_mode` ДО `createLlmClient`/первого запроса.
2. **Резолв при resume**: если мета сессии содержит `model` — использовать её (и согласованный `provider`/`base_url`/`api_mode`), а не `resolveActiveModel`. Env-fallback (`VIBELOG_LLM_MODEL`) — только для сессий без меты/без `model`.
3. **Предупреждение при расхождении**: мета и активная модель разошлись → предупреждение в stderr (в `logTail` оркестратора) с обеими моделями и указанием, какая применена.
4. **Явное переопределение**: флаг (напр. `--model <id>` / `--model-follow-settings`) или настройка проекта — чтобы осознанно продолжить на новой модели; дефолт — придерживаться модели сессии.
5. **Лог**: `activeModelLogLine` при resume печатает фактическую модель сессии, помечая источник («из сессии» / «из настроек»).

## Места правки (проверить в Plan)

- `src/agent/cli.ts` — резолв модели до/после sessionId (сейчас клиент создаётся после резолва сессии — удобная точка);
- `src/agent/session.ts` — `SessionMeta` уже содержит `model?: string`; добавить `model_id`/provider при необходимости;
- `src/agent/llm.ts` / `src/agent/llm-env.ts` — возможность передать модель из меты как `options.model` + согласованные baseUrl/apiKey/apiMode;
- `src/core/models.ts` — резолв конкретной модели по id из available (не только default);
- `src/web/orchestrator.ts` (resume через бота) и retry автоочереди (VL-200) — они спавнят CLI, наследуют поведение автоматически; проверить, что extraArgs не перебивают модель;
- тесты: `src/agent/cli.test.mjs`, `src/agent/llm*.test.mjs`, `src/agent/session.test.mjs`.

## Риски и открытые вопросы (для Plan/фазы Spec)

- Что считать «той же моделью»: id из available (меняется при правке id) или provider+model (стабильнее)? Склоняюсь к provider+model как идентичности и id как подписи.
- Старые сессии без `model`: прежнее поведение (активная модель) — чтобы не блокировать resume.
- Если модель из меты больше не существует в settings.json (удалена из available): нужен дефолт — попытаться разрешить по provider+model; если провайдер удалён — предупреждение и уход на активную модель (fail-open, чтобы фаза не встала). Согласовать в Plan.
- Billing: тариф берётся по фактической модели рана — проверить, что после фиксации это по-прежнему корректно (записи журнала за разные фазы могут быть с разными тарифами — это ожидаемо).

## Входные данные

Прямой ответ на вопрос пользователя о поведении resume; связано с VL-147/VL-187 (code_same_session), VL-200 (resume при retry), VL-209 (реестр моделей), VL-198 (billing/мета).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 AC1: при создании задачной сессии CLI пишет в `<id>.meta.json` модель сессии — `model_id`, `model_provider`, `model_name`, `api_mode` (значения из резолва до первого LLM-запроса)
- [x] #2 AC2: resume-ран применяет модель из меты сессии (id, при отсутствии в available — по паре provider+wire-имя), а не текущую `models.default`; `--model <id>` и `--model-follow-settings` явно переопределяют поведение, вместе они несовместимы (exit 1)
- [x] #3 AC3: расхождение модели меты и активной в settings даёт предупреждение в stderr с обеими моделями и указанием, какая применена; лог старта фазы показывает фактическую модель и источник («из сессии»/«из настроек»/«из env»)
- [x] #4 AC4: fail-open — мета без model-полей, удалённая модель/провайдер или отсутствующий ключ не роняют фазу: применяется активная/env-модель с предупреждением (старые сессии и env-only конфиги не ломаются)
- [x] #5 AC5: тесты — новый `src/agent/llm-env.test.mjs` (приоритеты резолва, fail-open, лог/предупреждение) + кейсы в cli/models/session/orchestrator-тестах; полный `pnpm test` зелёный
- [x] #6 AC6: документация обновлена — README (§«Модели и провайдеры», §«Учёт токенов»), CHANGELOG.md, doc-10 (ограничение: сессии без меты — `/prompt`, TUI-чат — продолжают на активной модели)
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

Сессия агента фиксирует модель при создании; resume-ран идёт на модели сессии, а не на текущей `models.default`. Явное переопределение — флагами; при расхождении — предупреждение в stderr (→ logTail); модель сессии не найдена/провайдер удалён — fail-open на активную модель.

## Решения (закрывают «Риски и открытые вопросы»)

1. **Идентичность модели** = `provider` + wire-`model` (стабильна), id из `available` — подпись. В мете пишем всё три: `model_provider`, `model_name`, `model_id` — резолв пробует id, при неудаче ищет по provider+model.
2. **Мета пишется только там, где она и так пишется** (задачные сессии: `<фаза> <taskId>` и env-путь с валидным `VIBELOG_PHASE_TASK_ID`). Сессии `/prompt` и TUI-чат мету по-прежнему НЕ создают (инвариант VL-110, тест cli.test.mjs «готовый промпт (без фазы) мету не создаёт») → для них поведение прежнее (активная модель). Ограничение фиксируем в README/doc-10. Тест VL-110 не трогаем.
3. **Резолв при resume**, приоритет: `--model <id>` → `--model-follow-settings` («взять активную») → мета сессии → активная модель → env-fallback.
   - мета + `models` настроены: `resolveModelById(cwd, meta.model_id)`; null → поиск по provider+model; null → **предупреждение + уход на активную** (fail-open, фаза не встаёт);
   - мета + `models` НЕ настроены (env-only): применяем `meta.model_name` как `options.model` (base_url/apiKey — из env), при расхождении с `VIBELOG_LLM_MODEL` — предупреждение;
   - меты нет / мета без model-полей (старые сессии): активная модель, как сейчас.
4. **`api_mode`**: из меты приоритетнее конфига (режим, с которым сессия начата); при расхождении с `api_mode` модели в settings — предупреждение. Флаг `--api-mode` остаётся выше всех (VL-205).
5. **Расхождение мета ↔ активная модель** → строка предупреждения в stderr: `Внимание: модель сессии <label> (<id>) ≠ активная в settings <label2> (<id2>) — продолжаю на модели сессии (переопределения: --model <id2> | --model-follow-settings)`.
6. **Billing/тариф**: не меняем — запись billing хранит `model: llm.model` (фактическая модель рана), тариф по факту; разные тарифы у ранов одной задачи — ожидаемо.

## Файлы и точки правки (порядок = порядок работы)

### 1. `src/agent/session.ts` — поля меты
- `SessionMeta` рядом с `model?: string` (строка ~155) добавить: `model_id?: string`, `model_provider?: string`, `model_name?: string`, `api_mode?: ApiMode` (импорт типа из `./llm.js` — там уже импортируется `ChatMessage`). `model?: string` оставить как «фактическая модель последнего рана» (используется session-summary.ts:490, billing).
- `saveSessionMeta` (261) / `updateSessionMeta` (285) не меняем: они мержат `Partial<SessionMeta>` (новые поля проходят автоматически).

### 2. `src/core/models.ts` — резолв по provider+wire-имени
- Вынести приватный билдер `ActiveModel` из `resolveModelById` (160-185) в `buildActiveModel(cwd, id, conf)`.
- Новый экспорт `findModelByProviderName(cwd, providerId, wireName): ActiveModel | null` — обход `loadModels(cwd).available`, совпадение `conf.provider === providerId && conf.model === wireName`; возврат через `buildActiveModel`. Ключ `available` (id) возвращаем как есть — он и станет `label/id` в логе.
- `resolveModelById` (160) и `resolveActiveModel` (190) — поведение не меняем (тесты models.test.mjs 110-168).

### 3. `src/agent/llm-env.ts` — резолв модели рана (ядро задачи)
- Новый интерфейс `ResolvedRunModel { id; label; providerId?; model; baseUrl?; apiKey?; apiMode: ApiMode; source: 'session' | 'settings' | 'env' | 'explicit'; warning?: string }`.
- Новый экспорт `resolveRunModel(cwd, meta: SessionMeta | null, opts?: { modelId?: string; followSettings?: boolean }): ResolvedRunModel` — реализует приоритеты из п.3-5. `modelId` не найден → `throw new Error('Неизвестная модель: <id> — отсутствует в models.available settings.json')` (явный флаг ≠ fail-open).
- Новый экспорт `modelLogLine(resolved): string` — `Модель: <label> (<id>), api_mode: <mode>` + суффикс источника: ` — из сессии` (source 'session') / ` — из настроек` / ` — из env`. Формат базовой части сохраняется дословно (её матчит cli.test.mjs:661).
- `ensureLlmEnv(subject, cwd?, opts?: { active?: ActiveModel | null })` (34): при переданном `opts.active` валидируется ЭТА модель (провайдер существует, ключ не пуст; текст: `Ошибка: не задан API-ключ провайдера "<providerId>" — агенту нужен доступ к LLM (env <apiKeyEnv|VIBELOG_LLM_API_KEY>/.env/settings.json env-секция)`), иначе — прежний путь (`validateModelsConfig` для default). Совместимость текстов для env-only сохраняется (тест cli.test.mjs:174 /VIBELOG_LLM_API_KEY/).
- `loadApiMode` (82) и `activeModelLogLine` (95) оставить (используются web/chat.ts:720, supervisor-tick.ts:200, interactive.ts:110).

### 4. `src/agent/cli.ts` — фиксация и применение
- `CliOptions` (~105, рядом с `apiMode`): `model?: string` (комментарий: `--model <id>` — разовое переопределение модели рана), `modelFollowSettings?: boolean`.
- `parseArgs` (~231, рядом с `--api-mode`): ветки `--model` (значение обязательно) и `--model-follow-settings` (boolean); после цикла — `opts.model !== undefined && opts.modelFollowSettings` → `throw new Error('--model и --model-follow-settings несовместимы — укажи один флаг')`; значение `--model` валидировать не здесь (резолв ниже даст понятную ошибку). USAGE (~138): две строки описания. lesson-18: флаги читаются в точке `resolveRunModel` (шаг ниже), а не остаются «unread».
- Резолв сессии (480-495): оставить как есть; IIFE `resumedBlockedSignatures` (496-505) заменить на одну переменную `const sessionMeta = loadSessionMetaSync(sessionsDir, sessionId)` (try/catch), из неё и `blocked_signatures`, и мета для резолва модели.
- Точка 513-517 (перед `createLlmClient`):
  ```
  const resolved = resolveRunModel(settingsCwd, sessionMeta, { modelId: opts.model, followSettings: opts.modelFollowSettings });
  if (!ensureLlmEnv('агенту', settingsCwd, { active: resolved.source === 'env' ? null : <ActiveModel части resolved> })) { exit 1 }
  if (resolved.warning) log(resolved.warning);
  log(modelLogLine(resolved));
  const llm = createLlmClient({ sessionId, cwd: settingsCwd, ...(resolved.baseUrl ? {baseUrl} : {}), ...(resolved.apiKey ? {apiKey} : {}), ...(resolved.source === 'env' ? {} : { model: resolved.model }), apiMode: opts.apiMode ?? resolved.apiMode });
  ```
  `log(activeModelLogLine(settingsCwd))` со строки 409 убрать; сам `ensureLlmEnv` со строки 403 — оставить на прежнем месте как раннюю проверку окружения (env-only путь), либо перенести к резолву. Итог в плане: оставляем ОДИН вызов `ensureLlmEnv` — на прежнем месте (строка 403) он гарантирует понятную ошибку до создания сессии; второй, модельный, — на точке резолва только когда `resolved.source === 'session'` (иначе дубль проверки). При этом `if (!ensureLlmEnv(...)) return` в точке резолва обязателен.
- `isNewSession` ветка (525-540): добавить model-поля в оба вызова `saveSessionMeta` (`{ taskId, phase, cwd, model_id: resolved.id, model_provider: resolved.providerId, model_name: resolved.model, api_mode: resolved.apiMode }`). Значения берём из `resolved` для `source !== 'env'`; для env-пути пишем `model_name: resolved.model` (полученный из env) и без provider/id — тогда resume сможет закрепить wire-имя.
- Пост-ран (891, 909-915): не менять (`model: llm.model` — фактическая модель рана; `model_id` при создании не перезаписываем).
- Гард: при `resolved.source === 'session'` и `resolved.model !== llm.mode`… (нет) — вместо этого в пост-ране, если фактическая модель (`llm.model`) отличается от `resolved.model`, писать предупреждение в stderr (диагностика, что переопределение сработало/не сработало).

### 5. `src/agent/interactive.ts` — TUI-чат
- Не меняем (мета TUI-сессиями не пишется → нет данных о модели сессии). Зафиксировать в плане как осознанное ограничение; если мета есть (руками/старые), можно применить `resolveRunModel` — вне объёма этой задачи.

### 6. `src/web/orchestrator.ts` — проверка, без правок
- `spawnQwenRun` (922) формирует argv: `[prompt, ...extraArgs, ...limitFlags, '--approval-mode','yolo','--output-format','json', ...phaseFlags]` — модель не задаётся; `extraArgs` — только `['--resume', sid]` (VL-147/200). Значит resume через бота и retry автоочереди наследуют фиксацию автоматически. Проверка в тестах: `src/web/orchestrator.test.mjs` — кейс «resume-спавн не содержит `--model`/не перебивает модель».

### 7. Тесты
- НОВЫЙ `src/agent/llm-env.test.mjs` (mkdtemp-фикстура с `.vibelog/settings.json`, паттерн VL-241/lesson-89; `delete process.env.VIBELOG_LLM_MODEL`/сохранение-восстановление):
  1. мета без model-полей → source 'settings', model = default;
  2. мета с `model_id` не-default модели → source 'session', model/baseUrl/apiKey/apiMode от этой модели;
  3. мета с `model_id`, отсутствующим в available, но совпадающим по provider+model → резолв по паре (переименованный id);
  4. мета с удалённой моделью → source 'settings' + `warning` с обеими моделями (fail-open);
  5. `--model <id>` → source 'explicit', перебивает мету; неизвестный id → throw;
  6. `--model-follow-settings` → source 'settings', мета игнорируется;
  7. `api_mode` из меты приоритетнее конфига + warning при расхождении;
  8. env-only (`models` нет): мета `model_name` → model применяется, baseUrl/apiKey отсутствуют; расхождение с `VIBELOG_LLM_MODEL` → warning;
  9. `modelLogLine`: совместимость формата `Модель: <label> (<id>), api_mode: chat` + суффикс «из сессии».
- `src/core/models.test.mjs`: `findModelByProviderName` — находит по паре, null при чужом provider и при чужом wire-имени, подпись/id сохранены.
- `src/agent/session.test.mjs`: расширить merge-тест (297) — `updateSessionMeta` дописывает `model_id/model_provider/model_name/api_mode`, не затирая `taskId/phase`.
- `src/agent/cli.test.mjs` (мок-LM уже есть, `llmRequests` — тела запросов):
  - фаза пишет model-поля в `<id>.meta.json` (расширить тест VL-110 на 834);
  - resume на «другой активной модели» (settings.json правится между ранами) → в `llmRequests.at(-1).model` — модель сессии; в stderr предупреждение о расхождении;
  - `--model <id>` на resume → в запросе указанная модель; `--model-follow-settings` → активная;
  - `--model` + `--model-follow-settings` → exit 1, текст «несовместимы»;
  - сессия без меты → активная модель (legacy, регрессия VL-95);
  - тест VL-209 «Модель: Test Model (mockp/Test/Model), api_mode: chat» (639) остаётся зелёным.

### 8. Документация (DoD «Документация обновлена»)
- `README.md`: §«Модели и провайдеры» (731) — абзац «Модель фиксируется на сессии»: правила резолва, флаги `--model` / `--model-follow-settings`, предупреждение в logTail, ограничение (сессии без меты: `/prompt`, TUI-чат).
- `README.md` §«Учёт токенов» (620) — перечислить новые поля меты (`model_id/model_provider/model_name/api_mode`) и что `model` = фактическая модель последнего рана.
- `CHANGELOG.md` — секция «Исправлено» (Unreleased), запись VL-239.
- `backlog/docs/doc-10` (Агент Vibelog) — раздел про resume/сессии: та же фиксация модели.

## Порядок и проверка

1. models.ts → llm-env.ts → session.ts (поля) → cli.ts (флаги/точка резолва/мета) → тесты → документация.
2. Итеративно: `pnpm build && pnpm test:fast` (точечно `npx vitest run src/agent/llm-env.test.mjs src/agent/cli.test.mjs src/core/models.test.mjs src/agent/session.test.mjs`).
3. Перед DoD: полный `pnpm test` (build + vitest). Исключений/`--exclude` нет.
4. Ручной smoke: два рана одной сессии при переключённом `models.default` (`vibelog model use`) — в stderr рана 2 строка «Модель: … — из сессии» и предупреждение о расхождении; в `.vibelog/billing/<ID>.json` у ранов разные `model` (ожидаемо).

## Риски и митигации

- **Порядок логов/проверок в cli.main**: VL-209-тест матчит строку «Модель: …» — формат базовой части сохраняем дословно, суффикс источника добавляем только в конце; тест не якорный.
- **Двойная валидация окружения**: один `ensureLlmEnv` на прежнем месте (env/active) + модельная проверка только при `source === 'session'` — не дублировать тексты.
- **fail-open**: любая неточность меты (битая, удалённая модель/провайдер, отсутствие ключа) завершается предупреждением и уходом на активную/env — фаза не встаёт (паттерн lesson-56).
- **Регрессия VL-110/VL-147/VL-200**: тесты «мета не создаётся для /prompt», `code_same_session` (мета plan-сессии с model-полями переиспользуется как есть), retry `--resume` — покрыть в cli.test.mjs/orchestrator.test.mjs.
- **LLM-клиент в тестах**: `llm.test.mjs` передаёт `apiMode` явно (VL-240) — не трогаем; новые фикстуры — только `mkdtemp` (VL-241).
- **api_mode из меты vs responses-провайдер**: если провайдер сессии больше не поддерживает зафиксированный режим, ран упадёт HTTP 400 с понятной диагностикой (не глотаем) — в плане как известное поведение; при явном `--api-mode` пользователь переопределяет.

## Объём
Правки: `src/agent/cli.ts`, `src/agent/llm-env.ts`, `src/core/models.ts`, `src/agent/session.ts` (только поля), `README.md`, `CHANGELOG.md`, `backlog/docs/doc-10`. Новый тест-файл `src/agent/llm-env.test.mjs` + кейсы в cli/models/session/orchestrator тестах. Задач-блокеров не требуется (объём одной задачи).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-01 16:29
---
Фаза 2 (Plan) выполнена. Тип: bug. План записан в Implementation Plan задачи; добавлены AC1–AC6.
Изучено: `src/agent/cli.ts` (резолв сессии 480–495, точка `createLlmClient` 513–517, `isNewSession` 525–540, пост-ран 850–930), `src/agent/llm-env.ts` (ensureLlmEnv/loadApiMode/activeModelLogLine), `src/agent/llm.ts` (LlmClientOptions.createLlmClient, порядок options.model → active.model → env), `src/core/models.ts` (resolveActiveModel/resolveModelById), `src/agent/session.ts` (SessionMeta.model, saveSessionMeta/updateSessionMeta merge), `src/web/orchestrator.ts` (startPhase/startResume/extraArgs, argv спавна 922), `src/web/chat.ts` (образец override модели), README (§Модели и провайдеры, §Учёт токенов), CHANGELOG.
Ключевые решения:
- Идентичность модели = provider + wire-model; в мете пишем `model_id` + `model_provider` + `model_name` + `api_mode` — резолв пробует id, при отсутствии в available ищет по паре (устойчиво к переименованию id).
- Приоритет резолва: `--model <id>` → `--model-follow-settings` → мета сессии → активная модель → env-fallback. Флаги несовместимы, неизвестный `--model` — явная ошибка; мета не разрешилась — предупреждение и fail-open на активную модель (фаза не встаёт).
- `api_mode` из меты приоритетнее конфига (флаг `--api-mode` — выше всех, VL-205); при расхождении — предупреждение с обеими моделями в stderr (logTail).
- Мета пишется ровно там, где и сейчас (задачные сессии `<фаза> <taskId>` и env-путь с валидным taskId); `/prompt` и TUI-чат мету не создают — инвариант VL-110 не нарушен, ограничение документируется.
- Billing/тариф не меняем: запись хранит `model: llm.model` (фактическая модель рана), разные тарифы ранов одной задачи — ожидаемо (ответ на открытый вопрос из описания).
- Оркестратор (resume бота, retry автоочереди VL-200) правок не требует: модель в argv спавна не передаётся, `extraArgs` — только `--resume`; поведение наследуется автоматически (проверка кейсом в orchestrator.test.mjs).
Файлы плана: `src/agent/cli.ts`, `src/agent/llm-env.ts` (ядро: `resolveRunModel` + `modelLogLine` + валидация конкретной модели в `ensureLlmEnv`), `src/core/models.ts` (`findModelByProviderName`), `src/agent/session.ts` (только поля меты), тесты (`src/agent/llm-env.test.mjs` — новый, кейсы в cli/models/session/orchestrator), документация (README ×2 раздела, CHANGELOG.md, doc-10).
Риски: двойная валидация окружения (митигация: один `ensureLlmEnv` в модельной ветке только при `source === 'session'`), совместимость формата строки лога модели (базовая часть сохраняется дословно — тест VL-209), fail-open при битой/устаревшей мете (lesson-56), изоляция тестов от локального settings.json (VL-240) и mkdtemp-фикстуры (VL-241). Проверка: `pnpm build && pnpm test:fast` точечно, перед DoD — полный `pnpm test` (без исключений). Блокеров и дочерних задач не требуется — объём одной задачи.
---
author: @agent
created: 2026-11-01 19:46
---
Фаза 3 (Code) выполнена. Коммит a299d74 «feat: VL-239 — фиксация модели на сессии агента (resume на модели сессии)».
Реализовано по плану:
- `src/core/models.ts`: приватный `buildActiveModel` (дедупликация) + новый экспорт `findModelByProviderName(cwd, providerId, wireName)` — резолв по стабильной паре provider+wire-имя (переживает переименование id в available). `resolveModelById`/`resolveActiveModel` поведение не меняют.
- `src/agent/llm-env.ts`: новый `resolveRunModel(cwd, meta, opts)` — приоритет `--model` (explicit) → `--model-follow-settings` → мета сессии (session) → активная модель (settings) → env; идентичность: id, при промахе пара provider+model, при промахе — fail-open на активную с предупреждением. `api_mode` из меты приоритетнее конфига, расхождение — отдельным предупреждением. Новый `modelLogLine` — дословный формат VL-209 + суффикс источника («— из сессии / из настроек / из env / явный --model»). `ensureLlmEnv` получил `opts.active`: валидируется ФАКТИЧЕСКАЯ модель рана (её провайдер/ключ), а не models.default — сломанный default больше не блокирует resume живой сессии (тексты ошибок прежние; env-ветка не тронута — тест VL-189 зелёный).
- `src/agent/session.ts`: `SessionMeta` += `model_id`, `model_provider`, `model_name`, `api_mode` (модель СЕССИИ, не перезаписывается пост-раном; `model` остаётся фактической моделью последнего рана).
- `src/agent/cli.ts`: флаги `--model <id>` и `--model-follow-settings` (взаимоисключающие, ошибка в parseArgs), USAGE; мета-резолв переведён на одну переменную `sessionMeta` (из неё же `blocked_signatures`); `ensureLlmEnv` перенесён в точку резолва модели (валидация фактической модели); `createLlmClient` получает model/baseUrl/apiKey/apiMode из резолва; при создании сессии model-поля пишутся в мету ДО первого запроса; предупреждение о расхождении и лог модели — в stderr (logTail).
- Billing/тариф не менялись: запись хранит `model: llm.model` (фактическая модель рана), разные тарифы ранов задачи — ожидаемо.
Проверки: `pnpm build` (tsc, чисто); точечно `npx vitest run src/agent/llm-env.test.mjs src/core/models.test.mjs src/agent/session.test.mjs src/agent/llm.test.mjs src/agent/cli.test.mjs src/web/orchestrator.test.mjs` — зелёные; полный `pnpm test` — 120 файлов, 2209 passed, 4 skipped, 0 failed (без --exclude/--skip).
Новые тесты: `src/agent/llm-env.test.mjs` (15 кейсов — приоритеты, пара provider+model, fail-open, api_mode, env-путь, modelLogLine); +4 кейса `findModelByProviderName` в models.test.mjs; +1 кейс merge model-полей в session.test.mjs; +4 интеграционных в cli.test.mjs (мета model-полей, смена default между ранами → модель сессии + предупреждение + --model/--model-follow-settings/неизвестный id, сессия без меты → активная модель, parseArgs); проверка argv спавна без `--model` в orchestrator.test.mjs.
Осталось (вне DoD Code — Фаза Close): AC6 документация (README §«Модели и провайдеры» + §«Учёт токенов», CHANGELOG.md, doc-10) намеренно не обновлялась в Code (правило фазы — документацию пишет Close). AC6 НЕ отмечен. AC1–AC5 отмечены. Создан и связан lesson-145.
---
author: @agent
created: 2026-11-01 19:55
---
Фаза Close выполнена. Ветка vb/vl-239 слита в master (1 коммит a299d74, merge — 9 файлов, +890/−33), worktree удалена (force — в ней были только untracked-симлинки node_modules/references/data), ветка vb/vl-239 удалена.
Проверки после merge (в главном репо): `pnpm build` — чисто; ранний точечный фильтр по diff'у merge (5 файлов тестов: llm-env, cli, models, session, orchestrator) — 217 passed; полный `pnpm test` — 122 файла, 2329 passed, 4 skipped, 0 failed (без --exclude/--skip, единственный прогон в фазе, параллельного vitest не было).
Документация (AC6, DoD #2):
- README §«Учёт токенов (billing)» — новые поля меты `model_id/model_provider/model_name/api_mode` (модель сессии) и что `model` = фактическая модель последнего рана;
- README §«Модели и провайдеры» — новый подраздел «Модель фиксируется на сессии (VL-239)»: правила резолва и приоритеты, идентичность provider+wire-модель, флаги `--model`/`--model-follow-settings` (взаимоисключающие), `api_mode` из меты, лог с источником, предупреждение при расхождении, fail-open, ограничение (сессии `/prompt` и TUI-чат меты не пишут → активная модель), billing без изменений;
- CHANGELOG.md — запись VL-239 в Unreleased/«Исправлено»;
- backlog/docs/doc-10 (Агент Vibelog) — строки `--model`/`--model-follow-settings` в таблице флагов и абзац «Модель фиксируется на сессии» в §3.1 (приоритеты резолва, `resolveRunModel`/`findModelByProviderName`, `ensureLlmEnv` по фактической модели, ограничение, наследование поведения retry VL-200 и resume через бота).
Коммиты: 318d0a0 «docs(task): VL-239 — refs и lessons», 943cb3b «docs: VL-239 — документация и CHANGELOG».
Lessons: lesson-145 (резолв модели рана — чистая функция от меты, валидация окружения по фактической модели) — связан с задачей, source_tasks/linked_tasks = VL-239.
DoD: #1 «Тесты проходят» — выполнен (полный pnpm test зелёный), #2 «Документация обновлена» — выполнен в этой фазе, #3 «Нет регрессий» — выполнен. AC: AC1–AC5 отмечены ранее в Code, AC6 отмечен сейчас. Неотмеченных пунктов нет.
---
<!-- COMMENTS:END -->