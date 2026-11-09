---
id: doc-25
title: 'vb CLI, реестр UI-компонентов и шаблоны проектов — спецификация (v1.3)'
type: specification
created_date: 2026-11-03
tags: []
---
# Спецификация: `vb` CLI, реестр UI-компонентов и шаблоны проектов

Статус: v1.3 — решения по открытым вопросам приняты, API GitVerse проверен спайком, определено расположение репозиториев. Уточнения v1.4 (VL-380, токен и ретраи `429` в §5.1, §9) и v1.5 (VL-381, прогресс сетевых операций и `--verbose` в §5.1, §5.3) — в истории версий. Документ нормативный. Обоснования — в ADR `decision-6` … `decision-11` (каталог `backlog/decisions/`).

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

**v1.4 относительно v1.3 (VL-380):**
1. §5.1: авторизация реестра — `Authorization: Bearer` из `GITVERSE_TOKEN` (токен необязателен), HTTP `429` ретраится с учётом `Retry-After`, лимит анонимных запросов повышен при авторизации.
2. §5.1: транспорт GitVerse общий для реестра и Issues-API (`src/core/gitverse-http.ts`), различия — параметры адаптеров.
3. §9: риск rate-limit закрыт токеном и ретраями.

**v1.5 относительно v1.4 (VL-381, наблюдаемость):**
1. §2.3: флаг `--verbose` у `vb install` (алиаса `-v` нет — он занят глобальным `--version`).
2. §5.1: транспорт получил хук `onProgress` (no-op по умолчанию) — события `request`/`response`/`waiting`/`error`.
3. §5.3: прогресс сетевых операций в stderr, немедленная диагностика `429` с оценкой бюджета, маскирование токена.

**v1.6 относительно v1.5 (VL-382, две схемы доступа):**
1. §5.1 переписан: без токена — анонимный raw (только `accept`), с токеном — Публичный API `api.gitverse.ru/repos/{owner}/{repo}/contents/{path}?ref={branch}` с `Authorization: Bearer` и `Accept: application/vnd.gitverse.object+json;version=1`, содержимое декодируется из base64.
2. §5.1: raw не принимает `Authorization` — заголовок не формируется ни при каком наличии токена (защищено тестом-регрессией и шапкой модуля с замерами); авторизация v1.4 в этой части отменена.
3. §5.1: тестовое переопределение баз — `GITVERSE_REGISTRY_BASE_URL` (обе схемы), алиасы `VIBELOG_REGISTRY_BASE_URL` (raw) и `VIBELOG_GITVERSE_API_BASE` (contents).
4. §5.1: лимит тела 8 МБ для `contents` (base64 удваивает размер), 5 МБ для raw.
5. §9: риск rate-limit переописан под две схемы; §10.1 — замеры 2026-11-09 и спайк Contents API.

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
| `--verbose` | прогресс сетевых операций: URL, HTTP-статус, номер и причина попытки, источник токена (`-v` **не** используется — занят глобальным `--version`) |

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
- `files[].target` — путь **относительно базы алиаса**, без дублирующего префикса (`ui/` для `registry:ui`). Алиас выбирается по `type`: `registry:lib` → `utils`, `registry:ui` → `ui`, `registry:hook`/`registry:component` → `components`;
- **структуру задаёт `target`**: один файл — плоско (`button.svelte`), несколько — каталог (`card/card.svelte`);
- **переходы вверх (`..`) в `target` зависят от типа алиаса** (VL-383):
  - для алиасов-**файлов** (`utils`, `css`) база — каталог файла-алиаса, поэтому `../<file>` легален: ровно один уровень вверх и именно имя файла (`../utils.ts` при `aliases.utils = "src/lib/utils.ts"` → `src/lib/utils.ts`). Глубже или в подкаталог — запрещено (`../sub/x.ts`, `../../evil.ts` → код `3`);
  - для алиасов-**каталогов** (`ui`, `components`) переходы вверх запрещены полностью;
