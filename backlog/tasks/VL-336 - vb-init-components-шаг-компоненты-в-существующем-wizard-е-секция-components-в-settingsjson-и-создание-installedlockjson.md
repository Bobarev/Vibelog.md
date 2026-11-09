---
id: VL-336
title: 'vb init --components: шаг «компоненты» в существующем wizard-е — секция components в settings.json и создание installed.lock.json'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-05 01:56'
updated_date: '2026-11-09 21:42'
due_date: ''
labels:
  - vb-cli
  - registry
  - init
  - cli
dependencies:
  - VL-333
milestone: v1.13
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/components-config.ts
  - src/core/setup.ts
  - src/cli/commands/init.ts
  - src/cli/commands/init-wizard.ts
  - src/cli/router.ts
  - src/web/setup-api.ts
  - src/cli/init-components.test.mjs
lessons:
  - lesson-218
token_usage:
  input: 5624439
  output: 39253
  cache: 5225984
  total: 5663692
  requests: 89
  duration_ms: 1670174
  reasoning: 19651
  by_phase:
    code:
      input: 4094438
      output: 30729
      cache: 3868160
      requests: 53
    close:
      input: 1530001
      output: 8524
      cache: 1357824
      requests: 36
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Четвёртая задача реализации doc-25 (v1.2, §2.2, §4.2). Расширение существующего wizard-а `vibelog init` шагом «компоненты».

**Контекст.** Отдельной команды `vb init` нет и не будет (решение v1.1): `vibelog init` уже существует — wizard настройки проекта (`src/cli/commands/init.ts`, режимы `fresh`/`upgrade`, флаги `--force`, `--mode`, `--web`, `--yes`). Он создаёт `backlog/`, `config.yml`, `AGENTS.md`, `.env` и пишет `.vibelog/settings.json`. Задача добавляет в него шаг, создающий секцию `components`.

**Зависимость.** Опирается на модуль VL-333 (`src/core/components-config.ts`: `readComponentsConfig`, `writeComponentsConfig`, `readLock`, `writeLock`) — сам wizard ничего не знает о схеме, только вызывает эти функции.

**Что именно добавляется в `settings.json`** (doc-25 §3.1):
```json
{
  "components": {
    "schemaVersion": 1,
    "registries": { "vibelog.md": { "owner": "Vibelog-md", "branch": "master" } },
    "aliases": {
      "components": "src/lib/components",
      "ui": "src/lib/components/ui",
      "utils": "src/lib/utils.ts",
      "css": "src/app.css"
    },
    "lockFile": ".vibelog/installed.lock.json"
  }
}
```
Ключевое: `settings.json` уже содержит `chats`, `models`, `providers`, `workflows`, `mcpServers` — запись только read-modify-write, чужие секции не трогаются (VL-143, VL-329).

**Сложность с интерактивом.** Существующий wizard (`src/cli/commands/init-wizard.ts`) собирает `SetupAnswers`, применяет — `src/core/setup.ts` (`applySetup`). Шаг «компоненты» нужно встроить в обе части и не сломать существующие ветки fresh/upgrade, `--web` и `--no-wizard`. При `--web` (мастер в браузере) в первой версии шаг не поддерживается — секция создаётся по дефолту, это фиксируется в описании.

**Границы.** Задача не реализует `vb install` и не ходит в сеть. Не создаёт новых файлов, кроме `.vibelog/installed.lock.json`.

