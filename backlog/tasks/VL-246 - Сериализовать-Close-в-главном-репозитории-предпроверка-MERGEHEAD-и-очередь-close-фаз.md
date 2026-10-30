---
id: VL-246
title: 'Сериализовать close-фазы: проверка MERGE_HEAD и очередь'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 02:17'
updated_date: '2026-10-30 22:11'
due_date: ''
labels:
  - web
  - agent
dependencies: []
milestone: ''
references: []
priority: medium
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/git.ts
  - src/core/git.test.mjs
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - src/bot/handlers.ts
lessons:
  - lesson-120
  - lesson-121
token_usage:
  input: 7558495
  output: 62066
  cache: 7222784
  total: 7620561
  requests: 118
  duration_ms: 1049120
  reasoning: 34455
  by_phase:
    spec:
      input: 67086
      output: 1544
      cache: 56832
      requests: 3
    plan:
      input: 1272223
      output: 19473
      cache: 1160192
      requests: 23
    code:
      input: 4798341
      output: 32894
      cache: 4627456
      requests: 61
    close:
      input: 1420845
      output: 8155
      cache: 1378304
      requests: 31
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-231. Close VL-212 не смогла начать merge, потому что в главном репозитории уже шёл незавершённый merge от VL-219 (`MERGE_HEAD 532c590`, `UU CHANGELOG.md`) — параллельные Close конкурируют за master. Сейчас спасает только текстовое правило «не резолвь и не abort чужой merge» (lesson-82). Добавить в `startPhase`/`spawnQwenRun` (`src/web/orchestrator.ts`) предпроверку для `phase === 'close'` при `branch_mode`: наличие `MERGE_HEAD` или активной close-фазы для другого ключа → фаза не стартует (или ставится в очередь с понятным сообщением), статус задачи не меняется.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 При активном MERGE_HEAD в главном репозитории старт close-фазы (branch_mode) отклоняется или ставится в очередь с понятным сообщением; статус задачи не меняется
- [x] #2 Параллельный старт второй close-фазы в том же проекте блокируется (очередь/отказ) с понятным сообщением пользователю
- [x] #3 Поведение покрыто тестом orchestrator/phase-transient; полный pnpm test проходит
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Итог исследования

Механика уже почти есть: `startPhase` (src/web/orchestrator.ts:298-330) при `phase === 'close' && resolveBranchMode(cwd)` сериализует close через `closeQueue`/`closeActive` (VL-146). Не хватает **предпроверки git-состояния**: если в главном репо висит чужой `MERGE_HEAD` (инцидент VL-212/VL-219, lesson-82), close всё равно стартует, тратит ран и падает на `git merge --no-ff` с «you have unmerged files». Второй gap — сообщение об очереди не говорит, какая задача держит close.

Статус задачи менять не нужно: guard обязан стоять **до** `spawnQwenRun` (единственное место, где работает `markPhaseStarted`, стр. ~887), тогда инвариант «статус не меняется» выполняется автоматически.

## Файлы и правки

### 1. `src/core/git.ts` — новый read-only помощник (после `getGitLog`, конец файла, ~стр. 275-315)
```ts
export interface MergeState {
  inProgress: boolean;      // есть MERGE_HEAD → чужой/свой незавершённый merge
  head: string;             // sha из MERGE_HEAD ('' если нет) — для сообщения
  unmerged: string[];       // `git diff --name-only --diff-filter=U` — детали
}

export function getMergeState(cwd: string, env: NodeJS.ProcessEnv = process.env): MergeState
```
- Реализация: `spawnSync('git', ['-C', cwd, 'rev-parse', '--verify', '-q', 'MERGE_HEAD'])` → status 0 ⇒ `inProgress`; затем `spawnSync('git', ['-C', cwd, 'diff', '--name-only', '--diff-filter=U'])` (status≠0 ⇒ `[]`).
- **Fail-open**: git недоступен / не git-репозиторий (status 128 и пустой stdout у первой команды) → `{ inProgress: false, head: '', unmerged: [] }` — предпроверка не должна ломать close в не-git проекте (как `getGitLog` не бросает в этом месте, а отдаёт []). Комментарии на русском: почему fail-open (better не блокировать, чем сломать не-git проект).
- `-C cwd` обязателен: cwd оркестратора может быть подкаталогом.

