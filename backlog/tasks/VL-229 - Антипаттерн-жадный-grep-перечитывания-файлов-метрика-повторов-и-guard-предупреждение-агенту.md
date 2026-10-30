---
id: VL-229
title: Метрика повторов grep/чтений и guard-предупреждение агенту
status: Done
assignee:
  - '@agent'
reporter: ''
created_date: '2026-10-29 21:54'
updated_date: '2026-10-30 03:01'
due_date: ''
labels:
  - core
  - agent
  - mcp
dependencies: []
milestone: ''
references: []
priority: medium
type: enhancement
project: core
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/repeat-tracker.ts
  - src/agent/repeat-tracker.test.mjs
  - src/agent/repeat-session.test.mjs
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - src/agent/session.ts
  - src/agent/cli.ts
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - src/web/phase-prompt.test.mjs
  - templates/phases/phase-analyze.md
  - README.md
lessons:
  - lesson-91
token_usage:
  input: 11728278
  output: 115540
  cache: 11302400
  total: 11843818
  requests: 158
  duration_ms: 1793755
  reasoning: 72526
  by_phase:
    spec:
      input: 67145
      output: 1327
      cache: 56320
      requests: 3
    plan:
      input: 11661133
      output: 114213
      cache: 11246080
      requests: 155
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Разбор сессий agent-1793296657208 (VL-221) и agent-1793298710715 (VL-226) показал системный антипаттерн: агент жадно перебирает grep_search'ами (218 вызовов = 35% всех tool-вызовов в сессии VL-221, топ-10 tool-выводов — усечённые на 8 КБ grep-выдачи) и многократно перечитывает одни и те же файлы (loop.ts — 39, cli.ts — 35, prompt.md — 30, test-setup.mjs — 46 в VL-226). Это раздувает контекст, приводит к wall-убийствам (8 в VL-221) и доле «Продолжи» 62–75%. Нужны: (1) метрика повторов в статистике сессии, (2) guard-предупреждение агенту при зацикливании на одних и тех же path/pattern.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Мета/лог сессии содержит счётчики повторных обращений: топ повторяющихся (path|pattern) с числом обращений и их доля от всех tool-вызовов сессии
- [x] #2 Агент при превышении порога повторов (например, 3-й grep с тем же pattern или 5-е чтение того же файла) получает в контекст предупреждение «ты уже читал это N раз — используй ранее полученный результат»
- [x] #3 Есть тест детектора повторов на фикстуре jsonl с зацикленным grep-паттерном; отчёт /analyze автоматически показывает топ перечитываемых файлов и топ повторяющихся запросов
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan — метрика повторов + guard-предупреждение

### Решения (архитектура)

