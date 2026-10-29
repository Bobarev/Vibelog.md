---
id: VL-215
title: 'Agent-loop: отбрасывать tool_calls с пустым name/id и не отравлять историю'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-29 14:11'
updated_date: '2026-10-29 14:49'
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
  - src/agent/loop.test.mjs
lessons:
  - lesson-74
  - lesson-37
token_usage:
  input: 1623434
  output: 44365
  cache: 1530240
  total: 1667799
  requests: 40
  duration_ms: 1099790
  reasoning: 31411
  by_phase:
    spec:
      input: 105678
      output: 2635
      cache: 97920
      requests: 4
    plan:
      input: 511598
      output: 15212
      cache: 479744
      requests: 14
    code:
      input: 1006158
      output: 26518
      cache: 952576
      requests: 22
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-214. В src/agent/loop.ts перед выполнением tool-call валидировать call.name/call.id: пустое имя или id — не выполнять вызов, не добавлять пару assistant(tool_calls id="") + tool(tool_call_id="") в диалог/jsonl. Вместо этого либо игнорировать фантомный вызов с пометкой в логе, либо отдавать модель текст-ошибку как отдельное сообщение, не создающее пару с пустым ключом. Логику выносить с учётом lesson-37 — зеркальная уязвимость в src/web/chat.ts (её фикс ведёт VL-213). Корневая причина VL-214: модель mimo-v2.6-flash отдала tool_call с пустыми name/id (строка 36 jsonl), loop не валидирует их и дописал отравленную пару в историю.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ответ модели с tool_call {id:"", name:""} не приводит к записи в jsonl/wire пары с пустым tool_call_id; фаза не получает сообщение "Неизвестный инструмент: " с пустым именем.
- [x] #2 Следующий ход после фантомного вызова валиден (история не отравлена, запрос к LLM не падает).
- [x] #3 Тесты в src/agent/loop.test.mjs: фантомный tool_call → история чистая, валидные tool_calls работают без регрессий (VL-95/VL-103).
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Фикс фантомных tool_calls в agent-loop (VL-215)

Контекст чтения: src/agent/loop.ts (459 строк, прочитан целиком), src/agent/llm.ts (ToolCall/ChatMessage ~34–58; SSE-сборка toolCalls ~500–502 — пустые id/name НЕ фильтруются, фильтрация обязана быть в loop), src/web/chat.ts (только import-блок и использование tc.id — правок здесь нет: зеркальный фикс за VL-213). References у задачи нет.

### Архитектурное решение (lesson-37)

Валидатор — общая функция в `src/agent/llm.ts` (обе точки уже импортируют этот модуль: loop.ts — './llm.js', chat.ts — '../agent/llm.js', строка 29). Новый модуль не создаём; VL-213 (web) сможет просто импортировать готовую функцию — копий не будет.

Правило валидации: `isValidToolCall(tc)` = name и id непустые строки после `trim()`. Пустое/whitespace-only значение любого из двух → фантом: вызов не выполняется, пара assistant(tool_calls id="") + tool(tool_call_id="") не создаётся.

Стратегия для фантомов (выбрана из двух разрешённых задачей): текст-ошибка модели отдельным user-сообщением (не tool — без пары с пустым ключом) + повтор хода; защита от вечного повтора — счётчик фантомных ходов → fail(). console-логи НЕ используем (сломают рендер TUI) — «пометка в логе» = запись в диалог (user-сообщение) и текст fail().

### Файлы и конкретные правки

1. **src/agent/llm.ts**
   - После интерфейса `ToolCall` (строки 33–38) добавить и экспортировать:
     ```ts
     /** Валиден ли tool_call для выполнения/записи в историю (VL-215): ... */
     export function isValidToolCall(tc: ToolCall): boolean {
       return tc.id.trim() !== '' && tc.name.trim() !== '';
     }
     ```
     (Типы полей — string в интерфейсе, runtime-гард на `typeof` не нужен: поле отсутствовать не может, но `.trim()` уронит на undefined — поэтому безопаснее `typeof tc.id === 'string' && tc.id.trim() !== '' && typeof tc.name === 'string' && tc.name.trim() !== ''`.)
   - + JSDoc-комментарий с указанием, что зеркальная точка web/chat.ts — VL-213.

