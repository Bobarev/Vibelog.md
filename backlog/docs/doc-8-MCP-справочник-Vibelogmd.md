---
id: doc-8
title: MCP-справочник Vibelog.md
type: guide
created_date: 2026-10-06
tags:
  - mcp
  - reference
  - vl-21
---
# MCP-справочник Vibelog.md

45 инструментов MCP-сервера (stdio, JSON-RPC 2.0). Совместимо с Backlog.md.
Автоматическое подключение: `vibelog init` пишет `mcpServers` в `.qwen/settings.json`
(ручная настройка — в [MCP-SETUP.md](../MCP-SETUP.md)).

Формат вызова:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "backlog_create_task",
    "arguments": { "title": "Пример" }
  }
}
```

Смотрите также: [Руководство пользователя](user-guide.md) · [CLI-справочник](cli-reference.md)

---

## Задачи

### backlog_create_task — создать задачу

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `title` | string | ✓ | Заголовок |
| `description` | string | | Описание |
| `priority` | string | | High / Medium / Low |
| `labels` | string[] | | Метки |
| `dependencies` | string[] | | ID зависимостей |
| `acceptanceCriteria` | string[] | | Тексты критериев |
| `status` | string | | Статус (в веб-чате по умолчанию **Spec** — ассистент выполняет фазу spec; вне чата — из конфига) |
| `assignee` | string[] | | Исполнители |
| `milestone` | string | | Веха |
| `type` | string | | Тип (bug, feature, ...) — валидация по конфигу |
| `parentTaskId` | string | | ID родительской задачи (валидируется существование) |
| `due_date` | string | | Срок (YYYY-MM-DD) |
| `ordinal` | number | | Порядковый номер |
| `project` | string | | Проект |
| `finalSummary` | string | | Итоговое резюме |

### backlog_list_tasks — список задач

| Параметр | Тип | Описание |
|---|---|---|
| `status` | string | Фильтр по статусу |
| `labels` | string[] | Фильтр по меткам |
| `milestone` | string | Фильтр по вехе |
| `type` | string | Фильтр по типу |
| `parentTaskId` | string | Фильтр по родительской задаче |
| `ready` | boolean | Только без невыполненных блокеров |
| `sort` | string | priority / created / updated |
| `limit` | number | Максимум задач |
| `fields` | string[] | Отбор полей карточки (VL-260): `id,title,status,priority,type,project,labels,assignee,milestone,parent_task_id`; неизвестный ключ не прерывает вызов. Без `fields` — прежний массив; с `fields` при неизвестных ключах — `{ tasks, _warning }` |

### backlog_view_task — просмотр задачи

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `fields` | string[] | | Выбор возвращаемых полей Task; порядок ключей в ответе = порядок в `fields`; без параметра или при пустом массиве — полное представление (обратная совместимость; VL-162). Канонические ключи: `id, title, status, priority, assignee, reporter, labels, milestone, type, project, parent_task_id, created_date, updated_date, due_date, ordinal, description, acceptance_criteria, definition_of_done, implementation_plan, implementation_notes, final_summary, modified_files, references, lessons, documentation, token_usage` (регистр не важен: `modifiedFiles` → `modified_files`, VL-236). Алиасы: `notes`/`note` → `implementationNotes`, `plan`/`plans` → `implementationPlan`, `ac` → `acceptanceCriteria`, `dod` → `definitionOfDone`, `summary` → `finalSummary`. Неизвестный ключ **не прерывает вызов** (VL-260): остальные поля возвращаются, в ответе появляется `_warning` с проигнорированными именами, fuzzy-подсказкой ближайших и полным списком допустимых |

**Поведение `fields` при ошибке в имени (VL-260).** Реестр допустимых ключей — рантайм `Object.keys(task)`, статический список в `description` схемы лишь подсказка (lesson-32), новые поля `Task` валидны автоматически. Неизвестные имена игнорируются: ответ содержит запрошенные поля и ключ `_warning` вида «Неизвестные поля проигнорированы: phase. Ближайшие: implementationPlan, implementationNotes. Допустимые: …»; если все запрошенные поля неизвестны — ответ `{ _warning }` без ошибки. При валидных именах ключа `_warning` в ответе нет (контракт VL-162 «ровно запрошенные ключи» сохраняется). Валидация типа сохранилась: `fields` не массив или содержит не-строки — ошибка. Тот же хелпер обслуживает `backlog_list_tasks` и `backlog_search`.

### backlog_update_status — смена статуса

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `status` | string | ✓ | Статусы читаются из конфига |

### backlog_update_task — универсальное обновление

Обновляет только переданные поля.

Обязательность `id` валидируется на границе MCP-слоя (VL-183): вызов без `id` или с пустой строкой возвращает понятную ошибку «Не передан id задачи (параметр "id").» вместо TypeError из core (`getTask`/`findTaskFilePath`). Семантика `type`: `null` — поле не трогается (не стирается), `''` — явный сброс в `''`, значение не-string — ошибка «Недопустимый тип …».

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `title`, `description`, `priority`, `assignee`, `labels`, `milestone`, `type`, `status` | — | | |
| `parentTaskId` | string | | Родительская задача; пустая строка — сброс |
| `plan` | string | | Implementation Plan (полная замена) |
| `notes` | string | | Implementation Notes (полная замена) |
| `append_notes` | string | | Дописать в конец заметок |
| `final_summary` | string | | Итоговое резюме |
| `modifiedFiles` | string[] | | Изменённые файлы (полная замена `modified_files`; Фаза 3 пишет, Фаза Close читает) |
| `acceptanceCriteria` | string[] | | Критерии приёмки: полная замена чеклиста, все пункты создаются неотмеченными (симметрия с `backlog_create_task`; JSON-строка массива тоже принимается; VL-219) |
| `references` | string[] | | ID референсов задачи (полная замена поля `references`; VL-152, использует фаза Code) |
| `lessons` | string[] | | ID lessons задачи (полная замена поля `lessons`; VL-153, связывают фазы Close/Code) |
| `idempotencyKey` | string | | Ключ идемпотентности (≤200 символов): повтор с тем же ключом НЕ применяет изменения второй раз, а возвращает результат первого применения (VL-262) |

#### Контракт ответа write-инструментов (VL-262)

`backlog_create_task`, `backlog_update_task`, `backlog_update_status`, `backlog_add_comment`, `backlog_update_dependencies` отвечают **JSON-снимком** вместо «голого» текста:

```json
{ "ok": true, "message": "Задача VL-42 обновлена: title, labels", 
  "applied": { "title": "…", "labels": ["a"] }, "skipped": [ { "field": "definitionOfDone", "reason": "неизвестное поле инструмента" } ] }
