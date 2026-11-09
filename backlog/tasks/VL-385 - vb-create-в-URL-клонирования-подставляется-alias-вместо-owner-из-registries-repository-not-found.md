---
id: VL-385
title: 'vb create: в URL клонирования подставляется alias вместо owner из registries — repository not found'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-09 17:19'
updated_date: '2026-11-09 17:43'
due_date: ''
labels:
  - vb-cli
  - templates
  - create
  - bug
  - blocker
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
  - src/core/create.ts
  - src/core/create.test.mjs
lessons:
  - lesson-266
token_usage:
  input: 3651171
  output: 37256
  cache: 3181056
  total: 3688427
  requests: 77
  duration_ms: 1096718
  reasoning: 24407
  by_phase:
    code:
      input: 2086479
      output: 28152
      cache: 1800192
      requests: 40
    close:
      input: 1564692
      output: 9104
      cache: 1380864
      requests: 37
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
`vb create` не может клонировать шаблон — в URL подставляется **alias реестра** вместо **owner**.

**Симптом:**
```
✗ git clone: Клонирование в «/var/folders/.../vb-create-WEjkFh»...
  | fatal: repository 'https://gitverse.ru/vibelog.md/templates.git/' not found
```

**Причина** — `src/core/create.ts:583`:
```ts
const { alias, repo, template } = parseTemplatePath(options.template);
// …
const cloned = cloneTemplate({
  owner: alias,   // ← здесь
  repo,
```

Путь шаблона `vibelog.md/templates/svelte-minimal` разбирается на alias `vibelog.md`, repo `templates`, template `svelte-minimal`. Дальше `cloneInto` строит URL:
```ts
`${baseUrl}/${options.owner}/${options.repo}.git`   // → gitverse.ru/vibelog.md/templates.git
```
Но `vibelog.md` — это **ключ в `registries`**, а настоящий owner репозитория — `Vibelog-md` (значение `registries['vibelog.md'].owner`). Отсюда 404.

**Почему так вышло.** Для `vb install` alias и owner различаются явно: `resolveInstallContext` читает `registries[alias]` и берёт `owner` оттуда. В `vb create` ту же модель не довели: alias подставили в поле `owner` напрямую, а `registries` прочитали только для ветки (`resolveTemplateBranch`). Две команды по-разному понимают одно и то же поле.

**Что нужно.** Резолвить owner так же, как это делает `vb install` — из `registries[alias].owner`. Отсутствие секции или alias — понятная ошибка с кодом 2 и подсказкой, а не попытка клонировать по alias (иначе пользователь видит «repository not found», хотя проблема в настройках).

**Границы.** Задача не меняет формат пути шаблона и не добавляет новых флагов. Не трогает `vb install`.

**Связанное:** doc-25 §2.1 (`vb create`), §3.1 (`registries` — карта alias → {owner, branch}), §4.1 шаг 1 («Разобрать `--template`: alias → `registries` → `owner`» — в спеке написано правильно, реализация разошлась); VL-339 (`vb create`), VL-336 (`vb init --components` создаёт секцию).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `vb create testapp --template vibelog.md/templates/svelte-minimal` клонирует `https://gitverse.ru/Vibelog-md/templates.git` (owner из `registries[alias].owner`), а не `vibelog.md`
- [x] #2 Owner резолвится из секции `components.registries[alias].owner`; регистр сохраняется как в конфиге (`Vibelog-md`, не `vibelog-md`)
- [x] #3 Если секция `components` отсутствует или alias не найден в `registries` — ошибка с кодом 2 и подсказкой: «выполните `vb init --components` / добавьте реестр `vibelog.md` в `.vibelog/settings.json`», а не попытка клонировать по alias
- [x] #4 Флаг `--branch` и `registries[alias].branch` работают как раньше (регрессии нет)
- [x] #5 Проверка `owner`: не пустой, не содержит точку (ограничение GitVerse) — иначе понятная ошибка с кодом 2
- [x] #6 Тест-регрессия в `create.test.mjs`: конфиг с `registries['vibelog.md'] = { owner: 'Vibelog-md', branch: 'master' }` + шаблон `vibelog.md/templates/svelte-minimal` → URL клонирования содержит `Vibelog-md/templates.git`
- [x] #7 Тест: alias отсутствует в `registries` → код 2 с подсказкой, ни одного git-вызова не сделано
- [x] #8 Тест: секции `components` нет (пустой каталог) → код 2 с подсказкой про `vb init --components`
- [x] #9 Тест: `owner` с точкой в конфиге → код 2 с указанием ограничения GitVerse
- [x] #10 Ручная приёмка: `vibelog create testapp --template vibelog.md/templates/svelte-minimal` в пустом каталоге создаёт проект (или падает на следующем реальном шаге — но не на клонировании)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
**Файлы.** `src/core/create.ts` (резолв owner), `src/core/create.test.mjs` (тесты), при необходимости `src/cli/commands/create.ts` (текст ошибки).

**Шаг 1. Резолв owner — симметрично `vb install`.**

