---
id: VL-143
title: '#core Создать единый файл настроек settings.json'
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
  - src/core/settings.ts
  - src/core/settings.test.mjs
  - src/core/project-settings.ts
  - src/core/project-settings.test.mjs
  - src/core/store.ts
  - src/bot/settings.ts
  - src/bot/settings.test.mjs
  - src/bot/env.ts
  - src/bot/env.test.mjs
  - src/bot/restart.ts
  - src/bot/restart.test.mjs
  - src/bot/handlers.ts
  - src/bot/commands.ts
  - src/bot/rich.ts
  - src/cli/commands/bot.ts
  - src/cli/commands/init.ts
  - src/cli/commands/task.ts
  - src/cli/router.ts
  - src/cli/init-mcp.test.mjs
  - src/agent/interactive.ts
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - README.md
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Создать единый файл настроек settings.json. Сейчас настройки разнесены между bot.yaml и env-файлом — надо переделать на единый settings.json.

Решения по итогам уточнения:
- bot.yaml удаляется полностью; несекретные настройки хранятся только в settings.json.
- env остаётся только для секретов (токены, API-ключи) и переопределяет settings.json. Поддержать и секцию env внутри settings.json — по образцу Qwen Code (там есть env-секция в settings.json), т.е. секреты можно задавать и там, и в переменных окружения.
- Побочно исправить баг: изменения настроек (settings.json/env) не применялись даже при рестарте бота — после фикса рестарт должен подхватывать новые значения.
- Нужна миграция существующей конфигурации, чтобы бот продолжил работать после перехода.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План реализации (VL-143): единый .vibelog/settings.json

## Архитектурные решения

1. **Файл**: `.vibelog/settings.json` (в gitignored `.vibelog/` — env-секция содержит секреты, коммититься не должна; совпадает с локацией нынешних bot.yml/settings.yml).
2. **Формат** — JSON, ключи — текущие snake_case-имена из bot.yml (минимум изменений для пользователей и docs):
   ```json
   {
     "chats": [],
     "task_type_styles": { "bug": "danger" },
     "default_agent": "qwen",
     "max_wall_time": 1800,
     "max_requests": 50,
     "branch_mode": false,
     "compact": true,
     "git_user_name": "Bob",
     "env": { "TELEGRAM_BOT_TOKEN": "...", "TELEGRAM_PROXY": "..." }
   }
   ```
3. **В settings.json мигрируются ОБА файла**: `.vibelog/bot.yml` (не только bot.yaml — фактически файл называется bot.yml) и `.vibelog/settings.yml` (git_user_name). Иначе рядом появятся settings.yml и settings.json с разным содержимым — путаница.
4. **Секреты**: `telegram_token`/`telegram_proxy` из bot.yml при миграции переезжают в секцию `env` (TELEGRAM_BOT_TOKEN/TELEGRAM_PROXY).
5. **Приоритет секретов**: реальная переменная окружения > `.env` > секция `env` в settings.json > (топ-уровневых секретов больше нет). Порядок применения в `runBot`: `loadDotEnv()` (заполняет только пустые ключи) → `applySettingsEnv()` (заполняет то, что осталось пустым) — реальный env и .env побеждают автоматически.
6. **Баг рестарта — корень**: `spawnReplacementBot` (src/bot/restart.ts:44-57) без явного `env` наследует `process.env` родителя, в котором уже лежат СТАРЫЕ значения из .env (их записал `loadDotEnv` при старте); дочерний `loadDotEnv` по dotenv-семантике не перезаписывает заданные ключи → новые значения .env/settings.json не применяются никогда. **Фикс**: `loadDotEnv` и `applySettingsEnv` записывают в модульный Set загруженные ими ключи; `spawnReplacementBot` по умолчанию спавнит с `process.env` минус эти ключи — дочерний процесс перечитает оба файла свежо. Ключи, реально заданные в shell-окружении, не записываются (loadDotEnv ставит только пустые) и не вычищаются.
7. **API не менять**: публичные экспортные функции `src/bot/settings.ts` и `src/core/project-settings.ts` сохраняют имена/сигнатуры — меняется только бэкенд хранения, поэтому orchestrator/handlers/rich/commands не трогаем (кроме комментариев).

## Файлы для изменения

