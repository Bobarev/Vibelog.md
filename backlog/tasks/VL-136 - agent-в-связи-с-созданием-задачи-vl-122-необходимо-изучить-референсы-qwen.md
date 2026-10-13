---
id: VL-136
title: 'Компакшн контекста: сравнение Qwen Code и OpenCode, рекомендация'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-13 08:15'
updated_date: '2026-10-13 10:09'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст: VL-122 — llm.ts шлёт LLM всю историю сообщений без ограничений; там же намечено решение «усечение payload запроса (system + первый user + последние N), jsonl-транскрипт остаётся полным». Прежде чем реализовывать, нужно понять, как эту проблему решают зрелые агенты.

Задача: изучить референсы Qwen Code и OpenCode (механизмы ограничения истории / компакшна контекста) и по результатам создать сравнительный документ (docs/), в котором предложить лучшее решение для нашей архитектуры.

Содержание документа (уточнение постановки, не план):
- как каждый агент решает проблему роста контекста: что сохраняет в запросе, как отмечает усечение, по каким признакам запускает компакшн;
- сравнение по критериям, важным для нас: простота, детерминизм, Node.js 20+, сохранение jsonl-транскрипта для resume и мета-логики;
- конкретная рекомендация для VL-122 с обоснованием.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [x] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель
Исследовать механизмы компакшна контекста в референсах Qwen Code / OpenCode и создать сравнительный документ в docs/ с рекомендацией для VL-122. Код не меняется — только документ + обратная ссылка в VL-122.

## Материалы (найдены на этапе Plan, ориентиры — файл:строка)

### Qwen Code (refs/qwen-code/packages/core/src)
- services/chatCompressionService.ts (1362 стр.) — LLM-компакшн: computeThresholds (~180–240) — трёхуровневая лестница warn/auto/force, пропорционально context window; триггеры (~250–320, 419–465): auto / manual / payload_overflow (HTTP 413) / image_overflow; COMPACTION_BUDGET_SAFETY_MARGIN=1024 (стр. 69).
- services/microcompaction/microcompact.ts (1093 стр.) — детерминистический микро-компакшн: старые tool-результаты → плейсхолдер "[Old tool result content cleared]" (стр. 14); low-watermark = 50% порога (~652); time-based trigger evaluateTimeBasedTrigger (стр. 299).
- services/compactionInputSlimming.ts (531 стр.) — уtrimming tool-входов перед компакшном.

### OpenCode (refs/opencode/packages/core/src)
- session/compaction.ts (248 стр.) — LLM-саммари: DEFAULT_BUFFER=20000, DEFAULT_KEEP_TOKENS=8000, TOOL_OUTPUT_MAX_CHARS=2000 с плейсхолдером "[truncated]", SUMMARY_OUTPUT_TOKENS=4096 (стр. 10–15); SUMMARY_TEMPLATE (~15–50) — фиксированные секции Objective / Important Details / Work State (Completed, Active, Blocked) / Next Move / Relevant Files; select() (~138–160) — с конца набираем keep-токены (recent), остальное head → в саммари; compactAfterOverflow (~180) — автотриггер по Token.estimate оверфлоя; prior-summary обновляется инкрементально (SUMMARY_UPDATE_INSTRUCTIONS).
- session/../config/compaction.ts (15 стр.) — конфиг auto / buffer / keep.tokens.

### Наш код (границы решения)
- src/agent/loop.ts:123 — messages растёт неограниченно; loop.ts:207 — шлётся целиком в streamChat.
- src/agent/llm.ts:237 — toWireMessages; в LlmUsage уже есть input_tokens / cache_read_input_tokens (mapUsage) — метрики для порогов.
- src/agent/session.ts:32,67 + src/agent/cli.ts:393–425 — jsonl пишется инкрементально через onMessage; resume читает jsonl целиком. Ключевой факт: wire-усечение не должно касаться jsonl-транскрипта.

## Шаги

