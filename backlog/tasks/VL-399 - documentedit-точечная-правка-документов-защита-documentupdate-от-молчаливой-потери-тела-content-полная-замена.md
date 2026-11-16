---
id: VL-399
title: 'document_edit: точечная правка документов + защита document_update от молчаливой потери тела (content — полная замена)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-10 00:09'
updated_date: '2026-11-16 16:02'
due_date: ''
labels:
  - mcp
  - docs
  - safety
  - tech-debt
dependencies: []
milestone: v1.14
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/document-edit.ts
  - src/mcp/tools.ts
  - src/mcp/update-pipeline.ts
  - src/core/tool-kinds.ts
  - src/mcp/document-edit.test.mjs
  - src/mcp/documents.test.mjs
  - src/mcp/reference-tools.test.mjs
  - src/mcp/server.test.mjs
  - src/mcp/write-ack-contract.test.mjs
  - src/core/compat-full.test.mjs
  - src/cli/diagnostics.test.mjs
  - src/web/tool-policy.test.mjs
  - src/web/chat-thread-restore-vl264.test.mjs
  - templates/prompts/chat-system.md
  - templates/agent-prompt.md
lessons:
  - lesson-251
token_usage:
  input: 13796391
  output: 118098
  cache: 13448192
  total: 13914489
  requests: 163
  duration_ms: 1467199
  reasoning: 68327
  by_phase:
    plan:
      input: 2810778
      output: 39234
      cache: 2687744
      requests: 40
    code:
      input: 8282079
      output: 61523
      cache: 8114432
      requests: 78
    close:
      input: 2703534
      output: 17341
      cache: 2646016
      requests: 45
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст: инцидент, повторившийся несколько раз

`document_update` (`src/mcp/tools.ts:450`, реализация `toolDocumentUpdate` → `runUpdate(documentSpec)` → `updateDocument` в `src/core/document.ts:211`) принимает `content` как **полную замену тела документа**. Точечной правки документов в системе нет вовсе: `edit` работает с файлами и в правилах прямо помечен как неприменимый к документам («задачи, lessons, references и documents правь через MCP-инструменты»).

Последствия, наблюдавшиеся на практике:

- 2026-11-10 в этом чате: при простановке пометки «устарело» в doc-10 передан короткий `content` → утрачены §3 (часть) и §4–§12. Ответ инструмента при этом был победным: `{"ok": true, "message": "Документ doc-10 обновлён"}`.
- Причина невидимости потери: `applied` для тела возвращает **только длину** (`src/mcp/tools.ts:2610`: `result[key] = key === 'content' ? String(entity.body).length : ...`). Падение с 60 КБ до 1 КБ выглядит как успешное применение.
- Ранее — «это происходило уже несколько раз» (со слов пользователя): тот же механизм, разные документы.

Это не ошибка модели «забыл скопировать текст», а дефект интерфейса: единственный способ поправить абзац — переписать документ целиком, а механизм не сообщает, что переписал.

## Цель

Сделать точечную правку документов первоклассной операцией и сделать полную замену тела осознанным, а не случайным действием.

## Что сделать

**A. `document_edit` (новый MCP-инструмент)**
- Параметры: `id`, `old_string`, `new_string`, `replace_all` (bool, дефолт false), `idempotencyKey`.
- Семантика — как у файлового `edit`: ровно одно совпадение, иначе отказ без записи (0 → подсказка, где искать; >1 → число совпадений + предложение уточнить или `replace_all`).
- Работа по телу документа; `title`/`type`/`tags` — прежними полями `document_update` (они безопасны).
- Отчёт: сколько вхождений заменено, размер тела до/после, контракт `{ok, applied, skipped}`.

**B. Защита `document_update`**
- Если передан `content` и он существенно короче текущего тела (порог — например 40%) и при этом не содержит текущего начала текста → **отклонить** с объяснением: «content — полная замена тела; для точечной правки используй document_edit; если замена осознанная — передай full_replace: true».
- Добавить `full_replace` (bool, дефолт false) как явное согласие.
- В `applied` отдавать `bodyLengthBefore`/`bodyLengthAfter` (или `truncated: true`), чтобы усечение было видно в ответе инструмента.

**C. Обозначить в описаниях и промптах**
- `tools/list`: описание `document_update.content` — «полная замена тела»; описание `document_edit` — «точечная правка».
- Системный промпт веб-чата и `templates/agent-prompt.md`: правило «документы — точечно; `content` — только осознанная замена».

**D. Альтернатива (обосновать в плане, если выбрана)**
- Вместо нового инструмента расширить `document_update` полями `old_string`/`new_string` (edit-режим). Минус: смешение двух семантик в одном вызове и риск «передал и content, и old_string». Предпочтителен отдельный инструмент — как у задач (`notes` полная замена vs `append_notes` добавление).

## Границы

