---
id: doc-25
title: 'vb CLI, реестр UI-компонентов и шаблоны проектов — спецификация (v1.3)'
type: specification
created_date: 2026-11-03
tags: []
---
# Спецификация: `vb` CLI, реестр UI-компонентов и шаблоны проектов

Статус: v1.3 — решения по открытым вопросам приняты, API GitVerse проверен спайком, определено расположение репозиториев. Документ нормативный. Обоснования — в ADR `decision-6` … `decision-11` (каталог `backlog/decisions/`).

Ссылки на решения:
- decision-6 — стек: Svelte 5 Runes + SvelteKit, Tailwind CSS
- decision-7 — микро-shadcn: код компонентов копируется в проект, zero runtime dependencies
- decision-8 — реестр на GitVerse, формат shadcn, разделение `src/` и `public/r/`
- decision-9 — три команды `create` / `init` / `install`, служебное только в `.vibelog/`
- decision-10 — версионирование хешами в `.vibelog/installed.lock.json`
- decision-11 — шаблоны: монорепозиторий, метаданные в `package.json`, `sparse-checkout`

## История версий

**v1.1 относительно v1:**
1. Отдельный `.vibelog/config.json` отменён — секция `components` в `.vibelog/settings.json`.
2. `vb init` — расширение существующего `vibelog init`.
3. `target` — без дублирующего префикса `ui/`.
4. Правило «один компонент — один каталог» отменено.
5. Корневой элемент — `vibelog.md/ui/base`.
6. Версия элемента — ручная в `registry.json`.
7. Код `4` — только если пропущены все файлы.
8. Тесты — `VIBELOG_REGISTRY_BASE_URL` + локальный фикстур.
9. Git-политика `.vibelog/` — собственный `.vibelog/.gitignore`.

**v1.2 относительно v1.1 (спайк GitVerse, §10):**
1. Ветка по умолчанию — `master`.
2. Отсутствующий файл — HTTP `400` (не 404).
3. `content-type` успеха — `text/plain`, валидация только парсингом.
4. HEAD запрещён (403).
5. `sparse-checkout` подтверждён; cone-режим тянет корневые файлы.
6. `--filter=blob:none` поддерживается, fallback на zip не нужен.

**v1.3 относительно v1.2:**
1. Добавлен §11: каждый репозиторий — самостоятельный проект Vibelog.md со своим `backlog/` (§11).
2. Задачи по реестру `ui` и шаблонам `templates` ведутся в этих репозиториях, а не в Vibelog.md.

---

## 1. Назначение и границы

### 1.1. Назначение

Инфраструктура даёт агенту и человеку три операции над проектом:

1. создать новый проект из шаблона (`vb create`);
2. подключить Vibelog.md к существующему репозиторию (`vb init`);
3. доставить в проект исходный код компонента (`vb install`).

Основа — модель shadcn: **код компонента принадлежит проекту**, копируется из реестра по HTTP и свободно правится агентом. Версионирование ведётся хешами файлов, а не semver-диапазонами.

### 1.2. Границы первой версии

**Входит:**
- `vb create` с клонированием подпапки шаблона (`sparse-checkout`);
- `vb init` — расширение существующего wizard-а: секция `components` + `installed.lock.json`;
- `vb install` — доставка файлов, проверка `dependencies` и `registryDependencies` одного уровня, запись lock;
- реестр `Vibelog-md/ui` с корневым элементом `base` и компонентами `Button`, `Input`, `Label`, `Card`;
- шаблон `svelte-minimal` в `Vibelog-md/templates`.

**Явно не входит:**
- `vb update` (манифест собирает данные с первого дня);
- рекурсивное разрешение `registryDependencies` (один уровень);
- компоненты MAX Bridge (`window.WebApp`, `HapticFeedback`);
- компоненты на `bits-ui` (Dialog, DropdownMenu);
- синтаксис `host/owner/repo/component` и несколько хостов;
- кэш скачанных JSON и офлайн-режим.

---

## 2. Бинарь и команды

`vb` — алиас существующего бинаря `vibelog` (`package.json`: `bin.vb → ./bin/vibelog.mjs`). Отдельного пакета нет.

### 2.1. `vb create`

```
vb create <name> --template <registry-alias>/<repo>/<template> [флаги]
```

