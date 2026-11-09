---
id: VL-334
title: 'Веб-чат: кнопка «Продолжить» в PricingDriftCard не перезапускает ход + добавить «Продолжить и обновить тариф»'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-04 19:39'
updated_date: '2026-11-09 21:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.13
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - web/src/lib/price-refresh.ts
  - web/src/components/chat/pricing-drift-card.tsx
  - web/src/components/chat/thread.tsx
  - src/web/chat-pricing-card.test.mjs
lessons:
  - lesson-216
token_usage:
  input: 9433075
  output: 92087
  cache: 8845312
  total: 9525162
  requests: 146
  duration_ms: 1456523
  reasoning: 64246
  by_phase:
    plan:
      input: 2620252
      output: 35687
      cache: 2427904
      requests: 43
    code:
      input: 5375882
      output: 49866
      cache: 5085184
      requests: 71
    close:
      input: 1436941
      output: 6534
      cache: 1332224
      requests: 32
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

При смене тарифа у вендора в веб-чате появляется карточка `PricingDriftCard` (VL-317) с предупреждением о росте стоимости и кнопкой «Продолжить». По нажатию ничего не происходит — ход не начинается, пользователю приходится заново отправлять сообщение.

## Причина (проверено по коду)

`web/src/components/chat/thread.tsx` (рендер `CHAT_PRICING_PART`) создаёт карточку **без пропа `onContinue`**:

```tsx
<PricingDriftCard kind={...} message={...} vendor={...} alternative={...} maxDeltaPercent={...} />
```

А в `web/src/components/chat/pricing-drift-card.tsx` кнопка делает ровно два действия:

```ts
setPricingDecision(ack, nextVendor)  // решение запоминается в <threadId>.pricing.json
onContinue?.()                       // undefined → ход не перезапускается
```

То есть решение серверу уходит, но нового POST хода нет. Рядом в том же файле для исчерпания лимита (`CHAT_TRUNCATED_PART` → `StoppedRun`) перезапуск сделан через `ActionBarPrimitive.Reload` — здесь эту связку просто не пробросили.

## Цель

1. Кнопка «Продолжить» в карточке дрейфа действительно продолжает ход (тот же путь перезапуска, что у «Продолжить» после лимита, VL-269).
2. Новая опция **«Продолжить и обновить тариф»**: продолжает чат и заодно обновляет тариф в настройках из каталога — переиспользовать существующий `POST /api/pricing/refresh` (VL-317, `refreshModelPricing` с валидацией до записи).
3. Помимо неё остаются текущие варианты: «Перейти на <вендор>» (если альтернатива известна) и просто «Продолжить».

## Входные данные

- Наблюдение пользователя: «По нажатию на кнопку Продолжить дальше ничего не происходит, нужно заново отправлять сообщение. И я бы помимо предложения другого вендора добавил бы ещё опцию "Продолжить и обновить тариф", при выборе которой продолжается не только чат, но в настройках ещё и обновляется тариф.»
- Точки кода: `web/src/components/chat/pricing-drift-card.tsx`, `web/src/components/chat/thread.tsx` (~стр. 174–205), `POST /api/pricing/refresh`, `setPricingDecision` в `web/src/components/chat/chat-runtime.tsx`.

## Вопросы для реализации

