---
id: VL-216
title: Санация отравленных пар tool_calls/tool с пустым id
status: Done
assignee: []
reporter: ''
created_date: '2026-10-29 14:11'
updated_date: '2026-10-29 15:59'
due_date: ''
labels:
  - agent
  - core
dependencies: []
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/llm.ts
  - src/agent/loop.ts
  - src/agent/llm.test.mjs
  - src/agent/loop.test.mjs
  - src/agent/cli.test.mjs
lessons:
  - lesson-75
  - lesson-74
token_usage:
  input: 7292044
  output: 147170
  cache: 6982336
  total: 7439214
  requests: 99
  duration_ms: 2886318
  reasoning: 127855
  by_phase:
    spec:
      input: 102931
      output: 1969
      cache: 68928
      requests: 4
    plan:
      input: 2641825
      output: 63663
      cache: 2517632
      requests: 41
    code:
      input: 4547288
      output: 81538
      cache: 4395776
      requests: 54
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-214. toWireMessages/compactWireMessages (src/agent/llm.ts, src/agent/loop.ts) вырезают осиротевшие tool-сообщения, но пару с пустым id/tool_call_id="" считают валидной и шлют провайдеру. Вырезать или переписывать (в текст assistant) такие пары — тогда --resume старых отравленных jsonl-сессий (включая agent-1793269309877) перестанет мгновенно падать guard'ом VL-110. Это разблокирует «не даёт продолжить» из VL-214.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Wire-запрос из истории, содержащей assistant.tool_calls с пустым id/name и парный tool с tool_call_id="", не содержит этих элементов (или содержит переписанную текстовую форму), парность валидных пар сохранена.
- [x] #2 Интеграционный тест: resume jsonl с отравленной парой → запрос уходит валидным, фаза выполняется дальше (или падает с другой, осмысленной ошибкой, а не VL-110).
- [x] #3 Нет регрессий wire-совместимости (существующие тесты llm/loop на tool_calls ↔ tool зелёные).
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Решение

Санация на wire-границе: одна общая функция `sanitizeWireMessages` в `src/agent/llm.ts`, применяемая в обоих wire-конверторах (`toWireMessages` chat-режим + `messagesToInput` Responses-режим) и на payload-точке в `runLoop` (loop.ts). Файл jsonl сессии НЕ переписывается (контракт resume VL-103: транскрипт — append-only источник правды); чистится только то, что уходит провайдеру. Функция идемпотентна (повторный проход валидную историю не меняет — двойное применение loop→wire безопасно).

Алгоритм `sanitizeWireMessages(messages: ChatMessage[]): ChatMessage[]` (один forward-pass, объявленные id — через trim-сравнение):
1. `assistant` с `tool_calls`: `valid = tool_calls.filter(isValidToolCall)` (llm.ts:54 — typeof + trim, общий с VL-215/VL-213, lesson-37).
   - `valid.length > 0` → emit `{...m, tool_calls: valid}`, каждый `valid.id` (trimmed) добавляется в `announced: Set<string>`; валидные пары сохраняются, phantom-вызовы из середины вырезаются.
   - `valid.length === 0` (все фантомы) → **переписка в текст**: если `content` непустая строка → emit `{role:'assistant', content}` (текстовая форма, разрешённая AC1); если `content` null/пуст → **вырезка** сообщения целиком.
2. `tool`: вырезать, если `tool_call_id` не строка / trim пустой / `trim(tool_call_id)` ∉ `announced` (пустая пара и осиротевший результат — в т.ч. результат вызова с пустым `name`, объявление которого отфильтровано в п.1).
3. `system`/`user` — без изменений.

## Файлы и места правок

1. **src/agent/llm.ts**
   - Новый `export function sanitizeWireMessages` — перед `toWireMessages` (~стр. 338, рядом с JSDoc «Продит наши сообщения к wire-формату»); JSDoc: почему (отравленные jsonl VL-214/VL-110), идемпотентность, что jsonl не мутируется.
   - `toWireMessages` (~стр. 339): первая строка — `messages = sanitizeWireMessages(messages)` (или работать по отсанитизированной копии); комментарий VL-216.
   - `messagesToInput` (~стр. 400): первая строка — тот же вызов (обеет wire-режима покрыты, паттерн lesson-64 — санация до сборки итеремов).
2. **src/agent/loop.ts**
   - Импорт `sanitizeWireMessages` добавить в строку 15 (список из `./llm.js`).
   - Payload-точка (~стр. 310–312): `const payload = sanitizeWireMessages(compactFrom !== null ? compactWireMessages(messages, compactFrom) : messages);` — чистит и компакшн-путь, и полный; комментарий VL-216 (фантомная пара проходит орфан-гард compactWireMessages, т.к. хвост начинается с assistant, а не tool). `messages`/jsonl остаются полными.
