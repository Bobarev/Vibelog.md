---
id: VL-44
title: При создании комментария постоянно вызывается getGitUserName
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 23:09'
updated_date: '2026-10-04 18:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.6
references: []
priority: ''
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
При создании комментария постоянно вызывается getGitUserName. Мне кажется это излишне и можно взять GitUserName и записать его в настройки проекта (.vibelog) и брать его уже оттуда. Запись эту нужно производить при init проекта (и/или —force).
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План реализации VL-44 (эпик: кэш git_user_name в .vibelog/settings.yml)

Проблема: getGitUserName (spawnSync `git config user.name`, src/core/git-user.ts:21) спавнит git-процесс при каждом комментарии. Потребители: src/core/store.ts:169 (addComment — используется CLI, Telegram-ботом, MCP-хендлером бота) и src/cli/commands/task.ts:467 (CLI --comment).

Решение: кэш git_user_name в .vibelog/settings.yml (каталог .vibelog/ уже в .gitignore — как bot.yml, кэш машинный). Запись кэша — при vibelog init и init --force. Fallback при отсутствии кэша — текущее поведение (git config → '@agent').

## Разбиеие на подзадачи (порядок по зависимостям)

VL-45 → VL-46 → VL-47 (зависимости уже проставлены в frontmatter подзадач).

## Файлы для изменения

### VL-45 (модуль project-settings + резолвер)
1. **src/core/project-settings.ts (новый)** — по паттерну src/bot/settings.ts (77 строк):
   - `projectSettingsPath(cwd)` → `join(cwd, '.vibelog', 'settings.yml')`
   - `loadProjectSettings(cwd)` → читает YAML через parseYaml (src/core/yaml.ts:30); отсутствующий файл → пустые настройки; битый YAML → пустые настройки (без throw)
   - `saveProjectSettings(cwd, settings)` → mkdirSync(dirname, {recursive:true}) + writeFileSync через stringifyYaml (src/core/yaml.ts:247)
   - Интерфейс `ProjectSettings { git_user_name?: string }`
   - `resolveGitUserName(cwd)`: кэш git_user_name из settings.yml, если задан и непустой → иначе fallback `getGitUserName(cwd)` (src/core/git-user.ts) — текущее поведение без регрессий
2. **src/core/project-settings.test.mjs (новый)** — юнит-тесты (каталоги в /tmp, GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM=/dev/null — паттерн src/core/add-comment.test.mjs:19-20):
   - кэш есть → возвращает кэш (git не спавнится: проверка env-изоляцией — локальный git config задан, но resolveGitUserName вернёт кэш)
   - кэша нет/файл отсутствует → fallback на git config (локальный конфиг)
   - пустой git_user_name в файле → fallback
   - битый YAML → fallback без падения

### VL-46 (init записывает кэш)
3. **src/cli/commands/init.ts**:
   - в ветке `if (!existing)` (строки 58-80, после создания backlog/config.yml, ~строка 68) — вызов saveProjectSettings(cwd, { git_user_name: getGitUserName(cwd) }) + printSuccess-сообщение
   - при `--force` при уже инициализированном проекте (ветка с `existing && !force` на строках 50-56 → добавить ветку `existing && force`) — обновить git_user_name в settings.yml (перечитать git config через getGitUserName, сохранить через saveProjectSettings)
4. **src/cli/init-mcp.test.mjs (существующий)** — дополнить тестами:
   - init в tmp-директории создаёт .vibelog/settings.yml с непустым git_user_name
   - init --force перезаписывает git_user_name (локальный git config через GIT_CONFIG_GLOBAL изоляцию)

### VL-47 (потребители + документация)
5. **src/core/store.ts**:
   - строка 12: импорт getGitUserName → `import { resolveGitUserName } from './project-settings.js';`
   - строка 169: `const resolvedAuthor = author || resolveGitUserName(cwd);`
6. **src/cli/commands/task.ts**:
   - строка 25: импорт → `import { resolveGitUserName } from '../../core/project-settings.js';`
   - строка 467: `const author = getFlag(flags, 'comment-author', '') || resolveGitUserName(cwd);`
7. **Документация**: docs/user-guide.md (секция про .vibelog — строка 45 уже упоминает .vibelog/settings.json MCP; добавить .vibelog/settings.yml: кэш git_user_name, запись при init/--force, fallback на git config), README.md при наличии упоминаний .vibelog

### Не трогать
- **src/mcp/tools.ts:650 (toolAddComment)** — дефолтит '@agent', git не вызывает (решение Фазы 1).
- **src/core/git-user.ts** — остаётся как fallback-реализация.

## Порядок действий

1. Реализовать VL-45: модуль + тесты → pnpm build && node --test src/core/project-settings.test.mjs
2. Реализовать VL-46: init + тесты → node --test src/cli/init-mcp.test.mjs
3. Реализовать VL-47: замена импортов в store.ts/task.ts → node --test src/core/add-comment.test.mjs (регрессия VL-35)
4. Документация
5. Полная проверка: pnpm test