1. Новая функция `resolveTemplateRegistry(cwd, alias): { owner: string; branch: string }`:
   ```ts
   const config = readComponentsConfig(cwd);      // уже используется в resolveTemplateBranch
   if (config === null) throw new CreateError(
     'секция components не найдена в .vibelog/settings.json — выполните «vb init --components»', 2);
   const entry = config.registries[alias];
   if (!entry) throw new CreateError(
     `реестр «${alias}» не найден в registries (.vibelog/settings.json); доступны: ${Object.keys(config.registries).join(', ')}. ` +
     `Для Vibelog.md добавьте: "vibelog.md": { "owner": "Vibelog-md", "branch": "master" }`, 2);
   return { owner: entry.owner, branch: entry.branch };
   ```
2. Валидация owner: непустая строка, без точки (`GitVerse: имя владельца не содержит точку`) — иначе код 2 с явным текстом. Проверка нужна потому, что именно точка отличает alias от owner (doc-25 §3.1), и опечатка в конфиге иначе дойдёт до git.
3. `resolveTemplateBranch` переиспользует тот же резолв: не читать конфиг дважды. Переписать как `resolveTemplateRegistry(...)` + выбор ветки: флаг → `entry.branch` → `master`.
4. В `createProject` (строка ~583): `owner: alias` → `owner: registry.owner`.

**Шаг 2. Поведение в пустом каталоге.**

5. Сейчас `resolveTemplateBranch` при отсутствии конфига молча отдаёт `master` — это было сделано, чтобы «`vb create` работал в пустом каталоге». С резолвом owner так нельзя: без конфига неизвестен owner. Решение: в пустом каталоге (нет `.vibelog/settings.json`) использовать **дефолтную запись реестра** `vibelog.md → { owner: 'Vibelog-md', branch: 'master' }` — та же, что создаёт `vb init --components` (`defaultComponentsConfig` из `components-config.ts`). Не хардкод в `create.ts`, а импорт существующей функции.
6. Порядок резолва: конфиг проекта → если секции нет, дефолт `defaultComponentsConfig().registries` → если alias не найден и там, ошибка с кодом 2 и списком доступных.
7. Так `vb create` продолжает работать в пустом каталоге (сценарий «создать проект с нуля» — основной), но с правильным owner.

**Шаг 3. Тесты (`create.test.mjs`).**

8. Конфиг с `registries['vibelog.md'] = { owner: 'Vibelog-md', branch: 'master' }` + шаблон `vibelog.md/templates/svelte-minimal` → перехваченный `gitRunner` получает URL с `Vibelog-md/templates.git`. Тест-регрессия на дефект.
9. Пустой каталог (нет `.vibelog/`) → используется дефолт, URL содержит `Vibelog-md/templates.git` (не `vibelog.md`).
10. Alias отсутствует в `registries` и не дефолтный (`nope/templates/x`) → код 2, подсказка со списком доступных, **ни одного git-вызова** (проверить счётчик вызовов раннера).
11. `owner` с точкой в конфиге → код 2.
12. Регрессия: `--branch dev` по-прежнему переопределяет ветку; `registries[alias].branch` используется, когда флага нет.

**Шаг 4. Проверка, что не сломано остальное.**

13. `vb install` не затронут (использует свой `resolveInstallContext`) — прогнать `install*.test.mjs`.
14. Проверить, что другие места не делают ту же ошибку `owner: alias`: `grep -n "owner: alias" src/` → пусто; `grep -rn "registries\[" src/` — убедиться, что везде берётся `.owner`.

**Шаг 5. Документация.**

15. doc-25 §4.1 шаг 1 уже описывает правильный порядок («alias → `registries` → `owner`») — правок не требует. Добавить в §9 риск: «alias и owner — разные сущности; в `vb create` они уже путались (VL-385), поэтому обе команды резолвят owner через один и тот же `registries[alias].owner`».
16. `CHANGELOG.md` — запись.

**Риски.**
- Дефолтная запись реестра в пустом каталоге — удобство, но скрывает отсутствие настройки. Компромисс: использовать дефолт, но печатать `printInfo('реестр не настроен в проекте — использую дефолтный vibelog.md → Vibelog-md')`, чтобы пользователь знал.
- `owner` может содержать кириллицу или пробелы — не отклонять, только кодировать при построении URL (`encodeURIComponent` в `cloneInto` уже не применяется — проверить; для git-URL кодирование не требуется, но пробел сломает команду, значит лучше валидировать).
- Дефолт `defaultComponentsConfig` может измениться (например, ветка на `main`) — `vb create` поедет за ним. Это правильно, но зафиксировать в тесте, что тест проверяет связь с функцией, а не хардкод `Vibelog-md`.
- Ошибка «реестр не найден» должна печататься до создания временного каталога и до любых git-вызовов, иначе пользователь увидит шум из `vb-create-*`.