1. **Новый модуль `src/agent/repeat-tracker.ts`** (чистые функции, без fs — чтобы тестировался на массиве сообщений и на jsonl):
   - `toolRepeatTarget(name, args): string | null` — каноничный «объект повтора»:
     - `grep_search` / `glob` → `pattern` (path/glob игнорируются: AC говорит «тот же pattern»);
     - `read_file` → `path` (offset/limit игнорируются — VL-226 считал 39 чтений одного файла кусками);
     - `edit` / `write_file` → `path` (для метрики, БЕЗ guard'а — повторная правка легитимна);
     - `run_shell_command` и прочие → `null` (в метрику не идут: команда как ключ шумит).
   - `repeatKey(name, args)` → `${name}|${target}` — это и есть формат `path|pattern` из AC1.
   - `createRepeatGuard({searchLimit=3, readLimit=5})` → `{ note(name, args): string | null }`: счётчик по ключу в пределах **текущего рана** (при resume сбрасывается, см. риск 3). Предупреждение отдаётся при `count === limit` и далее на каждом вызове сверх лимита.
     Текст (маркерные подстроки обязательны — lesson-76): `Ты уже обращался к <ключ> N раз — используй ранее полученный результат (<подсказка>), не повторяй вызов.` подсказка: для grep/glob — «сузь pattern/path или читай найденный файл», для read_file — «читай нужные чанки offset/limit одним вызовом».
   - `analyzeToolRepeats(messages): RepeatStats` — по всему транскрипту: `tool_calls_total` (только `isValidToolCall`, как `countToolCallsInMessages`), `repeat_calls` (вызовы, чей ключ встречался ранее), `repeat_share` = repeat_calls / tool_calls_total, `top` — до 10 пар `{key, count}` по убыванию. Нет данных → `tool_calls_total: 0`, `top: []`.

2. **Пороги — только через `LoopLimits`, новых CLI-флагов НЕ добавляем** (lesson-18: каждый флаг надо трассировать через все слои; для AC достаточно дефолтов): `repeatSearchLimit?: number` (3), `repeatReadLimit?: number` (5), `repeatGuardDisabled?: boolean`.

3. **Точка инъекции предупреждения — loop, после ВСЕХ tool-результатов хода** (а не между ними): assistant(tool_calls) → все tool, затем одно `role: 'user'` сообщение (склеенные строки предупреждений). Так не нарушается паринг assistant↔tool, который валидирует провайдер. Кап — не более 15 предупреждений за ран (контекст не раздуваем).

4. **Метрика пишется в мету сессии** (AC1) из полного транскрипта (`loopResult.messages`), а не только текущего рана — доля считается от всех tool-вызовов сессии (включая прошлые раны resume).

5. **`/analyze` показывает топ автоматически** (AC3): `startAnalyze` синхронно считает повторы из jsonl (по образцу `sumUsageFromJsonlSync`) и подставляет готовый блок в промпт — агент не тратит ход на пересчёт.

### Файлы и конкретные места

| Файл | Место → изменение |
|---|---|
| `src/agent/repeat-tracker.ts` | **новый**: `toolRepeatTarget`, `repeatKey`, `createRepeatGuard`, `analyzeToolRepeats`, типы `RepeatStats`, `RepeatEntry`, константы `REPEAT_SEARCH_LIMIT_DEFAULT=3`, `REPEAT_READ_LIMIT_DEFAULT=5` |
| `src/agent/loop.ts` | `LoopLimits` (~стр. 35) → `repeatSearchLimit?`, `repeatReadLimit?`, `repeatGuardDisabled?`; `LoopResult` (~стр. 100) → `repeat_stats?: RepeatStats`; константы рядом с `PHANTOM_CALL_LIMIT_DEFAULT`/`INTENT_LOOP_REPEAT_DEFAULT` (стр. 177–181) → `REPEAT_WARN_MAX_PER_RUN = 15`; резолв лимитов (стр. 241–247) → создание guard'а; тела `fail()` (стр. 322–338) и успешного return (~стр. 470) → `repeat_stats: analyzeToolRepeats(messages)`; цикл `for (const call of validCalls)` (стр. 572–636) → собрать `guard.note(call.name, call.arguments ?? {})` в массив, после цикла — один `pushMessage({role:'user', content: warnings.join('\n')})` (до/рядом с phantom-замечанием стр. 638). Плюс диагностика `console.error` в точке срабатывания (lesson-77) |
| `src/agent/session.ts` | `SessionMeta` (стр. 126–164) → `repeat_stats?: RepeatStats`; рядом с `sumUsageFromJsonlSync` (стр. 387) → `analyzeToolRepeatsFromJsonlSync(dir, sessionId): RepeatStats \| null` (битые строки пропускаются, нет файла → null — те же контракты, что у usage-версии) |
| `src/agent/cli.ts` | post-run блок после `saveSession` (~стр. 657): `const repeats = analyzeToolRepeats(loopResult.messages)` → в `updateSessionMeta` (стр. 729–746) добавить `repeat_stats: repeats`; в итоговую stderr-диагностику (стр. 757–762) добавить `повторов=${repeat_calls}/${tool_calls_total} (${pct}%), топ: ${top.slice(0,3).map(...)}` |
| `src/web/orchestrator.ts` | `startAnalyze` (стр. 528–556): `analyzeToolRepeatsFromJsonlSync(agentSessionsDir(cwd), bare)` → подстановки `repeatTop` (готовый markdown-список топ-10 с count/долей либо «(нет данных)») и `repeatSummary` (одна строка tool_calls_total/repeat_calls/share). `sys`-падение расчёта не должно ронять запуск — try/catch → «(нет данных)» |
| `templates/phases/phase-analyze.md` | после строки `Путь к транскрипту: {{sessionPath}}` → блок «Повторы обращений (посчитано автоматически): {{repeatSummary}} / {{repeatTop}}»; в шаг 1 (стр. 21–29) → пункт «повторы по (path\|pattern): топ-10 с числом и долей от всех tool-вызовов сессии»; в шаг 2 → требование назвать топ перечитываемых файлов и топ повторяющихся запросов в вердикте |
| `src/agent/repeat-tracker.test.mjs` | **новый** (AC3): фикстура jsonl в `mkdtemp` с зацикленным `grep_search`-pattern (тот же pattern 12 раз из 30 вызовов) → `analyzeToolRepeats` даёт `top[0].count===12`, `repeat_share` ≈ 0.37; отдельные кейсы: guard срабатывает на 3-м grep / 5-м read_file и молчит на 2-м/4-м; phantom-вызовы (пустой name) не считаются; `run_shell_command` не попадает в топ |
| `src/agent/loop.test.mjs` | 2 теста: (а) 3 вызова `grep_search` с одинаковым pattern → после tool-результатов появляется `role='user'` сообщение с маркером «используй ранее полученный результат»; (б) `LoopResult.repeat_stats.repeat_calls > 0`, `repeat_share` в (0,1] |
| `src/agent/session.test.mjs` | meta roundtrip `repeat_stats` через `updateSessionMeta` (merge не затирает taskId/phase — lesson-40); `analyzeToolRepeatsFromJsonlSync` на фикстуре без файла → null |
| `src/web/orchestrator.test.mjs` | `startAnalyze` с фикстурной сессией → промпт содержит топ-повтор (pattern) и НЕ содержит literal `{{repeatTop}}`/`{{repeatSummary}}` |
| `src/web/phase-prompt.test.mjs` | маркерные проверки шаблона `phase-analyze.md`: есть `{{repeatTop}}` и «доля от всех tool-вызовов» |
| `README.md` | секция «Лимиты агента (vibelog-agent)» (стр. 54–62) → абзац про guard повторов (3-й grep с тем же pattern / 5-е чтение файла → предупреждение модели) и про поля `repeat_stats` в мете сессии; строку диагностики фазы дополнить `повторов=…` |
| `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` | обновить блок про guard'ы/статистику — через MCP `document_update`; если `document_view` обрезан на 8 КБ (lesson-63) — правку doc-10 переносить в фазу Close, в Code только README |

### Порядок действий

1. `src/agent/repeat-tracker.ts` + `src/agent/repeat-tracker.test.mjs` (чистые функции → тест сразу, TDD-порядок).
2. `session.ts`: `repeat_stats` в `SessionMeta` + `analyzeToolRepeatsFromJsonlSync` + тесты в `session.test.mjs`.
3. `loop.ts`: лимиты, guard, инъекция предупреждения, `repeat_stats` в обоих return-путях + тесты в `loop.test.mjs`.
4. `cli.ts`: запись `repeat_stats` в мету + строка диагностики.
5. `orchestrator.ts` `startAnalyze` + `templates/phases/phase-analyze.md` (AC3) + тесты orchestrator/phase-prompt.
6. `README.md` (и doc-10 через `document_update`, если объём позволяет).

### Как проверить

```bash
pnpm build && pnpm test:fast          # быстрый цикл (dist уже собран)
pnpm test                             # полный: build + vitest run
node scripts/npm-smoke.mjs            # при изменении шаблонов/упаковки (AC: шаблон правится)
```
Ручная проверка guard'а: `node bin/vibelog.mjs agent` с локальным mock-LLM в тесте уже покрывает; живой автотест из `loop.test.mjs` — основной. Проверка меты: после `pnpm test` — в тесте cli читать `.meta.json` и искать `repeat_stats`.

### Риски

1. **Инъекция user-сообщений в транскрипт** — ломает паринг assistant↔tool, если вставить предупреждение между tool-результатами. Митигация: одно сообщение строго после цикла tool-результатов хода; тест на валидность порядка сообщений в `loop.test.mjs`.
2. **Ложные срабатывания** на легитимном чтении файла кусками (VL-235-подобные задачи) — митигация: порог read = 5, edit/write вне guard'а, текст предупреждения нейтральный («используй ранее полученный результат»).
3. **Resume**: guard-стейт сбрасывается каждый ран (счёт с нуля) — иначе при resume модель получала бы предупреждение за действия прошлого рана. Метрика при этом считается по всей сессии — асимметрия осознанная, документируется в JSDoc.
4. **Раздувание контекста предупреждениями** — кап 15/ран, текст ≤250 символов.
5. **qwen-сессии** не имеют нашего jsonl → `repeat_stats` в мете отсутствует, `/analyze` для них не вызывается (существующий guard `startAnalyze` пропускает qwen-UUID) — регрессии нет.
6. **Старые jsonl без tool_calls/с фантомами** → `analyzeToolRepeats` фильтрует `isValidToolCall`, битые строки пропускаются в sync-версии; иначе `/analyze` падал бы на старых сессиях.
7. **`repeat_share` при `tool_calls_total === 0`** — деление на ноль: возвращаем `0` (тест на пустом транскрипте).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 01:16
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Метрика повторов grep/чтений и guard-предупреждение агенту» (был длиннее 80 символов). Тип: enhancement. Масштаб: task. Приоритет: Medium. Уточнено: проблема и контекст описаны полно (данные сессий VL-221/VL-226), AC переформулированы в 3 проверяемых пункта — счётчики повторов в мете/логе сессии с долей от tool-вызовов, guard-предупреждение агенту при превышении порога (3-й grep с тем же pattern / 5-е чтение файла), тест детектора на фикстуре jsonl и вывод топа перечитываемых файлов/запросов в /analyze. Labels: core, agent, mcp. References: нет (внешних источников в постановке не упомянуто). Вопросов нет.
---
author: @agent
created: 2026-10-30 01:22
---
Фаза 2 (Plan) выполнена. Тип: enhancement (обычная задача, не epic) — план записан в саму задачу.
Архитектура: новый модуль `src/agent/repeat-tracker.ts` с чистыми функциями — `toolRepeatTarget`/`repeatKey` (ключ `name|target`: grep/glob → pattern, read_file/edit/write_file → path, shell → в метрику не идёт), `createRepeatGuard` (пороги 3 для grep-поиска, 5 для чтения файла), `analyzeToolRepeats` (tool_calls_total / repeat_calls / repeat_share + топ-10). Guard-предупреждение инжектится в loop ОДНИМ `role:'user'` сообщением после всех tool-результатов хода — иначе ломается паринг assistant↔tool. Метрика пишется в `SessionMeta.repeat_stats` из полного транскрипта (доля от всех tool-вызовов сессии, включая прошлые раны), `/analyze` получает топ автоматически через `analyzeToolRepeatsFromJsonlSync` + новые подстановки `{{repeatTop}}`/`{{repeatSummary}}` в `templates/phases/phase-analyze.md`. Новых CLI-флагов нет (пороги только через `LoopLimits`) — lesson-18.
Файлов в плане: 13 (1 новый модуль, 1 новый тест-файл, 4 изменяемых src, шаблон фазы, 3 теста, README, doc-10 через document_update с оговоркой lesson-63). Все пути проверены `ls`.
Порядок: repeat-tracker + тест → session.ts (мета/sync-парсер) → loop.ts (guard + repeat_stats) → cli.ts (запись меты + строка диагностики) → orchestrator + шаблон фазы (AC3) → README/doc-10.
Проверка: `pnpm build && pnpm test:fast`, затем `pnpm test`, `node scripts/npm-smoke.mjs` (правится шаблон).
Риски (7): инъекция user-сообщения и паринг assistant↔tool (митигация — одно сообщение строго после цикла tool-результатов + тест порядка сообщений); ложные срабатывания на чанковом чтении (порог 5, edit/write вне guard'а); асимметрия resume (guard-стейт сбрасывается на ран, метрика — по всей сессии); раздувание контекста (кап 15 предупреждений/ран, текст ≤250 символов); qwen-сессии без нашего jsonl (регрессии нет — существующий guard startAnalyze); старые jsonl с фантомами (фильтр isValidToolCall); деление на ноль в repeat_share при 0 tool-calls.
---
author: @agent
created: 2026-10-30 01:42
---
Фаза code не удалась (код выхода 1): а — VL-221), payload последнего запроса=478928 байт (макс 478928), usage={"input_tokens":6911100,"output_tokens":29007,"cache_read_input_tokens":6777344,"total_tokens":6940107,"reasoning_tokens":4381} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-30 02:01
---
Фаза 3 (Code) выполнена по плану. Коммит 96bfbc8 (ветка vb/vl-229), 12 файлов, +885/−2.
Реализовано:
- `src/agent/repeat-tracker.ts` (новый) — `toolRepeatTarget`/`toolRepeatKind`/`repeatKey` (ключ `<инструмент>|<path|pattern>`: grep_search/glob → pattern, read_file/edit/write_file → path, shell и прочие → не отслеживаются), `createRepeatGuard` (пороги 3 поиск / 5 чтение, edit/write только в метрике), `analyzeToolRepeats` + типы `RepeatStats`/`RepeatEntry`, `emptyRepeatStats`.
- `src/agent/loop.ts`: `LoopLimits.repeatSearchLimit/repeatReadLimit/repeatGuardDisabled`, `LoopResult.repeat_stats` (в обоих return-путях, включая fail), кап `REPEAT_WARN_MAX_PER_RUN = 15`, предупреждения собираются за ход и уходят МОДЕЛИ одним `role:'user'` сообщением ПОСЛЕ всех tool-результатов (паринг assistant↔tool не нарушается), диагностика `console.error` в точке срабатывания (lesson-77).
- `src/agent/session.ts`: `SessionMeta.repeat_stats` + `analyzeToolRepeatsFromJsonlSync` (битые строки пропускаются, нет файла → null).
- `src/agent/cli.ts`: post-run записывает `repeat_stats` в мету; в stderr-диагностику добавлено `повторов=N/M (P%), топ-повторов=…`.
- `src/web/orchestrator.ts` + `templates/phases/phase-analyze.md`: `/analyze` автоматически подставляет `{{repeatSummary}}`/`{{repeatTop}}` (топ-10 с числом обращений и долей от всех tool-вызовов), вердикт обязан называть топ перечитываемых файлов и запросов; расчёт в try/catch → «нет данных» не роняет запуск.
- README: секция «Лимиты агента» дополнена описанием guard'а повторов и метрики `repeat_stats`.
- Тесты: новый `src/agent/repeat-tracker.test.mjs` (18, включая AC3-фикстуру с зацикленным grep-паттерном 12 из 30 → top=12, share=0.3667), новый `src/agent/repeat-session.test.mjs` (4: мета-roundtrip, jsonl-фикстура, битая строка, нет файла), +6 в `loop.test.mjs` (порог 3/5, disabled, repeat_stats на успехе и fail, паринг), orchestrator (промпт с топом, без литералов `{{repeatTop}}`), phase-prompt (маркеры шаблона).
Проверки (полный прогон, без --exclude/--skip): `pnpm build` — ok; `npx vitest run --no-file-parallelism` — 88 файлов, 1617 тестов passed, 4 skipped (0 failed); `node scripts/npm-smoke.mjs` — 27/27 PASS.
Примечание: первый `pnpm test` дал падения `search-cli`/`config-cli`/`create-flags` — флейки окружения (таймаут CLI-спавна и `uv_cwd ENOENT` при удалении cwd в параллельном прогоне); после `--no-file-parallelism` полный прогон зелёный, каждый из этих файлов проходит и по отдельности.
AC1/AC2/AC3 и DoD 1–3 выполнены. dot-10 (backlog/docs/doc-10) не правил — по правилам фазы Code документация в backlog/docs пишется на Close (lesson-63); улик для новых lesson не возникло.
---
author: @agent
created: 2026-10-30 03:01
---
Фаза Close выполнена. Ветка vb/vl-229 (1 коммит, 96bfbc8) слита в master через --no-ff (merge-коммит), конфликтов не было. После merge в главном репо: `pnpm build` — ok; `pnpm test` — 87 файлов, 1621 passed, 4 skipped, 0 failed (плюс отдельный прогон static.test.mjs — 7 passed). Worktree .vibelog/worktrees/vl-229 удалена (потребовался --force: в каталоге оставались только артефакты сборки dist/ и симлинк node_modules на главный репо — данные не теряются), ветка vb/vl-229 удалена (git branch -d). DoD 1–3 выполнены и подтверждены полным прогоном: тесты проходят, документация обновлена (README — секция «Лимиты агента» в коммите ветки, CHANGELOG.md — запись Unreleased в docs-коммите c7de8ae), регрессий нет. Учтите: doc-10 (backlog/docs) не правился — файл 64 КБ, MCP document_view/document_update усечены на 8 КБ (lesson-63), объёмная правка перенесена; нюанс зафиксирован в lesson-91/отчёте. Lessons: создан lesson-91 (предупреждение модели — одним user-сообщением после всех tool-результатов хода, guard-счётчик в пределах рана), связан с задачей; knowledge-коммит 2ab9741.
---
<!-- COMMENTS:END -->