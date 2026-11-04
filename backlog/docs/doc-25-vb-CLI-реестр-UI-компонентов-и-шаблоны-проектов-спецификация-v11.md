---
id: doc-25
title: 'vb CLI, реестр UI-компонентов и шаблоны проектов — спецификация (v1.1)'
type: specification
created_date: 2026-11-03
tags: []
---
# Спецификация: `vb` CLI, реестр UI-компонентов и шаблоны проектов

Статус: v1.1 — решения по открытым вопросам приняты, документ нормативный. Обоснования — в ADR `decision-6` … `decision-11` (каталог `backlog/decisions/`).

Ссылки на решения:
- decision-6 — стек: Svelte 5 Runes + SvelteKit, Tailwind CSS
- decision-7 — микро-shadcn: код компонентов копируется в проект, zero runtime dependencies
- decision-8 — реестр на GitVerse, формат shadcn, разделение `src/` и `public/r/`
- decision-9 — три команды `create` / `init` / `install`, служебное только в `.vibelog/`
- decision-10 — версионирование хешами в `.vibelog/installed.lock.json`
- decision-11 — шаблоны: монорепозиторий, метаданные в `package.json`, `sparse-checkout`

**Изменения v1.1 относительно v1:**
1. Отдельный `.vibelog/config.json` отменён — конфигурация компонентов живёт секцией `components` в существующем `.vibelog/settings.json` (VL-329).
2. `vb init` — не новая команда, а расширение существующего `vibelog init` (wizard настройки проекта).
3. `target` в JSON элемента — путь относительно `aliases.ui` **без** дублирующего префикса `ui/`.
4. Правило «один компонент — один каталог» отменено: структуру задаёт `target`.
5. Корневой элемент реестра — `vibelog.md/ui/base`.
6. Версия элемента — ручная в `registry.json`, сборка валидирует формат.
7. Код выхода `4` — только если пропущены ВСЕ файлы; частичный успех — `0`.
8. Тесты — `VIBELOG_REGISTRY_BASE_URL` + локальный HTTP-фикстур.
9. Git-политика `.vibelog/` — собственный `.vibelog/.gitignore` (VL-329).

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
- `vb init` — расширение существующего wizard-а: секция `components` в `.vibelog/settings.json` + `installed.lock.json`;
- `vb install` — доставка файлов компонента, проверка `dependencies` и `registryDependencies` одного уровня, запись `installed.lock.json`;
- реестр `Vibelog-md/ui` с корневым элементом `base` и компонентами `Button`, `Input`, `Label`, `Card`;
- шаблон `svelte-minimal` в `Vibelog-md/templates`.

**Явно не входит:**
- `vb update` (манифест собирает данные с первого дня, обновление — следующий этап);
- полное рекурсивное разрешение `registryDependencies` (первая версия — один уровень);
- компоненты MAX Bridge (`window.WebApp`, `HapticFeedback`);
- компоненты на `bits-ui` (Dialog, DropdownMenu);
- синтаксис `host/owner/repo/component` и несколько хостов;
- кэш скачанных JSON и офлайн-режим.

---

## 2. Бинарь и команды

`vb` — алиас существующего бинаря `vibelog` (`package.json`: `bin.vb → ./bin/vibelog.mjs`). Отдельного пакета нет; команды добавляются в текущий CLI.

### 2.1. `vb create`

```
vb create <name> --template <registry-alias>/<repo>/<template> [флаги]
```

| Флаг | Назначение |
|---|---|
| `--template <p>` | обязателен; например `vibelog.md/templates/svelte-minimal` |
| `--branch <b>` | ветка шаблона; по умолчанию из записи реестра (`main`) |
| `--package-manager <npm\|pnpm\|bun>` | без флага — интерактивный вопрос |
| `--no-install` | не устанавливать зависимости |
| `--no-git` | не выполнять `git init` и первый коммит |
| `--yes` | без вопросов, дефолты на всё |

Поведение:
- создаёт каталог `./<name>` в текущем рабочем каталоге, **без дополнительных вопросов**;
- имя валидируется по npm-правилам: lowercase, без пробелов, допустимы `-`, `_`, `.`; иначе ошибка, код `1`;
- если каталог `./<name>` уже существует — ошибка, код `2`; `--force` не предусмотрен;
- `git init` + первый коммит выполняются, если нет `--no-git`.

