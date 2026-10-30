---
id: VL-253
title: 'finish_phase: comment не объявлен в required схемы → модель физически не может его передать; луп воспроизведён после фикса VL-251 (VL-250 и VL-252)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 04:37'
updated_date: '2026-10-30 05:10'
due_date: ''
labels:
  - mcp
  - agent
  - bug
  - loop-detection
  - critical
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
  - src/mcp/tools.ts
  - src/mcp/server.test.mjs
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - src/agent/session.ts
  - src/agent/cli.ts
  - src/agent/cli.test.mjs
  - src/agent/mcp-client.test.mjs
  - src/web/orchestrator.ts
  - README.md
lessons:
  - lesson-94
token_usage:
  input: 9731343
  output: 81387
  cache: 9570304
  total: 9812730
  requests: 110
  duration_ms: 939516
  reasoning: 55430
  by_phase:
    plan:
      input: 9731343
      output: 81387
      cache: 9570304
      requests: 110
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Луп на `backlog_finish_phase` воспроизведён **дважды** на разных задачах: VL-250 (после фикса VL-251) и VL-252 (сразу после создания). VL-251 закрыта как Done, но симптом остался в неизменном виде.

### Наблюдение (оба воспроизведения идентичны)

Ошибка инструмента:
```
Ошибка MCP-инструмента backlog_finish_phase: Ошибка: Неполный вызов: comment (report) не передан.
Обязательные поля: comment — отчёт о фазе («Фаза N (<Фаза>) выполнена. …»).
Вызов без отчёта не засчитывается — добавь comment и повтори.
```

Аргументы всех 10+ вызовов в обеих сессиях:
```
{"id":"VL-252","status":"Planned","tokenUsage":{"input":174247,"output":3200,"total":177447}}
```

Поля `comment` нет **ни в одном** вызове — ни в первом, ни в повторных, ни после явного требования в тексте ошибки. `tokenUsage` при этом подставляется реальными числами из сводки упавшей фазы.

Повторяется 3 раза → loop detection блокирует → вызов повторяется ещё раз → блок → фаза падает. `payload_bytes` растёт 192695 → 203771 → 204637 на бесполезных вызовах.

## Гипотезы (проверить в этом порядке)

**A. `comment` отсутствует в `inputSchema.required` (или в `properties`) инструмента `backlog_finish_phase`.**
Самая вероятная. Tool-calling генерирует только объявленные поля; требование, живущее лишь в тексте ошибки, модель выполнить не может. Косвенное подтверждение: VL-251 правила `description` схемы (в плане — «строка 389»), а `description` не влияет на генерацию аргументов — влияет только `properties` + `required`.

**B. Схема исправлена в `src`, но `dist/` не пересобран или MCP-сервер не перезапущен.**
Правки VL-251 лежат в `src/mcp/tools.ts`; работающий сервер может исполнять старый `dist/mcp/tools.js`. Проверить: `pnpm build`, перезапуск MCP, `tools/list` → есть ли `comment` в `required`.

**C. Loop detection блокирует вызов, но не прерывает фазу.**
Сообщение «вызов заблокирован» приходит, однако модель вызывает снова, и это не приводит к немедленному завершению фазы с ошибкой. Тратится контекст и payload до упора.

## Цель

Фаза не должна падать из-за того, что модель не передала необязательное по факту поле; срабатывание loop detection должно немедленно завершать фазу, а не accumulating попытки.

## Решение (предлагаемое)

1. **Схема** `backlog_finish_phase`: `comment` — в `properties` (type: string) и в `required`. Тогда tool-calling обязан его сгенерировать.
2. **Серверный fallback** (важнее схемы): если `comment` не передан — не возвращать ошибку, а собрать отчёт автоматически из доступного: статус, отметки AC/DoD, `modified_files`, фрагмент `implementationPlan`/`finalSummary`. Завершать фазу. Фаза не должна зависеть от дисциплины модели в заполнении обязательного по смыслу, но необязательного по контракту поля.
3. **Loop detection**: при повторной блокировке той же сигнатуры — немедленный `fail` фазы с внятным сообщением (сейчас требуется 2–3 круга). Плюс жёсткий кап на число заблокированных вызовов за фазу.
4. **tokenUsage из сводки упавшей фазы** не должен попадать в следующий вызов как «успешный» usage: при `isError` не учитывать.