| Флаг | Назначение |
|---|---|
| `--template <p>` | обязателен; `vibelog.md/templates/svelte-minimal` |
| `--branch <b>` | ветка шаблона; по умолчанию из записи реестра (**`master`**) |
| `--package-manager <npm\|pnpm\|bun>` | без флага — интерактивный вопрос |
| `--no-install` | не устанавливать зависимости |
| `--no-git` | без `git init` и первого коммита |
| `--yes` | без вопросов, дефолты на всё |

Поведение:
- создаёт `./<name>` в текущем каталоге, без дополнительных вопросов;
- имя по npm-правилам: lowercase, допустимы `-`, `_`, `.`; иначе код `1`;
- каталог существует — код `2`; `--force` не предусмотрен;
- `git init` + первый коммит, если нет `--no-git`.

### 2.2. `vb init` — расширение существующей команды

`vibelog init` уже существует (`src/cli/commands/init.ts`): режимы `fresh`/`upgrade`, флаги `--force`, `--mode`, `--web`, `--yes`; создаёт `backlog/`, `config.yml`, `AGENTS.md`, `.env`, пишет `.vibelog/settings.json`.

```
vb init [--components | --no-components] [существующие флаги]
```

| Флаг | Назначение |
|---|---|
| `--components` | добавить секцию `components` в `.vibelog/settings.json` и создать `installed.lock.json` |
| `--no-components` | не трогать секцию `components` |

Правила:
- нового файла не появляется: конфигурация — секция `components` (см. §3.1);
- интерактив — вопрос wizard-а с дефолтом «да»; `--yes` без флага — секция создаётся;
- `installed.lock.json` — `schemaVersion` + пустой список;
- **не знает про стек проекта** (не проверяет Tailwind/фреймворк/`package.json`);
- идемпотентен: дополняет недостающее, не перезаписывая заданное;
- `settings.json` и `installed.lock.json` коммитятся в git (§3.6).

**Реализовано в VL-336.** `defaultComponentsConfig(cwd)` и `mergeComponentsConfig(existing, defaults)` живут в `src/core/components-config.ts` (рядом со схемой VL-333); применение — `applyComponentsStep` в `src/core/setup.ts` после записи основных настроек. Уточнения по факту реализации:

- флаги разбираются в `runInit` (`src/cli/commands/init.ts`) как взаимоисключающие: одновременная передача `--components` и `--no-components` → ошибка использования с кодом `1`, файлы не пишутся;
- запись в `settings.json` — read-modify-write: чужие секции (`chats`, `models`, `providers`, `workflows`, `mcpServers`, неизвестные ключи) сохраняются, порядок ключей стабилен (повторный прогон даёт файл байт-в-байт); без `--force` — слияние «дополнить недостающее», с `--force` — перезапись секции дефолтами;
- `installed.lock.json` создаётся только при отсутствии — существующий не перезаписывается (в выводе «Пропущено»);
- `--web` шаг не поддерживает: секция создаётся по дефолту (как `--yes`), `--no-components` печатает пояснение;
- `src/web/setup-api.ts` (`parseSetupBody`) заполняет `components.enabled` из тела веб-мастера (по умолчанию `true`);
- справка CLI — `src/cli/router.ts`, документация — doc-7 (раздел `init`), CHANGELOG.

### 2.3. `vb install`

```
vb install <registry-alias>/<repo>/<component> [флаги]
```

| Флаг | Назначение |
|---|---|
| `--yes` | без вопросов |
| `--force` | перезаписать конфликтующие файлы |
| `--dry-run` | показать план и выйти |
| `--branch <b>` | переопределить ветку реестра |

Разбор: `[0]` — ключ в `registries`; `[1]` — репозиторий (`ui`); `[2]` — имя элемента. Иное число сегментов — код `1`.

---

## 3. Схемы файлов

### 3.1. Секция `components` в `.vibelog/settings.json`

