---
id: VL-255
title: 'Веб-чат: дедупликация и лимит tool-вызовов на ход — запретить дословный повтор идентичных вызовов в одном ответе'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 09:57'
updated_date: '2026-10-30 21:49'
due_date: ''
labels:
  - agent
  - web
  - tools
  - loop
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
  - src/web/tool-dedup.ts
  - src/web/tool-dedup.test.mjs
  - src/web/chat.ts
  - src/web/chat.test.mjs
  - templates/prompts/chat-system.md
  - README.md
lessons:
  - lesson-119
token_usage:
  input: 8900307
  output: 64176
  cache: 8640000
  total: 8964483
  requests: 117
  duration_ms: 1204400
  reasoning: 20527
  by_phase:
    plan:
      input: 1203684
      output: 17521
      cache: 1119232
      requests: 21
    code:
      input: 6760184
      output: 41338
      cache: 6618624
      requests: 73
    close:
      input: 936439
      output: 5317
      cache: 902144
      requests: 23
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Разбор сессии веб-чата (правка VL-254): один ответ агента содержал ~50 tool-вызовов вместо 6 — блок из `read_file` / `backlog_view_task` / `backlog_search` был дословно повторён ≈8 раз (те же name+args), причём часть вызовов била в несуществующие пути (`backlog/tasks/VL-254.md`, `backlog/active/VL-254.md`, `backlog/VL-254.md`) и возвращала ENOENT.

Проблема системная: в веб-чате нет дедупликации идентичных tool-вызовов в пределах одного хода и нет лимита числа вызовов на ход. Агент-петля (`src/agent/loop.ts` + `repeat-tracker`, VL-229) такое отслеживает, а веб-чат — нет: `repeat_stats` для чата не считается, предупреждения «ты уже вызывал это» нет.

## Цель

Дешёвая защита: не выполнять один и тот же вызов дважды в одном ходе, ограничить число вызовов на ход и сказать агенту, что повтор бессмысленен.

## Предлагаемое решение (уточнить в Plan)

1. В слое исполнения tool-вызовов веб-чата считать ключ вызова как `name + стабильная сериализация arguments` (ключи отсортированы). Идентичный ключ, встреченный в том же ходе повторно, не исполнять — вернуть в tool-ответ текст «идентичный вызов уже выполнен в этом ходе; используй полученный результат» (и зачесть в метрику повторов).
2. Ограничить число tool-вызовов на один ход (значение в конфиге, разумный дефолт ~12–20); при превышении — выполнить первые N, на остальные вернуть сообщение «лимит вызовов на ход исчерпан — заверши ход и продолжи следующим».
3. Записывать `repeat_stats` для веб-чата в тот же формат, что у агент-петли (переиспользовать `repeat-tracker`), чтобы диагностика была общей.
4. Тест: фикстура с тремя идентичными `read_file` и 30 разными вызовами — второй/третий идентичный не исполняются, лимит срабатывает, в ответах есть пояснение.

## Известные риски

- Легитимный повтор: осознанный повторный вызов после изменения файла (например `read_file` после `write_file`). Нужно разрешать повтор, если между вызовами был write-вызов к тому же ресурсу (учитывать порядок вызовов в ходе / между ходами).
- Лимит на ход не должен ломать сценарии пакетного чтения — значение конфигурируемое.

## Связанное

