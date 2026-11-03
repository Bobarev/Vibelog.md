---
id: doc-25
title: 'vb CLI, реестр UI-компонентов и шаблоны проектов — спецификация (v1)'
type: specification
created_date: 2026-11-03
tags: []
---
# Спецификация: `vb` CLI, реестр UI-компонентов и шаблоны проектов

Статус: черновик первой версии. Нормативный документ; обоснования решений — в ADR `decision-6` … `decision-11` (каталог `backlog/decisions/`).

Ссылки на решения:
- decision-6 — стек: Svelte 5 Runes + SvelteKit, Tailwind CSS
- decision-7 — микро-shadcn: код компонентов копируется в проект, zero runtime dependencies
- decision-8 — реестр на GitVerse, формат shadcn, разделение `src/` и `public/r/`
- decision-9 — три команды `create` / `init` / `install`, служебное только в `.vibelog/`
- decision-10 — версионирование хешами в `.vibelog/installed.lock.json`
- decision-11 — шаблоны: монорепозиторий, метаданные в `package.json`, `sparse-checkout`

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
- `vb init` — универсальная инициализация `.vibelog/` в любом репозитории;
- `vb install` — доставка файлов компонента, проверка `dependencies` и `registryDependencies` одного уровня, запись `installed.lock.json`;
- реестр `Vibelog-md/ui` с корневым пакетом и компонентами `Button`, `Input`, `Label`, `Card`;
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

`vb` — алиас существующего бинаря `vibelog`. Отдельного пакета нет; команды добавляются в текущий CLI проекта Vibelog.md (тот же, где `vibelog init`).

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

### 2.2. `vb init`

```
vb init [флаги]
```

Без обязательных аргументов. Создаёт `.vibelog/config.json` и `.vibelog/installed.lock.json`.

| Флаг | Назначение |
|---|---|
| `--force` | перезаписать существующие файлы `.vibelog/` |
| `--yes` | без вопросов |

Правила:
- **не знает про стек проекта**: не проверяет Tailwind, фреймворк, наличие `package.json`;
- если `.vibelog/` уже существует — спросить (перезаписать / отменить); `--force` — перезаписать без вопроса;
- создаёт `installed.lock.json` со `schemaVersion` и пустым списком компонентов;
- каталог `.vibelog/` добавляется в `.gitignore` только если он содержит секреты — `config.json` и `installed.lock.json` коммитятся в git.

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

Разбор пути: `[0]` — ключ в `registries` из `config.json`; `[1]` — репозиторий (`ui`); `[2]` — имя элемента реестра. Иное число сегментов — ошибка, код `1`.

---

## 3. Схемы файлов

### 3.1. `.vibelog/config.json`

```json
{
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
```

