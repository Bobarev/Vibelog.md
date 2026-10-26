---
id: VL-189
title: Исправить отсутствие VIBELOG_LLM_API_KEY при запуске spec в режиме browser
status: Done
assignee: []
reporter: ''
created_date: '2026-10-26 08:04'
updated_date: '2026-10-26 09:09'
due_date: ''
labels:
  - agent
  - web
  - bot
dependencies: []
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/bot/env.ts
  - src/agent/llm-env.ts
  - src/cli/commands/bot.ts
  - src/cli/commands/browser.ts
  - src/cli/router.ts
  - src/cli/commands/agent.ts
  - src/agent/interactive.ts
  - src/agent/cli.ts
  - src/web/orchestrator.ts
  - src/bot/env.test.mjs
  - src/cli/cli.test.mjs
  - src/web/orchestrator.test.mjs
  - src/agent/cli.test.mjs
  - README.md
lessons:
  - lesson-44
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Ошибка: не задан VIBELOG_LLM_API_KEY — агенту нужен доступ к LLM (env VIBELOG_LLM_BASE_URL/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL)

В режиме browser при запуске фазы spec

Нужно ещё раз проверить весь код на дублирование! Режимы бота и браузера должны работать одинаково и видимо задача VL-180 не решила полностью эту проблему.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Запуск фазы spec в режиме browser не падает с ошибкой «не задан VIBELOG_LLM_API_KEY»: переменные VIBELOG_LLM_BASE_URL/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL пробрасываются из окружения в процесс агента при их наличии, а при отсутствии выводится понятное сообщение об ошибке
- [x] #2 Чтение и проброс LLM-окружения при запуске фаз устранены от дублирования: режимы бота и браузера используют общий код (VL-180 доведена до конца)
- [x] #3 Тесты проходят, добавлены проверки проброса LLM-окружения для обоих режимов; нет регрессий в боте и веб-интерфейсе
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План VL-189 — фикс VIBELOG_LLM_API_KEY в режиме browser + дедупликация env-кода

## Корневая причина (проверено по коду)

`runBot` (src/cli/commands/bot.ts:31-34) вызывает `loadDotEnv(cwd)` + `applySettingsEnv(cwd)` при старте → `process.env` содержит `VIBELOG_LLM_*` → оркестратор (spawnQwenRun, src/web/orchestrator.ts:782 `env: spawnEnv ?? baseEnv()`, baseEnv = process.env) наследует их при спавне агента.

`runBrowser` (src/cli/commands/browser.ts:14-33) этих вызовов НЕ делает → при прямом запуске `vibelog browser` (без экспорта переменных в shell) spawn агента идёт без LLM-ключей → src/agent/cli.ts:258 падает с «не задан VIBELOG_LLM_API_KEY».

Путь `/web start` из бота работает случайно: дочерний процесс наследует уже загруженный env бота.

### Найденное дублирование (аудит)
1. Пара `loadDotEnv(cwd); applySettingsEnv(cwd)` продублирована в bot.ts:31-34 и interactive.ts:98-101; в browser.ts отсутствует (баг).
2. Валидация LLM-env (VIBELOG_LLM_API_KEY + VIBELOG_LLM_MODEL + тексты ошибок) продублирована в agent/cli.ts:257-268 и agent/interactive.ts:104-113.
3. `vibelog agent analyze` (src/cli/commands/agent.ts) спавнит фазу analyze без загрузки env проекта — та же класс бага (analyze с vb-агентом упадёт без экспорта ключей).
4. Запуск фаз бота/веба уже общий (startTaskPhase, VL-180) — там дублирования нет; default_agent тоже общий.

## Файлы для изменения (13-14 шт.)

### Исходники (9)

1. **src/bot/env.ts** (66 строк) — добавить общий хелпер в конец файла:
   ```ts
   /** Общая загрузка env проекта (VL-189): .env → секция env settings.json. */
   export function loadProjectEnv(cwd: string): void {
     loadDotEnv(cwd);        // порядок критичен (VL-143): обе функции пишут только пустые ключи
     applySettingsEnv(cwd);  // → реальный env → .env → settings.json
   }
   ```
   - Строка 16: расширить импорт из `../core/settings.js` — добавить `applySettingsEnv`.

