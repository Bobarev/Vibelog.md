---
id: VL-199
title: Считать high-risk-отказ при HTTP 200 ошибкой и запускать авто-resume
status: Done
assignee: []
reporter: ''
created_date: '2026-10-26 23:59'
updated_date: '2026-10-29 07:41'
due_date: ''
labels:
  - core
  - agent
dependencies: []
milestone: v1.10
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/loop.ts
  - src/agent/llm.ts
  - src/agent/loop.test.mjs
  - src/agent/llm.test.mjs
  - src/web/orchestrator.test.mjs
lessons:
  - lesson-55
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-197. Отказ провайдера «The request was rejected because it was considered high risk» пришёл валидным финальным assistant-текстом без tool_calls (инцидент VL-197, сессия agent-1793026414766.jsonl, строка 65). loop.ts трактует такой ответ как успех (is_error=false, exit 0) → guard авто-resume в orchestrator.ts:996-1005 (требует is_error===true) не срабатывает, LLM-клиентский shrink-цикл (llm.ts:411-422) детектит отказ только в не-ok теле. Нужно: в loop.ts перед финализацией ответа сверять текст с isHighRiskBody и уходить в fail() (is_error=true), либо расширить guard авто-resume на is_error===false при совпадении маркера в result. Плюс: диагностический лог размера payload/usage при отказе (причина content-based отказа при payload ~140 КБ неизвестна — нужна наблюдаемость).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Финальный текст ответа, матчащий isHighRiskBody, завершает фазу как ошибка (is_error=true, exit 1) с русским пояснением.
- [x] #2 Авто-resume VL-178 (--resume <sid>, лог «авто-resume после high-risk») срабатывает в этом сценарии; есть регресс-тест в orchestrator.test.mjs/loop.test.mjs.
- [x] #3 При high-risk-отказе (в т.ч. при HTTP 200) в диагностический лог выводятся размер payload и данные usage — наблюдаемость причины content-based отказов.
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## VL-199 — high-risk-отказ при HTTP 200 → ошибка + авто-resume + диагностика payload/usage

Контекст инцидента: финальный assistant-текст без tool_calls с текстом «The request was rejected because it was considered high risk» (HTTP 200, сессия agent-1793026414766.jsonl, строка 65) → loop.ts трактует как успех (is_error=false, exit 0) → guard авто-resume в orchestrator.ts:996-1005 (требует is_error===true) не срабатывает.

Решение (архитектурное): детект **в loop.ts перед финализацией ответа** → уход в `fail()` (is_error=true). Guard авто-resume оркестратора НЕ менять — после фикса он срабатывает как есть: `result.result` (текст fail) будет содержать маркер, `record.result.is_error===true`, session_id есть. Плюс диагностический лог payload/usage в llm.ts (там известен реальный wire-payload).

### Файлы для изменения

1. **`src/agent/loop.ts`**
   - Строка 15 (import из `./llm.js`): добавить `isHighRiskBody`.
   - Строки 307-327 (ветка `response.toolCalls.length === 0`): ПОСЛЕ guard'а пустого финала (стр. 311-319), ПЕРЕД `pushMessage` (стр. 321), вставить:
     ```ts
     // VL-199: отказ провайдера может прийти валидным финальным текстом при
     // HTTP 200 (инцидент VL-197) — без этого guard'а фаза завершается
     // ложным успехом и авто-resume (VL-178) не срабатывает.
     if (isHighRiskBody(response.text)) {
       return fail(
         `Отказ провайдера «high risk»: ${response.text.slice(0, 300)} — фаза прервана как ошибка (VL-199).`,
       );
     }
     ```
     - Маркер ОБЯЗАТЕЛЬНО в тексте ошибки: guard orchestrator.ts:1001-1004 матчит `/high\s*risk|rejected\s+because.../i` по `result.result + logTail` — без маркера авто-resume не сработает. Русское пояснение + обрезанный оригинал (контракт resume VL-103: fail() дописывает assistant-сообщение в диалог).
     - exit 1 уже обеспечен: cli.ts:586 `process.exitCode = loopResult.is_error ? 1 : 0`.