```

- `message` сохраняет прежние формулировки («создана»/«обновлена») — substring-проверки и промпты продолжают работать.
- `applied` — значения полей **после** записи (читаются из сохранённой задачи), а не перечисление аргументов; `applied` всегда атомарен: обновление с несколькими полями либо применяется целиком, либо не применяется вовсе (все валидации — до единственной записи файла).
- `skipped` — переданные ключи вне известного набора полей (опечатка, camelCase-вариант) и переданный `null`: раньше они молча игнорировались, теперь перечислены с причиной.
- `idempotentReplay: true` — ответ отдан из кэша идемпотентности (`.vibelog/idempotency.json`, TTL 24 ч, кап 200 записей), второй эффект не выполнялся.
- `noop: true` + `ok: false` + `reason: 'noop'` (VL-303/VL-304, универсально с VL-310) — вызов **не изменил состояние**: все переданные поля уже имели запрошенные значения, поэтому файл не переписан (в частности, `updated_date`/mtime не сдвинулись). Маркер приходит от **любого** write-инструмента MCP с полями-значениями: `backlog_update_task`, `document_update`, `reference_update`, `lesson_update`, `backlog_update_status`, `backlog_update_dependencies`, `milestone_rename`, `lesson_link`, `reference_link`; инструменты, где noop неприменим по природе (create/remove/sync/add/audit/classify), перечислены с причиной в инвариант-тесте `src/mcp/write-ack-contract.test.mjs`. В ответе есть `applied` (фактические значения) и `message` с явным следующим шагом. **Noop — это ошибка, а не успех (lesson-92):** MCP-сервер дополнительно ставит протокольный `isError: true` (детект — экспорт `isNoopAck(text)`), нейтральный `ok: true` модели читаются как «принято, продолжай» и порождают луп:

```json
{ "ok": false, "noop": true, "reason": "noop",
  "message": "Изменений нет: type уже имеют эти значения. Следующий шаг: backlog_finish_phase (или следующий шаг плана) — повтор этого вызова ничего не изменит.",
  "applied": { "type": "feature" }, "skipped": [] }
