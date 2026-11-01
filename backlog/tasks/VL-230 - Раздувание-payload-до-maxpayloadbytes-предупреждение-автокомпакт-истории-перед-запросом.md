---
id: VL-230
title: 'Раздувание payload до max_payload_bytes: предупреждение + автокомпакт истории перед запросом'
status: Done
assignee:
  - '@agent'
reporter: ''
created_date: '2026-10-29 21:54'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - core
  - agent
dependencies: []
milestone: v1.11
references: []
priority: high
type: enhancement
project: core
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/llm.ts
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - CHANGELOG.md
  - backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md
  - backlog/lessons/lesson-87-Грязный-worktree-с-M-файлами-чужой-задачи-не-коммить-и-не-удаляй-force-сверь-блобы-с-master-и-отметь-в-отчёте.md
lessons:
  - lesson-87
token_usage:
  input: 6953340
  output: 145939
  cache: 6442816
  total: 7099279
  requests: 148
  duration_ms: 267968
  reasoning: 23288
  by_phase:
    spec:
      input: 69642
      output: 435
      cache: 59584
      requests: 3
    plan:
      input: 1295123
      output: 76512
      cache: 1119488
      requests: 15
    prompt:
      input: 353414
      output: 5643
      cache: 304512
      requests: 8
    code:
      input: 5235161
      output: 63349
      cache: 4959232
      requests: 122
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Сессии VL-221 (agent-1793296657208: last_payload=894265=max, фаза plan прервана) и VL-226 (agent-1793298710715: payload=644142=max, фаза code упала, статус вернулся к Planned) упёрлись в байтовый лимит провайдера — история целиком (включая усечённые на 8 КБ tool-выводы всех предыдущих ходов) передаётся в каждый запрос. VL-178/199/217 закрывают только автоповтор при отказе, но не рост payload. Нужен механизм: предупреждение о приближении к лимиту + автокомпакт истории (схлопывание старых tool-выводов в краткие итоги) перед отправкой. Иначе любая длинная фаза детерминированно умирает на лимите байт.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 При payload > порога (например 70% от max) в лог и stderr пишется предупреждение с текущими байтами
- [x] #2 Перед отправкой запроса с payload > порога история автоматически компактизируется: усекаются/схлопываются старые tool-выводы (оставить только итог), не трогая AC/план текущей задачи
- [x] #3 После компактизации фаза продолжает работать, а не падает с «payload=max» и не откатывается к Planned
- [x] #4 Тест: фикстура с историей ~900 КБ проходит компактизацию до < лимита
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan: предупреждение + автокомпакт по байтовому лимиту payload (VL-230)

### Контекст (что уже есть)
- `src/agent/llm.ts`: wire-body сериализуется в одной точке до fetch (`requestWithRetry`), closure `lastRequestBytes`; `shrinkMessages(messages, maxToolChars)` (строка ~804) усекает tool-выводы с сохранением парности tool_calls↔tool.
- `src/agent/loop.ts`: перед запросом собирается `payload = sanitizeWireMessages(compactWireMessages(messages, compactFrom))` (~строка 319); после ответа `lastPayload/maxPayload` обновляются (~335); токеновый компакшн VL-122 (якорь compactFrom) работает по usage, а НЕ по байтам.
- `src/agent/llm.ts` / `loop.ts` не знают жёсткий лимит байт провайдера (max_payload_bytes ~894 КБ в инцидентах VL-221/226).

### Константы и лимит
1. `src/agent/llm.ts` (рядом с HIGH_RISK_MAX_SHRINKS ~строка 795):
   - `export const MAX_PAYLOAD_BYTES = 900_000;` — жёсткий лимит провайдера (по инцидентам ~894КБ → 900КБ округление вверх).
   - `export const PAYLOAD_WARN_RATIO = 0.7;` — порог предупреждения/компакта = 70% от MAX_PAYLOAD_BYTES = 630_000 байт.
   - `export const PAYLOAD_WARN_BYTES = Math.floor(MAX_PAYLOAD_BYTES * PAYLOAD_WARN_RATIO);`
   - `export const PAYLOAD_COMPACT_TOOL_CHARS = 2048;` — уровень автокомпакта tool-выводов (между L1=4096 shrink-повторов и жёстким 1024).

2. `src/agent/loop.ts` (в `LoopLimits` ~строка 47):
   - `maxPayloadBytes?: number` — override лимита (для тестов; дефолт MAX_PAYLOAD_BYTES).
   - `payloadWarnBytes?: number` — override порога (для тестов; дефолт 70%).