Правила:
- все пути в `aliases` — **относительно корня проекта** (не `$lib`-форма): CLI не читает `svelte.config.js`;
- `registries` — карта «алиас → {owner, branch}»; репозиторий берётся из пути команды, поэтому в записи его нет;
- `owner` не может содержать точку (ограничение GitVerse), поэтому алиас с точкой (`vibelog.md`) однозначно отличим от настоящего owner-а;
- `urlTemplate` в конфиге не хранится — зашит в CLI;
- `branch` — строка; в будущем допускается объект `{ "default": "main", "ui": "main" }` без ломающей миграции;
- `schemaVersion` — целое, при несовпадении с поддерживаемым CLI сообщает об ошибке с кодом `2`.

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
    }
  }
}
```

Правила:
- ключ верхнего уровня `components` — имя элемента реестра;
- `hash` — `sha256:` + hex от содержимого **записанного** файла (после применения `target`);
- `version` — версия элемента на момент установки; `sourceVersion` — версия в реестре (совпадают, но разводятся на будущее для `vb update`);
- `dependencies` — npm-пакеты, объявленные элементом и подтверждённо установленные;
- файл атомарно перезаписывается целиком после успешной установки; хранится в git.

### 3.3. JSON элемента реестра (`public/r/<name>.json`)

```json
{
  "name": "button",
  "type": "registry:ui",
  "version": "1.0.0",
  "dependencies": ["clsx", "tailwind-merge"],
  "registryDependencies": ["vibelog.md/ui"],
  "files": [
    {
      "path": "src/lib/components/ui/button/button.svelte",
      "target": "ui/button.svelte",
      "type": "registry:ui"
    }
  ]
}
```

Правила:
- `dependencies` — имена npm-пакетов без версий; версии подбирает пакетный менеджер проекта;
- `registryDependencies` — ссылки вида `<alias>/<repo>/<name>`; на первом этапе разрешается **один уровень**;
- `files[].path` — путь в репозитории реестра (для читаемости и сборки), `files[].target` — путь **относительно `aliases.ui`** в проекте-потребителе;
- `target` обязан оставаться внутри проекта: абсолютные пути и `..` отклоняются на этапе сборки реестра и повторно в CLI (код `3`);
- `version` проставляется при сборке из тега/`package.json` реестра;
- схема валидируется при сборке `public/r/*.json`; невалидный элемент не попадает в выдачу.

### 3.4. `registry.json` реестра

```json
{
  "$schema": "https://ui.shadcn.com/schema/registry.json",
  "name": "vibelog-ui",
  "homepage": "https://gitverse.ru/Vibelog-md/ui",
  "items": [
    {
      "name": "button",
      "type": "registry:ui",
      "registryDependencies": ["vibelog.md/ui"],
      "files": [
        { "path": "src/lib/components/ui/button/button.svelte", "target": "ui/button.svelte", "type": "registry:ui" }
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
├── src/lib/components/ui/<name>/...   # исходники
├── public/r/<name>.json               # сгенерированное, раздаётся по HTTP
└── README.md
```

`public/r/` пересобирается детерминированно из `src/` + `registry.json`; `vb install` читает **только** `public/r/`.

### 3.5. `package.json` шаблона

```json
{
  "name": "svelte-minimal",
  "version": "0.1.0",
  "description": "SvelteKit minimal + Tailwind + .vibelog/",
  "scripts": { "postCreate": "vb init" },
  "vibelog": { "type": "template", "components": [] }
}
```

Правила:
- `vibelog.type === "template"` — обязательная проверка; иначе ошибка, код `3`;
- `scripts.postCreate` выполняется после установки зависимостей;
- `vibelog.components` — массив путей вида `vibelog.md/ui/button`, устанавливаемых после `postCreate`.

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

### 4.2. `vb init`

1. Определить корень проекта (наличие `.git`/`package.json` вверх по дереву; иначе текущий каталог).
2. Если `.vibelog/config.json` существует и нет `--force` — спросить о перезаписи (в `--yes` без `--force` — выйти с кодом `2` и сообщением).
3. Записать `config.json` (schemax из §3.1).
4. Записать `installed.lock.json` со `schemaVersion: 1` и пустыми `components`.
5. Вывести итог (что создано, куда), код `0`.

### 4.3. `vb install`

1. Найти корень проекта и `.vibelog/config.json`. Нет — ошибка: «выполните `vb init`», код `2`.
2. Разобрать путь `alias/repo/name` (три сегмента, иначе код `1`).
3. Скачать `https://gitverse.ru/api/repos/<owner>/<repo>/raw/branch/<branch>/public/r/<name>.json`. 404 — код `3`, без ретраев.
4. Валидировать JSON по схеме §3.3.
5. **Разрешить `registryDependencies` (один уровень):** для каждой зависимости — если её нет в `installed.lock.json`, выполнить для неё шаги 3–10 (без её собственных зависимостей, с предупреждением в выводе).
6. **Проверить `dependencies`:** сверить с `package.json` проекта. Отсутствующие — предложить установить через определённый пакетный менеджер; в `--yes` — предупредить и продолжить; `--dry-run` — показать список и выйти.
7. Вычислить целевые пути: `aliases.ui` + `target` для файлов с `type: registry:ui`; иные типы — через соответствующий алиас (`utils` → `aliases.utils`). Валидация: путь не выходит за корень проекта.
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
- Таймаут запроса — 30 с (`AbortController`).
- Ретраи: до 2 повторов с экспоненциальной паузой (500 мс, 1500 мс) на сетевые ошибки и `5xx`. `404` и `4xx` — без ретраев.
- Кэш и офлайн-режим отсутствуют.
- Тело ответа > 5 МБ — ошибка (защита от подмены реестра).

### 5.2. Коды выхода

| Код | Значение |
|---|---|
| `0` | успех |
| `1` | ошибка использования: неизвестная команда/флаг, невалидное имя проекта, неверное число сегментов пути |
| `2` | предусловие не выполнено: нет `.vibelog/`, каталог проекта существует, `schemaVersion` не поддержан, отмена перезаписи в `--yes` |
| `3` | сеть/данные: HTTP-ошибка, таймаут, невалидный JSON, невалидный `target`, `vibelog.type !== "template"` |
| `4` | конфликт файлов (в неинтерактивном режиме без `--force`) |
| `5` | отмена пользователем (Ctrl+C, `p.isCancel`) |

### 5.3. Вывод

- Интерактив — `@clack/prompts` по образцу `sv` (ref-25): `p.group` с зависимостями шагов, `p.select` с `initialValue`/`hint`, проверка `p.isCancel` после каждого промпта, `p.cancel` + выход с кодом `5`.
- Не-TTY или `--yes` — промпты не запускаются, используются флаги и дефолты.
- Каждая команда завершается итоговым блоком: что создано/установлено (пути), какие зависимости добавлены, какие файлы пропущены.
- Ошибки — одной строкой с подсказкой действия («выполните `vb init`»), без стектрейсов, если не задан отладочный флаг.

---

## 6. Правила для агента в шаблоне

Файл `CLAUDE.md` в корне каждого шаблона (для Cursor — `.cursorrules` с тем же содержимым) создаётся вместе с шаблоном и содержит:

1. **Только Svelte 5 Runes.** Запрещено: `export let`, `$:`-реактивность, `on:click` (использовать `onclick`), `<slot>` и `$$slots` (использовать `{@render children?.()}` и `$props()`), `createEventDispatcher` (использовать коллбэки в пропсах), `svelte:component` (динамические компоненты через `{@const Comp = ...}` или `#if`), `writable`/`readable` из `svelte/store` для локального состояния (`$state`, `$derived`, `$effect`).
2. **Только Tailwind.** Никаких `<style>`-блоков с кастомным CSS в компонентах; классы — утилитарные.
3. **Пути и именование:** компоненты в `src/lib/components/ui/<name>/<name>.svelte` (один компонент — один каталог), файлы — `kebab-case`, экспорт — `index.ts` при необходимости.
4. **Зависимости:** не добавлять npm-пакет, не объявив его в реестре; скопированный файл можно править, но при правке обновлять его хеш в `.vibelog/installed.lock.json`.

---

## 7. Порядок работ и критерии готовности первой версии

| Шаг | Содержание | Готово, когда |
|---|---|---|
| 1 | `Vibelog-md/templates` + шаблон `svelte-minimal` (`package.json` с `vibelog.type`, `postCreate`, `CLAUDE.md`) | `sv create`-набор зафиксирован, шаблон собирается и запускается |
| 2 | `vb create`: sparse-checkout, копирование, зависимости, `postCreate`, `git init` | пустой каталог → работающий проект с `.vibelog/` одной командой |
| 3 | `Vibelog-md/ui`: `registry.json`, сборка в `public/r/*.json`, корневой элемент `vibelog.md/ui` (`utils.ts`, `cn`, CSS-переменные) | `public/r/vibelog.md/ui.json` валиден по схеме и собирается детерминированно |
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
- ни одна команда не создаёт файлов в корне проекта, кроме файлов самого шаблона.

---

## 8. Открытые вопросы

1. Валидация схемы `config.json`/`installed.lock.json` при чтении — отдельный шаг или встроена в парсинг (влияет на коды ошибок `2`/`3`).
2. Формат вывода `--dry-run`: человекочитаемый или JSON (`--json` для агента).
3. Нужен ли `vb install --list` (показать установленное из lock-файла) в первой версии.
4. Правило бампа версии элемента реестра: ручной в `registry.json` или автоматический из git-тега.
5. Поведение `vb create`, если `postCreate` упал: оставлять проект как есть или удалять созданный каталог.