```

Модель должна трактовать `noop` как «работа сделана, переходи к следующему шагу» — повтор вызова с теми же аргументами бесполезен; повтор уже применённой сигнатуры агентский цикл **не исполняет** и **не завершает ран терминально**: модели уходит директива «изменения применены — переходи к отчёту», серия подряд ограничена капом `MAX_APPLIED_REPEATS_PER_RUN = 3`, после чего — честный `fail()` с `is_error: true` (VL-310; до VL-310 первый повтор закрывал ран «штатно», из-за чего сессия `agent-1793637056809` оборвалась с несделанной работой). Сравнение «всё уже так» семантическое: массивы (`labels`, `assignee`, `references`, `lessons`, `modifiedFiles`, `dependencies`, `tags`) сравниваются как множества (порядок не значим), `acceptanceCriteria` — по текстам при условии, что все текущие пункты не отмечены, `type` — уже нормализованным, тело документа (`content`) и `reference.description` сравниваются с телом записи. Исключение: `append_notes` никогда не даёт `noop` — дописывание в заметки всегда меняет файл; `lesson_link`/`reference_link` сверяют **обе стороны** связи (расхождение — реальное изменение).

Отказ подтверждения приходит как `{ "ok": false, "denied": true, "reason": "denied" | "not_confirmed", "applied": {}, "skipped": [...], "message": "...", "hint": "..." }`:
`reason='denied'` — пользователь отказал (повтор без нового решения бессмыслен); `reason='not_confirmed'` — подтверждение не получено (не отказ: вызов можно безопасно повторить с тем же `idempotencyKey`). В обоих случаях состояние не изменено, `skipped` перечисляет неприменённые поля.

### backlog_manage_ac / backlog_manage_dod — чеклисты

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `action` | string | ✓ | add / check / uncheck / remove / list |
| `text` | string \\\\| string[] | | Для action=add: строка — один пункт; массив непустых строк — несколько за один вызов (batch-add, ответ «Добавлено критериев: N (…)»); JSON-строка массива (`'["A", "B"]'`) тоже принимается — разбирается, каждый элемент становится отдельным критерием (симметрия с `index`; битый JSON или не-массив уходит в scalar-текст как есть; VL-183) |
| `index` | number \\\\| string \\\\| (number\\\\|string)[] | | Для check/uncheck/remove: целое с 1; строка-число (`"3"`); массив `[1,2,3]` — несколько за один вызов; строка-массив `"[1, 2]"` тоже принимается; `"all"` — все пункты списка. Валидация каждого элемента: целое ≥1 и ≤ длины, иначе ошибка со списком пунктов (дробь/NaN/пусто — с подсказкой формата). Батч-ответ: «Отмечено пунктов: N (1, 2, 3)» / «Снято пунктов» / «Удалено пунктов»; scalar-ответ — прежний («Отмечены критерии #2»). Внимание: `action:'remove', index:'all'` чистит весь чеклист |

### backlog_add_comment — комментарий

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `comment` | string | ✓ | |
| `author` | string | | По умолчанию `@agent` |

### backlog_update_dependencies — зависимости

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `add` | string[] | | Добавить зависимости (детект циклов) |
| `remove` | string[] | | Удалить зависимости |

### backlog_search — поиск с фильтрами

| Параметр | Тип | Описание |
|---|---|---|
| `query` | string | Токены через пробел/пунктуацию, требуется вхождение **всех** (И-логика); учитывается усечение основы (первые 5 символов: «модель» найдёт «моделями»); выдача — по релевантности; `limit` усекает, полное число совпадений — в `found` (необязателен) |
| `status`, `type`, `project`, `priority` | string | Фильтры полей (AND) |
| `modifiedFiles` | string[] | Подстрока в modified_files задачи |
| `hasLessons` | boolean | Задачи с (true) / без (false) связанных lessons (VL-153) |
| `fields` | string[] | Отбор полей карточки результата (VL-260): `id,title,status,priority,type,project,labels,milestone`; неизвестный ключ не прерывает вызов — в корень ответа добавляется `_warning` (см. backlog_view_task) |
| `limit` | number | 1–100 |

**Ранжирование (VL-237).** Запрос токенизируется (lowercase, разделители — пробелы и пунктуация; дефис/подчёркивание сохраняются, чтобы `VL-237` и `deps.ts` не разваливались). Требуется вхождение **всех** токенов (И-логика) хотя бы в одном поле: для одного слова поведение ≈ прежнему substring плюс усечение основы. Веса: точное совпадение `id` (1000) » `id` содержит (500) » `title` (100) » `labels` (50) » `description` (10); порядок при равном счёте детерминирован: score desc → `created_date` desc → `id` asc. Морфология — усечение основы: для токенов длиной ≥6 символов сравниваются первые 5 символов (полноценного стеммера нет, ложные срабатывания на коротких основах приемлемы); слова с дефисом не усекаются.

**Форма ответа:** объект `{ found, returned, tasks }` — `found` — полное число совпадений (до `limit`), `returned` — сколько отдано. Массив верхнего уровня больше не возвращается (VL-237): агент видит полноту выдачи и не переформулирует запрос вслепую. При `fields` с неизвестными ключами к объекту добавляется `_warning` (VL-260); карточки в `tasks` содержат только запрошенные поля.

### backlog_finish_phase — завершение фазы одним вызовом (VL-138)

Атомарно по файлу: статус + отчётный комментарий + modifiedFiles + батч-отметки AC/DoD за один вызов (замена цепочки `add_comment` → `update_status` → `update_task(modifiedFiles)` → `manage_ac/dod check`).

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `status` | string | | Новый статус. Валидируется дважды: по конфигу (невалидный — пропускается с ошибкой в сводке) и на право перехода (см. ниже, VL-245) |
| `comment` | string | ✓ | Отчётный комментарий (author фиксирован `@agent`). Отсутствующий/пустой — **жёсткая ошибка** `Неполный вызов: … comment (report) не передан` (VL-251); файл задачи и usage при этом не трогаются |
| `modifiedFiles` | string[] | | Изменённые файлы (полная замена `modified_files`) |
| `acChecks` | (number\\\\|string)[] | | Индексы AC для батч-отметки (с 1, как в `manage_ac`) |
| `dodChecks` | (number\\\\|string)[] | | Индексы DoD для батч-отметки (с 1, как в `manage_dod`) |
| `tokenUsage` | object | | Учёт токенов (VL-198): `{input, output, cache, total, requests}` — finite числа ≥0. Дописывается дельтой в `token_usage` frontmatter задачи (по фазам, без двойного учёта — см. lesson-58). Если не передан **или все значения нулевые** (VL-251) — fallback: env `VIBELOG_SESSION_ID` → мета сессии → JSONL (`sumUsageFromMessages`); без сессии — ошибка в сводку, остальное применяется |
| `phase` | string | | Редкий override фазы для `by_phase` (обычно из env `VIBELOG_PHASE_NAME` или мете сессии) |
| `aborted` | boolean | | Явный сигнал «фаза завершается аварийно» (VL-244): при `true` статус-переход `produces_status` НЕ применяется — флаг пишется в transient-кэш (`markPhaseAborted`), и `finalizePhaseStatus` уходит в fail-ветку: откат к статусу до фазы + машинный комментарий-причина. Используется аварийными ветками шаблонов `phase-close*.md` вместо отчёта без `status`. Переданный вместе с `aborted` явный `status` всё равно применяется (приоритет действия агента) |
| `dodOverride` | string | | Причина закрытия задачи с невыполненными пунктами DoD (VL-248). Проверка выполняется ДО любых записей: если итоговый (терминальный по workflow) статус ставится при непустом списке непройденных DoD (эффективный список = `updates.definitionOfDone ?? task.definitionOfDone`, т.е. учитываются `dodChecks` этого же вызова) и `dodOverride` пуст или отсутствует — вызов отклоняется (MCP `isError: true`), файл задачи, комментарий и usage не меняются. Причина попадает в комментарий-отчёт строкой `DoD override: <причина>`. Поле НЕ в `required` — условная обязательность enforced только ошибкой |

**Аварийное завершение (VL-244).** Флаг `aborted` — единственный надёжный сигнал: без него завершение процесса с кодом 0 применяет `produces_status`, и, например, close-фаза с незавершённым merge поставит задаче Done (инцидент VL-219). Fallback по финальному тексту/`logTail` («не завершена», «прервана») остаётся только диагностикой. В сводке результат виден строкой `aborted: фаза помечена прерванной (статус не применён)`, а если записи транзиента нет (служебная фаза) — `aborted: фаза вне транзиента (флаг не сохранён)`, без ошибки.

Частичное применение: невалидное поле (статус вне конфига, битый индекс) пропускается с понятным сообщением, вызов не падает; все валидные обновления применяются одной записью (файл атомарен). Результат — сводка вида «Статус: Review; отчёт добавлен; отмечено AC: 2, DoD: 1; файлов: 3» (+ `Ошибки: …` при наличии). Несуществующая задача — фатальная ошибка.

**Жёсткая валидация (VL-251)** выполняется до любых записей и бросает ошибку (MCP `isError: true`): отсутствующий `comment` и `status`, **равный текущему** статусу задачи (`Фаза уже завершена: статус «X» совпадает с текущим` + дата/автор/начало существующего отчёта + следующий шаг). Причина: нейтральный успех на no-op выглядел для модели как «принято, но чего-то не хватает» и провоцировал байт-в-байт повторы (инцидент VL-234). Сценарий «повторный finish безопасен» сознательно убран.

**Валидация перехода по фазе workflow (VL-245).** Кроме проверки по `config.statuses`, статус проверяется на право перехода относительно фазы вызывающего — иначе инварианты workflow (их знал только оркестратор) не действовали на MCP-границе, и служебная фаза `comment` выставила `Done` незавершённой задаче (инцидент VL-219/VL-231).

- **Служебная фаза** (`comment`, `prompt`, `analyze`, `investigation`, `resume` и прочие из `SERVICE_PHASES`) не меняет workflow-статус вообще: переход отклоняется, статус не пишется, отчёт и AC/DoD/modifiedFiles применяются (частичное применение). Ручной перевод задачи из comment-фазы — через CLI (`vibelog task edit --status`) или веб-API (`PATCH /api/tasks/:id`).
- **Рабочая фаза** может выставить ровно `produces_status` перехода «текущий статус + фаза» (`getStatusAfterPhase`). Например, `close` из `Review` → `Done` разрешено, `close` из `To Do` → `Done` — нет. Правило считается по `getWorkflowForTask(cwd, task)`, поэтому кастомные `workflows`/`task_workflows` из `.vibelog/settings.json` уважаются; кастомная фаза без перехода статус не двигает.
- **Источник фазы — только доверенный:** `VIBELOG_RUN_PHASE` → `VIBELOG_PHASE_NAME` (кроме служебного `prompt`) → `meta.lastRunPhase` → `meta.phase` меты сессии. Аргумент `phase` самого инструмента в проверке **не участвует** — он остаётся только для учёта `token_usage.by_phase` (VL-259), иначе модель могла бы выписать себе разрешение, передав `phase: "close"`.
- **База проверки — статус до фазы.** Во время рана транзиент VL-196 временно держит задачу в `In Progress`, а агент передаёт статус, посчитанный от исходного; поэтому из `.vibelog/phase-in-progress.json` берётся `prevStatus` (только если запись принадлежит той же фазе), иначе — физический статус задачи.
- **Fail-open:** фаза не резолвится вообще (ручной вызов из стороннего MCP-клиента) — работают прежние правила по `config.statuses`.

**Терминальный статус при невыполненном DoD (VL-248).** Смена статуса на терминальный
при непустом списке непройденных пунктов DoD больше не проходит молча: вызов отклоняется
жёсткой ошибкой до любых записей, а в тексте ошибки перечислены номера невыполненных пунктов
и три законных пути — отметить пункты в `dodChecks`, передать непустой `dodOverride` с причиной
(если задача честно закрывается с перенесённым пунктом) либо `aborted: true`, если фаза реально
не выполнена. Терминальность определяется не хардкодом имён, а workflow задачи
(`isTerminalStatus` в `src/core/workflow.ts`): у статуса нет исходящих фаз, и он либо объявлен
финальным маркером, либо достижим как `produces_status`/`initial_status` — поэтому кастомные
финалы из `.vibelog/settings.json` тоже покрыты. Проверка учитывает `dodChecks` этого же вызова
(обход «отмечу что есть» не работает). Для любого терминального статуса в сводке остаётся
предупреждение `терминальный статус при непройденных DoD: #2, #3` (+ `(override: <причина>)`
при override); жёсткое требование применяется только к явно запрошенному терминальному статусу —
вызовы без `status` (комментарий к уже закрытой задаче) не блокируются. Известное ограничение:
автоматический `produces_status` оркестратора (`finalizePhaseStatus`) вне зоны действия инструмента.

