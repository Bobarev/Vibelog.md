---
id: VL-333
title: 'Схемы состояния компонентов: секция components в .vibelog/settings.json и installed.lock.json — чтение, валидация, атомарная запись'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-04 16:45'
updated_date: '2026-11-09 21:42'
due_date: ''
labels:
  - vb-cli
  - registry
  - core
  - infra
dependencies: []
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
  - src/core/components-config.test.mjs
lessons:
  - lesson-214
token_usage:
  input: 2975375
  output: 29325
  cache: 2625024
  total: 3004700
  requests: 65
  duration_ms: 1535978
  reasoning: 8596
  by_phase:
    code:
      input: 942908
      output: 17421
      cache: 814592
      requests: 19
    close:
      input: 2032467
      output: 11904
      cache: 1810432
      requests: 46
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Первая задача реализации doc-25 (v1.1, §3.1–3.2). Фундамент для всех остальных: без чтения/записи конфигурации компонентов и lock-файла не работают ни `vb init --components`, ни `vb install`, ни `vb create`.

**Что нужно сделать.** Модуль работы с двумя файлами состояния:

1. **Секция `components` в `.vibelog/settings.json`** (не отдельный `config.json` — это решение v1.1). Схема:
```json
{
  "components": {
    "schemaVersion": 1,
    "registries": { "vibelog.md": { "owner": "Vibelog-md", "branch": "main" } },
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
Ключевое: `settings.json` уже содержит `chats`, `models`, `providers`, `workflows`, `mcpServers` и др. (VL-143, VL-329) — запись обязана быть read-modify-write и не затирать чужие секции.

2. **`.vibelog/installed.lock.json`** — состояние установленных компонентов: `schemaVersion`, `components[name] = {version, installedAt, dependencies, files{path: {hash, sourceVersion}}}`. Хеш — `sha256:` + hex от содержимого записанного файла.

**Почему отдельная задача.** Валидация схем и атомарная запись — общий риск для трёх команд сразу. Ошибка здесь (затёртая секция `models` или невалидный путь в `aliases`) проявится далеко от места поломки. Поэтому модуль делается и тестируется изолированно, до появления CLI-команд.

**Границы.** Задача не создаёт команды и не ходит в сеть. Только: чтение, валидация, запись, хеширование, разрешение алиаса в путь. `vb init --components` (следующая задача) будет вызывать `writeComponentsConfig`; `vb install` — `readLock`/`writeLock`/`hashFile`/`resolveAliasPath`.

**Связанные решения:** doc-25 §3.1, §3.2, §3.6, §8 п.1, §9 (валидация `aliases`); VL-329 (git-политика `.vibelog/`, `settings.json` коммитится).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Секция `components` в `.vibelog/settings.json` читается и валидируется: `schemaVersion`, `registries` (карта alias → {owner, branch}), `aliases` (components/ui/utils/css), `lockFile`; отсутствие секции — не ошибка, а признак «не инициализировано» (код 2 с подсказкой `vb init --components`)
- [x] #2 Валидация `aliases`: каждый путь относительный, не выходит за корень проекта (нет `..` и абсолютных путей), иначе код 3 с указанием поля
- [x] #3 Валидация `registries`: `owner` без точки, `branch` — непустая строка; неизвестный alias в пути команды даёт понятную ошибку со списком доступных
- [x] #4 `.vibelog/installed.lock.json` читается и валидируется: `schemaVersion`, `components[name] = {version, installedAt, dependencies, files{path: {hash, sourceVersion}}}`; битый JSON или несовпавший `schemaVersion` → код 2 с указанием файла и поля
- [x] #5 Запись обоих файлов атомарна: temp-файл в том же каталоге + `rename`; при сбое на любом шаге исходный файл остаётся нетронутым (тест с искусственной ошибкой записи)
- [x] #6 Запись `settings.json` не затирает чужие секции: `chats`, `models`, `providers`, `workflows`, `mcpServers` и прочие ключи сохраняются байт-в-байт по смыслу (read-modify-write, тест на файле с посторонними ключами)
- [x] #7 Порядок ключей и форматирование стабильны: повторная запись без изменений не меняет файл (идемпотентность, тест на сравнение содержимого)
- [x] #8 Хеширование файла: функция `sha256:<hex>` от содержимого, единая точка использования (нужна и `vb install`, и будущему `vb update`)
- [x] #9 Публичный API модуля покрыт типами: `readComponentsConfig`, `writeComponentsConfig`, `readLock`, `writeLock`, `hashFile`, `resolveAliasPath` — экспортируются из одного модуля и не требуют чтения `svelte.config.js`
- [x] #10 Тесты: валидные/битые схемы, отсутствие секции, выход за корень через `..` и абсолютный путь, сохранение посторонних ключей, атомарность при сбое, идемпотентная перезапись
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
**Файлы.** Новый модуль `src/core/components-config.ts` (схемы + чтение/запись) и `src/core/components-config.test.mjs`. Переиспользовать существующее: `src/core/settings.ts` (`loadSettings`, `saveSettingsPatch`, `settingsPath`) — не дублировать чтение `settings.json`; `src/core/paths.ts` — корень проекта и `.vibelog/`.

**Шаг 1. Типы и схемы.**

1. Объявить интерфейсы: `ComponentsConfig { schemaVersion, registries, aliases, lockFile }`, `RegistryEntry { owner, branch }`, `Aliases { components, ui, utils, css }`, `LockFile { schemaVersion, components: Record<string, LockedComponent> }`, `LockedComponent { version, installedAt, dependencies, files: Record<string, LockedFile> }`, `LockedFile { hash, sourceVersion }`.
2. Константа `COMPONENTS_SCHEMA_VERSION = 1`; при несовпадении — ошибка с кодом 2 (не «молча мигрировать»).
3. Класс/фабрика ошибки `ComponentsConfigError` с полем `code` (2 — предусловие/схема, 3 — данные/путь) и `field` (какое поле не прошло валидацию) — CLI будет печатать `message` одной строкой.

**Шаг 2. Чтение секции `components`.**

4. `readComponentsConfig(cwd): ComponentsConfig | null` — читает `.vibelog/settings.json` через `loadSettings`, возвращает `null`, если секции нет (это НЕ ошибка: `vb install` превратит `null` в подсказку «выполните `vb init --components`»).
5. Валидация при чтении: `schemaVersion` — целое и равно поддерживаемому; `registries` — объект, у каждой записи `owner` (непустая строка без точки) и `branch` (непустая строка); `aliases` — все четыре ключа присутствуют и являются строками; `lockFile` — непустая строка.
6. `validateAliasPath(alias, value)` — путь относительный, не абсолютный, после `path.resolve(cwd, value)` не выходит за `cwd` (проверка через `path.relative` и `startsWith('..')`). Нарушение → код 3 с именем алиаса.
7. `resolveAliasPath(cwd, config, alias, target)` — склеивает `aliases[alias]` с `target`, повторно валидирует выход за корень (вторая линия защиты: `target` приходит из сети). Для `aliases.utils`/`aliases.css` (файл, а не каталог) — `target` не должен содержать `/`.

**Шаг 3. Чтение lock-файла.**

8. `readLock(cwd, config): LockFile` — путь берётся из `config.lockFile` (не хардкод). Файла нет → `{ schemaVersion: 1, components: {} }` (первый запуск — норма).
9. Валидация: `schemaVersion` совпадает; `components` — объект; у каждой записи `version` (строка `X.Y.Z`), `installedAt` (ISO-строка, парсится `Date`), `dependencies` (массив строк), `files` (объект, ключи — относительные пути внутри проекта, значения — `{hash: "sha256:<64 hex>", sourceVersion: "X.Y.Z"}`). Битый JSON → код 2 с указанием файла и позиции парсера.

**Шаг 4. Атомарная запись.**

10. `writeJsonAtomic(path, data)` — общий хелпер: `JSON.stringify(data, null, 2) + '\n'`, запись в `<path>.tmp-<pid>-<rand>` в том же каталоге, `fsync`, `rename` поверх целевого. При любой ошибке — удалить temp, пробросить ошибку, целевой файл не тронут.
11. `writeComponentsConfig(cwd, config)` — read-modify-write: читает текущий `settings.json` целиком (`loadSettings`), подменяет только ключ `components`, пишет через `writeJsonAtomic`. Чужие секции (`chats`, `models`, `providers`, `workflows`, `mcpServers`, `chat_personas`, `commit_coauthor` и любые неизвестные) сохраняются.
12. `writeLock(cwd, config, lock)` — пишет по `config.lockFile` через `writeJsonAtomic`.
13. Стабильность: `JSON.stringify` с фиксированным порядком ключей (собирать объект явно, не полагаться на порядок вставки из парсинга) — повторная запись без изменений даёт идентичный файл.

**Шаг 5. Хеширование.**

14. `hashFile(absPath): string` — `sha256:` + hex от содержимого файла (`node:crypto`, `createHash('sha256')`). Единая точка: её же будет использовать `vb install` и будущий `vb update`.
15. `hashContent(buffer): string` — та же функция от буфера (нужна для проверки «что будет записано» до записи, в `--dry-run`).

**Шаг 6. Тесты (`src/core/components-config.test.mjs`).**

16. Валидная секция читается; отсутствие секции → `null`; `schemaVersion: 2` → код 2.
17. `aliases.ui = "../../etc"` → код 3; `aliases.ui = "/etc"` → код 3; `target = "../x.svelte"` → код 3.
18. `settings.json` с посторонними ключами (`models`, `chats`, `mcpServers`) после `writeComponentsConfig` сохраняет их значения (сравнение распарсенных объектов).
19. Идемпотентность: два вызова `writeComponentsConfig` с одинаковыми данными → файл байт-в-байт идентичен.
20. Атомарность: подменить `rename` на бросающую функцию (или сделать каталог read-only) → целевой файл не изменён, temp удалён.
21. `readLock` на битом JSON → код 2; на отсутствующем файле → пустой lock; на записи с невалидным хешем → код 2.
22. `hashFile` на известном содержимом даёт ожидаемый hex (фикстура), `hashContent` совпадает с `hashFile`.

**Риски.**
- `loadSettings` может кэшировать или нормализовать значения — проверить, что read-modify-write не теряет ключи, которых нет в типе `BotSettings` (в `settings.json` есть `workflows`, `chat_personas`, `providers` — они не описаны в `BotSettings`).
- `settings.json` коммитится в git (VL-329): лишний diff из-за переупорядочивания ключей будет шумом в истории — отсюда требование стабильного порядка.
- Пути в `aliases` относительны корню проекта, а CLI может запускаться из подкаталога — корень определять так же, как `findBacklogDir`/`settingsPath`, не через `process.cwd()` напрямую.

**Проверка.** `pnpm typecheck && pnpm test`; отдельно прогнать тесты модуля на реальном `.vibelog/settings.json` этого проекта (read → write с теми же данными → `git diff` пустой).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-04 19:28
---
Фаза 3 (Code) выполнена. Изменено: `src/core/components-config.ts` (новый модуль), `src/core/components-config.test.mjs` (33 теста). Коммит 41a9977.
**Что сделано:**
- Типы: `ComponentsConfig`, `RegistryEntry`, `Aliases`, `LockFile`, `LockedComponent`, `LockedFile`; `COMPONENTS_SCHEMA_VERSION = 1`; `ComponentsConfigError` с полями `code` (2 — схема/предусловие, 3 — данные/путь) и `field`.
- Чтение секции `components` из `.vibelog/settings.json` через `loadSettings` (своего парсера нет): `readComponentsConfig` → `null`, если секции нет; `requireComponentsConfig` → код 2 с подсказкой «выполните `vb init --components`». Валидация `schemaVersion`, `registries` (owner без точки, непустой branch), `aliases` (все 4 ключа), `lockFile`.
- `validateAliasPath` / `resolveAliasPath`: абсолютные пути, `~`, `..` и выход за корень проекта (через `path.relative`+`startsWith('..')`) → код 3 с именем поля; для `utils`/`css` target без `/` и кладётся в `dirname` алиаса (это файл, не каталог); повторная проверка target — вторая линия защиты от сетевого манифеста; неизвестный алиас → ошибка со списком доступных.
- `readLock`/`writeLock`: путь из `config.lockFile` (не хардкод), отсутствие файла → `{schemaVersion:1, components:{}}`, битый JSON → код 2 с путём файла и сообщением парсера, валидация version/installedAt/dependencies/files/hash (`sha256:<64 hex>`)/относительных путей; `writeLock` валидирует до записи.
- `writeJsonAtomic`: temp-файл `<path>.tmp-<pid>-<rand>` в том же каталоге, `fsync`, `rename` поверх; при любой ошибке temp удаляется, целевой файл не тронут (тест с подменой `rename`).
- `writeComponentsConfig`: read-modify-write, подменяет только ключ `components` на его месте, порядок верхнего уровня сохраняется — `chats`, `models`, `providers`, `workflows`, `mcpServers`, `chat_personas`, `commit_coauthor` и незнакомые ключи сохраняются; стабильный порядок ключей (сортировка `registries`/`components`/`files`) → повторная запись байт-в-байт идентична.
- `hashFile`/`hashContent`: `sha256:` + hex через `node:crypto`, единая точка для `vb install`/`vb update`.
**Проверки:** `pnpm typecheck` — чисто; `pnpm test` — полный прогон без exclude/skip по коду: 169 файлов, 3255 тестов passed, 4 skipped (пред-существующие skip), включая `src/web/static.test.mjs`. Отдельно — `npx vitest run src/core/components-config.test.mjs` (33/33). Дополнительно: read → write на копии реального `.vibelog/settings.json` этого проекта — все чужие ключи и их порядок сохранены, повторное чтение конфигурации совпадает (git diff по реальному файлу пуст, реальный файл не трогался).
**Не сделано:** DoD «Документация обновлена» — по правилам фазы Code документы backlog/docs пишет Фаза Close (doc-25 требует отдельного раздела по CLI-командам, которых в этой задаче нет).
---
author: @agent
created: 2026-11-04 19:29
---
Отметка AC по факту реализации VL-333: 1–10 выполнены (чтение/валидация секции components, валидация aliases и registries, lock-файл, атомарная запись обоих файлов, сохранение чужих секций settings.json, идемпотентность, sha256-хеширование, публичный API с типами, тесты 33 кейса). DoD 1 (тесты) — полный pnpm test зелёный; DoD 2 (документация) — за Фазой Close; DoD 3 (нет регрессий) — 3255 тестов passed.
---
author: @agent
created: 2026-11-04 19:52
---
Фаза Close выполнена.
**Merge.** Ветка `vb/vl-333` (1 коммит `41a9977`) слита в master через `--no-ff` — merge-коммит `7b47c22`. Конфликтов нет; принесено 2 файла: `src/core/components-config.ts` (609 строк), `src/core/components-config.test.mjs` (441 строка).
**Проверки после merge.**
- Сборка `pnpm build` — зелёная (один раз за фазу).
- Ранний точечный фильтр: `src/core/components-config.test.mjs` — 33/33 passed.
- Полный прогон `pnpm test:fast`: первый прогон дал 1 падение в `src/mcp/supervisor-tools.test.mjs` («превышен max_parallel_phases»), не связанном с diff'ом задачи. Классификация: (а) изолированный прогон `npx vitest run src/mcp/supervisor-tools.test.mjs` — 18/18 passed; (б) параллельного `vitest` в других worktree не было (`ps aux | grep vitest` пуст). Признано интерференцией параллельного прогона, выполнен **один** повторный полный прогон: 170 файлов, 3263 passed, 4 skipped — зелёный.
**Уборка.** `git worktree remove` отказал из-за untracked-симлинков (`backlog/references/data`, `node_modules` — ссылки на главный репозиторий), удалено с `--force`; данных не потеряно. Ветка `vb/vl-333` удалена (`-d`, была 41a9977).
**Lessons.** Создан `lesson-214` (read-modify-write + temp/rename для общих конфигов проекта), связан с задачей через `lesson_link`.
**Документация.** CHANGELOG.md — запись в Unreleased/«Добавлено» (VL-333); doc-25 §3.2 — подраздел «Реализация (VL-333)» с перечнем API и правил. Коммиты: `c2da0d4` (lesson-214), `2ca4d61` (CHANGELOG + doc-25).
**DoD:** 1 «Тесты проходят» — полный прогон зелёный; 2 «Документация обновлена» — CHANGELOG и doc-25 обновлены; 3 «Нет регрессий» — 3263 passed, падений, связанных с задачей, нет.
Незакоммиченным остаётся только `.vibelog/settings.json` (дрейф тарифа `output_per_1m`, не правка задачи) и файлы задач VL-332/VL-334 — к этой задаче не относятся.
---
<!-- COMMENTS:END -->