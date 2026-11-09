---
id: VL-348
title: 'init: git-политика (корневой .gitignore + .vibelog/.gitignore), шаги wizard «git init», первый коммит и remote'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-07 12:55'
updated_date: '2026-11-09 21:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.13
references: []
priority: ''
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/gitignore.ts
  - src/core/git-init.ts
  - src/core/setup.ts
  - src/cli/commands/init-wizard.ts
  - src/cli/commands/init.ts
  - src/cli/commands/doctor.ts
  - src/cli/router.ts
  - src/web/setup-api.ts
  - src/core/gitignore.test.mjs
  - src/core/git-init.test.mjs
  - src/cli/init-git.test.mjs
  - src/core/setup.test.mjs
  - src/cli/diagnostics.test.mjs
lessons:
  - lesson-243
token_usage:
  input: 18610885
  output: 121913
  cache: 18285056
  total: 18732798
  requests: 215
  duration_ms: 1343918
  reasoning: 59021
  by_phase:
    code:
      input: 16003927
      output: 111520
      cache: 15752192
      requests: 167
    close:
      input: 2606958
      output: 10393
      cache: 2532864
      requests: 48
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`vb init` (`src/core/setup.ts` → `applySetup`) создаёт `backlog/`, `AGENTS.md`, `.vibelog/settings.json`, пишет секреты в `.env` (шаг 3) и `TELEGRAM_CHAT_IDS` в `.env` (шаг 4) — но **не создаёт и не проверяет git-политику**, а также **не инициализирует git**:

1. **Корневой `.gitignore` не создаётся.** В свежем проекте нет ни строки `.env` → файл с токенами/API-ключами попадает в git первым же `git add -A`. Проверка `env_ignored` существует только в `vibelog doctor` (`src/cli/commands/doctor.ts`), то есть срабатывает уже после того, как секрет мог утечь.
2. **`.vibelog/.gitignore` не создаётся.** Политика VL-329 (`.vibelog/` не игнорируется корневым `.gitignore`, всё локальное игнорируется через `*` + отрицания) живёт как файл этого репозитория и как проверка `vibelog_gitignore` в `doctor`, который умеет только ругаться («Создайте файл политики (VL-329)»). Новый проект после `vb init` нерабочий по политике из коробки.
3. **`git init` в `init` отсутствует.** Он есть только в `vb create` (`finishGit` в `src/core/create.ts`: `git init` + первый коммит с трейлером через `commitMessageArgs`). `vb init` в пустом каталоге оставляет проект вне git.

Итог: «поставил и работает» не выполняется — пользователь обязан руками сделать три вещи, одна из которых (gitignore для `.env`) критична по безопасности.

## Цель

`vb init` приводит проект в состояние «git-политика на месте, репозиторий инициализирован», не перезаписывая чужой контент и спрашивая пользователя там, где решение за ним.

## Решения (обсуждены с пользователем)

- **git init — шаг wizard-а, не молчаливое действие.** Если git-репозиторий не обнаружен (`git rev-parse --is-inside-work-tree` не ok), wizard спрашивает «Инициализировать git-репозиторий?»; при «да» — `git init` + **первый коммит** (как `finishGit` в `create`); после этого спрашивает «Добавить remote?» и при «да» — адрес, затем `git remote add origin <url>`.
- **Порядок критичен:** gitignore-политика пишется ДО коммита, иначе первый коммит притащит `.env`.
- **Корневой `.gitignore` — мерж, а не перезапись.** Файл может быть чужим: дописываем только отсутствующие правила из минималки, в блоке с маркерами (механизм как в `src/core/experiment-gc.ts:130` — замена блока на месте, идемпотентность байт-в-байт, посторонние строки сохраняются).
- **`.vibelog/.gitignore` — создаётся целиком, если файла нет**; существующий не трогаем (возможно, изменён осознанно) — только предупреждение о расхождении.
- **Файлы пишутся в `cwd`**, а не в `git rev-parse --show-toplevel`: `init` может запускаться в подкаталоге чужого монорепо (симметрично `gitignorePathFor` в `experiment-gc.ts`).
- **Флаги для non-interactive пути** (`--yes`): `--git-init` / `--no-git-init`, `--git-remote <url>`; без флагов в `--yes` поведение прежнее (ничего не инициализируем), но печатается предупреждение «проект не в git».
- **Веб-мастер `#/setup`** в первой версии шаг git не поддерживает (как было с `components` в VL-336): в ответах API поля необязательные, отсутствие = не инициализировать; предупреждение выводится.