2. **src/agent/loop.ts**
   - Строка 14 (import из './llm.js'): добавить `isValidToolCall`.
   - Рядом с `LOOP_DETECTION_REPEAT_DEFAULT` (~строка 118): константа `PHANTOM_CALL_LIMIT_DEFAULT = 3` (фантомных ходов подряд до fail; комментарий — почему 3: как loop detection VL-83).
   - Стейт рядом с `streak`/`prevSignature` (~строки 235–236): `let phantomStreak = 0;`.
   - **После intent-guard (строки 379–394), ДО `partialText += response.text` (~396) и ДО `await pushMessage(...)` (строки 395–408)** — вставить валидацию:
     ```ts
     // VL-215: фантомные tool_calls (пустые name/id) отфильтровываются ДО
     // записи assistant-сообщения — иначе в диалог попадает отравленная
     // пара assistant(tool_calls id="") + tool(tool_call_id="") и LLM API
     // отклоняет следующий ход (инцидент VL-214).
     const validCalls = response.toolCalls.filter(isValidToolCall);
     const phantomCount = response.toolCalls.length - validCalls.length;
     if (phantomCount > 0) {
       phantomStreak++;
       if (phantomStreak >= PHANTOM_CALL_LIMIT_DEFAULT) {
         return fail(`Модель ${phantomStreak} раза подряд возвращала tool_call с пустым name/id — фаза прервана (VL-215).`);
       }
     } else {
       phantomStreak = 0;
     }
     if (validCalls.length === 0) {
       // Только фантомы: assistant(tool_calls) НЕ пишется; текст-ошибка —
       // отдельным user-сообщением (без пары с пустым tool_call_id);
       // ход повторяется — модель может перезапустить вызов корректно.
       if (response.text) partialText += (partialText ? '\n' : '') + response.text;
       await pushMessage({ role: 'user',
         content: 'Ошибка ответа модели: tool_call с пустым name/id проигнорирован (VL-215). Повтори вызов с корректными name и id либо заверши финальным текстом.' });
       continue;
     }
     ```
   - Строка 400 (`tool_calls: response.toolCalls` в assistant-push): заменить на `tool_calls: validCalls` (фантом не попадает в диалог, валидные — выполняются).
   - Строка 409: `for (const call of response.toolCalls)` → `for (const call of validCalls)`.
   - После цикла выполнения (после строки 456, внутри блока, где `phantomCount > 0` при наличии валидных вызовов): дописать user-примечание — `await pushMessage({ role: 'user', content: \`Замечание: проигнорировано ${phantomCount} tool_call(ов) с пустым name/id (VL-215).\` })` — пометка модели, что часть вызовов отброшена (и в jsonl это видно).
   - Не менять: loop detection (411), лимит tool-calls (430), unknown-tool (432–437), tool-push (456), intent-guard, compact, fail(). Путь «неизвестного, но непустого» инструмента (`Неизвестный инструмент: <name>`) сохраняется — он легитимен.

3. **src/agent/loop.test.mjs** — добавить блок тестов «VL-215» (по существующему в файле паттерну мока llm; файл не читал — AC3 указывает его как целевой):
   - Т1 (AC1/AC2): ход 1 — мок возвращает `toolCalls: [{id:'', name:'', arguments:{}}]`, текст пуст; ход 2 — финальный текст без tool_calls. Проверить: (а) в `result.messages` нет assistant с tool_calls, содержащим пустые id/name; (б) нет `{role:'tool', tool_call_id:''}`; (в) payload второго вызова streamChat (первый аргумент) валиден — нет tool-сообщений без пары и пар с пустым ключом; (г) `is_error=false`, финальный текст хода 2 = result.
   - Т2: ход 1 — фантом + валидный вызов `[{}, {id:'call_1', name:'<из существующих тестов>'}]` → в истории assistant.tool_calls только валидный, tool-результат только по нему, есть user-заметка «проигнорировано 1…»; фаза завершается успешно.
   - Т3 (guard): фантом 3 хода подряд → `is_error=true`, текст содержит «пустым name/id», транскрипт заканчивается assistant БЕЗ tool_calls (контракт resume VL-103), пар с пустым ключом нет.
   - Регрессии VL-95/VL-103 — не переписывать, только прогнать (фильтр не трогает валидные вызовы).

4. **CHANGELOG.md** — пункт в верхний раздел по существующему формату: «исправлен фикс: фантомные tool_calls с пустыми name/id больше не отравляют историю loop (VL-215)».

### Порядок действий

1. llm.ts → isValidToolCall; 2. loop.ts → импорт/константа/стейт/валидация/ветвления; 3. тесты в loop.test.mjs; 4. CHANGELOG; 5. проверки.

### Как проверить

- Итерации: `pnpm build && pnpm test:fast` (build обязателен — bin и тесты ходят в dist/).
- Финал: `pnpm test` (= build + vitest run, все файлы — нет регрессий DoD-3).
- Точечно: `pnpm build && npx vitest run src/agent/loop.test.mjs` нельзя без сборки — vitest берёт dist/; сначала build.

### Риски

- web/chat.ts остаётся уязвимым до VL-213 — осознанно (scope задачи; VL-213 должен импортировать `isValidToolCall` из src/agent/llm.ts, не писать копию — lesson-37).
- `user`-сообщение в середине диалога: компакшн (compactWireMessages) и resume/jsonl переживают user в хвосте — штатно; проверить тестом Т1 (второй запрос не падает).
- Фантомный ход потребляет LLM-запрос — ограничен PHANTOM_CALL_LIMIT=3 + существующими maxRequests/wall-time.
- Не расширять фильтр: name с пробелами по краям (« a ») валиден — поведение не меняем, чтобы не ломать VL-95/VL-103.
- Порядок вставки критичен: валидация строго ДО строки 395 (push assistant) — иначе пара уже дописана в jsonl через onMessage (VL-103).

