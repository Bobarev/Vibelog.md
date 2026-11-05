---
id: VL-339
title: 'vb create: клонирование шаблона через sparse-checkout, postCreate, установка vibelog.components, git init'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-05 12:25'
updated_date: '2026-11-05 12:48'
due_date: ''
labels:
  - vb-cli
  - templates
  - create
  - cli
dependencies:
  - VL-337
  - VL-338
milestone: ''
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/create.ts
  - src/core/create.test.mjs
  - src/cli/commands/create.ts
  - src/cli/router.ts
lessons:
  - lesson-222
  - lesson-223
token_usage:
  input: 6213839
  output: 55866
  cache: 6005760
  total: 6269705
  requests: 89
  duration_ms: 873557
  reasoning: 22812
  by_phase:
    code:
      input: 5090574
      output: 49008
      cache: 4989440
      requests: 63
    close:
      input: 1123265
      output: 6858
      cache: 1016320
      requests: 26
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Седьмая задача реализации doc-25 (v1.3, §2.1, §4.1). Последняя CLI-команда: создание нового проекта из шаблона.

**Зависимость:** VL-337 (ядро `install`) и VL-338 (зависимости) — `vb create` переиспользует логику установки для `vibelog.components`.

**Что делает команда:**
```
vb create myapp --template vibelog.md/templates/svelte-minimal [флаги]
```
1. Разбирает путь шаблона, проверяет имя проекта и отсутствие каталога.
2. Клонирует подпапку шаблона через `sparse-checkout` во временный каталог.
3. Проверяет `vibelog.type === "template"`.
4. Копирует содержимое подпапки в `./<name>`.
5. Ставит зависимости выбранным пакетным менеджером.
6. Выполняет `scripts.postCreate`.
7. Устанавливает компоненты из `vibelog.components`.
8. Делает `git init` + первый коммит.

**Порядок `sparse-checkout` критичен** (проверено спайком, doc-25 §10): `sparse-checkout set` **до** `checkout`. Иначе рабочее дерево развернётся полностью.

**Cone-режим разворачивает и корневые файлы** — это документированное поведение git, не ошибка. Копируется только `<tmp>/<template>`.

**Границы.** Задача не создаёт шаблон (он живёт в `Vibelog-md/templates`, отдельный репозиторий по doc-25 §11) и не реализует `vb update`. Не делает fallback на zip-архив — спайк показал, что `--filter=blob:none` на GitVerse работает.