### backlog_ready — готовые к работе

Параметров нет. Возвращает задачи, у которых все зависимости выполнены.

---

## Фазы и супервизор (VL-268, doc-19)

Четыре инструмента дают чату управление фазами и очередью. Три из них — write-операции по природе (`trigger`/`queue`/`supervisor` в маркерах `isWriteOperation`), `backlog_phase_status` — read. Развязывает их не исключение из политики, а **grant на прогон** (§15 doc-19): внутри подтверждённого прогона вызовы с разрешёнными инструментами не требуют Allow/Deny, вне прогона работает обычная карточка подтверждения.

### backlog_trigger_phase — запустить фазу задачи

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | ID задачи |
| `phase` | string | | Фаза; не указана — первая доступная по workflow из текущего статуса (`getNextPhase`) |
| `comment` | string | | Комментарий к запуску: пишется в задачу до старта и подставляется в промпт фазы (`{{comment}}`) |
| `sameSession` | boolean | | Для фазы `code`: продолжить plan-сессию агента (`--resume`, VL-147); явное значение переопределяет `code_same_session` |

Отказы — отдельным текстом, без `is_error`-мусора: задача не найдена; фаза не разрешена из текущего статуса (перечень доступных); фаза уже идёт у этой задачи; превышен `max_parallel_phases`; задача вне grant активного прогона (с предложением расширить прогон). Ответ на успех — сообщение + JSON-снимок `{started, pid, queued, sameSession}`.

**Не повторяй вызов после таймаута** — идемпотентности у запуска нет (защита только in-memory `activeRuns`); состояние смотри через `backlog_phase_status`.

### backlog_phase_status — состояние запуска

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | ID задачи |

Read-only. Отдаёт из `getRun`: `running`, `phase`, `pid`, `exitCode`, `logTail`, `result`; плюс из меты последней сессии задачи (`repeat_stats`, `last_run.is_error`, `last_run.finishedAt`). `repeat_stats` берётся готовым из меты, при отсутствии — `analyzeToolRepeatsFromJsonlSync`; JSONL целиком не читается.

### backlog_auto_queue — очередь автопрогона

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `action` | `add` \| `start` \| `stop` \| `status` | ✓ | `add` — добавить задачи; `start`/`stop` — переключить автопрогон; `status` — показать очередь |
| `ids` | string[] | | ID задач для `add` (JSON-строка массива тоже принимается) |

