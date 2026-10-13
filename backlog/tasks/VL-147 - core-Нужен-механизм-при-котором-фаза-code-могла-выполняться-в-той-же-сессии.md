---
id: VL-147
title: 'Запуск фазы code в той же сессии агента, что и plan'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-13 18:20'
updated_date: '2026-10-13 23:03'
due_date: ''
labels: []
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
  - src/agent/session.ts
  - src/agent/session.test.mjs
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - src/bot/settings.ts
  - src/bot/settings.test.mjs
  - src/bot/commands.ts
  - src/bot/commands.test.mjs
  - src/bot/handlers.ts
  - src/web/api.ts
  - README.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#core Нужен механизм при котором фаза code могла выполняться в той же сессии агента, что и была выполнена фаза plan. Этот механизм должен включаться выключаться в настройках и/или явно задаваться в команде на выполнение фазы. Это нужно для возможной экономии входных токенов, если у модели большой контекст и кэш.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Режим можно явно задать при вызове команды фазы code (параметр/флаг), переопределяя настройку
- [x] #2 Добавлена настройка, включающая/выключающая запуск фазы code в той же сессии агента, что и plan; значение по умолчанию сохраняет текущее поведение
- [x] #3 При включённом режиме фаза code выполняется в той же сессии без повторной инициализации контекста plan; при выключённом — работает как раньше, есть тесты на оба режима
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

Фаза code может продолжать сессию агента фазы plan (`--resume <planSessionId>`) — экономия входных токеней за счёт кэша большого контекста. Механизм управляется настройкой и переопределяется явным флагом команды/параметром API.

## Архитектурное решение

- Источник sessionId план-сессии — меты `.vibelog/agent-sessions/<id>.meta.json` (уже пишутся CLI vibelog-agent при старте задачной сессии: taskId/phase/cwd, VL-110/114).
- У qwen меты не пишутся (пишет только наш CLI) → оркестратор в `finish()` допишет мету по `result.session_id` для ВСЕХ агентов — тогда plan-сессии qwen тоже находимы.
- Продолжение сессии = шаблон phase-3.md рендерится как раньше + `extraArgs=['--resume', <planSessionId>]` (тот же механизм, что `startResume`, VL-93).
- Fallback: план-сессия не найдена → обычный новый запуск (текущее поведение, регрессий нет).
- Настройка: ключ `code_same_session` в `.vibelog/settings.json` (BotSettings), дефолт off — текущее поведение сохраняется (AC2).
- Явное переопределение: флаг `--same-session` / `--no-same-session` в команде `/code` и поле `sameSession` в POST /api/tasks/:id/trigger (AC1). `--no-same-session` нужен, чтобы разово обойти включённую настройку.

## Файлы для изменения

1. **src/agent/session.ts** (~после latestSession, стр. 95–115)
   - Новая экспортная `findTaskPhaseSessionSync(dir, taskId, phase): string | null` — readdirSync `*.meta.json`, чтение мет (loadSessionMetaSync), совпадение meta.taskId (UPPER, регистронезависимо) и meta.phase === phase; возврат sessionId с максимальным mtime jsonl-файла (или meta при отсутствии jsonl). Null — нет совпадений. Sync-форма нужна startPhase (sync-точка входа).

2. **src/web/orchestrator.ts**
   - `startPhase` (стр. ~87): 7-й параметр `opts?: { sameSession?: boolean }`. Перед `return spawnQwenRun(...)` (стр. ~139): если `phase === 'code'` и `opts.sameSession ?? loadBotSettings(cwd).code_same_session === true` — `findTaskPhaseSessionSync(agentSessionsDir(cwd), taskId, 'plan')`; найдена → extraArgs `['--resume', id]` + примечание в промпт («Сессия продолжает фазу plan (VL-147), контекст планирования уже в истории»); не найдена — extraArgs пустые, обычный запуск + console.log предупреждение.
   - `finish()` (~стр. 502–580): после `parseQwenResult` — если `result?.session_id` и `phaseTaskId !== ''` — fire-and-forget `saveSessionMeta(agentSessionsDir(cwd), result.session_id, { taskId: phaseTaskId, phase, cwd })` в try/catch (меты для qwen-сессий; у vb мета уже записана CLI при старте — перезапись идемпотентна). `phaseTaskId` просачивается в замыкание уже посчитанным выше (стр. ~326).
   - Примечание: при `--resume` CLI vb мету не перезаписывает (isNewSession=false) — мета остаётся phase='plan'; это корректно: возобновлённые code-запуски продолжают ту же план-сессию.

