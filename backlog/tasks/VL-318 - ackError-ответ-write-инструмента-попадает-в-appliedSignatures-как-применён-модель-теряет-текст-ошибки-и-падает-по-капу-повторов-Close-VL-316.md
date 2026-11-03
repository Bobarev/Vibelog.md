---
id: VL-318
title: ackError-ответ write-инструмента попадает в appliedSignatures как «применён» — модель теряет текст ошибки и падает по капу повторов (Close VL-316)
status: In Progress
assignee: []
reporter: ''
created_date: '2026-11-03 16:11'
updated_date: '2026-11-03 17:43'
due_date: ''
labels:
  - agent
  - mcp
  - bug
  - prompts
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
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - src/web/phase-prompt.test.mjs
  - templates/phases/phase-close.md
  - templates/phases/phase-close-worktree.md
lessons:
  - lesson-191
token_usage:
  input: 4087528
  output: 21446
  cache: 3898368
  total: 4108974
  requests: 89
  duration_ms: 822475
  reasoning: 6574
  by_phase:
    code:
      input: 1121588
      output: 8759
      cache: 1083392
      requests: 24
    close:
      input: 2965940
      output: 12687
      cache: 2814976
      requests: 65
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Фаза Close VL-316 упала кодом 1: «Модель 4 раз подряд повторила уже применённый вызов git_commit — повтор не исполнялся, фаза прервана» (сессия `.vibelog/agent-sessions/agent-1793705489953.jsonl`, строки 55–70). Работа при этом была сделана, а модель так и не узнала, что нужно исправить в вызове.

Воспроизведение (реальные строки сессии):
1. `git_commit {paths: ["CHANGELOG.md", "backlog/docs/doc-6-…"], message: "docs: VL-316 — …"}` — ровно как предписывает шаг 4 `templates/phases/phase-close.md`.
2. Ответ инструмента — корректный отказ: `{"ok": false, "error": "git_commit: эти файлы не принадлежат задаче VL-316: CHANGELOG.md, backlog/docs/doc-6-…; … передай allowForeign: true"}`.
3. Модель повторила тот же вызов → получила «Вызов git_commit уже применён ранее — повтор с теми же аргументами НЕ выполнен… Изменения применены; переходи к отчёту».
4. Ещё 3 повтора с той же ложью → кап `MAX_APPLIED_REPEATS_PER_RUN` → `fail()`, код 1.

## Причина (два дефекта)

**1. Классификация ответа в `src/agent/loop.ts` (~1320-1360).** Страховка VL-306 для не-JSON ответов:

```ts
if (!applied && !noop && spec && isMcpWriteTool(call.name) && !/^\s*Ошибка/.test(output)) applied = true;
```

Ответ `ackError` — это JSON (`{"ok": false, "error": …}`), он не парсится в `applied`/`noop` (там только `ok === true` и `noop === true`), не начинается с «Ошибка» (начинается с `{`) → страховка помечает его как «применён». Дальше `appliedSignatures` навсегда считает сигнатуру применённой, и модель вместо текста ошибки получает директиву «уже применено, переходи к отчёту». Это регресс VL-306: страховка писалась под плоский текст, а JSON-ветка не различает «ok:false» и «не распарсилось».

Дефект шире одного `git_commit`: **любой** write-инструмент, вернувший `ackError`/`ackDenied`, при повторе теряет свою ошибку — модель лишается единственной подсказки, как починить вызов, и упирается в кап повторов.

**2. Шаблоны Close.** Шаг 4 `templates/phases/phase-close.md:39` и шаг 8 `templates/phases/phase-close-worktree.md:63` велят коммитить `CHANGELOG.md` + `backlog/docs/*` **без** `allowForeign: true`. Эти файлы никогда не попадают в `modified_files` задачи (их заполняет фаза Code по коду), поэтому `foreignPaths` отклоняет коммит **всегда** — шаг документации в Close сломан по построению. Шаги 6.6 тех же шаблонов `allowForeign: true` передают — здесь забыли.

## Цель

1. `ackError`/`ackDenied`-ответ write-инструмента НЕ считается применённым: повтор такого вызова идёт обычным путём (loop detection с текстом ошибки в tool-результате), а не получает ложное «уже применено».
2. Шаг документации в обоих close-шаблонах коммитит `CHANGELOG.md`/`backlog/docs/*` с `allowForeign: true` — как уже делают шаги 6.6.

## Связанные

