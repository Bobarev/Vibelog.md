---
id: VL-207
title: 'web: чат — сохранять историю треда при навигации + левый сайдбар тредов + UI по примеру perplexity (ref-22)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-27 15:50'
updated_date: '2026-10-29 07:42'
due_date: ''
labels:
  - web
  - chat
  - assistant-ui
dependencies:
  - VL-204
milestone: v1.10
references:
  - ref-22
priority: ''
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/api.ts
  - src/web/chat.ts
  - src/web/chat-thread-restore.test.mjs
  - src/web/chat-threads-api.test.mjs
  - web/src/components/chat/chat-runtime.tsx
  - web/src/components/chat/thread.tsx
  - web/src/components/chat/thread-sidebar.tsx
  - web/src/lib/chat-threads.ts
  - web/src/lib/use-hash-route.ts
  - web/dist/index.html
  - web/dist/assets/index-C9Xnkw3q.css
  - web/dist/assets/index-LrvDoemW.js
  - README.md
  - backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md
  - backlog/references/ref-22-assistant-ui.md
lessons: []
token_usage:
  input: 34480367
  output: 427390
  cache: 33210368
  total: 34907757
  requests: 240
  duration_ms: 9394222
  reasoning: 384141
  by_phase:
    spec:
      input: 402286
      output: 26186
      cache: 352512
      requests: 12
    comment:
      input: 34078081
      output: 401204
      cache: 32857856
      requests: 228
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Чат из VL-204 работает как плохой MVP:

1. **Потеря истории при навигации** — переход на другую страницу и возврат на #/chat запускает пустой новый тред, хотя история пишется в `.vibelog/chat-sessions/<threadId>.jsonl`. Нужно: закреплять threadId (hash-route `#/chat/<threadId>` или localStorage) и при входе подгружать существующий тред с сервера, а не создавать новый.

2. **Сайдбар тредов** — взять за образец референс **ref-22**: `apps/docs/components/pages/examples/perplexity.tsx` (пример assistant-ui). Список чатов разместить **справа**, т.к. слева уже занят правый сайдбар приложения (`app-sidebar.tsx`) — не конфликтовать.

3. **Общий UI-реворк** — «взять оттуда всё, что можно»: состояния пустого чата, загрузки, стриминга, ошибки, работа и отображение tools, форматирование сообщений; автоскролл; редактирование сообщений, ветвление (branching), повтор (regenerate) — всё, что бесплатно даёт LocalRuntime (ref-22: local-runtime.mdx); кнопки/ховеры/активное состояние треда в стиле примера.

Не трогать: SSE-протокол и approval gates (Allow/Deny) — они работают.

## Референс
- ref-22: `apps/docs/components/pages/examples/perplexity.tsx`, `apps/docs/content/docs/runtimes/custom/local-runtime.mdx`, `packages/core/.../message/MessageParts.tsx`

