---
id: doc-27
title: 'Tool outcome protocol v2: переосмысление класса «модель крутится на повторах» (анализ 14 задач)'
type: specification
created_date: 2026-11-07
tags:
  - agent
  - mcp
  - architecture
  - loop-detection
  - tool-ack
  - vl-356
---
# Tool outcome protocol v2 — переосмысление класса «модель крутится на повторах»

**Статус:** реализовано (VL-357, 2026-11-07) — см. §9 «Фактическая реализация»; доделано в VL-359 (2026-11-07) — см. §10; остаток закрыт в VL-361 (2026-11-07) — см. §11
**Дата:** 2026-11-07
**Повод:** VL-356 — третья задача подряд об одном и том же; суммарно ~14 задач за две недели.

## 1. Проблема

С 2026-10-30 по 2026-11-07 закрыто/открыто 14 задач одного класса: агентская фаза падает кодом 1, потому что модель дословно повторяет write-вызов, а ответ инструмента не даёт ей понять, что делать дальше.

| Волна | Задачи | Что чинили |
|---|---|---|
| Контракт ответа | VL-303, VL-304, VL-306, VL-310, VL-318 | `ok`/`noop`/`applied` — как отличить «применилось» от «нет» |
| Директива цикла | VL-323, VL-351, VL-353 | что модель видит при повторе (`hint`, `retryWith`) |
| Валидация полей | VL-319, VL-349, VL-355, **VL-356** | одно поле блокирует операцию целиком |
| Дедуп и лимиты | VL-255, VL-326 | сигнатуры, `idempotencyKey`, noop-серии |

Ключевой признак: **каждая следующая задача — рецидив предыдущей**. VL-349 ввёл жёсткий отказ `lesson_create` без `content`; VL-355 частично откатил принцип для `lesson_update`; VL-356 откатывает решение VL-349 целиком. Это не багфиксы, а итерации по недоопределённому контракту.

## 2. Диагноз: три корня

### Корень 1. Четыре независимых детектора повторов

| Место | Что считает | Порог | Директива |
|---|---|---|---|
| `src/agent/loop.ts` | `appliedSignatures`, `noopSignatures`, `errorSignatures` | `MAX_APPLIED/NOOP/ERROR_REPEATS_PER_RUN` (3/4/5) | `loopDetectionDirective` |
| `src/agent/repeat-tracker.ts` | `createRepeatGuard`, повторы read/search/shell/write | `REPEAT_*_LIMIT`, `REPEAT_BLOCK_MAX_PER_RUN` | `repeatBlockDirective` |
| `src/web/tool-dedup.ts` | `TurnToolGuard`, `callSignature` | `MAX_NOOP_REPEATS_PER_TURN` | свой текст |
| оркестратор фаз | капы рана | настройки | `fail()` |

Инцидент попадает в тот детектор, который сработал первым, и получает директиву из его словаря. Отсюда «модель прочла не то» в VL-323, VL-351, VL-353. Пороги и тексты дублируются, менять их надо в четырёх местах.

### Корень 2. Классификация инструмента по имени, а не по объявлению

`isWriteOperation` (`src/core/tool-classify.ts`) определяет вид операции по токенам в имени (`WRITE_MARKERS`, в т.ч. `manage`). Именно это дало ложное «вызов уже применён ранее» на чистом чтении `backlog_manage_dod {action:'list'}` (VL-351). `ToolSpec` (`src/agent/tools.ts`) уже существует — вид операции должен быть его полем, а не эвристикой по строке.

### Корень 3. Ответ инструмента — набор независимых флагов, а не исход

Сейчас в `WriteAck`/`NoopAck` свободно комбинируются `ok`, `noop`, `denied`, `read`, `missing`, `hint`, `retryWith`, `applied`, `skipped`. Отсюда:
- «применили часть, но ответ выглядит как отказ» (VL-355: `applied` был эхом аргументов, а в файле `linked_tasks: []`);
- «создали сущность, но ответ выглядит как ошибка» (VL-356: урок не создан → привязать нечего → петля);
- «чтение выглядит как запись» (VL-351).

## 3. Что уже почти сложилось

`src/mcp/tool-result.ts` содержит ~90% нужного: `ackOk`, `ackOkDetailed` (с `missing`/`hint`), `ackNoopDetailed`, `ackErrorDetailed` (с `retryWith`), `ackRead`. Есть инвариант-тест `ACK_SCENARIOS` в `src/mcp/write-ack-contract.test.mjs`, который валит сборку, если новый write-инструмент отвечает плоским текстом.