Поверх `src/core/auto-queue.ts` с теми же правилами дедупликации, что у бота (`/auto`): `pending`/`running`/`failed_permanent` — пропуск, `done`/`failed` — реанимация в `pending`.

### backlog_supervisor — прогон (план, старт, стоп, статус)

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `action` | `plan` \| `start` \| `stop` \| `status` | ✓ | `plan` — сухой прогон; `start` — запустить (нужно подтверждение); `stop` — остановить и отозвать grant; `status` — состояние |
| `ids` | string[] | | ID задач прогона (для `plan`/`start`) |
| `expiresInHours` | number | | Срок действия grant в часах (по умолчанию 8, максимум 336) |
| `expiresAt` | string | | Явный срок действия grant (ISO 8601), приоритетнее `expiresInHours` |

`plan` ничего не пишет и не запускает: состав, порядок (High → Medium → Low, затем порядок `ids`), волны по внутренним зависимостям, `skipped` с причинами, текстовое обоснование.

**Grant на прогон** — файл `.vibelog/supervisor/grants/<runId>.json`:

```json
{
  "runId": "run-2026-10-31T22-00-00",
  "taskIds": ["VL-263", "VL-264", "VL-268"],
  "allowedTools": ["backlog_trigger_phase", "backlog_phase_status", "backlog_auto_queue", "backlog_supervisor", "backlog_create_task"],
  "grantedAt": "2026-10-31T21:58:00Z",
  "expiresAt": "2026-11-01T06:00:00Z"
}
```

Правила проверки (перед **каждым** вызовом, не при старте хода):

- задача вне `taskIds` → отказ «Задача VL-N вне прогона run-…: расширь прогон и подтверди заново»;
- инструмент вне `allowedTools` → обычный Allow/Deny;
- `expiresAt` истёк → текущая фаза доводится, новые не стартуют (карточка сообщает об истечении);
- отзыв — при `stop` и при завершении прогона (все задачи в терминальном статусе): файл получает `revokedAt`, `findActiveGrant` его больше не видит, следующие вызовы снова требуют подтверждений;
- `write_file`, `edit` и прочие файловые write-инструменты модели в grant **не входят никогда** — фильтр `GRANTABLE_TOOLS`, не пользовательский ввод;
- `backlog_finish_phase` остаётся в `CHAT_DISALLOWED_TOOLS` — grant не открывает обходного пути к завершению фазы.

**Пример.**

```json
{ "name": "backlog_supervisor", "arguments": { "action": "plan", "ids": ["VL-268", "VL-269"] } }
{ "name": "backlog_supervisor", "arguments": { "action": "start", "ids": ["VL-268", "VL-269"], "expiresInHours": 4 } }
{ "name": "backlog_trigger_phase", "arguments": { "id": "VL-268", "comment": "продолжаем после падения" } }
{ "name": "backlog_phase_status", "arguments": { "id": "VL-268" } }
```

HTTP-эндпоинты карточки: `POST /api/chat/supervisor/grant-draft` (правки состава инструментов и срока до нажатия «Разрешить») и `GET /api/chat/supervisor/grant` (активный grant + последний прогон — для восстановления карточки после перезагрузки).

---

## Вехи (milestones)

### milestone_list

| Параметр | Тип | Описание |
|---|---|---|
| `include_archived` | boolean | Включить архивные вехи |

### milestone_add

| Параметр | Тип | Required |
|---|---|---|
| `name` | string | ✓ |
| `description` | string | |

### milestone_rename

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `from` | string | ✓ | |
| `to` | string | ✓ | |
| `update_tasks` | boolean | | Обновить задачи (по умолчанию true) |

### milestone_remove

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `name` | string | ✓ | |
| `task_handling` | string | | clear / keep / reassign (по умолчанию clear) |

### milestone_archive

| Параметр | Тип | Required |
|---|---|---|
| `name` | string | ✓ |

---

## Документы (documents)

### document_list

| Параметр | Тип | Описание |
|---|---|---|
| `query` | string | Фильтр по id/title/tags/телу |

### document_view

| Параметр | Тип | Required |
|---|---|---|
| `id` | string | ✓ |

### document_create

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `title` | string | ✓ | Заголовок |
| `content` | string | ✓ | Markdown-содержимое |
| `type` | string | | readme / guide / specification / other |
| `tags` | string[] | | Теги |

### document_update

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `title`, `content`, `type`, `tags` | | | Только переданные поля |

### document_search

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `query` | string | ✓ | Поисковый запрос |

---

## Референсы (references, VL-152)

Внешние источники знаний: репозитории, URL, файлы, документация, спецификации, эксперименты. Метаданные — `backlog/references/<id>-<title>.md` (в git), клоны репозиториев — `backlog/references/data/` (в .gitignore). Типы: `repo`, `url`, `file`, `doc`, `spec`, `experiment` (VL-294 — ссылка на карточку эксперимента `backlog/experiments/exp-<id>.md`). Двусторонняя связь с задачами: `reference.linked_tasks` ↔ `task.references` (Plan-фаза читает источники задачи, Code-фаза добавляет новые).

### reference_list — список референсов

| Параметр | Тип | Описание |
|---|---|---|
| `type` | string | Фильтр по типу (repo / url / file / doc / spec / experiment) |
| `tags` | string[] | Фильтр по меткам |

### reference_add — создать референс

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `title` | string | ✓ | Заголовок |
| `type` | string | ✓ | repo / url / file / doc / spec / experiment |
| `url` | string | | Первая ссылка источника |
| `urls` | string[] | | Дополнительные ссылки (VL-291); полный набор = `[url, ...urls]`, порядок = порядок секций кэша |
| `path` | string | | Локальный путь (относительно backlog/) |
| `tags` | string[] | | Метки |
| `description` | string | | Описание (тело документа) |
| `clone` | boolean | | Для type=repo: клонировать репозиторий в `data/<dir>` (по умолчанию true; идемпотентно — существующий клон пропускается) |
| `cache` | boolean | | Скачать ссылки и сохранить markdown-кэш; при нескольких `url`/`urls` кэш склеивается в один md секциями в порядке ссылок |

### reference_view — метаданные + описание