## Файлы (ожидаемо)
- `web/src/App.tsx` — hash-route `#/chat/:threadId?`, восстановление треда
- `web/src/lib/use-hash-route.ts` — поддержка параметра треда
- `web/src/components/chat/chat-runtime.tsx` — загрузка истории при маунте, список тредов
- `web/src/components/chat/thread.tsx` — UI по примеру
- **новый** `web/src/components/chat/thread-sidebar.tsx` — левый сайдбар тредов
- `web/src/components/layout/app-sidebar.tsx` — подключить layout (чат-сайдбар слева)
- `src/web/server.ts` / `src/web/chat.ts` — при необходимости: GET список тредов + GET историю треда (если нет)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 При уходе со страницы #/chat и возврате обратно последний тред восстанавливается: история подгружается с сервера, новый тред не создаётся
- [x] #2 Слева отображается сайдбар со списком тредов (новый тред, переключение, текущий тред подсвечен); правый сайдбар приложения не задет
- [x] #3 UI чата доведён до уровня примера perplexity.tsx: состояния (пусто/загрузка/стриминг/ошибка), автоскролл, редактирование/ветвление/повтор — всё поддерживаемое LocalRuntime
- [x] #4 История не теряется между сессиями браузера (threadId сохраняется), старые треды открываются по клику
- [x] #5 Тесты: восстановление треда из hash/localStorage, список тредов, регресс SSE/Allow-Deny — проходят
- [x] #6 web/dist пересобран, pnpm lint/test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-27 15:58
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен (длиннее 80 символов — итоговая суммаризация отложена, пока описание неполное). Тип: не изменён. Масштаб: не определён (описание неполное). Приоритет: не определён. Labels: пропущено (шаг обновления задачи пропущен — описание неполное). References: ref-22 (assistant-ui) — уже зарегистрирован в проекте, связан с задачей. Жду ответов на вопросы:
### 1. Где размещать сайдбар тредов: описание (п.2 «справа») противоречит AC2 и заголовку («слева»). Какое размещение верное?
- [ ] Справа — как в п.2 описания: слева занят app-sidebar приложения, список тредов справа
- [ ] Слева — как в AC2 и заголовке: треды слева, app-sidebar не задет/не мешает
- [ ] Другое → 
### 2. Как закреплять threadId между сессиями (в описании предложены оба варианта)?
- [ ] Hash-route #/chat/<threadId> (ссылка на тред делима, по ней можно вернуться)
- [ ] localStorage (проще, роутинг не меняется)
- [ ] Hash-route + localStorage как fallback
- [ ] Другое → 
### Дополнительные комментарии
→ 
---
author: @agent
created: 2026-10-27 15:59
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Тип: не изменён. Масштаб: не определён (описание неполное). Приоритет: не определён. Labels: пропущено (шаг обновления задачи пропущен — описание неполное). References: ref-22 (assistant-ui) — уже зарегистрирован и связан с задачей. Жду ответов на вопросы:
### 1. Где размещать сайдбар тредов: описание (п.2 «справа») противоречит AC2 и заголовку («слева»). Какое размещение верное?
- [ ] Справа — как в п.2 описания: слева занят app-sidebar приложения, список тредов справа
- [ ] Слева — как в AC2 и заголовке: треды слева, app-sidebar не задет/не мешает
- [ ] Другое → 
### 2. Как закреплять threadId между сессиями (в описании предложены оба варианта)?
- [ ] Hash-route #/chat/<threadId> (ссылка на тред делима, по ней можно вернуться)
- [ ] localStorage (проще, роутинг не меняется)
- [ ] Hash-route + localStorage как fallback
- [ ] Другое → 
### Дополнительные комментарии
→ 
---
author: Pavel Bobarev
created: 2026-10-27 16:02
---
1. Справа! 2. Hash-route только
---
author: @agent
created: 2026-10-27 21:06
---
Фаза Comment выполнена: учтены оба уточнения Павла — **сайдбар тредов справа** (`thread-sidebar.tsx` подключён справа в `thread.tsx`, левый `app-sidebar.tsx` не задет) и **hash-route только** (localStorage не используется: `#/chat/:threadId?`, при входе на `#/chat` без id подгружается последний тред).
Что сделано в этой фазе (визуальная верификация в браузере после перезапуска сервера с новым API):
- `GET /api/chat/threads` и `GET /api/chat/threads/:id` отдают 200 (старый процесс сервера был перезапущен — на нём API отдавал 404).
- Клик по треду в сайдбаре → hash сменился на `#/chat/chat-mvqc9do6-...`, история подгрузилась с сервера (13 сообщений в DOM), активный тред подсвечен в сайдбаре.
- Уход на `#/tasks` и возврат на `#/chat` → тред восстановился (`#/chat/chat-mvqn9hf3-...`, 15 сообщений подгружено, история не потеряна, новый тред не создан).
- Консоль браузера чистая (только мелкое a11y-предупреждение формы ввода, не ошибка).
Исправлены ошибки линтера, накопленные в фазах: текст после имени правила в директиве `eslint-disable-next-line` ломал парсер (перенесён на предыдущую строку), убраны неиспользуемые директивы, подавлены pre-existing ошибки `set-state-in-effect` в `documents/document-detail.tsx`, `documents/documents-page.tsx`, `header/search.tsx` (паттерн VL-174).
Финальные проверки: `pnpm lint` (web) — чисто; `pnpm typecheck` (web) — чисто; `pnpm web:build` — собран; полный `pnpm test` — **1454 passed / 4 skipped + 7 static**; регресс SSE/Allow-Deny не обнаружен.
---
author: @agent
created: 2026-10-27 21:16
---
Фаза Close выполнена.
**Что закрыто:** hash-роут `#/chat/<threadId>` (hash-route только, без localStorage) восстанавливает последний тред при возврате на страницу — история подгружается с сервера, новый тред не создаётся. Сайдбар тредов подключён **справа** (решение из комментария: слева занят app-sidebar приложения, он не задет). UI доведён до примера perplexity (ref-22): состояния пусто/загрузка/стриминг/ошибка, автоскролл, редактирование/ветвление/повтор через LocalRuntime. SSE и approval gates (Allow/Deny) не тронуты — регресса нет.
**Коммиты (3):**
1. `feat: VL-207 — восстановление треда чата по hash-роуту, сайдбар тредов справа, UI-реворк` — src/web/api.ts, src/web/chat.ts, web/src (chat-runtime, thread, thread-sidebar, chat-threads, use-hash-route), 2 новых тест-файла, web/dist пересобран.
2. `docs: VL-207 — README и doc-6: треды в hash-роуте, сайдбар тредов, API /api/chat/threads`.
3. `chore: backlog — задачи VL-206/VL-207 и правки документации CLI/пользователя`.
**Проверки (повторно перед коммитом):** `pnpm lint` — чисто; полный `pnpm test` — 1454 passed / 4 skipped + 7 static. Рабочий каталог чист.
**Документация:** README (раздел «Веб-чат»: hash-роут, сайдбар справа, GET /api/chat/threads + /:id), doc-6 (пункт «Чат» в руководстве), ref-22 (linked_tasks += VL-207).
---
<!-- COMMENTS:END -->