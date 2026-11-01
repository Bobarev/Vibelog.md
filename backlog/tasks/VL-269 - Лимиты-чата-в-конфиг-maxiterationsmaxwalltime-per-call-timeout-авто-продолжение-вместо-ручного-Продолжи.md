---
id: VL-269
title: 'Лимиты чата в конфиг: max_iterations/max_wall_time, per-call timeout, авто-продолжение вместо ручного «Продолжи»'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 21:36'
updated_date: '2026-11-01 13:00'
due_date: ''
labels:
  - web
  - chat
  - settings
  - llm
dependencies: []
milestone: ''
references: []
priority: high
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/chat-limits.ts
  - src/web/chat-limits.test.mjs
  - src/web/chat.ts
  - src/web/chat.test.mjs
  - src/web/api.ts
  - src/web/settings-api.test.mjs
  - src/bot/settings.ts
  - web/src/components/chat/chat-runtime.tsx
  - web/src/components/chat/thread.tsx
  - web/src/components/settings/api.ts
  - web/src/components/settings/settings.tsx
  - web/dist/index.html
  - web/dist/assets/index-Bid1q-N-.js
  - README.md
lessons:
  - lesson-126
token_usage:
  input: 21577123
  output: 98746
  cache: 21041152
  total: 21675869
  requests: 221
  duration_ms: 1768494
  reasoning: 48637
  by_phase:
    plan:
      input: 4468935
      output: 29742
      cache: 4319232
      requests: 47
    code:
      input: 14391039
      output: 59042
      cache: 14099456
      requests: 120
    close:
      input: 2717149
      output: 9962
      cache: 2622464
      requests: 54
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Зачем

Из диалога: при изучении референса чат дважды умирал с сообщениями «Превышено время ответа (120 с) — диалог остановлен» и «Превышен лимит итераций инструментов (8) — диалог остановлен», и пользователю пришлось больше десятка раз писать «Продолжи». Причина — лимиты жёстко зашиты в коде и слишком малы для реальной работы с инструментами.

Сейчас:

```ts
// src/web/chat.ts:66
const MAX_LLM_ITERATIONS = 8;
const MAX_WALL_TIME_MS = 120_000;
```

Изучение одного файла — это 1 итерация на «подумать» плюс по итерации на каждый батч чтения; 8 кончаются мгновенно. При этом в `.vibelog/settings.json` у проекта уже лежит `max_wall_time: 2400`, но чат его **не читает** — читает только агент фаз.

## Что делать

### 1. Лимиты в конфиг

Секция `chat` в `.vibelog/settings.json`:

```json
{
  "chat": {
    "max_iterations": 20,
    "max_wall_time": 600,
    "max_auto_continue": 3,
    "call_timeout": 90
  }
}
```

- дефолты при отсутствии секции — текущие 8 / 120 с (поведение без настроек не меняется);
- читать на каждый запрос, не кэшировать на старте процесса;
- невалидные значения — откат к дефолту с предупреждением, а не падение.

Эта задача даёт **общий механизм**. Конкретные значения для роли `supervisor` (`supervisor.limits`) задаёт **VL-270** — см. doc-19 §7.

### 2. Отделить per-call таймаут от бюджета хода

Сейчас 120 с режут **весь** ход, включая пять быстрых tool-вызовов. Нужно:

- `call_timeout` (дефолт 90 с) — на один вызов модели;
- `max_wall_time` — общий бюджет хода;
- медленный, но живой стрим не должен убиваться per-call таймаутом раньше времени.

### 3. `truncated` вместо `error`

При исчерпании лимита сервер сейчас делает `return` с error-событием. История в jsonl при этом цела — именно поэтому ручное «Продолжи» и работало.

Заменить на событие:

```
{ type: "truncated", reason: "iterations" | "wall_time", saved: true }
```

Клиент на него **сам** повторяет ход: `POST /api/chat` с `continue: true` — без нового user-сообщения и без пустой строки в истории. Ограничение — `max_auto_continue` подряд (дефолт 3), чтобы не уйти в бесконечный цикл; после исчерпания в треде показывается кнопка «Продолжить».

Это снимает главное раздражение: «Продолжи» перестаёт быть рабочим ритмом и остаётся аварийным выходом.

## Установлено по коду

- Лимиты: `src/web/chat.ts:66` — `MAX_LLM_ITERATIONS`, `MAX_WALL_TIME_MS`; проверки в цикле на строках 484–500.
- SSE-события: `ChatEvent` в `src/web/chat.ts:40`; маппинг в `web/src/components/chat/chat-runtime.tsx` (`applyEvent`).
- Настройки: `src/web/api.ts` — `GET/PUT /api/settings`; `web/src/components/settings/api.ts` — `SettingsData`, `SettingsPatch`; страница `#/settings`.
- Агентские лимиты для сравнения: `src/agent/loop.ts:213` (`MAX_WALL_TIME_MS_DEFAULT = 900_000`), `LoopLimits.maxWallTimeMs` / `maxRequests`.