**Связанные решения:** doc-25 §2.1 (флаги), §3.5 (`package.json` шаблона), §4.1 (поток), §5.2 (коды), §8 п.5 (падение `postCreate`), §10 (спайк GitVerse), §11 (шаблоны — отдельный репозиторий); decision-11 (монорепозиторий шаблонов, метаданные в `package.json`, `sparse-checkout`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `vb create <name> --template <alias>/<repo>/<template>` создаёт каталог `./<name>` в текущем рабочем каталоге без дополнительных вопросов
- [x] #2 Имя проекта валидируется по npm-правилам (lowercase, допустимы `-`, `_`, `.`, без пробелов); невалидное имя → код 1 с указанием правила
- [x] #3 Существующий каталог `./<name>` → код 2; флаг `--force` не предусмотрен (перезапись запрещена)
- [x] #4 Шаблон клонируется через `git clone --filter=blob:none --no-checkout --depth 1 --branch <branch>` во временный каталог в `os.tmpdir()`, затем `sparse-checkout init --cone`, `sparse-checkout set <template>`, `checkout <branch>` — строго в этом порядке
- [x] #5 Копируется только содержимое `<tmp>/<template>`; корневые файлы репозитория (README, package.json репозитория), развёрнутые cone-режимом, игнорируются
- [x] #6 Ветка берётся из `--branch`, иначе из `registries[alias].branch` (по умолчанию `master`)
- [x] #7 `package.json` шаблона проверяется на `vibelog.type === "template"`; иначе код 3 с указанием, что найдено
- [x] #8 Пакетный менеджер: `--package-manager` → интерактивный вопрос с детектом lock-файла → дефолт npm; `--no-install` пропускает установку зависимостей
- [x] #9 `scripts.postCreate` выполняется после установки зависимостей; при падении каталог сохраняется, выводится ошибка с путём, код 3
- [x] #10 Пути из `vibelog.components` устанавливаются через логику `vb install` (VL-337/338) после `postCreate`
- [x] #11 Если не `--no-git`: выполняется `git init`, `git add -A`, первый коммит с осмысленным сообщением
- [x] #12 Временный каталог удаляется в `finally` при любом исходе (успех, ошибка клонирования, ошибка postCreate)
- [x] #13 Предупреждение `filtering not recognized by server` выводится, если git его вернул (на GitVerse не возвращает), установка продолжается
- [x] #14 Тесты: успешное создание из локального git-репозитория-фикстура, невалидное имя, существующий каталог, отсутствие `vibelog.type`, падение `postCreate`, `--no-install`, `--no-git`, установка компонентов из `vibelog.components`
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
**Файлы.** `src/cli/commands/create.ts` (команда), `src/core/create.ts` (логика: клонирование, копирование, оркестрация), `src/core/create.test.mjs`, `src/cli/router.ts` (регистрация и справка). Переиспользовать: `install.ts`/`install-deps.ts` (VL-337/338), `registry-fetch.ts` (VL-335, для чтения `registries`), `components-config.ts` (VL-333), `paths.ts` (`.vibelog/tmp`).

**Шаг 1. Разбор аргументов и валидация.**

1. `parseTemplatePath(raw): { alias, repo, template }` — ровно три сегмента; иначе код `1` с примером `vibelog.md/templates/svelte-minimal`.
2. `validateProjectName(name): string | null` — npm-правила: lowercase, длина 1–214, допустимы `a-z0-9-_.`, не начинается с `.` или `_`, без пробелов и заглавных. Возвращает текст ошибки либо `null`.
3. Проверка `existsSync(join(cwd, name))` → код `2` «каталог уже существует»; `--force` не поддерживается (явно сказать в сообщении).
4. Флаги: `--template` (обязателен), `--branch`, `--package-manager`, `--no-install`, `--no-git`, `--yes`. Неизвестный флаг → код `1`.

**Шаг 2. Клонирование подпапки.**

5. `cloneTemplate({ owner, repo, branch, template, tmpRoot }): string` — последовательность строго в этом порядке:
   ```
   git clone --filter=blob:none --no-checkout --depth 1 --branch <branch> <url> <tmp>
   git -C <tmp> sparse-checkout init --cone
   git -C <tmp> sparse-checkout set <template>
   git -C <tmp> checkout <branch>
   ```
   Каждый шаг — `spawnSync('git', args)` без shell; ненулевой код → ошибка с хвостом stderr.
6. Если stderr содержит `filtering not recognized by server` — вывести предупреждение и продолжить (на GitVerse не появляется, но другие хосты возможны).
7. Проверка результата: `<tmp>/<template>` существует и является каталогом; иначе код `3` «шаблон `<template>` не найден в репозитории» (частая причина — опечатка в имени или неверная ветка).
8. Временный каталог — `mkdtempSync(join(os.tmpdir(), 'vb-create-'))`; удаление в `finally` при любом исходе.

**Шаг 3. Проверка шаблона и копирование.**

9. Прочитать `<tmp>/<template>/package.json`; отсутствует или не парсится → код `3`. `vibelog.type !== 'template'` → код `3` с указанием фактического значения (или «поле отсутствует»).
10. `copyDir(src, dest)` — рекурсивное копирование с сохранением структуры; **исключить** `.git`, `node_modules`, `dist` (если случайно попали). Копируется только содержимое `<tmp>/<template>`, корневые файлы репозитория игнорируются.
11. Каталог `./<name>` создаётся только после успешной проверки шаблона — чтобы не оставлять пустой каталог при ошибке.

**Шаг 4. Зависимости и postCreate.**

12. Пакетный менеджер: `--package-manager` → интерактивный `p.select` (детект по lock-файлу шаблона как `initialValue`) → `npm`. `--no-install` — пропустить шаг целиком.
13. Установка: `spawnSync(pm, ['install'], { cwd: targetDir, stdio: 'inherit' })`; ненулевой код → код `3` с хвостом вывода.
14. `scripts.postCreate` из `package.json` шаблона: выполнить через `spawnSync(pm, ['run', 'postCreate'], { cwd: targetDir, stdio: 'inherit' })`. Падение → **каталог сохраняется**, выводится ошибка с путём и подсказкой «исправьте и запустите вручную», код `3` (doc-25 §8 п.5).
15. `vibelog.components` — массив путей; для каждого вызвать логику `vb install` (VL-337/338) с `cwd = targetDir`. Ошибка установки компонента → предупреждение, создание проекта не отменяется (проект уже рабочий), но итог явно перечисляет неудачные.

**Шаг 5. Git.**

16. Если не `--no-git`: `git init` в `targetDir`, `git add -A`, `git commit -m "Initial commit from <alias>/<repo>/<template>"`. Трейлер `Co-authored-by` — через `appendCommitTrailer` (VL-302), как в остальных коммитах проекта.
17. `git init` может быть недоступен (нет git в PATH) → предупреждение, проект создан, код `0` (не критично для результата).

**Шаг 6. Вывод и коды.**

18. Итоговый блок: путь проекта, шаблон и ветка, пакетный менеджер, установленные компоненты, выполненные скрипты, статус git.
19. Коды: `0` — успех; `1` — использование (имя, флаги, путь шаблона); `2` — каталог существует; `3` — клон/шаблон/зависимости/postCreate; `5` — отмена промпта.

**Шаг 7. Регистрация.**

20. `src/cli/router.ts`: `case 'create': return runCreate(positional, flags, cwd)`; справка — строка в общем списке и `showCommandHelp('create')`.

**Шаг 8. Тесты (`src/core/create.test.mjs`).**

21. Фикстура: локальный git-репозиторий, созданный в тесте (`git init`, коммит с `templates/svelte-minimal/package.json` и парой файлов), путь к нему подставляется вместо `https://gitverse.ru` — через инъекцию `cloneUrl`/`baseUrl` в опции (не через env, чтобы не влиять на другие тесты).
22. Успех: каталог создан, файлы шаблона на месте, корневые файлы репозитория НЕ скопированы.
23. Невалидное имя (`My App`, `UPPER`, `-x`) → код `1`.
24. Существующий каталог → код `2`, содержимое не тронуто.
25. `package.json` без `vibelog.type` → код `3`, каталог не создан.
26. `--no-install` → пакетный менеджер не вызывается (мок runner), файлы на месте.
27. `--no-git` → `.git` отсутствует.
28. Падение `postCreate` (скрипт `exit 1`) → каталог сохранён, код `3`.
29. `vibelog.components` → вызвана установка (мок), неудачная установка не отменяет создание проекта.
30. Временный каталог удалён после успеха и после ошибки (проверить отсутствие `vb-create-*` в `os.tmpdir()`).

**Риски.**
- Тест на реальный `git clone` медленный и требует сети — фикстура должна быть локальным репозиторием, а URL клонирования инъектироваться. Иначе тесты станут нестабильными.
- `sparse-checkout` в тестовом репозитории ведёт себя иначе, если в нём мало файлов (всё попадает в корень) — фикстура должна иметь подкаталог `templates/<name>/` и хотя бы один корневой файл, чтобы проверить, что корень не копируется.
- `postCreate` запускает `vb init --components --yes` — в тесте это рекурсивный вызов CLI; подменять runner, иначе тест создаёт реальный backlog.
- Копирование `.git` из шаблона сломало бы `git init` — исключение обязательно.
- `--yes` + интерактивный выбор пакетного менеджера: в неинтерактивном режиме дефолт `npm`, но если в шаблоне есть `pnpm-lock.yaml`, разумнее взять pnpm — зафиксировать правило (детект приоритетнее дефолта).

**Проверка.** `pnpm typecheck && pnpm test`; вручную — `vb create testapp --template vibelog.md/templates/svelte-minimal --no-install --no-git` против реального репозитория (после публикации шаблона), проверка структуры и отсутствия корневых файлов.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-05 12:40
---
Фаза 3 (Code) выполнена. Коммит 53a5d46.
**Изменено:**
- `src/core/create.ts` — ядро: `parseTemplatePath`, `validateProjectName`, `resolveTemplateBranch`, `cloneTemplate` (clone → sparse-checkout init --cone → set → checkout, строго в этом порядке), `sparseCandidates`, `readTemplateManifest`, `copyDir` (исключает `.git`/`node_modules`/`dist`), `installTemplateComponents` (переиспользует `install.ts` VL-337/338), `createProject` (оркестрация + `finally`-уборка temp), `finishGit` (init/add/commit с трейлером через `commitMessageArgs` VL-302).
- `src/cli/commands/create.ts` — команда: флаги `--template/--branch/--package-manager/--no-install/--no-git/--yes`, неизвестный флаг → код 1, интерактивный выбор пакетного менеджера с детектом по lock-файлу шаблона, итоговый блок, коды 0/1/2/3/5.
- `src/core/create.test.mjs` — 18 тестов на локальном git-репозитории-фикстуре (инъекция `cloneUrl`, моки `depsRunner`/`installComponents`).
- `src/cli/router.ts` — `case 'create'`, строка общей справки, `showCommandHelp('create')`.
**Проверки:** `pnpm build` (tsc, чисто) + полный `pnpm test` — 178 файлов, 3393 passed, 4 skipped, 0 failed (полный прогон, без --exclude/--skip). Ручная проверка CLI в `.vibelog/tmp`: `vb create "My App"` → код 1 с правилом; `vb create myapp --template vibelog.md/templates/svelte-minimal --no-install --no-git` → код 3 (репозиторий шаблонов ещё не опубликован на GitVerse — ожидаемо, doc-25 §11); `vb create --help` печатает справку.
**Отклонения от плана (осознанные, зафиксированы в коде):**
1. **Legacy-путь sparse-checkout для git < 2.25.** Целевая ОС проекта — macOS 10.15 Catalina с git 2.24.3, где подкоманды `git sparse-checkout` нет (проверено на этой машине: `git: 'sparse-checkout' is not a git command`). При таком ответе включается эквивалентный механизм `core.sparseCheckout=true` + `.git/info/sparse-checkout` — результат идентичен cone-режиму, порядок «set до checkout» сохранён. Без этого команда не работала бы на целевой ОС.
2. **Два кандидата пути шаблона.** `sparse-checkout set` получает и `<template>`, и `<repo>/<template>`: раскладка репозитория шаблонов (подпапка в корне vs вложенная в одноимённый каталог) на момент реализации не зафиксирована, а лишний несуществующий путь git молча игнорирует. Копируется первый найденный каталог.
3. **`--no-install` пропускает и `postCreate`, и установку компонентов** (не только `npm install`): `postCreate` шаблона — это `vb init --components --yes`, а установка компонентов ходит в сеть; при явном «не трогай зависимости» запускать их было бы неожиданно. В итоговом блоке печатается «Зависимости: не устанавливались (--no-install)».
**Что осталось:** документация (doc-7 раздел `create`, CHANGELOG) — по правилам фазы пишется в Close; приёмка против реального репозитория `Vibelog-md/templates` — после его публикации (doc-25 §11).
---
author: @agent
created: 2026-11-05 12:48
---
Фаза Close выполнена. Ветка vb/vl-339 слита в master (merge 0c7988c, 1 коммит 53a5d46: src/core/create.ts, src/core/create.test.mjs, src/cli/commands/create.ts, src/cli/router.ts — 1363 вставки), worktree .vibelog/worktrees/vl-339 удалена (только untracked backlog/references/data — симлинк оркестратора, удалено с --force), ветка vb/vl-339 удалена.
**Проверки после merge:** `pnpm build` (tsc, чисто); ранний точечный фильтр `pnpm test:fast src/core/create.test.mjs` — 18 passed; полный `pnpm test:fast` — 179 файлов, 3401 passed, 4 skipped, 0 failed (один полный прогон за фазу, повторов не было).
**DoD:**
1. Тесты проходят — да (полный прогон 3401 passed).
2. Документация обновлена — да: doc-7 получил раздел `create` (флаги, порядок sparse-checkout, fallback для git < 2.25, коды выхода, примеры), в CHANGELOG.md (Unreleased → Добавлено) — запись VL-339. Коммит aa93f8b.
3. Нет регрессий — да (полный прогон зелёный, сборка чистая).
**Lessons:** созданы lesson-222 (fallback на core.sparseCheckout при git < 2.25) и lesson-223 (тесты клонирования на локальной фикстуре с инъекцией cloneUrl), связаны с задачей; коммит 00db97c.
**Осталось за рамками задачи:** приёмка против реального репозитория `Vibelog-md/templates` — после его публикации (doc-25 §11), шаблон в этой задаче не создаётся по границам задачи. Отклонения Code (legacy sparse-checkout для git 2.24, два кандидата пути шаблона, `--no-install` пропускает postCreate и компоненты) зафиксированы в коде и в doc-7.
---
<!-- COMMENTS:END -->