3. **src/bot/settings.ts**
   - `BotSettings` (стр. 23–44): поле `code_same_session?: boolean` (комментарий — VL-147, по умолчанию off).
   - `loadBotSettings` (стр. 86–112): `raw.code_same_session === true ? true : undefined` (строгое true, как branch_mode).
   - `saveBotSettings` (стр. 132–155): ключ `code_same_session` в patch (пишем всегда, когда задан, включая false).
   - Новый `resolveCodeSameSession(cwd): boolean` рядом с resolveBranchMode (~стр. 210) — `loadBotSettings(cwd).code_same_session === true`.

4. **src/bot/commands.ts**
   - `CodeCommand` (стр. 51–58): поле `sameSession?: boolean`.
   - `parseCodeCommand` (стр. 249–267): перед разбором id/комментария вырезать токены `--same-session` → sameSession:true и `--no-same-session` → sameSession:false из trimmed-текста (иначе токен попал бы в комментарий фазы).
   - `SetCommand` (стр. 70–80): вариант `{ key: 'code-same-session'; value: boolean }`.
   - `parseSetCommand` (стр. 298–345): принять ключ `code-same-session` по булеву on|off|true|false, как compact/branch-mode (проверки ключа, hint-строка, ветка булевых значений).

5. **src/bot/handlers.ts**
   - `/code` handler (~стр. 763–810): передать `parsed.sameSession` в startPhase — `startPhase(deps.cwd, task.id, 'code', onExit, { comment: ... }, agent, { sameSession: parsed.sameSession })`.
   - `/set` switch (~стр. 572–610): `case 'code-same-session'` → `settings.code_same_session = parsed.value; saveBotSettings(...);` ответ «⚙️ Фаза Code в сессии Plan: вкл/выкл».

6. **src/web/api.ts** (POST /api/tasks/:id/trigger, стр. ~62–73)
   - `const sameSession = typeof body?.sameSession === 'boolean' ? body.sameSession : undefined;` → 7-й аргумент startPhase `{ sameSession }`.

7. **README.md** (раздел «Режим параллельной разработки»/команды бота, стр. ~224–245)
   - Добавить: `/set code-same-session on|off` (ключ `code_same_session` в .vibelog/settings.json, выключен по умолчанию) и явные переопределения `/code VL-N --same-session|--no-same-session`, `sameSession` в POST trigger.
   - DoD «Документация обновлена» закрывается README; пользовательское руководство (backlog/docs/doc-6) — через document_update после кода, если раздел команд бота поддерживает эти ключи.

## Тесты

- **src/agent/session.test.mjs**: findTaskPhaseSessionSync находит сессию по taskId+phase; игнорирует чужую задачу/чужую фазу; null без совпадений; при двух план-сессиях выбирает последнюю по mtime.
- **src/web/orchestrator.test.mjs** (паттерн VL28_STUB_MARKER, setStubEnv VL-140):
  1) pre-seed мета plan-сессии + startPhase code с sameSession=true → в argv стаба есть `--resume <sessionId>`;
  2) дефолт (настройка off) → `--resume` НЕТ;
  3) настройка code_same_session=true в settings.json тест-cwd → `--resume` ЕСТЬ;
  4) sameSession=false при включённой настройке → `--resume` НЕТ (переопределение);
  5) настройка on, но план-сессия не найдена → fallback без `--resume`;
  6) finish() дописывает мету: стаб печатает JSON с session_id → появляется `<id>.meta.json` с taskId/phase.
- **src/bot/settings.test.mjs**: load/save/resolveCodeSameSession (true/false/мусор).
- **src/bot/commands.test.mjs**: parseCodeCommand с `--same-session`/`--no-same-session` (флаг не попадает в comment, id разбирается); parseSetCommand `code-same-session on|off` и ошибка при мусоре.

## Порядок действий

1. session.ts (findTaskPhaseSessionSync) + тесты session.test.mjs.
2. settings.ts (поле/resolve) + commands.ts (parseSetCommand) + тесты.
3. orchestrator.ts (opts, resume-ветка в startPhase, мета в finish) + тесты orchestrator.test.mjs.
4. commands.ts (parseCodeCommand) + handlers.ts (/code, /set) + api.ts (sameSession) + тесты commands.test.mjs.
5. README.md.
6. Финальная проверка: `pnpm build && pnpm test`.

## Как проверить

```bash
pnpm build
pnpm test        # полный прогон (build + vitest)
pnpm test:fast   # итерации, когда dist собран
```

## Риски