VL-229 (repeat-tracker в агент-петле), VL-254 (guard повторов для shell), VL-124 (политика инструментов вместо патч-скриптов).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Дословно повторённый в одном ходе вызов (то же имя + те же аргументы, порядок ключей не важен) не исполняется второй раз: tool-результат содержит {ok:false,duplicate:true} и текст «Идентичный вызов уже выполнен в этом ходе — используй полученный ранее результат», событие tool_start/tool_end для него сохраняется
- [x] #2 Лимит tool-вызовов на один ответ модели соблюдается: выполнено не больше N (дефолт 16), остальные получают {ok:false,limit:true} с текстом «Лимит tool-вызовов на один ответ исчерпан (N) — заверши ход и продолжи следующим»; N настраивается ключом chat_max_tool_calls в .vibelog/settings.json (целое 1–200, иначе дефолт, падения нет)
- [x] #3 Легитимный повтор разрешён: чтение файла после write к тому же пути не считается дубликатом (write инкрементит epoch ресурса), дословный повтор самого write — блокируется
- [x] #4 Дедупликация и лимит работают во всех точках исполнения инструментов веб-чата: обычный цикл ответа, resume после approval и advanceToNextApproval (единая точка executeTool)
- [x] #5 Диагностика: по завершении хода в .vibelog/chat-sessions/<threadId>.repeat.json пишется repeat_stats в формате аналитики агент-петли (tool_calls_total/repeat_calls/repeat_share/top) плюс счётчики executed/deduped/limit_hits; файл не ломает список тредов, сбой записи не рвёт ход
- [x] #6 Тесты: фикстура с тремя идентичными read_file и 30 разными вызовами — второй/третий идентичный не исполняются, лимит срабатывает, в ответах есть пояснение; полный pnpm test проходит
- [x] #7 Документация обновлена: README (подраздел о повторах/лимите/chat_max_tool_calls) и templates/prompts/chat-system.md (правило модели про duplicate/limit)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Решения Plan-фазы

**Границы защиты (уточнение к предложению из описания).**
1. **Ход** = один POST `/api/chat` (в т.ч. resume после Allow/Deny). Стейт guard'а живёт в памяти `produce()` — сбрасывается на каждый запрос. Причина: после хода модель уже видит результаты прошлых вызовов в истории, а межзапросный дедуп потребовал бы хранить состояние в jsonl треда (отдельная задача). Инцидент VL-254 был внутри **одного ответа** — этого достаточно.
2. **Лимит вызовов** считаем на **один ответ модели** (`resp.toolCalls`), а не на весь запрос: внутри одного POST до 8 LLM-итераций, и лимит «на запрос» ломал бы пакетное чтение (агент легально делает 6 вызовов × 3 итерации). Дефолт — **16 вызовов на ответ**, конфигурируемый.
3. **Дубликат вызова** ловится по ключу `name + '|' + стабильная JSON-сериализация arguments` (рекурсивная сортировка ключей) — «дословный» повтор, в отличие от грубого ключа `repeatKey` (только path/pattern). Оба механизма сосуществуют: `repeatKey` — предупреждение/метрика, новый ключ — блокировка исполнения.
4. **Легитимный повтор после write** (риск из описания): guard хранит `writeEpoch` по ресурсу (`toolRepeatTarget(name,args)` из `repeat-tracker.ts`: read_file/write_file/edit → path, grep/glob/search → pattern). Write-вызов инкрементит epoch своего ресурса; запись об исполненном вызове сохраняет epoch **после** инкремента, поэтому повторное чтение того же файла после write разрешается, а дословный повтор самой записи — блокируется.
5. **Ответ на блокированный вызов** — JSON в tool-результате (машиночитаемо, контракт VL-262): `{"ok":false,"duplicate":true,"message":"Идентичный вызов уже выполнен в этом ходе — используй полученный ранее результат."}` и `{"ok":false,"limit":true,"message":"Лимит tool-вызовов на один ответ исчерпан (N) — заверши ход и продолжи следующим."}`. Оба содержат явный следующий шаг (lesson-92), а не нейтральный «успех». События `tool_start`/`tool_end` вокруг синтетического результата **сохраняются** — иначе фронт (`chat-runtime.tsx`) получит `tool_end` без парного `tool_start` и карточка вызова не отрисуется.
6. **`repeat_stats`** считаем переиспользуя `analyzeToolRepeats(history)` (`src/agent/repeat-tracker.ts`, без изменений) в конце `produce` на путях `done` и `error`, и пишем в `<threadId>.repeat.json` рядом с историей (не `.jsonl` — иначе `listChatThreads` увидит файл как тред). Плюс счётчики `deduped` / `limit_hits` — диагностика guard'а.

## Файлы и конкретные правки