- **итоговый путь обязан остаться внутри корня проекта** — иначе код `3`. Абсолютные пути, `~` и Windows-диск в `target` отклоняются всегда;
- проверка семантики путей живёт **в одном месте** — `resolveAliasPath` (там известен алиас и возможна финальная проверка «внутри проекта»). Валидация формы (`validateRegistryItem`) проверяет только непустоту, не-абсолютность и не-`~`; про `..` она ничего не знает — легальность `..` зависит от типа алиаса;
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
  "scripts": { "postCreate": "node ./scripts/init-vibelog.mjs" },
  "vibelog": { "type": "template", "components": [] }
}
```

Правила:
- `vibelog.type === "template"` — обязательная проверка; иначе код `3`;
- `scripts.postCreate` — после установки зависимостей;
- `vibelog.components` — пути вида `vibelog.md/ui/button`, устанавливаемые после `postCreate`.

**Способ вызова CLI из `postCreate` (VL-386).** Шаблон **не** пишет в скрипт `vb init …` — это резолвится через PATH и может попасть в чужую (устаревшую) версию CLI. Контракт:

1. `vb create` передаёт в окружение `postCreate` переменную `VIBELOG_BIN` — абсолютный путь к `.mjs`-энтрипоинту того CLI, который запустил `create` (`process.argv[1]`, `resolve()` + `realpathSync`, т.к. путь бывает относительным, а `node_modules/.bin/vb` — симлинк). Env мержится поверх `process.env` (PATH, HOME, токены нужны npm-скрипту), переменные агентской сессии (`VIBELOG_PHASE_*`, `VIBELOG_RUN_*`, `VIBELOG_SESSION_ID`, `VIBELOG_CWD`) отфильтровываются.
2. Дополнительно `vb create` в POSIX-системах ставит в начало `PATH` каталог-шим с исполняемыми `vb` и `vibelog` (`#!/bin/sh` + `exec <node> <bin> "$@"`) — на случай чужого шаблона, который всё ещё зовёт `vb` по имени. На Windows шим не создаётся (shell-скрипты не исполняются).
3. Шаблон вызывает CLI через файл `scripts/init-vibelog.mjs` (≈10 строк): если `VIBELOG_BIN` задан — `spawnSync(process.execPath, [bin, 'init', '--components', '--yes'], { stdio: 'inherit' })`, иначе fallback на `spawnSync('vb', [...])` из PATH; код выхода пробрасывается. Запуск через `process.execPath` — у `.mjs` может не быть executable-бита; `spawnSync` с массивом аргументов кроссплатформенен, `"$VIBELOG_BIN"` в npm-скрипте — нет.
4. Верификация: после успешного `postCreate` `vb create` проверяет, что секция `components` в `.vibelog/settings.json` появилась. Её нет при непустом `vibelog.components` — предупреждение «вероятно, шаблон вызвал устаревший `vb` из PATH; обновите vibelog.md или проверьте VIBELOG_BIN»; создание проекта при этом не валится.

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
11. Выполнить `scripts.postCreate` с окружением `process.env` + `VIBELOG_BIN` (абсолютный путь к своему `.mjs`-энтрипоинту из `process.argv[1]`; переменные агентской сессии `VIBELOG_PHASE_*`/`VIBELOG_RUN_*`/`VIBELOG_SESSION_ID`/`VIBELOG_CWD` отфильтрованы). На POSIX в начало `PATH` подставляется каталог-шим с `vb`/`vibelog`, указывающими на тот же энтрипоинт. Так версия CLI, создавшая проект, и версия, выполнившая `postCreate`, не могут разъехаться (§3.5). Если `process.argv[1]` пуст или не существует — `VIBELOG_BIN` не передаётся, в `warnings` добавляется предупреждение, `postCreate` падает обратно на `vb` из PATH (совместимое поведение со старыми шаблонами). В том же окружении передаётся маркер контекста `VIBELOG_CREATE` (VL-389): `1` — git-шаг впереди (не `--no-git`), `no-git` — репозитория не будет. Значение вычисляет `createMarkerValue(noGit)`, читает — `readCreateContext(env)` (оба из `src/core/env-markers.ts`, чтобы обе стороны импортировали имя, а не строковый литерал). При наличии маркера `vb init` не печатает предупреждение «Проект не в git: .env с секретами не защищён» (при `no-git` **печатает** — репозитория правда не будет), не печатает финальную подсказку «Дальше: vibelog task create …» (её место занимает итоговый блок `vb create`) и сообщает про существующий `AGENTS.md` нейтрально («AGENTS.md из шаблона сохранён») вместо «Пропущено:». Прямой запуск `vb init` (без маркера) ведёт себя как раньше; подавление не влияет на код выхода `postCreate` (0).
12. **Верификация `postCreate`:** проверить, что секция `components` появилась в `.vibelog/settings.json`. Нет при непустом `vibelog.components` — предупреждение с явной причиной (устаревший `vb` из PATH) в `result.warnings` и в итоговом блоке; создание проекта не прерывается.
13. Для каждого пути из `vibelog.components` — логика `vb install`.
14. Если не `--no-git`: `git init`, `git add -A`, первый коммит.

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

