---
id: VL-423
title: 'Веб-чат: POST шлёт persona из module-state пикера вместо роли треда — warn «роль уже зафиксирована» на каждом ходе'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-17 16:24'
updated_date: '2026-11-17 17:52'
due_date: ''
labels:
  - web
  - chat
dependencies: []
milestone: ''
references: []
priority: medium
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - web/src/components/chat/chat-runtime.tsx
  - web/dist/index.html
  - web/dist/assets/index-CbbxGuQU.js
  - web/dist/assets/index-B6pxBQhY.js
  - web/dist/assets/index-DoC0smW1.js
  - web/dist/assets/index-DWfTMWtm.css
  - CHANGELOG.md
  - backlog/lessons/lesson-115-Перед-тем-как-винить-свою-правку-в-падении-полного-прогона-прогони-упавший-тест-файл-изолированно-и-сверь-состав-diff.md
lessons:
  - lesson-115
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 117
  duration_ms: 3867206
  by_phase:
    code:
      input: 0
      output: 0
      cache: 0
      requests: 60
    close:
      input: 0
      output: 0
      cache: 0
      requests: 57
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст: в консоли `vibelog browser` на КАЖДОЕ сообщение в открытом треде печатается warn из src/web/chat.ts:1285: «роль треда <id> уже зафиксирована: architect, body.persona=helper игнорируется».

Корень: в клиенте живут два независимых источника роли.
1. Бейдж роли (PersonaBadge) — из load.persona ответа GET /api/chat/threads/:id (thread.tsx:1048) — показывает зафиксированную роль треда (architect).
2. Тело POST — persona: activePersonaId (chat-runtime.tsx:782) — module-state пикера: по замыслу VL-283 не следует за открытой тредом ролью (нужен для следующего нового треда, pickers.tsx:261) и сбрасывается в "helper" при перезагрузке страницы (chat-runtime.tsx:372). Пикер при этом скрыт бейджем — пользователь видит «заблокированный» выбор Architect, а в теле уходит helper.

Ключевой факт семантики сервера (chat.ts:1276-1321): body.persona учитывается ТОЛЬКО когда у треда ещё нет роли (stored === null — первый ход нового треда, sidecar и effective отсутствуют). Для существующего треда поле всегда игнорируется, а warn срабатывает на несовпадении значения. Вывод: поле для существующего треда не имеет функционального смысла — оно только и питает warn.

Цель: убрать молчаливое расхождение «в бейдже одна роль, в теле другая» и шум в консоли, не меняя семантику фиксации роли (VL-283).

Вариант «зеркально перенести роль треда в module-state» отклонён: для существующего треда сервер поле игнорирует в любом случае — это лишняя синхронизация (prop → effect → module-state) без выигрыша.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ход в существующем треде (activeThreadId задан) не содержит поля persona в POST /api/chat — после нескольких сообщений в консоли vibelog browser нет warn «роль треда … уже зафиксирована … игнорируется»
- [x] #2 Первый ход нового треда по-прежнему шлёт persona из пикера — роль фиксируется в <threadId>.persona.json выбранной (VL-283 не регрессирует)
- [x] #3 Тред без sidecar (создан до VL-283): роль берётся из effectiveThreadPersona, а НЕ из body — чужая роль из пикера не может перетереть роль старого треда
- [x] #4 Существующие тесты pnpm test зелёные; фронт собран, ручная проверка в vibelog browser: консоль сервера чиста на 5+ подряд сообщений
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

1. **web/src/components/chat/chat-runtime.tsx** — единственное изменение кода (ветка message-блока, ~строка 780-782)
2. Тесты существующие — без изменений; ручная проверка (фронтовых тестов в web/ нет)

## Изменение

В `chatAdapter.run`, ветка обычного сообщения (else-блока, где сейчас):

```ts
// VL-265/VL-283: роль первого хода — сервер фиксирует её за тредом
// (<threadId>.persona.json) и последующие ходы поле игнорирует
persona: activePersonaId,
```

заменить на условную отправку — поле уходит ТОЛЬКО для нового треда (нет activeThreadId):

```ts
// VL-265/VL-283/VL-423: поле persona сервер читает ТОЛЬКО на первом ходе
// нового треда (когда у треда ещё нет зафиксированной роли). Для
// существующего треда оно всегда игнорируется, а его несовпадение
// (module-state пикера ≠ роль треда) давало warn на каждом ходе —
// шлём только когда треда ещё нет.
...(activeThreadId ? {} : { persona: activePersonaId }),
```

Почему так, а не «перенести роль треда в module-state» (первоначальный вариант А): семантика сервера (chat.ts:1276-1321) — для существующего треда `stored !== null` в любом случае (sidecar, а для старых тредов — effectiveThreadPersona = helper), и body.persona не читается вообще: ветка `if (storedPersonaId !== null)` отсекает его до warn. Зеркальное копирование роли в клиент добавляет синхронизацию (prop → effect → module-state) и её же баги (гонка при смене треда, reset в cleanup) без функционального выигрыша. Пропуск поля — то же поведение сервера (неизвестная строка/отсутствие → stored выигрывает), но без мёртвого груза.