## Минимальный корневой `.gitignore` (при создании)

```
node_modules/
dist/
# Клоны референсных репозиториев
backlog/references/data/
# Markdown-кэш doc/url references
backlog/references/cache/
# Секреты (токены, API-ключи, TELEGRAM_CHAT_IDS) — не коммитить
.env
.DS_Store
*.log
```

При мерже в существующий файл дописываются только отсутствующие строки; `.DS_Store` и `*.log` — только при создании нового файла (в чужой файл не навязываем).

## `.vibelog/.gitignore` (создаётся, если нет)

```
# Git-политика .vibelog/
# 1. Всё локальное и восстанавливаемое — игнорируется
*
!*/

# 1a. Рабочие деревья задач — вложенные git-репозитории
worktrees/

# 2. Сам файл политики — в git
!.gitignore

# 3. Конфигурация и учёт: состояние установленных компонентов
!config.json
!installed.lock.json

# 4. Настройки проекта. Секретов здесь нет: токены, API-ключи и
#    TELEGRAM_CHAT_IDS живут только в .env в корне проекта
!settings.json

# 5. Переопределения ролей проекта поверх встроенных (src/web/personas.ts)
!prompts/
!prompts/**

# 6. История трат: append-only источник правды по токенам и таймингам ранов
!billing/
!billing/**
```

## Затрагиваемые инварианты

- **Не ломать `vb create`**: там `finishGit` уже делает init+коммит — общий код не должен приводить к двойному `git init` (idempotent: `rev-parse` → уже репозиторий → пропуск).
- **Не ломать Catalina/старый git**: `git init -b main` есть только с git 2.28 — использовать `git init` + `git symbolic-ref HEAD refs/heads/main` (или `init.defaultBranch`) с фолбэком, как в `create.ts` при sparse-checkout.
- **Совместимость `SetupAnswers`**: новые поля необязательные (`git?: {init: boolean; commit?: boolean; remote?: string}`), веб-мастер и старые тесты не ломаются.
- **Отсутствие git в PATH** — предупреждение и продолжение, не ошибка (как в `create.ts`).
- **remote**: `git remote add origin <url>` падает, если remote уже есть — проверять `git remote` и заменять только по явному согласию; невалидный URL — предупреждение, проект остаётся созданным.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `vb init` в каталоге без `.gitignore` создаёт корневой `.gitignore` с минимальным набором: `node_modules/`, `dist/`, `backlog/references/data/`, `backlog/references/cache/`, `.env`, `.DS_Store`, `*.log`
- [x] #2 `vb init` при существующем чужом `.gitignore` дописывает только отсутствующие правила в блоке с маркерами и не меняет посторонние строки; повторный запуск идемпотентен байт-в-байт
- [x] #3 `vb init` создаёт `.vibelog/.gitignore` с политикой VL-329 (`*`, `!*/`, `!.gitignore`, `!config.json`, `!installed.lock.json`, `!settings.json`, `!prompts/`, `!prompts/**`, `!billing/`, `!billing/**`, `worktrees/`), если файла нет; существующий файл не перезаписывается, расхождение печатается предупреждением
- [x] #4 `git check-ignore -v .env .vibelog/settings.json .vibelog/billing/x.json backlog/references/data/x` после `vb init` даёт: `.env` и `backlog/references/…` игнорируются, `.vibelog/settings.json` и `billing/` — нет
- [x] #5 Wizard спрашивает «Инициализировать git-репозиторий?», если проект не внутри git; при «да» выполняется `git init`, ветка `main` (с фолбэком на дефолт git для git < 2.28) и первый коммит
- [x] #6 Первый коммит НЕ содержит `.env`: `git ls-files | grep '^\.env$'` пуст
- [x] #7 После init (если пользователь согласился) wizard спрашивает «Добавить remote (origin)?», при «да» — URL и `git remote add origin <url>`; существующий `origin` не перезаписывается без явного согласия
- [x] #8 Если проект уже внутри git-репозитория, шаги git init/remote не предлагаются и ничего не меняется
- [x] #9 Non-interactive путь: `--git-init` инициализирует и коммитит, `--no-git-init` — нет; флаги взаимоисключающие и при конфликте дают ошибку с кодом 1, как `--components`/`--no-components`
- [x] #10 `--yes` без `--git-init` вне git-репозитория печатает предупреждение «проект не в git, `.env` с секретами не защищён», но завершается с кодом 0
- [x] #11 Отсутствие `git` в PATH — предупреждение, а не ошибка: проект создан, код 0
- [x] #12 `vibelog doctor` получает проверку `root_gitignore_exists`: нет корневого `.gitignore` при существующем `.env` → проверка не ok; существующие пять проверок git-политики VL-329 не меняют поведение
- [x] #13 `vb create` по-прежнему делает один `git init` и один коммит (общий код идемпотентен, двойного init нет), тесты `src/core/create.test.mjs` зелёные
- [x] #14 Веб-мастер `#/setup` не падает: поле `git` в payload необязательное, при отсутствии git-шаг пропускается с предупреждением
- [x] #15 Тесты: `src/core/gitignore.test.mjs`, `src/core/git-init.test.mjs`, интеграционный `vb init --yes --git-init` в temp-каталоге (репозиторий, один коммит, `.env` не в индексе, `doctor` зелёный); `pnpm build && pnpm test` зелёные
- [ ] #16 Документация обновлена: doc-7 (раздел `init` — шаги git-политики и git), CHANGELOG, AGENTS.md (политика `.vibelog/` теперь создаётся init)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Порядок работ