Вывод: это не «переписать с нуля», а **достроить до конца** — свести флаги в один исход и убрать дублирующие детекторы.

## 4. Предложение: Tool outcome protocol v2

### Пункт 1. Один тип исхода

```ts
type ToolOutcome = 'applied' | 'partial' | 'noop' | 'rejected' | 'read' | 'unknown';

interface ToolAck {
  outcome: ToolOutcome;
  message: string;
  applied: Record<string, unknown>;
  skipped: SkippedField[];
  next?: { retryWith?: Record<string, unknown>; missing?: SkippedField[]; hint?: string };
  idempotentReplay?: true;
}
```

`ok`, `noop`, `denied`, `read` остаются **вычисляемыми геттерами** при сериализации — тесты, промпты фаз и веб-слой не ломаются. Пишется только `outcome`.

Семантика:
- `applied` — всё переданное записано;
- `partial` — записано что-то, но сущность осталась неполной (`missing` обязателен);
- `noop` — переданные значения уже были;
- `rejected` — не записано ничего, есть причина (`retryWith`/`hint`);
- `read` — эффекта не было по природе операции;
- `unknown` — не-JSON ответ, исход неизвестен (повтор исполняется заново).

Файл: `src/mcp/tool-result.ts`.

### Пункт 2. Декларативный вид инструмента

`kind: 'read' | 'write' | 'mixed'` в `ToolSpec`; `isWriteOperation` читает поле; `WRITE_MARKERS` удаляется. Закрывает класс VL-351 механически, а не заплаткой в `manageChecklist`.

Файлы: `src/agent/tools.ts`, `src/core/tool-classify.ts`.

### Пункт 3. Один детектор повторов

`src/agent/repeat-tracker.ts` — единственный источник порогов и директив. `loop.ts` и `web/tool-dedup.ts` становятся его потребителями: свои счётчики и свои тексты удаляются, `callSignature`/`repeatKey` сводятся к одной функции.

Файлы: `src/agent/repeat-tracker.ts`, `src/agent/loop.ts`, `src/web/tool-dedup.ts`.

### Пункт 4. Инвариант «валидация поля не блокирует операцию»

Обобщение VL-355/356: тест обходит все write-инструменты и требует, чтобы вызов с отсутствующим **необязательным по смыслу** полем давал `partial` + `missing`, а не `rejected`. Новый инструмент с жёстким отказом просто не пройдёт сборку — VL-357 не понадобится.

Файл: `src/mcp/write-ack-contract.test.mjs` (расширение `ACK_SCENARIOS`).

### Пункт 5. Фазовый прогресс вместо капа повторов

`fail()` по капу повторов — только если фаза не достигла цели. `buildRunProgress` (`src/agent/run-progress.ts`) уже умеет это оценивать. Сейчас косметика убивает фактически выполненную работу: в VL-349 merge, `pnpm build` и полный `pnpm test` (184 файла, 3455 тестов) уже прошли, а фаза упала на `lesson_update`.

Файлы: `src/agent/loop.ts`, `src/agent/run-progress.ts`.

## 5. Порядок миграции

1. **Пункты 1–2** — аддитивные, механические, старые поля сохраняются. Один PR, риск низкий.
2. **Пункт 4** — тест-инвариант; после него новые инструменты не могут повторить VL-356.
3. **Пункт 3** — сведение детекторов; самый рискованный по регрессам, отдельный PR.
4. **Пункт 5** — поведение фаз; отдельный PR, после стабилизации 1–3.

## 6. Риски

- **Ядро цикла, 3455 тестов.** Митигация: пункты 1–2 аддитивны, 3–5 идут по отдельности и после.
- **Совместимость промптов фаз.** Тексты `message` не меняются (инвариант VL-262), меняется только форма.
- **Соблазн «сделать Close непотопляемым».** Осознанно НЕ цель: падение фазы на реальной ошибке остаётся. Цель — убрать падения на косметике и на неоднозначном контракте.

## 7. Не проверено

- Точные пороги в `src/agent/repeat-tracker.ts` (читал только имена констант).
- Полный список инструментов, которые ещё отвечают плоским текстом (ловится `ACK_SCENARIOS`, но тест не запускался).
- Поведение `TurnToolGuard` в веб-чате после сведения с `repeat-tracker` — требует отдельного прогона.

## 8. Связанные задачи

VL-303, VL-304, VL-306, VL-310, VL-318, VL-319, VL-323, VL-326, VL-349, VL-351, VL-353, VL-355, VL-356.