**Две схемы доступа (VL-382).** Выбор транспорта — `resolveRegistryTransport(cwd, opts)`: токен `GITVERSE_TOKEN` пуст → `raw`, токен есть → `contents`; явный `opts.transport` переопределяет выбор (тесты, отладка).

| Условие | Транспорт | URL | Заголовки | Ответ |
|---|---|---|---|---|
| токена нет | `raw` (анонимно) | `https://gitverse.ru/api/repos/{owner}/{repo}/raw/branch/{branch}/{path}` | только `accept` | сырой текст файла (`text/plain`) |
| токен есть | `contents` (Публичный API) | `https://api.gitverse.ru/repos/{owner}/{repo}/contents/{path}?ref={branch}` | `Authorization: Bearer <GITVERSE_TOKEN>`, `Accept: application/vnd.gitverse.object+json;version=1` | JSON-конверт `{type, encoding: "base64", content, size, sha, …}`, содержимое декодируется из base64 в UTF-8 |

> ⚠️ **raw не принимает `Authorization`** — проверено замерами 2026-11-09 (§10): с заголовком `Bearer` raw отвечает `429` всегда, без заголовка — `200`. Поэтому в raw-ветке заголовок авторизации не формируется ни при каком наличии токена; это защищено тестом-регрессией. «Улучшение» raw добавлением Bearer — уже случавшийся дефект (VL-380 → VL-382).