| Параметр | Тип | Required |
|---|---|---|
| `id` | string | ✓ |

Возвращает метаданные, linked_tasks и тело документа. Для референса с кэшем — `cached_markdown`, `cached_at`, `source_hash`; `urls_all` содержит полный упорядоченный список ссылок `[url, ...urls]` (VL-291).

Частичный сбой при `cache: true`: кэш записывается, упавшая ссылка помечена в md как `⚠ Ошибка загрузки: …`, ответ несёт признак частичного успеха (`partial` + список `failed`); если не удалась ни одна ссылка — кэш не создаётся.

### reference_search — поиск

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `query` | string | ✓ | Substring по id / title / url / tags / body |

### reference_remove — удалить метаданные

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | Клон в `data/` сохраняется |

### reference_update — обновить метаданные (VL-164)

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | ID reference (ref-N) |
| `url` | string | | Первая ссылка (полная замена набора) |
| `urls` | string[] | | Дополнительные ссылки (полная замена набора; `[]` очищает доп. ссылки) |
| `tags` | string[] | | Метки (полная замена, не merge) |
| `description` | string | | Описание (markdown, полная замена тела) |

Обновляет только переданные поля. Несуществующий id — ошибка «Reference … не найден.»; вызов без `url`/`urls`/`tags`/`description` — ошибка «Не указаны поля для обновления (url, urls, tags, description).» Передача `urls` без `url` сохраняет прежнюю первую ссылку, если она не входит в новый набор (VL-291).

### reference_link — двусторонняя связь с задачей

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `referenceId` | string | ✓ | |
| `taskId` | string | ✓ | |
| `action` | string | ✓ | add / remove — правит `linked_tasks` референса И `references` задачи |

### reference_sync — доклонировать отсутствующие репозитории

Параметров нет. Обходит все references type=repo, клонирует отсутствующие (для разработчиков, склонировавших проект без `data/`). Возвращает {cloned, skipped, failed}.

---

## Lessons learned (lessons, VL-153)

Workflow-уроки из опыта задач — предотвращают повторение ошибок. Файлы — `backlog/lessons/lesson-N-<slug>.md` (YAML-фронтматтер: id, title, status, tags, source_tasks, linked_tasks, created_date, updated_date, supersedes, last_verified, verified_by, applies_to, kind; тело — «Проблема / Решение / Пример»). Статусы: `active` (по умолчанию) / `needs-review` / `outdated` / `superseded`.

Поля актуальности (VL-279, additive — старые файлы без них читаются с дефолтами): `last_verified` (YYYY-MM-DD — когда урок последний раз проверен), `verified_by` (`auto|agent|human`), `applies_to` (string[] — glob путей и/или имена символов, которые аудит валидирует механически), `kind` (`rule|workaround|fact`). Настройки аудита — секция `lessons` в `.vibelog/settings.json`: `duplicate_threshold` (0.35), `stale_days` (180), `prompt_limit` (5).

`loadLessonsForTask` подставляет в промпт Plan/Code только `active`-уроки, отбрасывая `needs-review`/`outdated`/`superseded` и протухшие (`last_verified`/`updated_date` старше `stale_days`), сортирует по свежести и капит top-N — устаревшая инструкция не попадает в промпт.

Отличие от других сущностей: references — внешние источники; decisions — архитектурные решения («почему X, не Y»); docs — документация проекта; **lessons — workflow-уроки**, которые эволюционируют независимо от замороженных задач. Двусторонняя связь с задачами: `lesson.linked_tasks` ↔ `task.lessons`. Plan-фаза получает активные lessons по tags/labels задачи в промпт через `{{taskLessons}}` (0 дополнительных ходов модели); Close-фаза пишет уроки автоматически (шаг 6.5), Code связывает применённые.

### lesson_list — список lessons

| Параметр | Тип | Описание |
|---|---|---|
| `status` | string | Фильтр: active / needs-review / outdated / superseded |
| `tags` | string[] | Фильтр по меткам (все указанные должны совпасть) |

### lesson_create — создать lesson

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `title` | string | ✓ | Заголовок (императив, 1 предложение) |
| `tags` | string[] | | Метки |
| `sourceTasks` | string[] | | Откуда урок (ID задач) |
| `content` | string | | Тело (Проблема / Решение / Пример) |

id генерируется (`lesson-N`), даты — сегодня.

### lesson_view — метаданные + тело

| Параметр | Тип | Required |
|---|---|---|
| `id` | string | ✓ |

### lesson_update — обновить lesson

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `id` | string | ✓ | |
| `title`, `status`, `tags`, `sourceTasks`, `linkedTasks`, `content`, `lastVerified`, `verifiedBy`, `appliesTo`, `kind` | | | Только переданные поля; смена title переименовывает файл; `lastVerified`/`verifiedBy` — отметка проверки актуальности, `appliesTo` — glob путей/имена символов, `kind` — rule/workaround/fact (VL-279) |

### lesson_search_lessons — поиск

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `query` | string | ✓ | Substring по id / title / tags / телу |

### lesson_link — двусторонняя связь с задачей

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `lessonId` | string | ✓ | |
| `taskId` | string | ✓ | |
| `action` | string | | add (по умолчанию) / remove — правит `linked_tasks` lesson И `lessons` задачи |

### lesson_supersede — заменить lesson

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `oldId` | string | ✓ | Заменяемый lesson → статус `superseded` |
| `newId` | string | ✓ | Новый lesson → `supersedes: oldId`, статус `active` |

### lesson_audit — механический аудит актуальности (VL-279)

Детерминированный (без LLM) аудит корпуса уроков: возвращает `findings[]` по каждому lesson (тип + детали) и сводку по типам. **Read-only по умолчанию** — записи только по явному перечислению ID.

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `threshold` | number | | Порог схожести дублей 0..1 (дефолт — `lessons.duplicate_threshold` или 0.35) |
| `staleDays` | number | | Порог протухания в днях (дефолт — `lessons.stale_days` или 180) |
| `write` | boolean | | Записать отчёт в `backlog/lessons/AUDIT.md` (по умолчанию `false` — только ответ) |
| `verified` | string[] | | ID уроков: отметить проверенными (`last_verified=today`, `verified_by=auto`) |
| `needsReview` | string[] | | ID уроков: перевести в статус `needs-review` |