## Не менять

- **Сервер** (src/web/chat.ts) — warn остаётся: он ловит РЕАЛЬНЫЕ расхождения (например, старый клиент или баг в будущей синхронизации). После фикса он просто не будет срабатывать.
- **Серверную валидацию** — порядок (валидация → fixThreadPersona → LLM-цикл) не трогаем.
- **activePersonaId / пикер / бейдж** — VL-283 остаётся как есть: module-state для нового треда, бейдж для открытого.
- **Ветки answer/approval/continue/retry** — persona туда уже не кладут, их не трогаем.

## Порядок

1. Правка ветки в chat-runtime.tsx (один spread вместо поля).
2. Обновить комментарий VL-265/VL-283 на месте правки (см. выше) — старый комментарий утверждает, что «последующие ходы поле игнорирует», что верно для сервера, но не объясняет, почему мы его не шлём.
3. Сборка: `pnpm test` (включает сборку web/dist — проверить, что web собирается без TS-ошибок).
4. Ручная проверка (AGENTS.md, chrome-devtools):
   - открыть существующий тред, отправить 5+ сообщений → в консоли vibelog browser НЕТ строк «уже зафиксирована … игнорируется»;
   - новый тред: выбрать роль в пикере, первый ход → .vibelog/chat-sessions/<id>.persona.json содержит ВЫБРАННУЮ роль (не helper), второй ход → warn нет;
   - тред без sidecar (если есть старый) → роль берётся из effective, warn «создан до фиксации роли» допустим ОДИН раз (существующее поведение, не из этой задачи);
   - деградация: перезагрузка страницы посреди треда → бейдж и поведение не меняются.

## Риски

