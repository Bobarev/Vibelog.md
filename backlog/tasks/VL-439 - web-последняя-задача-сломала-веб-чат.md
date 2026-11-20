---
id: VL-439
title: Веб-чат падает с ошибкой AuiProvider
status: Done
assignee: []
reporter: ''
created_date: '2026-11-19 19:42'
updated_date: '2026-11-20 05:05'
due_date: ''
labels:
  - web
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
  - web/src/components/chat/chat-runtime.tsx
  - web/src/components/chat/thread.tsx
lessons:
  - lesson-304
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 156
  duration_ms: 3405441
  by_phase:
    spec:
      input: 0
      output: 0
      cache: 0
      requests: 4
    plan:
      input: 0
      output: 0
      cache: 0
      requests: 56
    code:
      input: 0
      output: 0
      cache: 0
      requests: 83
    close:
      input: 0
      output: 0
      cache: 0
      requests: 13
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Последняя задача сломала веб чат. Теперь при переходе на 127.0.0.1:6445/#/chat - страница падает, а в консоли ошибка: Uncaught Error: You are using a component or hook that requires an AuiProvider. Wrap your component in an <AuiProvider> component.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Страница 127.0.0.1:6445/#/chat открывается без ошибки «You are using a component or hook that requires an AuiProvider» в консоли браузера
- [x] #2 Чат-интерфейс рендерится и базовые действия (открытие списка, отправка сообщения) работают без ошибок в консоли
- [x] #3 Тесты проекта проходят (pnpm test), регрессий в остальном веб-интерфейсе нет
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План исправления (фаза Plan)

## Диагноз (root cause)

Страница `#/chat` падает, потому что **`useAuiState` вызывается в теле `ChatPage` — компонента, который находится ВЫШЕ `AssistantRuntimeProvider`**. Без `AuiProvider` в контексте React хук читает `s.thread.isRunning` у `DefaultAssistantClient`, чей прокси бросает ровно ту ошибку из бага: `You are using a component or hook that requires an AuiProvider`.

- Точка отказа: `web/src/components/chat/thread.tsx:1111` — `const runtimeRunning = useAuiState(s => s.thread.isRunning)` (эффект фонового refetch, VL-431). Функция `ChatPage` начинается на `thread.tsx:945`; `ChatRuntimeProvider` (единственный источник `AuiProvider`) она рендерит **внутри JSX только при `load.status === "ready"`** (`thread.tsx:1235-1251`), а хук исполняется в теле компонента при **каждом** рендере — при любом статусе загрузки.
- `web/src/App.tsx:108` рендерит `<ChatPage />` без каких-либо provider'ов выше; в `web/src/` слово `AuiProvider` не встречается вообще (grep — 0 совпадений), легитимный источник контекста — только `AssistantRuntimeProvider` (`chat-runtime.tsx:947`), который внутри рисует `AuiProvider` (`@assistant-ui/core/dist/react/AssistantProvider.js:17`).
- Остальные 7 вызовов `useAui`/`useAuiState` (`thread.tsx:194, 343-344, 451, 572, 684, 820`) — внутри `ChatThread`, т.е. внутри провайдера — они корректны.

Ошибка «падает сразу при открытии» совпадает: `useAuiState` → `selector(proxiedState)` → чтение `s.thread` → `createErrorClientAccessor` → `throw` во время рендера (`@assistant-ui/store/dist/useAuiState.js:44-61`, `utils/react-assistant-context.js:8`).

## Файлы для изменения

