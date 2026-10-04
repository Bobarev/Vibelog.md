---
id: VL-64
title: Оркестратор — парсинг JSON-результата qwen (result-строка) в PhaseRun
status: Done
assignee: []
reporter: ''
created_date: '2026-10-03 13:52'
updated_date: '2026-10-04 18:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.6
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
Оркестратор (src/web/orchestrator.ts) запускает qwen с --output-format json, но stdout целиком копится в log/logTail без разбора (VL-28, VL-61). Чтобы бот мог собрать информационное сообщение по окончании фазы из последней JSON-строки (VL-63), нужен парсер.

Что сделать:
1. Новый модуль src/web/qwen-result.ts: чистая функция parseQwenResult(log: string) — сканирует строки лога с конца, находит последнюю строку, парсящуюся как JSON с полем type=result, извлекает поля: result (текст ответа), usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens, usage.total_tokens, duration_ms, duration_api_ms, num_turns, session_id, is_error. Тип QwenResult в сигнатуре.
2. В PhaseRun добавить поле result?: QwenResult; в finish() заполнять parseQwenResult(log).
3. Юнит-тесты src/web/qwen-result.test.mjs (через dist/): валидная result-строка среди шума (init/stream_event/assistant), отсутствие result → undefined, битый JSON → undefined, is_error=true сохраняется, пустой лог → undefined.
4. CHANGELOG.md — пункт фичи.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 parseQwenResult принимает сырой лог (строки stdout) и возвращает структурированный результат из последней валидной JSON-строки с type=result (result, input_tokens, output_tokens, cache_read_input_tokens, total_tokens, duration_ms, duration_api_ms, num_turns, session_id, is_error)
- [ ] #2 Если в логе нет валидной result-строки (крэш qwen, битый JSON), функция возвращает undefined — без исключений
- [ ] #3 PhaseRun получает поле result, заполняемое в finish(); тесты покрывают: валидная строка среди шума (init/assistant), отсутствие результата, битый JSON, is_error=true
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->