## Входные данные

- Сессия 1: VL-250, plan-фаза; сессия 2: VL-252, plan-фаза. Обе — после VL-251.
- План VL-251 (`backlog_view_task VL-251`) — что именно правили в `src/mcp/tools.ts`, `src/agent/loop.ts`, `src/agent/session.ts`, `src/agent/cli.ts`.
- Блокирует: реализацию VL-252 (её plan-фаза не может завершиться).

## Открытые вопросы

- Достаточно ли fallback-отчёта, или нужен также запрет на фазу без осмысленного отчёта (сейчас отчёт генерируется моделью по плану)?
- Где хранить кап заблокированных вызовов: в мете сессии (как `blocked_signatures`) или в памяти процесса фазы.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 comment объявлен в inputSchema.properties и в required инструмента backlog_finish_phase
- [x] #2 Есть тест, проверяющий наличие comment в required схемы (tools/list), а не только в описании
- [x] #3 При отсутствии comment сервер собирает отчёт автоматически (статус, AC/DoD, modified_files, фрагмент плана) и завершает фазу без ошибки
- [x] #4 Повторная блокировка той же сигнатуры loop detection немедленно завершает фазу, без второго-третьего круга повторов
- [x] #5 tokenUsage из упавшей фазы (isError) не учитывается в следующих вызовах как успешный
- [x] #6 Регресс: фаза с корректно переданным comment завершается как раньше
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Диагноз (подтверждён чтением кода)

Гипотеза A — верна. `src/mcp/tools.ts:412`: `required: ['id']` у `backlog_finish_phase`, при этом `comment` объявлен в `properties` (стр. 394) и требование живёт только в `description` (стр. 388) + в тексте ошибки `toolFinishPhase` (стр. 1239–1246). Модель на tool-calling генерирует только объявленные `required`-поля, поэтому `comment` не появляется ни в одном вызове → `throw` → `isError` → повтор той же сигнатуры → луп.
Гипотеза B частично релевантна: `bin/vibelog.mjs` грузит `dist/`; правки VL-251 в `src` без `pnpm build` не доезжают до MCP-сервера (в плане — обязательный шаг сборки + smoke `tools/list`).
Гипотеза C — подтверждена: `src/agent/loop.ts:680-730` требует ДВУХ заблокированных вызовов подряд (`blockedStreak >= 2`) для `fail()`, при этом счётчик сбрасывается любым другим вызовом (стр. 718) — значит круги повторов могут не считаться. Капа на число заблокированных вызовов за ран нет.

## Решение (4 правки)

### 1. Схема `backlog_finish_phase` — `comment` в `required`
`src/mcp/tools.ts`
- стр. 412: `required: ['id']` → `required: ['id', 'comment']` (AC1).
- стр. 388 (description): убрать «вызов без отчёта возвращает ошибку», добавить «если report не передан, сервер собирает его автоматически» — описание должно соответствовать новому поведению.
- стр. 394 (description `comment`): то же — вместо «возвращает ошибку» → «при отсутствии сервер собирает отчёт автоматически».

### 2. Серверный fallback-отчёт (главное — AC3)
`src/mcp/tools.ts`, `toolFinishPhase` (стр. 1210–1440):
- Удалить блок hard-валидации отсутствия `comment` (стр. 1239–1246): `hardErrors` остаётся только с веткой no-op статуса (стр. 1224–1238, VL-251 `already_finished` не трогаем — это отдельный кейс и он не противоречит AC3).
- Новая локальная функция `buildAutoReport(task, ctx)` (рядом с `toolFinishPhase`), где `ctx = { statusPart, acCount, dodCount, files }`:
  - заголовок: `Фаза: авто-отчёт (comment не передан)\n`;
  - `Статус: <args.status | текущий>`; `AC отмечено: N (всего M)`, `DoD отмечено: N (всего M)`;
  - `Файлы (N): <первые 10 через запятую>` (из `args.modifiedFiles` либо `task.modified_files`);
  - фрагмент `task.implementationPlan` — первые 300 символов одной строкой (`replace(/\s+/g, ' ')`) с многоточием; если плана нет — фрагмент `task.finalSummary` (та же логика), иначе строка «план/резюме отсутствуют»;
  - явный маркер: «Отчёт собран сервером автоматически (VL-253): модель не передала comment.» — по нему видно в истории, что фаза закрыта без отчёта модели.
