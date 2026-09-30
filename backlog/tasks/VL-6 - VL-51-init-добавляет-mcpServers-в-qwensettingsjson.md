---
id: VL-6
title: 'VL-5.1: init добавляет mcpServers в .qwen/settings.json'
status: Done
assignee: []
reporter: ''
created_date: '2026-09-30 22:53'
updated_date: '2026-09-30 23:02'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
В src/cli/commands/init.mjs добавить MCP-автонастройку (по умолчанию включена, отключение флагом --no-mcp):

1. Новая функция handleMcpSetup(flags, cwd) — вызывается из runInit после handleSkills:
   - если flags['no-mcp'] — выйти без действий;
   - прочитать или создать .qwen/settings.json в cwd (если файла нет — создать {});
   - merge-секции: settings.mcpServers.vibelog = { command: 'vibelog', args: ['mcp', 'start'], trust: true } — не затирать остальные mcpServers и ключи файла;
   - сохранить файл (JSON, отступ 2, без потери $version и пр.);
   - вывести printSuccess с подсказкой перезапустить Qwen Code.

2. Идемпотентность: повторный init перезаписывает ту же секцию теми же значениями.

Формат секции — из описания VL-5 (подтверждён .qwen/settings.json репозитория).

Файлы: src/cli/commands/init.mjs, новый src/cli/init-mcp.test.mjs (init в /tmp, проверка JSON через node).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 После `vibelog init` в .qwen/settings.json проекта есть mcpServers.vibelog: {command: "vibelog", args: ["mcp", "start"], trust: true}
- [x] #2 Существующие ключи settings.json (ui, $version и др.) сохраняются; повторный init идемпотентен — секция не дублируется и не ломается
- [x] #3 --no-mcp не создаёт и не трогает секцию mcpServers; тесты в pnpm test проходят
<!-- AC:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Plan: VL-5.1 — init добавляет mcpServers (VL-6)

### Файлы для изменения

1. **src/cli/commands/init.mjs** (160 строк)
   - Новая функция `handleMcpSetup(flags, cwd)` (~35 строк) — разместить после `handleSkills` (после строки 133, перед `updateAgentsMd`).
     Импорты уже sufficient: `existsSync, readFileSync, writeFileSync, mkdirSync` из node:fs, `join, dirname` из node:path — новый импорт не нужен.
   - В `runInit` после вызова `handleSkills(flags, cwd);` (строка ~78) добавить `handleMcpSetup(flags, cwd);`

2. **src/cli/init-mcp.test.mjs** (новый, ~100 строк) — по паттерну skills.test.mjs (testDir = /tmp/vibelog-init-mcp-test, execFileSync, проверка содержимого, не exit code — Catalina SIGABRT).

### Логика handleMcpSetup
```
if (flags['no-mcp']) return;              // opt-out
settingsPath = join(cwd, '.qwen', 'settings.json')
settings = {}
if файл существует:
  try { settings = JSON.parse(readFileSync) }
  catch { printError('не удалось разобрать...'); return }  // init не роняем
settings.mcpServers ||= {}
settings.mcpServers.vibelog = { command: 'vibelog', args: ['mcp', 'start'], trust: true }
mkdirSync(dirname(settingsPath), { recursive: true })
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
printSuccess('MCP-сервер vibelog настроен в .qwen/settings.json — перезапустите Qwen Code')
```
Ключи `ui`, `$version`, чужие `mcpServers.*` сохраняются (merge, не replace). Повторный init перезаписывает vibelog-секцию теми же значениями — идемпотентность.

### Тесты (init-mcp.test.mjs)
1. init без флагов → .qwen/settings.json создан, mcpServers.vibelib = {command:'vibelog', args:['mcp','start'], trust:true}.
2. Сохранение чужих ключей: предзаписать settings.json {ui, $version, mcpServers.other} → init → все на месте + vibelog добавлен.
3. Идемпотентность: двойной init (второй с --force) → JSON строго равен (без дублей).
4. --no-mcp → settings.json не создаётся.
5. Повреждённый JSON → init завершается (backlog создан), в выводе ошибка про settings.json.

### Порядок действий
1. handleMcpSetup + вызов в runInit
2. init-mcp.test.mjs
3. pnpm lint + pnpm test

### Проверки
- node --check init.mjs, init-mcp.test.mjs
- pnpm test (все)
- Ручной: /tmp/vl6-manual — init → проверка JSON; чистая dir с --no-mcp; повторный init --force

### Риски
- Повреждённый settings.json — не ронять init (printError + return, backlog создаётся)
- `command: 'vibelog'` требует vibelog в PATH (глобальная установка) — соответствует описанию VL-5; ручной фолбэк документируем в VL-7 (MCP-SETUP.md)
- Catalina SIGABRT — тесты проверяют содержимое файла/вывод, не exit code
- help-текст init (--no-mcp) — в скоупе VL-7, не здесь
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-09-30 23:02
---
Фаза 3 (Code) завершена. 3/3 AC.
Реализовано:
- src/cli/commands/init.mjs: handleMcpSetup(flags, cwd) — вызывается из runInit после handleSkills. По умолчанию создаёт/обновляет .qwen/settings.json: merge-секция mcpServers.vibelog = {command: 'vibelog', args: ['mcp', 'start'], trust: true}. Чужие ключи (ui, $version, другие mcpServers) сохраняются. Битый JSON → printError + выход из функции, init не роняется. --no-mcp — полный opt-out.
- src/cli/init-mcp.test.mjs (новый, 5 тестов): создание секции, merge чужих ключей, идемпотентность повторного init --force, --no-mcp, битый JSON.
- src/cli/skills.test.mjs: проверка «.qwen не создаётся» заменена на «команды /vibelog:* не создаются» — .qwen/settings.json теперь создаётся всегда (осознанное изменение поведения).
Проверки: pnpm lint ✓; pnpm test — 235/235 ✓; ручной CLI-тест в /tmp (init → cat settings.json → повторный init --force идемпотентен → --no-mcp без .qwen) ✓.
Изменения не закоммичены — жду подтверждения.
---
<!-- COMMENTS:END -->