**Связанные решения:** doc-25 §2.2, §3.1, §4.2, §8 п.6; decision-9 (универсальность `init`, не знает про стек); VL-333 (модуль схем); VL-329 (git-политика, `settings.json` коммитится).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `vb init --components` добавляет секцию `components` в `.vibelog/settings.json` по схеме doc-25 §3.1: `schemaVersion: 1`, `registries: {"vibelog.md": {owner: "Vibelog-md", branch: "master"}}`, четыре алиаса, `lockFile`
- [x] #2 Чужие секции `settings.json` (`chats`, `models`, `providers`, `workflows`, `mcpServers`, `chat_personas` и любые неизвестные) сохраняются без изменений (сравнение распарсенных объектов до/после)
- [x] #3 `--no-components` оставляет `settings.json` нетронутым и не создаёт `installed.lock.json` (поведение до v1.1 сохранено)
- [x] #4 Создаётся `.vibelog/installed.lock.json` со `schemaVersion: 1` и пустым `components`; существующий lock-файл не перезаписывается
- [x] #5 Идемпотентность: повторный `vb init --components` на уже настроенном проекте не меняет существующие `aliases`/`registries`, только дополняет недостающие ключи; файл остаётся байт-в-байт идентичным при полном совпадении
- [x] #6 Флаг `--force` перезаписывает секцию `components` целиком (возврат к дефолтам), но не трогает другие секции `settings.json`
- [x] #7 В интерактивном режиме появляется шаг wizard-а «настроить доставку UI-компонентов?» с дефолтом «да»; отказ оставляет секцию отсутствующей
- [x] #8 В `--yes` без флага `--components` секция создаётся (дефолт «да»), поведение документировано в `--help`
- [x] #9 `vb init --components` не проверяет стек проекта: отсутствие `package.json`, Tailwind или Svelte не является ошибкой (аналог требования decision-9 к `vb init`)
- [x] #10 Алиасы пишутся относительно корня проекта; если в проекте обнаружен `src/lib` — дефолты подставляются от него, иначе используются стандартные пути из doc-25 §3.1
- [x] #11 Итоговый вывод сообщает, что создано/дополнено (секция `components`, lock-файл) и какие значения алиасов записаны
- [x] #12 Тесты: создание с нуля, сохранение чужих секций, идемпотентность (два прогона → файл не изменился), `--force`, `--no-components`, интерактивный отказ, проект без `package.json`
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
**Файлы.** `src/cli/commands/init.ts` (флаги и оркестрация шага), `src/cli/commands/init-wizard.ts` (вопрос wizard-а), `src/core/setup.ts` (применение — `applySetup`), `src/cli/router.ts` (справка). Новых модулей не нужно: вся работа со схемой — через VL-333 (`src/core/components-config.ts`).

**Шаг 1. Флаги.**

1. В `runInit` разобрать `--components` / `--no-components`: взаимоисключающие, одновременная передача → ошибка использования, код `1`. `undefined` = «спросить (в TTY) или дефолт «да» (`--yes`)».
2. В `showCommandHelp`/справку `init` добавить строку `--components | --no-components  Секция доставки UI-компонентов (doc-25)`.

**Шаг 2. Дефолты алиасов.**

3. `defaultComponentsConfig(cwd)` (в `components-config.ts` или рядом с wizard-ом): базовая схема из doc-25 §3.1. Если в проекте есть `src/lib` — `components: 'src/lib/components'`, `ui: 'src/lib/components/ui'`, `utils: 'src/lib/utils.ts'`; иначе те же значения (они не зависят от существования каталога — путь просто не будет создан до первого `vb install`). `css: 'src/app.css'` — детект замены на `src/app.css`/`src/styles/app.css` не делать (вне scope), значение фиксированное.
4. `registries` — всегда `{ 'vibelog.md': { owner: 'Vibelog-md', branch: 'master' } }`; `lockFile` — `.vibelog/installed.lock.json`.

**Шаг 3. Интерактивный шаг wizard-а.**

5. В `runWizard` (после существующих вопросов, до итогового подтверждения) добавить вопрос через `@clack/prompts` (в проекте уже есть обёртка в `src/cli/commands/init-wizard.ts`): «Настроить доставку UI-компонентов (vb install)?» — `p.confirm` с `initialValue: true`. Проверку `p.isCancel` — как у соседних вопросов, выход с кодом `5`.
6. Поле в `SetupAnswers`: `components?: { enabled: boolean }` — необязательное, чтобы не ломать существующие конструкторы ответов в тестах.
7. В `answersFromFlags` (неинтерактивный путь): `enabled = flags.components === true ? true : flags['no-components'] === true ? false : true` (дефолт «да»).

