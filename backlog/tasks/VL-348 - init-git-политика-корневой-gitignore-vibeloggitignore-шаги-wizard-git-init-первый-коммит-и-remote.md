---
id: VL-348
title: 'init: git-политика (корневой .gitignore + .vibelog/.gitignore), шаги wizard «git init», первый коммит и remote'
status: Planned
assignee: []
reporter: ''
created_date: '2026-11-07 12:55'
updated_date: '2026-11-07 12:55'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
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
- [ ] #1 `vb init` в каталоге без `.gitignore` создаёт корневой `.gitignore` с минимальным набором: `node_modules/`, `dist/`, `backlog/references/data/`, `backlog/references/cache/`, `.env`, `.DS_Store`, `*.log`
- [ ] #2 `vb init` при существующем чужом `.gitignore` дописывает только отсутствующие правила в блоке с маркерами и не меняет посторонние строки; повторный запуск идемпотентен байт-в-байт
- [ ] #3 `vb init` создаёт `.vibelog/.gitignore` с политикой VL-329 (`*`, `!*/`, `!.gitignore`, `!config.json`, `!installed.lock.json`, `!settings.json`, `!prompts/`, `!prompts/**`, `!billing/`, `!billing/**`, `worktrees/`), если файла нет; существующий файл не перезаписывается, расхождение печатается предупреждением
- [ ] #4 `git check-ignore -v .env .vibelog/settings.json .vibelog/billing/x.json backlog/references/data/x` после `vb init` даёт: `.env` и `backlog/references/…` игнорируются, `.vibelog/settings.json` и `billing/` — нет
- [ ] #5 Wizard спрашивает «Инициализировать git-репозиторий?», если проект не внутри git; при «да» выполняется `git init`, ветка `main` (с фолбэком на дефолт git для git < 2.28) и первый коммит
- [ ] #6 Первый коммит НЕ содержит `.env`: `git ls-files | grep '^\.env$'` пуст
- [ ] #7 После init (если пользователь согласился) wizard спрашивает «Добавить remote (origin)?», при «да» — URL и `git remote add origin <url>`; существующий `origin` не перезаписывается без явного согласия
- [ ] #8 Если проект уже внутри git-репозитория, шаги git init/remote не предлагаются и ничего не меняется
- [ ] #9 Non-interactive путь: `--git-init` инициализирует и коммитит, `--no-git-init` — нет; флаги взаимоисключающие и при конфликте дают ошибку с кодом 1, как `--components`/`--no-components`
- [ ] #10 `--yes` без `--git-init` вне git-репозитория печатает предупреждение «проект не в git, `.env` с секретами не защищён», но завершается с кодом 0
- [ ] #11 Отсутствие `git` в PATH — предупреждение, а не ошибка: проект создан, код 0
- [ ] #12 `vibelog doctor` получает проверку `root_gitignore_exists`: нет корневого `.gitignore` при существующем `.env` → проверка не ok; существующие пять проверок git-политики VL-329 не меняют поведение
- [ ] #13 `vb create` по-прежнему делает один `git init` и один коммит (общий код идемпотентен, двойного init нет), тесты `src/core/create.test.mjs` зелёные
- [ ] #14 Веб-мастер `#/setup` не падает: поле `git` в payload необязательное, при отсутствии git-шаг пропускается с предупреждением
- [ ] #15 Тесты: `src/core/gitignore.test.mjs`, `src/core/git-init.test.mjs`, интеграционный `vb init --yes --git-init` в temp-каталоге (репозиторий, один коммит, `.env` не в индексе, `doctor` зелёный); `pnpm build && pnpm test` зелёные
- [ ] #16 Документация обновлена: doc-7 (раздел `init` — шаги git-политики и git), CHANGELOG, AGENTS.md (политика `.vibelog/` теперь создаётся init)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
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