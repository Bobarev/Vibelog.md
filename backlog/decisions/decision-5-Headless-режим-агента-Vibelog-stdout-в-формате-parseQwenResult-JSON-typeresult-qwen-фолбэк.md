---
id: decision-5
title: 'Headless-режим агента Vibelog — stdout в формате parseQwenResult (JSON type=result), qwen — фолбэк'
date: 2026-10-04
status: proposed
---
## Context

VL-75: headless-режим для оркестратора (VL-58+) без изменений оркестратора. Контракт (src/web/qwen-result.ts:21-30 QwenResult, :75-88 findResult, :92-160 parseQwenResult): stdout — либо NDJSON-поток с type=result последней строкой, либо строка-массив [{…},{type=result}] (json-адаптер qwen 0.24.x); поля result/is_error/num_turns/duration_ms/duration_api_ms/session_id/usage{input_tokens,output_tokens,cache_read_input_tokens,total_tokens}; парсер ищет result с конца, битые строки пропускает. Spawn-аргументы оркестратора (src/web/orchestrator.ts:187-210): bin=VIBELOG_QWEN_BIN||'qwen', argv=[промпт позиционно, --approval-mode yolo, --output-format json, --allowed-mcp-server-names vibelog (spec/plan)], stdout/stderr строго раздельно (VL-63: stderr вклинивался в JSON-строку). Шаблоны templates/qwen-commands/phase-*.md ({{taskId}}/{{comment}}/{{prompt}}) — общий контракт фаз.
## Decision

Headless-режим vibelog-agent печатает в stdout финальный JSON type=result в точности в формате parseQwenResult (NDJSON-хвост либо строка-массив), usage.usage-поля заполняются из клиентского учёта токенов Cloud.ru (num_turns = число ходов модели). Аргументы headless-режима агента повторяют оркестраторные: позиционный промпт, --output-format json (для совместимости), --approval-mode yolo-equivalent (auto-approve), --allowed-mcp-server-names vibelog. Переключение оркестратора на агента — одной настройкой VIBELOG_AGENT_BIN (фолбэк на VIBELOG_QWEN_BIN сохраняется). Шаблоны phase-*.md переиспользуются без изменений.
## Consequences

Оркестратор (startPhase/spawnQwenRun), бот и web не меняются — совместимость на уровне stdout-контракта; qwen остаётся рабочим фолбэком. Риск: usage-поля Cloud.ru отличаются от qwen (input_tokens/output_tokens есть у OpenAI-формата, cache_read может отсутствовать → 0); это не ломает парсер (дефолты в toQwenResult).
## Alternatives

Свой формат результата (новый парсер в оркестраторе) — ломает фолбэк qwen и дублирует логику VL-63/64; NDJSON-only (отказ от строка-массив) — парсер уже принимает оба формата, отказ сужает совместимость без выгоды; отдельный бинарник оркестратора под агента — дублирование spawn-логики (VL-63 разбирался в её гонках).