**1. `src/core/gitignore.ts` (новый)** — чистый модуль без сайд-эффектов на импорте:
- `ROOT_GITIGNORE_TEMPLATE` / `VIBELOG_GITIGNORE_TEMPLATE` — константы текстов.
- `mergeGitignore(existing, desired, {sectionMarkers: true})` — дописывает отсутствующие строки, блок обрамлён `# >>> vibelog` / `# <<< vibelog`; повторный вызов идемпотентен байт-в-байт (переиспользовать подход `replaceBlock`/`buildBlock` из `src/core/experiment-gc.ts`).
- `writeRootGitignore(cwd)` → `'created' | 'updated' | 'unchanged'`; `writeVibelogGitignore(cwd)` → `'created' | 'exists'`.
- Атомарная запись temp + `rename` (lesson-169), пути в posix-виде.

**2. `src/core/git-init.ts` (новый)** — операции git через `spawnSync` (как раннер в `create.ts`):
- `isInsideGitRepo(cwd)` → `git rev-parse --is-inside-work-tree`.
- `gitInit(cwd)` — `git init`, ветка `main` через `symbolic-ref` с фолбэком на дефолт git.
- `initialCommit(cwd)` — `git add -A` + коммит с трейлером через `commitMessageArgs` (VL-302), не `git_commit`-инструмент.
- `addRemote(cwd, url)` — проверка существующего `origin`, замена только при `force`; валидация URL (http(s)/ssh/git@).
- Отсутствие git в PATH → `{ok: false, reason: 'no-git'}` без исключения.

**3. `src/core/setup.ts`**
- `SetupAnswers.git?: { init: boolean; commit?: boolean; remote?: string }` (необязательное).
- `SetupState.git: { inRepo: boolean }` — заполняется в `readSetupState` через `isInsideGitRepo`.
- Новый шаг в `applySetup` **после** шага 4 (`.env`) и **до** коммита: `writeRootGitignore` + `writeVibelogGitignore`, результаты в `written`/`skipped`/`warnings`.
- Последним — шаг git: `gitInit` (если `answers.git.init`), затем `initialCommit`, затем `addRemote`.
- `formatSetupLog` — строки про добавленные правила и про git (репозиторий создан/уже был, remote).

