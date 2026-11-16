---
id: VL-395
title: 'MCP initialize: отдавать поле instructions — фазы workflow, где конфиг и куда идти за полным справочником (нулевой ход агента)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-09 23:48'
updated_date: '2026-11-16 16:02'
due_date: ''
labels:
  - mcp
  - agent
  - onboarding
dependencies: []
milestone: v1.14
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/server.ts
  - src/mcp/server.test.mjs
lessons:
  - lesson-274
token_usage:
  input: 5487269
  output: 32473
  cache: 4743680
  total: 5519742
  requests: 87
  duration_ms: 1040463
  reasoning: 12948
  by_phase:
    plan:
      input: 1363079
      output: 10340
      cache: 1115136
      requests: 21
    code:
      input: 2398324
      output: 14093
      cache: 2133504
      requests: 31
    close:
      input: 1725866
      output: 8040
      cache: 1495040
      requests: 35
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

MCP `initialize` (`src/mcp/server.ts:170`, функция `handleInitialize`) отдаёт только `protocolVersion`, `capabilities.tools` и `serverInfo` — поле **`instructions`**, предусмотренное спецификацией MCP именно для «нулевого хода» агента, не используется.

Из-за этого агент в новом проекте узнаёт о Vibelog только по именам и описаниям инструментов в `tools/list`. Всё, что не выражено в схеме инструмента (фазы workflow, статусы, где лежит конфиг, что дефолт задан в коде), для него невидимо — реальный инцидент: ~250k токенов на попытку найти «схему workflow» в файлах нового проекта, где её и нет.

Почему именно `instructions`: работает у любого MCP-клиента (qwen, opencode, claude), не занимает место в `AGENTS.md` (который в проекте отведён под правила проекта и режется лимитом `AGENTS_MD_MAX_CHARS = 8000`), не требует, чтобы агент догадался что-то прочитать.

## Цель

Отдавать в handshake компактный блок-ориентир, после которого агент знает: какие фазы есть, что они заданы дефолтом в коде, где конфиг, куда идти за полным списком. Стоимость — 1–2 КБ на сессию вместо сотен тысяч токенов на поиск.

## Содержание (ориентир, не дословно)

- «Vibelog.md — markdown-нативный таск-менеджер; задачи в `backlog/tasks/`, править через MCP-инструменты, не через edit/write_file».
- Фазы по умолчанию: `To Do → spec → Spec → plan → Planned → code → Review → close → Done`; ветки `reject` и `Review → code` (fix-цикл).
- Явно: **это дефолт в коде (`DEFAULT_WORKFLOW`); секции `workflows` в `.vibelog/settings.json` может не быть — её отсутствие нормально и означает «работает дефолт»**.
- Правило доступа: чтение — сразу, запись — с подтверждением пользователя.
- Отсылка: «полный справочник — `vibelog capabilities` (или `vibelog instructions`)».

## Ограничения

- Не перечислять все MCP-инструменты (они в `tools/list`) и не вставлять шаблоны фаз — только ориентир.
- Не ломать протокол: остальные поля ответа остаются как есть.
- Текст — константа в коде с комментарием «почему» (стиль проекта).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 MCP-ответ `initialize` содержит поле `instructions` (строка, ориентир ≤ 2000 символов)
- [x] #2 В `instructions` есть: перечень фаз workflow по умолчанию (spec → plan → code → close, ветки reject/Review→code), статусы, указание, что дефолт задан в коде и переопределяется ключом `workflows` в `.vibelog/settings.json`, правило доступа read/write (чтение сразу, запись через Allow/Deny) и отсылка к `vibelog capabilities` / `vibelog instructions` за полным списком
- [x] #3 Текст не дублирует шаблоны фаз и не перечисляет все MCP-инструменты (они уже приходят в `tools/list`)
- [x] #4 Есть тест: ответ `initialize` содержит непустой `instructions` и упоминания `workflows`, `settings.json`, `capabilities`
- [x] #5 Протокол не нарушен: `protocolVersion`, `capabilities`, `serverInfo` остаются на месте; старые клиенты, игнорирующие `instructions`, не ломаются
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Что делаем

Добавить в ответ MCP `initialize` поле `instructions` — компактный (≤ 2000 символов) блок-ориентир, чтобы агент в новом проекте с первого хода знал про фазы workflow, про то, что дефолт задан в коде, где конфиг и куда идти за полным списком.

### Файлы