1. Создать документ через MCP document_create (тип guide, теги: контекст, llm, vl-122), папка docs/ создастся автоматически. Разделы:
   - Как Qwen Code решает рост контекста: два слоя (microcompact — детерминистическая зачистка tool-результатов в плейсхолдер + chatCompression — LLM-саммари по трёхуровневым порогам), усечение отмечается плейсхолдерами; ссылки на файлы/строки.
   - Как OpenCode решает: один слой — LLM-саммари с фиксированным markdown-шаблоном; keep=8000 хвоста, buffer=20000, tool-выводы ≤2000 символов; автотриггер по оценке оверфлоя; синтетическое сообщение типа compaction. Ссылки на файлы/строки.
   - Сравнение по критериям: простота, детерминизм, Node.js 20+ (без нативных зависимостей), сохранение jsonl-транскрипта для resume (VL-103) и мета-логики (loop-guard VL-119).
   - Рекомендация для VL-122: этап 1 — детерминистическое wire-усечение «system + первый user + последние N» токенов перед streamChat, отмечается одним placeholder-сообщением (по образцу microcompact), порог от usage input_tokens+cache_read; jsonl/resume не затрагиваются (пишутся через onMessage до усечения). Этап 2 (опционально) — LLM-саммари по шаблону OpenCode. Обосновать, почему не копировать chatCompressionService целиком (1362 стр. избыточно для нашего масштаба).
2. Добавить комментарий в VL-122 через backlog_add_comment — обратная ссылка на документ и VL-136 (критерий приёмки Spec-фазы).
3. Проверить: document_list (документ в docs/), комментарий в VL-122 подтверждён.

## Как проверить
- Код не меняется → pnpm build / pnpm test не требуются (регрессий нет по определению).
- document_list — документ присутствует.
- В документе 4 раздела и ссылки на файлы/строки референсов.
- В VL-122 есть комментарий со ссылкой на VL-136.