VL-306 (страховка appliedSignatures — источник дефекта 1), VL-310 (кап серии повторов), VL-311 (`git_commit` и его `allowForeign`), VL-316 (инцидент), lesson-92, lesson-176.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ответ write-инструмента с ok:false (ackError/ackDenied) НЕ попадает в appliedSignatures: в src/agent/loop.ts JSON-ветка различает ok:true (applied), noop:true (noop) и ok:false (failed), а страховка VL-306 для не-JSON ответов не срабатывает при failed
- [x] #2 Повтор вызова, вернувшего ackError, отдаёт модели исходный текст ошибки (tool-результат исполняется заново), а не директиву «вызов уже применён ранее»
- [x] #3 Регресс-тест на сессию agent-1793705489953: git_commit с чужим путём (ackError) + 4 дословных повтора → модель видит текст ошибки с подсказкой allowForeign, ран не падает по капу applied-повторов
- [x] #4 Шаг документации в templates/phases/phase-close.md и phase-close-worktree.md коммитит CHANGELOG.md и backlog/docs/* с allowForeign: true
- [x] #5 Тест-инвариант в src/web/phase-prompt.test.mjs: каждый git_commit в close-шаблонах, чьи пути включают CHANGELOG.md или backlog/docs/, несёт allowForeign: true
- [ ] #6 Тесты проходят (pnpm build && pnpm test), документация обновлена (doc-10 §6 — классификация ответов write-инструментов, CHANGELOG)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации VL-318

Тип: bug. Правки кода — в фазе Code.

### Диагноз (подтверждён чтением кода и сессии)

- `src/agent/loop.ts:1320-1360` — классификация ответа: `parsed.noop === true` → `noop`, `parsed.ok === true` → `applied`, иначе (в т.ч. `ok:false`) — ничего; затем страховка VL-306 `if (!applied && !noop && spec && isMcpWriteTool(...) && !/^\s*Ошибка/.test(output)) applied = true;` ловит JSON-отказ `ackError` (начинается с `{`, не с «Ошибка») и помечает сигнатуру применённой.
- `src/mcp/tool-result.ts:283` — `ackError` отдаёт `{ok:false, error}`; `ackDenied` — `{ok:false, denied:true, reason, …}`. Оба — «не применено».
- `templates/phases/phase-close.md:39`, `templates/phases/phase-close-worktree.md:63` — `git_commit` шага документации без `allowForeign`, хотя пути (`CHANGELOG.md`, `backlog/docs/*`) никогда не входят в `modified_files` задачи → `foreignPaths` (`src/mcp/git-commit.ts:298`) отклоняет всегда.

### Решения

- **Три исхода вместо двух.** Ввести `failed` (ответ распарсился как JSON с `ok === false`): такой вызов НЕ пополняет `appliedSignatures` и НЕ пополняет `noopSignatures` (noop уже отсечён раньше по `noop === true`). Страховка VL-306 получает условие `!failed` — она существует ровно для «ответ не JSON», а не для «JSON-отказ».
- **Повтор отказа исполняется заново.** Ничего дополнительно блокировать не нужно: сигнатуры нет в `appliedSignatures`/`noopSignatures`, поэтому вызов идёт обычным путём — handler исполняется, модель получает свежий текст ошибки. Обычный loop detection (3 одинаковых подряд) остаётся как защита от вечного круга, но теперь с настоящей причиной в tool-результате.
- **Шаблоны — минимальная правка.** Добавить `"allowForeign": true` в два вызова `git_commit` шага документации (шаги 6.6 уже так делают — консистентность). Инвариант закрепить тестом, чтобы третий close-шаблон не завёл ту же ошибку.

### Файлы и точки правки

**1. `src/agent/loop.ts` (~1320-1360)**
- В блоке классификации: `let applied = false, noop = false, failed = false;`
- В `try`: `if (parsed.noop === true) noop = true; else if (parsed.ok === true) applied = true; else if (parsed.ok === false) failed = true;`
- Страховка: `if (!applied && !noop && !failed && spec && isMcpWriteTool(call.name) && !/^\s*Ошибка/.test(output)) applied = true;`
- Комментарий: почему `ok:false` — не «применено» (инцидент agent-1793705489953: `ackError` от `git_commit` попал в `appliedSignatures`, модель 4 раза получила «уже применено» вместо подсказки `allowForeign` и ран упал по капу).

**2. `templates/phases/phase-close.md:39`** — в `git_commit` шага 4 добавить `"allowForeign": true` (пути `CHANGELOG.md` + `backlog/docs/*` не входят в `modified_files`).

**3. `templates/phases/phase-close-worktree.md:63`** — то же для шага 8.

