---
id: VL-272
title: 'Тик супервизора не стартует после выдачи grant: прогон остаётся без лечения и планирования волн'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-01 14:59'
updated_date: '2026-11-01 15:25'
due_date: ''
labels:
  - web
  - supervisor
  - bug
  - tick
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
  - src/web/supervisor.ts
  - src/web/supervisor-tick.ts
  - src/web/supervisor.test.mjs
  - src/web/supervisor-limits.test.mjs
  - README.md
lessons:
  - lesson-129
token_usage:
  input: 10085924
  output: 322711
  cache: 9521920
  total: 10408635
  requests: 158
  duration_ms: 921402
  reasoning: 241275
  by_phase:
    plan:
      input: 2394679
      output: 125619
      cache: 2209536
      requests: 41
    code:
      input: 4651259
      output: 142422
      cache: 4409856
      requests: 63
    close:
      input: 3039986
      output: 54670
      cache: 2902528
      requests: 54
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Симптом

Тик супервизора **не запускается после выдачи grant'а**. Прогон стартует (первая волна фаз уходит), но дальше ничего не происходит: последующие волны не планируются, упавшие фазы не лечатся, авто-баги не создаются. Функция, ради которой делалась VL-270, в реальном сценарии не работает.

## Причина (подтверждена по коду)

`startSupervisorTimer` (`src/web/supervisor-tick.ts:1540`) вызывается **ровно в одном месте** — при старте веб-сервера (`src/web/server.ts:171`), и первым делом делает разовую проверку:

```js
export function startSupervisorTimer(cwd, opts = {}) {
  if (process.env.VIBELOG_SUPERVISOR_TICK === 'off') return false;
  if (tickTimer !== null) return true;
  if (findActiveGrant(cwd) === null) return false;   // ← grant'а ещё нет
  ...
}
```

А `runSupervisorTick` вызывается только из этого таймера:

```
src/web/supervisor-tick.ts:1551   void runSupervisorTick(cwd, deps)   ← внутри setInterval
```

Поиск по `src` подтверждает: других вызовов `startSupervisorTimer` нет, `runSupervisorTick` из прода не вызывается ниоткуда, кроме таймера.

## Почему это ломает штатный сценарий

doc-19 §15 описывает порядок: сервер уже работает → в чате согласуем состав → «стартуй» → пишется grant → **дальше должен работать тик**. Но:

1. сервер стартовал раньше grant'а → `findActiveGrant` вернул null → таймер не заведён;
2. пользователь выдаёт grant (`startSupervisorRun`, `src/web/supervisor.ts:463`) — пишет grant, `runs/<runId>.json`, `state.json`, запускает первую волну через `startTaskPhase`;
3. **таймер никто не перезапускает** — тика нет;
4. фазы первой волны отработают, и прогон встанет: ни планирования следующих волн, ни healing, ни авто-багов.

Случайно «починится» только при перезапуске `vibelog browser` — и то лишь потому, что grant уже лежит на диске и проверка при старте сервера пройдёт.

## Что сделать

1. **`startSupervisorRun`** — после успешной записи grant'а и запуска первой волны вызывать `startSupervisorTimer(cwd)`. Вызов идемпотентен (внутри уже есть `if (tickTimer !== null) return true`), поэтому повторный старт прогона второй таймер не создаст.
2. **`stopSupervisorRun`** и **авто-отзыв grant'а** (`supervisorRunStatus` при всех терминальных статусах / истечении `expiresAt`) — вызывать `stopSupervisorTimer()`.
3. **Неуспешный старт** (grant отозван из-за «ни одна фаза не запустилась») — таймер не оставлять.
4. Проверить, что `server.ts` при старте по-прежнему поднимает таймер, если grant уже есть (существующее поведение не ломать).
5. Решить, нужен ли self-healing: периодическая перепроверка «grant появился — поднять таймер» внутри уже идущего интервала, либо ленивое чтение grant'а на каждом тике (сейчас `skipped='no-grant'` возвращается, но тика-то нет). Рекомендация: достаточно явных вызовов из `start`/`stop` — меньше скрытой логики.

