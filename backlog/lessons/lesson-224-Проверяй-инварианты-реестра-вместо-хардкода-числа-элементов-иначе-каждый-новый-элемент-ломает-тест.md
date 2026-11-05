---
id: lesson-224
title: Проверяй инварианты реестра вместо хардкода числа элементов — иначе каждый новый элемент ломает тест
status: active
tags:
  - doctor
  - mcp
  - tests
  - инварианты
source_tasks:
  - VL-340
linked_tasks:
  - VL-340
created_date: 2026-11-05
updated_date: 2026-11-05
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема

`vibelog doctor` проверял MCP-реестр хардкодом: `const expected = 45` плюс полный массив 45 имён в рантайме. Каждый новый MCP-инструмент требовал правки `doctor.ts` и падающего теста (`assert.equal(mcpCheck.value, 45)`), а сама проверка не ловила реальные дефекты (дубли имён, инструмент без схемы) — только «список не тот, что вчера». В CHANGELOG это повторялось 36→37→38→42→43→44→45.

## Решение

Проверять инварианты, а не снимок: реестр непуст, имена не дублируются, каждое имя начинается с известного префикса (константа модуля), у каждого инструмента есть `inputSchema` типа `object`. Ожидаемый список имён переезжает в фикстуру теста, а не в рантайм-код. Фактическое число остаётся в `value.count` как справка, но не как ожидание.

## Пример

`checkMcpToolsInvariants()` в `src/cli/commands/doctor.ts` (VL-340): `new Set(names).size === names.length`, `MCP_TOOL_PREFIXES.some(p => name.startsWith(p))`, `typeof tool.inputSchema === 'object' && tool.inputSchema.type === 'object'`. Тест проверяет `mcp_tools_invariants.ok === true` и отдельным кейсом — что дубль имени валит проверку.