- В точке формирования комментария (стр. 1310–1318): `const report = (typeof args.comment === 'string' && args.comment.trim() !== '') ? args.comment : buildAutoReport(task, ctx)`; `updates.comments = [...(task.comments||[]), { author: '@agent', created: formatNow(), text: report }]`; `commentPart = args-комментарий ? 'отчёт добавлен' : 'отчёт добавлен (авто)';`.
- Порог: фаза завершается БЕЗ `isError` и с записанным статусом/отметками — AC3.

### 3. Loop detection: немедленный fail при повторной блокировке + кап (AC4)
`src/agent/loop.ts`
- Константа рядом с `LOOP_DETECTION_REPEAT_DEFAULT` (стр. 214): `const MAX_BLOCKED_CALLS_PER_RUN = 5;` — жёсткий кап заблокированных вызовов за ран (ответ на открытый вопрос: храним В ПАМЯТИ ПРОЦЕССА ФАЗЫ, не в мете — мета хранит только сигнатуры для resume-защиты, а кап относится к текущему рану; счётчики обнуляются при resume так же, как `blockedStreak`).
- Новый стейт рядом со `blockedStreak` (стр. 320): `const blockCounts = new Map<string, number>(); let blockedTotal = 0;`.
- Ветка `blocked.has(signature)` (стр. 701–709): после `blockAndPush()` проверить `blockCounts.get(signature) >= 2` ИЛИ `blockedTotal >= 2` (для сигнатуры из прошлого рана это уже ВТОРАЯ блокировка → сразу `fail`, без второго круга). Текст fail: «…вызов повторно заблокирован (та же сигнатура уже отклонялась), фаза прервана. <NEXT_STEP_HINT>».
- Ветка `streak >= repeatLimit` (стр. 720–727): после `blockAndPush()` — `fail` сразу при `blockCounts.get(signature) >= 2`, плюс общий кап `blockedTotal >= MAX_BLOCKED_CALLS_PER_RUN` → `fail` с текстом «превышен кап заблокированных вызовов».
- `blockAndPush()` (стр. 687–699): инкремент `blockCounts` и `blockedTotal`; маркерная подстрока «Loop detection» сохраняется (lesson-76).
- Удалить сброс `blockedStreak = 0` при смене сигнатуры (стр. 718) — он маскировал прогрессирующий луп; заменить на общий кап (иначе легитимная смена инструмента должна сбрасывать серию — сохраняем `blockedStreak` как счётчик ПОДРЯД, а per-signature и общий кап работают независимо).
- `fail()` уже возвращает `blocked_signatures` (стр. 431, 601) — не трогаем.

### 4. `tokenUsage` из упавшей фазы не считается успешным (AC5)
- `src/agent/session.ts` (интерфейс `SessionMeta`, ~стр. 176): новое поле
  `last_run?: { is_error?: boolean; finishedAt?: string };` с комментарием «исход последнего рана: finish_phase не доверяет явному tokenUsage, если предыдущий ран упал (VL-253)».
- `src/agent/cli.ts` (блок записи меты, стр. 745–770): дописать `last_run: { is_error: loopResult.is_error, finishedAt: new Date().toISOString() }`.
- `src/web/orchestrator.ts` (учёт токенов qwen, стр. 1040–1062): в финальный `updateSessionMeta` добавить то же `last_run` (по `record.result?.is_error`) — паритет агентов.
- `src/mcp/tools.ts`, `toolFinishPhase` (блок резолва usage, стр. 1390–1405): перед принятием `rawExplicit` проверить мету:
  ```
  const lastRunFailed = meta?.last_run?.is_error === true;
  ```
  Если `lastRunFailed` и `rawExplicit` передан — игнорировать явный объект (`usage = null` → штатный резолв мета→jsonl) и выставить `tokenFallbackNote = 'tokenUsage: проигнорирован (значения получены после упавшей фазы)'`. Итог: usage упавшего рана не задваивается и не выглядит успешным.

## Порядок действий