3. **src/agent/llm.test.mjs** — новый `describe('Санация отравленных пар tool_calls/tool (VL-216)')`:
   - unit через fakeFetch (паттерн describe 'createLlmClient / streamChat', стр. 69): история с `[assistant(tool_calls: [{id:'',name:''}, {id:'c1',name:'t',...}]), tool(tool_call_id:''), tool(tool_call_id:'c1')]` → `state.bodies[0].messages` не содержит пустых id/tool_call_id, пара c1 цела;
   - только фантомы + текстовый content → assistant переписан текстом; только фантомы + content=null → сообщения нет в wire;
   - `messagesToInput` напрямую (describe стр. 657): отравленный вход → нет `function_call` с пустым `call_id` и `function_call_output` без объявления; валидная пара сохранена;
   - идемпотентность: `sanitizeWireMessages(sanitizeWireMessages(x))` deep-equal `sanitizeWireMessages(x)`.
4. **src/agent/loop.test.mjs** — тест: `runLoop` с начальной историей, содержащей отравленную пару → payload, ушедший в `llm.streamChat` (fakeLlm `state.messages`), чист; валидные пары сохранены; фаза завершается (паттерн VL-215 describe, стр. ~955).
5. **src/agent/cli.test.mjs** — AC2-интеграция (паттерн VL-122 resume-тест, стр. 574): в tmp-проект пишется jsonl `agent-vl216-poison.jsonl` с парой `assistant(tool_calls id:"" name:"")` + `tool(tool_call_id:"")` + финальный user; `runCli(['Продолжи','--resume','agent-vl216-poison','--no-mcp'], llmEnv(), projDir)`; assert: `code===0`, `is_error===false`, `llmRequests[0].messages` не содержит пустых id/tool_call_id (до фикса тело отравлено → тест красный).
6. **CHANGELOG.md** — секция `### Исправлено` (Unreleased): пункт «VL-216: санация отравленных пар tool_calls/tool с пустым id при сборке wire — resume старых jsonl-сессий больше не падает guard'ом VL-110».
7. **doc-10** («Агент Vibelog», backlog/documents — править ТОЛЬКО через `document_update` MCP): дополнить §6.4 (фантомы VL-215) подпунктом про wire-санацию старых отравленных jsonl при resume.

## Порядок действий

1. llm.ts: `sanitizeWireMessages` + подключение в `toWireMessages` и `messagesToInput`.
2. loop.ts: импорт + санация payload-точки (~310).
3. `pnpm build` → тесты llm/loop/cli (новые + существующие).
4. CHANGELOG.md + doc-10 (MCP).
5. `pnpm test` целиком.

## Как проверить

- `pnpm build && pnpm test` (полный прогон — AC3: существующие wire-тесты llm/loop зелёные).
- Быстрая итерация: `pnpm test:fast` (dist собран).
- Ручной smoke AC1: `node -e` с `dist/agent/llm.js` — вызов `messagesToInput` на отравленной истории, вывод JSON без пустых ключей.

## Риски