**4. Тесты**
- `src/agent/loop.test.mjs` — новый кейс «VL-318: ackError не считается применённым»: заглушка write-инструмента возвращает `{"ok":false,"error":"… allowForeign: true"}`, модель повторяет вызов 4 раза → handler исполнен 4 раза (не 1), в tool-результатах виден текст ошибки, `res.result` не содержит «уже применён ранее»; ран завершается обычным loop detection (или финальным текстом), а не капом applied-повторов.
- `src/agent/loop.test.mjs` — сохранить существующие кейсы VL-306 (плоский текст → applied) и VL-309 (noop → noopSignatures) без изменений: они фиксируют, что правка не сломала прежние ветки.
- `src/web/phase-prompt.test.mjs` — инвариант: в `phase-close.md` и `phase-close-worktree.md` каждый `git_commit`, чьи `paths` содержат `CHANGELOG.md` или `backlog/docs/`, содержит `allowForeign`.

**5. Документация (Close)**
- `backlog/docs/doc-10-…` §6 — абзац: классификация ответов write-инструментов (`ok:true` → применён, `noop:true` → «изменений нет», `ok:false` → ошибка, повтор исполняется заново).
- `CHANGELOG.md` — запись в Unreleased/Исправлено.

### Проверка

```
pnpm build && pnpm test
```
Плюс ручная проверка регресса: `node -e` с заглушкой не нужен — кейс в `loop.test.mjs` воспроизводит сессию.

### Риски

- **R1. Ложное «не применено» для инструментов, отвечающих `ok:false` при частичном успехе.** Проверить: `ackDenied` (`denied:true`) — точно не применено; `ackError` — по контракту VL-262 ошибка до записи. Частичный успех кодируется `ok:true` + `skipped`, он остаётся в `appliedSignatures` — поведение не меняется.
- **R2. Внешние MCP-инструменты.** Страховка и раньше ограничена `spec !== undefined` + `isMcpWriteTool`; `failed` только сужает её — внешние не затрагиваются.
- **R3. Шаблоны — инвариант VL-105/lesson-29.** В шаблоны не вносить ID задач и `pnpm`; правка — только флаг `allowForeign`.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 16:31
---
Фаза 3 (Code) выполнена. Коммит 8e34e53 «fix: VL-318 — ackError (ok:false) не считается применённым; allowForeign в close-шаблонах».
Изменено:
- `src/agent/loop.ts` — в классификации ответа write-вызова введён третий исход `failed` (JSON с `ok === false`, т.е. ackError/ackDenied): сигнатура НЕ пополняет `appliedSignatures`/`noopSignatures`, страховка VL-306 получила условие `!failed` (она существует для не-JSON ответов, а не для распознанного отказа). Комментарий с инцидентом agent-1793705489953.
- `src/agent/loop.test.mjs` — новый describe «VL-318 — ackError (ok:false) не считается применённым»: (1) регресс сессии agent-1793705489953 — git_commit с чужим путём → ackError, повтор исполняется заново, модель видит текст ошибки с подсказкой `allowForeign: true`, ложной директивы «уже применён ранее» нет, затем успешный вызов с allowForeign и финальный текст; (2) 4+ дословных повтора ackError → обычный loop detection (не кап applied-повторов), handler исполнялся повторно. Кейсы VL-306 (плоский текст → applied) и VL-309 (noop) не тронуты и проходят.
- `templates/phases/phase-close.md` (шаг 4) и `templates/phases/phase-close-worktree.md` (шаг 8) — в `git_commit` шага документации добавлен `"allowForeign": true` + пояснение, почему флаг обязателен (CHANGELOG.md и backlog/docs/* не входят в modified_files).
- `src/web/phase-prompt.test.mjs` — инвариант VL-318: парсер вызовов `git_commit {…}` с балансировкой скобок; каждый вызов в обоих close-шаблонах, чьи пути содержат CHANGELOG.md или backlog/docs/, обязан нести `"allowForeign": true`.
Проверки: `pnpm build` — успешно; `pnpm test` — полный прогон, 160 файлов / 3022 теста passed, 4 skipped (пре-существующие skip, не связаны с задачей), падений нет.
Что осталось: AC6 в части документации — doc-10 §6 (классификация ответов write-инструментов) и запись в CHANGELOG.md пишет Фаза Close (в Code документация backlog/ и CHANGELOG не правится по правилам фазы), поэтому AC6 не отмечен; DoD «Документация обновлена» — тоже на Close.
---
author: @agent
created: 2026-11-03 16:36
---
Фаза close не удалась (код выхода 1):  блокировок=0, payload последнего запроса=232387 байт (макс 232387), usage={"input_tokens":1083369,"output_tokens":4138,"cache_read_input_tokens":1047040,"total_tokens":1087507,"reasoning_tokens":626} — статус возвращён к Review.
---
<!-- COMMENTS:END -->