1. `src/mcp/tools.ts`: `required` + описания (правка 1).
2. `src/mcp/tools.ts`: `buildAutoReport` + ветка авто-отчёта, удаление hard-ошибки comment (правка 2).
3. `src/agent/session.ts` + `src/agent/cli.ts` + `src/web/orchestrator.ts`: `last_run` (правка 4, часть 1).
4. `src/mcp/tools.ts`: проверка `meta.last_run.is_error` в блоке резолва usage (правка 4, часть 2).
5. `src/agent/loop.ts`: `blockCounts`/`blockedTotal`/`MAX_BLOCKED_CALLS_PER_RUN` (правка 3).
6. Тесты (см. ниже).
7. Документация: README «Контракт `backlog_finish_phase` (VL-251)» (стр. 183–189) — переписать: comment обязателен по схеме, но при отсутствии сервер собирает авто-отчёт; loop detection — повторная блокировка = немедленный fail, кап 5; tokenUsage после упавшего рана игнорируется. CHANGELOG `[Unreleased] → Исправлено` — новая запись VL-253.
8. `pnpm build` (ОБЯЗАТЕЛЬНО: MCP-сервер исполняет `dist/`) → `pnpm test` (полный прогон для DoD).

## Тесты

- `src/mcp/server.test.mjs`:
  - AC2: в тесте `tools/list` (стр. 380-160, блок с `listResp`) добавить проверку: `const def = listResp.result.tools.find(t => t.name === 'backlog_finish_phase'); assert.ok(def.inputSchema.required.includes('comment'))` — проверяется СХЕМА, не описание.
  - AC3: переписать кейс «VL-251: вызов без report → isError» (стр. 419–434) на «вызов без report → авто-отчёт, isError=false, комментарий в файле с маркером "(VL-253)"»; плюс новый кейс «авто-отчёт содержит статус/AC/DoD/modified_files/фрагмент плана».
  - AC5: новый кейс — записать в мету сессии (`<sessionId>.meta.json` в `agentSessionsDir`) `{last_run: {is_error: true}}`, выставить env `VIBELOG_SESSION_ID`, вызвать finish_phase с явным `tokenUsage`; проверить, что в сводке «проигнорирован (значения получены после упавшей фазы)» и frontmatter `token_usage` не получил эти числа.
  - AC6: существующие кейсы с корректным `comment` (стр. 341–395, 500–600) — не менять, они становятся регрессом.
- `src/agent/loop.test.mjs`:
  - AC4: «повторная блокировка той же сигнатуры → fail сразу» (сценарий: c1 ok, c2 ok, c3 блок → директива, c4 блок → fail; `toolState.calls === 2`).
  - AC4: «сигнатура из blockedSignatures, повторённая моделью дважды → fail на второй блокировке» (сейчас тест стр. 371-389 остаётся валидным — одна блокировка и смена поведения).
  - AC4: кап — 5 заблокированных вызовов разных сигнатур в одном ране → fail с текстом про кап.
- `src/agent/cli.test.mjs` (или `session.test.mjs` для чистой функции): после рана в мете сессии есть `last_run.is_error` (без LLM-ошибки — `false`).

## Риски

