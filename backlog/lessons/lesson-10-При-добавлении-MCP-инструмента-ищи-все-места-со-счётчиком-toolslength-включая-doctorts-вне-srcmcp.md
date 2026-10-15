---
id: lesson-10
title: 'При добавлении MCP-инструмента ищи все места со счётчиком tools.length, включая doctor.ts вне src/mcp'
status: active
tags:
  - mcp
  - счётчики
  - тесты
  - doctor
source_tasks:
  - VL-164
linked_tasks:
  - VL-164
created_date: 2026-10-15
updated_date: 2026-10-15
supersedes: ''
---
## Проблема

При добавлении нового MCP-инструмента (VL-164, `reference_update`) счётчик `36 → 37` был продублирован в 4 тестовых файлах по плану, но оказался и вне плана: `src/cli/commands/doctor.ts` (диагностика `mcp_tools_count`) и его тест `src/cli/diagnostics.test.mjs`. Пропуск уронил бы `pnpm test`.

## Решение

При добавлении/удалении MCP-инструмента ищи все места со счётчиком инструментов одним батчем перед коммитом:

```bash
grep -rn "36" src/mcp/*.test.mjs src/core/compat-full.test.mjs src/cli/commands/doctor.ts src/cli/diagnostics.test.mjs | grep -i "tool\|count"
```

И прогоняй полный `pnpm test` (не только `test:fast` по изменённым файлам) — диагностика CLI живёт вне `src/mcp/`.

## Пример

VL-164: план указывал 4 файла со счётчиком; фактически правок потребовалось 6 (doctor.ts + diagnostics.test.mjs добавились) — поймано прогоном тестов в Code-фазе.