```json
{
  "components": {
    "schemaVersion": 1,
    "registries": {
      "vibelog.md": { "owner": "Vibelog-md", "branch": "master" }
    },
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

Правила:
- пути в `aliases` — **относительно корня проекта**: CLI не читает `svelte.config.js`;
- `registries` — карта «алиас → {owner, branch}»; репозиторий берётся из пути команды;
- `owner` не содержит точку (ограничение GitVerse) — алиас с точкой однозначно отличим;
- **`branch` по умолчанию — `master`** (спайк, §10);
- `urlTemplate` не хранится — зашит в CLI (переопределяется `VIBELOG_REGISTRY_BASE_URL` для тестов);
- в будущем `branch` допускается как объект `{ "default": "master", "ui": "master" }` без ломающей миграции;
- `components.schemaVersion` — целое, несовпадение → код `2`;
- отсутствие секции — не ошибка: `vb install` сообщает «выполните `vb init --components`» (код `2`).

### 3.2. `.vibelog/installed.lock.json`

```json
{
  "schemaVersion": 1,
  "components": {
    "button": {
      "version": "1.0.0",
      "installedAt": "2026-11-03T12:00:00.000Z",
      "dependencies": ["clsx", "tailwind-merge"],
      "files": {
        "src/lib/components/ui/button.svelte": {
          "hash": "sha256:abc123...",
          "sourceVersion": "1.0.0"
        }
      }
    },
    "card": {
      "version": "1.0.0",
      "installedAt": "2026-11-03T12:05:00.000Z",
      "dependencies": ["clsx", "tailwind-merge"],
      "files": {
        "src/lib/components/ui/card/card.svelte": {
          "hash": "sha256:def456...",
          "sourceVersion": "1.0.0"
        },
        "src/lib/components/ui/card/card-header.svelte": {
          "hash": "sha256:789abc...",
          "sourceVersion": "1.0.0"
        }
      }
    }
  }
}
```

Правила:
- `hash` — `sha256:` + hex от содержимого **записанного** файла;
- `version` — версия на момент установки; `sourceVersion` — версия в реестре (разводятся для будущего `vb update`);
- `dependencies` — npm-пакеты, подтверждённо установленные;
- запись атомарна; хранится в git;
- **владение файлом**: каждый файл принадлежит ровно одному элементу. Совпадающий хеш при повторной установке — переиспользование; расхождение — конфликт (§4.3 шаг 8).

### 3.3. JSON элемента реестра (`public/r/<name>.json`)

```json
{
  "name": "button",
  "type": "registry:ui",
  "version": "1.0.0",
  "dependencies": ["clsx", "tailwind-merge"],
  "registryDependencies": ["vibelog.md/ui/base"],
  "files": [
    {
      "path": "src/lib/components/ui/button.svelte",
      "target": "button.svelte",
      "type": "registry:ui"
    }
  ]
}
```

Мультифайловый элемент (`card`):

```json
{
  "name": "card",
  "type": "registry:ui",
  "version": "1.0.0",
  "dependencies": ["clsx", "tailwind-merge"],
  "registryDependencies": ["vibelog.md/ui/base"],
  "files": [
    { "path": "src/lib/components/ui/card/card.svelte", "target": "card/card.svelte", "type": "registry:ui" },
    { "path": "src/lib/components/ui/card/card-header.svelte", "target": "card/card-header.svelte", "type": "registry:ui" }
  ]
}
```

Правила:
- `dependencies` — имена npm-пакетов без версий;
- `registryDependencies` — `<alias>/<repo>/<name>`, разрешается **один уровень**;
- `files[].path` — путь в репозитории реестра;
- `files[].target` — путь **относительно `aliases.ui`**, без префикса `ui/`;
- **структуру задаёт `target`**: один файл — плоско (`button.svelte`), несколько — каталог (`card/card.svelte`);
- `target` не выходит за корень проекта (абсолютные пути и `..` отклоняются при сборке и в CLI, код `3`);
- `version` — **ручная** в `registry.json`; сборка валидирует `X.Y.Z`, из git-тега не выводит;
- схема валидируется при сборке; невалидный элемент не попадает в выдачу.

### 3.4. `registry.json` реестра

```json
{
  "$schema": "https://ui.shadcn.com/schema/registry.json",
  "name": "vibelog-ui",
  "homepage": "https://gitverse.ru/Vibelog-md/ui",
  "items": [
    {
      "name": "base",
      "type": "registry:lib",
      "version": "1.0.0",
      "files": [
        { "path": "src/lib/utils.ts", "target": "../utils.ts", "type": "registry:lib" }
      ]
    },
    {
      "name": "button",
      "type": "registry:ui",
      "version": "1.0.0",
      "registryDependencies": ["vibelog.md/ui/base"],
      "files": [
        { "path": "src/lib/components/ui/button.svelte", "target": "button.svelte", "type": "registry:ui" }
      ]
    }
  ]
}
```

Структура репозитория:

```
ui/
├── registry.json
├── package.json
├── src/lib/utils.ts                  # корневой элемент base
├── src/lib/components/ui/<name>...   # исходники компонентов
├── public/r/<name>.json              # сгенерированное, раздаётся по HTTP
└── README.md
```

`public/r/` пересобирается детерминированно и **коммитится** (GitVerse раздаёт файлы из репозитория, а не собирает на лету). `vb install` читает **только** `public/r/`.

**Корневой элемент — `base`** (не `ui`): репозиторий называется `ui`, элемент `ui` дал бы путь `vibelog.md/ui/ui`. `base` содержит `utils.ts` с `cn`, общие типы и CSS-переменные; файлы `registry:lib` раскладываются через алиас `utils`/`css`, а не `ui`.

### 3.5. `package.json` шаблона

```json
{
  "name": "svelte-minimal",
  "version": "0.1.0",
  "description": "SvelteKit minimal + Tailwind + .vibelog/",
  "scripts": { "postCreate": "vb init --components --yes" },
  "vibelog": { "type": "template", "components": [] }
}
```

Правила:
- `vibelog.type === "template"` — обязательная проверка; иначе код `3`;
- `scripts.postCreate` — после установки зависимостей; способ вызова `vb` фиксируется в шаблоне;
- `vibelog.components` — пути вида `vibelog.md/ui/button`, устанавливаемые после `postCreate`.

### 3.6. Git-политика `.vibelog/`

Реализовано в VL-329: корневой `.gitignore` не игнорирует `.vibelog/` целиком; политика в `.vibelog/.gitignore` («запрещаем всё, разрешаем явно»: `*`, `!*/`, затем исключения).

| Коммитится | Игнорируется |
|---|---|
| `settings.json` (в т.ч. `components`) | `agent-sessions/`, `chat-sessions/` |
| `installed.lock.json` | `cache/`, `tmp/`, `qwen-debug/` |
| `prompts/` | `supervisor/`, `worktrees/` |
| `billing/` | `*.log`, `idempotency.json`, `phase-in-progress.json`, `auto-queue.json` |

Секреты — только `.env` в корне проекта.

---

## 4. Потоки команд

### 4.1. `vb create`

1. Разобрать `--template`: alias → `registries` → `owner`; `[1]` → repo; `[2]` → шаблон.
2. Проверить имя проекта и отсутствие каталога.
3. Временный каталог в `os.tmpdir()`:
   ```
   git clone --filter=blob:none --no-checkout --depth 1 --branch <branch> https://gitverse.ru/<owner>/<repo>.git <tmp>
   git -C <tmp> sparse-checkout init --cone
   git -C <tmp> sparse-checkout set <template>
   git -C <tmp> checkout <branch>
   ```
   Порядок обязателен: `sparse-checkout set` **до** `checkout`.
4. **Cone-режим разворачивает и корневые файлы репозитория** — это документированное поведение git, не ошибка. Копируется **только** `<tmp>/<template>`.
5. Предупреждение `filtering not recognized by server` выводится, если появится (на GitVerse не появляется).
6. Проверить `package.json` шаблона: `vibelog.type === "template"`.
7. Скопировать `<tmp>/<template>` в `./<name>`.
8. Удалить временный каталог.
9. Пакетный менеджер: флаг → интерактивный вопрос → `npm`. `--no-install` — пропустить.
10. Установить зависимости.
11. Выполнить `scripts.postCreate`.
12. Для каждого пути из `vibelog.components` — логика `vb install`.
13. Если не `--no-git`: `git init`, `git add -A`, первый коммит.

### 4.2. `vb init` (шаг «компоненты»)

1. Определить корень проекта.
2. Прочитать `.vibelog/settings.json` (нет — пустой объект).
3. Если секция `components` уже есть и нет `--force` — дополнить недостающие ключи, не перезаписывая заданные.
4. Записать секцию (атомарно).
5. Создать `.vibelog/installed.lock.json` (если файла нет).
6. Итог, код `0`.

### 4.3. `vb install`

1. Найти корень проекта и секцию `components`. Нет — «выполните `vb init --components`», код `2`.
2. Разобрать `alias/repo/name` (три сегмента, иначе код `1`).
3. Скачать `https://gitverse.ru/api/repos/<owner>/<repo>/raw/branch/<branch>/public/r/<name>.json` **методом GET** (HEAD запрещён). Ответ `400` — не найдено, код `3`, без ретраев; в диагностику — `message` из тела.
4. Валидировать JSON **парсингом тела** (`content-type` = `text/plain`).
5. **Разрешить `registryDependencies` (один уровень):** отсутствующие в lock — установить шагами 3–10 без их собственных зависимостей, с предупреждением.
6. **Проверить `dependencies`:** сверить с `package.json`. Отсутствующие — предложить установить; `--yes` — предупредить и продолжить; `--dry-run` — показать и выйти.
7. Целевые пути: `aliases.ui` + `target` для `registry:ui`; иные типы — через соответствующий алиас. Проверка выхода за корень.
8. **Конфликты:** файла нет — писать; хеш совпадает с lock — пропустить и обновить запись; хеш отличается — спросить (`перезаписать`/`пропустить`/`diff`); `--force` — перезаписать; `--yes` без `--force` — пропустить с предупреждением.
9. Записать во временный каталог внутри проекта, затем переместить.
10. Вычислить sha256, обновить `installed.lock.json` атомарно.
11. Удалить временный каталог, итог, код `0`.