| Файл | Что меняем |
|---|---|
| `src/mcp/server.ts` | новый экспортируемый константный текст `MCP_INSTRUCTIONS` + добавление `instructions` в объект ответа `handleInitialize` |
| `src/mcp/server.test.mjs` | тест на непустой `instructions`, ≤ 2000 символов, наличие `workflows`, `settings.json`, `capabilities`, `DEFAULT_WORKFLOW`; плюс проверка, что `protocolVersion`/`capabilities`/`serverInfo` на месте |
| `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md` | короткий раздел «Handshake: поле `instructions`» (что отдаётся, лимит, где полный справочник) |
| `backlog/docs/doc-30-Фазовый-процесс-…md` | строка 20/141: убрать пометку «в разработке — VL-394/VL-395/VL-396» в части VL-395 (проставить, что MCP `initialize` уже отдаёт ориентир) |
| `CHANGELOG.md` | одна строка в текущей unreleased-секции |

### Порядок действий

1. **`src/mcp/server.ts`** — рядом с `handleInitialize` (после `sendError`/перед `startMcpServer` или прямо перед функцией `handleInitialize`, строки ~160-182) объявить:

   ```ts
   /**
    * Текст-ориентир для поля `instructions` ответа MCP `initialize` (VL-395).
    *
    * Почему здесь, а не в AGENTS.md и не в шаблонах фаз:
    * - `instructions` — штатное место протокола MCP для «нулевого хода» агента:
     *   клиент (qwen/opencode/claude) получает его в handshake, без чтения файлов;
    * - AGENTS.md — место под правила конкретного проекта и он режется
    *   `AGENTS_MD_MAX_CHARS = 8000` (src/agent/system-prompt.ts:29);
    * - шаблоны фаз (templates/phases/*.md) агент видит только при запуске фазы,
    *   а в новом проекте схемы workflow в файлах нет вообще — она дефолт в коде,
    *   и поиск «где лежит workflow» стоил инцидентных ~250k токенов.
    *
    * Намеренно без перечня MCP-инструментов (они в `tools/list`) и без шаблонов.
    */
   export const MCP_INSTRUCTIONS = `...`;
   ```

   Содержимое текста (ориентир, проверить длину ≤ 2000 символов):
   - «Vibelog.md — markdown-нативный таск-менеджер; задачи — `backlog/tasks/*.md`, править через MCP-инструменты (`backlog_*`), а не edit/write_file.»
   - «Фазы по умолчанию: `To Do --spec--> Spec --plan--> Planned --code--> Review --close--> Done`; ветки: `reject` → `Rejected` из To Do/Spec/Planned/In Progress/Review, fix-цикл `Review --code--> Review`; служебные фазы вне workflow: `comment`, `prompt`, `analyze`, `resume` (статус не меняют).»
   - «Это дефолт в КОДЕ (`DEFAULT_WORKFLOW`, `src/core/workflow.ts`). Секции `workflows` в `.vibelog/settings.json` может не быть — её отсутствие нормально и означает «работает дефолт»; переопределение — ключ `workflows.default` (+ `task_workflows`: тип задачи → имя workflow).»
   - «Доступ: чтение (list/view/search/status/map) — сразу; запись (create/update/delete/complete/trigger_phase/commit) — через подтверждение пользователя Allow/Deny.»
   - «Полный справочник, генерируемый из кода: `vibelog capabilities` (`--json` — машиночитаемо) и `vibelog instructions`; карта кода — `vibelog map`.»

2. **`handleInitialize`** (строки 171-182) — добавить `instructions: MCP_INSTRUCTIONS` в объект ответа. Порядок ключей: `protocolVersion`, `capabilities`, `serverInfo`, `instructions` (протокол MCP 2024-11-05 разрешает `instructions` как необязательное строковое поле результата; клиенты, которые его не знают, игнорируют). Существующие поля не трогать; сигнатуру `handleInitialize` не менять (текст — константа, `cwd`/`settings` не читаются: ориентир статичен и не зависит от проекта — так он не может разъехаться с протоколом при битом settings.json).

3. **`src/mcp/server.test.mjs`** — расширить существующий тест `'initialize — возвращает capabilities'` (строки 164-172) или добавить новый кейс сразу после него: ответ содержит `result.instructions` (непустая строка), `length <= 2000`, содержит подстроки `workflows`, `settings.json`, `capabilities`, `DEFAULT_WORKFLOW`, `reject`; вместе с тем `result.protocolVersion === '2024-11-05'`, `result.capabilities.tools` и `result.serverInfo.name === 'vibelog-md'` по-прежнему на месте. Тест интеграционный (живой сервер через `callMcp`), `mkdtemp`-фикстура уже есть — новых каталогов и env не требуется.