**4. `src/cli/commands/init-wizard.ts`**
- `runWizard`: после шага 4 (Telegram) — если `state.git.inRepo === false`: `askConfirm('Инициализировать git-репозиторий?', true)`; при «да» `askConfirm('Сделать первый коммит?', true)`; затем `askConfirm('Добавить remote (origin)?', false)` → `askText('URL remote (origin)', '')`.
- Если `state.git.inRepo === true` — вопросы пропускаются, шаг в лог не попадает.
- `answersFromFlags`: `--git-init` / `--no-git-init` (взаимоисключающие, как `--components`/`--no-components` в VL-336), `--git-remote <url>`.

**5. `src/cli/commands/init.ts`**
- Валидация взаимоисключающих флагов; печать предупреждения, если репозитория нет и `--git-init` не задан: «проект не в git, .env с секретами не защищён; см. --git-init».
- В `runChecks` (или отдельным шагом) для свежесозданного репозитория — прогнать `git check-ignore .env` и предупредить, если `.env` не игнорируется.

**6. `src/web/setup-api.ts` + `web/src/components/setup/api.ts`** — поле `git` необязательное в payload, парсинг терпимый; при отсутствии — не инициализируем, `applySetup` пишет warning. UI-шаг в первой версии не добавляется (как в VL-336).

**7. `src/cli/commands/doctor.ts`** — новое правило `root_gitignore_exists` (нет корневого `.gitignore` при существующем `.env` → не ok) + переиспользование `ROOT_GITIGNORE_TEMPLATE` для hint. Существующие пять проверок не менять.

## Тесты

- `src/core/gitignore.test.mjs`: нет файла → создан целиком; есть чужой файл → дописаны только недостающие строки, посторонние сохранены; повтор идемпотентен байт-в-байт; уже есть `.env` — не дублируется; `.vibelog/.gitignore` создан и `git check-ignore` подтверждает политику VL-329.
- `src/core/git-init.test.mjs`: `isInsideGitRepo` на temp-каталоге false → `gitInit` → true; повторный `gitInit` — noop; `initialCommit` в репозитории без коммитов; `addRemote` при существующем origin; PATH без git → `no-git` без исключения.
- `src/cli/init-git.test.mjs` (интеграционный, реальный CLI в temp): `vb init --yes --git-init` → репозиторий есть, один коммит, `.env` в коммите отсутствует (`git ls-files`), отслеживаются `backlog/`, `AGENTS.md`, `.vibelog/settings.json`, `.vibelog/.gitignore`; `doctor` на этом каталоге зелёный.
- Обновить `src/cli/diagnostics.test.mjs` (новое правило) и `src/core/setup.test.mjs` (порядок шагов).

## Проверка

`pnpm build && pnpm test`, затем живой прогон: `mkdir /tmp/p && cd /tmp/p && vb init --yes --git-init --git-remote git@example.com:a/b.git`, проверить `git log --stat`, `git remote -v`, `git check-ignore .env`, `vb doctor`.

## Риски