Типы находок: `missing_path` (путь/`applies_to`-glob из тела урока не существует в репо), `dangling_task` (`source_tasks`/`linked_tasks` на несуществующую задачу), `broken_supersede` (`supersedes` на несуществующий ID или на себя), `supersede_cycle` (цикл замен), `duplicate_of` (кандидаты на объединение: взвешенная схожесть заголовка/tags/тела), `stale` (нет `linked_tasks` и source-задачи закрыты, либо `updated_date`/`last_verified` старше порога; уроки `superseded`/`outdated` в stale не попадают). Массовых изменений без флагов/ID инструмент не делает — путь мог исчезнуть из-за рефакторинга, а урок при этом остаётся верным по смыслу.

### lesson_classify — классификация уроков и техдолг из workaround (VL-280)

LLM-путь, **opt-in**: не входит ни в один автоматический прогон и в CI-аудит (`lesson audit` остаётся детерминированным и дешёвым). Решает проблему «обход, легализованный как урок»: такой урок в статусе `active` подставляется в промпты Plan/Code, и модель учится обходить проблему вместо того, чтобы её решить.

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `ids` | string[] | | ID уроков (`lesson-N`); приоритетнее фильтра |
| `status` | string | | Фильтр по статусу (`active`/`needs-review`/`outdated`/`superseded`) |
| `tags` | string[] | | Фильтр по меткам (любое пересечение) |
| `limit` | number | | Максимум уроков в выборке (по умолчанию 20 — дорогой путь не уходит на весь корпус) |
| `apply` | boolean | | Записать `kind` во фронтматтер всем классифицированным (по умолчанию `false`) |
| `confirmIds` | string[] | | ID уроков, которым `kind` разрешено записать (точечное подтверждение вместо `apply`) |
| `createClusters` | string[] | | ID кластеров (из ответа), для которых создавать задачи техдолга — единственный способ создания |
| `maxTasks` | number | | Лимит задач за вызов (дефолт — `lessons.tech_debt_max_tasks` или 1) |

Выход: для каждого урока `kind` ∈ `rule` (правило поведения), `workaround` (обход причины дефекта), `fact` (утверждение о коде, проверяемое тестом), `stale` (устаревший контекст) + обоснование 1–2 предложения. Контекст модели — тело урока (кап 1800 символов) и **findings `lesson_audit`** (`missing_path`, `dangling_task`, `stale`, `duplicate_of`) как факты: порог «протухания» передаётся в промпт, а не хардкодится в коде. `stale` никогда не пишется в `kind` — это вердикт статуса (`needs-review`/`outdated`), его проставляет человек.

Кластеризация `workaround`-уроков детерминированная: union-find по общим путям (`extractLessonPaths` + `applies_to`) и по «специфичным» tags (метка, встречающаяся у ≤ 1/3 уроков-обходов; `tests`/`workflow` не склеивают корпус в одну задачу). ID кластера — `tag:…` / `path:…` / `lesson:…`, он и передаётся в `createClusters`.

Черновик задачи техдолга (`buildTechDebtDraft`) содержит причину обхода, цитаты уроков-источников, затронутые пути, критерий «workaround больше не нужен» и строку «что переводить в `outdated`/`superseded`». Создание — только по `createClusters`, не более `maxTasks` задач за вызов; идемпотентность — поиск существующей задачи с меткой `tech-debt` и ID урока в тексте. Каждая созданная задача двусторонне связана с уроками (`lesson_link`), а в теле урока появляется раздел `## Устранение` со ссылкой на задачу — при её закрытии видно, какой урок пора снять.

Ошибки LLM (таймаут, невалидный JSON, неизвестный `kind`) не пишут ничего в файлы: они возвращаются отчётом по конкретному уроку, остальные продолжают обрабатываться.

```
lesson_classify {"tags":["tests"], "limit":10}
lesson_classify {"ids":["lesson-113","lesson-120"], "apply":true,
                 "createClusters":["tag:env"]}
```

---

## Git

### git_commit — детерминированный коммит явными путями (VL-311)

Узкий write-инструмент: коммит только переданных путей, с автоматическим трейлером `Co-authored-by` и сверкой с задачей. Заменил текстовые правила шаблонов фаз («никогда `git add -A`», «передай трейлер вторым `-m`»), которые держались только на дисциплине модели.

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `paths` | string[] | ✓ | Явные пути коммита относительно проекта; непустой массив. Выполняется только `git add -- <paths>` |
| `message` | string | ✓ | Сообщение коммита: тема и (опционально) тело |
| `amend` | boolean | | `true` — переписать последний коммит: сообщение собирается из полного тела `git log -1 --pretty=%B`, тело сохраняется, трейлер не дублируется |
| `allowForeign` | boolean | | Разрешить пути вне `modified_files` задачи (осознанный случай) |

Что делает: (1) резолвит пути внутри проекта коммита — абсолютный путь, `.`, `-A`/`--all`, маски и выход за пределы проекта отклоняются до любых git-команд; (2) сверяет пути с `modified_files` задачи — чужие отклоняются с перечислением и подсказкой `allowForeign: true` (пустой список задачи сверку не блокирует, вне фазовой сессии она пропускается); (3) проверяет индекс — посторонние staged-файлы чужих процессов дают отказ; (4) ставит трейлер через `appendCommitTrailer`/`resolveCommitCoauthor` (`src/core/commit-trailer.ts`, настройка `commit_coauthor`, по умолчанию включена); (5) отвечает JSON-ack.

Ответ — контракт write-инструментов (VL-306/VL-310):

```json
{ "ok": true, "message": "Коммит a1b2c3d создан: feat: VL-42 — суть",
  "applied": { "hash": "a1b2c3d…", "subject": "feat: VL-42 — суть", "paths": ["src/core/foo.ts"] } }
```