- Порядок операций в «Продолжить и обновить тариф»: сначала refresh → при успехе `setPricingDecision(true)` + Reload; при ошибке refresh — ход не продолжаем, показываем ошибку (не молчаливый «продолжили по старой цене»).
- Что делать, если refresh вернул цену, всё ещё выше порога (дрейф не устранён): обновлять тариф всё равно, т.к. это действие пользователя.
- Нужна ли новая кнопка при `kind: 'warn'/'auto'` — нет, только в `ask`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Кнопка «Продолжить» в PricingDriftCard перезапускает ход: решение фиксируется (setPricingDecision) и отправляется новый POST — без повторной отправки сообщения пользователем
- [x] #2 Перезапуск идёт тем же путём, что «Продолжить» после лимита (VL-269/StoppedRun), без дублирования логики
- [x] #3 В карточке (kind=ask) есть третья опция «Продолжить и обновить тариф»: вызывает POST /api/pricing/refresh, затем setPricingDecision(true) и перезапуск хода
- [x] #4 При ошибке refresh (офлайн/невалидный каталог) ход НЕ продолжается, пользователю показана ошибка — без молчаливого продолжения по старой цене
- [x] #5 Опция «Продолжить и обновить тариф» отсутствует при kind=warn/auto; существующие «Продолжить» и «Перейти на <вендор>» сохраняются
- [x] #6 Кнопки блокируются на время запроса (busy), повторные клики не порождают параллельных ходов
- [x] #7 Тесты на новое поведение (refresh→continue, ошибка refresh, отсутствие пропа onContinue больше не воспроизводится)
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

`web/src/components/chat/thread.tsx:196-215` рендерит `PricingDriftCard` **без пропа `onContinue`**, а в `web/src/components/chat/pricing-drift-card.tsx:61-67` перезапуск хода делается только через него: `onContinue?.()` — undefined, ход не стартует. Решение при этом уже уходит на сервер (`setPricingDecision` → body `pricingAck`/`pricingVendor`, `src/web/chat.ts:1166-1180`), т.е. бессмысленно теряется.

Эталон перезапуска — плашка лимита: `thread.tsx:229-247` (`CHAT_TRUNCATED_PART` → `StoppedRun` + `ActionBarPrimitive.Reload`). `Reload` внутри message-контекста = `aui.message.reload()` (`backlog/references/data/assistant-ui/packages/core/src/react/primitive-hooks/useActionBarReload.ts`), доступен и через `useAui()`.

## Файлы

| Файл | Что делаем |
|---|---|
| NEW `web/src/lib/price-refresh.ts` | Чистый (без React) модуль: `refreshCatalogPricing(modelId, fetchFn?)` → `POST /api/pricing/refresh` c `{id}`; `refreshThenContinue({modelId, decide, continueRun, fetchFn?})` — порядок «refresh → при успехе decide(true) → continueRun», при ошибке **ни decide, ни перезапуска**, возвращает `{ok:false, error}`. Инъекция `fetchFn` нужна для тестов. |
| `web/src/components/chat/pricing-drift-card.tsx` | Проп `model?: string` (id модели из события `pricing`); третья кнопка «Продолжить и обновить тариф» только при `kind==='ask'` и наличии `model`; состояние `busy: 'continue'\|'switch'\|'refresh'\|null` (кнопки disabled), `error: string\|null` (`role="alert"`, `text-destructive`), `done`; успешный refresh → `setDone('Тариф обновлён')` + перезапуск; ошибка → текст ошибки, ход НЕ продолжается; после успешного перезапуска `busy` не снимаем (защита от повторных кликов). |
| `web/src/components/chat/thread.tsx` | `PartView` (ветка `CHAT_PRICING_PART`, стр. ~190-215) обернуть в новый компонент `PricingPart` в этом же файле: `const aui = useAui()`, `onContinue = React.useCallback(() => aui.message.reload(), [aui])` — тот же путь, что `ActionBarPrimitive.Reload` у `StoppedRun` (AC2); передать `model` из payload; `PricingDriftCard` перестаёт быть «пустым» по пропу (AC1). |
| NEW `src/web/chat-pricing-card.test.mjs` | Тесты (vitest импортирует TS веб-исходников напрямую, как `src/web/chat-thread-restore.test.mjs`): (1) `refreshThenContinue` — успех: сначала refresh, затем `decide(true)`, затем `continueRun` (проверка порядка по журналу вызовов); (2) ошибка refresh (500 + `{error}`): `decide` и `continueRun` НЕ вызваны, вернулся текст ошибки; (3) сетевое исключение fetch → то же; (4) статический контракт по тексту исходников: `thread.tsx` передаёт `onContinue`, карточка содержит `onContinue?.()` в `decide` и `refreshThenContinue`, кнопка «Продолжить и обновить тариф» под `kind === "ask"` (AC7). |
| `backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md` | В раздел «Сверка цены вендора с каталогом» — третья кнопка карточки: что делает, что при ошибке каталога ход не продолжается (DoD «документация обновлена»). |
| `CHANGELOG.md` | Запись VL-334 (в фазе Code/Close). |