### 2. `src/web/orchestrator.ts` — guard + владелец очереди
- стр. 23: `import { getMergeState } from '../core/git.js';`
- стр. ~131 (рядом с `closeActive`): `let closeOwner: string | null = null;` — канонический ключ активного close (для сообщения «кто держит»).
- стр. ~74 (`StartResult.started`): новое additive-поле `queuedBehind?: string` — какая задача выполняет текущий close (VL-246).
- стр. ~298-330, ветка `phase === 'close' && resolveBranchMode(cwd)`, **перед** проверкой `closeQueue.some(...)`/`closeActive`:
  ```ts
  const merge = getMergeState(cwd);
  if (merge.inProgress) {
    return { error: 'Close не может начать слияние: в главном репозитории идёт незавершённый merge'
      + (merge.head ? ` (MERGE_HEAD ${merge.head.slice(0,7)})` : '')
      + (merge.unmerged.length ? `, конфликты: ${merge.unmerged.slice(0,5).join(', ')}` : '')
      + '. Заверши или отмени чужое слияние и повтори close (lesson-82).' };
  }
  ```
  Guard стоит до `closeActive = true` и до `spawnQwenRun` → статус задачи не меняется (AC1). Проверять при КАЖДОМ старте, включая dequeue из `drainCloseQueue` (startPhase вызывается заново — ничего дописывать не надо; при отказе сработает существующий путь `'error' in res` → `next.onExit?.({exitCode:1, logTail: res.error})` → drain дальше).
- В ветке постановки в очередь (`if (closeActive)`) — вернуть `{ started: true, pid: 0, queued: true, queuedBehind: closeOwner ?? undefined }`.
- `closeActive = true` при успешном старте дополнять `closeOwner = canon`; в `drainCloseQueue()` (стр. ~400-415) при `!next` — `closeOwner = null`; при ошибке dequeue — тоже `closeOwner = null` перед рекурсией. В `wrappedExit` (drain в finally) `closeOwner` сбрасывает сам drain.

### 3. `src/bot/handlers.ts` (стр. ~1097-1106) — сообщение очереди
- При `result.queued`: `⏳ Фаза Close … поставлена в очередь — стартует после завершения текущего close${result.queuedBehind ? ` (${result.queuedBehind})` : ''}`.
- Ошибку guard'а (MERGE_HEAD) отправляет уже существующая ветка `'error' in result` — текст станет понятным без правок.

### 4. `src/web/api.ts` — без правок (202 отдаёт StartResult целиком, `queuedBehind` уйдёт в тело автоматически; 409 отдаёт `result.error`).

### 5. Тесты
**`src/core/git.test.mjs`** (+3 кейса, в стиле существующих, `mkdtempSync` + ISO_ENV):
- git-репо без merge → `{ inProgress:false, unmerged:[] }`;
- после записи `.git/MERGE_HEAD` с sha HEAD → `inProgress:true`, `head` = этот sha;
- не-git каталог → fail-open `inProgress:false` (не throw).

**`src/web/orchestrator.test.mjs`**:
- AC1: branch-mode проект (шаблон `makeBranchRoot`, стр. ~1393) + fake qwen-стаб с lock-файлом; записать `.git/MERGE_HEAD` (sha из `git rev-parse HEAD`); `startPhase(root,'VL-1','close')` → `'error' in res`, текст матчит `/незавершённый merge/` и содержит короткий sha; lock-файл стаба НЕ создан (процесс не спавнился); статус задачи в файле не изменился (прочитать `backlog/tasks/*.md`, `status:` прежний). После удаления MERGE_HEAD тот же вызов → `started:true` (регрессия «guard не залипает»).
- AC2: расширить существующий VL-146-тест (стр. ~2115-2160): `r2.queuedBehind === 'VL-1'`, `r3.queuedBehind === 'VL-1'` (текущий close ещё активен). Дополнительно новая короткая проверка: после прохода очереди `getRun('VL-1')` не содержит `queued`.