**Атомарность:** при любой ошибке на шагах 7–10 временный каталог удаляется, целевые файлы не изменяются, lock не трогается.

**Реализовано в VL-337** (шаги 1–11 без 5–6 — `registryDependencies` и проверка npm-зависимостей вынесены в отдельную задачу). Уточнения по факту реализации:

- Ядро без CLI — `src/core/install.ts`: `parseInstallPath` (ровно три непустых сегмента, иначе код `1` с подсказкой формата), `resolveInstallContext` (корень проекта, секция `components`, lock, alias → код `2` со списком доступных; `--branch` приоритетнее `registries[alias].branch`), `fetchInstallItem`/`fetchInstallContents` (через `src/core/registry-fetch.ts`, ошибки дополняются контекстом элемента, код `3`), `buildInstallPlan` (чистая функция: `resolveAliasPath` по `aliasForType`, повторная проверка выхода за корень, `existing`/`existingHash`/`lockedHash`, действия `create`/`skip-identical`/`conflict`), `resolveConflicts`/`forceOverwrite`/`skipAllConflicts`, `applyInstallPlan`, `diffLines` (построчный diff без внешних зависимостей, лимит 40 строк).
- `aliasForType`: `registry:ui` → `ui`, `registry:lib` → `utils`, `registry:hook` и `registry:component` → `components`.
- `src/core/registry-fetch.ts` дополнен `fetchRegistryFile` (скачивание `files[].path`); цикл ретраев вынесен в общий `fetchTextWithRetries`, чтобы манифест и файлы шли по одной сетевой политике.
- **Атомарность:** temp-каталог создаётся внутри проекта (`.vibelog/tmp/install-<pid>-<rand>/`, не `os.tmpdir()` — `rename` между файловыми системами не работает); сначала пишутся все файлы, затем существующие цели копируются в `temp/backup/`, затем `rename` на целевые места, затем `writeLock`. Сбой на любом шаге — откат из бэкапа, temp удаляется в `finally`, lock не трогается, код `3`.
- **Идемпотентность:** при совпадении всех хешей и записи lock файлы не перезаписываются, `installedAt` не обновляется, lock остаётся побайтово тем же.
- `--dry-run` печатает план и выходит с `0`, не создавая даже temp-каталог.
- CLI — `src/cli/commands/install.ts` (флаги `--yes`/`--force`/`--dry-run`/`--branch`, неизвестный флаг → код `1`, интерактивные конфликты через `createPromptSession`, `PromptCancelledError` → код `5`), регистрация — `src/cli/router.ts`.