1. **`web/src/components/chat/chat-runtime.tsx`** — рядом с уже существующим module-state расхода (`activeUsage`, строки 393-411) добавить зеркальный store состояния хода + компонент-синхронизатор внутри провайдера:
   - `let activeRunning = false`, `getActiveRunning()`, `setActiveRunning(v)`, `subscribeActiveRunning(listener)` (паттерн повторяет строки 393-411: Set слушателей, рассылка listener'ов);
   - компонент `RunningStateSync`: `const running = useAuiState(s => s.thread.isRunning)`; `React.useEffect(() => { setActiveRunning(running); return () => setActiveRunning(false) }, [running])` — cleanup сбрасывает store при размонтировании провайдера (смена треда/статуса загрузки);
   - строка 947: `<AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>` → `<AssistantRuntimeProvider runtime={runtime}><RunningStateSync />{children}</AssistantRuntimeProvider>` — `RunningStateSync` становится child'ом `AssistantProviderBase`, т.е. попадает внутрь `AuiProvider` (`AssistantProvider.js:17` оборачивает `children`).
   - Импорт: добавить `useAuiState` в существующий import из `@assistant-ui/react` (строки 40-44).

2. **`web/src/components/chat/thread.tsx`** — чат-страница читает состояние хода через подписку, а не через контекст:
   - строка 1111: `const runtimeRunning = useAuiState(s => s.thread.isRunning)` → `const runtimeRunning = React.useSyncExternalStore(subscribeActiveRunning, getActiveRunning, getActiveRunning)` (третий аргумент — как в `usage-bar.tsx:56-64`, SPA без SSR, но сигнатура требует);
   - импорт в строке 66 (import из `"./chat-runtime"`): добавить `getActiveRunning, subscribeActiveRunning`;
   - комментарий VL-431 над эффектом (строки ~1101-1110): дописать причину — «исход хода берётся из module-state, а не `useAuiState`: ChatPage вне `AuiProvider` (VL-439)»;
   - сам импорт `useAuiState` из `@assistant-ui/react` (строка 39) **оставить** — он используется внутри `ChatThread`.

## Порядок действий

1. Внести правки в `chat-runtime.tsx` (store + `RunningStateSync` + строка 947).
2. Внести правки в `thread.tsx` (строка 1111, импорт, комментарий).
3. Точечный ESLint (lesson-282): `cd web && npx eslint src/components/chat/thread.tsx src/components/chat/chat-runtime.tsx`.
4. `cd web && pnpm typecheck` (`tsc --noEmit`).
5. Полный прогон из корня: `pnpm build && pnpm test` (DoD «Тесты проходят» — только по полному прогону).
6. Ручная/браузерная проверка AC1/AC2: открыть `127.0.0.1:6445/#/chat`, в консоли браузера не должно быть `AuiProvider`-ошибки; отправить сообщение, убедиться что лента обновляется и фоновый refetch VL-431 не перезагружает историю во время локального стрима (guard `if (runtimeRunning) return` в эффекте продолжает работать).

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| Текст ошибки бросает `createErrorClientAccessor` у `DefaultAssistantClient` (контекст без провайдера) | `web/node_modules/.pnpm/node_modules/@assistant-ui/store/dist/utils/react-assistant-context.js:8` (`MISSING_PROVIDER_MESSAGE`), `.../utils/client-accessor.js` (`createErrorClientAccessor` → `fail()`) |
| `useAuiState` исполняет `selector(proxiedState)` при рендере → чтение `s.thread` кидает | `web/node_modules/.pnpm/node_modules/@assistant-ui/store/dist/useAuiState.js:44-61` |
| Хук на `thread.tsx:1111` — в теле `ChatPage` (функция с 945-й строки), вне провайдера | `web/src/components/chat/thread.tsx:945` (начало `ChatPage`), `1111` (сам хук), ближайшая функция после — `ErrorState` (896), т.е. строк 1111 между 945 и концом файла, в JSX-детях провайдер не покрывает тело компонента |
| `ChatRuntimeProvider` рендерится только при `load.status === "ready"` и только внутри JSX `ChatPage` | `web/src/components/chat/thread.tsx:1235-1251` |
| Легитимный `AuiProvider` подключается только через `AssistantRuntimeProvider` → `AssistantProviderBase` → `AuiProvider` | `web/src/components/chat/chat-runtime.tsx:947`; `web/node_modules/.pnpm/@assistant-ui+core@0.3.31_.../node_modules/@assistant-ui/core/dist/react/AssistantProvider.js:17` |
| В `web/src/` нет своего `AuiProvider`, `ChatPage` не имеет provider'ов выше | grep `AuiProvider` по `web/src` — 0 совпадений; `web/src/App.tsx:18,108` |
| Всего вызовы `useAui`/`useAuiState` только в `thread.tsx`: 194, 343-344, 451, 572, 684, 820 (внутри `ChatThread` → внутри провайдера) и 1111 (вне) | grep `useAui\|useAuiState` по `web/src`; границы функций: `ChatThread` — `thread.tsx:710`, провайдер-обёртка — `1235-1251` |
| Паттерн module-state + `useSyncExternalStore` уже применяется для расхода треда | `chat-runtime.tsx:393-411` (`activeUsage`/`subscribeActiveUsage`), `usage-bar.tsx:56-64` (потребитель) |
| `RunningStateSync` как child `AssistantRuntimeProvider` окажется внутри `AuiProvider` | `AssistantProvider.js:17` — `AuiProvider` оборачивает `children` (плюс `RenderComponent`) |
| Другие файлы-импортёры `@assistant-ui/react` — только типы, рантайм-хуков не зовут | `tool-call.tsx:17` (`import type`), `lib/chat-threads.ts:18` (`import type`) |
| Нужные файлы существуют | `ls web/src/components/chat/chat-runtime.tsx web/src/components/chat/thread.tsx` — оба найдены |

## Не проверено (предположения)

1. **Что именно последняя задача изменила в этой области** (в описании — «последняя задача сломала», но `git log` в Plan-фазе не выполнялся). Проверить первым шагом Code: `git log --oneline -3 -- web/src/components/chat/thread.tsx` и/или blame строки 1111. Если хук там давно и раньше работал — значит изменилось окружение (например, `ChatRuntimeProvider` перестал покрывать этот код, либо поднялся `@assistant-ui/*`): воспроизвести падение в браузере и взять **фактический стек** ошибки (DevTools Console → первый кадр проекта) — по нему уточнить точку отказа, не ограничиваясь строкой 1111.
2. **Что падение — только из-за строки 1111, других хуков вне провайдера нет** (grep по `web/src` найден только `thread.tsx`, но динамические/реэкспортные пути не проверялись). Проверка: после правки открыть `#/chat` и проследить консоль; если появится новая ошибка `AuiProvider` с другим кадром — применить тот же приём (перенести чтение в module-state либо перенести компонент под провайдер) к этому кадру.
3. **Гонка первого рендера**: на первом рендере после `ready` `runtimeRunning` ещё `false` (store ещё не заполнен), эффект refetch может поставить interval раньше, чем `RunningStateSync` запишет `true`. Считаем допустимым: cleanup по deps (`runtimeRunning` в deps эффекта, `thread.tsx:1140`) снимает таймер, первый тик — через 5 с, а guard `if (runtimeRunning) return` в теле тика читает актуальное значение после перерендера. Если на практике окажется иначе (перезагрузка истории посреди стрима) — перенести guard наверх в подписку/пересоздание эффекта.
4. **Команды проверки**: `cd web && pnpm typecheck` и точечный `npx eslint` соответствуют скриптам `web/package.json` (`typecheck`, lesson-282); полный `pnpm test` — из корня по AGENTS.md.

## Риски

- **R1**: `RunningStateSync` подписывается на `thread.isRunning` — лишний рендер-цикл на каждый старт/стоп хода; влияние ничтожно (1 component, selector — примитив).
- **R2**: при размонтировании провайдера store сбрасывается в `false` — это и нужно (без рантайма локального стрима нет), но если эффект `ChatPage` как раз в этот момент ждёт `true` — возможен один лишний refetch; он безвреден (guard по `data.messages.length > baseCount`).
- **R3**: регрессия в других местах чата маловероятна — правятся 2 файла, хуки внутри `ChatThread` не трогаются; ловится полным `pnpm test` + ручной проверкой AC2.

## Критерии выполнения (AC/DoD)

- AC1: `#/chat` открывается без `AuiProvider`-ошибки в консоли.
- AC2: рендер чата, отправка сообщения, список тредов — без ошибок в консоли; фоновый refetch VL-431 продолжает работать (guard `runtimeRunning` сохранён).
- AC3/DoD: полный `pnpm build && pnpm test` зелёный; документация не требует правок (поведение не меняется — чинится регрессия), при необходимости — правка уже существующей строки.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-19 19:43
---
Фаза 1 (Spec) выполнена. Заголовок: изменён («Веб-чат падает с ошибкой AuiProvider», ведущий тег #web снят). Тип: bug. Масштаб: task. Приоритет: High (веб-чат сломан, страница падает). Labels: web (тег #web пользователя переведён в label). References: нет. AC: 3 пункта (открытие /#/chat без ошибки AuiProvider в консоли; рендер чата и базовые действия без ошибок; pnpm test проходит без регрессий). Вопросов нет.
---
author: @agent
created: 2026-11-19 19:54
---
Фаза 2 (Plan) выполнена. Тип: bug. План записан в задачу: 2 файла (web/src/components/chat/chat-runtime.tsx, web/src/components/chat/thread.tsx). Диагноз: useAuiState(s => s.thread.isRunning) в теле ChatPage (thread.tsx:1111, эффект фонового refetch VL-431) вызывается ВЫШЕ AssistantRuntimeProvider (ChatRuntimeProvider монтируется только внутри JSX при load.status === "ready", thread.tsx:1235-1251) — без AuiProvider контекст-прокси DefaultAssistantClient бросает ошибку из бага во время рендера (store: react-assistant-context.js:8, useAuiState.js:44-61). Решение: module-state activeRunning/getActiveRunning/subscribeActiveRunning в chat-runtime.tsx (зеркало паттерна activeUsage, строки 393-411) + RunningStateSync внутри AssistantRuntimeProvider (попадает в AuiProvider как child, AssistantProvider.js:17); ChatPage читает через useSyncExternalStore вместо useAuiState. Остальные 7 вызовов useAui/useAuiState — внутри ChatThread (в провайдере), не трогаются. Проверки: точечный npx eslint (lesson-282), cd web && pnpm typecheck, полный pnpm build && pnpm test, ручная проверка консоли на #/chat и работоспособности фонового refetch (guard runtimeRunning сохранён). Предположений 3 (blame строки 1111/фактический стек ошибки — первым шагом Code; единичность падения; гонка первого рендера), риски R1-R3 описаны в плане.
---
author: @agent
created: 2026-11-19 20:07
---
Фаза code прервана остановкой процесса — статус возвращён к Planned.
---
author: @agent
created: 2026-11-19 20:13
---
Фаза 3 (Code) выполнена. Изменено: web/src/components/chat/chat-runtime.tsx, web/src/components/chat/thread.tsx; коммит 1bc4f86 (fix: VL-439 — чат-страница больше не зовёт useAuiState вне AuiProvider).
Диагноз подтверждён (предположение 1 из плана): git log — строка с useAuiState пришла с коммитом VL-431 (7661c6e), т.е. «последняя задача» = VL-431, хук в теле ChatPage вне AssistantRuntimeProvider.
Реализация по плану:
1) chat-runtime.tsx: module-state activeRunning (getActiveRunning/setActiveRunning/subscribeActiveRunning — зеркало activeUsage) + компонент RunningStateSync (useAuiState внутри провайдера, cleanup сбрасывает store), mounted как child AssistantRuntimeProvider → попадает внутрь AuiProvider; импорт useAuiState добавлен.
2) thread.tsx: ChatPage (строка ~1111, эффект фонового refetch VL-431) читает isRunning через React.useSyncExternalStore(subscribeActiveRunning, getActiveRunning, getActiveRunning) вместо useAuiState; комментарий дополнен причиной (VL-439); guard runtimeRunning сохранён; импорт из ./chat-runtime дополнен. 7 вызовов useAui/useAuiState внутри ChatThread не тронуты.
Проверки (все зелёные):
- cd web && npx eslint src/components/chat/thread.tsx src/components/chat/chat-runtime.tsx — чисто;
- cd web && pnpm typecheck (tsc --noEmit) — чисто;
- cd web && pnpm build — чисто;
- Полный прогон из корня: pnpm test — Test Files 242 passed (242) + 1 passed (1 статик-файл), Tests 4672 passed | 4 skipped + 8 passed. Прогон ПОЛНЫЙ, без --exclude сверх штатного состава скрипта, исключений нет;
- Браузерная проверка на 127.0.0.1:6445/#/chat: страница открывается без падения, в консоли НЕТ ошибки AuiProvider (только давний a11y-issue «form field should have id or name», не относится к задаче), рендер чата/ленты/композера/сайдбара работает, отправка тест-сообщения прошла — сообщение появилось в ленте, ошибок в консоли нет. Попутно видно, что фоновый refetch VL-431 работает (периодические GET /api/chat/threads/:id).
AC отмечены все 3, DoD: «Тесты проходят» и «Нет регрессий» — отмечены (полный прогон + браузер). DoD «Документация обновлена» НЕ отмечено: правка — фикс регрессии, поведение продукта не меняется, отдельная документация не требуется (решение за Close). Замечание: в реальный тред чата добавилось тест-сообщение «VL-439 тест» (проверка AC2), удалять не стал — история тредов не входит в задачу.
---
author: @agent
created: 2026-11-19 20:39
---
Итерация после фидбэка владельца («постоянная перезагрузка Загрузка треда»): найден и исправлен второй дефект — после фикса AuiProvider заработал эффект фонового refetch VL-431 и вылез его баг сравнения.
Корень: historyToMessages сливает tool-строки jsonl в assistant-части → клиентская load.messages.length (170) ВСЕГДА меньше серверной data.messages.length (306: 36 user + 134 assistant + 136 tool — проверено фактами на живом треде). Guard «data.messages.length > baseCount» истинен каждый тик → setRetry каждые 5 с → бесконечная «Загрузка треда…».
Исправление (коммит 53a5fa4; первый коммит итерации 1bc4f86 — фикс AuiProvider):
- thread.tsx: ChatLoadState.serverCount (серверская длина при загрузке, 0 для нового треда); эффект refetch сравнивает с ней, deps по serverCount; refreshRunState догоняет serverCount после локального хода — лента не мелькает;
- src/web/chat-late-interbot.test.mjs: ожидание deps по serverCount + анти-паттерн «не клиентская длина».
Проверки (полные, исключений нет): cd web — npx eslint (2 файла), pnpm typecheck, pnpm build — чисто; полный pnpm test — 242+1 files / 4672+8 tests passed (один флак src/core/report.test.mjs по глобальному process.exitCode в промежуточном прогоне — в изолированном и финальном прогоне прошёл, к diff не относится); браузер #/chat: 25 с наблюдения — «Загрузка треда»: 0 (был цикл каждые 5 с), refetch опрашивает раз в 5 с без setRetry, консоль без ошибок.
Отметки AC/DoD не менялись: все 3 AC и DoD 1/3 уже отмечены предыдущим finish_phase; «Документация обновлена» не отмечено — правки = фикс регрессий, отдельная документация не требуется. За Close: долгая ручная проверка сценария «поздний interbot-ответ в открытую вкладку».
---
author: @agent
created: 2026-11-20 05:05
---
Фаза Close выполнена. Статус: Done. Коммиты: feat 1bc4f86 + 53a5fa4 (код закоммичен ещё в Code — остатков по git status не было), docs d40f2d8 (CHANGELOG: запись «Исправлено» VL-439), docs(task) 1c6cf69 (lesson-304). Не закоммичено: нет (refs отсутствуют, подзадач нет). Проверки: сборка (tsc в составе pnpm test) — чисто; полный прогон после коммитов: первый pnpm test упал, хвост вывода потерян обрезкой инструмента → повтор тестовой части с логом на диск: падение 1 — src/core/report.test.mjs «пишет report.md в каталог рана» (глобальный process.exitCode). Классификация: изолированно файл 27/27 зелёный, параллельных vitest/qwen в других worktree нет, diff не затрагивает src/core — пре-существующий флак межфайровой утечки process.exitCode при isolate:false (тот же наблюдался в Code-фазе). Один разрешённый повтор — зелёный: 242+1 test files / 4672+8 tests passed, 4 skipped (плюс static.test.mjs 8/8). DoD: отмечены 1 «Тесты проходят» и 3 «Нет регрессий»; 2 «Документация обновлена» — dodOverride. Урок: lesson-304 создан и связан (guard фонового refetch — по серверской длине истории serverCount, не по клиентской messages).
DoD override: Пункт 2 закрывается честно без отметки: правки задачи = фикс регрессий веб-чата, поведение/форматы/CLI/промпты не менялись — документы backlog/docs не требовали изменений (по правилу Close: «ничего пользовательского не менялось — пропустить»). CHANGELOG дополнен записью в Unreleased (коммит d40f2d8); при желании владельца пункт может быть переоткрыт и отмечен отдельно.
---
<!-- COMMENTS:END -->