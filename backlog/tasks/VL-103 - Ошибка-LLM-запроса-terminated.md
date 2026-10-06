---
id: VL-103
title: 'Ошибка LLM-запроса: terminated'
status: Planned
assignee: []
reporter: ''
created_date: '2026-10-06 11:16'
updated_date: '2026-10-06 11:42'
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
Ошибка LLM-запроса: terminated

При выполнении фазы над задачей VL-100 выполнение завершилось ошибкой: Ошибка LLM-запроса: terminated

Лог консоли:
[phase VL-100] 02:47:05 err| [vibelog-agent] фаза=(готовый промпт) задача=- headless=true
[phase VL-100] 02:47:05 err| [vibelog-agent] MCP: подключено инструментов — 21
[phase VL-100] 02:47:05 err| [vibelog-agent] Системный промпт: 8446 символов (AGENTS.md: да)
[phase VL-101] 02:47:08 err| [vibelog-agent] инструмент: run_shell_command
[phase VL-100] 02:47:11 err| [vibelog-agent] инструмент: backlog_view_task
[phase VL-100] 02:47:14 err| [vibelog-agent] инструмент: run_shell_command
[phase VL-101] 02:47:28 err| [vibelog-agent] инструмент: run_shell_command
[phase VL-100] 02:47:28 err| [vibelog-agent] инструмент: write_file
[phase VL-100] 02:47:33 err| [vibelog-agent] инструмент: run_shell_command
[phase VL-100] 02:47:38 err| [vibelog-agent] инструмент: run_shell_command
[phase VL-100] 02:47:50 err| [vibelog-agent] инструмент: write_file
[phase VL-100] 02:47:54 err| [vibelog-agent] инструмент: run_shell_command
[phase VL-100] 02:48:00 err| [vibelog-agent] инструмент: run_shell_command
[phase VL-101] 02:48:03 err| [vibelog-agent] инструмент: write_file
[phase VL-100] 02:48:04 err| [vibelog-agent] инструмент: run_shell_command
[phase VL-101] 02:48:08 err| [vibelog-agent] инструмент: edit
[phase VL-100] 02:48:13 err| [vibelog-agent] инструмент: run_shell_command
[phase VL-101] 02:48:13 err| [vibelog-agent] инструмент: edit
[phase VL-101] 02:48:16 err| [vibelog-agent] инструмент: run_shell_command
[phase VL-101] 02:49:52 probe(тишина 96с):
    9704  1641   0,0 S          08:00 node /Users/bob/Dev/ton/ai/Vibelog.md/bin/vibelog-agent.mjs Ты — автоматичес
    9706  9704   0,0 S          08:00 node /Users/bob/Library/pnpm/../../Dev/ton/ai/Vibelog.md/bin/vibelog.mjs mcp
[phase VL-100] 02:50:05 probe(тишина 112с):
    10102  1641   0,0 S          03:00 node /Users/bob/Dev/ton/ai/Vibelog.md/bin/vibelog-agent.mjs Ты — автоматиче
    10104 10102   0,0 S          03:00 node /Users/bob/Library/pnpm/../../Dev/ton/ai/Vibelog.md/bin/vibelog.mjs mc
[phase VL-101] 02:50:52 probe(тишина 156с):
    9704  1641   0,0 S          09:00 node /Users/bob/Dev/ton/ai/Vibelog.md/bin/vibelog-agent.mjs Ты — автоматичес
    9706  9704   0,0 S          09:00 node /Users/bob/Library/pnpm/../../Dev/ton/ai/Vibelog.md/bin/vibelog.mjs mcp
[phase VL-100] 02:51:05 probe(тишина 172с):
    10102  1641   0,0 S          04:00 node /Users/bob/Dev/ton/ai/Vibelog.md/bin/vibelog-agent.mjs Ты — автоматиче
    10104 10102   0,0 S          04:00 node /Users/bob/Library/pnpm/../../Dev/ton/ai/Vibelog.md/bin/vibelog.mjs mc
[phase VL-101] 02:51:52 probe(тишина 216с):
    9704  1641   0,0 S          10:00 node /Users/bob/Dev/ton/ai/Vibelog.md/bin/vibelog-agent.mjs Ты — автоматичес
    9706  9704   0,0 S          10:00 node /Users/bob/Library/pnpm/../../Dev/ton/ai/Vibelog.md/bin/vibelog.mjs mcp