## Файлы

- `src/web/supervisor.ts` — `startSupervisorRun` (463), `stopSupervisorRun` (580), `supervisorRunStatus` (636) с авто-отзывом.
- `src/web/supervisor-tick.ts` — `startSupervisorTimer` (1540), `stopSupervisorTimer` (1565).
- `src/web/server.ts:171` — существующая точка старта при запуске сервера (регрессия).

## Проверка

Автотесты (см. AC) плюс ручной прогон на живом `vibelog browser`: поднять сервер → выдать grant → убедиться, что `state.json` растёт по `tick`, а `heartbeat.md` обновляется, без перезапуска процесса.

## Связи

- **VL-270** — задача, в которой появился таймер (Done). Дефект найден при проверке её результата; историю не переоткрываем.
- **doc-19 §5** — там зафиксировано «кто крутит тик», но не сказано, в какой момент таймер поднимается; при необходимости дополнить документ.
- **AC18 VL-270** (end-to-end прогон) — этот дефект объясняет, почему живой E2E не подтвердил бы работу: проверка была бы на уровне юнит-тестов, где `runSupervisorTick` вызывается напрямую.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Таймер тика поднимается сразу после успешного старта прогона: startSupervisorRun (src/web/supervisor.ts) после записи grant'а и запуска первой волны вызывает startSupervisorTimer, и тик начинает считаться без перезапуска vibelog browser
- [x] #2 Таймер останавливается при остановке прогона: stopSupervisorRun и авто-отзыв grant'а (все задачи в терминальном статусе, истечение expiresAt) вызывают stopSupervisorTimer; после отзыва grant'а тик не выполняется (skipped='no-grant') и модель не вызывается
- [ ] #3 Продовый сценарий doc-19 §15 работает целиком: сервер уже запущен → пользователь согласует состав и подтверждает grant → первая волна фаз идёт → последующие тики планируют следующие волны, лечат упавшие фазы и заводят авто-баги, без рестарта процесса
- [x] #4 Повторный вызов startSupervisorTimer при уже идущем таймере безопасен (идемпотентность): не создаёт второй интервал, не дублирует тики; проверяется тестом (два последовательных вызова → один таймер, isSupervisorTimerRunning() === true)
- [x] #5 startSupervisorRun без активного grant'а после отзыва (или при ошибке старта, когда grant отозван из-за 'ни одна фаза не запустилась') не оставляет работающий таймер: проверяется тестом, что после неуспешного старта isSupervisorTimerRunning() === false
- [x] #6 Флаг VIBELOG_SUPERVISOR_TICK=off по-прежнему полностью отключает тик — и при старте сервера, и при старте прогона; проверяется тестом
- [x] #7 Регрессия: старт сервера без grant'а по-прежнему не поднимает таймер (нет прогона — нечего наблюдать), поведение из VL-270 сохранено
- [x] #8 Тесты: новый сценарий в supervisor-limits.test.mjs или supervisor-tick.test.mjs — «grant выдан после старта сервера → таймер поднялся»; «stop прогона → таймер снят»; «авто-отзыв при терминальных статусах → таймер снят»; «повторный старт не дублирует интервал»; существующие тесты VL-270 про таймер остаются зелёными
- [ ] #9 Ручная проверка на живом vibelog browser: запустить сервер, выдать grant через backlog_supervisor start, убедиться по появлению/обновлению .vibelog/supervisor/heartbeat.md и state.json (растущий tick), что тик считает без перезапуска процесса; затем stop прогона — файлы перестают обновляться
- [x] #10 pnpm build, pnpm lint и полный pnpm test проходят; расхождения с doc-19 (если понадобится уточнить §5 про точку старта таймера) зафиксированы в Implementation Notes
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Диагноз (подтверждён по коду)