- **qwen --resume**: сессия хранится в хранилище qwen (~/.qwen); при её очистке/потере resume падает exit 1 — бот/доска покажут ошибку; повторный обычный /code работает. Принято.
- **Мутация исходной сессии plan**: без --fork-session возобновление дописывает историю план-сессии — повторный /code продолжит её же (докрутка доработок). Это цель фичи, но сессия «план+код» смешивается — упомянуто в README.
- **Мета phase остаётся 'plan'** у возобновлённой сессии (CLI при resume не перезаписывает мету) — find ищет именно plan-сессии, цепочка стабильна; side-effect меты code-фазы не требуется.
- **Гонка mtime** при двух быстрых план-сессиях одной задачи — выбирается последняя; не критично.
- **Без бота** (web-доска): API-параметр sameSession доступен, UI-кнопка не входит в масштаб.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-13 18:26
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Запуск фазы code в той же сессии агента, что и plan» (исходный был обрезан). Масштаб: task. Уточнено: критерии приёмки (настройка включения/выключения режима, явное задание режима параметром команды с переопределением настройки, корректная работа обоих режимов с тестами). Вопросов нет.
---
author: @agent
created: 2026-10-13 22:06
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу. Архитектура: продолжение сессии plan при запуске code через `--resume <planSessionId>` (механизм startResume, VL-93); источник sessionId — меты .vibelog/agent-sessions/*.meta.json (+ оркестратор допишет меты для qwen-сессий по result.session_id в finish()). Настройка code_same_session в .vibelog/settings.json (дефолт off — текущее поведение сохраняется); явные переопределения: /code VL-N --same-session|--no-same-session и sameSession в POST /api/tasks/:id/trigger. Fallback: план-сессия не найдена — обычный новый запуск. Файлов к изменению: 7 (session.ts, orchestrator.ts, settings.ts, commands.ts, handlers.ts, api.ts, README.md) + 4 тестовых файла. Риски: qwen --resume падает при потере локального хранилища сессий qwen (exit 1, виден в боте); возобновление мутит историю план-сессии (это и есть цель — экономия кэша); гонка mtime при двух быстрых план-сессиях (берётся последняя).
---
author: @agent
created: 2026-10-13 22:47
---
Фаза 3 (Code) выполнена. Изменено: src/agent/session.ts (+findTaskPhaseSessionSync — поиск plan-сессии по метам *.meta.json, mtime jsonl), src/web/orchestrator.ts (startPhase 7-й параметр opts.sameSession; ветка --resume в code при настройке/флаге; fallback без план-сессии — обычный запуск + console.log; finish() дописывает мету сессии qwen по result.session_id с realpath cwd — идемпотентно перезаписывает мету vb), src/bot/settings.ts (code_same_session: поле/строгое true при чтении/запись всегда при заданном/resolveCodeSameSession), src/bot/commands.ts (CodeCommand.sameSession, parseCodeCommand вырезает --same-session/--no-same-session до разбора id/комментария, SetCommand code-same-session on|off), src/bot/handlers.ts (/code передаёт parsed.sameSession в startPhase; /set case code-same-session), src/web/api.ts (sameSession из POST trigger body), README.md (раздел «Фаза Code в сессии Plan»), backlog/docs/doc-6 через document_update (таблица /set + раздел VL-147). Тесты: session.test.mjs (5 кейсов find), settings.test.mjs (3), commands.test.mjs (7), orchestrator.test.mjs (6: resume при sameSession=true/настройке, нет при дефолте/false, fallback, мета в finish). Коммит e8462e8 (11 файлов, +544/−25). Проверки: pnpm build + pnpm test — 53 файла, 928 тестов, все проходят. AC 1–3 закрыты. DoD: тесты проходят, документация обновлена (README + doc-6), регрессий нет (полный прогон зелёный; поймана и починена одна E2E-регрессия VL-114 — realpath cwd в мете). Осталось: ревью и close.
---
author: @agent
created: 2026-10-13 22:53
---
Фаза Close прервана: конфликт слияния vb/vl-147 → master (файлы: src/web/orchestrator.test.mjs, статус UU). Остальные файлы слились автоматически, но конфликтный файл оставлен как есть — резолвить самостоятельно запрещено. Разреши конфликт вручную и повтори Фазу Close.
---
author: @agent
created: 2026-10-13 23:03
---
Фаза Close выполнена. Ветка vb/vl-147 слита в master (1 коммит e8462e8; merge-конфликт в src/web/orchestrator.test.mjs разрешён вручную — сохранены обе стороны: тесты VL-141 из master + тесты VL-147 из ветки; merge-коммит c9e17fc). После слияния pnpm build + pnpm test — зелёные (все прогоны, exit 0). Worktree удалена (--force: только untracked-симлинки node_modules/refs), ветка удалена. DoD: тесты проходят (полный прогон после merge), документация обновлена (README + doc-6 из ветки, CHANGELOG — запись Unreleased, коммит 0707bce), регрессий нет. Все AC 1–3 и DoD 1–3 закрыты.
---
<!-- COMMENTS:END -->