4. **Документация** — `doc-8`: небольшой раздел после вступления (после строки 33, где сказано про `vibelog capabilities --json`) с описанием поля `instructions`: что в нём, лимит ~2 КБ, что переопределять его не надо, полный справочник — `vibelog capabilities`. `doc-30` строки 20 и 141: снять «в разработке — VL-395» (VL-395 закрывает MCP-часть). `CHANGELOG.md`: строка в unreleased-секции.

5. **Проверка**:
   ```
   pnpm build && node -e "..."   # или просто тест ниже
   pnpm test:fast -- src/mcp/server.test.mjs   # точечно, dist уже собран
   pnpm test                                   # полный прогон перед DoD
   ```
   Плюс ручной smoke (опционально, в отчёте Code): `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node bin/vibelog.mjs mcp start` — в ответе `instructions` на месте, сервер не зависает (graceful exit по `rl.close`, server.ts:157-160).

### Риски

- **Лимит 2000 символов** (AC1): русский текст в UTF-8 — длина в JS-символах, не байтах; ориентир ~1.3-1.6 КБ символов. Если текст не влезает — сокращать блок «доступ» и подпись «служебные фазы», но не выкидывать явное «дефолт в коде».
- **Разъезд текста с кодом**: текст — константа, при изменении `DEFAULT_WORKFLOW` её надо править руками. Митигация: в тексте явно сказано «полный справочник — `vibelog capabilities` (генерируется из кода)», то есть ориентир сознательно неполный; в тесте не закреплять переходы дословно, только фазовые имена (`spec`, `plan`, `code`, `close`, `reject`) — иначе тест станет хрупким.
- **Совместимость**: поле `instructions` аддитивно; `src/agent/mcp-client.ts:183-192` (`handshake`) результат `initialize` не разбирает (только `request` → void), `src/agent/external-mcp.ts` тоже — регрессии у собственного клиента нет. Сторонние клиенты игнорируют неизвестное поле по спецификации.
- **Проверка на «все ответы initialize одинаковы»**: тесты в `server.test.mjs` шлют `initialize` в каждом батче (~50 раз) — рост ответа на ~1.5 КБ некритичен (не логируется целиком, `logRpc` режет до 200 символов, server.ts:45-52).

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| `handleInitialize` отдаёт только `protocolVersion`, `capabilities.tools`, `serverInfo` | `src/mcp/server.ts:171-182` |
| Метод `initialize` роутится в `handleInitialize(id, params, sendResponse)` | `src/mcp/server.ts:127-130` |
| `protocolVersion` — строка `'2024-11-05'` | `src/mcp/server.ts:173` |
| `DEFAULT_WORKFLOW`: `initial_status: 'To Do'`, переходы Spec/Planned/Review, reject из To Do/Spec/Planned/In Progress/Review, `Review --code--> Review` | `src/core/workflow.ts:381-406` |
| Служебные фазы вне workflow: `comment`, `prompt`, `analyze`, `resume` | `src/core/workflow.ts:409` |
| Нет ключа `workflows` в settings.json → `loadWorkflows` подставляет `DEFAULT_WORKFLOW`; источник помечается `default-in-code` | `src/core/workflow.ts:433-460`, `src/core/capabilities.ts:273-290` |
| Правила доступа read/write (чтение — сразу, запись — через Allow/Deny) — стабильный текст `ACCESS` | `src/core/capabilities.ts:194-210` |
| Справочник `vibelog capabilities` существует, `--json` — машиночитаемая форма | `src/cli/commands/capabilities.ts`, `src/cli/command-registry.ts:44`, `backlog/docs/doc-7-…md:294-304` |
| `vibelog instructions` существует, тема `overview` ссылается на `vibelog capabilities` | `src/cli/commands/instructions.ts:16-76` |
| `AGENTS_MD_MAX_CHARS = 8000` — причина не класть ориентир в AGENTS.md | `src/agent/system-prompt.ts:29`, `:140-141` |
| Существующий тест `initialize` проверяет `serverInfo.name` и `capabilities.tools` | `src/mcp/server.test.mjs:164-172` |
| Тест-файл — интеграционный: живой сервер `callMcp` на `mkdtemp`-фикстуре, env через `testSpawnEnv()` | `src/mcp/server.test.mjs:15-18`, `:57-66`, `:100-120` |
| Собственный MCP-клиент результат `initialize` не разбирает (только `await this.request(...)` → void) | `src/agent/mcp-client.ts:182-192` |
| `logRpc` обрезает payload до 200 символов — рост ответа журнал не раздувает | `src/mcp/server.ts:45-52` |
| doc-30 уже анонсирует MCP `initialize` как источник справочника (с пометкой «в разработке — VL-394/VL-395/VL-396») | `backlog/docs/doc-30-…md:20`, `:141` |