[phase VL-100] 02:52:05 probe(тишина 232с):
    10102  1641   0,0 S          05:00 node /Users/bob/Dev/ton/ai/Vibelog.md/bin/vibelog-agent.mjs Ты — автоматиче
    10104 10102   0,0 S          05:00 node /Users/bob/Library/pnpm/../../Dev/ton/ai/Vibelog.md/bin/vibelog.mjs mc
[phase VL-101] 02:52:52 probe(тишина 276с):
    9704  1641   0,0 S          11:00 node /Users/bob/Dev/ton/ai/Vibelog.md/bin/vibelog-agent.mjs Ты — автоматичес
    9706  9704   0,0 S          11:00 node /Users/bob/Library/pnpm/../../Dev/ton/ai/Vibelog.md/bin/vibelog.mjs mcp
[phase VL-100] 02:53:05 probe(тишина 292с):
    10102  1641   0,0 S          06:00 node /Users/bob/Dev/ton/ai/Vibelog.md/bin/vibelog-agent.mjs Ты — автоматиче
    10104 10102   0,0 S          06:00 node /Users/bob/Library/pnpm/../../Dev/ton/ai/Vibelog.md/bin/vibelog.mjs mc
[phase VL-101] 02:53:30 err| [vibelog-agent] инструмент: run_shell_command
[phase VL-101] 02:53:36 err| [vibelog-agent] инструмент: run_shell_command
[phase VL-100] 02:53:38 | {"type":"result","result":"Ошибка LLM-запроса: terminated","is_error":true,"num_turns":10,"duration_ms":392797
[phase VL-100] 02:53:38 exit: code=1 signal=null
[phase VL-100] 02:53:38 close: code=1

Сессия vb агента: vb:agent-1791244025104

В сессии отсутствует последний результат. Почему? Нужно писать в jsonl сразу, а не по окончанию задачи если это так сейчас реализовано.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Причина обрыва «terminated» установлена и описана (диагностика в плане/доке задачи)
- [ ] #2 Обрыв LLM-запроса переживается: ретраи стрима + фолбэк non-stream; при исчерпании — понятная русская ошибка с диагностикой вместо сырого «terminated»
- [ ] #3 Сессия .jsonl дописывается инкрементально (сообщения по мере выполнения фазы), тест подтверждает содержимое файла до завершения фазы
- [ ] #4 Тесты обрыва LLM-запроса в llm/loop/session/cli.test.mjs; pnpm test без регрессий; docs/agent.md обновлён
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Диагностика (первопричины установлены по коду)

**Симптом 1 — «Ошибка LLM-запроса: terminated».**
`loop.ts:155` превращает любую ошибку `streamChat` в `Ошибка LLM-запроса: <message>`. Сообщение `terminated` — это TypeError от undici: сервер закрыл соединение до конца ответа. В `llm.ts` ретраи (`requestWithRetry`, строки 382–419) покрывают **только** ошибки на этапе `fetchImpl()` (установка соединения/заголовки). Чтение тела SSE в `parseSse` (`reader.read()`, строка 300) выполняется уже ПОСЛЕ `requestWithRetry` (вызов `parseSse(streamRes, ...)` на строке 436) — обрыв во время чтения потока не ретраится и не уходит в non-stream фолбэк (фолбэк строки 438–451 срабатывает только при `!streamRes.ok`). Доказательство, что ошибка именно из чтения потока, а не из fetch: итоговое сообщение — голое `terminated` без префикса `Сетевая ошибка при запросе к LLM после N попыток` (строка 409), который requestWithRetry добавил бы.

**Симптом 2 — в jsonl сессии нет последнего результата.**
Две независимые причины:
1. `fail()` в `loop.ts:128–143` возвращает `messages` как есть: текст ошибки/результата идёт в поле `result`, но **не дописывается** assistant-сообщением в `messages` → транскрипт обрывается на tool-сообщении; в jsonl нет финального результата, а `--resume` после ошибки сломан (LLM API отклонит историю, оканчивающуюся tool-сообщением — это прямо предупреждено в комментарии `loop.ts:164–167`).
2. `saveSession` (`cli.ts:387`) вызывается **только после** завершения loop. При убийстве процесса (SIGKILL/таймаут оркестратора/падение до строки 387) jsonl не создаётся/не обновляется вовсе. Требование пользователя — писать инкрементально.

## Изменения по файлам

### 1. src/agent/llm.ts — ретраи обрыва стрима + диагностика
- Строки 423–452 (`streamChat`): обернуть «стриминг-попытку» (requestWithRetry(true) + parseSse) в цикл ретраев (тот же `maxRetries`/`retryDelayMsFor`, что у requestWithRetry):
  - Новый helper `isRetryableStreamError(err)` рядом с `isRetryableStatus` (строка 171): message/cause матчат /terminated|fetch failed|ECONNRESET|EPIPE|premature close|UND_ERR|socket hang up/i; abort (`Операция прервана`, `signal.aborted`) — НЕ ретраить.
  - После исчерпания ретраев стрима — существующий non-stream фолбэк (строки 438–451), и он тоже в пределах цикла: если и он упал retryable-ошибкой —继续 ретраи, затем ошибка.
  - Финальная ошибка (вместо голого `terminated`): `Сетевая ошибка LLM (обрыв соединения: terminated) после N попыток и non-stream фолбэка: <детали>` — русский текст, счётчик попыток, упоминание diagnostics.
  - Решение по дублям токенов: на ретраях после первой попытки `onToken` передаётся с suppress (не вызывать), чтобы TUI не показывал задублированный частичный текст; авторитетен `response.text` финальной успешной попытки. Зафиксировать в комментарии.
  - requestWithRetry свои ретраи сохраняет (не трогаем строки 382–419) — худший случай множение попыток приемлем (3×3), задокументировать.
- Обновить шапочный JSDoc файла (строки 6–12) — описать новое поведение ретраев стрима.

### 2. src/agent/loop.ts — финальный assistant в messages + хук инкрементальной записи
- `fail()` (строки 128–143): перед возвратом `messages.push({ role: 'assistant', content: итоговый result-текст })` — транскрипт всегда заканчивается assistant-сообщением (чинит jsonl-симптом 2.1 и resume после ошибки).
- `RunLoopOptions` (~строка 78): новая опция `onMessage?: (m: ChatMessage) => void` — вызывается сразу после КАЖДОГО `messages.push` (строки ~168 финальный assistant, ~184 assistant с tool_calls, ~226 tool-результат). Headless/cli использует для append в jsonl; TUI игнорирует.
- Учесть в `onMessage`: начальные сообщения (system/history/user) НЕ дублировать — их cli допишет сам перед запуском loop; хук отвечает только за сообщения, появившиеся внутри loop.

### 3. src/agent/session.ts — инкрементальная запись
- Рядом с `saveSession` (строка 30): новый export `appendSessionMessage(dir: string, sessionId: string, message: ChatMessage): Promise<void>` — `assertSafeSessionId` + `mkdir recursive` + `appendFile(join(dir, sessionId + '.jsonl'), JSON.stringify(message) + '\n')` (импорт `appendFile` из `node:fs/promises`).
- `saveSession` НЕ удаляем — остаётся финальной нормализацией (полная перезапись идемпотентна, подчищает любые расхождения append'ов).

### 4. src/agent/cli.ts — запись jsonl по мере выполнения
- Импорт (строка 26): добавить `appendSessionMessage`.
- Перед `runLoop` (между строками 333 и 338), после сборки `messages`:
  - новая сессия: создать файл и записать стартовый набор (`system` + `history` + `user`-промпт) — построчно через `appendSessionMessage` (или однократный write той же формы, что у saveSession);
  - resume/continue: история уже в файле — дописать ТОЛЬКО новое user-сообщение (не переписывать файл, не дублировать system/history);
  - ошибки записи — предупреждение в stderr, фаза продолжается (паттерн строк 385–390).
- В `runLoop` (строка 338): передать `onMessage: (m) => { void appendSessionMessage(sessionsDir, sessionId, m).catch((e) => console.error('Предупреждение: сообщение сессии не дописано — ' + e.message)); }`.
- Финальный `saveSession` (строка 387) оставить как нормализацию.

### 5. Тесты
- **src/agent/llm.test.mjs**: (а) мок-fetch, чьё body-тело бросает `TypeError('terminated')` на первой попытке и отдаёт валидный SSE на второй → streamChat возвращает ok-результат, fetch вызван 2+ раза; (б) все стрим-попытки падают terminated, non-stream отвечает ok → результат из non-stream; (в) оба пути падают → ошибка содержит `после N попыток` и `terminated` (русский текст); (г) abort во время паузы между ретраями → `Операция прервана`, без ретраев.
- **src/agent/loop.test.mjs**: (а) fail-путь (llm кидает Error) → `res.messages.at(-1).role === 'assistant'`, content содержит текст ошибки; (б) `onMessage` вызывается по одному разу на каждое сообщение в порядке добавления (happy path: user→assistant(tool_calls)→tool→assistant); (в) при ошибке LLM onMessage последним получает assistant-сообщение с текстом ошибки.
- **src/agent/session.test.mjs**: `appendSessionMessage` дописывает строки в конец (save→append→load roundtrip); path traversal sessionId → throw; append в несуществующий каталог создаёт его.
- **src/agent/cli.test.mjs**: мок-LM на втором LLM-запросе читает `.vibelog/agent-sessions/*.jsonl` в testDir и запоминает содержимое в замыкании сервера (сервер живёт в тестовом процессе — доступно после прогона дочернего CLI) → после завершения assert: захваченное содержимое на момент 2-го запроса УЖЕ содержит assistant/tool-сообщения (доказательство инкрементальности); плюс существующий тест «готовый промпт: создаётся JSONL-сессия» должен остаться зелёным; плюс сценарий: первый запрос рвёт сокет mid-body (`res.socket.destroy()`), второй (non-stream ok) → is_error=false, в jsonl финальное assistant-сообщение.

### 6. Документация
- **docs/agent.md**, раздел 3.1 (строки ~112–117): jsonl пишется инкрементально (каждое сообщение дописывается сразу); при обрыве процесса транскрипт сохранён до последнего сообщения; resume дописывает только новые сообщения; поведение при обрыве LLM-запроса (ретраи стрима → non-stream → понятная ошибка); финальный saveSession — нормализация.
- JSDoc в llm.ts/loop.ts/session.ts — по месту изменений.

## Порядок действий
1. llm.ts (+ isRetryableStreamError, цикл ретраев стрима, диагностика) → llm.test.mjs.
2. loop.ts (fail→assistant, onMessage) → loop.test.mjs.
3. session.ts (appendSessionMessage) → session.test.mjs.
4. cli.ts (стартовая запись, onMessage-wiring, resume-логика) → cli.test.mjs.
5. docs/agent.md.
6. Полный прогон.

## Проверка
- `pnpm build` (tsc → dist, strict).
- `pnpm test` (= build + `node --test src`) — все тесты без регрессий.
- Точечно: `node --test src/agent/llm.test.mjs src/agent/loop.test.mjs src/agent/session.test.mjs src/agent/cli.test.mjs` после build.
- Ручная верификация AC#3: во время прогона CLI-теста с задержкой 2-го ответа убедиться (в тесте), что jsonl непуст до завершения фазы.

## Риски
- **Дубли токенов в TUI при ретрае стрима** — решено suppress onToken на повторных попытках; частичный текст первой попытки может остаться в TUI, но result-текст авторитетен. Задокументировать.
- **Множение попыток** (внутренние ретраи requestWithRetry × внешний цикл стрима) — приемлемо (3×3 максимум), комментарий в коде.
- **Совместимость resume**: файл старой сессии после resume будет содержать «старый» system-строку + новые сообщения (system в памяти заменяется свежим) — это документируется в docs/agent.md; поведение CLI/бота не меняется.
- **Существующие тесты loop/cli**: изменение fail() (assistant-сообщение в messages) может задеть точные assert на ролях — проверить прогоном, при необходимости точечно обновить осознанно (контракт LoopResult.messages становится строже: транскрипт всегда заканчивается assistant).
- **Ошибки записи jsonl** не должны ронять фазу — везде catch + предупреждение (паттерн cli.ts:385–390).
- Платформа: только node:fs/promises, node:path — нативных зависимостей нет (Node 20+, Catalina).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-06 11:18
---
Фаза 1 (Spec) выполнена. Масштаб: task. Уточнено постановку: цель — устранить ошибку «Ошибка LLM-запроса: terminated», возникшую при выполнении фазы VL-100 агентом vibelog-agent (headless, параллельно шла фаза VL-101; в логе видны длительные периоды тишины ~100–300 с и итоговый JSON-результат с is_error=true, num_turns=10, duration ~393 с). Контекст: симптом и лог консоли приложены к постановке; воспроизводимость и первопричина (обрыв соединения/стрима с LLM-провайдером vs зависание агента) на этапе Spec не устанавливаются — это предмет диагностики в Фазе 2/3. Критерии приёмки (3 проверяемых): (1) причина обрыва установлена и описана; (2) обрыв запроса переживается корректно — ретраи с таймаутом либо понятная ошибка с диагностикой вместо сырого «terminated»; (3) тест на поведение клиента/loop при обрыве запроса + pnpm test без регрессий, доки обновлены при изменении поведения. Ограничения платформы — из общих правил проекта (Node 20+, macOS 10.15 Catalina, без нативных зависимостей). Описание задачи не переписывал (поле усечено в выдаче MCP — перезапись удалила бы приложенный лог). Вопросов нет.
---
author: @agent
created: 2026-10-06 11:22
---
Дополнение постановки (по запросу пользователя) внесено в описание и критерии приёмки:
1. В лог добавлены недостающие строки завершения: `[phase VL-100] 02:53:38 exit: code=1 signal=null` и `close: code=1` — фаза завершилась с ненулевым кодом выхода.
2. Добавлен второй симптом: журнал сессии агента `vb:agent-1791244025104` (.vibelog/agent-sessions/*.jsonl) не содержит последнего результата — вероятно, jsonl пишется буферизованно по окончанию задачи, а не инкрементально. Требование: писать события в jsonl сразу по мере появления (результат LLM-запроса, tool calls, финальный result), чтобы при обрыве фазы в журнале уже был последний доступный результат.
3. AC обновлены (4 пункта): причина terminated; корректная обработка обрыва (ретраи/диагностика); инкрементальная запись jsonl-сессии с тестом; тест обрыва LLM-запроса + pnpm test без регрессий + доки.
Задача остаётся в статусе Spec, масштаб — task. Готова к Фазе 2 (Plan).
---
author: @agent
created: 2026-10-06 11:41
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу (implementationPlan), AC добавлены (4 шт.).
Диагностика (первопричины установлены по коду):
1. «Ошибка LLM-запроса: terminated» — обрыв соединения во время чтения SSE-тела в `parseSse` (llm.ts:300 `reader.read()`), вызов которого (llm.ts:436) стоит ПОСЛЕ `requestWithRetry` — ретраи покрывают только установку соединения, не чтение потока; non-stream фолбэк срабатывает лишь при `!streamRes.ok`, не при исключении из стрима. Голое `terminated` без префикса «после N попыток» (llm.ts:409) подтверждает, что ошибка не из requestWithRetry.
2. В jsonl сессии нет последнего результата — две причины: (а) `fail()` (loop.ts:128–143) не дописывает текст ошибки/результата assistant-сообщением в messages (транскрипт обрывается на tool-сообщении, --resume после ошибки сломан); (б) `saveSession` (cli.ts:387) вызывается только по завершении loop — при убийстве процесса jsonl не обновляется вовсе.
Изменения (4 файла исходников + 4 теста + доки): llm.ts — цикл ретраев стрима (isRetryableStreamError) + non-stream фолбэк в том же цикле + понятная русская ошибка с диагностикой; loop.ts — fail() дописывает финальный assistant + новая опция onMessage (хук после каждого messages.push); session.ts — appendSessionMessage (appendFile, инкрементальная запись); cli.ts — стартовая запись jsonl до loop + onMessage-wiring + resume дописывает только новые сообщения; docs/agent.md раздел 3.1. Тесты: обрыв стрима с ретраем/фолбэком/abort (llm), финальный assistant + порядок onMessage (loop), append roundtrip (session), инкрементальность через чтение jsonl из мок-LM на 2-м запросе + сценарий socket.destroy mid-body (cli).
Файлов для изменения: 8 (llm.ts, loop.ts, session.ts, cli.ts, llm.test.mjs, loop.test.mjs, session.test.mjs, cli.test.mjs) + docs/agent.md. Риски: дубли токенов в TUI при ретрае (решено suppress onToken), множение попыток 3×3 (приемлемо), смена контракта LoopResult.messages (транскрипт всегда заканчивается assistant — точечные обновления тестов при необходимости).
Проверка: `pnpm build && pnpm test`; точечно `node --test src/agent/{llm,loop,session,cli}.test.mjs`. Правки кода не выполнялись — только план. Готова к Фазе 3 (Code).
---
<!-- COMMENTS:END -->