2. **src/agent/llm-env.ts** — НОВЫЙ модуль: общая валидация LLM-env:
   ```ts
   /** Проверка LLM-env (VL-189): false + сообщение в stderr, если ключ/модель нет. */
   export function ensureLlmEnv(subject: string): boolean
   ```
   - Тексты СОХРАНИТЬ дословно из текущих мест (иначе сломаются матчи тестов):
     - `Ошибка: не задан VIBELOG_LLM_API_KEY — ${subject} нужен доступ к LLM (env VIBELOG_LLM_BASE_URL/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL)` — subject: `'агенту'` (cli.ts) / `'чату с агентом'` (interactive.ts);
     - `Ошибка: не задана VIBELOG_LLM_MODEL — модель LLM неизвестна`.
   - Подробные JSDoc/комментарии на русском (обязательны).

3. **src/cli/commands/bot.ts** — строки 11-12/31-34: заменить пару вызовов на один `loadProjectEnv(cwd)`; убрать ставший ненужным импорт `applySettingsEnv` (строка 12), импорт из bot/env — на `loadProjectEnv`. Вызов остаётся ДО `resolveToken` (токен из .env должен находиться).

4. **src/cli/commands/browser.ts** — ФИКС БАГА:
   - Добавить импорт `loadProjectEnv` из `../../bot/env.js`;
   - Перед `startWebServer(...)` (строка 31) — `loadProjectEnv(cwd);` с комментарием «VL-189: как у бота — .env/settings-env читаются при старте, иначе spawn фаз без VIBELOG_LLM_*»;
   - Для тестируемости: изменить возврат `Promise<void>` → `Promise<Server>` (вернуть `startWebServer(...)`, он уже возвращает Server — src/web/server.ts:33).

5. **src/cli/router.ts** — строка 84: `return runBrowser(...)` → `await runBrowser(...); return;` (тип route = Promise<void, прямой return Server не типизируется).

6. **src/cli/commands/agent.ts** — в начало `runAgent` (строка ~40, после объявления cwd-параметра): `loadProjectEnv(cwd);` с комментарием (VL-189: analyze спавнит агента из этого процесса; для чата двойная загрузка идемпотентна — dotenv-семантика). Импорт из `../../bot/env.js`.

7. **src/agent/interactive.ts** — строки 26-27, 98-113:
   - Заменить пару `loadDotEnv` + `applySettingsEnv` на `loadProjectEnv(cwd)` (импорт из `../bot/env.js`);
   - Заменить блоки проверок (104-113) на `if (!ensureLlmEnv('чату с агентом')) { process.exitCode = 1; return; }` (импорт из `./llm-env.js`); убрать прямой импорт `applySettingsEnv`.

8. **src/agent/cli.ts** — строки 257-268: заменить обе проверки на `if (!ensureLlmEnv('агенту')) { process.exitCode = 1; return; }` (импорт `./llm-env.js`).

9. **src/web/orchestrator.ts** — комментарий строк 741-743: уточнить, что `.env` теперь грузят и бот, и браузер через общий `loadProjectEnv` (VL-189).

### Тесты (4)

10. **src/bot/env.test.mjs** — новый describe «loadProjectEnv (VL-189)» (паттерн save/restore env уже есть в файле):
    - заполняет `VIBELOG_LLM_API_KEY` из `.env` temp-cwd;
    - приоритет: реальный env > `.env` > секция `env` settings.json (порядок вызовов);
    - отсутствие обоих файлов — не ошибка; реестр file-keys регистрируется (для VL-143 restart).

11. **src/cli/cli.test.mjs** — новый describe «VL-189: env проекта при запуске бота и браузера» (файл уже импортирует route, имеет helpers):
    - **Бот**: temp-cwd с `.env` (VIBELOG_LLM_API_KEY=from-file), `delete process.env.TELEGRAM_BOT_TOKEN` и `delete process.env.VIBELOG_LLM_API_KEY` (save/restore!) → `await runBot([], {}, tmpCwd)` → токена нет → ранний возврат «Токен не найден» (без сети) → `assert process.env.VIBELOG_LLM_API_KEY === 'from-file'`;
    - **Браузер**: тот же temp-cwd → `const server = await runBrowser([], { port: '0', 'no-open': true }, tmpCwd)` → assert env заполнен → `server.close()` → restore env в finally.

12. **src/web/orchestrator.test.mjs** — проброс до процесса агента (общий для обоих режимов спавн):
    - в `writeEnvStub` (строка 1045) добавить запись `envLlmKey: process.env.VIBELOG_LLM_API_KEY || null`;
    - новый тест рядом с VL-114 (~строка 1080): `setStubEnv({ ..., VIBELOG_LLM_API_KEY: 'llm-from-base' })` → `startPhase` → waitDone → маркер содержит `envLlmKey === 'llm-from-base'`.