## Риски
- docs/ в git нет — document_create создаст каталог; после выполнения проверить git status (worktree) для коммита в Фазе 3.
- refs — снапшоты; ссылки на строки могут устареть при обновлении refs — зафиксировать в документе дату снапшота.
- Рекомендация может пересекаться с уже принятым решением внутри VL-122 — формулировать как proposal, окончательное решение за VL-122.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-13 09:10
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Компакшн контекста: сравнение Qwen Code и OpenCode, рекомендация». Масштаб: task. Уточнено: цель (сравнительный doc docs/ по механизмам ограничения истории в референсах Qwen Code/OpenCode + рекомендация для VL-122), контекст (VL-122: усечение payload запроса при сохранении полного jsonl-транскрипта), ограничения (Node.js 20+, детерминизм, resume/мета-логика VL-103/VL-110), критерии приёмки (документ с сравнением и ссылками, раздел рекомендации, обратная ссылка в VL-122). Описание полное. Вопросов нет.
---
author: @agent
created: 2026-10-13 09:21
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу. Изучены референсы: qwen-code chatCompressionService.ts (1362 стр., трёхуровневые пороги warn/auto/force, триггеры auto/manual/payload_overflow/image_overflow) + microcompact.ts (1093 стр., детерминистическая зачистка tool-результатов в плейсхолдер) + compactionInputSlimming.ts; opencode session/compaction.ts (248 стр., LLM-саммари по фиксированному шаблону, keep=8000/buffer=20000, автотриггер по оверфлою). Наш код: loop.ts:123,207 (история растёт и шлётся целиком), llm.ts:237, session.ts + cli.ts:393–425 (jsonl инкрементальный, resume). Артефакты: 1 документ в docs/ (через document_create, 4 раздела: оба механизма + сравнение + рекомендация для VL-122) + обратная ссылка-комментарий в VL-122. Риски: docs/ пока нет в git (проверить git status в Фазе 3); ссылки на строки refs привязаны к снапшоту; рекомендация — proposal, решение за VL-122.
---
author: Pavel Bobarev
created: 2026-10-13 09:43
---
Обязательно надо учитывать при разработке рекомендаций внедрения в наш проект, что в основном сейчас используется модель MiMo-V2.5 с 1 миллионом контекста и очень дешёвым чтением кэш токенов.
---
author: @agent
created: 2026-10-13 09:53
---
Фаза 3 (Code) выполнена. Тип: task (документная задача, код не меняется).
**Изменено:** `backlog/docs/doc-13-Компакшн-контекста-Qwen-Code-vs-OpenCode-сравнение-и-рекомендация-для-VL-122.md` (создан через MCP document_create, тип guide, теги: контекст, llm, vl-122, vl-136). Коммит не выполнялся — согласно регламенту Фазы 3 файлы backlog/ не коммитятся; изменений кода/тестов/шаблонов вне backlog/ нет, modifiedFiles пропущен. Изменённый `templates/qwen-commands/phase-1.md` в git status — не относится к VL-136, не трогал.
**Содержание документа (doc-13):**
1. Qwen Code — два слоя: microcompact.ts (детерминистический плейсхолдер `[Old tool result content cleared]`, стр. 14; low-watermark 50%; time-based триггер) + chatCompressionService.ts (пороги warn/auto/force пропорционально context window; триггеры auto/manual/payload_overflow(HTTP 413)/image_overflow; safety margin 1024, стр. 69).
2. OpenCode — один слой: session/compaction.ts — LLM-саммари по шаблону Objective/Important Details/Work State/Next Move; DEFAULT_BUFFER=20000, DEFAULT_KEEP_TOKENS=8000, TOOL_OUTPUT_MAX_CHARS=2000 с `[truncated]`, SUMMARY_OUTPUT_TOKENS=4096 (стр. 12–15); select() с конца набирает keep-токены; инкрементальное обновление prior-summary.
3. Сравнение по критериям: простота, детерминизм, Node.js 20+, сохранение jsonl-транскрипта для resume (VL-103), совместимость с loop-guard (VL-119), учёт usage-метрик (input_tokens/cache_read_input_tokens в LlmUsage, llm.ts:45–47).
4. Рекомендация для VL-122 с учётом комментария Pavel (MiMo-V2.5: 1M контекст, дешёвый cache read): пороги пропорциональны окну (warn≈70%, auto≈85% от 1M), wire-усечение редкое и префиксстабильное (не ломать кэш); этап 1 — детерминистическое усечение «system + первый user + хвост 10–15% окна» с одним синтетическим маркером по образцу microcompact; этап 2 (опционально) — LLM-саммари по шаблону OpenCode, автоматически только на force; слой microcompact-зачистки tool-результатов отложить. Не копировать chatCompressionService целиком (1362 стр. избыточно). Все ссылки на refs-снапшот 2026-10-13.
**Проверки:** document_list — doc-13 присутствует; обратная ссылка-комментарий добавлен в VL-122; ссылки на файлы/строки refs и нашего кода проверены grep'ом (microcompact.ts:14, chatCompressionService.ts:69, compaction.ts:12–15, loop.ts/llm.ts/session.ts/cli.ts соответствуют плану). Сборка/тесты не запускались — код не менялся (по плану: регрессий нет по определению); DoD «Тесты проходят» и «Нет регрессий» оставлены незакрытыми, т.к. проверка не выполнялась.
**Что осталось:** DoD-пункты «Тесты проходят»/«Нет регрессий» — закрыть на ближайшей сборке/CI; реализация усечения — в VL-122 (документ — proposal, решение за VL-122); дата снапшота refs зафиксирована в документе — при обновлении refs номера строк проверить.
---
author: @agent
created: 2026-10-13 10:09
---
Фаза Close выполнена. Статус: Done. Коммиты: feat «не требовался» (изменений кода вне backlog/ нет — документная задача), docs 321c6fb (doc-13 — сравнительный документ «Компакшн контекста: Qwen Code vs OpenCode»). CHANGELOG пропущен — ничего пользовательского не менялось. Не закоммичено: templates/qwen-commands/phase-1.md (не относится к VL-136 — чужое изменение из git status), файл задачи VL-122 (комментарий-ссылка — работа Close самой VL-122), файл VL-129 (чужая задача). Подзадач нет (type=task).
---
<!-- COMMENTS:END -->