## Вне скоупа

- Конкретные значения лимитов для ролей — **VL-270**.
- Изменение лимитов фаз агента.
- idle-watchdog для фаз — **VL-270** (doc-19 §8).
- Компакция истории и payload-лимиты (VL-230 сделана).

## Связи

- **doc-19 §6, §7** — контекст, почему лимиты должны быть в конфиге.
- **VL-270** — вторая половина супервизора, использует этот механизм для `supervisor.limits`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Лимиты чата вынесены из констант src/web/chat.ts:66 (MAX_LLM_ITERATIONS = 8, MAX_WALL_TIME_MS = 120_000) в конфиг: секция chat в .vibelog/settings.json, поля max_iterations и max_wall_time; дефолты при отсутствии секции — прежние значения (8 и 120), поведение без настроек не меняется
- [x] #2 Лимиты читаются на каждый запрос (не кэшируются на старте процесса), изменение конфига применяется к следующему ходу без перезапуска веб-сервера
- [x] #3 Значения валидируются: невалидное (0, отрицательное, не число, строка) не роняет чат, а откатывается к дефолту с предупреждением в ответе или логе
- [x] #4 GET /api/settings отдаёт секцию chat для веб-интерфейса, PUT /api/settings принимает её с валидацией (зеркало существующей валидации max_wall_time/max_requests), секреты и env по-прежнему не отдаются
- [x] #5 На странице #/settings появились поля chat.max_iterations и chat.max_wall_time с подсказками (пусто или 0 — сброс к дефолту), сохранение и сброс работают
- [x] #6 При исчерпании лимита итераций вместо обрыва хода с error-событием сервер отдаёт событие truncated с полем reason ('iterations') и признаком, что история сохранена — текст ошибки «Превышен лимит итераций инструментов (8) — диалог остановлен» больше не единственный путь
- [x] #7 При исчерпании лимита времени вместо error-события также отдаётся truncated с reason='wall_time'; история и уже выполненные tool-вызовы к этому моменту сохранены в jsonl (проверяется тестом)
- [x] #8 Клиент (web/src/components/chat/chat-runtime.tsx) на событие truncated автоматически продолжает ход: повторный POST с continue=true (без нового user-сообщения и без пустой строки в истории), счётчик авто-продолжений инкрементится
- [x] #9 Авто-продолжение ограничено N (дефолт 3) подряд; после исчерпания в треде показывается явная кнопка «Продолжить» вместо автоматического цикла, дальше каждое нажатие — один ход
- [x] #10 В треде виден статус шага при авто-продолжении: строка вида «Продолжаю — шаг N, лимит итераций исчерпан», чтобы пользователь понимал, почему ход не завершился сразу
- [x] #11 Кнопка остановки (ComposerPrimitive.Cancel) прерывает авто-продолжение и не запускает новый ход
- [x] #12 Таймаут на один вызов модели отделён от общего бюджета хода: per-call timeout (дефолт 90 с, настраиваемый) не убивает весь ход при медленном, но живом стриме
- [x] #13 Тесты: чтение и валидация лимитов (дефолты, override, мусор), truncated-событие при исчерпании итераций и времени, сохранение истории к моменту truncated, continue-ход без user-сообщения, автопродолжение до лимита и остановка после, per-call timeout
- [x] #14 Документация: README (раздел веб-чата — лимиты хода и авто-продолжение), doc-8 при необходимости; web/npm run build и lint проходят
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации VL-269

Тип: feature. Общий механизм лимитов чата; конкретные значения для `supervisor.limits` — VL-270.

### 0. Решения