### Соответствие AC

- AC1: фильтр validCalls до push/tool-выполнения → пустая пара не записывается, «Неизвестный инструмент: » с пустым именем не генерируется (437 отрабатывает только для валидных имён).
- AC2: ветвь `validCalls.length===0` → user-ошибка + continue; повторный ход валиден (тест Т1).
- AC3: блок тестов Т1–Т3 + полный прогон без регрессий.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-29 14:19
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен (информативный, 68 символов). Тип: bug. Масштаб: task. Приоритет: High (предложение bug/High из VL-214 подтверждено: фантомный tool_call отравляет jsonl-историю и ломает следующие ходы). Уточнено: AC переформулированы в 3 конкретных проверяемых пункта (валидация call.name/call.id до выполнения; чистота пары assistant/tool с пустым ключом; валидность следующего хода; тесты в src/agent/loop.test.mjs без регрессий VL-95/VL-103); область — только src/agent/loop.ts, зеркальный фикс src/web/chat.ts закреплён за VL-213, санация при сборке wire/--resume — за VL-216 (контекст VL-214 и doc-15 прочитан). Labels: agent, core. References: нет (внешних источников в описании нет; VL-213/VL-214, lesson-37, doc-15 — внутренние). Вопросов нет.
---
author: @agent
created: 2026-10-29 14:36
---
Фаза 2 (Plan) выполнена. Тип: bug — план записан в задачу. Изучены: src/agent/loop.ts (459 строк, целиком; ключевые точки — push assistant 395–408, цикл выполнения 409–457, «Неизвестный инструмент» 437), src/agent/llm.ts (ToolCall 33–38; SSE-сборка ~500–502 пустые id/name не фильтрует → фильтрация обязана быть в loop), src/web/chat.ts (только import/использование tc.id — правок нет, зеркальный фикс за VL-213). Решение (lesson-37): общий экспортируемый isValidToolCall в src/agent/llm.ts — обе точки уже его импортируют, VL-213 подключится без копии. Стратегия: фильтрация фантомов ДО записи assistant(tool_calls); при одних фантомах — текст-ошибку отдельным user-сообщением (без пары с пустым ключом) + continue, защита от повторов — счётчик phantomStreak (3 хода → fail); при фантомах рядом с валидными — выполняются только валидные + user-заметка в диалог (console-логи запрещены — ломают TUI). Файлов в плане: 4 (llm.ts, loop.ts, loop.test.mjs — тесты Т1–Т3 по AC, CHANGELOG.md). Проверки: pnpm build && pnpm test (итерации — test:fast). Риски: web остаётся уязвимым до VL-213; user-сообщение в середине диалога — покрыто тестом Т1; порядок вставки до push 395 критичен (onMessage/jsonl VL-103).
---
author: @agent
created: 2026-10-29 14:41
---
Фаза 3 (Code) выполнена. Изменено: src/agent/llm.ts (+isValidToolCall — общая функция для loop и будущего фикса web в VL-213, lesson-37), src/agent/loop.ts (фильтр фантомов ДО push assistant/tool: validCalls + phantomStreak-3 → fail; при одних фантомах — user-текст-ошибка + continue без пары; при фантом+валидный — выполняется только валидный + user-заметка «проигнорировано N»), src/agent/loop.test.mjs (блок «фантомные tool_calls VL-215»: Т1 чистая история + валидный 2-й запрос payload, Т2 фантом+валидный, Т3 guard 3 подряд → fail с контрактом VL-103). Коммит 2bcd24a (ветка vb/vl-215). Проверки: pnpm build — ок; точечно vitest src/agent/loop.test.mjs — 56/56 passed; полный pnpm test — 84 файла, 1506 passed / 4 skipped, 0 падений (регрессий нет, VL-95/VL-103 зелёные). AC отмечены 1–3, DoD 1 и 3. Что осталось: DoD-2 «Документация обновлена» — CHANGELOG.md по правилам Фазы 3 не трогал (пишет Close после слияния); зеркальный фикс src/web/chat.ts — VL-213 (импортировать isValidToolCall из src/agent/llm.ts, не писать копию); санация wire/--resume — VL-216.
---
author: @agent
created: 2026-10-29 14:49
---
Фаза Close выполнена. Ветка vb/vl-215 слита в master (1 коммит 2bcd24a, merge e34c5fc), конфликтов нет; pnpm build + pnpm test после merge — без падений (регрессий нет). Worktree .vibelog/worktrees/vl-215 удалена (force — только untracked-симлинки), ветка удалена. DoD честно: 1 — тесты проходят (полный pnpm test зелёный), 2 — документация обновлена (CHANGELOG.md Unreleased «Исправлено» + doc-10 §6.4, коммит 6ca4409), 3 — нет регрессий. Уроки: lesson-74 (валидация name/id tool_call до записи пары assistant+tool), lesson-37 обновлена (+VL-215). Осталось в задаче: зеркальный фикс src/web/chat.ts — VL-213 (импортировать isValidToolCall), санация wire/--resume — VL-216.
---
<!-- COMMENTS:END -->