**Реализовано в VL-338** (шаги 5–6 — `registryDependencies` и проверка npm-зависимостей). Уточнения по факту реализации:

- **Пакетный менеджер** — `src/core/install-deps.ts`: `detectPackageManager` по lock-файлу в корне (`pnpm-lock.yaml` → pnpm, `bun.lockb`/`bun.lock` → bun, `yarn.lock` → yarn, `package-lock.json` → npm; несколько — приоритет pnpm → bun → yarn → npm; ни одного → npm), `installCommand` возвращает **массив аргументов** (`pnpm add <pkgs>` и т.п.), запуск — `spawnSync` без shell (как в `core/git.ts`), раннер инъектируется параметром (тесты мокают без подмены `child_process`); `ENOENT` (менеджер не установлен) → fallback на `npm` с предупреждением.
- **Сверка `dependencies`:** `readProjectDeps` — объединение `dependencies` и `devDependencies` из `package.json` (нет/битый файл → пустое множество, не ошибка — decision-9); `missingDeps` сохраняет порядок объявления из элемента. Проверка идёт **только по декларации в JSON реестра** — CLI не содержит списка известных пакетов (decision-9 п.8).
- **Поведение по флагам:** `--dry-run` печатает секцию «зависимости: отсутствуют N, команда `<pm> add ...>`» и выходит; `--yes` (и не-TTY) **не устанавливает** пакеты — выводит предупреждение со списком и готовой командой, установка файлов продолжается (молчаливая правка `package.json` недопустима); интерактив — `p.confirm` с `initialValue: true`, отказ не отменяет установку файлов, но итоговый блок сообщает «компонент может не работать без пакетов». Ненулевой код пакетного менеджера — предупреждение, не ошибка установки файлов.
- **Lock:** после успешной установки `package.json` перечитывается, в `lock.components[<name>].dependencies` попадают только **подтверждённо установленные** пакеты (§3.2).
- **`registryDependencies`** — `src/core/install-registry-deps.ts`: `parseRegistryRef` (три сегмента, иначе ошибка с указанием элемента-источника; ссылка на чужой alias — код `3`), `resolveRegistryDeps` — **один уровень**: отсутствующая в lock зависимость скачивается и планируется целиком, уже установленная не переустанавливается (расхождение `version` с реестром — предупреждение), `depth >= 1` → предупреждение «зависимости второго уровня не разрешаются (v1)», цикл `A → B → A` ловится множеством посещённых имён в пределах вызова (без рекурсии). Порядок применения: сначала планы зависимостей в порядке объявления, затем сам элемент — `base` оказывается на месте до компонента.
- **Владение файлами:** `checkFileOwnership` — файл, уже записанный другим элементом с совпадающим хешем, помечается `reuse` (не перезаписывается, в lock родителя **не** дублируется, в выводе «файл переиспользован из `<элемент>`»); расхождение хешей — `conflict` по правилам VL-337. `checkChainOwnership` учитывает планы, идущие раньше в цепочке (файл `base` ещё не в lock, но уже запланирован), `transferOwnership` переносит владение.
- **Атомарность цепочки:** `applyInstallChain` — одна транзакция на все планы (зависимости + элемент): один temp-каталог, все файлы стейджатся, затем бэкап, затем перемещения, один `writeLock` в конце; сбой на любой зависимости откатывает все перемещения, lock не меняется.
- Тесты: `src/core/install-deps.test.mjs` (18 кейсов), `src/core/install-registry-deps.test.mjs` (18 кейсов — порядок `base` → `button`, идемпотентность, `--yes` с зависимостями, `--dry-run`, переиспользование файла, атомарность цепочки).