- **Отбрасывание tool-сообщений, «не объявленных» в этой же wire-копии**: единственная легальная причина — компакшн вырезал объявление, но орфан-гард compactWireMessages (loop.ts:168-171) сдвигает границу мимо tool-хвоста, так что объявление и результат всегда в одной копии; подстраховка — существующий тест орфан-гарда (loop.test.mjs:714) + trim-сравнение id (пробельные расхождения не дают ложного дропа).
- **Хвостовой assistant(tool_calls) без результатов** (сессия оборвана до записи tool) — вне AC этой задачи: провайдер может отдать осмысленную ошибку (AC2 допускает «другую, осмысленную ошибку, не VL-110»); не чинить здесь, чтобы не расширять scope.
- **Двойная санация (loop→wire)** — идемпотентна по построению; unit-тест идемпотентности фиксирует.
- **messagesToInput экспортируется и используется в тестах напрямую** — меняется поведение только для отравленного входа; существующие тесты (llm.test.mjs:657-697) на валидных данных остаются зелёными.
- Prefix-caching: санация детерминирована и одинакова между запросами — append-only префикс не ломается.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-29 14:20
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Санация отравленных пар tool_calls/tool с пустым id» (был длиннее 80 символов). Тип: bug. Масштаб: task. Приоритет: High (resume старых отравленных jsonl-сессий мгновенно падает guard'ом VL-110 — блокирует продолжение работы; так же задача была предложена как High в VL-214). Уточнено: цель — санация (вырезание или переписывание в текст assistant) пар assistant.tool_calls/tool с пустым id/tool_call_id="" при сборке wire в toWireMessages/compactWireMessages (src/agent/llm.ts, src/agent/loop.ts), в т.ч. при --resume; контекст подтверждён по VL-214 (корневая причина — модель отдала tool_call с пустыми name/id, история отравилась, VL-110 guard в loop.ts). AC уточнены до 3 проверяемых пунктов. Labels: agent, core. References: нет (внешних источников в описании нет; VL-214/VL-110 — внутренние задачи, VL-214 прочитан для контекста). Вопросов нет.
---
author: @agent
created: 2026-10-29 15:21
---
Фаза 2 (Plan) выполнена. Тип: bug. План записан в Implementation Plan: санация на wire-границе — новая функция sanitizeWireMessages в src/agent/llm.ts (фильтр isValidToolCall в tool_calls, вырезка/переписка в текст пар с пустым id/tool_call_id, вырезка tool-сообщений без объявленного id; идемпотентно, jsonl не мутируется), подключается в toWireMessages (~339) и messagesToInput (~400), плюс на payload-точке runLoop в src/agent/loop.ts (~310-312, импорт из строки 15). Файлов-точек: 2 src (llm.ts, loop.ts) + 3 теста (llm.test.mjs — unit через fakeFetch и messagesToInput + идемпотентность; loop.test.mjs — чистый payload при отравленной начальной истории; cli.test.mjs — AC2-интеграция resume отравленного jsonl по паттерну VL-122) + CHANGELOG.md + doc-10 через document_update. Порядок: llm.ts → loop.ts → pnpm build && тесты → доки → pnpm test. Риски: возможный ложный дроп tool-сообщений при компакшне (страхуется орфан-гардом compactWireMessages + trim-сравнением id), хвостовой assistant(tool_calls) без результатов — вне AC, двойная санация loop→wire идемпотентна. References: нет; уроки учтены (lesson-37 — общая функция, lesson-64 — санация в точке сборки wire, lesson-74 — контекст VL-215).
---
author: @agent
created: 2026-10-29 15:31
---
Фаза 3 (Code) выполнена. Изменено: src/agent/llm.ts (новая export sanitizeWireMessages — фильтр isValidToolCall в tool_calls, переписка в текст/вырезка assistant при одних фантомах, вырезка tool с пустым или необъявленным tool_call_id через trim-Set; подключена в toWireMessages и messagesToInput — обе wire-точки, chat и responses), src/agent/loop.ts (импорт + санация payload-точки runLoop: compactWireMessages/full → sanitizeWireMessages; jsonl не мутируется), 3 тест-файла. Коммит e4033e9 (5 файлов, +318/−6). Тесты: pnpm build && pnpm test — 84 файла, 1515 passed / 4 skipped, exit 0; ручной smoke AC1 node -e на dist (пустых ключей нет, пара c1 цела, идемпотентность true). Новые тесты: llm.test.mjs — describe «Санация отравленных пар (VL-216)» 6 тестов (wire-chat, переписка в текст, вырезка content=null, messagesToInput/Responses, идемпотентность, осиротевший tool); loop.test.mjs — 2 теста (отравленная начальная история → чистый payload + неизменность входа, только отравленная пара → вырезка); cli.test.mjs — AC2-интеграция resume отравленного jsonl agent-vl216-poison (code 0, is_error false, тело без "id":""/"tool_call_id":""). Попутно исправлен вход существующего теста VL-178 в llm.test.mjs: он передавал одиночный tool без парного assistant — санация корректно вырезает осиротевший результат, тест дополнен валидным объявлением вызова (суть усечения не меняется). AC отмечены все 3. DoD: 1 (тесты) и 3 (нет регрессий) — выполнены; 2 «Документация обновлена» НЕ отмечен: JSDoc в коде обновлён, но CHANGELOG.md и doc-10 по правилам фазы 3 не трогаю (итоговую документацию пишет Close — включить VL-216 в CHANGELOG «Исправлено» и подпункт в doc-10 §6.4). References не использовались, новых lessons не создавал (учтённые lesson-37/64/74 уже связаны).
---
author: @agent
created: 2026-10-29 15:59
---
Фаза Close выполнена. Ветка vb/vl-216 слита в master (--no-ff, 1 коммит e4033e9 + merge), после слияния pnpm build && pnpm test — зелёные (exit 0). Worktree .vibelog/worktrees/vl-216 удалена (первый remove отказался на untracked-симлинках node_modules/backlog-references — убраны с --force по инструкции; других файлов не было), ветка vb/vl-216 удалена. Lessons: создан lesson-75 «Санируй отравленные пары tool_calls/tool на wire-границе, jsonl-транскрипт при resume не переписывай», связаны lesson-74 и lesson-75 с задачей (коммит 700d1ba — refs/lessons). Документация: CHANGELOG.md — запись «Исправлено» VL-216; doc-10 §6.4 — подпункт про wire-санацию старых отравленных jsonl при resume (обновлено через document_update, сверка git diff: ровно 1 вставка, 0 удалений — дрейф транскрипции после полной замены пойман и исправлен повторными вызовами); коммит docs 95d21b4 «docs: VL-216 — документация и CHANGELOG». DoD: 1 (тесты) и 3 (нет регрессий) — подтверждены полным pnpm test после merge; 2 (документация обновлена) — выполнена в этой фазе (CHANGELOG + doc-10). Отмечены все 3 пункта DoD. References не использовались.
---
<!-- COMMENTS:END -->