### Автокомпакт перед запросом (loop.ts)
3. В начале итерации цикла, ДО сборки payload (~после проверки maxRequests, ~строка 300):
   - Собрать предварительную копию: `const wire = sanitizeWireMessages(compactFrom !== null ? compactWireMessages(messages, compactFrom) : messages);`
   - `const wireBytes = Buffer.byteLength(JSON.stringify(wire), 'utf8');` — оценка байт (точные байты считает llm-клиент, но порядок тот же; JSON.stringify — недорогой, альтернатива — считать только tool-контенты, но AC требует «текущие байты» → берём JSON.stringify, это одна точка до fetch как в lesson-64).
   - Если `wireBytes >= payloadWarnBytes`:
     a) **Предупреждение (AC1)**: `console.error(`[vibelog-agent] предупреждение payload: ${wireBytes} байт >= порог ${payloadWarnBytes} (70% от лимита ${maxPayloadBytes}) — история компактизируется перед запросом`);` — stderr → logTail оркестратора (lesson-77: диагностика в точке срабатывания).
     b) **Автокомпакт (AC2)**: пропустить `compactWireMessages`-якорь, вместо этого применить к предварительной копии `shrinkMessages(wire, PAYLOAD_COMPACT_TOOL_CHARS)` — tool-выводы старше текущего хода усекаются до 2048 символов с маркером. НЕ мутировать `messages`/jsonl; AC/план текущей задачи (system/user/assistant-тексты) не трогаем — shrinkMessages трогает только role==='tool'.
   - Если после shrink байты всё ещё >= лимита — эскалация: дополнительно применить `shrinkMessages(wire, 1024)` (уровень L2).
   - Готовый `wire` (или исходный `payload`) уходит в `options.llm.streamChat(...)`.
4. Порядок: сначала оценка байт ПРЕДВАРИТЕЛЬНОЙ копии → предупреждение + компакт → отправка. Существующий токеновый компакшн (compactFrom) остаётся как есть — они дополняют друг друга (байтовый триггер срабатывает раньше токенового при больших tool-выводах).

### Диагностика (AC1 полное)
5. `src/agent/cli.ts` (~строка 729, итоговая stderr-строка фазы): в текст добавить `payload_warn_bytes=...` не нужно — предупреждение уже ушло в logTail точечно (строка 3 выше). Дополнительно в JSONL-мету (`src/agent/session.ts`, SessionMeta ~строка 161) — НЕ менять (last/max_payload_bytes уже есть).

### Тесты (AC4)
6. `src/agent/loop.test.mjs`:
   - **AC4**: фикстура истории ~900 КБ (например 40 tool-сообщений по 20 КБ): первый ответ fakeLlm возвращает `payloadBytes: 950_000` (>лимита) с tool_calls → следующая итерация: stderr содержит предупреждение `payload: ... байт >= порог`, payload второго запроса (после компакта, проверить через перехват аргумента streamChat) < MAX_PAYLOAD_BYTES; фаза завершается успешно (is_error=false, AC3 — нет fail «payload=max» и отката).
   - **AC1**: при payload < порога предупреждения НЕТ (негатив).
   - **AC2**: в компактизированном wire все tool-сообщения длиннее 2048 символов усечены, assistant/system/user сообщения побайтово идентичны исходным (AC/план не тронуты); `messages` (jsonl-источник) не изменился.
   - Регрессия: существующие тесты VL-122 (токеновый компакшн) и VL-203 (payloadBytes) проходят без изменений.
7. `src/agent/llm.test.mjs` — НЕ трогаем (изменений в llm.ts только экспорт констант, поведение клиента не меняется).

### Документация (DoD)
8. `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` (§6, после пункта VL-203 ~строка 310) — добавить пункт про байтовый автокомпакт: порог 70% от 900КБ, предупреждение в stderr→logTail, shrink tool-выводов до 2048/1024 символов на wire-границе без мутации jsonl. Править ТОЛЬКО через MCP `document_update`.
9. `CHANGELOG.md` — новая запись VL-230 в стиле VL-178/203.

### Порядок действий
1. Константы в `src/agent/llm.ts` (экспорт, без изменения поведения).
2. `LoopLimits` + байтовая оценка/предупреждение/автокомпакт в `src/agent/loop.ts`.
3. Тесты в `src/agent/loop.test.mjs` (AC1-AC4).
4. `pnpm build && pnpm test`.
5. Документация: doc-10 через MCP document_update, CHANGELOG.md.
6. Коммит: `feat(agent): автокомпакт истории по байтовому лимиту payload (VL-230)`.

### Проверка
```bash
pnpm build && pnpm test
```
Ожидание: все тесты зелёные, в loop.test.mjs +4 новых теста.