- `startSupervisorTimer` (`src/web/supervisor-tick.ts:1540`) вызывается только из `src/web/server.ts:171` (после `server.listen`) и первым делом делает `if (findActiveGrant(cwd) === null) return false;` (строка 1543). Сервер стартует раньше grant'а → таймер не заведён, и больше его никто не поднимает.
- `runSupervisorTick` вызывается только из тела `setInterval` внутри самого таймера → после выдачи grant'а тика нет: нет планирования следующих волн, healing и авто-багов.
- Точки отзыва grant'а, которые должны гасить таймер: `stopSupervisorRun` (`src/web/supervisor.ts:580`), авто-отзыв в `supervisorRunStatus` (`:663`), неуспешный старт (`:548`).

Решение по AC5 задачи: **только явные вызовы** из `start`/`stop`/авто-отзыв + один точечный self-stop по «нет grant'а» внутри уже идущего таймера (нужен ровно для случая истечения `expiresAt`, которое иначе некому заметить — AC2 требует остановки и по истечении). Больше скрытой логики не добавляем.

## Файлы и правки

### 1. `src/web/supervisor.ts`

1. **Импорт (строка 25)** — расширить существующий импорт из `./supervisor-tick.js`:
   `import { makePhaseRunId, startSupervisorTimer, stopSupervisorTimer } from './supervisor-tick.js';`
   (цикла импортов нет: `supervisor-tick.ts` импортирует только `supervisor-grant.ts`/`orchestrator.ts`, обратной зависимости нет.)

2. **Локальный хелпер** (рядом с `isTerminal`, ~строка 141) — не убивать таймер соседнего активного прогона:
   ```ts
   /** Гасит таймер тика, если после отзыва grant'а активных прогонов не осталось. */
   function stopTimerIfNoActiveGrant(cwd: string): void {
     if (findActiveGrant(cwd) === null) stopSupervisorTimer();
   }
   ```

3. **`startSupervisorRun` — успешный старт** (перед `return { ok: true, ... }`, строка 560, после `saveRunRecord`/`saveState` и проверки `record.started.length > 0`):
   ```ts
   // VL-272: таймер тика поднимается ЗДЕСЬ, а не только при старте сервера:
   // сервер обычно уже работает, когда пользователь подтверждает grant.
   // Вызов идемпотентен (внутри startSupervisorTimer есть guard tickTimer !== null),
   // поэтому повторный start второй интервал не создаст.
   startSupervisorTimer(cwd);
   ```
   Ошибку старта таймера не глотаем молча — обернуть в `try/catch` с `console.error('[supervisor] таймер не запущен: ...')` (как в `server.ts:171-174`) и всё равно вернуть `ok: true`: прогон запущен, диагностика в лог.

4. **`startSupervisorRun` — неуспешный старт** (ветка `if (record.started.length === 0)`, строки 548-549): после `revokeGrant(cwd, plan.runId, 'ни одна фаза не запустилась')` вызвать `stopTimerIfNoActiveGrant(cwd)` (AC5).

5. **`stopSupervisorRun`** (перед `return { ok: true, ... }`, строка 593): после `revokeGrant` вызвать `stopTimerIfNoActiveGrant(cwd)` (AC2).

6. **`supervisorRunStatus` — авто-отзыв** (после `revokeGrant(cwd, grant.runId, 'все задачи прогона в терминальном статусе')`, строка 663): вызвать `stopTimerIfNoActiveGrant(cwd)` (AC2).

### 2. `src/web/supervisor-tick.ts`

7. **Тело таймера** (`startSupervisorTimer`, `const run = (): void => {...}`, ~1546-1558): в цепочку промиса добавить self-stop при отсутствии grant'а — это единственный путь, которым замечается истечение `expiresAt`:
   ```ts
   .then(res => {
     // VL-272: grant истёк/отозван — интервал больше не нужен (модель и так
     // не вызывается, skipped='no-grant'); новый grant поднимет таймер заново
     // через startSupervisorRun. Иначе интервал молотил бы до конца процесса.
     if (res.skipped === 'no-grant') stopSupervisorTimer();
   })
   .catch(err => { ... })  // существующий catch сохраняется
   .finally(() => { ticking = false; });
   ```