2. **`src/agent/llm.ts`** — диагностический лог (AC3), в `streamChat` (строки ~515-533):
   - **Путь HTTP 200**: обернуть `return await attemptWithFallback(baseBody, opts)` в переменную; перед возвратом — если `isHighRiskBody(res.text ?? '')`, то `console.error` с размером payload и usage:
     ```ts
     console.error(`[vibelog-agent] high-risk в тексте при HTTP 200: payload=${Buffer.byteLength(JSON.stringify(baseBody), 'utf8')} байт, сообщений=${currentMessages.length}, usage=${JSON.stringify(res.usage)}`);
     ```
   - **Путь не-ok/исключение**: в catch, когда `isHighRiskBody(e.message)` (до shrink/throw — логировать и при повторе, и при исчерпании shrink-уровней):
     ```ts
     console.error(`[vibelog-agent] high-risk-отказ HTTP: payload=${Buffer.byteLength(JSON.stringify(baseBody), 'utf8')} байт, сообщений=${currentMessages.length}, shrink-уровень=${shrinks}, usage=н/д`);
     ```
   - Лог идёт в stderr → попадает в `record.logTail` оркестратора (stderrLog) → виден оператору и усиливает guard по logTail. Причина content-based отказа при payload ~140 КБ станет наблюдаемой (AC3).
   - Существующий debug-дамп `VIBELOG_LLM_DEBUG_USAGE` (llm.ts:127) НЕ трогаем.

3. **`src/agent/loop.test.mjs`** — регресс-тест (AC1/AC2, уровень loop):
   - Новый `it` в описании рядом с guard'ом пустого финала (~стр. 413): `fakeLlm([{ text: 'The request was rejected because it was considered high risk' }])` → `res.is_error === true`, `res.result` содержит маркер и русское пояснение, `num_turns === 1`.
   - Негатив: финальный текст без маркера → `is_error === false` (уже покрыто happy path, но явная проверка в новом тесте не помешает).

4. **`src/agent/llm.test.mjs`** — регресс-тест (AC3):
   - Новый `it` в блоке VL-178 (~стр. 397): fakeFetch отдаёт SSE с финальным content, содержащим маркер high risk (HTTP 200, статус ok) → перехват `console.error` (паттерн уже есть в тесте VL-96, стр. 194-207) → в выводе есть `payload=` (число > 0) и `usage=`. Проверить, что `streamChat` всё равно возвращает ответ (детект текста — не его работа, это работа loop).

5. **`src/web/orchestrator.test.mjs`** — регресс-тест (AC2, уровень оркестратора, HTTP-200-сценарий):
   - Новый `it` рядом с VL-178-тестом (~стр. 2052): стаб CLI печатает `is_error: true, result: 'The request was rejected because it was considered high risk'` (БЕЗ поля `error` — форма, которую теперь produce cli.ts после фикса loop) → ожидается 2 спавна, второй с `--resume` и session_id, лог содержит «авто-resume после high-risk», счётчик без цикла. Паттерн копировать из существующего теста (makeSameRoot / hrStub / waitDone / argvLines).

6. **`CHANGELOG.md`** — раздел `## [Unreleased]` → `### Исправлено` (создать, если нет): запись VL-199 — детект high-risk-финального текста в loop.ts → is_error/exit 1, срабатывание авто-resume VL-178, диагностический лог payload/usage в llm.ts.

### Порядок действий

1. loop.ts: import + guard (п.1).
2. llm.ts: диагностический лог обоих путей (п.2).
3. `pnpm build`.
4. Тесты: loop.test.mjs (п.3) → llm.test.mjs (п.4) → orchestrator.test.mjs (п.5).
5. CHANGELOG (п.6).
6. Полная проверка: `pnpm test`.

### Как проверить

```bash
pnpm build
pnpm test:fast -- src/agent/loop.test.mjs src/agent/llm.test.mjs src/web/orchestrator.test.mjs
pnpm test          # build + vitest run целиком — DoD «Тесты проходят», «Нет регрессий»
```

Ручная точка: `node bin/vibelog.mjs`-путь не требуется — покрытие тестами.

### Риски