- Существующие вызовы `document_update` с осознанной полной заменой не должны ломаться, если передают `full_replace: true` (или если новый content не подозрителен по размеру).
- Читающие операции не меняются.
- README не расширять (лимит 150 строк, тест `src/web/readme-standard.test.mjs`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Новый MCP-инструмент `document_edit` (write, с подтверждением): параметры id, old_string, new_string, replace_all (по умолчанию false); работает точечно по телу документа — заголовок/теги через существующие поля
- [x] #2 `document_edit` возвращает понятные отказы: 0 совпадений — «не найдена» с подсказкой (в т.ч. «возможно, документ восстановлен из git и текст другой»); >1 совпадения — отказ с числом совпадений и предложением уточнить old_string или replace_all; отказ НЕ пишет файл
- [x] #3 `document_edit` в отчёте возвращает applied по смыслу (заменено N вхождений, размер тела до/после) и контракт {ok, applied, skipped} с idempotencyKey, как остальные write-инструменты
- [x] #4 `document_update` защищён от молчаливой потери тела: при передаче `content`, который короче текущего тела более чем на порог (например 40%) и не содержит начала текущего текста, вызов ОТКЛОНЯЕТСЯ с объяснением, что content — полная замена, и подсказкой «точечная правка — document_edit; сознательная замена — параметр full_replace: true»
- [x] #5 В `applied` для content отдаётся не только длина, но и предупреждение/маркер усечения (`truncated: true`, размеры до/после) — чтобы потеря объёма была видна в ответе, а не только в git
- [x] #6 Описания инструментов (`tools/list`) явно говорят: `document_update.content` — полная замена тела; точечная правка — `document_edit`
- [x] #7 Правило добавлено в системный промпт чата и в `templates/agent-prompt.md`: «документы править точечно (document_edit / edit по файлу); content в document_update — только осознанная полная замена»
- [x] #8 Тесты: document_edit (замена, 0 совпадений, >1, replace_all, идемпотентный повтор), guard document_update (короткий content отклонён, full_replace: true проходит), регрессия — обновление только title/tags не затрагивает тело
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель и принятое решение

Точечная правка документов становится первоклассной операцией (`document_edit`), а полная замена тела в `document_update` — осознанным действием (guard + `full_replace` + маркер усечения в `applied`).

**Вариант D отклонён**: отдельный инструмент, а не `old_string`/`new_string` внутри `document_update`. Причины: (1) смешение двух семантик в одном вызове — «и `content`, и `old_string`» даёт неопределённый исход, который придётся разбирать ветвлением в `beforeWrite`; (2) `document_update` уже идёт через общий пайплайн `runUpdate` со сверкой «уже так» и noop — edit-режим потребовал бы выключить её по признаку аргумента (как `nonIdempotent`), то есть второй рантайм внутри одного инструмента; (3) в проекте уже есть прецедент разделения семантик: `notes` (полная замена) vs `append_notes` (дописывание) — `src/mcp/tools.ts` (поле `append_notes` объявлено в схеме `backlog_update_task`). Отдельный инструмент повторяет модель файлового `edit` (`src/agent/tools.ts:891-922`), которую модель уже знает.

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `document_update` объявлен в реестре; `content` описан как «Новое содержимое (полная замена)» | `src/mcp/tools.ts:449-465` (строка 457) |
| Диспетчер: `case 'document_update': return toolDocumentUpdate(args, cwd);` | `src/mcp/tools.ts:954-955` |
| `toolDocumentUpdate` = `runUpdate(documentSpec, args, cwd)` | `src/mcp/tools.ts:2629-2633` |
| `documentSpec.fields = ['id','title','content','type','tags','idempotencyKey']` | `src/mcp/tools.ts:2587` |
| `documentSpec.applied` сворачивает `content` до длины (`String(entity.body).length`) | `src/mcp/tools.ts:2610-2616` |
| `EntitySpec.applied(entity, keys, via)` — прежнего состояния сущности не получает | `src/mcp/update-pipeline.ts:74-144` (интерфейс `EntitySpec`) |
| `runUpdate`: хук `beforeWrite` вызывается на шаге 5 — ДО сверки «уже так» и ДО записи | `src/mcp/update-pipeline.ts:219-227` |
| `runUpdate`: noop-ветка (`keys.length === 0 || unchanged`) | `src/mcp/update-pipeline.ts:237-243` |
| `runUpdate`: запись + сборка `applied` после записи | `src/mcp/update-pipeline.ts:254-262` |
| `RejectDetail` умеет `message`/`hint`/`retryWith`/`applied` | `src/mcp/update-pipeline.ts:145-152` |
| `updateDocument`: `body = updates.content !== undefined ? updates.content : entry.body` — обновление title/tags тело не трогает | `src/core/document.ts:211-236` (строка 227) |
| `document_update` объявлен как `write` | `src/core/tool-kinds.ts:56` |
| Файловый `edit`: `split/join` (а не `replace`, чтобы `$`-символы не трактовались), 0 совпадений → «не найдена», >1 без `replace_all` → «найдена N раз(а)» | `src/agent/tools.ts:908-921` |
| `getDocument` ищет по id case-insensitive; `listDocuments` отдаёт `{document, body, path}` | `src/core/document.ts:161-166`, `150-159` |
| `ackErrorDetailed` отдаёт `{ok:false, outcome:'rejected', error, applied:{}, next:{hint, retryWith}}` | `src/mcp/tool-result.ts:546-583` |
| `serializeAck` переносит `applied` в ответ как есть | `src/mcp/tool-result.ts:118-150` |
| `ackNoopDetailed` даёт `{ok:false, noop:true, reason:'noop'}` + applied/missing/hint | `src/mcp/tool-result.ts:330-366` |
| `withIdempotency` кэширует JSON-ответ и помечает повтор `idempotentReplay: true` | `src/mcp/idempotency.ts:157-186` |
| Транспортная граница ставит `isError: true` только для noop-ack | `src/mcp/server.ts:250-262` |
| `listTools()` — плоский массив объявлений | `src/mcp/tools.ts:147-149` |
| Чат получает ВСЕ инструменты реестра минус `CHAT_DISALLOWED_TOOLS` (новый инструмент появится сам) | `src/web/tool-policy.ts:60-67`, `304` |
| `UNKNOWN`-аргументы попадают в `skipped` через `unknownFields(args, spec.fields)` | `src/mcp/update-pipeline.ts:293-308` |
| Тесты фиксируют число инструментов 48: `documents.test.mjs:74`, `reference-tools.test.mjs:61`, `server.test.mjs:184`, `compat-full.test.mjs:184` (и заголовок теста там же) | указанные строки |
| Ожидаемый реестр — фикстура `EXPECTED_MCP_TOOLS` в `src/cli/diagnostics.test.mjs:38-85` | там же |
| Write-список чата (parity) — `src/web/tool-policy.test.mjs:41-58` (строка 47) | там же |
| Список parity `isWriteTool` в чате — `src/web/chat-thread-restore-vl264.test.mjs:91-99` | там же |
| Инвариант «каждый write-инструмент отвечает JSON-ack» обходит `listTools()`: `ACK_SCENARIOS` (document_update — `write-ack-contract.test.mjs:261-263`), `NOOP_SCENARIOS` (document_update — `:389`), `PARTIAL_EXEMPT` (document_update — `:576`) | `src/mcp/write-ack-contract.test.mjs` |
| `document_update` с тем же телом → noop (сравнение тела) | `src/mcp/write-ack.test.mjs:526-535` |
| Правило про backlog и документы в промпте чата | `templates/prompts/chat-system.md:15-17`, `35` |
| Правило агента про MCP-only правки backlog | `templates/agent-prompt.md:20` |
| Раздел `document_update` в MCP-справочнике | `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md:409-414` |
| Тесты in-process MCP обязаны снимать фазовый env | `src/test-env.mjs` (`clearPhaseEnv`), шапка `src/mcp/documents.test.mjs:19-27` |

## Изменения по файлам (в порядке выполнения)

### 1. Новый модуль `src/mcp/document-edit.ts` (чистая логика, без fs)

Экспорт:
- `export const DOC_SHRINK_RATIO = 0.6` — порог «подозрительного сжатия» (>40%).
- `export function contentShrinkCheck(currentBody: string, newContent: string): { suspicious: boolean; bodyLengthBefore: number; bodyLengthAfter: number; shrinkPercent: number }`.
  Логика: `before = currentBody.length`; если `before === 0` → `suspicious: false`; `shorter = after < before * DOC_SHRINK_RATIO`; `head` = первая непустая строка `currentBody`, обрезанная до 60 символов и `trim()`; `keepsHead = head !== '' && newContent.includes(head)`; `suspicious = shorter && !keepsHead`.
  `content: ''` при непустом теле → `after = 0 < 0.6*before` → `suspicious: true` (осознанная очистка тела требует `full_replace: true`) — фиксируем это поведение в комментарии и в доке.
- `export type BodyEditResult = { ok: true; body: string; replaced: number } | { ok: false; reason: 'not_found' | 'ambiguous'; count: number }`.
- `export function applyBodyEdit(body: string, oldString: string, newString: string, replaceAll: boolean): BodyEditResult`.
  Семантика идентична файловому `edit` (`src/agent/tools.ts:908-921`): `count = body.split(oldString).length - 1`; `0` → `not_found`; `!replaceAll && count > 1` → `ambiguous`; замена — `split(oldString).join(newString)` (без `replace`, чтобы `$&`/`$1` в `new_string` не трактовались как подстановки). Комментарий-ссылка на `makeEdit` (общая семантика, разные носители — файл vs тело).

### 2. `src/core/tool-kinds.ts` — строка после `document_update: 'write'` (`:56`)

Добавить `document_edit: 'write',` (иначе тест паритета `src/core/tool-classify.test.mjs:20-26` упадёт: «инструменты без объявленного вида»).

### 3. `src/mcp/update-pipeline.ts` — `applied` получает прежнее состояние

- В `EntitySpec` (блок `applied`, `:74-144`) расширить сигнатуру: `applied(entity: E, keys: string[], via: 'applied' | 'partial' | 'noop', previous?: E): Record<string, unknown>;` — параметр **опциональный**, реализации с 2 аргументами (`src/mcp/tools.ts:1528, 1590, 2828, 3113`) не меняются (TS допускает меньше параметров).
- В `runUpdate` передавать `current` четвёртым аргументом в обеих точках: noop (`:240`) и после записи (`:262`). Комментарий: «прежнее состояние нужно, чтобы ответ показал размер тела до/после (VL-399)».

### 4. `src/mcp/tools.ts`

**4.1 Реестр** — после блока `document_update` (после `:465`, до `document_search`): объявление `document_edit`:

```
name: 'document_edit',
description: 'Точечная правка ТЕЛА документа: заменяет old_string на new_string. Без replace_all old_string обязан встречаться ровно один раз — иначе отказ без записи. Заголовок/тип/теги — через document_update (там content — ПОЛНАЯ замена тела).',
inputSchema.properties: id (required), old_string (required, «Точный текст для поиска в теле»), new_string (required), replace_all (boolean, «Заменить все вхождения»)
required: ['id','old_string','new_string']
```

**4.2 Описание `document_update.content`** (`:457`) — переписать: `'Новое содержимое — ПОЛНАЯ замена тела. Для точечной правки используй document_edit. Если новое тело существенно короче текущего и не сохраняет его начала, вызов отклоняется — осознанная замена требует full_replace: true'`.

**4.3 Новое поле `full_replace`** в схеме `document_update` (`:465`, после `tags`): `{ type: 'boolean', description: 'Явное согласие на полную замену тела, даже если content короче текущего более чем на 40%' }`. Оно НЕ идёт в `updates` (управляющий флаг, не поле документа), поэтому добавляется только в `documentSpec.fields` (`:2587`): `['id','title','content','type','tags','full_replace','idempotencyKey']` — иначе попадёт в `skipped` как «неизвестное поле».

**4.4 Guard в `documentSpec.beforeWrite`** (новый хук рядом с `build`/`read`, `:2589-2606`):

```
beforeWrite: (args, _updates, current) => {
  if (args.content === undefined || args.full_replace === true) return null;
  const check = contentShrinkCheck(current.body, String(args.content));
  if (!check.suspicious) return null;
  return {
    message: `content — ПОЛНАЯ замена тела документа ${id}: ${after} симв. вместо ${before} (сокращение ${pct}%), начало текущего текста не сохранено.`,
    hint: 'Точечная правка — document_edit {"id","old_string","new_string"}. Осознанная полная замена — тот же вызов с full_replace: true.',
    retryWith: { id, content: args.content, full_replace: true },
  };
}
```
`retryWith` — по образцу VL-353 (`src/mcp/tool-result.ts:555-566`): готовая машиночитаемая форма исправления, а не описательное «поправь аргументы».

**4.5 `documentSpec.applied`** (`:2610-2616`) — принимает `previous`; для ключа `content` по-прежнему отдаёт число (обратная совместимость: длина тела), и дополнительно кладёт в результат `bodyLengthBefore`, `bodyLengthAfter`, `truncated: bodyLengthAfter < bodyLengthBefore`. Значения — только когда передан `content` (иначе ключи лишние).

**4.6 `toolDocumentEdit`** (рядом с `toolDocumentUpdate`, после `:2633`):

```
function toolDocumentEdit(args, cwd): string {
  const backlogDir = requireBacklogDirOrThrow(cwd);
  const id = String(args.id ?? '').trim();
  if (!id) throw new Error('Не передан id документа (параметр "id").');
  const oldString = args.old_string, newString = args.new_string;
  if (typeof oldString !== 'string' || oldString === '') throw new Error('old_string пустой: точечная правка без искомого текста невозможна.');
  if (typeof newString !== 'string') throw new Error('Не передан new_string (параметр "new_string").');
  const entry = getDocument(backlogDir, id);
  if (!entry) throw new Error(`Документ ${id} не найден.`);
  const replaceAll = args.replace_all === true;
  const before = entry.body;
  const res = applyBodyEdit(before, oldString, newString, replaceAll);
  if (!res.ok) → ackErrorDetailed(текст, { hint, retryWith })
  if (res.body === before && res.replaced > 0) → ackNoopDetailed('Изменений нет: old_string и new_string совпадают…', {id, replaced: 0, …})
  updateDocument(backlogDir, id, { content: res.body });
  return ackOk(`Документ ${id} обновлён: заменено ${res.replaced} вхождений`, { id, replaced: res.replaced, bodyLengthBefore: before.length, bodyLengthAfter: res.body.length, truncated: res.body.length < before.length });
}
```

Отказы (AC2):
- `not_found`: `old_string не найден в теле документа ${id} (тело ${len} симв.). Проверь точный текст: document_view {"id":"${id}"}. Возможно, документ восстановлен из git и текст в нём другой.` + `hint: 'Скопируй фрагмент из ответа document_view дословно…'`.
- `ambiguous`: `old_string встречается ${count} раз(а) в теле ${id}: уточни текст (добавь контекст) или передай replace_all: true.` + `retryWith: { id, old_string, new_string, replace_all: true }`.
- Оба — `ackErrorDetailed`, `applied: {}`, файл НЕ пишется (возврат до `updateDocument`).

**4.7 Диспетчер** (`:955`): `case 'document_edit': return withIdempotency(cwd, name, args.idempotencyKey, () => toolDocumentEdit(args, cwd));`.

### 5. Промпты

- `templates/prompts/chat-system.md`: в блок «Инструменты» после строки про `edit` (`:16`) добавить пункт про `document_edit` (точечная правка тела документа, MCP, с подтверждением); в пункт про `edit`/write_file (`:17`) — правило «документы править точечно (`document_edit`), `content` в `document_update` — только осознанная полная замена». Строку 15 («Задачи, lessons, references и documents правь через MCP-инструменты») оставить.
- `templates/agent-prompt.md:20` — расширить существующую строку (не добавлять новую: канонические правила дублировать запрещено, тест `src/web/phase-prompt.test.mjs:1273+`): «… документы — точечно через `document_edit`; `content` в `document_update` — полная замена тела, только осознанно (`full_replace: true`).»

### 6. Тесты

**6.1 Новый файл `src/mcp/document-edit.test.mjs`** (mkdtemp + `clearPhaseEnv()` на уровне файла — VL-374, по шаблону `src/mcp/documents.test.mjs:19-27`):
- замена одного вхождения: `ack.ok === true`, `applied.replaced === 1`, `applied.bodyLengthBefore/After`, тело изменилось только в точке правки (`document_view`);
- 0 совпадений → `ok:false`, `message` содержит «не найден», `hint` содержит «git», файл байт-в-байт прежний;
- >1 без `replace_all` → `ok:false`, «встречается 2 раз», `retryWith.replace_all === true`, файл прежний;
- `replace_all: true` → `applied.replaced === 2`, все вхождения заменены;
- идемпотентный повтор с `idempotencyKey` → второй ответ `idempotentReplay: true`, тело не изменено повторно;
- `old_string === new_string` → noop (`noop:true`, `reason:'noop'`);
- `$&` в `new_string` вставляется буквально (защита от подстановок `replace`);
- заголовок и теги не изменились после `document_edit`;
- guard: длинное тело + короткий `content` без начала текста → `ok:false`, текст содержит «ПОЛНАЯ замена», «document_edit», «full_replace», файл прежний; тот же вызов с `full_replace: true` → `ok:true`, `applied.bodyLengthBefore/After`, `applied.truncated === true`; короткий `content`, сохраняющий первую строку тела → проходит без `full_replace`; `content` пустой при непустом теле → отказ;
- регрессия: `document_update {id, title}` и `{id, tags}` тело не меняют (`document_view`).

**6.2 Правки существующих тестов (счётчики/инварианты):**
- `src/mcp/documents.test.mjs:74` — 48 → 49, в цикл наличия добавить `document_edit`;
- `src/mcp/reference-tools.test.mjs:61` — 48 → 49;
- `src/mcp/server.test.mjs:184` — 48 → 49 (и заголовок теста `:174`);
- `src/core/compat-full.test.mjs:184` — 48 → 49, в `expected` добавить `document_edit` (заголовок `:182`);
- `src/cli/diagnostics.test.mjs` — в фикстуру `EXPECTED_MCP_TOOLS` (алфавитно, после `document_create`) добавить `'document_edit'`;
- `src/web/tool-policy.test.mjs:47` — добавить `'document_edit'` в write-список;
- `src/web/chat-thread-restore-vl264.test.mjs:96-97` — добавить `'document_edit'` в parity-список;
- `src/mcp/write-ack-contract.test.mjs` — `ACK_SCENARIOS` (сценарий: документ + `document_edit`), `PARTIAL_EXEMPT` (причина: «одноцелевая операция, все аргументы обязательны по смыслу — partial-семантики нет»), `NOOP_SCENARIOS` (повтор `old_string === new_string` → noop).

### 7. Документация (DoD «Документация обновлена»)

- `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md`: новый раздел `### document_edit` перед/после `document_update` (`:409-414`) с таблицей параметров и семантикой отказов; в таблицу `document_update` — строка `full_replace` + примечание о guard и о `applied.bodyLengthBefore/After`/`truncated`.
- `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md`: правило «документы править точечно; `content` — только осознанная замена» в разделе про промпты/правила агента (`:436-440` — ближайший блок актуальных ревизий).
- Править эти документы в Code-фазе — **через `document_edit`** (dogfooding: сначала точечно, затем проверка `document_view`); README не трогать (`src/web/readme-standard.test.mjs`).

## Порядок действий

1. `src/mcp/document-edit.ts` (чистая логика + комментарии «почему»).
2. `src/mcp/update-pipeline.ts` — 4-й параметр `applied` + передача `current`.
3. `src/mcp/tools.ts` — схема `document_edit`, `full_replace`, `beforeWrite`-guard, `applied` с размерами, `toolDocumentEdit`, диспетчер.
4. `src/core/tool-kinds.ts` — `document_edit: 'write'`.
5. `pnpm build` + точечный прогон затронутых тестов, затем правка счётчиков в существующих тестах и новый `src/mcp/document-edit.test.mjs`.
6. Промпты (`templates/prompts/chat-system.md`, `templates/agent-prompt.md`).
7. Документы (doc-8, doc-10) — через `document_edit` из уже собранного MCP.
8. Полный `pnpm test` (без `--exclude`) — только он закрывает DoD «Тесты проходят».

## Проверка

```
pnpm build && npx vitest run src/mcp/document-edit.test.mjs src/mcp/documents.test.mjs src/mcp/write-ack-contract.test.mjs src/core/tool-classify.test.mjs src/web/tool-policy.test.mjs src/mcp/server.test.mjs src/cli/diagnostics.test.mjs
grep -rn "tools.length" src --include=*.test.mjs     # добить прочие фиксации числа инструментов
pnpm test                                            # полный прогон перед DoD
```

## Риски

1. **Счётчики 48** — четыре теста (`documents:74`, `reference-tools:61`, `server:184`, `compat-full:184`) плюс фикстура доктора; при пропуске хоть одного — красный build.
2. **Инвариант-тесты write-ack** обходят `listTools()`: новый write-инструмент без сценария в `ACK_SCENARIOS`/`PARTIAL_EXEMPT`/`NOOP_SCENARIOS` валит сборку — добавлять все три строки одним коммитом с инструментом.
3. **Ложные срабатывания guard**: легитимная замена тела на более короткое, но без сохранения первой строки, будет отклонена. Митигация — `retryWith` с `full_replace: true` (модель получает готовую форму) и явный текст отказа. Порог 0.6 — константа `DOC_SHRINK_RATIO`, меняется одной правкой.
4. **Пустой `content`** (`content: ''`) теперь требует `full_replace: true`. Проверить, что ни один существующий тест/шаблон не очищает тело документа без флага (`src/mcp/documents.test.mjs:129`, `src/mcp/write-ack.test.mjs:526` — тела там короче новых, под guard не попадают).
5. **`full_replace` в `skipped`**: если забыть добавить имя в `documentSpec.fields`, ответ начнёт врать (флаг «неизвестное поле»), а guard при этом сработает — расхождение формы и поведения.
6. **Смена формы `applied`**: расширение интерфейса `EntitySpec.applied` опциональным параметром не ломает другие спеки, но если сделать параметр обязательным — TypeScript упадёт на 4 реализациях.
7. **noop-семантика `document_edit`**: повтор без `idempotencyKey` даёт не noop, а «old_string не найден» (текст уже заменён) — это ожидаемо и описано в hint; тест идемпотентности проверяет именно путь с ключом.
8. **Промпт-тесты**: `src/web/phase-prompt.test.mjs` проверяет структуру `chat-system.md` (лимит строк блока «Режим ответа») и короткие маркеры — новую строку добавлять в блок «Инструменты», не в «Режим ответа».

## Не проверено (предположения) — проверить ПЕРВЫМ шагом Code

1. **Переход Spec → Planned для фазы plan** разрешён workflow (шаблон дал `{{producesStatus}} = Planned`). Проверка: `backlog_finish_phase` вернёт предупреждение, если перехода нет; при расхождении — отчёт без status.
2. **Прочих фиксаций числа инструментов нет** (кроме найденных четырёх тестов). Проверка: `grep -rn "tools.length" src --include=*.test.mjs` и `grep -rn "48 инструмент" src templates backlog/docs`. При находке — обновить вместе с прочими.
3. **`documentSpec.beforeWrite` получает `current` в виде `DocumentEntity` (с `body`)** — по `read: (cwd, id) => getDocument(...) as DocumentEntity`. Проверка: юнит-тест guard через `handleToolCall` (guard по `current.body`). При расхождении — брать тело через `getDocument` внутри хука.
4. **`applied` с 4-м параметром — достаточно для `bodyLengthBefore`** (в noop-ветке `previous === current`, поэтому before == after). Проверка: тест noop с `content` равным текущему телу — `truncated` отсутствует/`false`, `bodyLengthBefore === bodyLengthAfter`.
5. **Чат подхватит `document_edit` автоматически** (`chatToolDefs` итерирует `listTools()`), доп. регистрации не нужно. Проверка: `src/web/tool-policy.test.mjs` (цикл «каждый инструмент реестра в списке чата»).
6. **`document_edit` не попадёт в детектор повторов** (`toolRepeatTarget` в `src/agent/repeat-tracker.ts:246-267` не знает имени → `null`), и это допустимо (повтор ловится точной сигнатурой `callSignature`). Проверка: прогон `src/agent/repeat-tracker*.test.mjs` после добавления инструмента.
7. **`ackErrorDetailed` для 0/>1 совпадений не запускает кап ошибок рана**: путь «модель исправляет аргументы по `retryWith`» проверяется тестом; если кап срабатывает на практике — обсудить перевод этих отказов в noop-семантику (комментарий в Code-фазе).
8. **Тексты `hint` не проверяются дословно существующими тестами** — только подстроками (`documents.test.mjs:146`, `write-ack.test.mjs:526`). Проверка: полный `pnpm test`.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 00:32
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача, не epic) — план записан в задачу.
**Решение:** вариант D отклонён — отдельный инструмент `document_edit` (как `notes` vs `append_notes`), а не edit-режим внутри `document_update`: смешение двух семантик в одном вызове и необходимость отключать noop-сверку по признаку аргумента дали бы второй рантайм внутри инструмента.
**Файлы в плане (13):**
- новый `src/mcp/document-edit.ts` — чистая логика: `DOC_SHRINK_RATIO = 0.6`, `contentShrinkCheck`, `applyBodyEdit` (семантика 1:1 с файловым `edit` из `src/agent/tools.ts:908-921`, `split/join` вместо `replace`);
- `src/mcp/tools.ts` — объявление `document_edit` в реестре, `full_replace` в схеме, guard в `documentSpec.beforeWrite`, `applied` с `bodyLengthBefore/After/truncated`, `toolDocumentEdit`, диспетчер с `withIdempotency`;
- `src/mcp/update-pipeline.ts` — `EntitySpec.applied(entity, keys, via, previous?)` (опционально, 4 существующие реализации не ломаются), передача `current` в обеих точках;
- `src/core/tool-kinds.ts` — `document_edit: 'write'`;
- тесты: новый `src/mcp/document-edit.test.mjs` (9 кейсов: замены, 0/>1, replace_all, идемпотентный повтор, `$&`, guard, full_replace, регрессия title/tags) + правки счётчиков 48→49 в `documents.test.mjs:74`, `reference-tools.test.mjs:61`, `server.test.mjs:184`, `compat-full.test.mjs:184` и трёх таблиц инварианта write-ack (`ACK_SCENARIOS`/`PARTIAL_EXEMPT`/`NOOP_SCENARIOS`);
- промпты `templates/prompts/chat-system.md` + `templates/agent-prompt.md:20` (правка существующей строки, без дубля правила);
- документация `doc-8` (раздел `document_edit` + `full_replace`) и `doc-10` (правило «документы точечно»); README не расширяется.
**Риски (8, главные):** (1) четыре фиксации числа инструментов 48 — пропуск любой даёт красный build; (2) инвариант-тесты обходят `listTools()` — новый write без сценария в трёх таблицах валит сборку; (3) ложные срабатывания guard на легитимном сокращении — митигация `retryWith {full_replace:true}` (приём VL-353); (4) `content: ''` теперь требует `full_replace: true` — проверить существующие тесты; (5) забыть `full_replace` в `documentSpec.fields` → флаг попадёт в `skipped` и ответ начнёт врать.
**Подтверждение кодом:** 31 утверждение о существующем коде с указанием строк; 8 предположений вынесены в «Не проверено» с способом проверки первым шагом Code (среди них — `beforeWrite` получает `DocumentEntity` с `body`, отсутствие прочих фиксаций числа инструментов, автоматическое подключение к чату через `chatToolDefs`).
---
author: @agent
created: 2026-11-10 00:40
---
Фаза 3 (Code) выполнена. Коммит c00af02.
**Реализовано:**
- новый модуль `src/mcp/document-edit.ts` — чистые функции без fs: `DOC_SHRINK_RATIO = 0.6`, `contentShrinkCheck(currentBody, newContent)` (подозрительно = короче более чем на 40% И не сохранено начало текущего текста; первая непустая строка, проба 60 симв.), `applyBodyEdit` — семантика файлового `edit` буквально (`split/join`, а не `replace`: `$&`/`$1`/`$$` в `new_string` вставляются как есть);
- `document_edit` в реестре `listTools()` (id, old_string, new_string, replace_all; required id/old_string/new_string) + диспетчер с `withIdempotency`;
- `toolDocumentEdit`: отказ ДО записи на 0 совпадений («не найден в теле … возможно, документ восстановлен из git») и на >1 («встречается N раз(а)» + `retryWith {replace_all:true}`); успех — `ackOk` с `applied {id, replaced, bodyLengthBefore, bodyLengthAfter, truncated}`; пустой old_string → отказ (иначе `split('')` развалил бы тело); `old_string === new_string` → noop без перезаписи файла;
- guard `document_update`: `documentSpec.beforeWrite` + поле `full_replace` (добавлено в `fields`, поэтому не попадает в `skipped`); отказ несёт `hint` («точечная правка — document_edit; осознанная замена — full_replace: true») и `retryWith {id, content, full_replace: true}`;
- `EntitySpec.applied(..., previous?)` — 4-й опциональный параметр, в `runUpdate` передаётся `current` в обеих точках (noop и после записи); `documentSpec.applied` при переписанном теле отдаёт `bodyLengthBefore/bodyLengthAfter/truncated`;
- `src/core/tool-kinds.ts`: `document_edit: 'write'` (подтверждение в чате + классификация в цикле агента);
- описания в `tools/list`: `document_update.content` — «ПОЛНАЯ замена» + отсылка к `document_edit`, описание `document_edit` — «точечная правка ТЕЛА»;
- промпты: правило в `templates/prompts/chat-system.md` (блок «Инструменты», отдельный пункт про правку документов) и в существующей строке `templates/agent-prompt.md` (без дубля правила).
**Тесты:** новый `src/mcp/document-edit.test.mjs` — 19 тестов (замена, сохранность метаданных, 0 совпадений с проверкой файла байт-в-байт, >1 + `retryWith`, replace_all, идемпотентный повтор с `idempotentReplay`, noop, `$&`-литерал, пустой old_string, guard/`full_replace`/пустой content, отсутствие `truncated` при росте, регрессия title/tags). Обновлены счётчики 48→49 (`documents.test.mjs`, `reference-tools.test.mjs`, `server.test.mjs`, `compat-full.test.mjs`) и фикстуры реестра (`diagnostics.test.mjs`, `tool-policy.test.mjs`, `chat-thread-restore-vl264.test.mjs`); инварианты write-ack — `document_edit` добавлен в `ACK_SCENARIOS`, `NOOP_SCENARIOS`, `PARTIAL_EXEMPT` и в `covered`.
**Проверки:** `pnpm build` — ok; полный `pnpm test` — **204 файла / 3980 тестов прошли, 4 skipped** (скипы — постоянные `skip` в `src/core/frontmatter.test.mjs`, не связаны с задачей; прогон полный, без `--exclude`/`--skip`). Затрагиваемые файлы дополнительно прогнаны отдельно (document-edit, documents, tool-classify, write-ack, write-ack-contract, phase-prompt, tool-policy, chat).
**Что осталось:** документация (`backlog/docs/doc-8` — раздел `document_edit` + `full_replace`; `doc-10` — правило «документы точечно») по запрету фазы Code не обновлялась — пишется в Close после слияния. DoD «Документация обновлена» соответственно не отмечен.
---
author: @agent
created: 2026-11-10 00:50
---
Фаза Close выполнена. Ветка vb/vl-399 слита в master (1 коммит кода c00af02 → merge 5c07709), worktree удалена, ветка vb/vl-399 удалена (worktree удалён с --force: единственным незакоммиченным содержимым был untracked-симлинк `backlog/references/data`, данные не потеряны).
**Проверки после merge.** `pnpm build` — ok. Ранний точечный фильтр по diff: 7 файлов / 142 теста — ok. Полный `pnpm test` — **203 из 204 файлов, 3979 из 3984 тестов прошли, 4 skipped** (постоянные `skip` в `src/core/frontmatter.test.mjs`); единственное падение — `src/web/orchestrator.test.mjs` («startPhase close (qwen): файл задачи закоммичен после записи token_usage», VL-277), классифицировано как тайминговый флак: тест ждёт fire-and-forget коммит с дедлайном 4 с, к диффу VL-399 отношения не имеет (трогает оркестратор/close-коммит), изолированно проходит целиком — 89/89. Параллельного `vitest` в других worktree не было (`ps aux | grep vitest` пуст). Причина повтора зафиксирована здесь же; повторный полный прогон был один и зелёный.
**Документация (DoD 2 закрыт в фазе Close, коммит e9517ca):**
- doc-8 — раздел `document_update` переписан (таблица с `content` как ПОЛНОЙ заменой и новым `full_replace`, абзац про guard от молчаливой потери тела, `bodyLengthBefore/After`/`truncated` в `applied`); добавлен раздел `### document_edit — точечная правка тела (VL-399)` с таблицей параметров и семантикой отказов (0 совпадений, >1, пустой `old_string`, noop, `split/join` вместо `replace`); счётчик инструментов в шапке 45 → 49 (был устаревшим — реестр фактически `listTools()` = 49).
- doc-10 §5 «Инструменты» — счётчик 45 → 49, `document_*` включает `edit`, добавлен абзац «Документы правятся точечно (VL-399)»: правило, порог `DOC_SHRINK_RATIO = 0.6`, причина (инцидент 2026-11-10 с doc-10), адреса реализации (`src/mcp/document-edit.ts`, хук `beforeWrite`).
- CHANGELOG.md — запись в `[Unreleased]` / «Добавлено» с полным разбором дефекта, новой семантикой и списком тестов/документов.
- README не трогал (лимит 150 строк, `src/web/readme-standard.test.mjs`); файл остался 90 строк.
**Урок.** lesson-251 («Передавай document_update полный content…», kind=workaround) обновлён, а не задублирован: его условие снятия обхода — «появление у документа режима частичной правки» — выполнено этой задачей. Урок переведён в `kind: rule`: точечная правка теперь штатная (`document_edit`), обход через `node -e`/`edit` по backlog/docs снят, правило про чтение noop сохранено. Связи: lesson-251 ↔ VL-399, `lessons` задачи = [lesson-251]. Коммит lessons — 8963f13.
DoD: 1 (Тесты проходят) — по полному прогону с классификацией единственного падения как флака, повтор зелёный; 2 (Документация обновлена) — doc-8, doc-10, CHANGELOG; 3 (Нет регрессий) — сборка ok, все тесты VL-399 зелёные (новый файл 19 тестов + обновлённые счётчики/инварианты).
---
<!-- COMMENTS:END -->