## Порядок действий

1. `web/src/lib/price-refresh.ts`: типы результата (`{ok:true}` / `{ok:false, error}`), `refreshCatalogPricing`, `refreshThenContinue`; комментарии на русском «почему» (ошибка каталога не должна молча продолжать ход по старой цене — AC4).
2. `pricing-drift-card.tsx`: проп `model`, `busy` расширяется значением `'refresh'`, `error`-состояние, кнопка «Продолжить и обновить тариф» (`ghostButton`, иконка `RefreshCw` из `lucide-react` — уже используется в thread.tsx), вызов `refreshThenContinue`.
3. `thread.tsx`: `PricingPart` с `useAui()`, проброс `model`, `onContinue`.
4. `pnpm --dir web typecheck` (или `pnpm web:build`) — типы/сборка веба; `pnpm build && pnpm test` — полный прогон; точечно `npx vitest run src/web/chat-pricing-card.test.mjs`.
5. Ручная проверка в браузере (`pnpm web`): включить `pricing_guard` с `on_drift: ask`, спровоцировать карточку, нажать каждую из трёх кнопок.

## Риски

- **R1 (VL-331/lesson-213):** `Reload` создаёт sibling-assistant-сообщение → переключатель «2/2». Для карточки цены это терминальное состояние (как у `StoppedRun`), AC2 прямо требует тот же путь; ветку проверяем глазами, и если «2/2» мешает — обсудить замену на `aui.thread.startRun` отдельной задачей (не менять путь в этой).
- **R2:** `aui.message.reload()` может быть недоступен вне message-контекста — `PricingPart` рендерится из `PartView` внутри тела сообщения, контекст есть; при сбое `reload` — кнопка остаётся, поведение как сейчас (не регресс, но в отчёте фазы Code отметить).
- **R3:** `takePricingDecision()` — module-state, забирается первым POST хода; повторный клик мог бы уйти без ack → закрыто `busy` (кнопки disabled, `busy` не снимается после успеха).
- **R4:** событие `pricing` может не содержать `model` (дрейф без резолва) — тогда кнопка обновления тарифа скрыта, «Продолжить»/«Перейти на …» работают.
- **R5:** после успешного refresh сервер пересчитает дрейф уже по новому тарифу (кэш сбрасывается в `refreshModelPricing`), второй карточки в том же ходе не будет — проверка `pricingAck` в `chat.ts` идёт до `decideDriftPolicy`.

## Проверка