| # | Файл | Что делаем |
|---|------|-----------|
| 1 | **NEW `src/core/settings.ts`** | Ядро: `settingsPath(cwd)` → `.vibelog/settings.json`; `loadSettings(cwd)` (JSON.parse в try/catch → дефолты + ленивая миграция при отсутствии файла); `migrateLegacyConfig(cwd)`; `saveSettingsPatch(cwd, patch)` (read-modify-write — сохраняет `env` и `git_user_name` при записи бот-полей); `applySettingsEnv(cwd): Set<string>` (заполняет пустые ключи process.env из `env`-секции, возвращает записанные ключи) |
| 2 | `src/bot/settings.ts` | Строка 76 `botSettingsPath` → указывает на settings.json (или заменить на `settingsPath` из core); строки 79-117 `loadBotSettings` — JSON вместо YAML (парсинг полей — те же проверки, строки 86-112 переносятся без изменений логики); строки 126-150 `saveBotSettings` — через `saveSettingsPatch`; строки 152-176 `resolveToken`/`resolveProxy`: `process.env` → секция `env` settings.json (топ-уровневый `telegram_token` убирается из интерфейса BotSettings); удалить импорт `../core/yaml.js`; обновить шапку-комментарий (строки 1-14) |
| 3 | `src/core/project-settings.ts` | `projectSettingsPath` (строка 25) → settings.json; `loadProjectSettings`/`saveProjectSettings` (строки 33-58) читают/пишут `git_user_name` через общий core-модуль; комментарии строк 4, 60 |
| 4 | `src/bot/env.ts` | `loadDotEnv` (строки 20-43): записывать каждый реально записанный ключ в модульный `Set`; экспорт `fileLoadedEnvKeys(): ReadonlySet<string>` |
| 5 | `src/bot/restart.ts` | `spawnReplacementBot` (строки 44-57): если `env` не передан явно — `env = { ...process.env }` минус `fileLoadedEnvKeys()`; JSDoc-строки 36-42 обновить |
| 6 | `src/cli/commands/bot.ts` | Строка 30: после `loadDotEnv(cwd)` вызвать `applySettingsEnv(cwd)`; строка 34 (текст ошибки «…в .vibelog/bot.yml») → «TELEGRAM_BOT_TOKEN в .env или секции env .vibelog/settings.json» |
| 7 | `src/agent/interactive.ts` | Строка 58: после `loadDotEnv(cwd)` вызвать `applySettingsEnv(cwd)` (VIBELOG_LLM_* могут жить в env-секции) |
| 8 | `src/cli/commands/init.ts` | Строки 79, 88: текст «Кэш git user.name записан: .vibelog/settings.yml» → `.vibelog/settings.json` |
| 9 | `src/cli/router.ts` | Строки 248-249 help-текста bot: bot.yml → settings.json |
| 10 | Комментарии-упоминания | `src/bot/handlers.ts:5,382,563,607`; `src/bot/commands.ts:292`; `src/bot/rich.ts:413`; `src/web/orchestrator.ts:241-256,381` — bot.yml → settings.json |
| 11 | Тесты | `src/bot/settings.test.mjs` (267 стр): фикстуры YAML → JSON, telegram_token → env-секция, новый describe на миграцию; `src/core/project-settings.test.mjs` (99 стр): путь/round-trip через settings.json; `src/cli/init-mcp.test.mjs:119-135`: `readCachedGitUser` читает settings.json; `src/web/orchestrator.test.mjs` (~10 мест: 498, 739, 824, 869, 897, 1025, 1102, 1133, 1309): фикстуры `bot.yml` → `settings.json`; `src/bot/env.test.mjs`: учёт загруженных ключей; `src/bot/restart.test.mjs`: спавн без файловых ключей в env |
| 12 | Документация | `README.md:232` (bot.yml → settings.json); `backlog/docs/doc-6` (6 упоминаний), `doc-10` (4), `doc-1` (2) — **через MCP document_update**, не файловыми правками; CHANGELOG — в code-фазе |

## Порядок действий

1. **Новый `src/core/settings.ts`** + его тест `src/core/settings.test.mjs`: load/save, env-секция, миграция (bot.yml+settings.yml → settings.json, после успешной записи — удаление legacy-файлов; битый YAML/JSON → дефолты без падения).
2. **Перевести `src/bot/settings.ts` и `src/core/project-settings.ts`** на новый бэкенд, сохранив экспортный API.
3. **env.ts + restart.ts — фикс бага**: учёт файловых ключей + стриппинг при спавне.
4. **Точки вызова**: bot.ts, interactive.ts (applySettingsEnv), init.ts, router.ts (тексты).
5. **Обновить все тесты** (fixture-миграция), добить новые кейсы: миграция, приоритет env, рестарт подхватывает новые значения.
6. **Комментарии** в handlers/commands/rich/orchestrator.
7. **Документация**: README + doc-6/doc-10/doc-1 через MCP.

## Как проверить