**Проверка.** `pnpm typecheck && pnpm test`; вручную — `vibelog create testapp --template vibelog.md/templates/svelte-minimal` в пустом каталоге: должен пройти клон `Vibelog-md/templates`; затем `vibelog create` с несуществующим alias → понятная ошибка с кодом 2.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-09 17:29
---
Фаза 3 (Code) выполнена. Коммит 89f867e «fix: VL-385 — vb create резолвит owner шаблона из registries[alias].owner».
Изменено:
- `src/core/create.ts`: новая `resolveTemplateRegistry(cwd, alias)` — резолв alias → `registries[alias]` → `{owner, branch, isDefault}` симметрично `vb install`. Порядок: секция `components` проекта → `defaultComponentsConfig(cwd).registries` (импорт существующей функции, не хардкод) → ошибка кодом 2 со списком доступных реестров и подсказкой «добавьте реестр / выполните `vb init --components`». Валидация owner: непустой, без точки и пробелов (ограничение GitVerse) — код 2 с явным текстом; ошибки `ComponentsConfigError` конвертируются в `CreateError` код 2 (для `.owner` добавляется пояснение про домен вместо владельца). `resolveTemplateBranch` стал тонкой обёрткой над резолвом (конфиг больше не читается дважды). В `createProject` резолв выполняется ДО временного каталога и любых git-вызовов, `owner: alias` → `owner: registry.owner`, ветка = `--branch` → `registries[alias].branch` → `master`. При дефолтной записи печатается предупреждение «реестр не настроен в проекте — использую дефолтный …».
- `src/core/create.test.mjs`: блок «резолв owner из registries (VL-385)» — 6 тестов: URL клона содержит `https://gitverse.ru/Vibelog-md/templates.git` при конфиге (регрессия дефекта); пустой каталог использует дефолтную запись (и предупреждение); неизвестный alias → код 2 со списком доступных, `git.calls.length === 0`, каталог проекта не создан; owner с точкой → код 2 с упоминанием ограничения; секция без нужного alias → код 2 с подсказкой про `vb init --components`; `--branch` переопределяет ветку, без флага берётся `registries[alias].branch`. Хелперы: `recordingGitRunner` (подменяет сетевой URL на локальную фикстуру, сохраняя реальный URL в аргументах), `cloneUrlOf`, `writeSettings`, `componentsConfig`.
Проверки:
- `pnpm typecheck` — чисто;
- `pnpm build` — чисто;
- полный `pnpm test` — 3888 passed, 4 skipped (пропуски — штатные, в чужих сьютах), падений нет;
- `grep -rn "owner: alias" src/` — пусто; `grep -rn "registries\[" src/` — везде берётся `.owner` (`install.ts`, `create.ts`, валидатор конфига);
- ручная приёмка: `vb create testapp --template vibelog.md/templates/svelte-minimal --no-install --no-git` в пустом каталоге — клон прошёл (URL `Vibelog-md/templates`), проект создан, exit 0; `git ls-remote https://gitverse.ru/Vibelog-md/templates.git` отвечает (реестр существует).
Замечание: при дефолтном реестре предупреждение печатается дважды (сразу через `onWarning` и в итоговом блоке через `result.warnings`) — косметика, на поведение и тесты не влияет; правку этого места заблокировал лимит повторных правок файла, вынесу при необходимости в отдельный баг.
Что осталось (для фазы Close): doc-25 §9 — риск «alias и owner — разные сущности; обе команды резолвят owner через `registries[alias].owner`» и запись в `CHANGELOG.md` (в Фазе 3 документация не правится по регламенту).
---
author: @agent
created: 2026-11-09 17:43
---
Фаза Close выполнена. Ветка vb/vl-385 слита в master (1 коммит фикса 89f867e + merge), worktree удалена (--force: единственный untracked — симлинк backlog/references/data от оркестратора), ветка vb/vl-385 удалена.
Проверки после merge:
- `pnpm build` — чисто.
- ранний точечный: `src/core/create.test.mjs` — 24/24 passed.
- полный `pnpm test` (прогон №1): 3882 passed, 4 skipped, 6 failed — все падения в `src/web/orchestrator.test.mjs` (startPhase/result-парсинг), файл не затронут diff'ом (diff = src/core/create.ts + create.test.mjs). Классификация: файл в изоляции — 89/89 passed; параллельного vitest не было.
- повторный полный прогон (причина: флейк в чужом сьюте, classification выше): `pnpm test:fast` — 203 файла, 3896 passed, 4 skipped, падений нет. Регрессий нет.
DoD:
1. Тесты проходят — да (финальный полный прогон зелёный).
2. Документация обновлена — да: doc-25 §9 (риск «alias и owner — разные сущности», резолв через registries[alias].owner, валидация owner, дефолт из defaultComponentsConfig), CHANGELOG.md → Unreleased/Исправлено (VL-385). Коммит 1afcf04.
3. Нет регрессий — да.
Урок: lesson-266 «Резолвь поле конфига одной общей функцией для всех команд, а не по-своему в каждой» (sourceTasks: VL-385), привязан к задаче, закоммичен (b5b03d4).
Замечание из фазы Code (не блокирует): при дефолтном реестре предупреждение печатается дважды (onWarning + result.warnings) — косметика, вынести в отдельный баг при необходимости.
---
<!-- COMMENTS:END -->