- **Ложные срабатывания**: isHighRiskBody матчит и `high risk` в отчётных текстах (задача VL-199 сама пишет про «high risk»!). Финальный текст агента, цитирующий маркер, уйдёт в fail → авто-resume 1 раз (счётчик highRiskAutoRetries защитит от цикла). При желании ужесточить до полной фразы `rejected because it was considered high risk` — но AC1 требует isHighRiskBody; если в Code выяснится частота FP, предложить ужесточение отдельной задачей.
- **Двойной лог**: llm.ts залогирует high-risk и по HTTP-200-пути, и loop.ts уйдёт в fail — это корректно (диагностика ≠ управление).
- **Не менять** orchestrator.ts guard и llm.ts shrink-цикл — их поведение уже покрыто тестами VL-178; правки там — риск регрессии.
- Файлы из плана проверены `ls` — все существуют.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-27 00:02
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Считать high-risk-отказ при HTTP 200 ошибкой и запускать авто-resume» (исходный длиннее 80 символов и дублировал тип). Тип: bug. Масштаб: task. Приоритет: High (подтверждён предложением в VL-197: ложный успех при отказе провайдера ломает корректность цикла агента). Уточнено: добавлен AC3 — диагностический лог размера payload/usage при high-risk-отказе (наблюдаемость причины content-based отказов при payload ~140 КБ); существующие AC (детект → is_error=true/exit 1; авто-resume VL-178 с регресс-тестом) оставлены без изменений. Labels: core, agent. References: нет — внешние источники не упоминались (VL-197/VL-178 и session jsonl — внутренние). Вопросов нет.
---
author: @agent
created: 2026-10-27 00:11
---
Фаза 2 (Plan) выполнена. Тип: bug. План записан в Implementation Plan — 6 файлов: src/agent/loop.ts (guard isHighRiskBody в ветке финализации ~стр.307-327 → fail() с маркером и русским пояснением; import из llm.js), src/agent/llm.ts (диагностический лог payload/usage в streamChat на обоих путях high-risk — HTTP 200 и не-ok, AC3), src/agent/loop.test.mjs, src/agent/llm.test.mjs, src/web/orchestrator.test.mjs (регресс-тесты AC1/AC2/AC3), CHANGELOG.md. Архитектурное решение: детект в loop.ts → is_error=true/exit 1; guard авто-resume orchestrator.ts:996-1005 и shrink-цикл llm.ts НЕ менять (срабатывают как есть после фикса — экономия и нулевой риск регрессии VL-178). Риски: ложные срабатывания isHighRiskBody на отчётных текстах с «high risk» (смягчены счётчиком авто-resume, максимум 1); при частых FP — отдельная задача на ужесточение до полной фразы. Файлы проверены ls. References: нет (все источники — внутренний код, поле пустое).
---
author: @agent
created: 2026-10-27 00:34
---
Фаза 3 (Code) выполнена. Изменено: src/agent/loop.ts (import isHighRiskBody + guard в ветке финализации: финальный текст с маркером → fail() с русским пояснением и оригиналом до 300 символов — is_error=true, exit 1 через cli.ts:586; маркер в result обеспечивает срабатывание guard авто-resume orchestrator.ts:996-1005 без его правки), src/agent/llm.ts (диагностический лог в streamChat: HTTP 200-путь — payload байты + messages + usage; не-ok-путь — payload + shrink-уровень + usage=н/д, лог и при повторе, и при исчерпании уровней; stderr → logTail оркестратора), тесты: loop.test.mjs (+describe VL-199: позитив с маркером/русским пояснением/контрактом resume VL-103 + негатив без маркера), llm.test.mjs (+2: HTTP 200-лог payload/usage при возврате ответа, не-ok-лог payload/shrink-уровня), orchestrator.test.mjs (+VL-199: fail-результат без error-поля с маркером → 2 спавна, второй с --resume/session_id, без цикла). Коммит 4c36a5c (5 файлов, +156/-3). Проверки: pnpm build OK; точечные vitest по трём файлам OK; полный pnpm test — 1358 passed / 4 skipped, регрессий нет. AC отмечены все 3; DoD: «Тесты проходят» и «Нет регрессий» — да. DoD «Документация обновлена» НЕ отмечен: CHANGELOG.md по правилам фазы не трогаю (пишет Close). References не использовались (только внутренний код). Lessons не создавались.
---
author: @agent
created: 2026-10-27 00:57
---
Фаза Close выполнена. Ветка vb/vl-199 слита в master (1 коммит 4c36a5c), worktree удалена (в ней были только untracked-симлинки node_modules/backlog/references/data → удалена с --force), ветка удалена. После merge: pnpm build и полный pnpm test в главном репо — прошли (exit 0), регрессий нет. Урок: lesson-55 (детект content-based отказа в точке финализации loop), связана с задачей. DoD: «Тесты проходят» — да, «Нет регрессий» — да, «Документация обновлена» — да (CHANGELOG.md: запись VL-199 в Unreleased/Исправлено; doc-10: раздел 6.2 — защита расширена до четырёх слоёв, описан guard финализации и диагностика payload/usage). Документация закоммичена в 73aadf2 «docs: VL-199 — документация и CHANGELOG»; lesson-55 — в 04db4ad.
---
<!-- COMMENTS:END -->