### 2.2. `vb init` — расширение существующей команды

**Не новая команда.** `vibelog init` уже существует (`src/cli/commands/init.ts`): wizard настройки проекта с режимами `fresh`/`upgrade`, флагами `--force`, `--mode`, `--web`, `--yes`. Он создаёт `backlog/`, `config.yml`, `AGENTS.md`, `.env` и пишет `.vibelog/settings.json`.

`vb init` дополняется шагом «компоненты»:

```
vb init [--components | --no-components] [существующие флаги]
```

| Флаг | Назначение |
|---|---|
| `--components` | добавить секцию `components` в `.vibelog/settings.json` и создать `installed.lock.json` |
| `--no-components` | не трогать секцию `components` (поведение до v1.1) |

Правила:
- **нового файла не появляется**: конфигурация компонентов — секция `components` внутри `.vibelog/settings.json` (см. §3.1). Отдельный `config.json` из v1 отменён;
- в интерактивном режиме шаг «компоненты» — вопрос wizard-а с дефолтом «да»; в `--yes` без флага — секция создаётся (дефолт «да»);
- `installed.lock.json` создаётся со `schemaVersion` и пустым списком компонентов;
- **не знает про стек проекта**: не проверяет Tailwind, фреймворк, наличие `package.json`;
- идемпотентен: повторный запуск с уже существующей секцией не перезаписывает `aliases`/`registries`, если они заданы (только дополняет недостающее);
- `.vibelog/settings.json` и `.vibelog/installed.lock.json` **коммитятся в git** — политика описана в §3.6.

### 2.3. `vb install`

```
vb install <registry-alias>/<repo>/<component> [флаги]
```

Пример: `vb install vibelog.md/ui/button`.

| Флаг | Назначение |
|---|---|
| `--yes` | без вопросов |
| `--force` | перезаписать конфликтующие файлы |
| `--dry-run` | показать план (какие файлы, какие зависимости) и выйти, ничего не записывая |
| `--branch <b>` | переопределить ветку реестра |

Разбор пути: `[0]` — ключ в `registries` из секции `components`; `[1]` — репозиторий (`ui`); `[2]` — имя элемента реестра. Иное число сегментов — ошибка, код `1`.

---

## 3. Схемы файлов

### 3.1. Секция `components` в `.vibelog/settings.json`

`.vibelog/settings.json` уже существует и хранит настройки бота, моделей, workflow (VL-143, VL-329). Конфигурация компонентов добавляется **отдельной секцией**, чтобы не конфликтовать с существующими ключами:

```json
{
  "chats": [],
  "models": { "...": "..." },
  "components": {
    "schemaVersion": 1,
    "registries": {
      "vibelog.md": { "owner": "Vibelog-md", "branch": "main" }
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
- все пути в `aliases` — **относительно корня проекта** (не `$lib`-форма): CLI не читает `svelte.config.js`;
- `registries` — карта «алиас → {owner, branch}»; репозиторий берётся из пути команды, поэтому в записи его нет;
- `owner` не может содержать точку (ограничение GitVerse), поэтому алиас с точкой (`vibelog.md`) однозначно отличим от настоящего owner-а;
- `urlTemplate` в конфиге не хранится — зашит в CLI (переопределяется только `VIBELOG_REGISTRY_BASE_URL` для тестов, §5.1);
- `branch` — строка; в будущем допускается объект `{ "default": "main", "ui": "main" }` без ломающей миграции;
- `components.schemaVersion` — целое, при несовпадении с поддерживаемым CLI сообщает об ошибке с кодом `2`;
- отсутствие секции `components` — не ошибка: `vb install` сообщает «выполните `vb init --components`» (код `2`).

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
- ключ верхнего уровня `components` — имя элемента реестра;
- `hash` — `sha256:` + hex от содержимого **записанного** файла (после применения `target`);
- `version` — версия элемента на момент установки; `sourceVersion` — версия в реестре (совпадают, но разводятся на будущее для `vb update`);
- `dependencies` — npm-пакеты, объявленные элементом и подтверждённо установленные;
- файл атомарно перезаписывается целиком после успешной установки; хранится в git;
- **владение файлом**: каждый файл принадлежит ровно одному элементу реестра. Если файл уже записан другим элементом с совпадающим хешем — это переиспользование (запись не дублируется, второй владелец не появляется); при расхождении хешей — конфликт по §4.3 шаг 8.

**Реализация (VL-333).** Чтение, валидация и запись обоих файлов живут в одном модуле `src/core/components-config.ts` — до появления CLI-команд, чтобы ошибка схемы не проявлялась далеко от места поломки:
- `readComponentsConfig(cwd)` → `ComponentsConfig | null` (секции нет — `null`, «не инициализировано»), `writeComponentsConfig(cwd, config)` — read-modify-write по `settings.json` через общий `writeJsonAtomic` (temp-файл в том же каталоге + `fsync` + `rename`); посторонние секции (`chats`, `models`, `providers`, `workflows`, `mcpServers`, `chat_personas`, `commit_coauthor`, неизвестные) сохраняются, ключи пишутся в фиксированном порядке — повторная запись без изменений даёт идентичный файл;
- `readLock(cwd, config)` → `LockFile` (путь из `config.lockFile`, отсутствие файла → `{schemaVersion: 1, components: {}}`), `writeLock(cwd, config, lock)` — тоже через `writeJsonAtomic`;
- `hashFile(absPath)` / `hashContent(buffer)` — единая точка `sha256:<hex>` (нужна и `vb install`, и будущему `vb update`; буферная форма — для `--dry-run`);
- `validateAliasPath` / `resolveAliasPath(cwd, config, alias, target)` — относительность и невыход за корень проекта (`path.resolve` + `path.relative` → `..`), повторная проверка после склейки с `target`; для `utils`/`css` `target` без `/`; неизвестный алиас → ошибка со списком доступных;
- ошибки — `ComponentsConfigError` с `code` (2 — предусловие/схема, 3 — данные/путь) и `field`; CLI печатает `message` одной строкой.

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
- `dependencies` — имена npm-пакетов без версий; версии подбирает пакетный менеджер проекта;
- `registryDependencies` — ссылки вида `<alias>/<repo>/<name>`; на первом этапе разрешается **один уровень**;
- `files[].path` — путь в репозитории реестра (для читаемости и сборки);
- `files[].target` — путь **относительно `aliases.ui`**, без дублирующего префикса `ui/`. Для `aliases.ui = "src/lib/components/ui"` и `target = "button.svelte"` файл попадёт в `src/lib/components/ui/button.svelte`;
- **структуру задаёт `target`, а не правило**: компонент из одного файла лежит плоско (`button.svelte`), из нескольких — в каталоге (`card/card.svelte`). Отдельный каталог под каждый компонент не создаётся;
- `target` обязан оставаться внутри проекта: абсолютные пути и `..` отклоняются на этапе сборки реестра и повторно в CLI (код `3`);
- `version` — **ручная**, задаётся в `registry.json`; сборка валидирует наличие и формат `X.Y.Z`, но не выводит версию из git-тега (независимое версионирование компонентов важнее автоматизации);
- схема валидируется при сборке `public/r/*.json`; невалидный элемент не попадает в выдачу.

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

`public/r/` пересобирается детерминированно из `src/` + `registry.json`; `vb install` читает **только** `public/r/`.

**Корневой элемент называется `base`** (не `ui`): при репозитории `ui` имя `ui` давало бы путь `vibelog.md/ui/ui`. `base` содержит `utils.ts` с `cn`, общие типы и CSS-переменные темы; файлы с `type: registry:lib` раскладываются через алиас `utils`/`css`, а не `ui`.

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
- `vibelog.type === "template"` — обязательная проверка; иначе ошибка, код `3`;
- `scripts.postCreate` выполняется после установки зависимостей; бинарь `vb` берётся из `devDependencies` шаблона (`vibelog.md`) либо из `npx vibelog@latest` — конкретный способ фиксируется в шаблоне, а не в CLI;
- `vibelog.components` — массив путей вида `vibelog.md/ui/button`, устанавливаемых после `postCreate`.

### 3.6. Git-политика `.vibelog/`

Реализовано в VL-329: корневой `.gitignore` **не** игнорирует `.vibelog/` целиком; политика живёт в `.vibelog/.gitignore` по схеме «запрещаем всё, разрешаем явно» (`*`, `!*/`, затем `!`-исключения).

| Коммитится | Игнорируется |
|---|---|
| `settings.json` (в т.ч. секция `components`) | `agent-sessions/`, `chat-sessions/` |
| `installed.lock.json` | `cache/`, `tmp/`, `qwen-debug/` |
| `prompts/` (переопределения ролей) | `supervisor/`, `worktrees/` |
| `billing/` (история трат) | `*.log`, `idempotency.json`, `phase-in-progress.json`, `auto-queue.json` |

Секреты (токены, API-ключи, `TELEGRAM_CHAT_IDS`) — **только** в `.env` в корне проекта.

---

## 4. Потоки команд

### 4.1. `vb create`

1. Разобрать `--template`: alias → `registries` → `owner`; `[1]` → repo; `[2]` → имя шаблона.
2. Проверить имя проекта (npm-правила) и отсутствие каталога `./<name>`.
3. Временный каталог (внутри `os.tmpdir()`):
   ```
   git clone --filter=blob:none --no-checkout --depth 1 --branch <branch> https://gitverse.ru/<owner>/<repo>.git <tmp>
   git -C <tmp> sparse-checkout init --cone
   git -C <tmp> sparse-checkout set <template>
   git -C <tmp> checkout <branch>
   ```
   Порядок обязателен: `sparse-checkout set` **до** `checkout`.
4. Если в stderr есть `filtering not recognized by server, ignoring` — предупредить (установка продолжится, скачается больше данных, развернётся только нужная папка). При фатальной ошибке клонирования — fallback: скачать `https://gitverse.ru/<owner>/<repo>/archive/<branch>.zip` (если доступно), иначе код `3`.
5. Проверить `package.json` шаблона: `vibelog.type === "template"`.
6. Скопировать содержимое `<tmp>/<template>` в `./<name>`.
7. Удалить временный каталог.
8. Пакетный менеджер: `--package-manager` → интерактивный вопрос (`@clack/prompts`, `p.select` с детектом lock-файла) → дефолт `npm`. Если `--no-install` — пропустить.
9. Установить зависимости.
10. Выполнить `scripts.postCreate`, если он объявлен.
11. Для каждого пути из `vibelog.components` вызвать логику `vb install`.
12. Если не `--no-git`: `git init`, `git add -A`, первый коммит.