## 9. Фактическая реализация (VL-357, 2026-11-07)

Все пять пунктов реализованы одним коммитом `8dff411` (ветка `vb/vl-357`, слита в master).

**Пункт 1 — `src/mcp/tool-result.ts`.** Введены `ToolOutcome` и `ToolNext {retryWith?, missing?, hint?}`; общий билдер `serializeAck` вычисляет `ok`/`noop`/`denied`/`read` из `outcome` при сериализации. `ackOk`/`ackOkDetailed`/`ackNoopDetailed`/`ackError`/`ackErrorDetailed`/`ackDenied`/`ackRead` остались публичным API и переведены на билдер; `isNoopAck` читает `outcome === 'noop'` с фолбэком на флаг. Тексты `message` не менялись (инвариант VL-262). Единственное видимое изменение формы: `ackError` отдаёт три ключа `error/ok/outcome` вместо двух — зафиксировано в `src/mcp/write-ack.test.mjs`.

**Пункт 2 — `src/core/tool-kinds.ts` (новый).** Вместо поля `kind` в каждом `ToolSpec` реестра заведена таблица `TOOL_KINDS` на 47 инструментов + `LOCAL_TOOL_KINDS` для файловых инструментов агента; `ToolSpec` (`src/agent/tools.ts`) получил необязательное `kind?: ToolKind`, которое в `inputSchema`/MCP-схему не попадает. `isWriteOperation(name, args?)` читает объявление; `WRITE_MARKERS`/`READ_MARKERS` удалены; `mixed` разрешается по аргументам (`backlog_manage_ac/dod {action:'list'}` → read, вызов без аргументов → write fail-safe). Веб-чат (`src/web/chat.ts`, две точки) и `tool-dedup.ts` передают аргументы в классификатор.

**Пункт 3 — `src/agent/repeat-tracker.ts`.** Единственный источник: `REPEAT_LIMITS` (search/read/shell/write/writeBlock/applied/noop/error/blockedCalls/warnMax), именованные `MAX_*_REPEATS_PER_RUN`/`MAX_BLOCKED_CALLS_PER_RUN`/`REPEAT_WARN_MAX_PER_RUN` как производные; единая `callSignature` (копия в `web/tool-dedup.ts` удалена, модуль реэкспортирует) и `repeatKey` — обе вырезают `NON_SEMANTIC_ARGS` (`idempotencyKey`); директивы `loopDetectionDirective`/`retryDirective`/`appliedNoopDirective`/`noopRepeatDirective`/`clipErrorText`/`parsedErrorText` перенесены сюда, `loop.ts` их реэкспортирует (публичный API сохранён). `parsedErrorText` читает и v2-форму (`next.retryWith`/`next.hint`), и старую (поля в корне). `MAX_NOOP_REPEATS_PER_TURN` в веб-чате = `REPEAT_LIMITS.noop`.

**Отклонение от плана:** `TurnToolGuard` (`src/web/tool-dedup.ts`) переведён на общий `callSignature` и общий порог, но собственный счётчик окна «ход» оставлен осознанно — это окно другого уровня (ответ модели, а не ран), сведение к `createRepeatGuard` давало риск регресса VL-324 выше выгоды.

**Пункт 4 — `src/mcp/write-ack-contract.test.mjs`.** Добавлены блок `PARTIAL_SCENARIOS` + `PARTIAL_EXEMPT` и тест обхода `listTools()`: каждый write-инструмент обязан либо вернуть `outcome:'partial'` + непустой `next.missing` на вызове без необязательного по смыслу поля, либо иметь документированное исключение. По ходу вскрылись два скрытых рецидива: `document_create` и `reference_add` молча возвращали `applied` при пустом теле — исправлены на `partial` + `missing`/`hint`.

**Пункт 5 — `src/agent/loop.ts`.** `failOnRepeatCap`: при исчерпании `MAX_APPLIED/NOOP/ERROR_REPEATS_PER_RUN` ран завершается штатно с блоком `buildRunProgress`, если в ране есть фактический след работы (успешный `edit`/`write_file`/`git_commit`/отчёт — проверяется имя И содержимое ответа; ответ `ok:false`/директива блокировки работой не считаются). Иначе — прежний `fail()`.

**Попутный дефект:** `callSignature` падал с `Cannot use 'in' operator to search for 'idempotencyKey'` на строковых `args` (веб-слой/супервизор передают JSON-строку) — ловилось `supervisor-limits.test.mjs`.