---

## 5. Сеть, ошибки и коды выхода

### 5.1. HTTP

- Шаблон: `https://gitverse.ru/api/repos/{owner}/{repo}/raw/branch/{branch}/{path}`.
- **Только GET.** HEAD → `403` (QRATOR).
- **Тестовое переопределение:** `VIBELOG_REGISTRY_BASE_URL` подменяет `https://gitverse.ru`; в обычной работе игнорируется.
- Таймаут — 30 с (`AbortController`).
- Ретраи: до 2 повторов (500 мс, 1500 мс) на сетевые ошибки и `5xx`. `4xx` (включая `400`) — без ретраев.
- Кэш и офлайн отсутствуют.
- Тело > 5 МБ — ошибка.

**Таблица ответов (спайк):**

| Ситуация | HTTP | Content-Type | Тело |
|---|---|---|---|
| файл есть | `200` | `text/plain; charset=utf-8` | содержимое файла |
| файла нет | `400` | `application/json;charset=utf-8` | `{"code":4305,"message":"File: <path> not found"}` |
| HEAD | `403` | `text/html` | — |

### 5.2. Коды выхода

| Код | Значение |
|---|---|
| `0` | успех, **в том числе частичный** (часть файлов пропущена — предупреждения в итоге) |
| `1` | ошибка использования: команда/флаг, имя проекта, число сегментов пути |
| `2` | предусловие: нет секции `components`, каталог существует, `schemaVersion`, отмена перезаписи |
| `3` | сеть/данные: HTTP-ошибка (`400` в т.ч.), таймаут, невалидный JSON, невалидный `target`, `vibelog.type !== "template"` |
| `4` | конфликт: **все** файлы пропущены (неинтерактив без `--force`) |
| `5` | отмена пользователем (Ctrl+C, `p.isCancel`) |