1. **Новый чистый модуль `src/web/chat-limits.ts`** (паттерн `tool-dedup.ts`: чистые функции + терпимое чтение конфига, lesson-117). В нём:
   - `CHAT_LIMITS_DEFAULT = { maxIterations: 8, maxWallTimeMs: 120_000, maxAutoContinue: 3, callTimeoutMs: 90_000 }` — 8/120 сохраняют текущее поведение без настроек (AC1).
   - `resolveChatLimits(cwd)` → `{ limits, errors: string[] }`: читает `loadSettings(cwd).chat` (секция может отсутствовать/быть мусором), берёт только `max_iterations`, `max_wall_time` (сек), `max_auto_continue`, `call_timeout` (сек). Валидация: целое ≥ 1 и ≤ потолка (`CHAT_LIMITS_CEILING = { maxIterations: 200, maxWallTime: 86_400, maxAutoContinue: 20, callTimeout: 3_600 }`); всё прочее (0, отрицательное, дробное, строка, null, отсутствие) → дефолт + запись в `errors` (`chat.max_iterations: ожидается целое 1..200, получено ...`). Вызывается **на каждый POST** внутри `produce()` — не на старте процесса (AC2).
   - `formatChatLimitsErrors(errors)` → одна строка предупреждения для ответа сервера/лога (AC3).
   - `createCallGuard(callTimeoutMs, now?)` — per-call таймаут (AC12): возвращает `{ signal, noteActivity(), dispose(), timedOut() }`. Внутри `AbortController`; таймер взводится при создании и **перевзводится на каждый `noteActivity()`** (вызов из `onToken`), поэтому медленный, но живой стрим не убивается; `timedOut()` отличает таймаут от отмены пользователем. Чистая (инъекция `now`/таймеров) — тестируется без реальных задержек.

2. **`truncated` вместо `error`** при исчерпании лимита (AC6/AC7): новое событие `{ type: 'truncated', reason: 'iterations' | 'wall_time', step: number, limits: {...}, saved: true }`. История jsonl к этому моменту уже содержит все assistant/tool-сообщения (append после каждого) — `closeUnconfirmedTail` по-прежнему закрывает висящие write-вызовы ДО события, поэтому payload остаётся валидным.

3. **`continue: true`** в `ChatRequestBody` (AC8): новый ход без user-сообщения — пропускаем блок «новое сообщение» (не пишем `{role:'user'}` в jsonl), цикл стартует по существующей истории; пустая история/нет сообщений → прежнее `error`-событие.

### 1. Файлы и конкретные правки