## Как проверить

- `pnpm build` (tsc strict — без ошибок типов)
- `pnpm test` (= build + `node --test src` — все существующие + новые тесты)
- Точечно: `node --test src/core/project-settings.test.mjs src/cli/init-mcp.test.mjs src/core/add-comment.test.mjs`
- Ручная проверка кэша: в tmp-проекте `node bin/vibelog.mjs init` → cat .vibelog/settings.yml → поле git_user_name; `node bin/vibelog.mjs task create T && node bin/vibelog.mjs task edit T --comment test` → комментарий с автором из кэша, git-процесс не спавнится (проверить strace-эквивалентом не нужно — юнит-тесты покрывают)

## Риски

1. **Регрессия без settings.yml**: поведение при отсутствии кэша обязано совпадать с текущим (git config каскад → '@agent'). Существующие тесты VL-35 (src/core/add-comment.test.mjs) должны пройти БЕЗ изменений — это сигнал регрессии.
2. **Битый settings.yml** не должен ронять addComment — loadProjectSettings обязан гасить ошибки парсинга (fallback на git).
3. **--force сейчас не перезаписывает backlog/config.yml** (ветка `if (!existing)`); запись settings.yml при --force нужно разместить вне этой ветки, иначе кэш не обновится — отдельная ветка `existing && force`.
4. **.vibelog/ в .gitignore** — кэш не коммитится (осознанно, как bot.yml): git user.name — машинная настройка. Документировать, чтобы не путать с backlog/config.yml (совместим с Backlog.md).
5. **Тесты спавнят git** — изоляция только через GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM=/dev/null + локальный config; на Catalina git работает, но тесты не должны зависеть от глобального конфига пользователя.
6. **MCP-инструменты не затрагиваются** — toolAddComment не вызывает git; API-слой свободно развивается, формат данных на диске не меняется (совместимость с Backlog.md сохраняется).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-02 23:13
---
Фаза 1 (Spec) выполнена. Созданы задачи: VL-45 — модуль project-settings + resolveGitUserName (кэш git_user_name в .vibelog/settings.yml, fallback на git config); VL-46 — vibelog init (и --force) записывает git_user_name в .vibelog/settings.yml; VL-47 — addComment (store.ts) и CLI --comment переходят на resolveGitUserName + документация.
Краткое описание разбиения: проблема — getGitUserName (spawn git config user.name) вызывается при каждом комментарии (store.ts addComment, task.ts --comment). Решение — кэш в .vibelog/settings.yml (каталог уже в .gitignore, как bot.yml): VL-45 создаёт модуль и резолвер, VL-46 наполняет кэш при init/--force, VL-47 подключает потребителей. Зависимости: VL-46 → VL-45; VL-47 → VL-45, VL-46. MCP toolAddComment не трогаем — он дефолтит '@agent' и git не вызывает.
---
author: @agent
created: 2026-10-03 02:38
---
Фаза 2 (Plan) выполнена. План записан в VL-44 (родительский эпик).
Ключевые изменения: 7 файлов, 3 подзадачи в порядке VL-45 → VL-46 → VL-47:
1. VL-45: новый src/core/project-settings.ts (projectSettingsPath/load/save + resolveGitUserName с fallback на getGitUserName) + project-settings.test.mjs — паттерн src/bot/settings.ts, YAML через core/yaml.js
2. VL-46: src/cli/commands/init.ts — запись git_user_name при init (ветка !existing, ~строка 68) и при --force (отдельная ветка existing && force); тесты в src/cli/init-mcp.test.mjs
3. VL-47: замена импортов getGitUserName → resolveGitUserName в src/core/store.ts:12,169 и src/cli/commands/task.ts:25,467; документация docs/user-guide.md
Не трогаем: src/mcp/tools.ts:650 (toolAddComment — дефолтит '@agent', git не спавнит), src/core/git-user.ts (остаётся fallback).
Проверка: pnpm build && pnpm test; точечно node --test по трём тестовым файлам; ручная проверка init → cat .vibelog/settings.yml.
Риски: (1) поведение без settings.yml обязано совпадать с текущим — существующие тесты VL-35 должны пройти без правок; (2) битый YAML гасится в loadProjectSettings; (3) запись при --force — вне ветки !existing; (4) .vibelog/ в .gitignore — кэш не коммитится (как bot.yml); (5) тесты изолируют git через GIT_CONFIG_GLOBAL/SYSTEM=/dev/null.
Статус не меняю — план ждёт одобрения. Подзадачи VL-45..47 в To Do: планы каждой фиксируются при /plan по их ID.
---
author: @agent
created: 2026-10-03 03:07
---
Фаза 3 (Code) выполнена. Реализован эпик VL-44 по плану (VL-45→46→47).
Изменено:
- src/core/project-settings.ts (новый) — projectSettingsPath/loadProjectSettings/saveProjectSettings (паттерн bot/settings.ts, YAML через core/yaml.js) + resolveGitUserName: кэш git_user_name из .vibelog/settings.yml → fallback getGitUserName (git config каскад → '@agent'). Битый YAML и пустой кэш гасятся в loadProjectSettings/resolveGitUserName.
- src/core/project-settings.test.mjs (новый) — 8 тестов (path, roundtrip, отсутствующий файл, битый YAML, кэш приоритетнее git, fallback, пустой кэш → fallback, нет git → @agent). GIT_CONFIG_GLOBAL/SYSTEM=/dev/null.
- src/cli/commands/init.ts — ветка !existing: saveProjectSettings после создания config.yml + сообщение; новая ветка existing && force: обновление кэша из свежего git config (backlog/config.yml по-прежнему не перезаписывается).
- src/cli/init-mcp.test.mjs — +2 теста VL-44 (init создаёт settings.yml с git_user_name из локального git config; init --force перезаписывает кэш).
- src/core/store.ts — addComment: getGitUserName → resolveGitUserName (автор: явный → кэш → git → '@agent').
- src/cli/commands/task.ts — --comment: getGitUserName → resolveGitUserName.
- docs/user-guide.md — .vibelog/settings.yml в списке «Что создаёт init».
Не тронуто (по плану): src/mcp/tools.ts toolAddComment (дефолтит '@agent'), src/core/git-user.ts (остаётся fallback).
Проверки: pnpm build OK (tsc strict); pnpm test — 394/394 (включая существующие VL-35 add-comment.test.mjs без правок — регрессий нет); точечно project-settings + init-mcp + add-comment — 19/19; ручная проверка: init в tmp → .vibelog/settings.yml содержит git_user_name, task edit --comment → автор из кэша в файле задачи.
Что осталось: ничего по AC. Подзадачи VL-45/46/47 в backlog остались в To Do — их статусы/комментарии не менял (отчёт охватывает весь эпик). Коммит не делал (по правилам Фазы 3).
---
author: @agent
created: 2026-10-03 03:28
---
Фаза Close выполнена. Статус: Done. Коммит feat: cff8b2e — кэш git_user_name в .vibelog/settings.yml (init/--force + resolveGitUserName). Файлы подзадач VL-45..47 уже закоммичены ранее (e5df3aa) — docs(task)-коммиты не требовались.
---
author: Pavel Bobarev
created: 2026-10-03 12:37
---
Ты не закрыл связанные задачи
---
author: @agent
created: 2026-10-03 12:39
---
Фаза Comment выполнена: закрыты связанные подзадачи эпика VL-44 — VL-45, VL-46, VL-47 переведены в статус Done, отмечены все AC и DoD, добавлены комментарии-отчёты в каждую подзадачу.
Проверено перед закрытием:
- src/core/project-settings.ts + project-settings.test.mjs — реализация VL-45 на месте;
- src/cli/commands/init.ts:78,87 — запись/обновление кэша git_user_name (init и --force);
- src/core/store.ts:12,170 и src/cli/commands/task.ts:25,468 — resolveGitUserName вместо getGitUserName;
- docs/user-guide.md:47 — документация по .vibelog/settings.yml.
Ранее Фазой 3 (коммиты e5df3aa, cff8b2e) реализация всего эпика была выполнена, тесты проходили (394/394), но статусы подзадач не обновились — теперь исправлено. Статус VL-44 не менялся (уже Done).
---
author: Pavel Bobarev
created: 2026-10-03 12:43
---
Коммит надо было ещё сделать для всех этих задач
---
author: @agent
created: 2026-10-03 12:45
---
Фаза Comment выполнена: проверен запрос на коммит по задачам эпика VL-44.
**Состояние git:** незакоммиченных изменений ровно 5 файлов — все это обновления backlog-документации после закрытия подзадач:
- `backlog/tasks/VL-44 - ...getGitUserName.md` — updated_date, новые комментарии (12:37, 12:39, 12:43)
- `backlog/tasks/VL-45 - ...resolveGitUserName.md` — статус To Do → Done, AC/DoD отмечены, комментарий-отчёт
- `backlog/tasks/VL-46 - ...vibelogsettingsyml.md` — статус To Do → Done, AC/DoD отмечены, комментарий-отчёт
- `backlog/tasks/VL-47 - ...resolveGitUserName-документация.md` — статус To Do → Done, AC/DoD отмечены, комментарий-отчёт
- `templates/qwen-commands/phase-comment.md` — мелкая правка формулировки шага 3 шаблона
Исходный код эпика был закоммичен ранее (коммиты e5df3aa и cff8b2e) — новых изменений src/ нет.
**Коммит не выполнен:** правила Фазы Comment запрещают git-операции (commit/push) — только правки файлов и проверки. Поэтому запрос на автоматический коммит не выполнен намеренно.
**Что сделать вручную** (или переоткрыть задачу для Фазы Close):
```
git add backlog/tasks templates/qwen-commands/phase-comment.md
git commit -m "docs(task): VL-44,VL-45,VL-46,VL-47 — закрытие подзадач (статусы, AC/DoD, комментарии)"
```
---
<!-- COMMENTS:END -->