- Сегменты `{path}` кодируются по одному, `/` сохраняется; `{branch}` кодируется целиком (`encodeURIComponent`).
- Токен берётся из shell-окружения, при отсутствии — из `.env` проекта-получателя (`readToken(cwd)` из `src/core/gitverse-auth.ts`, приоритет shell env → `.env`). Новых переменных токена не вводится — тот же `GITVERSE_TOKEN`, что у Issues-API (VL-363). Токен нигде не попадает в вывод и тексты ошибок (`maskToken`).
- **Только GET.** HEAD → `403` (QRATOR).
- **Тестовое переопределение:** `GITVERSE_REGISTRY_BASE_URL` подменяет **обе** базы (новое имя, одно семейство с `GITVERSE_TOKEN`), `VIBELOG_REGISTRY_BASE_URL` — исторический алиас для raw-базы, `VIBELOG_GITVERSE_API_BASE` — база Contents API (её же использует Issues-клиент). В обычной работе переменные игнорируются.
- **Валидация конверта `contents`:** `type === 'file'`, `encoding === 'base64'`, непустой `content`; иначе `invalid_schema` с указанием элемента и пути. Ответ-массив (директория) → «ожидался файл, получена директория» с путём.
- **Лимит тела:** 5 МБ для raw, 8 МБ для `contents` (base64 удваивает размер; лимит применяется к декодированному размеру).
- Таймаут — 30 с (`AbortController`).
- Ретраи `5xx`/сетевых ошибок/таймаута: до 2 повторов (500 мс, 1500 мс).
- **Ретраи `429` (VL-380):** `429` — самый ретраибельный код, пауза берётся из заголовка `Retry-After` (секунды или HTTP-дата, потолок 120 с); без заголовка — дефолт 60 с; попыток больше, чем для `5xx` (до 3), суммарный бюджет ожидания — 180 с, после исчерпания ошибка с подсказкой про токен. Прочие `4xx` — без ретраев (`400`/`404` → «не найдено», `401` → «не авторизован», `403` → «доступ запрещён», подсказка проверить токен).
- Классификация статусов зависит от транспорта (`classifyRegistryStatus` получает параметр `transport`), подсказки разные:
  - **raw:** `400`/`404` → `not_found`; `429` → `rate_limited` (ретраи по `Retry-After`, подсказка «GitVerse ограничил анонимные запросы — задай `GITVERSE_TOKEN` в `.env`»); `5xx` → `server`.
  - **contents:** `401` → `unauthorized` («токен отвергнут — проверь `GITVERSE_TOKEN` и права Чтение на репозиторий», ссылка на https://gitverse.ru/settings/tokens; снять токен из `.env`, если нужно работать анонимно); `403` → `forbidden` (нет прав на репозиторий); `404` → `not_found` (нет файла или ветки); `415` → `bad_accept` (неверный `Accept` — дефект CLI, не пользователя); `429` → `rate_limited`; `5xx` → `server`.
  - Все эти статусы дают код выхода `3` (§5.2).
- Кэш и офлайн отсутствуют (кэш по `etag`/`max-age` — следующий шаг, не в этой версии).
- Тело > 5 МБ — ошибка. Тело ошибки разбирается (`{code,message}`), HTML-страница rate-limit снимается до текста, а не обрезается по 200 символов.
- Транспорт общий с Issues-API — `src/core/gitverse-http.ts` (резолв базы, класс ошибки, `fetchOnce` с `AbortController`/`clearTimeout`, чтение тела с лимитом байт, цикл ретраев, `parseJson`, `extractMessage`, `parseRetryAfter`, `networkErrorCode`); модули реестра и Issues — тонкие адаптеры со своими `classifyStatus` и заголовками.
- **Наблюдаемость транспорта (VL-381):** `requestWithRetries` принимает `onProgress?` и вызывает его на `request` (перед запросом), `response` (статус, размер тела), `waiting` (перед паузой: `delayMs`, `reason`), `error` (таймаут, лимит байт, сеть). Политика ретраев при этом не меняется — задача только про видимость ожидания; по умолчанию хук no-op, печать подключает CLI (§5.3).

**Таблица ответов (спайк):**

| Ситуация | HTTP | Content-Type | Тело |
|---|---|---|---|
| файл есть | `200` | `text/plain; charset=utf-8` | содержимое файла |
| файла нет | `400` | `application/json;charset=utf-8` | `{"code":4305,"message":"File: <path> not found"}` |
| HEAD | `403` | `text/html` | — |
| превышен rate-limit | `429` | `text/html` или `application/json` | страница «Unauthenticated requests rate-limit exceeded» / `{"code":…,"message":…}`; ретраится с учётом `Retry-After`, помогает `GITVERSE_TOKEN` |

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
- **Прогресс сетевых операций (VL-381)** — только в **stderr**: stdout остаётся планом и итогом, поэтому `--dry-run` и перенаправление вывода остаются машиночитаемыми. Без флага — одна строка на операцию: `→ скачиваю <alias>/<repo>/<name>…`, `→ скачиваю файлы (N)…`, а при повторе `→ жду N с (429, попытка K/M)…` (для `5xx`/сети строка ожидания печатается только с `--verbose`). С `--verbose` добавляются `GET <url> (попытка K/M)`, `← 200 (N байт)`, `← 429`, причина повтора (`5xx`/`сеть`) и однократная строка источника токена: `токен: из .env` / `из окружения` / `нет`. Сам токен не печатается никогда (`maskToken`).
- **Диагностика `429` — немедленно, а не после исчерпания попыток.** На первой же паузе с `reason: rate_limited` печатается предупреждение с оценкой оставшегося ожидания (`попытка 1/M, суммарно до 180 с`), текст различается: без токена — «GitVerse ограничил анонимные запросы (429). Добавь `GITVERSE_TOKEN` в `.env`…», с токеном — «GitVerse ограничивает запросы даже с токеном (429)». Предупреждение одно на запуск (флаг «уже предупредили»), иначе три паузы дают три копии текста.
- **Хук прогресса живёт в общем транспорте.** `requestWithRetries` (`src/core/gitverse-http.ts`) принимает `onProgress?: (event: ProgressEvent) => void`; события: `request` (перед каждым запросом), `response` (статус и размер тела), `waiting` (перед паузой, `delayMs` из `Retry-After` и `reason: rate_limited|server|network`), `error` (таймаут, лимит байт, сеть). По умолчанию — no-op: транспорт **сам ничего не печатает**, поэтому MCP-сервер (`stdout` занят JSON-RPC), библиотечные вызовы и тесты остаются чистыми; печать — забота CLI (`createProgressPrinter` в `src/cli/commands/install.ts`). Тот же хук доступен Issues-клиенту, то есть долгое ожидание перестаёт быть невидимым не только в `install`.

---

## 6. Правила для агента в шаблоне

Файл **`AGENTS.md`** в корне шаблона — тот же файл, который создаёт `vibelog init` (VL-210). Отдельных файлов под другие инструменты не заводим: `vb`, qwen и opencode читают `AGENTS.md`.

Правила в нём:

1. **Только Svelte 5 Runes.** Запрещено: `export let`, `$:`, `on:click` (`onclick`), `<slot>`/`$$slots` (`{@render children?.()}`, `$props()`), `createEventDispatcher` (коллбэки), `svelte:component`, `writable`/`readable` для локального состояния (`$state`, `$derived`, `$effect`).
2. **Только Tailwind.** Без `<style>`-блоков с кастомным CSS; классы утилитарные.
3. **Пути:** задаются `target` — один файл плоско, несколько в каталоге. Файлы `kebab-case`.
4. **Зависимости:** не добавлять npm-пакет, не объявив в реестре; при правке скопированного файла обновлять его хеш в `.vibelog/installed.lock.json`.

**Почему `AGENTS.md`, а не `CLAUDE.md` / `.cursorrules`.** Основной агент проекта — `vibelog` (`vb`); он читает `AGENTS.md` (VL-96/VL-109: файл загружается в системный промпт). qwen и opencode тоже читают `AGENTS.md`. Форматы других инструментов в шаблоне не создаются — иначе проект настраивается под неиспользуемые агенты, а штатный остаётся без инструкций.

**Проверка в шаблоне:** `vb create` создаёт проект, где `AGENTS.md` присутствует и содержит правила выше; `vibelog agent` подхватывает его как проектную инструкцию.

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
- **`..` в `target` (VL-383):** легален только для алиасов-файлов (`registry:lib`) и только как `../<file>`; ранее `..` рубила валидация формы, и `vb install vibelog.md/ui/base` не мог установить корневой элемент. Проверка живёт в одном месте (`resolveAliasPath`) и покрыта тестами `registry-fetch.test.mjs` / `components-config.test.mjs` / `install.test.mjs`.
- **`content-type` не отражает содержимое** — единственная проверка — успешный `JSON.parse` + схема.
- **alias и owner — разные сущности (VL-385):** ключ `registries` (`vibelog.md`) — это alias, а владелец репозитория — `registries[alias].owner` (`Vibelog-md`). В `vb create` эти поля уже путались: alias подставлялся в URL клонирования, и пользователь видел `repository not found` вместо ошибки настройки. Теперь обе команды (`vb create` и `vb install`) резолвят owner через один и тот же `registries[alias].owner`; owner валидируется (непустой, без точки и пробелов — ограничение GitVerse), а при отсутствии секции `components` используется дефолтная запись `defaultComponentsConfig()` с предупреждением.
- **Коды ответов непривычны:** отсутствие файла — `400`, не `404`.
- **Rate-limit GitVerse (закрыт в VL-382, уточнение VL-380):** модель из двух схем: **без токена** запрос идёт анонимно на raw (лимит по IP низкий — при исчерпании `429`, ретраи по `Retry-After`, подсказка «задай `GITVERSE_TOKEN` в `.env` — запросы пойдут через API с более высоким лимитом»); **с токеном** — через Публичный API `api.gitverse.ru` с явной авторизацией и более высоким лимитом. `429` в обеих схемах ретраится с учётом `Retry-After` (секунды или HTTP-дата, потолок 120 с, до 3 попыток, суммарный бюджет 180 с). Важно: добавлять `Authorization` в raw нельзя — raw на него отвечает `429` всегда (§10).
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

### 10.1. Замеры доступа к raw и Contents API (2026-11-09, VL-382)

Один и тот же URL `gitverse.ru/api/repos/Vibelog-md/ui/raw/branch/master/public/r/base.json`, интервал минуты:

| Запрос | Ответ |
|---|---|
| **без токена** | **200** `text/plain`, полный JSON элемента |
| **с `Authorization: Bearer <token>`** | **429** «Unauthenticated requests rate-limit exceeded» |
| через прокси IP `5.189.239.79` | 429 |
| через прокси IP `31.40.135.235` | 429 |
| прямой IP (через 6 минут) | 200 |

**Вывод:** raw-эндпоинт GitVerse **не принимает** `Authorization: Bearer` — с этим заголовком он отвечает `429` всегда (HTTP сам утверждает, что запрос неаутентифицирован). Ранний `429` без токена был временным IP-лимитом и сбросился. Отсюда две схемы доступа (§5.1).

Спайк Contents API (ref-26, ref-32): `GET https://api.gitverse.ru/repos/{owner}/{repo}/contents/{path}?ref={branch}` с `Authorization: Bearer` и `Accept: application/vnd.gitverse.object+json;version=1` → `200` и JSON-конверт с `content` в base64; без кастомного `Accept` — `415`. Коды ошибок Публичного API — конверт `{error:{code,message,status,documentation_url}}`.

Кэширование ответов (`cache-control: max-age=21600`, `etag`) не реализуется — отдельная тема; именно оно снизит частоту `429` в анонимной схеме.

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