**Тесты:** `src/mcp/tool-outcome.test.mjs` (10), `src/core/tool-classify.test.mjs` (6), `src/agent/loop-repeat-cap.test.mjs` (3), `src/agent/repeat-tracker-vl357.test.mjs` (10), блок partial в `write-ack-contract.test.mjs` (3 кейса). Полный прогон после merge: 189 файлов, 3536 passed, 4 skipped.

## 10. Доделка (VL-359, 2026-11-07)

VL-357 оставила четыре незакрытых места; VL-359 их закрыла (коммит `67171e5`, ветка `vb/vl-359`, слита в master).

**1. `ToolSpec.kind` стал читаемым (вариант A плана).** `src/core/tool-classify.ts`: добавлен `registerLocalToolKinds(fn)` + резолвер модуля; `declaredToolKind(name) = toolKindOf(name) ?? localKindResolver?.(name) ?? LOCAL_TOOL_KINDS[name]`. `LOCAL_TOOL_KINDS` экспортирован и остался фолбэком для путей без реестра. `src/agent/tools.ts`: `listLocalTools` собирает `specs` и регистрирует резолвер `name => specs.find(s => s.name === name)?.kind` (идемпотентен по набору — вид от cwd не зависит). Тест паритета в `src/core/tool-classify.test.mjs` обходит `listLocalTools()` и сверяет `ToolSpec.kind` ↔ `declaredToolKind` ↔ `LOCAL_TOOL_KINDS` в обе стороны, плюс проверяет, что в таблице нет имён вне реестра.

**2. Пороги повторов сведены.** `REPEAT_BLOCK_MAX_PER_RUN = REPEAT_LIMITS.blockedCalls` (объявление перенесено ниже `REPEAT_LIMITS` — TDZ). В `REPEAT_LIMITS` добавлены `phantom: 3` и `intent: 4` с перенесёнными комментариями-обоснованиями; `PHANTOM_CALL_LIMIT_DEFAULT`/`INTENT_LOOP_REPEAT_DEFAULT` теперь экспортируемые производные в `repeat-tracker.ts`, `loop.ts` импортирует их оттуда. Тест в `repeat-tracker.test.mjs` сверяет все три с `REPEAT_LIMITS`.

**3. Guard-ответы веб-чата через `serializeAck`.** `ToolAckInput` получил аддитивное `extra?: Record<string, unknown>`; `serializeAck` дописывает его ключи, НЕ перезаписывая вычисленные из `outcome` (исход остаётся единственным источником правды). `duplicateCallResult` → `outcome:'rejected', reason:'duplicate', extra:{duplicate:true}`; `limitCallResult` → `rejected`/`limit`; `noopRepeatCallResult` → `outcome:'noop', reason:'noop_repeat', extra:{noop_repeat:true}`. Тексты `message` не менялись (инвариант VL-262). Путь подтверждений не затронут — `ackDenied` не тронут.

**4. Трассировка 13 задач класса → именованный тест.** Фаза Code не правит `backlog/docs`, поэтому AC6 VL-357 закрыт тест-матрицей `src/mcp/tool-outcome-trace.test.mjs`: 13 задач → файл + подстрока имени `it(...)` (ссылки по имени, не по номеру строки — номера протухают). Тест падает, если регресс переименовали или удалили.

| Задача | Файл теста | Подстрока имени `it(...)` |
|---|---|---|
| VL-303 | `src/mcp/write-ack.test.mjs` | `VL-303 — no-op update_task не пишет файл` |
| VL-304 | `src/agent/loop.test.mjs` | `VL-304` |
| VL-306 | `src/agent/loop.test.mjs` | `VL-306/VL-351 — не-JSON ответ write-инструмента` |
| VL-310 | `src/agent/loop.test.mjs` | `VL-310 (AC4)` |
| VL-318 | `src/agent/loop.test.mjs` | `VL-318 — ackError (ok:false) не считается применённым` |
| VL-319 | `src/agent/loop.test.mjs`, `src/mcp/write-ack.test.mjs` | `VL-319 (AC7)`, `VL-319 — пустое тело урока` |
| VL-323 | `src/agent/loop.test.mjs` | `VL-323 — серия ackError не убивает фазу` |
| VL-326 | `src/web/chat.test.mjs`, `src/web/tool-dedup.test.mjs` | `VL-326` |
| VL-349 | `src/agent/loop.test.mjs`, `src/mcp/write-ack.test.mjs` | `VL-349 (AC6)`, `VL-349 — тело-скелет урока` |
| VL-351 | `src/agent/loop.test.mjs` | `VL-306/VL-351` |
| VL-353 | `src/agent/loop.test.mjs` | `VL-353 — директива loop detection несёт ГОТОВЫЙ вызов` |
| VL-355 | `src/agent/loop.test.mjs`, `src/mcp/write-ack.test.mjs` | `VL-355 (AC5)`, `VL-355 — незаполненное тело урока` |
| VL-356 | `src/agent/loop.test.mjs`, `src/mcp/lesson-tools.test.mjs` | `VL-356 (AC5)`, `VL-356: create без content через MCP` |