- нет изменений по переданным путям → `{ "ok": false, "noop": true, "reason": "noop", "applied": { "paths": [...] } }` — коммит **не создан**, это сигнал «переходи к следующему шагу» (совместимо с `appliedSignatures`/`noopSignatures` из VL-310);
- отказ (чужой путь, посторонний staged, путь вне проекта, ошибка git) → `ackError` с русским текстом и готовым следующим шагом;
- `applied.warnings` — файлы чужого worktree с mtime позже `VIBELOG_RUN_STARTED_AT` (предупреждение о возможной гонке, не блокировка);
- `applied.amended: true` — коммит был amend'ом.

Все git-вызовы — `spawnSync('git', args, { cwd })` без shell: `message` и пути передаются аргументами, инъекция невозможна. Необязательный параметр `cwd` (путь внутри проекта) нужен шагу 2 шаблона `phase-close-worktree.md`, который коммитит worktree задачи из фазы close.

Граница: инструмент узкий — только commit. `status`, `log`, `diff`, `merge`, `worktree remove`, `branch -d`, `stash` остаются `run_shell_command` (чтение и редкие операции, обёртка не даёт выигрыша).

`isWriteOperation('git_commit') === true` (маркер `commit` в `WRITE_MARKERS`, `src/core/tool-classify.ts`); в `GRANTABLE_TOOLS` супервизора инструмент не входит.

```
git_commit {"paths": ["src/mcp/git-commit.ts","src/mcp/tools.ts"], "message": "feat: VL-311 — инструмент git_commit"}
```

---

## Карта проекта

### project_map — карта src/: путь + назначение + экспорты (VL-235)

Read-only. Один вызов вместо серии `read_file`: список модулей `src/` (файлы `.ts`, без `*.test.*`/`*.d.ts`), сгруппированный по каталогам, с первой строкой шапки-комментария и экспортами.

| Параметр | Тип | Required | Описание |
|---|---|---|---|
| `query` | string | | Подстрока по пути/описанию/экспортам; включает полные описания и все экспорты (ответ на «где реализован X») |
| `exports` | boolean | | Показать блоки экспортов (по умолчанию — если помещается в бюджет) |
| `dir` | string | | Каталог карты, по умолчанию `src` |
| `limit` | number | | Максимум модулей (по умолчанию 150); усечение помечается в ответе |

Бюджет ответа ≈8 КБ: при превышении карта сжимается ступенчато (без экспортов → короткие описания → только имена) с маркером. Нет совпадений по `query` — `Совпадений не найдено`; отсутствующий каталог — текст без исключения. В веб-чате — read-инструмент, подтверждения не требует.

```
project_map {"query":"htmlToMarkdown"}
src/core/reference-cache.ts — Локальный markdown-кэш references (VL-194). [MAX_CACHE_BYTES, …, htmlToMarkdown, …]
```

---

## Примеры вызовов

```json
// Создать задачу с типом и AC
{ "name": "backlog_create_task", "arguments": {
  "title": "Падение экспорта", "type": "bug", "priority": "High",
  "acceptanceCriteria": ["Экспорт CSV работает", "Тесты проходят"] } }

// Создать дочернюю задачу эпика (VL-69)
{ "name": "backlog_create_task", "arguments": {
  "title": "Подзадача эпика", "parentTaskId": "api-1", "type": "task" } }

// Просмотр задачи: только нужные поля — экономия контекста (VL-162)
{ "name": "backlog_view_task", "arguments": {
  "id": "api-1", "fields": ["id", "title", "description"] } }

// Поля с алиасами: notes → implementationNotes, неизвестное поле не валит вызов (VL-260)
{ "name": "backlog_view_task", "arguments": {
  "id": "api-1", "fields": ["id", "notes", "phase"] } }

// Пачка отметок AC
{ "name": "backlog_manage_ac", "arguments": {
  "id": "api-1", "action": "check", "index": [1, 2, 3] } }

// Отметить все пункты разом (VL-135)
{ "name": "backlog_manage_dod", "arguments": {
  "id": "api-1", "action": "check", "index": "all" } }

// Завершение фазы одним вызовом (VL-138)
{ "name": "backlog_finish_phase", "arguments": {
  "id": "api-1", "status": "Review", "comment": "Фаза 3 (Code) выполнена.",
  "modifiedFiles": ["src/api.ts"], "acChecks": [1, 2], "dodChecks": ["1"] } }

// Поиск: баги To Do с лимитом
{ "name": "backlog_search", "arguments": {
  "query": "экспорт", "status": "To Do", "type": "bug", "limit": 5 } }

// Задачи, готовые к работе
{ "name": "backlog_ready", "arguments": {} }

// Референсы (VL-152): добавить репозиторий с клонированием
{ "name": "reference_add", "arguments": {
  "title": "vibe-kanban", "type": "repo",
  "url": "https://github.com/BloopAI/vibe-kanban.git", "tags": ["orchestration"] } }

// Несколько ссылок в одном референсе (VL-291): кэш склеивается в один md
{ "name": "reference_add", "arguments": {
  "title": "Документация API", "type": "url",
  "urls": ["https://a.example/docs", "https://b.example/docs"], "cache": true } }

// Обновить метаданные референса (VL-164)
{ "name": "reference_update", "arguments": {
  "id": "ref-3", "tags": ["orchestration", "kanban"],
  "description": "Описание с канбаном и оркестрацией" } }

// Связать референс с задачей
{ "name": "reference_link", "arguments": {
  "referenceId": "ref-3", "taskId": "VL-100", "action": "add" } }

// Записать использованные источники в задачу (фаза Code)
{ "name": "backlog_update_task", "arguments": {
  "id": "VL-100", "references": ["ref-3", "ref-4"] } }

// Lessons (VL-153): создать урок и связать с задачей
{ "name": "lesson_create", "arguments": {
  "title": "Тесты со spawn медленные — запускай батчами по 10",
  "tags": ["core", "tests"], "sourceTasks": ["VL-153"] } }

// Записать связанные lessons в задачу (фазы Close/Code)
{ "name": "backlog_update_task", "arguments": {
  "id": "VL-153", "lessons": ["lesson-1"] } }
```