### 5.3. Вывод

- Интерактив — `@clack/prompts` по образцу `sv` (ref-25): `p.group`, `p.select` с `initialValue`/`hint`, `p.isCancel` после каждого промпта, `p.cancel` + код `5`.
- Не-TTY или `--yes` — без промптов, флаги и дефолты.
- Итоговый блок: что создано/установлено, зависимости, пропущенные файлы.
- Ошибки одной строкой с подсказкой действия, без стектрейсов.

---

## 6. Правила для агента в шаблоне

`CLAUDE.md` в корне шаблона (для Cursor — `.cursorrules`):

1. **Только Svelte 5 Runes.** Запрещено: `export let`, `$:`, `on:click` (`onclick`), `<slot>`/`$$slots` (`{@render children?.()}`, `$props()`), `createEventDispatcher` (коллбэки), `svelte:component`, `writable`/`readable` для локального состояния (`$state`, `$derived`, `$effect`).
2. **Только Tailwind.** Без `<style>`-блоков с кастомным CSS; классы утилитарные.
3. **Пути:** задаются `target` — один файл плоско, несколько в каталоге. Файлы `kebab-case`.
4. **Зависимости:** не добавлять npm-пакет, не объявив в реестре; при правке скопированного файла обновлять его хеш в `.vibelog/installed.lock.json`.

---

## 7. Порядок работ и критерии готовности первой версии

| Шаг | Содержание | Где ведётся | Готово, когда |
|---|---|---|---|
| 1 | шаблон `svelte-minimal` | `Vibelog-md/templates` | шаблон собирается и запускается |
| 2 | `vb create` | Vibelog.md | пустой каталог → работающий проект одной командой |
| 3 | реестр: `registry.json` + сборка | `Vibelog-md/ui` | `public/r/base.json` валиден, сборка детерминированна |
| 4 | `vb install` | Vibelog.md | `vb install vibelog.md/ui/button` даёт рабочий компонент и запись в lock |
| 5 | `Button` | `Vibelog-md/ui` | рендерится в шаблоне |
| 6 | `Input` + `Label` | `Vibelog-md/ui` | связка работает, хеши корректны |
| 7 | `Card` (мультифайловый) | `Vibelog-md/ui` | раскладка нескольких файлов и `target` |

Критерии готовности:
- `vb create` + `vb install` проходят с чистого листа без ручных правок;
- повторный `vb install` идемпотентен;
- при конфликте файл не затирается без `--force`;
- атомарность подтверждена тестом со сбоем на последнем файле;
- lock содержит корректные хеши;
- ни одна команда не создаёт файлов в корне проекта;
- e2e-тесты проходят на локальном HTTP-фикстуре через `VIBELOG_REGISTRY_BASE_URL`.

---

## 8. Принятые решения (бывшие открытые вопросы)

1. **Валидация схем** при чтении встроена в парсинг: битый JSON или несовпавший `schemaVersion` → код `2`.
2. **`--dry-run`** — человекочитаемый; `--json` не в v1.
3. **`vb install --list`** — не в v1.
4. **Версия элемента** — ручная в `registry.json`.
5. **Падение `postCreate`** — каталог сохраняется, ошибка с путём, код `3`.
6. **Имя `vb init`** — расширение `vibelog init`; конфигурация — секция `components`.
7. **Код при конфликтах** — `4` только если пропущены все; частичный успех — `0`.
8. **Имя корневого элемента** — `base`.
9. **Тесты без сети** — `VIBELOG_REGISTRY_BASE_URL` + локальный фикстур.
10. **Структура файлов** — задаётся `target`.
11. **Ветка по умолчанию** — `master`.
12. **Где живут репозитории** — каждый репозиторий самостоятельный проект Vibelog.md (§11).

---

## 9. Известные риски

- **`templates/` в Vibelog.md занят** промптами фаз (`templates/phases/`, `templates/prompts/`). Шаблоны проектов живут **только** в `Vibelog-md/templates`.
- **`zero runtime dependencies`** относится к реестру и шаблону; `cn` тянет `clsx` + `tailwind-merge` в проект-потребитель — это `dependencies` элемента `base`.
- **Валидация `aliases`** — проверяются и алиасы из `settings.json` (выход за корень → код `3`).
- **`content-type` не отражает содержимое** — единственная проверка — успешный `JSON.parse` + схема.
- **Коды ответов непривычны:** отсутствие файла — `400`, не `404`.
- **Границы проекта:** агент не может писать за пределами корня своего проекта — отсюда §11.

