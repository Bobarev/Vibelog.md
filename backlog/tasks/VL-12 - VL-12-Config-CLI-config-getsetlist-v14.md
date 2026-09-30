---
id: VL-12
title: 'VL-12: Config — CLI config get/set/list (v1.4)'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-01 00:27'
updated_date: '2026-10-01 00:27'
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
- [ ] #1 config get <key> выводит значение; config set <key> <value> записывает в backlog/config.yml с сохранением остальных ключей
- [ ] #2 config list выводит все пары ключ=значение
- [ ] #3 Валидация: неизвестный ключ — ошибка с подсказкой; типы значений (массивы/числа/булевы) корректно сериализуются нашим YAML-парсером; pnpm test проходит
<!-- AC:END -->