**Проверки:** `pnpm build` — ок; полный `pnpm test` — 189 файлов, 3533 passed, 4 skipped (предсуществующие skip в `src/core/frontmatter.test.mjs`), 0 failed.

**Что осталось открытым после VL-359:** `runHasProgress` (`src/agent/loop.ts`) не учитывает `run_shell_command` — в фазе Close-worktree вся работа идёт через shell (merge/build/test), поэтому кап повторов по-прежнему может уронить ран с выполненной работой (сессия `agent-1794064942811`). Вынесено в VL-361. Там же — директивы цикла (`noopRepeatDirective`/`appliedNoopDirective`) всё ещё отдают плоский текст вместо JSON с `outcome` и теряют `missing` из последнего ответа инструмента.

## 11. Закрытие остатка (VL-361, 2026-11-07)

Оба пункта, оставшихся открытыми после VL-359, закрыты (коммит `8b1b63c`, ветка `vb/vl-361`, слита в master).

**1. Прогресс рана видит shell-работу — по разбору ответа, а не по имени инструмента.** `runHasProgress()` (`src/agent/loop.ts`) получил отдельную ветку для `run_shell_command` и экспортированный предикат `shellCallIsWork(command, output)`: команда должна относиться к классу «меняет состояние / проверяет результат» (`SHELL_WORK_PATTERNS`: `git merge|commit|rebase|cherry-pick|worktree remove|branch -d`, `pnpm build|test`, `npx vitest`, `npm run build|test`) И не нести маркеров провала (`SHELL_FAILURE_MARKERS`: `^exit code: [1-9]`, `^fatal:`, `ERR_*`, `command not found`, `N failed`, `^error`). `WORK_EVIDENCE_TOOLS` остался из трёх инструментов — наивное добавление имени дало бы регресс VL-124 (упавшая команда выдала бы себя за работу). Код возврата доступен всегда: `makeRunShellCommand` (`src/agent/tools.ts`) печатает первой строкой `exit code: N`, правка `tools.ts` не потребовалась.

**2. Директивы цикла — на JSON-контракте.** `noopRepeatDirective`/`appliedNoopDirective` (`src/agent/repeat-tracker.ts`) отдают `serializeAck({outcome:'noop', reason:'noop_repeat', next:{missing,hint,retryWith}, extra:{noop_repeat|applied_repeat}})` — плоского текста в директивах цикла не осталось, модель видит тот же формат, что и от инструмента. `extra` в `ToolAckInput` уже добавлена VL-359 (пункт 3 §10) — переиспользована, правка `tool-result.ts` не потребовалась. Новый `parsedAckNext(output)` читает `missing`/`hint`/`retryWith` из v2-формы (`next.*`) и старой (поля в корне); в цикле — `lastAckBySignature`, заполняется в точке классификации noop-ответа, читается в `blockAndPush` для обеих директив. Модель видит КОНКРЕТНОЕ недостающее поле, а не «добавь отсутствующее».

**Тесты:** `src/agent/loop-repeat-cap.test.mjs` +4 (регресс `agent-1794064942811` → штатное завершение с блоком `buildRunProgress`; регресс VL-124 `fatal:` → `fail()`; `exit code: 1` → не работа; `ls` вне класса → не работа), `src/agent/repeat-tracker-vl357.test.mjs` +3 (JSON-контракт директив, проброс `missing`/`hint`/`retryWith`, `parsedAckNext`), `src/agent/loop.test.mjs` (регресс-кейс VL-319 дополнен проверкой `missing`/`hint`; инвариант размера директивы поднят с 400 до 1200 байт — JSON по построению длиннее плоской строки, смысл инварианта сохранён).

**Проверки:** `pnpm build` — ок; полный `pnpm test` — 189 файлов, 3540 passed, 4 skipped, 0 failed; после merge в master — полный прогон повторён, регрессий нет.