### 4.2. `vb init` (шаг «компоненты»)

1. Определить корень проекта (наличие `.git`/`package.json` вверх по дереву; иначе текущий каталог).
2. Прочитать `.vibelog/settings.json` (нет — создать пустой объект).
3. Если секция `components` уже есть и нет `--force` — не перезаписывать заданные `aliases`/`registries`, только дополнить недостающие ключи.
4. Записать секцию `components` по схеме §3.1 (атомарно: temp + rename).
5. Создать `.vibelog/installed.lock.json` со `schemaVersion: 1` и пустыми `components` (если файла нет).
6. Вывести итог (что создано/дополнено), код `0`.

### 4.3. `vb install`

1. Найти корень проекта и секцию `components` в `.vibelog/settings.json`. Нет — ошибка: «выполните `vb init --components`», код `2`.
2. Разобрать путь `alias/repo/name` (три сегмента, иначе код `1`).
3. Скачать `https://gitverse.ru/api/repos/<owner>/<repo>/raw/branch/<branch>/public/r/<name>.json`. 404 — код `3`, без ретраев.
4. Валидировать JSON по схеме §3.3.
5. **Разрешить `registryDependencies` (один уровень):** для каждой зависимости — если её нет в `installed.lock.json`, выполнить для неё шаги 3–10 (без её собственных зависимостей, с предупреждением в выводе).
6. **Проверить `dependencies`:** сверить с `package.json` проекта. Отсутствующие — предложить установить через определённый пакетный менеджер; в `--yes` — предупредить и продолжить; `--dry-run` — показать список и выйти.
7. Вычислить целевые пути: `aliases.ui` + `target` для файлов с `type: registry:ui`; иные типы — через соответствующий алиас (`registry:lib` → `aliases.utils`). Валидация: путь не выходит за корень проекта.
8. **Конфликты** (для каждого файла):
   - файла нет — писать;
   - файл есть, хеш совпадает с записью в `installed.lock.json` — пропустить, обновить запись;
   - файл есть, хеш отличается — спросить (`перезаписать` / `пропустить` / `показать diff`); `--force` — перезаписать; `--yes` без `--force` — пропустить с предупреждением.