### Риски
- **Оценка байт vs фактические**: JSON.stringify(wire) до stream_options может отличаться от фактического wire-body на сотни байт — приемлемо (порог с запасом 70%<100%); ложное предупреждение не критично, ложный компакт — тоже (усечение обратимо в jsonl, который не мутируется).
- **Совместимость с VL-122**: байтовый триггер может срабатывать при активном токеновом якоре compactFrom — оба усечения применяются последовательно к wire-копии, конфликт невозможен (оба не мутируют messages).
- **--no-compact**: байтовый автокомпакт — защита от падения фазы, должен работать и при `compactDisabled` (это НЕ токеновый компакшн VL-122); флаг `--no-compact` его НЕ выключает — зафиксировать в комментарии.
- **Мелкий риск перфоманса**: JSON.stringify оценка на каждой итерации (~250КБ → <1мс) — приемлемо.
- **Порог 70%**: если провайдер начнёт отклонять раньше — константа в одном месте, правится одной строкой.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-29 21:55
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Тип: enhancement. Масштаб: task. Приоритет: High. Уточнено: AC дополнены требованием предупреждения с текущими байтами и лимитом, уточнён порог 70% от max_payload_bytes, зафиксировано, что компактизация не затрагивает AC/план текущей задачи, тест дополнен проверкой прохождения запроса после компактизации. Labels: core, agent. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-29 21:55
---
Фаза plan не удалась (код выхода 1): ] фаза: запросов=6, payload последнего запроса=254479 байт (макс 254479), usage={"input_tokens":222704,"output_tokens":2739,"cache_read_input_tokens":177728,"total_tokens":225443,"reasoning_tokens":0} — статус возвращён к Spec.
---
author: @agent
created: 2026-10-29 21:56
---
Фаза 2 (Plan) выполнена. Тип: enhancement. План записан в задачу: 5 файлов для изменения — src/agent/llm.ts (константы MAX_PAYLOAD_BYTES=900_000, порог 70% = 630_000 байт, уровень компакта 2048 симв.), src/agent/loop.ts (LoopLimits += maxPayloadBytes/payloadWarnBytes; байтовая оценка wire-копии JSON.stringify ДО запроса: при >= порога — console.error-предупреждение с текущими байтами и лимитом (AC1) + автокомпакт через shrinkMessages до 2048, эскалация до 1024 (AC2), без мутации messages/jsonl и без трогания AC/плана — трогаются только role=tool), src/agent/loop.test.mjs (+4 теста: AC4-фикстура ~900КБ → компакт < лимита и фаза успешна (AC3), негатив без предупреждения, побайтовая идентичность не-tool сообщений, регрессия VL-122/203), doc-10 §6 через MCP document_update, CHANGELOG.md. Существующий токеновый компакшн VL-122 остаётся — байтовый триггер дополняет его (срабатывает раньше при больших tool-выводах); --no-compact байтовый автокомпакт не выключает (защита от падения фазы). Риски: оценка байт может отличаться от фактического wire-body на сотни байт (приемлемо при пороге 70%), перфоманс JSON.stringify на итерации <1мс, порог — одна константа при изменении лимитов провайдера. Проверка: pnpm build && pnpm test.
---
author: @agent
created: 2026-10-29 21:58
---
Фаза code не удалась (код выхода 1):  фаза: запросов=4, payload последнего запроса=417644 байт (макс 417644), usage={"input_tokens":359529,"output_tokens":44291,"cache_read_input_tokens":325824,"total_tokens":403820,"reasoning_tokens":0} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-29 23:42
---
Фаза 3 (Code) выполнена. Коммит c20bce8 «feat: VL-230 — предупреждение и автокомпакт истории по байтовому лимиту payload».
Что сделано:
- `src/agent/llm.ts`: экспортированы константы `MAX_PAYLOAD_BYTES=900_000`, `PAYLOAD_WARN_RATIO=0.7`, `PAYLOAD_WARN_BYTES=630_000`, `PAYLOAD_COMPACT_TOOL_CHARS=2048`, `PAYLOAD_COMPACT_TOOL_CHARS_ESCALATED=1024` (поведение клиента не менялось).
- `src/agent/loop.ts`: в `LoopLimits` добавлены `maxPayloadBytes`/`payloadWarnBytes` (override для тестов); перед `streamChat` байтовая оценка wire-копии (`JSON.stringify` — одна точка сериализации до fetch): при >= 70% от лимита → `console.error` предупреждение с фактическими байтами (попадает в logTail) и `shrinkMessages(wire, 2048)`, эскалация до 1024 если после усечения всё ещё >= жёсткого лимита. `messages`/jsonl НЕ мутируются, трогаются только role='tool' — AC/план задачи (system/user/assistant) не затрагиваются. Порог по умолчанию = `Math.floor(maxPayloadBytes * PAYLOAD_WARN_RATIO)` (override лимита в тестах пересчитывает и порог). Байтовый автокомпакт работает и при `--no-compact` (защита от отказа провайдера, зафиксировано в комментариях).
- `src/agent/loop.test.mjs`: +3 теста (AC4/AC3 фикстура ~900 КБ → предупреждение + компакт + успешное завершение; AC1 негатив при малом payload; AC2 — tool-выводы усечены с маркером, парность 45 tool-сообщений сохранена, не-tool сообщения побайтово идентичны, `messages` не мутированы).
Проверки: `pnpm build` — OK; `npx vitest run src/agent/` — 10 файлов / все зелёные (loop.test.mjs 66 тестов, llm.test.mjs без изменений). Полный `npx vitest run` даёт 8 упавших файлов в src/cli/* (config/create-flags/draft/init-mcp/model/batch-checklist/search) — эти падения воспроизводятся на baseline (проверено stash'ем изменений VL-230 и повторной сборкой: состав падающих файлов тот же, причина — «ENOENT uv_cwd»/недоступный git config в окружении, не связана с изменённым кодом).
Что осталось (Фаза Close): пункт про байтовый автокомпакт в `backlog/docs/doc-10-…` и запись VL-230 в CHANGELOG.md — по правилам фаз документация пишется на Close. Документация (DoD 2) поэтому не отмечена.
---
author: @agent
created: 2026-10-30 01:10
---
Фаза close не удалась (код выхода 1):  — VL-221), payload последнего запроса=297834 байт (макс 297834), usage={"input_tokens":3661834,"output_tokens":30951,"cache_read_input_tokens":3511552,"total_tokens":3692785,"reasoning_tokens":23721} — статус возвращён к Review.
---
author: @agent
created: 2026-10-30 01:11
---
Фаза Close выполнена. Ветка vb/vl-230 слита в master (merge d92cc15, 1 коммит ветки: c20bce8), worktree удалить НЕ удалось, ветка vb/vl-230 осталась — см. ниже.
Что сделано:
- `git merge --no-ff vb/vl-230` — без конфликтов (3 файла: src/agent/llm.ts, src/agent/loop.ts, src/agent/loop.test.mjs).
- Проверка главного репо: `pnpm build` — OK; `npx vitest run` — 85 файлов зелёные, 1 файл (`src/agent/llm.test.mjs`) с 24 падениями. Это известная локальная проблема окружения (lesson-78/84/86): `models.default` в `.vibelog/settings.json` имеет `api_mode: responses`, поэтому мок-тесты клиента уходят на `/responses` вместо `/chat/completions`. Ветка этот файл не меняла (git diff fc259e6..HEAD по нему пуст), при прогоне из каталога без settings.json — 52/52 зелёные. 1564 теста прошли, 4 skipped.
- Целевой файл задачи `src/agent/loop.test.mjs` — 70/70 зелёные (включая +3 теста VL-230).
- DoD 2 (документация) закрыт: CHANGELOG.md — запись VL-230 в Unreleased/Добавлено; doc-10 §6.2 — пункт «Байтовый автокомпакт истории (VL-230)» (порог 70% от 900 КБ, предупреждение в stderr→logTail, shrink tool-выводов до 2048/1024 на wire-границе без мутации jsonl, работа при `--no-compact`). Диф — только вставки (+3 строки, удалений 0). Коммит документации: d9f071c.
- Lessons: создан lesson-87 (грязный worktree с M-файлами чужой задачи не коммить и не удалять force — сверять блобы с master), связан с задачей; коммит 8c98e16.
Невыполненное / замечания:
- **worktree не удалён**: `.vibelog/worktrees/vl-230` содержит `M src/test-setup.mjs`, `M src/core/no-network.test.mjs` (правки задачи VL-226, не VL-230) + untracked `node_modules`, `backlog/references/data`. Не удалял --force: правило разрешает force только для untracked-симлинков. Проверено, что данные не теряются: блобы этих файлов (`git hash-object`) не встречаются ни в одной ветке, а `git -C .vibelog/worktrees/vl-230 diff master` по ним показывает только удаления относительно master (там лежит устаревшая версия; в master те же файлы полнее — есть оба теста spawn-guard и сканирование командной строки exec из VL-226).
- **ветка vb/vl-230 не удалена**: `git branch -d` отказался — «checked out at .vibelog/worktrees/vl-230» (следствие неудалённого worktree).
- Требуется ручное действие: `git worktree remove --force .vibelog/worktrees/vl-230 && git branch -d vb/vl-230` (после проверки, что правки VL-226 в перечисленных файлах действительно не нужны — их содержимое уже в master).
---
<!-- COMMENTS:END -->