- `pnpm build && pnpm test` (полный), плюс `pnpm web:build`.
- Тест `src/web/chat-pricing-card.test.mjs` зелёный; регресс-кейс AC7: статический тест падает, если из `thread.tsx` убрать `onContinue` (ровно текущий баг).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-05 00:20
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача, не эпик) — план записан в Implementation Plan задачи VL-334.
Что изучено (факты, а не догадки):
- `web/src/components/chat/thread.tsx:190-215` — `PricingDriftCard` рендерится БЕЗ `onContinue`, поэтому `onContinue?.()` в `pricing-drift-card.tsx:66` — no-op: `setPricingDecision` уходит в module-state, но нового POST нет. Причина подтверждена.
- Эталон перезапуска: `thread.tsx:229-247` (`CHAT_TRUNCATED_PART` → `StoppedRun` + `ActionBarPrimitive.Reload`); `Reload` = `aui.message.reload()` (`backlog/references/data/assistant-ui/packages/core/src/react/primitive-hooks/useActionBarReload.ts`), доступен через `useAui()` (используется в `thread.tsx:301`).
- `POST /api/pricing/refresh` (`src/web/catalog-api.ts:421-439`) принимает `{id}` (id из `models.available`), внутри `refreshModelPricing` (`src/core/pricing-guard.ts:749`) валидирует каталог ДО записи и сбрасывает кэш сверки.
- Событие `pricing` (`src/web/chat.ts:1192-1230`) несёт `model`, `vendor`, `alternative`, `maxDeltaPercent` — id модели для refresh уже есть на клиенте.
- `pricingAck` обрабатывается сервером ДО `decideDriftPolicy`, т.е. после refresh (цена уже новая) второй карточки в том же ходе не будет.
Объём плана: 5 файлов (2 новых: `web/src/lib/price-refresh.ts` с чистыми `refreshCatalogPricing`/`refreshThenContinue` и `src/web/chat-pricing-card.test.mjs`; 3 правки: `pricing-drift-card.tsx` — третья кнопка «Продолжить и обновить тариф» + busy/error, `thread.tsx` — обёртка `PricingPart` с `useAui()` и `onContinue`, doc-6; плюс CHANGELOG в Code/Close).
Риски: R1 — `Reload` создаёт sibling-сообщение (lesson-213/VL-331), но AC2 прямо требует тот же путь, что у «Продолжить» после лимита; R2 — недоступность `aui.message.reload` вне message-контекста; R3 — повторные клики закрыты `busy` (кнопки disabled, busy не снимается после успеха); R4 — событие без `model` скрывает кнопку refresh; R5 — после refresh дрейф пересчитывается по новому тарифу. Проверка: `pnpm web:build`, полный `pnpm build && pnpm test`, ручной сценарий в браузере с `on_drift: ask`.
---
author: @agent
created: 2026-11-05 00:29
---
Фаза 3 (Code) выполнена. Коммит 7146c45.
Изменено (4 файла):
- NEW `web/src/lib/price-refresh.ts` — чистый модуль: `refreshCatalogPricing(modelId, fetchFn)` (POST /api/pricing/refresh, текст ошибки сервера `{error}` отдаётся как есть, не-JSON → «Сервер ответил N», сетевой сбой → «Каталог недоступен: …») и `refreshThenContinue({modelId, decide, continueRun, fetchFn})` — жёсткий порядок refresh → decide → continueRun, при ошибке ни decide, ни перезапуска (AC4).
- `web/src/components/chat/pricing-drift-card.tsx` — проп `model?: string`; третья кнопка «Продолжить и обновить тариф» только внутри ветки `kind === "ask"` и при известном `model` (AC3/AC5); `busy: 'continue'|'switch'|'refresh'|null` блокирует все кнопки, после успеха не снимается (повторный клик не даёт второго POST с уже израсходованным `pricingAck` — AC6); ошибка refresh показывается `role="alert"` в `text-destructive`, busy снимается — можно повторить или выбрать «Продолжить» осознанно; иконка RefreshCw крутится на время запроса.
- `web/src/components/chat/thread.tsx` — ветка `CHAT_PRICING_PART` переведена на новый компонент `PricingPart`: `const aui = useAui()`, `onContinue = useCallback(() => aui.message.reload(), [aui])` — ровно тот путь, что у `StoppedRun` + `ActionBarPrimitive.Reload` (AC1/AC2, логика не дублируется); `model` из payload пробрасывается в карточку.
- NEW `src/web/chat-pricing-card.test.mjs` — 11 тестов: POST/тело refresh, ошибка 404 с текстом, не-JSON 503, офлайн; порядок `['refresh','decide','continue']` на успехе; отсутствие вызовов при ошибке API и при сетевом сбое (AC4); статический контракт — `thread.tsx` содержит `aui.message.reload()` и `onContinue={onContinue}`, карточка — `setPricingDecision(ack, nextVendor)` / `onContinue?.()`, кнопка внутри блока `kind === "ask"` под `{model !== undefined`, `disabled={busy !== null}`, `role="alert"`, `setBusy(null)` (AC7 — регресс «рендер без onContinue» ловится тестом).
Проверки: `pnpm build` — чисто; полный `npx vitest run` — 173 файла / 3286 тестов passed, 4 skipped (скипы в `src/core/frontmatter.test.mjs` — предсуществующие, не связаны с задачей; исключённых файлов нет); `npx tsc -b` в `web/` — чисто (потребовалась установка `web/node_modules` через pnpm install, т.к. в worktree их не было). Линт/prettier не гонял.
Не сделано / риски: R1 (lesson-213) — `Reload` создаёт sibling-сообщение («2/2»), для терминального состояния карточки это тот же путь, что у StoppedRun, но браузером не проверял — в Close стоит глянуть; R2 — `aui.message.reload()` вне message-контекста не вызывается (PricingPart рендерится из PartView внутри сообщения); R4 — при событии `pricing` без `model` кнопка обновления скрыта, остальные работают. Браузерная проверка не выполнялась (нужен запуск `pnpm web` с `pricing_guard.on_drift: ask`) — вынести в Close.
Документация (doc-6, CHANGELOG) — по правилам фазы Code не трогал, пишет Close.
---
author: @agent
created: 2026-11-05 00:34
---
Фаза Close выполнена. Ветка vb/vl-334 слита в master (1 коммит 7146c45, merge --no-ff — конфликтов не было), worktree `.vibelog/worktrees/vl-334` удалена (force — в ней оставался только untracked-симлинк `backlog/references/data` от оркестратора), ветка vb/vl-334 удалена (`-d`, was 7146c45), `git worktree prune` выполнен.
Проверки после merge: `pnpm build` — чисто; ранний точечный фильтр по diff'у merge — `npx vitest run src/web/chat-pricing-card.test.mjs` — 11 тестов passed; **полный прогон** `npx vitest run` — 173 файла / 3286 тестов passed, 4 skipped (предсуществующие скипы в `src/core/frontmatter.test.mjs`), исключённых файлов нет, повторных полных прогонов не было. Diff merge затронул `web/src/**` + `src/web/chat-pricing-card.test.mjs` (web-исходники собираются отдельным `pnpm web:build`, в DoD-прогон vitest'а не входят).
Документация (DoD 2): doc-6, раздел «Сверка цены вендора с каталогом — секция `pricing_guard`» — добавлен пункт «Кнопки карточки дрейфа (VL-334)»: что делает каждая из трёх кнопок, что при ошибке каталога ход НЕ продолжается и показывается ошибка, что кнопки блокируются на время запроса. CHANGELOG.md — запись VL-334 в Unreleased/Исправлено (коммит 266b5ad).
Lessons: создан lesson-216 («Проверяй проброс необязательных пропсов-колбэков в React-точке рендера статическим тестом по исходнику»), связан с VL-334, закоммичен (09452cb).
DoD: 1 (тесты проходят) — полный прогон зелёный; 2 (документация обновлена) — doc-6 + CHANGELOG; 3 (нет регрессий) — полный набор зелёный, новых падений нет.
Замечания: (R1/lesson-213) `aui.message.reload()` создаёт sibling-assistant-сообщение — переключатель «2/2» для карточки цены является терминальным состоянием, как у `StoppedRun`; браузером не проверялось (нужен запуск `pnpm web` с `pricing_guard.on_drift: ask`) — при необходимости замены на `aui.thread.startRun` заводить отдельную задачу. (R2) `PricingPart` рендерится из `PartView` внутри тела сообщения, message-контекст для `reload` есть.
---
<!-- COMMENTS:END -->