### 6. Документация
- `README.md`: в раздел про фазы/параллельную разработку (~стр. 390-400, где уже описан branch_mode close) добавить абзац «VL-246: close в branch-mode не стартует при незавершённом merge (MERGE_HEAD) — фаза отклоняется с сообщением, статус задачи не меняется; второй close другой задачи по-прежнему встаёт в очередь (VL-146) и показывает, какой close удерживает очередь». Файл-документ знаний: `document_update` doc-6 (раздел про workflow/фазы) — короткий пункт.
- `CHANGELOG.md` → `## [Unreleased] / ### Добавлено`: запись VL-246 (проблема VL-212, `getMergeState`, guard, `queuedBehind`, тесты).

## Порядок действий
1. `src/core/git.ts` — `MergeState`/`getMergeState` (+тесты core/git).
2. `src/web/orchestrator.ts` — импорт, `closeOwner`, guard, `queuedBehind`, сброс владельца в drain.
3. `src/bot/handlers.ts` — текст очереди.
4. Тесты orchestrator (AC1, AC2), затем docs/CHANGELOG.
5. Проверки: `pnpm build && pnpm test` (полный — обязателен для DoD; целевой до него: `pnpm test:fast -- src/web/orchestrator.test.mjs src/core/git.test.mjs`).