9. Записать файлы во временный каталог внутри проекта, затем переместить на целевые места.
10. Вычислить sha256 каждого записанного файла, обновить `installed.lock.json`, записать его атомарно (`write temp` + `rename`).
11. Удалить временный каталог; вывести итог, код `0`.

**Атомарность:** при любой ошибке на шагах 7–10 временный каталог удаляется, целевые файлы не изменяются (перемещения выполняются только после успешной подготовки всех файлов; частично перемещённые файлы восстанавливаются из содержимого временного каталога), `installed.lock.json` не трогается.

---

## 5. Сеть, ошибки и коды выхода

### 5.1. HTTP

- Единственный шаблон: `https://gitverse.ru/api/repos/{owner}/{repo}/raw/branch/{branch}/{path}`.
- **Тестовое переопределение:** переменная окружения `VIBELOG_REGISTRY_BASE_URL` подменяет `https://gitverse.ru` целиком. В обычной работе игнорируется (не документируется в `--help`), нужна только для тестов с локальным HTTP-фикстуром — иначе e2e невозможен при зашитом шаблоне и отсутствии кэша.
- Таймаут запроса — 30 с (`AbortController`).
- Ретраи: до 2 повторов с экспоненциальной паузой (500 мс, 1500 мс) на сетевые ошибки и `5xx`. `404` и `4xx` — без ретраев.
- Кэш и офлайн-режим отсутствуют.
- Тело ответа > 5 МБ — ошибка (защита от подмены реестра).

### 5.2. Коды выхода

| Код | Значение |
|---|---|
| `0` | успех, **в том числе частичный** (часть файлов пропущена по конфликту — предупреждения в итоговом блоке) |
| `1` | ошибка использования: неизвестная команда/флаг, невалидное имя проекта, неверное число сегментов пути |
| `2` | предусловие не выполнено: нет секции `components`, каталог проекта существует, `schemaVersion` не поддержан, отмена перезаписи в `--yes` |
| `3` | сеть/данные: HTTP-ошибка, таймаут, невалидный JSON, невалидный `target`, `vibelog.type !== "template"` |
| `4` | конфликт файлов: **все** файлы пропущены, ничего не установлено (в неинтерактивном режиме без `--force`) |
| `5` | отмена пользователем (Ctrl+C, `p.isCancel`) |

### 5.3. Вывод

- Интерактив — `@clack/prompts` по образцу `sv` (ref-25): `p.group` с зависимостями шагов, `p.select` с `initialValue`/`hint`, проверка `p.isCancel` после каждого промпта, `p.cancel` + выход с кодом `5`.
- Не-TTY или `--yes` — промпты не запускаются, используются флаги и дефолты.
- Каждая команда завершается итоговым блоком: что создано/установлено (пути), какие зависимости добавлены, какие файлы пропущены.
- Ошибки — одной строкой с подсказкой действия («выполните `vb init --components`»), без стектрейсов, если не задан отладочный флаг.

---

## 6. Правила для агента в шаблоне

Файл `CLAUDE.md` в корне каждого шаблона (для Cursor — `.cursorrules` с тем же содержимым) создаётся вместе с шаблоном и содержит:

1. **Только Svelte 5 Runes.** Запрещено: `export let`, `$:`-реактивность, `on:click` (использовать `onclick`), `<slot>` и `$$slots` (использовать `{@render children?.()}` и `$props()`), `createEventDispatcher` (использовать коллбэки в пропсах), `svelte:component` (динамические компоненты через `{@const Comp = ...}` или `#if`), `writable`/`readable` из `svelte/store` для локального состояния (`$state`, `$derived`, `$effect`).
2. **Только Tailwind.** Никаких `<style>`-блоков с кастомным CSS в компонентах; классы — утилитарные.
3. **Пути и именование:** путь файла компонента задаётся полем `target` в реестре — компонент из одного файла лежит плоско (`ui/button.svelte`), из нескольких — в каталоге (`ui/card/card.svelte`). Файлы — `kebab-case`, экспорт — `index.ts` при необходимости.
4. **Зависимости:** не добавлять npm-пакет, не объявив его в реестре; скопированный файл можно править, но при правке обновлять его хеш в `.vibelog/installed.lock.json`.

---

## 7. Порядок работ и критерии готовности первой версии

