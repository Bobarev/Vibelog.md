---
id: VL-100
title: '#package Добавить в readme и package'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-06 02:21'
updated_date: '2026-10-06 12:35'
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
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Добавить ссылку на основной репозиторий https://gitverse.ru/bobarev/Vibelog.md в README и в package.json (поле repository).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В package.json добавлено поле repository с URL https://gitverse.ru/bobarev/Vibelog.md
- [x] #2 В README добавлена ссылка на репозиторий https://gitverse.ru/bobarev/Vibelog.md
- [ ] #3 package.json остаётся валидным (JSON парсится, pnpm build проходит)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы для изменения (2 файла)
1. `package.json` — добавить поле `repository`.
2. `README.md` — добавить ссылку на репозиторий.

## Порядок действий

### 1. package.json — после строки `"license": "Unlicense",` (строка ~31)
Вставить сразу после строки `"license": "Unlicense",`:
```json
  "repository": {
    "type": "git",
    "url": "https://gitverse.ru/bobarev/Vibelog.md"
  },
```
Объектная форма — валидна по npm-спеке, явно указывает `type=git`. URL без `.git` — как в AC. Запятая после `"license": "Unlicense",` сохраняется, порядок ключей не меняется.

### 2. README.md — после строки 3 (абзац описания)
Строки 1–5 сейчас: заголовок, пустая, описание, пустая, `## Зачем`. После строки 3 («Markdown-нативный таск-менеджер для git-репозиториев, совместимый с [Backlog.md](https://github.com/MrLesk/Backlog.md).») вставить пустую строку и абзац:
```
Репозиторий: [https://gitverse.ru/bobarev/Vibelog.md](https://gitverse.ru/bobarev/Vibelog.md).
```
Структура разделов README не ломается.

### 3. Способ правки
Правки выполняются патч-скриптом на Node.js (правило AGENTS.md: инструменты write_file/edit отказываются работать с файлами, не прочитанными через read_file в этой сессии; read_file в проекте запрещён). Скрипт `/tmp/patch-vl-100.mjs` (создаётся через write_file, запускается через run_shell_command):
- читает `package.json` и `README.md` через `node:fs`;
- ищет якоря: `"license": "Unlicense",` (ровно 1 вхождение в package.json); абзац описания на строке 3 README.md (ровно 1 вхождение);
- применяет вставки, падает с ошибкой, если якорь не найден или найден неоднократно;
- записывает файлы обратно.

## Проверки (команды)
1. Валидность JSON: `node --input-type=module -e "import {readFileSync} from 'node:fs'; JSON.parse(readFileSync('package.json','utf8')); console.log('JSON ok')"`
2. Поле repository: `node --input-type=module -e "import {readFileSync} from 'node:fs'; const p=JSON.parse(readFileSync('package.json','utf8')); console.log(p.repository?.url)"` → ожидается `https://gitverse.ru/bobarev/Vibelog.md`
3. Ссылки: `grep -n "gitverse.ru/bobarev/Vibelog.md" package.json README.md` → 2 совпадения
4. `pnpm build`
5. `pnpm test` (= build + `node --test src`)
6. `pnpm lint` (проверка bin — регрессия не ожидается, но входит в DoD «нет регрессий»)

## Риски
- `pnpm build`/`pnpm test` требуют установленные devDependencies — при отсутствии node_modules сначала выполнить `pnpm install`.
- Тест `src/cli/diagnostics.test.mjs:26` читает package.json через JSON.parse — новое поле его не ломает (проверено grep-ом), но прогон `pnpm test` обязателен как подтверждение.
- npm-спека: `repository` принимает и object, и string; выбрана object-форма для явного `type=git` — валидность проверяется п.1.
- README.md не входит в `files` package.json — npm/pnpm включают его в tarball автоматически, дополнительная правка `files` не нужна.
- Патч-скрипт: риск промаха якоря/дублей — скрипт обязан завершиться ошибкой, если якорь не найден ровно один раз.
- Изменения только md/json — платформенных рисков (Catalina, нативные модули) нет.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-06 02:21
---
Фаза 1 (Spec) выполнена. Масштаб: task. Уточнено: цель — добавить ссылку на репозиторий https://gitverse.ru/bobarev/Vibelog.md в README и в package.json (поле repository); критерии приёмки — 3 проверяемых пункта (repository в package.json, ссылка в README, валидность package.json/сборка). Описание уточнено, ограничений платформенных нет (изменения только в md/json). Вопросов нет.
---
author: @agent
created: 2026-10-06 02:44
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу: 2 файла — `package.json` (поле `repository` object-формы после `"license"`, строки ~31) и `README.md` (абзац «Репозиторий: ...» после строки 3). Правка — патч-скриптом на Node.js (якоря с проверкой ровно одного вхождения). Проверки: JSON-parse package.json, grep ссылки, `pnpm build`, `pnpm test`, `pnpm lint`. Риски: отсутствие node_modules (нужен `pnpm install`), тест diagnostics.test.mjs читает package.json (новое поле не ломает — проверено), README.md автоматически попадает в npm-tarball (правка `files` не нужна). Изменения только md/json — платформенных рисков нет.
---
author: @agent
created: 2026-10-06 12:21
---
Фаза 3 (Code) выполнена.
## Изменённые файлы
- `package.json` — добавлено поле `repository` (object-форма, `type=git`, `url=https://gitverse.ru/bobarev/Vibelog.md`) сразу после `"license": "Unlicense"` — по плану. Правка к моменту запуска Фазы 3 уже присутствовала в рабочем дереве (верифицирована grep-ом: `package.json:31`).
- `README.md` — добавлен абзац «Репозиторий: [https://gitverse.ru/bobarev/Vibelog.md](...)» после строки описания (строка 5). Также к моменту запуска уже присутствовал (grep: `README.md:5`).
- `src/core/git.test.mjs` — починка существовавших до VL-100 падений: `git init -b` → `git init` + `git checkout -b` (2 места, VL-88/VL-90).
- `src/core/project-settings.test.mjs` — починка падения VL-45: изоляция от `~/.gitconfig` через подмену `HOME` на пустую tmp-директорию (`ISO_HOME`), т.к. `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` на целевом git 2.24.3 (macOS 10.15 Catalina) игнорируются.
## Причина починки тестов
Падения не связаны с изменениями VL-100 — это несовместимость тестового кода со старым Apple Git 2.24.3 на Catalina: флаг `git init -b` появился только в git 2.28, переменные `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` — в git 2.32. Без починки DoD «Тесты проходят»/«Нет регрессий» не закрывалось бы. Правки — патч-скриптами на Node.js (правило AGENTS.md); временные скрипты удалены.
## Проверки
- `node` (JSON-parse package.json) → `JSON ok, repository.url = https://gitverse.ru/bobarev/Vibelog.md`
- `grep "gitverse.ru/bobarev/Vibelog.md"` → 2 совпадения (package.json:31, README.md:5)
- `pnpm build` → OK
- `pnpm test` → **716/716 pass, 0 fail** (до починки было 713/716)
- `pnpm lint` → OK
## Замечания
- `pnpm build`/`pnpm test` выполнялись через node v20.19.0 из nvm: системный `/usr/local/bin/node` (v22.8.0) на Catalina падает с `dyld: Symbol not found: _pwritev`.
- В рабочем дереве присутствуют незакоммиченные изменения, не относящиеся к VL-100 (update-check: `src/cli/update-check.*`, `src/cli/router.ts`, `docs/cli-reference.md`, `templates/qwen-commands/phase-1.md`) — не тронуты, коммит не выполнялся.
- Что осталось: ничего по самой задаче. Пункты AC 1–3 и DoD 1–3 закрыты.
---
author: @agent
created: 2026-10-06 12:35
---
Фаза Close выполнена. Статус: Done. Коммит feat: baab73d — «feat: VL-100 — добавить ссылку на репозиторий в README и package.json» (package.json, README.md, починка тестов под старый git 2.24.3 в src/core/git.test.mjs и src/core/project-settings.test.mjs). Подзадачи в задаче не упомянуты — docs(task)-коммит только по файлу VL-100.
---
<!-- COMMENTS:END -->