13. **src/agent/cli.test.mjs** — существующий тест «без VIBELOG_LLM_API_KEY» (строка 170) остаётся регрессией на ensureLlmEnv; ДОПОЛНИТЕЛЬНО: тест «без VIBELOG_LLM_MODEL → stderr с VIBELOG_LLM_MODEL, exit 1» (если не покрыто — сейчас покрыт только в llm.test.mjs через createLlmClient, а не через CLI).

### Документация (1)

14. **README.md** — строка ~267 (раздел «Агент Vibelog»): дополнить предложение, что `.env` проекта и секция `env` settings.json читаются автоматически при запуске `vibelog bot`, `vibelog browser` и `vibelog agent` (VL-189).

## Порядок действий

1. `src/bot/env.ts`: `loadProjectEnv` (+ импорт `applySettingsEnv`).
2. `src/agent/llm-env.ts`: `ensureLlmEnv` (новый файл).
3. Точки входа: bot.ts → browser.ts (+router) → agent.ts → interactive.ts → agent/cli.ts.
4. Комментарий orchestrator.ts.
5. Тесты: env.test.mjs → cli.test.mjs → orchestrator.test.mjs → cli.test.mjs (agent).
6. README.md.
7. Проверки.

## Как проверить

```bash
pnpm build
pnpm exec vitest run src/bot/env.test.mjs src/cli/cli.test.mjs src/web/orchestrator.test.mjs src/agent/cli.test.mjs
pnpm test          # полный прогон (build + vitest)
```

Ручной smoke (AC1): во временный проект с `.env` (VIBELOG_LLM_*) и без экспорта в shell → `vibelog browser --no-open --port 0` → POST `/api/tasks/:id/trigger?phase=spec` → фаза стартует без ошибки «не задан VIBELOG_LLM_API_KEY».

## Риски