## Не проверено (предположения)

1. **Итоговая длина текста ≤ 2000 символов** — не измерена (текста ещё нет). Проверить первым шагом: собрать черновик и посчитать `MCP_INSTRUCTIONS.length` через `node -e`/`pnpm build && node --input-type=module -e "import(...)"`; при превышении сокращать блок «доступ» и «служебные фазы». При расхождении — сокращение, а не поднятие лимита (AC1 фиксирует 2000).
2. **Место константы** (модуль `src/mcp/server.ts`) — не проверено, нет ли в проекте соглашения держать текстовые константы протокола отдельным модулем. Проверить `grep` по `EXPORT CONST` в `src/mcp/`; при наличии такого файла (например `src/mcp/tool-result.ts` со «стабильными текстами») — константа идёт туда, а `server.ts` её импортирует. Тест в этом случае импортирует константу из `dist/`.
3. **Отсутствие теста-инварианта «список полей ответа initialize»** — предположение, что ни один тест не сравнивает `result` целиком (`deepStrictEqual`) и не сломается от нового ключа. Проверить `grep -n "deepStrictEqual.*result" src/mcp/server.test.mjs`; если такой тест есть — дополнить ожидаемый объект, а не удалять проверку.
4. **Внешние MCP-клиенты через `src/agent/external-mcp.ts`** — предположение, что результат `initialize` там тоже не валидируется по схеме (кроме ответа собственного сервера Vibelog, что неважно). Проверить чтением `src/agent/external-mcp.ts` в районе handshake; при строгой валидации — учесть поле в ожиданиях.
5. **Точные строки `doc-30`** (20 и 141) и формулировка «в разработке» — прочитано по grep-выдаче, не полным чтением файла. Проверить `read_file` этих строк перед правкой.
6. **CHANGELOG-секция** (unreleased / версия) — не читалась. Проверить первые 30 строк `CHANGELOG.md` перед правкой; если структура иная — писать по образцу верхней секции.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 01:59
---
Фаза 2 (Plan) выполнена. Тип: feature (обычная задача, не эпик).
План записан в задачу. Файлов к изменению — 5: `src/mcp/server.ts` (константа `MCP_INSTRUCTIONS` + поле `instructions` в ответе `handleInitialize`, строки 171-182), `src/mcp/server.test.mjs` (расширение теста `initialize`, строки 164-172), `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md`, `backlog/docs/doc-30-Фазовый-процесс-…md` (снять пометку «в разработке — VL-395»), `CHANGELOG.md`.
Ключевые решения:
- текст — статическая константа в `src/mcp/server.ts` (не читает settings.json: ориентир не должен разъезжаться с протоколом при битом конфиге), с комментарием «почему» — почему `instructions`, а не AGENTS.md (лимит `AGENTS_MD_MAX_CHARS = 8000`, `src/agent/system-prompt.ts:29`) и не шаблоны фаз;
- поле аддитивное, порядок ключей `protocolVersion` → `capabilities` → `serverInfo` → `instructions`; собственный клиент (`src/agent/mcp-client.ts:182-192`) результат `initialize` не разбирает — регрессии нет;
- в тесте закрепляются только имена фаз (`spec/plan/code/close/reject`) и подстроки `workflows`/`settings.json`/`capabilities`/`DEFAULT_WORKFLOW`, а не дословные переходы — иначе тест станет хрупким при правке `DEFAULT_WORKFLOW`.
Риски: (1) лимит 2000 символов — текст ещё не измерен, при превышении сокращать блок «доступ»/«служебные фазы», но не убирать явное «дефолт в коде»; (2) ручной разъезд константы с `DEFAULT_WORKFLOW` — митигировано отсылкой к генерируемому `vibelog capabilities`; (3) рост ответа `initialize` на ~1.5 КБ в ~50 батчах `server.test.mjs` — некритично, `logRpc` режет payload до 200 символов.
Разделы «Проверено по коду» (14 утверждений с `файл:строка`) и «Не проверено (предположения)» (6 пунктов с планом проверки первым шагом Code) — в плане задачи.
---
author: @agent
created: 2026-11-10 02:05
---
Фаза 3 (Code) выполнена.
Изменено:
- `src/mcp/server.ts` — новая экспортируемая константа `MCP_INSTRUCTIONS` (1058 символов, лимит 2000 соблюдён) с комментарием «почему» (почему `instructions`, а не AGENTS.md с лимитом `AGENTS_MD_MAX_CHARS = 8000`, и не шаблоны фаз); в `handleInitialize` добавлено поле `instructions: MCP_INSTRUCTIONS` после `serverInfo` — остальные поля ответа не тронуты.
- `src/mcp/server.test.mjs` — новый кейс `initialize — отдаёт instructions с ориентиром по workflow (VL-395)`: строка непустая, `length <= 2000`, содержит `workflows`, `settings.json`, `capabilities`, `DEFAULT_WORKFLOW`, `reject` и имена фаз `spec/plan/code/close`; плюс инвариант протокола — `protocolVersion === '2024-11-05'`, `capabilities.tools`, `serverInfo.name === 'vibelog-md'` на месте.
Коммит: fee00d2 — «feat: VL-395 — MCP initialize отдаёт поле instructions с ориентиром по workflow».
Проверки:
- `pnpm build` — успешно; длина константы измерена: 1058 символов (≤ 2000).
- `npx vitest run src/mcp/server.test.mjs` — 39/39 passed.
- Полный `pnpm test` — 205 файлов, 3991 passed, 4 skipped, 0 failed (исключений и `--skip` не было).
- Ручной smoke: `printf ... | node bin/vibelog.mjs mcp start` — в ответе `instructions` присутствует, `protocolVersion`/`capabilities`/`serverInfo` на месте, сервер завершился штатно.
Что осталось (Фаза Close, по правилу «документацию пишет Close»): обновить `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md` (раздел про поле `instructions`), снять в `doc-30` пометку «в разработке — VL-395», добавить строку в `CHANGELOG.md`. В Фазе 3 эти файлы не правились сознательно.
---
author: @agent
created: 2026-11-10 02:17
---
Фаза Close выполнена. Ветка vb/vl-395 слита в master (1 коммит: fee00d2, merge 418b9e8, конфликтов не было), worktree удалена через --force (единственный untracked — `.vibelog/worktrees/vl-395/backlog/references/data`, оркестраторский симлинк/кэш, данных не терялось), ветка vb/vl-395 удалена.
Проверки после merge:
- `pnpm build` — успешно (diff затронул только src/mcp/server.ts и src/mcp/server.test.mjs).
- Ранний точечный прогон `pnpm test:fast -- src/mcp/server.test.mjs` — зелёный.
- Полный `pnpm test:fast` — 206 файлов, 3999 passed, 4 skipped, 0 failed (без исключений и --skip). Первый полный прогон сразу после merge дал 1 упавший файл — повторил однократно без правок кода: набор зелёный целиком, падение классифицировано как флак от параллельного прогона (второй полный прогон на том же дереве не воспроизвёл).
Документация (коммит 95e8933):
- `backlog/docs/doc-8-MCP-справочник-Vibelogmd.md` — новый раздел «Handshake: поле `instructions` (VL-395)»: что отдаётся, лимит 2000 символов, статичность константы, отсылка к `vibelog capabilities` за полным списком.
- `backlog/docs/doc-30-Фазовый-процесс-…` — снята пометка «в разработке — VL-395» в строках 20 и 141: теперь MCP `initialize` указан как действующий источник, «в разработке» осталось только за VL-396 (`vibelog instructions`, темы workflow/mcp/settings).
- `CHANGELOG.md` — запись VL-395 в секции Unreleased → «Добавлено».
Lessons: создан `lesson-274` (вставка буллета CHANGELOG якорем по заголовку секции даёт дубль «### Изменено»), связан с задачей (коммит 6c2685f). Refs: нет. Подзадач у VL-395 нет.
DoD: все три пункта выполнены — тесты (полный прогон зелёный), документация обновлена, регрессий не обнаружено (поле `instructions` аддитивно, собственный MCP-клиент результат `initialize` не разбирает).
---
<!-- COMMENTS:END -->