---

## 10. Результаты спайка GitVerse (2026-11-05)

| Проверка | Результат |
|---|---|
| raw-URL `GET /api/repos/{owner}/{repo}/raw/branch/{branch}/{path}` | `200`, содержимое корректно |
| `content-type` успеха | `text/plain; charset=utf-8` |
| несуществующий файл | `400` + `{"code":4305,"message":"..."}` |
| `curl -I` (HEAD) | `403` от QRATOR |
| ветка по умолчанию | `master` |
| `git clone --filter=blob:none` | поддерживается |
| размер клона с фильтром | ~65 KiB против ~5.33 MiB |
| `sparse-checkout init --cone` + `set` + `checkout` | работает; корневые файлы + запрошенный каталог |
| `core.sparseCheckout` / `Cone` | `true` / `true` |
| паттерны `info/sparse-checkout` | `/*`, `!/*/`, `/<dir>/` |
| git на машине проверки | 2.56.0 |

**Выводы:** fallback на zip не нужен; `sparse-checkout set` до `checkout`; HEAD не использовать; `400` = «не найдено».

---

## 11. Расположение репозиториев и ведение задач

Инфраструктура охватывает **три независимых репозитория**. Каждый — самостоятельный проект Vibelog.md со своим `backlog/`, своими задачами, lessons и агентскими сессиями.

| Репозиторий | Что содержит | Где ведутся задачи |
|---|---|---|
| `bobarev/Vibelog.md` | CLI `vb`/`vibelog` (`create`, `init`, `install`) | `backlog/` этого репозитория |
| `Vibelog-md/ui` | реестр: `registry.json`, `src/lib/`, сборка `public/r/` | `backlog/` репозитория `ui` |
| `Vibelog-md/templates` | шаблоны проектов (`svelte-minimal` и последующие) | `backlog/` репозитория `templates` |

### 11.1. Почему так

Инструменты агента ограничены **корнем проекта**:

- `resolveInProject` (`src/agent/tools.ts`) — чтение/запись только внутри проекта;
- `ensureTaskWorktree` создаёт worktree в `.vibelog/worktrees/<task>`, то есть внутри проекта;
- `git_commit` отклоняет пути и `cwd` вне проекта.

Значит код-фаза задачи физически не может работать с файлами другого репозитория. Варианты «клон внутри `.vibelog/external/`» и «симлинк наружу» отвергнуты: первый ломает сверку `modified_files` и требует ручной синхронизации клона, второй обходит границу доступа.

Самостоятельный backlog в каждом репозитории даёт: полный workflow фаз, свои lessons, независимый темп релизов и отсутствие обходных механизмов.

### 11.2. Как связаны задачи

- Задачи по CLI (`vb`-команды) живут в `bobarev/Vibelog.md` и ссылаются на doc-25 как на спецификацию.
- Задачи по реестру (`registry.json`, компоненты) живут в `Vibelog-md/ui`; в их описании — ссылка на doc-25 (внешний документ) и на версию схемы.
- Задачи по шаблонам живут в `Vibelog-md/templates`.
- **Спецификация doc-25 — единственный источник истины по контракту** и живёт в `bobarev/Vibelog.md`. Изменения контракта (схемы, коды, поведение) вносятся только здесь и версионируются.
- Изменение контракта, затрагивающее другой репозиторий, требует синхронной задачи там: ссылка на версию doc-25 в описании задачи обязательна.

### 11.3. Порядок работ между репозиториями

1. `Vibelog-md/ui` (задача «реестр») может идти параллельно с CLI — контракт зафиксирован в doc-25 §3.3–3.4.
2. `Vibelog-md/templates` (шаблон) не зависит от реестра, но зависит от `vb create` на этапе приёмки.
3. Приёмочная задача (`vb install` из чистого проекта) выполняется в `bobarev/Vibelog.md` и требует опубликованных `public/r/*.json` и шаблона в их репозиториях.

### 11.4. Что это меняет в doc-25

- Задачи по реестру и шаблонам **не создаются** в backlog `bobarev/Vibelog.md`; здесь остаются только задачи по CLI.
- Приёмка сквозного сценария (`vb create` → `vb install`) — здесь, как интеграционная.