- Мерж чужого `.gitignore` может «испортить» вид файла — блок с маркерами это ограничивает; без `--force` не удаляем ничего.
- `git init` в каталоге внутри чужого репозитория: `rev-parse` вернёт ok → шаг пропускается; вложенный репозиторий не создаётся.
- Первый коммит в репозитории, где уже есть индекс/файлы: `add -A` затащит всё — ограничить в описании задачи: шаг предлагается только при `init` (то есть в дереве без истории), в upgrade-репозитории коммит не делается.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-07 21:18
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/core/gitignore.ts
- src/core/git-init.ts
- src/core/setup.ts
- src/cli/commands/init-wizard.ts
- src/cli/commands/init.ts
- src/web/setup-api.ts
- src/cli/commands/doctor.ts
- src/core/gitignore.test.mjs
- src/core/git-init.test.mjs
- src/cli/init-git.test.mjs
- I'll start by orienting in the project structure and reading the key files.
Now I'll create the new `gitignore` module.
Now add imports and the git step in `applySetup`.
Now the interactive wizard step (after components step, before return).
Now `init.ts`: flag conflict validation, warning, and `.en…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 922 с, payload 504997 байт_
Незакоммиченные изменения сохранены в ветку: коммит `a8e7a05`.
---
author: @agent
created: 2026-11-07 21:18
---
Фаза code не удалась (код выхода 1): окировок=0, payload последнего запроса=504997 байт (макс 504997), usage={"input_tokens":7554552,"output_tokens":53305,"cache_read_input_tokens":7432704,"total_tokens":7607857,"reasoning_tokens":27165} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-07 21:19
---
Фаза 3 (Code) выполнена. Коммит d9ce41f (ветка vb/vl-348).
**Новые модули**
- `src/core/gitignore.ts` — `ROOT_GITIGNORE_TEMPLATE`, `VIBELOG_GITIGNORE_TEMPLATE`, `mergeGitignore` (блок с маркерами `# >>> vibelog` / `# <<< vibelog`, идемпотентность байт-в-байт, посторонние строки сохраняются, `.DS_Store`/`*.log` в чужой файл не навязываются), `writeRootGitignore` → `created|updated|unchanged`, `writeVibelogGitignore` → `created|exists`, `vibelogGitignoreDiffers` (расхождение по значимым строкам). Атомарная запись temp+rename (lesson-169), пути в `cwd`, не в `rev-parse --show-toplevel`.
- `src/core/git-init.ts` — `isInsideGitRepo`, `gitInit` (идемпотентен: `reason: 'exists'`; ветка `main` через `symbolic-ref` с фолбэком — git 2.24 на Catalina), `initialCommit` (add -A + коммит с трейлером через `commitMessageArgs`, VL-302), `addRemote` (существующий origin не перезаписывается без `force`, валидация http(s)/ssh/scp), `isValidRemoteUrl`. Отсутствие git → `{ok:false, reason:'no-git'}` без исключения.
**Правки**
- `src/core/setup.ts` — `SetupAnswers.git?`, `SetupState.git.inRepo`; шаг 4b `applyGitignoreStep` (gitignore ДО коммита) и шаг 7 `applyGitStep` (init → коммит только в свежем дереве → remote); `formatSetupLog` печатает состояние git.
- `src/cli/commands/init-wizard.ts` — шаг 8 в `runWizard` (вопросы «Инициализировать git-репозиторий?» → «Сделать первый коммит?» → «Добавить remote (origin)?» → URL; внутри репозитория вопросы пропускаются), `gitAnswersFromFlags` (`--git-init`/`--no-git-init`/`--git-remote`).
- `src/cli/commands/init.ts` — конфликт `--git-init`/`--no-git-init` → код 1; предупреждение «проект не в git, .env с секретами не защищён» (код 0); в `runChecks` — `git check-ignore .env`.
- `src/cli/commands/doctor.ts` — новое правило `root_gitignore_exists` (нет `.gitignore` при существующем `.env` → не ok); пять проверок VL-329 не тронуты.
- `src/web/setup-api.ts` — необязательное поле `git` в payload, терпимый `parseGitBody` (нет поля → git не трогаем).
- `src/cli/router.ts` — справка `init`: `--git-init`, `--no-git-init`, `--git-remote`.
**Тесты (новые)**: `src/core/gitignore.test.mjs` (9), `src/core/git-init.test.mjs` (8), `src/cli/init-git.test.mjs` (9, реальный CLI в mkdtemp); дополнены `src/core/setup.test.mjs` (+4) и `src/cli/diagnostics.test.mjs` (+3).
**Проверки**: `pnpm build` — ok; полный `pnpm test` — 187 файлов, 3488 passed, 4 skipped, 0 failed (первый прогон дал 1 падение в `src/web/orchestrator.test.mjs` — тест VL-277 про автокоммит close; изолированный повтор этого файла зелёный (88/88), повторный полный прогон тоже зелёный → флак от параллельного прогона, не регрессия diff'а).
**Замечание по AC4**: на git 2.24 `git check-ignore -q` возвращает 0 и для путей, совпавших с `!`-правилом (отрицание), поэтому политика проверена по факту индексации (`git add -A` + `git ls-files`): `.env` и `backlog/references/data/` в индексе отсутствуют, `.vibelog/settings.json`, `.vibelog/billing/x.json`, `.vibelog/.gitignore` — присутствуют. Это ровно то, что делает первый коммит init.
**Что осталось (не в фазе Code)**: AC16 — документация (doc-7 раздел `init`, CHANGELOG, AGENTS.md) пишется в фазе Close; DoD «Документация обновлена» поэтому не отмечен. Живой прогон `vb init --yes --git-init --git-remote` в отдельном каталоге выполнить не удалось: инструмент shell запрещает выход за пределы worktree, а внутри worktree `init` видит существующий `backlog/` — сценарий покрыт интеграционным тестом `src/cli/init-git.test.mjs` (реальный CLI в mkdtemp, включая `git log`, `git remote -v`, `git ls-files`, `doctor --json`).
---
author: @agent
created: 2026-11-07 21:20
---
Фаза Close прервана: конфликт слияния vb/vl-348 → master (файлы: UU src/cli/commands/doctor.ts). Ветка vb/vl-348 содержит 1 коммит (d9ce41f), worktree чистый. Конфликт не резолвился и merge не откатывался — состояние оставлено как есть для ручного разбора. Требуется: разработчику вручную разрешить конфликт в src/cli/commands/doctor.ts в главном репозитории (свести новое правило root_gitignore_exists из VL-348 с изменениями master), выполнить `git add src/cli/commands/doctor.ts && git commit` (завершить merge), затем повторить Фазу Close для VL-348.
---
author: @agent
created: 2026-11-07 21:20
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-348 → master (файлы: UU src/cli/commands/doctor.ts). Ветка vb/vl-348 содержит 1 коммит (d9ce41f), worktree чистый. Конфликт не резолвился и merge не откатывался — состояние оставлено как есть для ручного разбора. Требуется: разработчику вручную разрешить конфликт в src/cli/commands/doctor.ts в главном репозитории (свести новое правило root_gitignore_exists из VL-348 с изменениями master), выполнить `git add src/cli/commands/doctor.ts && git commit` (за — статус возвращён к Review.
---
author: @agent
created: 2026-11-07 21:28
---
Фаза Close выполнена. Ветка vb/vl-348 слита в master (1 коммит d9ce41f, merge-коммит cb36d92 после ручного разрешения конфликта в src/cli/commands/doctor.ts), worktree удалена (--force: только untracked-симлинк backlog/references/data и ignored-артефакты), ветка vb/vl-348 удалена.
**Проверки после merge**: `pnpm build` — ok; ранний точечный прогон (gitignore/git-init/setup/init-git/diagnostics) — 74 passed; полный `npx vitest run` — 193 файла, 3597 passed, 4 skipped, 0 failed. Повторных полных прогонов не было.
**Документация (AC16)**: doc-7 — раздел `init` дополнен блоком «Git-политика (VL-348)», флагами `--git-init`/`--no-git-init`/`--git-remote` и примером; CHANGELOG — запись в Unreleased → Добавлено; AGENTS.md — пункт «Git-политика `.vibelog/`» дополнен тем, что оба файла политики создаёт `vb init` до первого коммита. Коммит 968e89f. Инвариант-тесты `phase-prompt.test.mjs` (95) и `readme-standard.test.mjs` (3) после правки AGENTS.md зелёные.
**Lessons**: создан lesson-243 (проверять git-политику по факту индексации, а не через `git check-ignore -q` — на git 2.24 отрицания дают ложный «игнорируется»), связан с задачей; коммит 80f3b0e.
**DoD**: 1 «Тесты проходят» — да (полный прогон зелёный); 2 «Документация обновлена» — да (doc-7, CHANGELOG, AGENTS.md); 3 «Нет регрессий» — да (полный прогон 0 failed, create.test.mjs зелёный).
---
<!-- COMMENTS:END -->