```bash
pnpm build && pnpm test          # полный прогон (build + vitest)
# Ручная проверка миграции:
mkdir -p /tmp/mig/.vibelog && printf 'chats: [1]\ntelegram_token: tok\n' > /tmp/mig/.vibelog/bot.yml
node -e "import('./dist/core/settings.js').then(m=>m.loadSettings('/tmp/mig'))"
# → /tmp/mig/.vibelog/settings.json существует, env.TELEGRAM_BOT_TOKEN=tok, bot.yml удалён
# Ручная проверка бага рестарта: в tmp-проекте .env с KEY=old → loadDotEnv → поменять на new →
# spawnReplacementBot без явного env → дочерний процесс видит KEY=new
```

## Риски

- **Удаление legacy-файлов при миграции** — небезописасно: удалять ТОЛЬКО после успешной записи settings.json и его контрольного перечитывания; при сбое — оставить старые файлы и вернуться к дефолтам.
- **Оркестратор и бот спавнят фазы с `process.env`** (orchestrator.ts:298, baseEnv) — там файловые ключи уже применены к родителю, спавнится как раньше; стриппинг нужен ТОЛЬКО для замещающего процесса бота (restart.ts). Не спутать.
- **Фикстуры orchestrator.test.mjs** — ~10 мест пишут bot.yml; при ошибке миграции тесты упадут с confusing-сообщениями — обновить все разом.
- **`.qwen/settings.json`** (MCP-конфиг Qwen Code, init.ts:161) — НЕ трогать: это файл Qwen, не Vibelog.
- **Приоритет секретов**: если применить settingsEnv ДО loadDotEnv — .env проиграет settings.json (обе функции ставят только пустые ключи). Порядок строго: loadDotEnv → applySettingsEnv.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-13 14:36
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен (в нём опечатка «Содать» → «Создать» — исправлю после уточнений). Масштаб: не определён (описание неполное). Жду ответов на вопросы:
### 1. Что происходит с bot.yaml и env после перехода на settings.json?
- [ ] Полный переход: bot.yaml удаляется, env больше не читается, данные мигрируются автоматически
- [ ] bot.yaml удаляется, env остаётся только для секретов (переопределяет settings.json)
- [ ] settings.json добавляется поверх существующих, bot.yaml и env продолжают работать
- [ ] Другое → 
### 2. Секреты (токены, API-ключи) — как хранить после перехода?
- [ ] Всё в settings.json, секреты тоже
- [ ] Секреты только в env, в settings.json — только несекретные настройки
- [ ] Другое → 
### 3. Баг «изменения в env не применяются даже при рестарте» — какая ожидаемая семантика после исправления?
- [ ] env переопределяет settings.json при каждом старте бота
- [ ] env упраздняется полностью — баг исчезает вместе с ним
- [ ] Другое → 
### Дополнительные комментарии
→ Уточни, пожалуйста, к какому боту/репозиторию относится задача и что именно сейчас хранится в bot.yaml vs env — от этого зависит, нужна ли миграция.
---
author: @agent
created: 2026-10-13 15:48
---
Фаза 1 (Spec) выполнена по ответам пользователя. Заголовок: изменён на «#core Создать единый файл настроек settings.json» (исправлена опечатка + уточнено). Масштаб: task. Уточнено: bot.yaml удаляется, несекретные настройки — в settings.json; секреты — в env (переопределяет settings.json) + поддержка секции env внутри settings.json по образцу Qwen Code; попутно исправить баг неприменения новых настроек при рестарте; нужна миграция существующей конфигурации. Описание дополнено, критерии приёмки зафиксированы. Статус → Spec. Вопросов нет.
---
author: @agent
created: 2026-10-13 18:13
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: целевой файл `.vibelog/settings.json` (JSON, snake_case-ключи, секция `env` по образцу Qwen Code); миграция обоих legacy-файлов (bot.yml + settings.yml → settings.json, telegram_token/telegram_proxy → env-секция, удаление legacy после успешной записи); приоритет секретов: реальный env > .env > env-секция settings.json; фикс бага рестарта — loadDotEnv/applySettingsEnv учитывают записанные ключи, spawnReplacementBot спавнит без файловых ключей, чтобы дочерний процесс перечитал файлы; публичный API src/bot/settings.ts и src/core/project-settings.ts сохраняется — orchestrator/handlers не переписываются. Файлов: 1 новый (src/core/settings.ts) + 11 к правке (settings, project-settings, env, restart, bot, interactive, init, router, комментарии ×4) + 7 тестовых + документация (README, doc-6/10/1 через MCP). Риски: удаление legacy-файлов только после контрольного перечитывания; стриппинг env только для замещающего процесса бота (не для спавна фаз); порядок loadDotEnv → applySettingsEnv критичен для приоритета .env; фикстуры orchestrator.test.mjs (~10 мест) перевести на settings.json разом; .qwen/settings.json не трогать.
---
author: @agent
created: 2026-10-13 19:15
---
Фаза 3 (Code) выполнена. Коммит `9e9bfa0` (ветка vb/vl-143).
**Что сделано (по плану):**
- **NEW `src/core/settings.ts`** — ядро: `settingsPath` → `.vibelog/settings.json`; `loadSettings` (JSON.parse в try/catch → дефолты + ленивая миграция); `migrateLegacyConfig` (bot.yml + settings.yml → settings.json, `telegram_token`/`telegram_proxy` → env-секция, удаление legacy ТОЛЬКО после контрольного перечитывания; при сбое — битый settings.json удаляется, legacy остаётся); `saveSettingsPatch` (read-modify-write, `undefined` удаляет ключ, env/git_user_name сохраняются); `applySettingsEnv` (заполняет только пустые ключи, возвращает записанные) + учёт файловых ключей `fileLoadedEnvKeys`/`registerFileEnvKeys`.
- **`src/bot/settings.ts`** — бэкенд на core-модуль, JSON вместо YAML; топ-уровневый `telegram_token`/`telegram_proxy` убраны из `BotSettings` — `resolveToken`/`resolveProxy`: env → env-секция settings.json. Публичный API (имена/сигнатуры) сохранён — orchestrator/handlers не переписывались.
- **`src/core/project-settings.ts`** — тот же общий бэкенд, `projectSettingsPath` → settings.json.
- **Фикс бага рестарта:** `loadDotEnv` регистрирует записанные ключи; `spawnReplacementBot` без явного env спавнит `process.env` минус файловые ключи → дочерний процесс перечитывает .env/settings.json и подхватывает новые значения. Shell-ключи не стриппятся.
- **Точки вызова:** `bot.ts` и `interactive.ts` — `loadDotEnv` → `applySettingsEnv` (порядок критичен: .env приоритетнее env-секции); тексты ошибок/help/init (router, init, bot) переведены на settings.json; комментарии в handlers/commands/rich/orchestrator/store/task.
- **Тесты (+46 к прежним):** NEW `src/core/settings.test.mjs` (12: load/save/patch/env-секция/миграция/битые файлы); `settings.test.mjs` (JSON-фикстуры, секреты через env-секцию); `project-settings.test.mjs`, `init-mcp.test.mjs`, `orchestrator.test.mjs` (~10 фикстур → settings.json); `env.test.mjs` (учёт файловых ключей); `restart.test.mjs` (2 новых: дочерний процесс не наследует файловый ключ / наследует shell-ключ).
**Проверки:** `pnpm build` ✓; `pnpm test` — **53 файла / 888 тестов зелёные** ✓; ручная проверка миграции (tmp-проект: bot.yml+settings.yml → settings.json с env.TELEGRAM_BOT_TOKEN и git_user_name, legacy удалены) ✓.
**Осталось / примечания:**
- Документы `backlog/docs/doc-6`, `doc-10`, `doc-1` НЕ обновлялись — по правилам Фазы 3 документацию backlog/docs пишет Фаза Close (VL-126); README.md (вне backlog/) обновлён. CHANGELOG также отложен на Фазу Close.
- Регрессий не найдено: спавн фаз оркестратором по-прежнему с `process.env` без стриппинга (стриппинг только для замещающего процесса бота).
- В ходе прогона были разовые флаки CLI-тестов (таймауты спавнов при параллелизме) — на контрольных повторных прогонах стабильно зелёные.
---
author: @agent
created: 2026-10-13 20:07
---
Фаза Close выполнена. Ветка vb/vl-143 слита в master (1 коммит 9e9bfa0, merge без конфликтов), сборка и тесты после merge зелёные (pnpm build ✓, pnpm test ✓ — 53 файла / 888 тестов), worktree .vibelog/worktrees/vl-143 удалена (в worktree были только untracked-симлинки node_modules/refs → --force), ветка vb/vl-143 удалена. Документация: CHANGELOG.md (запись VL-143 в Unreleased), doc-6/doc-10/doc-1 обновлены через MCP (bot.yml/settings.yml → settings.json, env-секция, фикс бага рестарта); README уже обновлён в Фазе 3. Docs-коммит a66a561 (в него попали и ранее незакоммиченные правки doc-6 от VL-145/VL-110 — они лежали в рабочем каталоге до Фазы Close). DoD: 1 — тесты проходят (888 зелёные после merge), 2 — документация обновлена (README + CHANGELOG + doc-6/10/1), 3 — регрессий не найдено (публичный API сохранён, спавн фаз оркестратора без стриппинга).
---
<!-- COMMENTS:END -->