8. **JSDoc `startSupervisorTimer`** (1530-1539): дополнить «точки вызова» — старт сервера при уже лежащем grant'е (`src/web/server.ts:171`) и `startSupervisorRun` при выдаче grant'а; гасится `stopSupervisorTimer` (stop прогона, авто-отзыв, `server.close`/`error`, self-stop при отсутствии grant'а).

### 3. `src/web/server.ts` — правок НЕТ

Существующая точка старта (171) и остановки (184, 192) сохраняется как есть (AC7 — регрессия не ломается, проверяется тестом из п. 11).

### 4. `src/web/supervisor.test.mjs` (тесты VL-268; там уже есть stub-бин qwen и `setSpawnEnvBaseForTests`)

9. Импорты: `afterEach` из `vitest`; из `../../dist/web/supervisor-tick.js` — `isSupervisorTimerRunning, stopSupervisorTimer`. Добавить `afterEach(() => stopSupervisorTimer())` (isolate:false — шов и таймер обязаны сбрасываться; таймер `unref()`-нут, но утечка интервала между файлами недопустима).

10. Новый `describe('VL-272 — таймер тика поднимается и снимается прогоном')`:
   - **AC1**: `startSupervisorRun(testRoot, plan, [...GRANTABLE_TOOLS], expiresAt)` для задачи со статусом `Spec` → `res.ok === true` и `isSupervisorTimerRunning() === true`; затем `stopSupervisorTimer()`.
   - **AC2 (stop)**: после успешного старта `stopSupervisorRun(testRoot, plan.runId)` → `isSupervisorTimerRunning() === false`; `findActiveGrant` null.
   - **AC2 (авто-отзыв)**: создать задачу `Done`, записать grant (`writeGrant`), поднять таймер (`startSupervisorTimer`) → `supervisorRunStatus(testRoot)` даёт `autoRevoked === true` → `isSupervisorTimerRunning() === false`.
   - **AC5**: план собрать у обычной задачи, затем передать в `startSupervisorRun` испорченный план (`order.map(i => ({...i, phase: 'nonsense'}))`) — `startTaskPhase` вернёт `{ error: 'Фаза nonsense недопустима из статуса …' }`, `record.started` пуст → `res.ok === false`, `findActiveGrant === null` и `isSupervisorTimerRunning() === false`.
   - **AC6**: `process.env.VIBELOG_SUPERVISOR_TICK = 'off'` → успешный `startSupervisorRun` (`ok === true`) и `isSupervisorTimerRunning() === false`; в `finally` — `delete process.env.VIBELOG_SUPERVISOR_TICK`.

### 5. `src/web/supervisor-limits.test.mjs` (там уже импортированы хелперы таймера)

11. Новые кейсы в `describe('таймер тика (AC1)')`:
   - **AC4 (идемпотентность)**: `writeGrant` активного grant'а → `startSupervisorTimer(cwd, { intervalMs: 3_600_000 })` дважды подряд → оба `true`, `isSupervisorTimerRunning() === true`; после одного `stopSupervisorTimer()` → `false` (дублирующий интервал обнаружился бы продолжением тиков; опционально — по росту `state.json.tick` при `intervalMs` 40 мс и окне 200 мс с запасом, только если не даёт флаки).
   - **AC7 (регрессия сервера)**: `startWebServer(cwd, 0, false, join(cwd, 'no-dist'))` (как в `src/web/static.test.mjs` — fallback на inline HTML, react-dist не нужен), дождаться `listening` → `isSupervisorTimerRunning() === false` (нет grant'а — таймера нет); в `finally` — `server.close()`. Импортировать `startWebServer` из `../../dist/web/server.js`.

### 6. Документация

12. **`README.md`** (~520-524, раздел «Супервизор: тик, лечение и планировщик»): уточнить, что таймер поднимается не только при старте `vibelog browser` с уже лежащим grant'ом, но и в момент выдачи grant'а (`startSupervisorRun`), и гасится на stop прогона, авто-отзыве (терминальные статусы / истечение `expiresAt`) и `server.close`.
13. **`doc-19` §5** (предложение «Кто крутит тик», ~строка 116): дополнить той же формулировкой про точку старта/остановки таймера + сослаться на VL-272. Правится через `document_update` (в фазе Code).

## Порядок работ (Code)

1. Правки в `src/web/supervisor-tick.ts` (п. 7-8) — импорт таймера и self-stop.
2. Правки в `src/web/supervisor.ts` (п. 1-6) — импорт, хелпер, 4 точки.
3. `pnpm build`, затем точечные прогоны: `pnpm test:fast src/web/supervisor.test.mjs src/web/supervisor-limits.test.mjs src/web/supervisor-tick.test.mjs` (существующие тесты VL-270 про таймер обязаны остаться зелёными — AC8).
4. Новые тесты (п. 9-11), повторный прогон этих файлов.
5. Полный `pnpm build && pnpm lint && pnpm test` (AC10).
6. Документация (README + doc-19) — отдельным коммитом `docs(supervisor): ...`, затем ручная проверка (ниже).

## Как проверить

- Автотесты: `pnpm build && pnpm lint && pnpm test` (полный прогон, AGENTS.md: частичный прогон DoD не закрывает).
- Ручная проверка (AC9, живой `vibelog browser`): в `.vibelog/settings.json` выставить `supervisor.tick_seconds: 5` (для быстрой наблюдаемости) → `vibelog browser` (сервер стартует БЕЗ grant'а, таймера нет) → в чате/через MCP `backlog_supervisor start` с `ids` (grant пишется, первая волна идёт) → `watch -n 1`-эквивалент: `node -e` либо чтение `.vibelog/supervisor/state.json` (растущий `tick`) и `.vibelog/supervisor/heartbeat.md` (обновляется) **без перезапуска процесса** → `backlog_supervisor stop`: файлы перестают обновляться, повторный `start` снова поднимает тик.
- Регрессия сервера (AC7): тест из п. 11 + ручное «стартовал сервер без grant'а — `.vibelog/supervisor/state.json` не создаётся».

## Риски

1. **Утечка интервала в тестах** (`isolate:false`): `startSupervisorRun` теперь поднимает 60-секундный `unref()`-интервал. Митигация — `afterEach(() => stopSupervisorTimer())` в `supervisor.test.mjs`; интервал `unref()` не держит воркер, а за длительность теста (мс) тик не успевает сработать.
2. **Остановка чужого таймера**: слепой `stopSupervisorTimer()` в `stopSupervisorRun` убил бы таймер второго активного прогона. Митигация — `stopTimerIfNoActiveGrant` (после отзыва проверяем `findActiveGrant`).
3. **Self-stop по `skipped='no-grant'`** (п. 7): после остановки тика новый grant поднимает его ТОЛЬКО через `startSupervisorRun`; ручной `writeGrant` (тесты, ручная правка файла) таймер не поднимает — это ожидаемое поведение (единственная продовая точка выдачи grant'а — `backlog_supervisor start`), фиксируется в комментарии кода и в Implementation Notes.
4. **Два процесса с таймером** (bot + browser), если `backlog_supervisor start` придёт из ботового MCP-процесса: тик disk-based, guard `ticking` — пер-процессный. Риск низкий (двойной тик не разрушителен: `state.json` пишется атомарно, LLM-вызов дублируется лишь в окне совпадения) — фиксируем как известное ограничение в Implementation Notes, код не усложняем.
5. **Истечение `expiresAt`** замечается только на очередном тике (до 60 с задержки) — приемлемо: до этого тик просто возвращает `skipped='no-grant'` и модель не вызывает.
6. **Цикл импортов** `supervisor.ts ↔ supervisor-tick.ts`: отсутствует (таймерный модуль не импортирует `supervisor.ts`); проверяется `pnpm build` (tsc не пожалуется, но при появлении цикла vitest-импорт dist даст `undefined` — тесты п. 10 ловят сразу).

## Связи

- VL-270 (Done) — историю не переоткрываем: тесты таймера там остаются зелёными (AC8).
- `doc-19` §5 — уточняется в фазе Code (п. 13).
- AC18 VL-270 (живой E2E) объясняется этим дефектом: юнит-тесты вызывали `runSupervisorTick` напрямую, минуя отсутствующую точку подъёма таймера.
<!-- SECTION:PLAN:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
### Реализация (фаза Code)

**Точки подъёма/гашения таймера (реализовано):**
- `startSupervisorRun` (успешный старт, после `saveState`/`saveRunRecord`) → `startSupervisorTimer(cwd)` в `try/catch` с `console.error` — ошибка таймера не отменяет уже запущенный прогон.
- `startSupervisorRun` (ветка `record.started.length === 0`) → `stopTimerIfNoActiveGrant(cwd)`.
- `stopSupervisorRun` (после отзыва) → `stopTimerIfNoActiveGrant(cwd)`.
- `supervisorRunStatus` (авто-отзыв «все задачи терминальны») → `stopTimerIfNoActiveGrant(cwd)`.
- `src/web/supervisor-tick.ts`: self-stop по `res.skipped === 'no-grant'` внутри `run()` — единственный путь заметить истечение `expiresAt` (иначе интервал молотил бы до конца процесса).
- Хелпер `stopTimerIfNoActiveGrant` (не гасит таймер соседнего активного прогона) в `src/web/supervisor.ts`.

**Решение по вопросу 5 задачи (self-healing):** периодической перепроверки «grant появился — поднять таймер» НЕ добавляли. Достаточно явных вызовов из `start`/`stop`/авто-отзыв; единственное исключение — точечный self-stop при отсутствии grant'а (нужен ровно для истечения срока). Ручной `writeGrant` мимо `backlog_supervisor start` таймер не поднимает — ожидаемое поведение, продовая точка выдачи grant'а одна.

**Расхождение/уточнение doc-19 §5 (для фазы Close):** предложение «Кто крутит тик: … Таймер заводится только при действующем grant'е … Снимается на `server.close`/`server.on('error')`» не описывало **момент** подъёма таймера после выдачи grant'а. По правилам фазы Code документы `backlog/docs` не правятся — README обновлён (раздел «Супервизор: тик, лечение и планировщик»), а doc-19 §5 нужно дополнить в Close формулировкой: таймер поднимается и при старте `vibelog browser` с уже лежащим grant'ом, и в момент выдачи grant'а (`startSupervisorRun`); гасится на stop прогона, авто-отзыве (терминальные статусы), истечении `expiresAt` (self-stop по `skipped='no-grant'`), `server.close`/`server.on('error')`. Ссылка на VL-272.

**Известные ограничения:** (1) два процесса с таймером (bot + browser) — тик disk-based, `state.json` пишется атомарно, дублирование LLM-вызова возможно лишь в окне совпадения; (2) истечение `expiresAt` замечается на очередном тике (до `tick_seconds` задержки); (3) снятие таймера в тестах обязательно — `startSupervisorRun` поднимает 60-секундный `unref()`-интервал, добавлен `afterEach(stopSupervisorTimer)`.
<!-- SECTION:NOTES:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-01 15:13
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача) — план записан в саму задачу (Implementation Plan), подзадачи не создавались.
**Диагноз подтверждён по коду.** `startSupervisorTimer` (`src/web/supervisor-tick.ts:1540`) вызывается ровно из одной продовой точки — `src/web/server.ts:171` (после `server.listen`), и первым делом делает `if (findActiveGrant(cwd) === null) return false;` (строка 1543). Сервер стартует раньше grant'а → таймер не заведён; `runSupervisorTick` живёт только в теле `setInterval` внутри таймера, других вызовов из прода нет. Отсюда: после выдачи grant'а первая волна отработает и прогон встанет — без планирования следующих волн, healing и авто-багов. «Починится» случайно только при перезапуске `vibelog browser`.
**Файлы в плане (4 изменяемых + 2 документа):**
- `src/web/supervisor.ts` — импорт таймера из `./supervisor-tick.js` (цикла импортов нет), хелпер `stopTimerIfNoActiveGrant` и 4 точки: успешный `startSupervisorRun` (строка 560) → `startSupervisorTimer`; ветка «ни одна фаза не запустилась» (:548) → гашение; `stopSupervisorRun` (:593) → гашение; авто-отзыв в `supervisorRunStatus` (:663) → гашение.
- `src/web/supervisor-tick.ts` — в тело таймера добавлен self-stop при `res.skipped === 'no-grant'` (единственный путь заметить истечение `expiresAt`) + JSDoc с точками вызова.
- `src/web/server.ts` — правок нет (AC7: регрессия не ломается, покрывается тестом).
- `src/web/supervisor.test.mjs` — новый describe с 5 кейсами (AC1, AC2×2, AC5, AC6) + `afterEach(stopSupervisorTimer)`.
- `src/web/supervisor-limits.test.mjs` — кейсы идемпотентности (AC4) и регрессии старта сервера без grant'а (AC7).
- `README.md` и `doc-19` §5 — уточнение точки старта/остановки таймера.
**Проверка:** `pnpm build && pnpm lint && pnpm test` (полный прогон — по AGENTS.md частичный DoD не закрывает), точечно `pnpm test:fast` по трём supervisor-файлам; ручной прогон на живом `vibelog browser` с `tick_seconds: 5` — сервер без grant'а → `backlog_supervisor start` → растущий `state.json.tick` и обновляемый `heartbeat.md` без перезапуска процесса → `stop` → обновление прекращается.
**Риски (6, все с митигацией):** утечка интервала между тестами при `isolate:false` (afterEach + `unref()`); слепой stop убил бы таймер второго активного прогона (проверка `findActiveGrant` после отзыва); ручной `writeGrant` вне `startSupervisorRun` таймер не поднимает (ожидаемо, единственная продовая точка выдачи grant'а); два процесса (bot + browser) с таймером — известное ограничение, тик disk-based и атомарен; истечение `expiresAt` замечается на следующем тике (≤60 с); цикл импортов отсутствует (ловится сборкой и тестами п. 10).
Решения по открытым пунктам задачи: AC5 «нужен ли self-healing» — достаточно явных вызовов из start/stop/авто-отзыв; единственное исключение — точечный self-stop при `no-grant`, без него не заметить истечение срока. Существующее поведение `server.ts` сохранено.
---
author: @agent
created: 2026-11-01 15:17
---
Фаза 3 (Code) выполнена. Коммит `9ee5cd4` — «fix: VL-272 — таймер тика супервизора поднимается при выдаче grant'а».
**Изменено (5 файлов, +197/-2):**
- `src/web/supervisor.ts` — импорт `startSupervisorTimer`/`stopSupervisorTimer`; хелпер `stopTimerIfNoActiveGrant` (не гасит таймер соседнего активного прогона); 4 точки: успешный `startSupervisorRun` → `startSupervisorTimer` в `try/catch` (ошибка таймера не отменяет запущенный прогон), ветка «ни одна фаза не запустилась» → гашение, `stopSupervisorRun` → гашение, авто-отзыв в `supervisorRunStatus` → гашение.
- `src/web/supervisor-tick.ts` — self-stop по `res.skipped === 'no-grant'` внутри тела таймера (единственный путь заметить истечение `expiresAt`) + JSDoc с точками вызова/гашения.
- `src/web/supervisor.test.mjs` — `afterEach(stopSupervisorTimer)` и новый describe с 5 кейсами: AC1, AC2 (stop), AC2 (авто-отзыв), AC5 (провал старта), AC6 (`off`).
- `src/web/supervisor-limits.test.mjs` — кейсы AC4 (идемпотентность) и AC7 (`startWebServer` без grant'а не поднимает таймер, `server.close` гасит).
- `README.md` — раздел «Супервизор: тик, лечение и планировщик»: точка подъёма таймера (в т.ч. при выдаче grant'а) и точки гашения.
- `src/web/server.ts` — правок нет (регрессия не сломана, покрыта тестом AC7).
**Проверки:** `pnpm build` — ok; `pnpm lint` — ok; точечно 3 supervisor-файла — 39 тестов passed; **полный `pnpm test`** (build + `vitest run --exclude src/web/static.test.mjs` + `vitest run src/web/static.test.mjs` из package.json) — 118 файлов / **2152 passed, 4 skipped**, второй прогон static 8/8 passed. Исключений/`--skip` добавлялось 0 (static.test.mjs — штатное разделение из package.json, прогон вторым вызовом прошёл). Регрессий нет.
**Не отмечено (честно):**
- **AC3** (продовый сценарий целиком: реальные волны → планирование следующих волн, healing, авто-баги) — автотестами покрыта цепочка «сервер без grant'а → выдача grant'а → таймер поднят», но полный живой E2E с реальным LLM не запускался.
- **AC9** (ручная проверка на живом `vibelog browser` с растущим `tick` и обновлением `heartbeat.md`, затем stop) — не выполнялась в этой фазе: требует интерактивного прогона с реальным LLM; рекомендация выполнить в Close при живом сервере.
- **DoD 2 «Документация обновлена»** — README обновлён, но `doc-19` §5 (точка подъёма таймера) по правилам фазы Code в `backlog/docs` не правился; точная формулировка для §5 зафиксирована в Implementation Notes — правку делает Close.
- **DoD 1, DoD 3** — выполнены (полный прогон зелёный, регрессий нет).
**Notes (для Close):** уточнение doc-19 §5 + известные ограничения (два процесса с таймером; `expiresAt` замечается на очередном тике; ручной `writeGrant` мимо `backlog_supervisor start` таймер не поднимает) записаны в `## Implementation Notes` задачи.
---
author: @agent
created: 2026-11-01 15:25
---
Фаза Close выполнена. Ветка `vb/vl-272` слита в master (1 коммит `9ee5cd4` + merge), worktree и ветка удалены, `git worktree prune` выполнен.
**Проверки после merge:** `pnpm build` — ok; ранний точечный фильтр по diff'у (`src/web/supervisor.ts`, `supervisor-tick.ts` + два тест-файла) — `pnpm test:fast` 39 тестов passed; `pnpm lint` — ok; **полный `pnpm test`** — 118 файлов / 2152 passed, 4 skipped (+ штатный второй вызов `vitest run src/web/static.test.mjs` из package.json — 8/8 passed). Исключений и `--skip` не добавлялось. Повторных полных прогонов не потребовалось, падений не было.
**Документация (DoD 2 — закрыт):** `README.md` обновлён в Code (раздел «Супервизор: тик, лечение и планировщик» — обе точки подъёма таймера и все точки гашения); в Close по правилам шага 8 обновлены `backlog/docs/doc-19` §5 (новый абзац «Момент подъёма и гашения таймера (уточнено в VL-272)» — ровно та формулировка, что была зафиксирована в Implementation Notes/Code) и `CHANGELOG.md` (раздел Unreleased → Исправлено, запись VL-272). Коммит документации: `1520da9` «docs: VL-272 — документация и CHANGELOG»; refs/lessons: `6b24420` (новый lesson-129).
**DoD:** 1 «Тесты проходят» — выполнен (полный прогон зелёный); 2 «Документация обновлена» — выполнен (README + doc-19 §5 + CHANGELOG); 3 «Нет регрессий» — выполнен (регрессионный тест AC7 «старт сервера без grant'а таймер не поднимает» зелёный, существующие тесты VL-268/VL-270 про таймер зелёные).
**Осталось непокрытым (честно, AC отмечены не будут):** AC3 (продовый сценарий doc-19 §15 целиком — реальные последующие волны, healing, авто-баги) и AC9 (ручная проверка на живом `vibelog browser`: растущий `tick` в `state.json` + обновление `heartbeat.md` без перезапуска процесса, затем stop) — требуют интерактивного прогона с реальным LLM, в этой фазе не выполнялись. Автотестами покрыта цепочка «сервер без grant'а → выдача grant'а → таймер поднят → stop/авто-отзыв снимает».
**Известные ограничения** (из Implementation Notes, кода не менялось): два процесса с таймером (bot + browser) дают возможный дубль LLM-вызова только в окне совпадения при дисковой модели состояния; истечение `expiresAt` замечается на очередном тике (до `tick_seconds` задержки); ручной `writeGrant` мимо `backlog_supervisor start` таймер не поднимает — продовая точка выдачи grant'а одна.
---
<!-- COMMENTS:END -->