| Шаг | Содержание | Готово, когда |
|---|---|---|
| 1 | `Vibelog-md/templates` + шаблон `svelte-minimal` (`package.json` с `vibelog.type`, `postCreate`, `CLAUDE.md`) | `sv create`-набор зафиксирован, шаблон собирается и запускается |
| 2 | `vb create`: sparse-checkout, копирование, зависимости, `postCreate`, `git init` | пустой каталог → работающий проект с `.vibelog/` одной командой |
| 3 | `Vibelog-md/ui`: `registry.json`, сборка в `public/r/*.json`, корневой элемент `base` (`utils.ts`, `cn`, CSS-переменные) | `public/r/base.json` валиден по схеме и собирается детерминированно |
| 4 | `vb install`: скачивание, `dependencies`, `registryDependencies` одного уровня, конфликты, `installed.lock.json` | `vb install vibelog.md/ui/button` из чистого проекта даёт рабочий компонент и запись в lock-файле |
| 5 | Компонент `Button` (веб-версия): варианты `default/outline/secondary/ghost/destructive/link`, размеры `default/sm/lg/icon` | рендерится в шаблоне, портирован с React-эталона на Svelte 5 |
| 6 | `Input` + `Label` (`bind:value`, `for`/`id`) | связка работает, хеши в lock-файле корректны |
| 7 | `Card` (мультифайловый) | установщик корректно раскладывает несколько файлов и несколько `target` |

Критерии готовности первой версии целиком:
- `vb create` + `vb install` проходят с чистого листа без ручных правок;
- повторный `vb install` того же компонента идемпотентен (ничего не перезаписывается, lock-файл не меняется, если хеши совпадают);
- при конфликте файл не затирается без явного `--force`;
- атомарность подтверждена тестом с искусственным сбоем на последнем файле;
- `.vibelog/installed.lock.json` содержит корректные хеши всех установленных файлов;
- ни одна команда не создаёт файлов в корне проекта, кроме файлов самого шаблона;
- e2e-тесты проходят на локальном HTTP-фикстуре через `VIBELOG_REGISTRY_BASE_URL`.

---

## 8. Принятые решения (бывшие открытые вопросы)

1. **Валидация схемы** `settings.json`/`installed.lock.json` при чтении — встроена в парсинг: битый JSON или несовпавший `schemaVersion` → код `2` с указанием файла и поля.
2. **Формат `--dry-run`** — человекочитаемый по умолчанию; `--json` добавляется, когда появится агентский сценарий (не в v1).
3. **`vb install --list`** — не входит в первую версию; состояние читается из `installed.lock.json` напрямую.
4. **Версия элемента реестра** — ручная в `registry.json`; сборка валидирует формат `X.Y.Z`, но не выводит версию из git-тега.
5. **Поведение при падении `postCreate`** — созданный каталог **сохраняется**, выводится ошибка с путём и код `3`; удаление каталога пользователь выполняет сам (автоудаление рискует снести уже начатую работу).
6. **Имя `vb init`** — расширение существующей команды `vibelog init`, а не новая команда; конфигурация компонентов — секция `components` в `.vibelog/settings.json`, отдельного `config.json` нет.
7. **Код выхода при конфликтах** — `4` только если пропущены все файлы; частичный успех — `0` с предупреждениями.
8. **Имя корневого элемента реестра** — `base`.
9. **Тесты без сети** — `VIBELOG_REGISTRY_BASE_URL` + локальный HTTP-фикстур.
10. **Структура файлов компонента** — задаётся `target`; отдельный каталог под каждый компонент не создаётся.

---

## 9. Известные риски

- **GitVerse API и `sparse-checkout`** — формат raw-URL и поддержка `--filter=blob:none` на сервере не проверены; требуется спайк до реализации `vb create`/`vb install`.
- **`templates/` в репозитории Vibelog.md занят** промптами фаз (`templates/phases/`, `templates/prompts/`). Шаблоны проектов живут **только** в отдельном репозитории `Vibelog-md/templates`; имя каталога в этом репозитории не переиспользуется.
- **`zero runtime dependencies`** (decision-7) относится к самому реестру и шаблону; `cn` тянет `clsx` + `tailwind-merge` в проект-потребитель — это объявленные `dependencies` элемента `base`, а не зависимость CLI.
- **Валидация `aliases`** — проверяется не только `target`, но и сами алиасы из `settings.json` (выход за корень проекта через `..` или абсолютный путь → код `3`).