## Риски
- **Ложный отказ close**: `MERGE_HEAD` может остаться от прерванного своей же задачи merge — это ровно тот случай lesson-82, где слияние всё равно невозможно; отказ с явным sha/конфликтами правильнее падения на git merge.
- **Fail-open в не-git проекте**: `getMergeState` не бросает — иначе сломались бы все существующие тесты/проекты без git.
- **Стейл `closeOwner`**: сбрасывается в единственных точках выхода (`drainCloseQueue` при пустой очереди и при ошибке dequeue) — если правку пропустить, сообщение «удерживает VL-N» устареет; покрыто проверкой в тесте AC2.
- **Совместимость тестов**: `queuedBehind` — additive-поле, существующие assert'ы (`r2.queued === true`, `r2.pid === 0`) не ломаются.
- **Стоимость git-вызова**: один `spawnSync` на старт close (не на каждый HTTP-запрос) — синхронный вызов в `startPhase` приемлем (как `resolveBranchMode`/`getTask` рядом).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 02:21
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Сериализовать close-фазы: проверка MERGE_HEAD и очередь» (был длиннее 80 символов, суть сохранена). Тип: enhancement (усиление существующего механизма фаз, не новая фича). Масштаб: task (одна точка изменения: startPhase/spawnQwenRun в src/web/orchestrator.ts + тест). Приоритет: Medium (проблема воспроизводится при параллельных Close, но есть текстовое обходное правило lesson-82). Уточнено: цель — предпроверка для phase === 'close' при branch_mode (наличие MERGE_HEAD либо активной close-фазы для другого ключа → отказ/очередь с понятным сообщением), инвариант «статус задачи не меняется»; AC переформулированы в проверяемом виде + добавлен AC про покрытие тестом. Labels: web, agent (логика в веб-оркестраторе фаз, контекст агентских фаз). References: нет (упомянутые VL-212/VL-219/lesson-82 — внутренние сущности проекта, не внешние источники). Вопросов нет.
---
author: @agent
created: 2026-10-30 21:43
---
Фаза 2 (Plan) выполнена. Тип: task (enhancement). План записан в задачу.
Исследование: механика сериализации close уже есть (VL-146: `closeQueue`/`closeActive` в `startPhase`, src/web/orchestrator.ts:298-330), но нет предпроверки git-состояния — при чужом `MERGE_HEAD` close стартует, тратит ран и падает на `git merge --no-ff` (инцидент VL-212/VL-219, lesson-82). Второй gap: сообщение об очереди не говорит, какая задача держит close.
План — 6 файлов:
1. `src/core/git.ts` — новый read-only `getMergeState(cwd)` → `{inProgress, head, unmerged[]}` через `git rev-parse --verify -q MERGE_HEAD` + `git diff --diff-filter=U`; **fail-open** (не-git/нет git → `inProgress:false`, не throw, иначе сломались бы не-git проекты и тесты).
2. `src/web/orchestrator.ts` — guard `MERGE_HEAD` ПЕРВЫМ в ветке `phase==='close' && resolveBranchMode`, до `closeActive=true` и до `spawnQwenRun` (единственное место `markPhaseStarted` → инвариант «статус не меняется» выполняется автоматически); `closeOwner` (ключ активного close) + additive-поле `StartResult.queuedBehind` для сообщения «удерживает VL-N»; сброс владельца в `drainCloseQueue` (пустая очередь / ошибка dequeue).
3. `src/bot/handlers.ts` — текст очереди с `queuedBehind`; текст отказа от MERGE_HEAD проходит через существующую ветку `'error' in result`.
4. `src/web/api.ts` — без правок (202 отдаёт StartResult целиком).
5. Тесты: `src/core/git.test.mjs` +3 (нет merge / MERGE_HEAD с sha / не-git fail-open); `src/web/orchestrator.test.mjs` — AC1 (branch-mode + fake qwen-стаб с lock-файлом, записан MERGE_HEAD → error с sha, процесс не спавнился, lock-файл пуст, статус задачи не изменился; после удаления MERGE_HEAD → started:true) и AC2 (расширение VL-146-теста: `queuedBehind === 'VL-1'`).
6. Документация: README (абзац о guard'е и очереди), doc-6, CHANGELOG `[Unreleased]/Добавлено`.
Проверки: целевой `pnpm test:fast -- src/web/orchestrator.test.mjs src/core/git.test.mjs`, затем обязательный полный `pnpm build && pnpm test` (DoD).
Риски: ложный отказ close при «своём» прерванном merge (это ровно случай lesson-82 — слияние всё равно невозможно, отказ с sha/конфликтами информативнее); fail-open обязателен для не-git; стейл `closeOwner` при пропуске сброса в drain (покрыт тестом); `queuedBehind` additive — существующие assert'ы не ломаются; цена — один `spawnSync git` на старт close.
---
author: @agent
created: 2026-10-30 21:57
---
Фаза 3 (Code) выполнена. Коммит b111b8b (ветка vb/vl-246).
Изменено (5 файлов, +203/-3):
1. `src/core/git.ts` — новый read-only `getMergeState(cwd, env)` + тип `MergeState {inProgress, head, unmerged[]}`: `git rev-parse --verify --quiet MERGE_HEAD` + `git diff --name-only --diff-filter=U`. **Fail-open**: нет MERGE_HEAD / не-git / git недоступен → `{inProgress:false}` без исключения (иначе сломались бы close-фазы в не-git проектах).
2. `src/web/orchestrator.ts` — guard `MERGE_HEAD` в ветке `phase==='close' && resolveBranchMode(cwd)`, ПЕРВЫМ — до проверки очереди, до `closeActive=true` и до `spawnQwenRun` (значит `markPhaseStarted`/транзиент In Progress не срабатывает → статус задачи не меняется, AC1). Текст ошибки: «Close не может начать слияние: в главном репозитории идёт незавершённый merge (MERGE_HEAD <sha7>), конфликты: <до 5 файлов>. Заверши или отмени чужое слияние и повтори close (lesson-82)». Добавлен `closeOwner` (канонический ключ активного close) + additive-поле `StartResult.queuedBehind` в ответе очереди (AC2 — «понятное сообщение: чей close удерживает»); `closeOwner` сбрасывается в `drainCloseQueue` (пустая очередь и dequeue) и при неудачном спавне.
3. `src/bot/handlers.ts` — сообщение очереди дополнено: «⏳ Фаза Close (agent) для *VL-N* поставлена в очередь — стартует после завершения текущего close (удерживает close VL-M) (VL-146)».
4. `src/core/git.test.mjs` — +3 кейса `getMergeState`: merge не идёт; `.git/MERGE_HEAD` с sha → `inProgress:true`/`head`=sha; не-git → fail-open (не throw).
5. `src/web/orchestrator.test.mjs` — новый тест AC1 «VL-246: close в branch-mode не стартует при незавершённом merge (MERGE_HEAD)»: branch-mode проект + fake-qwen с lock-файлом + записанный `.git/MERGE_HEAD` → `'error' in res`, текст матчит `/незавершённый merge/` и содержит короткий sha; lock-файл стаба НЕ создан (процесс не спавнился); `status` задачи не изменился; после удаления MERGE_HEAD тот же close → `started:true` и lock-файл появился (guard не залипает). AC2 — в существующем VL-146-тесте: `r2.queuedBehind === 'VL-1'`, `r3.queuedBehind === 'VL-1'`.
`src/web/api.ts` правок не потребовал: 202 отдаёт `StartResult` целиком, 409 — `result.error`.
Проверки: `pnpm build` (tsc strict) — OK; целевой `pnpm test:fast -- src/core/git.test.mjs src/web/orchestrator.test.mjs` — зелёные; **полный `pnpm test`** — 105 файлов, 1921 passed, 4 skipped (исключений/--skip нет, `static.test.mjs` гоняется отдельным шагом пакета).
Замечание по окружению: первый полный прогон дал 1 падение `src/mcp/server.test.mjs` («fallback: meta без usage → jsonl» ждал «фаза close», получил «фаза code») — это артефакт env агентского рана (`VIBELOG_RUN_PHASE=code` наследуется от оркестратора, VL-259), а не регрессия: тот же файл вне env-маркеров зелёный. Полный прогон выполнен как `env -u VIBELOG_RUN_PHASE -u VIBELOG_PHASE_NAME -u VIBELOG_PHASE_TASK_ID pnpm test` — зелёный. Зафиксировано lesson-120.
Что осталось: документация (README-абзац о guard'е MERGE_HEAD и `queuedBehind`, doc-6, CHANGELOG `[Unreleased]/Добавлено`) — по правилам фазы Code не правится, пишется в Close. DoD «Документация обновлена» не отмечен по той же причине.
---
author: @agent
created: 2026-10-30 22:11
---
Фаза Close выполнена. Ветка vb/vl-246 (1 коммит b111b8b) слита в master merge-коммитом 5cb0ac7 («merge: VL-246 — Сериализовать close-фазы: проверка MERGE_HEAD и очередь»), worktree .vibelog/worktrees/vl-246 удалена (обычный remove отказал из-за untracked-симлинков node_modules — они ведут в главный репо, данные не теряются; удалено с --force), ветка vb/vl-246 удалена.
Проверки после merge: `pnpm build` — OK; полный прогон `env -u VIBELOG_RUN_PHASE -u VIBELOG_PHASE_NAME -u VIBELOG_PHASE_TASK_ID pnpm test` — 106 файлов, 1948 passed, 4 skipped, падений нет (env-маркеры сняты по lesson-120, иначе тест env-фазы видит code вместо close и краснеет). Повторных прогонов не делал.
Документация (DoD 2) обновлена именно в этой фазе, коммит 713dc64 «docs: VL-246 — документация и CHANGELOG»:
- README.md — абзац «Close в branch-mode не стартует при незавершённом merge (VL-246)»: getMergeState, текст отказа с MERGE_HEAD-sha и конфликтами, статус не меняется, fail-open в не-git, `queuedBehind` в сообщении очереди;
- backlog/docs/doc-6 — в раздел «Сериализация Close (VL-146)» добавлен блок про guard MERGE_HEAD и владельца очереди;
- CHANGELOG.md — запись VL-246 в `[Unreleased] / Добавлено`.
Lessons: lesson-120 (снимать VIBELOG_RUN_PHASE перед полным прогоном внутри агентской фазы — source этой задачи, из Code) и новый lesson-121 (guard внешнего git-состояния ставить до spawnQwenRun — тогда инвариант «статус не меняется» выполняется сам; хелпер fail-open + `-C cwd`; тест должен проверять и отсутствие спавна, и неизменность статуса, и «guard не залипает»). Оба связаны с задачей, закоммичены (c0b761c).
DoD: 1 «Тесты проходят» ✓ (полный прогон после merge), 2 «Документация обновлена» ✓ (README + doc-6 + CHANGELOG, коммит 713dc64), 3 «Нет регрессий» ✓. AC 1–3 подтверждены кодом и тестами (AC1/AC2 в src/web/orchestrator.test.mjs, +3 кейса getMergeState в src/core/git.test.mjs).
---
<!-- COMMENTS:END -->