**Шаг 4. Применение.**

8. В `applySetup` после записи текущих настроек: если `answers.components?.enabled` — вызвать `writeComponentsConfig(cwd, mergeWithExisting(defaultComponentsConfig(cwd)))` из VL-333. Слияние — «дополнить недостающее»: существующие `registries`/`aliases` побеждают, если заданы; при `--force` — заменить целиком.
9. `readLock` → `writeLock` только если lock-файла нет (создать `{schemaVersion: 1, components: {}}`); существующий не трогать.
10. В `result.written` добавить строки: `.vibelog/settings.json (секция components)` и `.vibelog/installed.lock.json` — итоговый блок уже умеет их печатать (`formatSetupLog`).
11. `--web` (мастер в браузере): шаг не поддерживается, секция создаётся по дефолту (как `--yes`), в описании задачи и в README зафиксировать. Ветку `--no-wizard` обработать как неинтерактивную.

**Шаг 5. Идемпотентность и защита.**

12. Проверить, что `writeComponentsConfig` из VL-333 не переставляет ключи в `settings.json`: тест — два прогона, файл байт-в-байт идентичен.
13. Не падать, если `settings.json` содержит мусор в неизвестных ключах: read-modify-write должен сохранять их как есть.

**Шаг 6. Тесты.**

14. `src/cli/commands/init-components.test.mjs` (или расширить существующий тест `init`): с нуля → секция создана по схеме, lock-файл создан; чужие секции (`models`, `chats`, `mcpServers`) сохранены.
15. `--no-components` → ни секции, ни lock-файла; `--components --no-components` → код `1`.
16. Идемпотентность: прогон дважды → `settings.json` не изменился после второго.
17. `--force` → секция перезаписана дефолтами, `models`/`chats` на месте.
18. Проект без `package.json` → успех (универсальность `init`, decision-9).
19. Интерактивный отказ (замоканный `p.confirm` → false) → секции нет.

**Риски.**
- `init-wizard.ts` уже большой и содержит несколько веток (`--web`, `--no-wizard`, upgrade-режим) — легко сломать существующее поведение. Тесты на существующие сценарии должны остаться зелёными, изменение добавляется в конец цепочки вопросов.
- `applySetup` вызывается также из веб-мастера (`src/web/setup-api.ts`) — проверить, что добавление поля `components` в `SetupAnswers` не ломает сериализацию ответов API.
- Порядок ключей в `settings.json` (коммитится в git, VL-329): резкое переписывание файла даст шумный diff в истории.
- Дефолт `--yes` = «создать секцию» — это меняет поведение существующей команды для неинтерактивных прогонов; отразить в CHANGELOG.