| # | Файл | Что меняем |
|---|------|-----------|
| 1 | **NEW `src/web/chat-limits.ts`** | Модуль выше: дефолты, потолки, `resolveChatLimits`, `formatChatLimitsErrors`, `createCallGuard`. Шапка-комментарий с обоснованием (инцидент «Превышено время ответа (120 с)» / «лимит итераций (8)»). |
| 2 | `src/web/chat.ts:59-66` | `ChatEvent` += `truncated`; `ChatRequestBody` += `continue?: unknown`. |
| 3 | `src/web/chat.ts:93-95` | Удалить `MAX_LLM_ITERATIONS` / `MAX_WALL_TIME_MS`, оставить комментарий-ссылку на `chat-limits.ts` (AC1). |
| 4 | `src/web/chat.ts:531-545` (`runChat`) | Валидация входа: `hasContinue = body.continue === true`; условие ошибки «Пустой запрос…» → `if (!hasMessage && !hasApproval && !hasContinue)`. |
| 5 | `src/web/chat.ts:571+` (`produce`, начало) | `const { limits, errors } = resolveChatLimits(cwd)`; при `errors.length` — `console.error('[vibelog-chat] ' + formatChatLimitsErrors(errors))` (не роняет ход, AC3). |
| 6 | `src/web/chat.ts:723-725` | `const started = Date.now()` → бюджет хода; рядом `const callTimeoutMs = limits.callTimeoutMs`. |
| 7 | `src/web/chat.ts:786-795` (ветка нового сообщения) | `} else if (hasContinueTurn) { /* ничего в историю не пишем */ } else { ...текущая ветка... }`, где `hasContinueTurn = body.continue === true && history.length > 0`; иначе (continue без истории) — `queue.push({type:'error', message:'Нечего продолжать: история треда пуста'})` + `return`. |
| 8 | `src/web/chat.ts:798-820` (проверки лимитов) | `iterations > limits.maxIterations` → `closeUnconfirmedTail` + `finishStats` + `queue.push({type:'truncated', reason:'iterations', step: limits.maxIterations, limits, saved:true})` + `return` (AC6); `Date.now() - started > limits.maxWallTimeMs` → то же с `reason:'wall_time'` (AC7). Тексты прежних error-сообщений больше не отправляются. |
| 9 | `src/web/chat.ts:826-840` (вызов `llm.streamChat`) | Обернуть: `const guard = createCallGuard(limits.callTimeoutMs)`; `onToken: t => { guard.noteActivity(); queue.push({type:'text', delta:t}) }`; `streamChat(..., { onToken, signal: guard.signal })`; после `await`/в `finally` — `guard.dispose()`. При исключении: если `guard.timedOut()` → `queue.push({type:'truncated', reason:'wall_time', step: iterations, limits, saved:true})` (мягкая деградация: ход продолжится на клиенте/кнопкой), иначе прежний `error` (AC12). |
| 10 | `src/BOT/settings.ts` (`src/bot/settings.ts:23-55, 93-140, 143-170`) | `BotSettings` += `chat?: ChatSectionSettings` (`{ max_iterations?, max_wall_time?, max_auto_continue?, call_timeout? }`); `loadBotSettings` пробрасывает провалидированную секцию (`readPositiveInt` для каждого ключа, мусор → ключ отсутствует); `saveBotSettings` пишет `chat: settings.chat` в патч (undefined → ключ удаляется, как у `max_wall_time`). |
| 11 | `src/web/api.ts:702-742` (`validateSettingsPatch`) | `case 'chat'`: значение — объект; допускаются только 4 ключа (≤ потолков из `chat-limits.ts`); число → `Number.isInteger && > 0`, `0`/`null` → удаление ключа из секции; неизвестный ключ/тип → `{error: 'chat.<key>: ожидается целое ...'}` → 400 (AC4). Патч собирается как `patch.chat = {...}` (полная замена секции, как остальные поля формы). |
| 12 | `web/src/components/settings/api.ts:10-34` | `SettingsData.chat?: ChatSettings`; `SettingsPatch.chat?: {max_iterations?: number|null; max_wall_time?: number|null; max_auto_continue?: number|null; call_timeout?: number|null}`. |
| 13 | `web/src/components/settings/settings.tsx` (Card «Агент и лимиты фаз», после блока max-wall-time/max-requests) | Новая Card **«Лимиты веб-чата»**: 4 `Input type=number min=0` с подсказками («пусто или 0 — сброс к дефолту: 8 итераций / 120 с / 3 авто-продолжения / 90 с»), `FormState` += 4 текстовых поля, `toFormState`/`handleSave` через `parseLimit` (AC5). |
| 14 | `web/src/components/chat/chat-runtime.tsx:52-70` | `ChatEvent` += `{ type:'truncated'; reason:'iterations'\|'wall_time'; step: number; saved: boolean }`; новый экспорт `CHAT_TRUNCATED_PART = 'chat-truncated'`. |
| 15 | `web/src/components/chat/chat-runtime.tsx:216-320` (`applyEvent`) | `case 'truncated'`: пушим data-часть `chat-truncated` с `{reason, step}` и **ставим флаг** (возвращаем `false`, чтобы не рвать стрим; флаг читает adapter). |
| 16 | `web/src/components/chat/chat-runtime.tsx:330-365` (тело `run`) | Обёрнуть один POST в цикл: `let autoContinues = 0`, `for(;;)`: тело запроса (`continue: autoContinues > 0 ? true : undefined`, без `message`), чтение потока, после завершения — если был `truncated` и `autoContinues < MAX_AUTO_CONTINUE (3)` и `!options.abortSignal.aborted` → `autoContinues++`, пушим text-часть статуса `Продолжаю — шаг N, лимит итераций исчерпан` (второй вариант причины — «…лимит времени»), `yield [ ...parts]` и повторяем POST (AC8/AC10). При исчерпании `max_auto_continue` — выходим: data-часть `chat-truncated` остаётся, `thread.tsx` покажет кнопку «Продолжить» (AC9). Каждый `yield` — полный накопленный `content` (правило VL-204). |
| 17 | `web/src/components/chat/chat-runtime.tsx` (`run`) | После каждой итерации цикла проверять `options.abortSignal.aborted` **до** нового POST — Cancel обрывает авто-продолжение и не запускает ход (AC11). |
| 18 | `web/src/components/chat/thread.tsx:120-150` (`PartView`) | `part.type === 'data' && part.name === CHAT_TRUNCATED_PART` → строка-статус/плашка с кнопкой: причина (`лимит итераций`/`лимит времени`, шаг) + `ActionBarPrimitive.Reload` «Продолжить» (переиспользовать `StoppedRun` из `stopped-run.tsx`, `retry` — Reload) — AC9/AC10. |
| 19 | **NEW `src/web/chat-limits.test.mjs`** | Дефолты без секции; override каждого ключа; мусор (0, -1, '8', 2.5, null, битый settings.json) → дефолт + ошибка в `errors`; потолки; `createCallGuard` — таймаут при отсутствии активности, сброс при `noteActivity()`, `timedOut()`. |
| 20 | `src/web/chat.test.mjs` | +тесты: `truncated` при `max_iterations` (конфиг `{chat:{max_iterations:2}}`, скрипт LLM из 3 tool-ответов) с `reason:'iterations'`, `saved:true` и целой историей jsonl; `truncated` при `max_wall_time` (конфиг 1 с + LLM-заглушка со `sleep`); `continue:true` — история растёт без нового user-сообщения (число `role:'user'` не меняется), ход завершается `done`; изменённый конфиг применяется к следующему POST без пересоздания сервера (AC2); мусорный конфиг → ход работает на дефолтах. |
| 21 | `src/web/settings-api.test.mjs` | +тесты: GET отдаёт `chat` (после записи секции) и не отдаёт `env`; PUT принимает `chat`, пишет в settings.json, сохраняет `env`/`chats`; `chat.max_iterations: 0` → ключ удалён (сброс); `chat: {мусор}` / неизвестный ключ секции → 400 и файл не меняется. |
| 22 | `README.md` (раздел «Веб-чат (#/chat)», после §«Повторы и лимит tool-вызовов») | Подраздел «Лимиты хода и авто-продолжение»: таблица ключей `chat.*` (дефолты, диапазоны), объяснение per-call timeout vs бюджет хода, событие `truncated` и авто-продолжение до 3 раз, кнопка «Продолжить» (AC14). |

Дополнительно (если при правке `validateSettingsPatch` выяснится, что `saveBotSettings` теряет `chat` при сбросе прочих полей) — синхронно поправить патч в `src/bot/settings.ts`, чтобы `chat` писался всегда, как `code_same_session`.

### 2. Порядок действий

1. `src/web/chat-limits.ts` + `src/web/chat-limits.test.mjs` (чистый модуль, без зависимостей от чата) → `pnpm build && pnpm test:fast`.
2. `src/web/chat.ts`: события, `continue`, лимиты из конфига, `truncated`, per-call guard.
3. `src/bot/settings.ts` + `src/web/api.ts` (секция `chat` в GET/PUT) → тесты `settings-api.test.mjs`.
4. `web/src/components/settings/*` (поля формы).
5. `web/src/components/chat/chat-runtime.tsx` (цикл авто-продолжения) + `thread.tsx` (плашка и кнопка).
6. Тесты `chat.test.mjs`, `settings-api.test.mjs`; README.
7. `pnpm build && pnpm test` (полный прогон), `pnpm web:typecheck && pnpm web:lint && pnpm web:build` (web/dist пересобрать и закоммитить — lesson-6: `pnpm install` внутри `web/` в worktree).

### 3. Как проверить

```bash
pnpm build
pnpm test:fast -- run src/web/chat-limits.test.mjs src/web/chat.test.mjs src/web/settings-api.test.mjs
pnpm test                      # полный прогон — обязателен для DoD
cd web && pnpm install && pnpm typecheck && pnpm lint && pnpm build
grep -n "MAX_LLM_ITERATIONS\|MAX_WALL_TIME_MS" src/web/chat.ts   # пусто (AC1)
```

Ручная проверка (по желанию, короткими шагами — lesson-27): `vibelog browser`, в `.vibelog/settings.json` поставить `{"chat":{"max_iterations":1}}`, отправить сообщение, требующее двух tool-вызовов → в треде строка «Продолжаю — шаг 2…», затем ответ; при `max_auto_continue:0` — плашка с кнопкой «Продолжить».

### 4. Риски

- **Двойной POST при авто-продолжении**: assistant-ui держит run открытым, пока жив генератор; повторный `fetch` внутри того же `run` — не новый run, поэтому `sentApprovals`/ветки не ломаются. Риск: незакрытый approval в потоке перед `truncated` — сервер уже закрывает хвост `closeUnconfirmedTail`, а клиент при `pausedOnApproval` из цикла выходит (авто-продолжение не запускается).
- **`continue:true` без user-сообщения** может уйти в бесконечный цикл, если модель каждый раз упирается в лимит: ограничение `max_auto_continue` на клиенте + счётчик не персистится между перезагрузками (осознанно; кнопка «Продолжить» остаётся).
- **Совместимость конфига**: секция `chat` пишется в тот же `.vibelog/settings.json`; при полной замене секции из формы теряются неизвестные пользовательские ключи внутри `chat` — риск принят (как у остальных полей), фиксируется в README.
- **Per-call таймаут и стриминг**: если провайдер долго молчит перед первым токеном (> `call_timeout`), ход получит `truncated/wall_time` вместо ошибки — поведение мягче прежнего; значения по умолчанию (90 с) это перекрывают.
- **web/dist**: пересборка обязательна, иначе веб отдаст старый бандл без авто-продолжения (lesson-28).
- Тесты времени — только через инъекцию `now`/фейковые таймеры (`createCallGuard` чистый), иначе флаки.
<!-- SECTION:PLAN:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
## Связи и границы

- **doc-19 §6, §7** — контекст, почему лимиты должны быть в конфиге.
- **VL-270** — вторая половина супервизора (тик, healing, планировщик, промпт роли); использует этот механизм для `supervisor.limits.chat_max_iterations` и `chat_max_wall_time`.

## Вне скоупа

- Конкретные значения лимитов для ролей — **VL-270**.
- Изменение лимитов фаз агента.
- idle-watchdog для фаз — **VL-270** (doc-19 §8).
- Компакция истории и payload-лимиты (VL-230 сделана).
<!-- SECTION:NOTES:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-31 00:13
---
Фаза 2 (Plan) выполнена. Тип: feature.
**План записан** в Implementation Plan задачи: 22 позиции по 15 файлам (1 новый модуль backend, 1 новый тест-файл, 2 правки тестов, 2 правки web-UI).
**Архитектурные решения:**
1. Новый чистый модуль `src/web/chat-limits.ts` (по образцу `tool-dedup.ts`): `CHAT_LIMITS_DEFAULT = {maxIterations:8, maxWallTimeMs:120_000, maxAutoContinue:3, callTimeoutMs:90_000}`, `CHAT_LIMITS_CEILING`, `resolveChatLimits(cwd)` → `{limits, errors}` (терпимое чтение секции `chat` по lesson-117: мусор → дефолт + сообщение, не падение), `formatChatLimitsErrors`, `createCallGuard(callTimeoutMs)` — per-call `AbortController` с перевзводом таймера на `noteActivity()` (медленный живой стрим не убивается) и `timedOut()` для отличия таймаута от Cancel. Резолв — на каждый POST внутри `produce()`, не на старте процесса.
2. Лимиты `src/web/chat.ts:93-95` (MAX_LLM_ITERATIONS/MAX_WALL_TIME_MS) удаляются; конфиг читается в начале `produce()`.
3. Новое событие `{type:'truncated', reason:'iterations'|'wall_time', step, limits, saved:true}` заменяет error-путь в проверках цикла (`:798-820`); `closeUnconfirmedTail` остаётся перед событием — payload/парность tool_calls↔tool сохраняется, история jsonl уже дописана.
4. `continue: true` в `ChatRequestBody` — ход без user-сообщения (блок «новое сообщение» пропускается), пустая история → error.
5. Секция `chat` в `BotSettings` (load/save в `src/bot/settings.ts`) + валидация в `validateSettingsPatch` (`src/web/api.ts:702-742`, зеркало max_wall_time: 0/null → сброс, мусор → 400, файл не меняется) + 4 поля на странице `#/settings`.
6. Клиент (`chat-runtime.tsx`): `CHAT_TRUNCATED_PART`, флаг truncated в `applyEvent`, цикл авто-продолжения вокруг POST в `adapter.run` (до 3 подряд, проверка `abortSignal.aborted` перед каждым новым POST — Cancel обрывает), строка статуса «Продолжаю — шаг N, лимит итераций исчерпан». После исчерпания N — плашка с кнопкой «Продолжить» (`StoppedRun` + `ActionBarPrimitive.Reload` в `thread.tsx`).
**Тесты:** новый `src/web/chat-limits.test.mjs` (дефолты/override/мусор/потолки/call-guard) + `chat.test.mjs` (truncated по итерациям и времени, целость истории к моменту truncated, continue-ход без user-сообщения, применение конфига к следующему ходу, мусорный конфиг) + `settings-api.test.mjs` (GET/PUT секции chat, сброс, 400 на мусор, отсутствие env). Время в тестах — только через инъекцию `now` (флаки).
**Проверки:** `pnpm build && pnpm test` (полный прогон для DoD), `pnpm web:typecheck/lint/build` + пересборка и коммит `web/dist` (lesson-6: `pnpm install` внутри `web/` в worktree).
**Риски:** повторный POST внутри одного run (approval-пауза обрабатывается до авто-продолжения); потенциальный цикл при постоянно упирающейся модели — ограничен `max_auto_continue`, счётчик не персистится (кнопка «Продолжить» — страховка); полная замена секции `chat` из формы теряет неизвестные пользовательские ключи; провайдер с долгим молчанием до первого токена получит `truncated` вместо error (мягче прежнего, дефолт 90 с перекрывает).
Вне скоупа (по задаче): значения `supervisor.limits` — VL-270; лимиты фаз агента и idle-watchdog не тронуты.
---
author: @agent
created: 2026-10-31 00:45
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/web/chat-limits.ts
- src/web/chat.ts
- src/bot/settings.ts
- src/web/api.ts
- src/web/chat-limits.test.mjs
- src/web/.append-tests.txt
- src/web/chat.test.mjs
- src/web/.append-settings.txt
- web/src/components/settings/api.ts
- web/src/components/settings/settings.tsx
- Now creating the new limits module.
Now the runChat entry validation.
Now the produce function: limits resolution and continue branch.
Now the new-message / continue branch.
Now `validateSettingsPatch` in api.ts.
Now add chat.test.mjs tests for truncated/continue.
Now settings-api tests.
Backend don…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 879 с, payload 688253 байт_
---
author: @agent
created: 2026-10-31 00:45
---
Фаза code не удалась (код выхода 1): me.tsx×4, payload последнего запроса=540066 байт (макс 688253), usage={"input_tokens":10850752,"output_tokens":32604,"cache_read_input_tokens":10700800,"total_tokens":10883356,"reasoning_tokens":7523} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-31 00:53
---
Фаза 3 (Code) выполнена. Коммит `2ebddc5`, 14 файлов, +1205/−127.
**Backend**
- **NEW `src/web/chat-limits.ts`** — чистый модуль: `CHAT_LIMITS_DEFAULT` (8 итераций / 120 с / 3 авто-продолжения / 90 с per-call), `CHAT_LIMITS_CEILING` (200 / 86400 / 20 / 3600), `CHAT_LIMITS_KEYS`, `resolveChatLimits(cwd)` → `{limits, errors}` (терпимое чтение секции `chat`, мусор → дефолт + сообщение, lesson-117), `formatChatLimitsErrors`, `createCallGuard(timeoutMs)` — `AbortController` с перевзводом таймера на `noteActivity()` и `timedOut()`.
- `src/web/chat.ts`: константы `MAX_LLM_ITERATIONS`/`MAX_WALL_TIME_MS` удалены (AC1); `ChatEvent` += `truncated`, `ChatRequestBody` += `continue`; лимиты резолвятся в начале `produce()` на каждый ход (AC2), ошибки конфига — в `console.error` (AC3); ветка `continue:true` — ход без user-сообщения, пустая история → error; проверки лимитов отдают `truncated {reason, step, limits, saved:true}` вместо `error` (AC6/AC7); вызов модели обёрнут `createCallGuard` — `onToken` перевзводит таймер, сработавший per-call таймаут даёт `truncated/wall_time`, а не error (AC12).
- `src/bot/settings.ts`: `BotSettings.chat` (`ChatSectionSettings`), терпимое чтение в `loadBotSettings`, запись через `saveBotSettings` (undefined удаляет ключ).
- `src/web/api.ts`: `validateSettingsPatch` принимает `chat` — только 4 известных ключа, положительное целое в потолке, `0/null` → сброс ключа, пустая секция → удаление `chat`, мусор → 400 без записи (AC4).
**Frontend**
- `web/src/components/settings/{api.ts,settings.tsx}`: `ChatSettings` в `SettingsData`/`SettingsPatch` + карточка «Лимиты веб-чата» с 4 полями и подсказками, пусто/0 — сброс (AC5).
- `web/src/components/chat/chat-runtime.tsx`: `CHAT_TRUNCATED_PART`, `truncated` в `ChatEvent`, `applyEvent` кладёт data-часть и флаг; `run` обёрнут в цикл — на `truncated` повторный POST `{continue:true}` без user-сообщения, текст «Продолжаю — шаг N, лимит итераций/времени исчерпан», до `maxAutoContinue` (из события, фолбэк 3), проверка `abortSignal.aborted` перед каждым новым POST (AC8/AC9/AC10/AC11).
- `web/src/components/chat/thread.tsx`: `PartView` рендерит `CHAT_TRUNCATED_PART` через `StoppedRun` с причиной и `ActionBarPrimitive.Reload` «Продолжить» (AC9).
**Тесты (полный прогон, без исключений)**
- NEW `src/web/chat-limits.test.mjs` — 18 тестов: дефолты/override/потолки/мусор всех видов/битый settings.json, `createCallGuard` (срабатывание, перевзвод, dispose, отключённый лимит).
- `src/web/chat.test.mjs` +7: `truncated/iterations` с целой историей jsonl (2 assistant + 2 tool), `truncated/wall_time`, `continue:true` без прироста user-сообщений, continue на пустой истории, применение нового конфига к следующему ходу в том же процессе, мусорный конфиг → дефолты, per-call таймаут молчащего вызова.
- `src/web/settings-api.test.mjs` +6: GET отдаёт `chat` без `env`, мусорные ключи отбрасываются, PUT сохраняет `env`/`chats`, сброс по ключу и полный сброс секции, 8 вариантов мусора → 400 и файл не меняется.
**Проверки**: `pnpm build` — ок; `pnpm test` — **111 файлов, 2050 passed, 4 skipped** (полный прогон); `web: pnpm typecheck` — ок; `web: pnpm lint` — 0 ошибок (1 pre-existing warning в `grant-scope.tsx`, не наш файл); `web: pnpm build` — ок, `web/dist` пересобран и закоммичен (lesson-6: `pnpm install` внутри `web/` в worktree).
**Документация**: README, раздел «Веб-чат (#/chat)» — новый блок «Лимиты хода и авто-продолжение» (таблица ключей `chat.*` с дефолтами и диапазонами, per-call vs бюджет хода, событие `truncated`, авто-продолжение и кнопка «Продолжить», мусор в конфиге, протокол дополнен событием `truncated`).
Ничего не осталось: все 14 AC закрыты, DoD выполнены. Вне скоупа задачи (по описанию): значения `supervisor.limits` — VL-270, лимиты фаз агента, idle-watchdog.
---
author: @agent
created: 2026-10-31 01:17
---
Фаза Close прервана: конфликт слияния vb/vl-269 → master.
Ветка `vb/vl-269` содержит один коммит `2ebddc5` («feat: VL-269 — лимиты чата в конфиге (chat.*), truncated вместо error, авто-продолжение хода»), worktree чистый (только untracked-симлинки `node_modules`, `backlog/references/data`). Merge `--no-ff` упал на конфликте в собранных артефактах веба:
- `web/dist/index.html` — CONFLICT (content)
- `web/dist/assets/index-Borh9WjR.js` — CONFLICT (rename/rename): master переименовал в `index-CIHBip5Y.js`, ветка — в `index-Bid1q-N-.js`
- `web/dist/assets/index-Bid1q-N-.js` / `web/dist/assets/index-CIHBip5Y.js` — оба варианта бандла
Причина: `web/dist` — генерируемые бандлы, их пересобирали и коммитили и в master (другая задача), и в ветке VL-269; git не может свести переименование одного исходного файла в два разных хэша.
Согласно правилу фазы конфликт НЕ резолвился и `git merge --abort` НЕ выполнялся — состояние merge оставлено в рабочем дереве главного репо для ручного разбора (`git status --porcelain` показывает конфликтующие пути). DoD, статус задачи и документация не менялись. Файл `README.md` слит автоматически (M, без конфликта).
Разрешение: вручную выбрать один бандл `web/dist` (рекомендуется `git checkout --ours web/dist && cd web && pnpm install && pnpm build`, затем `git add web/dist` и `git commit` merge), после чего повторить Фазу Close.
---
author: @agent
created: 2026-10-31 01:17
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-269 → master.
Ветка `vb/vl-269` содержит один коммит `2ebddc5` («feat: VL-269 — лимиты чата в конфиге (chat.*), truncated вместо error, авто-продолжение хода»), worktree чистый (только untracked-симлинки `node_modules`, `backlog/references/data`). Merge `--no-ff` упал на конфликте в собранных артефактах веба:
- `web/dist/index.html` — CONFLICT (content)
- `web/dist/assets/index-Borh9WjR.js` — CONFLICT (rename/rename): master переименовал в `index-CIH — статус возвращён к Review.
---
author: @agent
created: 2026-11-01 13:00
---
Фаза Close выполнена. Ветка vb/vl-269 (коммит 2ebddc5) уже была слита в master merge-коммитом 6292984 в предыдущей попытке Close — перемерж не потребовался: `git log master..vb/vl-269` пуст, MERGE_HEAD отсутствует, конфликтов web/dist нет (разрешены пересборкой, lesson-28). Проверки в главном репо: `pnpm build` — ок; ранний фильтр `vitest run` по затронутым модулям (chat-limits, chat, settings-api) — 113 файлов / 2062 passed, 4 skipped; полный `pnpm test` (build + vitest, включая static.test.mjs) — 113 файлов passed, 2062 passed / 4 skipped, регрессий нет. Worktree .vibelog/worktrees/vl-269 удалена через --force (в ней были только untracked-симлинки node_modules и backlog/references/data), ветка vb/vl-269 удалена (`-d`, was 2ebddc5). Lessons: lesson-28 расширен (конфликты web/dist разрешаются пересборкой — второй случай на VL-269), создан lesson-126 («Дели per-call таймаут и общий бюджет хода, перевзводи таймер на onToken») и связан с задачей. Документация: CHANGELOG.md — запись VL-269 в Unreleased (коммит eb163a9); README уже содержал раздел «Лимиты хода и авто-продолжение» (пришёл из ветки). DoD: все 3 пункта выполнены (тесты проходят, документация обновлена, регрессий нет).
---
<!-- COMMENTS:END -->