| № | Файл | Место | Что меняем |
|---|------|-------|-----------|
| 1 | `src/web/tool-dedup.ts` (**новый**, ~200 строк) | — | Чистый модуль без fs (паттерн `repeat-tracker.ts`). Экспорты: `CHAT_MAX_TOOL_CALLS_DEFAULT = 16`, `callSignature(name, args): string` (рекурсивная стабильная сериализация: сортировка ключей объектов, массивы по порядку, `undefined`/функции отбрасываются), `ToolCallVerdict = 'execute' \| 'duplicate' \| 'limit'`, `TurnToolGuard` — интерфейс `{ beginTurn(); check(name, args): ToolCallVerdict; noteExecuted(name, args); stats(): {executed, deduped, limit_hits} }` и `createTurnToolGuard(opts: {maxPerResponse?: number}): TurnToolGuard`. Внутри: `Map<signature, {epoch: number}>`, `Map<resourceKey, number>` (epoch по `toolRepeatTarget`), счётчик вызовов текущего ответа (`beginTurn` сбрасывает и счётчик, и — осознанно нет — карту исполненных: дедуп «дословно» действует на весь ход). `check`: если счётчик ответа `>= maxPerResponse` → `'limit'` (счётчик НЕ инкрементится — иначе каждая следующая попытка тоже лимит, это ожидаемо); если сигнатура уже исполнена и epoch её ресурса не изменился → `'duplicate'`; иначе `'execute'`. `noteExecuted`: для write-вызовов (`isWriteOperation` — импорт из `./tool-policy.js`; циклического импорта нет, `tool-policy.ts` про dedup ничего знать не будет) сначала `bumpEpoch(resourceKey)`, потом запись сигнатуры с новым epoch; инкремент `executed`. |
| 2 | `src/web/tool-policy.ts` | после `chatToolDefs` (строка ~260, до конца файла в 297) | Добавить `export const CHAT_MAX_TOOL_CALLS_DEFAULT = 16` (импортируется из `tool-dedup.ts`? — нет: объявить здесь, а в `tool-dedup.ts` не дублировать; экспорт держим в `tool-dedup.ts`, `tool-policy.ts` его реэкспортирует НЕ нужно) и `export function resolveChatMaxToolCalls(cwd: string): number` — читает `.vibelog/settings.json` через `loadSettings(cwd)`, ключ `chat_max_tool_calls`: целое `1..200` → значение, иначе дефолт 16 (терпимая валидация, lesson-117: битая секция не отключает дефолт). JSDoc по-русски. |
| 3 | `src/web/chat.ts` | импорт-блок (строки 30-48) | `import { analyzeToolRepeats, type RepeatStats } from '../agent/repeat-tracker.js';`, `import { createTurnToolGuard, CHAT_MAX_TOOL_CALLS_DEFAULT } from './tool-dedup.js';`, `import { resolveChatMaxToolCalls } from './tool-policy.js'` (дополнить существующий импорт из `./tool-policy.js`). |
| 4 | `src/web/chat.ts` | рядом с `recordApprovalLog`/`loadApprovalLog` (строки 130-200) | Новые экспорты: `recordChatToolStats(cwd, threadId, stats: ChatToolStats)` — пишет `<threadId>.repeat.json` (`{ts, turn, repeat_stats, executed, deduped, limit_hits}`, атомарная запись `writeFileSync`, `try/catch` — диагностика не рвёт диалог) и `loadChatToolStats(cwd, threadId): ChatToolStats | null` (битый JSON → null, THREAD_ID_RE-guard). Тип `ChatToolStats` — там же: `{ turn: number; repeat_stats: RepeatStats; executed: number; deduped: number; limit_hits: number }`. |
| 5 | `src/web/chat.ts` | строки 607-627 (`const tools = chatToolDefs(cwd)` … `const started = Date.now()`) | Создать guard до `executeTool`: `const toolGuard = createTurnToolGuard({ maxPerResponse: resolveChatMaxToolCalls(cwd) });`. В `executeTool` — ПЕРВОЙ строкой `const verdict = toolGuard.check(name, args);`. При `'duplicate'` → `return JSON.stringify({ ok: false, duplicate: true, message: 'Идентичный вызов уже выполнен в этом ходе — используй полученный ранее результат.' })`; при `'limit'` → `return JSON.stringify({ ok: false, limit: true, message: \`Лимит tool-вызовов на один ответ исчерпан (${max}) — заверши ход и продолжи следующим.\` })`; при `'execute'` — прежний путь, после успешного `raw` вызвать `toolGuard.noteExecuted(name, args)` **до** `truncateToolOutput`, вернуть `truncateToolOutput(raw)`. В JSDoc `executeTool` дописать пункт про дедуп/лимит. |
| 6 | `src/web/chat.ts` | строка ~727-747 (начало итерации LLM-цикла) | Перед `llm.streamChat` вызвать `toolGuard.beginTurn()` (сброс счётчика вызовов текущего ответа; карта исполненных сохраняется — дедуп на весь ход). |
| 7 | `src/web/chat.ts` | строки 760-790 (цикл `for (const tc of resp.toolCalls)`) | Ничего структурно не меняется: `executeTool` уже вернёт синтетический результат, а `tool_start`/`tool_end` вокруг остаются — правка нужна только в позицию вызова (guard работает внутри `executeTool`, дублирования логики нет; `advanceToNextApproval` на строке 679 получает тот же `executeTool` и тоже защищён). При блокировке по лимиту `isError` оставить `false` — это не ошибка инструмента, а сообщение модели (UI покажет текст). |
| 8 | `src/web/chat.ts` | пути завершения: строка 743 (`queue.push({type:'done'})`), все ветки `queue.push({type:'error'})` после старта цикла (строки ~722, 733, 759) | Перед `return` вызвать `recordChatToolStats(cwd, threadId, { turn: currentTurn(), repeat_stats: analyzeToolRepeats(history), ...toolGuard.stats() })`. Хелпер `finishWithStats()` внутри `produce` (или прямой вызов в 4 местах — выбрать прямой вызов с одним аргументом, чтобы не плодить замыкания). Ошибка записи диагностики не должна менять поток событий. |
| 9 | `templates/prompts/chat-system.md` | конец файла (после блока «Контракт ответа write-инструментов», строка ~17) | Новый абзац: «Повторы и лимиты. Один и тот же вызов (то же имя и те же аргументы) в одном ходе выполняется один раз: повтор получает ответ `{ok:false,duplicate:true}` — бери результат первого вызова, не повторяй. После write к тому же файлу повторное чтение разрешено. Лимит tool-вызовов на один ответ — 16 (настраивается `chat_max_tool_calls` в `.vibelog/settings.json`): при исчерпании приходит `{ok:false,limit:true}` — заверши ответ текстом, следующий шаг делай в новом ходе. Не угадывай пути: отсутствующий файл отвечает листингом и подсказкой — читай её вместо перебора вариантов пути.» |
| 10 | `src/web/tool-dedup.test.mjs` (**новый**, ~10-12 тестов) | — | `callSignature`: порядок ключей не влияет, вложенные объекты/массивы, `undefined` отбрасывается; дубликат → `'duplicate'`; разные args → `'execute'`; повтор после write к тому же path → `'execute'`; дословный повтор write → `'duplicate'`; лимит: `maxPerResponse: 3` → 4-й и последующие `'limit'`, `beginTurn` сбрасывает счётчик, но не карту; `stats()` возвращает `{executed, deduped, limit_hits}`. |
| 11 | `src/web/chat.test.mjs` | конец файла (новый `describe('VL-255 …')`, временный каталог через `mkdtempSync` — урок lesson-89) | Фикстура на `fakeLlm`: ответ 1 — 3 идентичных `read_file {path: 'README.md'}` + `text`; ожидания: первый исполнен, 2-й/3-й — `tool_end` с `duplicate:true` и текстом «Идентичный вызов уже выполнен», файл прочитан ровно один раз (счётчик через подмену handler'а невозможен — проверяем по содержимому: у 2-3-го `result` содержит маркер `duplicate`). Ответ 2 — 30 разных `read_file` (разные `offset`); ожидания: выполнено 16, остальные 14 → `limit: true` + текст «Лимит tool-вызовов на один ответ исчерпан», ни один из блокированных не содержит содержимого файла. Третий тест: `read_file` → `write_file` → `read_file` того же пути после Allow → повтор РАЗРЕШЁН (нет `duplicate`). Четвёртый: `chat_max_tool_calls: 2` в tmp-`settings.json` → срабатывает на 3-м вызове; `chat_max_tool_calls: "abc"` → дефолт 16 (не падает). Пятый: `<threadId>.repeat.json` создан, содержит `repeat_stats.tool_calls_total`, `deduped >= 2`, `limit_hits >= 14`. |
| 12 | `README.md` | §«Веб-чат (#/chat)», после блока про `read_file`/`project_map` (строки 133-260) | Подраздел «Повторы и лимит tool-вызовов (VL-255)»: ключ `chat_max_tool_calls` (дефолт 16, диапазон 1-200), поведение дедупа (дословный повтор не исполняется, повтор после write разрешён), тексты ответов модели, файл диагностики `<threadId>.repeat.json` (`repeat_stats` в формате агент-петли + `deduped`/`limit_hits`), отличие от `repeat-tracker` VL-229 (тот предупреждает по грубому ключу, этот блокирует точный дубль). |
| 13 | `CHANGELOG.md` | первая позиция (после шапки) | Запись VL-255 по образцу соседних: что сделано, тесты, документация, lesson'ы. |

## Порядок действий

1. `src/web/tool-dedup.ts` (чистый модуль) → `src/web/tool-dedup.test.mjs` → `pnpm build && npx vitest run src/web/tool-dedup.test.mjs`.
2. `resolveChatMaxToolCalls` в `src/web/tool-policy.ts` (+ тест в `tool-dedup.test.mjs` или `tool-policy.test.mjs` — выбрать `tool-policy.test.mjs`, там уже tmp-каталоги).
3. Интеграция в `src/web/chat.ts`: guard → `executeTool` → `beginTurn` в итерации → `recordChatToolStats` на `done`/`error`.
4. Тесты в `src/web/chat.test.mjs` (новый `describe`).
5. `templates/prompts/chat-system.md`, `README.md`, `CHANGELOG.md`.
6. `pnpm build` → `pnpm test:fast` (точечно) → **полный `pnpm test`** перед DoD (правило AGENTS.md). Фронт не трогаем — `pnpm web:build` не требуется.

## Как проверить

- `pnpm build` — tsc без ошибок (strict).
- `npx vitest run src/web/tool-dedup.test.mjs src/web/tool-policy.test.mjs src/web/chat.test.mjs` — точечно.
- `pnpm test` — полный прогон (обязателен для DoD, включая `src/web/chat-*.test.mjs`, `personas.test.mjs`, `api`-тесты: `executeTool` общий, регресс возможен в resume-пути).
- Ручной smoke (по желанию): `vibelog browser` → `#/chat` → попросить прочитать один файл трижды; в ленте — один реальный результат и два с пометкой duplicate.

## Риски и как закрываем

- **Легитимные повторы** (чтение после записи) — `writeEpoch` по ресурсу; тест №3 в `chat.test.mjs`.
- **Лимит ломает пакетное чтение** — считаем на ответ (16), конфигурируем `chat_max_tool_calls`; значение вне 1-200 → дефолт.
- **Дедуп не работает между POST** (resume) — осознанно: guard в памяти `produce`; документируется в README и JSDoc. Персистентный дедуп — потенциальная отдельная задача (не блокер).
- **Парность событий** `tool_start`/`tool_end` на синтетических результатах — сохранена (события вокруг вызова, не внутри `executeTool`).
- **Циклический импорт** `tool-dedup.ts` ↔ `tool-policy.ts` — `tool-dedup` импортирует только `isWriteOperation` и `toolRepeatTarget`; `tool-policy` про dedup не знает, `chat.ts` — точка сборки.
- **Существующие тесты ловят тексты** (lesson-76) — новые тексты не меняют прежних; `executeTool` при вердикте `'execute'` возвращает ровно прежний результат.
- **Запись диагностики** — `try/catch` вокруг `writeFileSync`, сбой лога не рвёт ход.

## Связанное

- VL-229 (`repeat-tracker`) — переиспользуем `analyzeToolRepeats` и `toolRepeatTarget`, не дублируем (lesson-37).
- VL-254 (guard повторов shell), VL-262 (контракт ack) — синтетические ответы в том же JSON-стиле.
- lesson-91/92 (явная ошибка модели вместо «успеха»), lesson-117 (терпимая валидация конфига), lesson-89 (mkdtemp в тестах), lesson-76 (маркерные подстроки тестов).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 21:25
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача — план записан в саму задачу, дочерних задач/блокеров не создавалось).
**Что изучено:** `src/web/chat.ts` (888 строк; ключевые точки: `executeTool` — строка 623, цикл `for (const tc of resp.toolCalls)` — 760, итерация LLM-цикла — ~727, пути done/error — 743/722/733/759), `src/web/tool-policy.ts` (`chatToolDefs`, `isWriteOperation`), `src/agent/repeat-tracker.ts` (`analyzeToolRepeats`, `toolRepeatTarget`, `repeatKey`), `src/core/settings.ts` (`loadSettings`), `templates/prompts/chat-system.md`, `src/web/chat.test.mjs` (fakeLlm/mkdtemp-паттерн), README §«Веб-чат».
**Решения (уточнения к предложению из описания):**
1. «Ход» = один POST `/api/chat`: guard живёт в памяти `produce()`; межзапросный (resume) дедуп потребовал бы персистентного стейта — инцидент VL-254 был внутри одного ответа, этого достаточно.
2. Лимит считаем **на один ответ модели**, а не на запрос: внутри POST до 8 LLM-итераций, лимит «на запрос» сломал бы пакетное чтение. Дефолт 16, ключ `chat_max_tool_calls` (1–200), терпимая валидация (lesson-117).
3. Ключ дубля — `name + стабильная JSON-сериализация args` (рекурсивная сортировка ключей); дополняет грубый `repeatKey` VL-229 (тот — предупреждение/метрика, этот — блокировка исполнения).
4. Легитимный повтор после write: `writeEpoch` по ресурсу (`toolRepeatTarget` из repeat-tracker) — write инкрементит epoch, поэтому чтение после записи разрешено, дословный повтор самой записи блокируется.
5. Синтетические ответы — JSON-контракт VL-262 `{ok:false,duplicate|limit,message}` с явным следующим шагом (lesson-92); события `tool_start`/`tool_end` сохраняются (иначе фронт получит `tool_end` без пары).
6. `repeat_stats` — переиспользуем `analyzeToolRepeats(history)` без изменений; файл `<threadId>.repeat.json` (не `.jsonl`, иначе `listChatThreads` увидит его как тред).
**План:** 13 позиций в 7 файлах — новый `src/web/tool-dedup.ts` (чистый модуль: `callSignature`, `createTurnToolGuard`, `CHAT_MAX_TOOL_CALLS_DEFAULT`) + тест `src/web/tool-dedup.test.mjs` (~10–12 кейсов); `src/web/tool-policy.ts` (`resolveChatMaxToolCalls`); `src/web/chat.ts` (импорты, `recordChatToolStats`/`loadChatToolStats`, guard в `executeTool`, `beginTurn` в итерации, запись статистики на done/error); `src/web/chat.test.mjs` (новый describe: 3 идентичных `read_file`, 30 разных → лимит, read→write→read разрешён, конфиг 2 и мусорный конфиг, файл repeat.json); `templates/prompts/chat-system.md`; README; CHANGELOG. Все пути проверены на существование (`ls`).
**Риски:** межзапросный дедуп не работает (осознанно, документируется); лимит vs пакетное чтение — считаем на ответ + конфиг; парность tool-событий сохранена; циклический импорт исключён (`tool-dedup` → `tool-policy`, не обратно); запись диагностики в try/catch.
**Проверка:** `pnpm build`; точечно `npx vitest run src/web/tool-dedup.test.mjs src/web/tool-policy.test.mjs src/web/chat.test.mjs`; обязательный полный `pnpm test` перед DoD; фронт не меняется — `pnpm web:build` не нужен.
**AC:** записаны 7 критериев приёмки (в исходной задаче их не было). DoD не менялся. Статус переведён в Planned.
---
author: @agent
created: 2026-10-30 21:40
---
Фаза 3 (Code) выполнена. Коммит b0d5b07.
**Изменено:**
- `src/web/tool-dedup.ts` (новый, ~330 строк) — чистый модуль: `callSignature` (стабильная рекурсивная JSON-сериализация args с сортировкой ключей), `createTurnToolGuard` (вердикты `execute`/`duplicate`/`limit`, epoch ресурса по `toolRepeatTarget` для легитимного повтора после write, счётчики `executed`/`deduped`/`limit_hits`), `resolveChatMaxToolCalls` (ключ `chat_max_tool_calls`, целое 1–200, иначе дефолт 16 — терпимая валидация), `duplicateCallResult`/`limitCallResult` (JSON-контракт `{ok:false,duplicate|limit,message}` с явным следующим шагом), `CHAT_MAX_TOOL_CALLS_DEFAULT = 16`, `CHAT_MAX_TOOL_CALLS_CEILING = 200`.
- `src/web/chat.ts` — импорты; `ChatToolStats` + `recordChatToolStats`/`loadChatToolStats` (файл `<threadId>.repeat.json`, расширение `.json` — список тредов не задваивается, запись в try/catch); guard создаётся перед `executeTool` и проверяется ПЕРВОЙ строкой внутри него (единая точка ⇒ работает в обычном цикле, в resume-пути и в `advanceToNextApproval`); `noteExecuted` до `truncateToolOutput`; `toolGuard.beginTurn()` перед каждым `llm.streamChat`; `finishStats()` на путях done/error/лимитов/ошибки LLM.
- `src/web/tool-dedup.test.mjs` (новый, 22 теста), `src/web/chat.test.mjs` (+5 интеграционных тестов: 3 идентичных `read_file` → duplicate, 30 разных → 16 исполнено + 14 limit, read→write→read разрешён, конфиг 2 и мусорный конфиг, файл диагностики + список тредов).
- `templates/prompts/chat-system.md` — абзац модели о повторах/лимите/подсказке путей.
- `README.md` — подраздел «Повторы и лимит tool-вызовов (VL-255)».
**Проверки:** `pnpm build` — tsc чисто. Точечно: `npx vitest run src/web/tool-dedup.test.mjs src/web/chat.test.mjs src/web/tool-policy.test.mjs` — 79/79. Полный `pnpm test` — 106 файлов, **1939 passed, 4 skipped, 1 failed**: `src/mcp/server.test.mjs` («Tokens: jsonl fallback», assertion «фаза из меты не использована»). Падение **предсуществующее и не связано с задачей**: воспроизведено на базовом коммите 7d997e6 при откате всех моих правок (git stash), причина — env-зависимость (env фазы `VIBELOG_PHASE_NAME/SESSION_ID`); после прогона с очищенными env падение сохраняется, то есть к дедупликации отношения не имеет. Ни один затронутый diff'ом файл в падении не участвует.
**Что осталось:** предсуществующий флейк `src/mcp/server.test.mjs` (env-зависимый fallback usage из jsonl) — кандидат на отдельную задачу; ручной smoke в браузере (#/chat: трижды прочитать один файл) не выполнялся — покрыто автотестами. CHANGELOG.md по правилам фазы Code не обновлялся (пишет Close).
---
author: @agent
created: 2026-10-30 21:49
---
Фаза Close выполнена. Ветка vb/vl-255 слита в master (1 коммит: b0d5b07 «дедупликация и лимит tool-вызовов в веб-чате») влита merge-коммитом --no-ff, worktree .vibelog/worktrees/vl-255 удалена (force — внутри были только untracked-симлинки node_modules/references/data), ветка vb/vl-255 удалена, worktree prune выполнен.
**Проверки в master после merge:** `pnpm build` — tsc чисто (strict). Ранний точечный фильтр по diff'у (`src/web/tool-dedup.ts`, `src/web/chat.ts` → соседние тесты): `npx vitest run src/web/tool-dedup.test.mjs src/web/chat.test.mjs src/web/tool-policy.test.mjs` — 79/79 passed. Полный `pnpm test` — **105 файлов, 1936 passed, 4 skipped, 0 failed**. Провалившийся в фазе Code `src/mcp/server.test.mjs` («Tokens: jsonl fallback») в merge-прогоне зелёный — флейк не воспроизвёлся, регрессии нет.
**DoD:** 1) Тесты проходят — полный прогон зелёный; 2) Документация обновлена — README (подраздел «Повторы и лимит tool-вызовов»), templates/prompts/chat-system.md, CHANGELOG.md (запись VL-255 в Unreleased); 3) Нет регрессий — полный прогон без падений.
**Lessons:** lesson-119 «Дедуп tool-вызовов считай «ход = один POST» с epoch ресурса, а лимит — на ответ модели, а не на запрос» (создан, связан с VL-255).
**Коммиты в главном репо:** 1835c50 — lesson-119; 83403a1 — CHANGELOG.md. Ручной smoke в браузере (#/chat, трижды прочитать один файл) не выполнялся — поведение покрыто интеграционными тестами chat.test.mjs.
---
<!-- COMMENTS:END -->