**Проверка.** `pnpm typecheck && pnpm test`; вручную — `vibelog init --components` в чистом каталоге, затем `git diff` (секция появилась, прочее не тронуто), повторный прогон (diff пустой), `vibelog init --no-components` (ничего не изменилось).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-05 02:45
---
Фаза 3 (Code) выполнена. Коммит 85cd2b2.
**Реализовано:**
- `src/core/components-config.ts` — `defaultComponentsConfig(cwd)` (схема doc-25 §3.1: schemaVersion 1, реестр `vibelog.md`/Vibelog-md/master, четыре алиаса `src/lib/...`, `lockFile: .vibelog/installed.lock.json`) и `mergeComponentsConfig(existing, defaults)` — слияние «дополнить недостающее» (существующие registries/aliases побеждают).
- `src/core/setup.ts` — `SetupAnswers.components?: {enabled}` (необязательное поле, старые конструкторы ответов не ломаются); `applyComponentsStep` после записи текущих настроек: без `--force` — слияние с существующей секцией, при `--force` — перезапись дефолтами; lock-файл пишется только если его нет (существующий → «Пропущено»); битая секция без `--force` → warning и секция не тронута. `formatSetupLog` печатает блок «Компоненты: components=…, ui=…, utils=…, css=…; lock: …» (AC11).
- `src/cli/commands/init.ts` — проверка взаимоисключающих `--components`/`--no-components` (exit 1, ничего не пишется); при `--web` шаг не поддерживается (секция по дефолту, при `--no-components` печатается пояснение).
- `src/cli/commands/init-wizard.ts` — `answersFromFlags`: дефолт «да», `--no-components` → false; в `runWizard` вопрос в конце цепочки `p.confirm('Настроить доставку UI-компонентов (vb install)?', true)`, явный флаг вопрос отменяет; отмена — штатный `PromptCancelledError` (как у соседних вопросов).
- `src/cli/router.ts` — строка справки `--components | --no-components`.
- `src/web/setup-api.ts` — `parseSetupBody` заполняет `components.enabled` (по умолчанию true; `{enabled:false}` из тела уважается) — сериализация ответов веб-мастера не сломана.
**Проверки:** `pnpm typecheck` — чисто; полный `pnpm test` (build + vitest, без --exclude/--skip) — 173 файла / 3292 теста passed, 4 skipped, + второй прогон `static.test.mjs` 8 passed. Новый файл `src/cli/init-components.test.mjs` — 14 кейсов (создание с нуля, сохранение чужих секций включая неизвестные ключи, `--no-components`, конфликт флагов → код 1, идемпотентность байт-в-байт, слияние алиасов, `--force`, неприкосновенность lock-файла, `--yes` без флага, проект без package.json, отказ wizard-а, относительность путей).
Ручная проверка: изолированный прогон CLI в отдельном каталоге — секция и lock-файл созданы, `chats` сохранены, вывод сообщает алиасы.
**Что осталось:** CHANGELOG/документация (doc-7 раздел `init`, doc-25 §2.2) — по правилам фазы пишется в Close. Фиксация в README про `--web` (шаг не поддерживается) — тоже Close.
---
author: @agent
created: 2026-11-05 03:14
---
Фаза Close выполнена. Ветка vb/vl-336 слита в master (1 коммит кода, merge fa597ec; worktree содержал только untracked symlink-каталоги — удалён с --force), worktree и ветка удалены.
**Проверки после merge:** `pnpm build` — чисто. Ранний точечный прогон затронутых diff'ом тестов: `src/cli/init-components.test.mjs` (14 passed), `src/core/setup.test.mjs`, `src/core/components-config.test.mjs`, `src/cli/init-wizard.test.mjs`, `src/cli/init-mcp.test.mjs` (88 passed). Полный `pnpm test` (build + vitest, без --exclude/--skip) — 174 файла / 3328 passed, 4 skipped; второй прогон `src/web/static.test.mjs` — 8 passed. Параллельного vitest в других worktree не было, повторный полный прогон не потребовался.
**DoD:** все три пункта выполнены — тесты проходят (полный прогон выше), документация обновлена (коммит 7ec21df: CHANGELOG «Добавлено» — VL-336, doc-7 раздел `init` — флаги `--components | --no-components`, строка в таблице и пояснение, doc-25 §2.2 — блок «Реализовано в VL-336» с уточнениями по факту реализации), регрессий нет.
**Lessons:** создан lesson-218 («Дополняй секции settings.json слиянием „недостающие ключи"…», tags settings-json/idempotency/cli/init, source VL-336), связан с задачей (коммит e4dc779).
Внешних refs у задачи не было. Единственная незакоммиченная правка вне задачи — `D backlog/docs/doc-25-...v12.md` (удаление v12 при переименовании в v13 из чужой задачи) — не трогал.
---
<!-- COMMENTS:END -->