1. **Изменение контракта VL-251**: жёсткая ошибка на отсутствие `comment` заменяется авто-отчётом — тест и README, закреплявшие старое поведение, надо переписать в этом же коммите (иначе красный прогон).
2. **`required: ['id','comment']` для клиентов со строгой валидацией схемы** (lesson-32): клиенты могут отклонить вызов без comment ДО сервера — но поскольку теперь сервер сам собирает отчёт, такое отклонение безвредно; модель получает ошибку клиента и добавляет поле.
3. **`dist/` vs `src/`**: без `pnpm build` симптом сохранится ровно как в инциденте (гипотеза B) — сборка обязательна перед проверкой вручную.
4. **Ложный fail при легитимной смене подхода**: кап считает заблокированные вызовы, а не все; сигнатуры считаются по точным аргументам (`JSON.stringify`), поэтому смена аргументов не инкрементирует счётчик — риск ограничен.
5. **Сравнение `meta.last_run` в MCP-сервере** читается из файла в главном репо (`agentSessionsDir(process.env.VIBELOG_CWD ?? cwd)`) — в worktree-режиме путь уже учтён (lesson-13), менять не нужно.
6. **Авто-отчёт без плана**: в старых задачах `implementationPlan` пуст → фрагмент подменяется `finalSummary`/строкой «план/резюме отсутствуют» — отчёт остаётся информативным, не падает.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 04:38
---
Фаза plan не удалась (код выхода 1): rc/mcp/tools.ts×4, payload последнего запроса=163617 байт (макс 163617), usage={"input_tokens":256516,"output_tokens":728,"cache_read_input_tokens":234496,"total_tokens":257244,"reasoning_tokens":249} — статус возвращён к Spec.
---
author: @agent
created: 2026-10-30 04:48
---
Фаза 2 (Plan) выполнена. Тип: bug.
**Гипотеза подтверждена прямо в этой фазе:** попытка вызвать `backlog_finish_phase` 4 раза подряд → поле `comment` не попало НИ В ОДИН вызов (в моей схеме инструмента `required: ["id"]`, `comment` только в `properties` + в `description`), ошибка «Неполный вызов: comment (report) не передан» повторилась байт-в-байт. Симптом VL-250/VL-252 воспроизведён полностью.
**Диагноз по коду:**
- Гипотеза A — подтверждена: `src/mcp/tools.ts:412` — `required: ['id']` при объявленном `comment` в `properties` (стр. 394) и требовании только в `description` (стр. 388) + в тексте ошибки (стр. 1239-1246). Tool-calling генерирует только `required`-поля.
- Гипотеза B — частично: правки VL-251 лежат в `src`, MCP-сервер исполняет `dist/` → без `pnpm build` симптом неизменен.
- Гипотеза C — подтверждена: `src/agent/loop.ts:680-730` — для `fail()` нужны ДВА заблокированных вызова подряд (`blockedStreak >= 2`), а счётчик сбрасывается любым другим вызовом (стр. 718); капа на число блоков за ран нет → круги повторов и рост payload.
**План записан** (4 правки, 6 файлов): (1) `src/mcp/tools.ts:412` — `comment` в `required` + правка описаний; (2) `toolFinishPhase` — удаление hard-ошибки на отсутствие comment и новый `buildAutoReport(task, ctx)` (статус, AC/DoD, файлы, фрагмент плана/резюме, маркер «авто-отчёт (VL-253)»), фаза завершается без isError; (3) `src/agent/loop.ts` — `blockCounts` по сигнатуре + `blockedTotal` + `MAX_BLOCKED_CALLS_PER_RUN = 5` (в памяти рана, не в мете), немедленный `fail` на второй блокировке той же сигнатуры, сохранение маркера «Loop detection» (lesson-76); (4) `SessionMeta.last_run {is_error, finishedAt}` в `src/agent/session.ts`, запись в `cli.ts` и `orchestrator.ts`, игнор явного `tokenUsage` в `toolFinishPhase`, если предыдущий ран упал.
**Тесты:** `server.test.mjs` — проверка `required.includes('comment')` по `tools/list` (AC2), авто-отчёт вместо isError (AC3), игнор tokenUsage после упавшего рана (AC5), существующие кейсы с корректным comment — регресс (AC6); `loop.test.mjs` — немедленный fail при повторной блокировке и кап 5 разных сигнатур (AC4); `cli.test.mjs`/`session.test.mjs` — `last_run.is_error` в мете.
**Риски:** изменение контракта VL-251 требует переписать старый тест и раздел README в том же коммите; `pnpm build` обязателен (MCP исполняет `dist/`); авто-отчёт на задачах без Implementation Plan подменяется finalSummary/заглушкой.
Статус задачи: Planned. (Причина, по которой отчёт оформлен через backlog_add_comment: сам `backlog_finish_phase` в текущей сборке не даёт передать `comment` — это и есть предметное поведение задачи.)
---
author: @agent
created: 2026-10-30 04:55
---
Фаза 3 (Code) выполнена. Изменено: src/mcp/tools.ts, src/mcp/server.test.mjs, src/agent/loop.ts, src/agent/loop.test.mjs, src/agent/session.ts, src/agent/cli.ts, src/agent/cli.test.mjs, src/agent/mcp-client.test.mjs, src/web/orchestrator.ts, README.md; коммит c3bb5be.
**Реализация по плану (4 правки):**
1. `src/mcp/tools.ts` — `required: ['id', 'comment']` у `backlog_finish_phase` (AC1) + описания инструмента и поля приведены к новому поведению.
2. `buildAutoReport(task, ctx)` — авто-отчёт при отсутствии `comment`: статус, счётчики AC/DoD, `modified_files`, фрагмент `implementationPlan`/`finalSummary`, маркер «Отчёт собран сервером автоматически (VL-253)»; в сводке «отчёт добавлен (авто)»; фаза завершается без isError (AC3). Жёсткая ошибка `already_finished` для no-op статуса сохранена.
3. `src/agent/loop.ts` — `blockCounts` по сигнатуре + `blockedTotal` + `MAX_BLOCKED_CALLS_PER_RUN = 5` (в памяти рана): повторная блокировка той же сигнатуры даёт немедленный fail (AC4), плюс кап блоков за ран; маркер «Loop detection» сохранён (lesson-76).
4. `SessionMeta.last_run {is_error, finishedAt}` в `session.ts`, запись в CLI-пост-ране и в учёте qwen (`orchestrator.ts`); `toolFinishPhase` игнорирует явный `tokenUsage` при `last_run.is_error === true` с пометкой «проигнорирован (значения получены после упавшей фазы)» (AC5).
**Тесты:** `server.test.mjs` — проверка `comment` в `required` по `tools/list` (AC2), авто-отчёт с AC/DoD/файлами, авто-отчёт с фрагментом плана, игнор tokenUsage после упавшего рана (отдельный MCP-процесс с env через новый хелпер `callMcpWithEnv`), существующие кейсы с корректным comment — регресс (AC6); `loop.test.mjs` +3 (повторная блокировка, повтор сигнатуры из `blockedSignatures`, кап блоков); `cli.test.mjs` — `last_run.is_error=false` в мете успешного рана; `mcp-client.test.mjs` — обновлён required-контракт.
**Проверки:** `pnpm build` — без ошибок; `pnpm test` — полный прогон: 87 файлов, 1648 passed, 4 skipped (все 4 — предсуществующие skip-и в `src/core/frontmatter.test.mjs`, к задаче отношения не имеют), падений нет.
**Документация:** README — раздел «Контракт `backlog_finish_phase`» переписан (схема + авто-отчёт + loop detection + игнор usage упавшего рана). CHANGELOG.md в этой фазе не правился по правилам фазы Code (итоговую документацию пишет Close) — запись для «Исправлено» нужно добавить в Close.
Что осталось: CHANGELOG-запись VL-253 (Close); при желании — smoke реального MCP-сервера вручную через `tools/list`.
---
author: @agent
created: 2026-10-30 04:58
---
Фаза close не удалась (код выхода 1): топ-повторов=нет, payload последнего запроса=122515 байт (макс 122515), usage={"input_tokens":403902,"output_tokens":1762,"cache_read_input_tokens":388608,"total_tokens":405664,"reasoning_tokens":407} — статус возвращён к Review.
---
author: @agent
created: 2026-10-30 05:10
---
Фаза Close выполнена. Ветка vb/vl-253 слита в master (merge-коммит + docs(task) 1f91f77 + docs 43236fb), worktree удалён с --force (в нём оставались только untracked-симлинки node_modules и backlog/references/data), ветка vb/vl-253 удалена.
Проверки в главном репо после merge: `pnpm build` без ошибок, полный `pnpm test` — 87 файлов, 1648 passed, 4 skipped (предсуществующие skip-и в src/core/frontmatter.test.mjs, к задаче отношения не имеют), падений нет.
Документация: README (раздел «Контракт backlog_finish_phase») переписан ещё в фазе Code, CHANGELOG.md — добавлена запись VL-253 в [Unreleased] → Исправлено (docs-коммит 43236fb). DoD «Документация обновлена» отмечен.
Без worktree-конфликтов: merge прошёл стратегией recursive без конфликтных файлов.
Урок: lesson-94 «Объявляй обязательные поля MCP-инструмента в inputSchema.required — требование в description/тексте ошибки модель не выполняет» (создан и связан с задачей, docs(task)-коммит 1f91f77).
---
<!-- COMMENTS:END -->