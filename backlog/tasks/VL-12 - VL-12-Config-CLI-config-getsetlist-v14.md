---
id: VL-12
title: 'VL-12: Config — CLI config get/set/list (v1.4)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 00:27'
updated_date: '2026-10-01 00:56'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Config (v1.4) — управление конфигом без ручного редактирования YAML. Оригинал: config get <key> / set <key> <value> / list (cli.ts:5048-5475).

Реализация:
1. src/cli/commands/config.mjs — runConfig:
   - get <key> — значение (строка/число/массив — вывод через JSON для нестрок)
   - set <key> <value> — loadConfig → правка ключа → saveConfig (ключи в whitelist из defaultConfig + известные; типизация: число/boolean/JSON-массив по синтаксису значения)
   - list — все ключи (key=value, массивы через JSON)
2. src/cli/router.mjs — case 'config' + help.
3. Тесты: src/cli/config-cli.test.mjs (/tmp, spawnSync).

MCP-инструментов нет (как в оригинале).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 config get <key> выводит значение; config set <key> <value> записывает в backlog/config.yml с сохранением остальных ключей
- [x] #2 config list выводит все пары ключ=значение
- [x] #3 Валидация: неизвестный ключ — ошибка с подсказкой; типы значений (массивы/числа/булевы) корректно сериализуются нашим YAML-парсером; pnpm test проходит
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: Config — CLI config get/set/list (VL-12)

Оригинал: фиксированные списки ключей (CONFIG_GET_KEYS/CONFIG_SET_KEYS) + switch по ключу, значения парсятся по типу ключа. Мы: whitelist ключей из defaultConfig + карта типов (snake_case — как в config.yml, формат совместим).

### Файлы для изменения/создания

1. **Создать src/cli/commands/config.mjs** (~110 строк) — runConfig(subcommand, positional, flags, cwd)
   - Whitelist ключей: Object.keys(defaultConfig('x', 'x')) — 18 ключей (project_name, task_prefix, default_status, statuses, labels, priorities, types, definition_of_done, date_format, default_editor, auto_open_browser, default_port, remote_operations, auto_commit, bypass_git_hooks, check_active_branches, active_branch_days, max_column_width)
   - Карта типов для парсинга set:
     - массивы: statuses, labels, priorities, types, definition_of_done — JSON-массив (`["a","b"]`) ИЛИ через запятую (`a,b`)
     - boolean: auto_open_browser, remote_operations, auto_commit, bypass_git_hooks, check_active_branches — `true`/`false`
     - числа: default_port, active_branch_days, max_column_width — Number(), валидация
     - строки: остальное (пустое значение допустимо — очистка)
   - get <key>: валидация whitelist → вывод значения (строки как есть, прочее — JSON.stringify)
   - set <key> <value>: валидация → парсинг по типу → loadConfig → правка → saveConfig → printSuccess
   - list: все ключи конфига `key=value` (массивы/boolean/числа — JSON)
   - Ошибки: неизвестный ключ → printError со списком допустимых

2. **Обновить src/cli/router.mjs** — case 'config' → runConfig + help (main help + showCommandHelp)

3. **Создать src/cli/config-cli.test.mjs** (~80 строк, /tmp/vibelog-config-test, spawnSync)
   - get project_name / get statuses (массив)
   - set default_editor (строка), set default_port 8080 (число), set auto_commit true (boolean), set priorities High,Low (массив через запятую)
   - list содержит project_name и default_port
   - неизвестный ключ → ошибка в выводе
   - set не затирает остальные ключи (после set новый key=3, get task_prefix не изменился)
   - невалидное число → ошибка

### Порядок действий
1. config.mjs (команда)
2. router.mjs (help)
3. config-cli.test.mjs
4. pnpm test + ручной прогон в /tmp

### Проверки
- node --check всех файлов
- pnpm test (все)
- Ручной: /tmp/vl12 — config set/get/list

### Риски
- Наш YAML-парсер должен корректно сериализовать boolean/числа/массивы — проверяется тестами round-trip (stringifyYaml уже пишет типы из defaultConfig)
- Порча config.yml — set только через loadConfig→saveConfig (полная перезапись с сохранением всех ключей); тест на незатирание
- Ключи snake_case — не camelCase оригинала: это формат файла (совместим с оригиналом), CLI-ключи идентичны ключам YAML
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-01 00:56
---
Фаза 3 (Code) завершена. 3/3 AC.
Реализовано:
- src/cli/commands/config.mjs (новый): get/set/list. Whitelist ключей — из defaultConfig (18 ключей snake_case, формат файла идентичен оригиналу). Парсинг set по типу ключа: массивы (statuses/labels/priorities/types/definition_of_done) — JSON или через запятую; boolean — true/false; числа — Number() с валидацией; строки — как есть (пустое значение — очистка). set = loadConfig → правка → saveConfig (остальные ключи сохраняются).
- src/cli/router.mjs: case 'config' + help (main + command).
- src/cli/config-cli.test.mjs (новый, 7 тестов): get всех типов, set всех типов, list, незатирание ключей, ошибки (неизвестный ключ, невалидные число/boolean, set без значения).
MCP-инструментов нет — CLI-only, как в оригинале (совместимость).
Проверки: pnpm test — 281/281 ✓; node --check ✓; ручной CLI-тест в /tmp ✓ (set default_port 9999, types ["bug","feature"], list).
---
<!-- COMMENTS:END -->