- Низкий: единственная ветка, изменение — условный spread; сервер принимает отсутствие поля штатно (body.persona === undefined → stored выигрывает, для нового треда — дефолт helper, как и раньше при пустом значении).
- Краевой: тред, созданный не через этот клиент (например, бот /chat) — поле и раньше не требовалось, поведение не меняется.
- Остаточный шум: warn «создан до фиксации роли» для тредов до VL-283 печатается один раз на тред — вне скоупа (существующее поведение).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-17 16:52
---
Фаза 3 (Code) выполнена. Изменено: web/src/components/chat/chat-runtime.tsx (условный spread `...(activeThreadId ? {} : { persona: activePersonaId })` вместо безусловного persona + обновлён комментарий VL-265/VL-283/VL-423), пересобран отслеживаемый web/dist; коммит 302b49c. В worktree не было web/node_modules — установлен `pnpm --dir web install`, сборка `pnpm web:build` (tsc -b + vite) без TS-ошибок.
Проверки:
1) ПОЛНЫЙ прогон `pnpm test` (стандартный скрипт package.json: build + vitest --exclude static + отдельный прогон static; без дополнительных исключений): 230 тест-файлов, 4425 passed, 4 skipped, 0 failed. Нюанс: первый прогон упал 1 тестом (src/web/orchestrator.test.mjs, VL-277) — причина в утечке env сессии агента в shell (VIBELOG_CWD/VIBELOG_RUN_PHASE/VIBELOG_PHASE_NAME/VIBELOG_SESSION_ID), НЕ в правке VL-423: падение воспроизводилось и со stash-ем правки и исчезало при снятии этих переменных (`env -u …`); повторный полный прогон с очищенным env — зелёный.
2) Ручная проверка в vibelog browser (chrome-devtools), 5 POST /api/chat подряд: первый ход нового треда → {"message","persona":"architect"} (без threadId); 2-й и 3-й ход существующего треда (3-й — после ignoreCache-перезагрузки, т.е. ровно сценарий бага: module-state helper ≠ роль architect) → {"message","threadId"} без поля persona; первый ход второго нового треда → persona:architect; ход в треде с удалённым sidecar → {"message","threadId"} без persona. Консоль сервера: 0 строк «роль треда … уже зафиксирована … игнорируется»; ровно 1 «создан до фиксации роли» — существующее поведение для треда без sidecar (вне скоупа).
3) AC2: .vibelog/chat-sessions/<id>.persona.json обоих новых тредов = {"persona":"architect"} — VL-283 не регрессирует.
4) AC3: удалён sidecar → роль взята из effective (helper), бейдж «Роль треда: Помощник (зафиксирована)», поле в POST отсутствует — из пикера перетереть нельзя (сервер src/web/chat.ts не менялся).
5) Деградация: после перезагрузки страницы бейдж «Роль треда: Архитектор (зафиксирована)» и поведение не изменились.
Что осталось: DoD «Документация обновлена» не отмечен — CHANGELOG/docs по регламенту пишет Фаза Close после слияния (в Фазе 3 обновление документации запрещено). References/lessons в задаче отсутствуют — шаги пропущены.
---
author: @agent
created: 2026-11-17 17:26
---
Фаза Close прервана: полный прогон тестов падает после классификации — 1 failed из 4429: src/core/report.test.mjs → «пишет report.md в каталог рана и печатает отчёт» (AssertionError: process.exitCode = 1 вместо 0), 4416 passed + 4 skipped + static.test.mjs 8 passed.
Что успел сделать до прерывания:
- Merge vb/vl-423 → master ВЫПОЛНЕН без конфликтов (merge-коммит 71195b3, в ветке 1 коммит 302b49c).
- Сборка pnpm build — зелёная; ранний точечный фильтр (chat-persona-ui, chat-detached-run-ui, chat-usage-ui, chat-turn-outcome-ui) — 43 passed; src/web/static.test.mjs — 8 passed.
- Worktree .vibelog/worktrees/vl-423 и ветка vb/vl-423 СОХРАНЕНЫ (шаги 5–11 не выполнял).
Классификация (почему падение не следствие merge):
1) git diff HEAD^1..HEAD содержит ТОЛЬКО web/ (web/src/components/chat/chat-runtime.tsx + web/dist); src/, templates/, package.json, tsconfig.json, vitest.config.mts не менялись — тестовый код идентичен состоянию до merge, падение не может быть merge-интерференцией.
2) report.test.mjs проходит отдельно (27 passed) и вместе с workflow-cli.test.mjs (39 passed) — красный только в полном прогоне: кросс-файловая утечка process.exitCode между тест-файлами в общем воркере vitest (isolate:false, VL-139); вероятный источник — CLI-тесты, оставляющие exitCode=1 после последнего assert без afterEach-сброса (напр. src/cli/workflow-cli.test.mjs: есть beforeEach-сброс, afterEach нет).
3) В Фазе 3 тот же полный прогон был зелёным (4425 passed) в worktree — флаки недетерминирован; параллельного vitest в worktree этого проекта нет (чужой vitest /Users/bob/Dev/@vb/ui — другой проект, на результат не влияет). Первый полный прогон упал из-за утечки env сессии (VIBELOG_RUN_PHASE/VIBELOG_PHASE_NAME) — повтор с env -u убрал эту причину и выявил report.test флаки; больше полных прогонов регламент разрешает («максимум один повтор») — не делал.
Что должно быть сделано (кем):
1) Фазой Code / отдельной задачей — починить тестовую изоляцию process.exitCode: сброс в afterEach/afterAll у тест-файлов, заканчивающихся assert exitCode=1 (кандидаты: src/cli/workflow-cli.test.mjs, src/cli/session-cli.test.mjs, src/cli/cli.test.mjs), либо явный сброс в before у src/core/report.test.mjs. Это дефект тестов, не кода VL-423 — в скоуп VL-423 не входит.
2) После починки (или если счесть флаки не блокирующим) — повторить Фазу Close VL-423: merge уже в master (71195b3), worktree чист, шаг 3 при повторе вернёт «коммитов нет» и перейдёт к шагу 6.
Статус и DoD не тронуты.
---
author: @agent
created: 2026-11-17 17:26
---
Фаза close прервана агентом (aborted): Фаза Close прервана: полный прогон тестов падает после классификации — 1 failed из 4429: src/core/report.test.mjs → «пишет report.md в каталог рана и печатает отчёт» (AssertionError: process.exitCode = 1 вместо 0), 4416 passed + 4 skipped + static.test.mjs 8 passed.
Что успел сделать до прерывания:
- Merge vb/vl-423 → master ВЫПОЛНЕН без конфликтов (merge-коммит 71195b3, в ветке 1 коммит 302b49c).
- Сборка pnpm build — зелёная; ранний точечный фильтр (chat-persona-ui, chat-detached-run-ui, chat — статус возвращён к Review.
---
author: @agent
created: 2026-11-17 17:52
---
Фаза Close выполнена. Ветка vb/vl-423 слита в master ранее (merge-коммит 71195b3, в ветке 1 коммит 302b49c — состав master..vb/vl-423 пуст), worktree .vibelog/worktrees/vl-423 удалён (force: только untracked-симлинк backlog/references/data от оркестратора), ветка vb/vl-423 удалена.
Тесты: ранний точечный фильтр (chat-persona-ui, chat-detached-run-ui, chat) зелёный ещё в прошлом ране. Полный прогон в этом ране: 1 failed из 4429 — src/web/orchestrator.test.mjs («billing уходит тем же коммитом», VL-352). Классификация: файл вне diff merge (касается только web/src/chat-runtime.tsx + web/dist), изолированно зелёный (89/89), параллельного vitest нет (ps пуст); в предыдущем ране фазы падал уже другой чужой файл (src/core/report.test.mjs) — прыжок падения между файлами = флака параллельного прогона, не регрессия. Один разрешённый повтор (pnpm test:fast, без пересборки — сборка за фазу одна): 230 файлов, 4425 passed + 4 skipped — зелёный целиком.
DoD: 1 Тесты проходят — зелёный повтор после классификации; 2 Документация обновлена — запись в CHANGELOG.md Unreleased (коммит 537c2d5); 3 Нет регрессий — merge затронул только chat-runtime.tsx, точечные и полный прогоны зелёные. Урок: дополнен lesson-115 (коммит 067a0ad), linked к VL-423. Подзадач нет.
---
<!-- COMMENTS:END -->