- **process.env в тестах** (fileParallelism + isolate:false): мутации только с save/restore в finally — паттерн уже есть в env.test.mjs; утечка `VIBELOG_LLM_*`/`TELEGRAM_BOT_TOKEN` в соседние тесты воркера — главный риск, купировать save/restore.
- **Порядок loadDotEnv → applySettingsEnv критичен** (VL-143 приоритет секретов) — сохранить в loadProjectEnv; не менять семантику «пишем только пустые ключи» (реестр file-keys нужен restart-стриппингу, src/bot/restart.ts).
- **runBrowser → Promise<Server>**: правка router (await) + TS strict; других вызовов runBrowser нет (grep: только router.ts:84).
- **Точные тексты ошибок** LLM-env: cli.test.mjs:176 матчит `/VIBELOG_LLM_API_KEY/` — сохранить формулировки дословно.
- **Двойная загрузка env** (runAgent + runInteractiveAgent) — идемпотентна (dotenv не перезаписывает); не раздувать scope, вынося загрузку только в runAgent.
- `/web start`: дочерний browser наследует env бота + сам читает .env — идемпотентно, поведение не меняется (нет регрессии VL-161).
- Регрессии VL-180 не ожидаются: startTaskPhase/phase-buttons/default_agent не трогаются.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-26 08:06
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Исправить отсутствие VIBELOG_LLM_API_KEY при запуске spec в режиме browser». Тип: bug. Масштаб: task. Приоритет: High (ошибка блокирует запуск фазы spec в режиме browser). Уточнено: цель — фикс проброса LLM-окружения (VIBELOG_LLM_BASE_URL/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL) в режиме browser + устранение остаточного дублирования между режимами бота и браузера (VL-180 решила часть проблемы: общий хелпер запуска phase и phase-buttons, но LLM-env пробрасывается по-разному). Контекст: VL-180 (Done) — «В режиме браузера не используются настройки проекта». Labels: agent, web, bot. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-26 08:46
---
Фаза 2 (Plan) выполнена. Тип: bug. План записан в Implementation Plan. Корневая причина: runBrowser (src/cli/commands/browser.ts) не вызывает loadDotEnv/applySettingsEnv при старте — в отличие от runBot (bot.ts:31-34), поэтому spawn фазы из browser идёт без VIBELOG_LLM_* из .env/settings.json и агент (agent/cli.ts:258) падает с «не задан VIBELOG_LLM_API_KEY»; путь /web start из бота работал случайно (наследование env бота). Аудит дублирования: (1) пара loadDotEnv+applySettingsEnv продублирована в bot.ts и interactive.ts и отсутствует в browser.ts → вынос в общий loadProjectEnv (src/bot/env.ts); (2) валидация LLM-env с дословными текстами ошибок продублирована в agent/cli.ts:257-268 и interactive.ts:104-113 → общий ensureLlmEnv (новый src/agent/llm-env.ts); (3) vibelog agent analyze спавнит фазу без загрузки env — та же класс бага, покрыта; (4) запуск фаз бота/веба уже общий (startTaskPhase VL-180) — дублирования нет. Файлов: 14 (9 src — env.ts, llm-env.ts(новый), bot.ts, browser.ts, router.ts, agent.ts, interactive.ts, cli.ts, orchestrator(коммент); 4 тест-файла; README). Проверки: pnpm build + targeted vitest (env/cli/orchestrator/agent-cli тесты) + pnpm test; ручной smoke — browser + .env без экспорта в shell → trigger spec без ошибки. Риски: save/restore process.env в тестах (fileParallelism), сохранение порядка loadDotEnv→applySettingsEnv (VL-143) и дословных текстов ошибок (матчи тестов), смена типа возврата runBrowser на Promise<Server> (правка router). References: нет.
---
author: @agent
created: 2026-10-26 09:00
---
Фаза 3 (Code) выполнена. Изменено: src/bot/env.ts (+ общий loadProjectEnv = loadDotEnv→applySettingsEnv, порядок VL-143 сохранён), src/agent/llm-env.ts (новый: ensureLlmEnv с дословными текстами ошибок), src/cli/commands/bot.ts (пара вызовов → loadProjectEnv), src/cli/commands/browser.ts (ФИКС: loadProjectEnv при старте + возврат Promise<Server> для тестируемости), src/cli/router.ts (await runBrowser), src/cli/commands/agent.ts (loadProjectEnv — analyze-спавн тоже покрыт), src/agent/interactive.ts и src/agent/cli.ts (пары env-проверок → общий ensureLlmEnv), src/web/orchestrator.ts (комментарий VL-189), тесты: src/bot/env.test.mjs (+describe loadProjectEnv: приоритеты и file-keys), src/cli/cli.test.mjs (+2 теста: runBot и runBrowser читают .env, save/restore env), src/web/orchestrator.test.mjs (+writeEnvStub envLlmKey, тест наследования VIBELOG_LLM_API_KEY spawn-ом), src/agent/cli.test.mjs (+тест «без VIBELOG_LLM_MODEL»), README.md (авточтение .env для bot/browser/agent). Коммит 150d4e9 (14 файлов, ветка vb/vl-189; backlog/ не коммитился). Проверки: pnpm build (tsc strict, 0 ошибок); целевые vitest (env/cli/orchestrator/agent-cli) — зелёные; полный pnpm test — 71 файл, 1261 passed / 4 skipped, 0 падений (нет регрессий бота и веба). Что осталось: ручной smoke (browser + .env → trigger spec) не выполнялся — механистика (загрузка env браузером + наследование spawn-ом + понятная ошибка при отсутствии) покрыта автотестами; ручной smoke возможен в Review/Close. Источники (references) не использовались; lessons не создавались (применён lesson-37 — вынос общей логики в общий модуль).
---
author: @agent
created: 2026-10-26 09:09
---
Фаза Close выполнена. Ветка vb/vl-189 слита в master (1 коммит 150d4e9 + merge, 14 файлов), worktree удалена (в worktree были только untracked-симлинки node_modules/refs — удалена с force), ветка удалена. После merge: pnpm build (0 ошибок tsc strict) и pnpm test — полный прогон зелёный (нет регрессий). DoD: все 3 пункта выполнены (тесты — полный прогон зелёный; документация — README в ветке + CHANGELOG/doc-6/doc-7 обновлены, коммит 19bc3ba; регрессий нет — build+test после merge). Lessons: lesson-37 дополнена связью VL-189, создан lesson-44 (новая CLI-точка входа первой строкой вызывает loadProjectEnv) — коммит c0a147e. Ручной smoke (browser + .env → trigger spec) не выполнялся: механистика покрыта автотестами (env/cli/orchestrator/agent-cli).
---
<!-- COMMENTS:END -->