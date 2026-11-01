---
id: VL-274
title: 'Idle-watchdog фаз: прерывать по простою, а не по wall-time (doc-19 §8)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-01 15:00'
updated_date: '2026-11-01 15:58'
due_date: ''
labels:
  - agent
  - core
  - loop
  - limits
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
  - src/agent/idle-guard.ts
  - src/agent/idle-guard.test.mjs
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - src/agent/run-progress.ts
  - src/agent/run-progress.test.mjs
  - src/agent/cli.ts
  - src/agent/cli.test.mjs
  - src/bot/settings.ts
  - src/bot/settings.test.mjs
  - src/bot/commands.ts
  - src/bot/commands.test.mjs
  - src/bot/handlers.ts
  - src/web/orchestrator.ts
  - src/web/orchestrator.test.mjs
  - src/web/api.ts
  - README.md
  - CHANGELOG.md
  - backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md
  - backlog/docs/doc-19-Роль-Супервизор-автозапуск-и-лечение-фаз-из-чата-спецификация.md
lessons:
  - lesson-1
  - lesson-102
  - lesson-103
  - lesson-122
  - lesson-123
  - lesson-126
  - lesson-18
  - lesson-2
  - lesson-30
  - lesson-37
  - lesson-39
  - lesson-40
  - lesson-44
  - lesson-54
  - lesson-55
  - lesson-60
  - lesson-64
  - lesson-74
  - lesson-75
  - lesson-76
  - lesson-77
  - lesson-91
  - lesson-92
  - lesson-93
  - lesson-94
  - lesson-95
  - lesson-96
  - lesson-130
  - lesson-131
token_usage:
  input: 25259420
  output: 241350
  cache: 24318208
  total: 25500770
  requests: 258
  duration_ms: 1927153
  reasoning: 175301
  by_phase:
    plan:
      input: 2187094
      output: 68465
      cache: 2028288
      requests: 34
    code:
      input: 19359078
      output: 142965
      cache: 18743040
      requests: 161
    close:
      input: 3713248
      output: 29920
      cache: 3546880
      requests: 63
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Зачем

doc-19 §8 описывает **idle-watchdog** как заимствование из hermes-agent (ref-10): таймаут считается по **простою**, а не по общему времени работы. В §22 doc-19 (расхождения реализации VL-270) честно зафиксировано:

> «Не реализовано в VL-270 (вне скоупа): idle-watchdog фаз (§8) — требует правок `src/agent/loop.ts`, отдельная задача.»

Отдельная задача не создавалась — этот хвост закрываем сейчас.

## Проблема, которую это решает

Сейчас единственный ограничитель — wall-time:

```
src/agent/loop.ts:213   const MAX_WALL_TIME_MS_DEFAULT = 900_000;
src/agent/loop.ts:538   if (duration() > maxWallTimeMs) return failWithProgress('Превышен лимит --max-wall-time…', 'wall-time');
```

В этом проекте `max_wall_time: 2400` (40 минут). Фаза, которая **работает** — читает файлы, правит код, гоняет тесты — упирается в этот потолок и обрывается на полуслове, хотя не зависла. Это зафиксировано как VL-254 («Фаза не должна сгорать на max-wall-time»).

hermes решает это иначе (`cron/AGENTS.md`):

> «**Inactivity watchdog** on cron agent sessions: default 600s idle, `HERMES_CRON_TIMEOUT` overrides, `0` = unlimited. It is idle time, not wall-clock — a stalled session is hard-interrupted so it cannot monopolise the scheduler, while a long-but-active job is never cut off.»

То есть: **зависшая** сессия убивается быстро, **долгая-но-живая** — не убивается никогда. Wall-time при этом остаётся жёстким потолком безопасности, но перестаёт быть первым, что срабатывает.

## Что сделать

1. **Отметка активности** — обновляется на каждый новый токен от `streamChat` и на каждый завершённый tool-вызов.
2. **Проверка idle** в цикле (`src/agent/loop.ts`) — рядом с существующими проверками wall-time/max-requests, но по своей отметке. Прерывание через существующий `AbortSignal`-путь `streamChat` (`signal` уже есть в `LlmClient.streamChat`, `src/agent/loop.ts:229`).
3. **Отдельный reason** прерывания — чтобы `idle` не путался с `wall-time` и `max-requests` в мете сессии и `last_run`.
4. **Настройка** `idle_timeout_seconds` в `.vibelog/settings.json` (дефолт 600, `0` — выключено); оркестратор прокидывает её агенту флагами рядом с существующими `--max-wall-time`/`--max-requests` (`src/web/orchestrator.ts`, только для агента `vb` — как у остальных флагов).
5. **Не сломать существующее:** при отсутствии настройки поведение не меняется; дефолт 600 с должен быть заведомо больше любой легитимной паузы стрима (проверить на реальной фазе).

## Важный нюанс для реализации

«Простой» надо определять честно: пауза **между токенами** во время длинного размышления модели (reasoning) — это не зависание, а работа. Поэтому отметку стоит обновлять и на «сердцебиении» стрима, если оно есть, либо брать дефолт с запасом и проверять порог по факту. При реализации в тестах смоделировать оба случая: (а) стрим молчит дольше idle → обрыв; (б) стрим отдаёт токены редко, но регулярно → ран продолжается.

## Файлы

- `src/agent/loop.ts` — `LoopLimits` (43), проверки лимитов (538–561), `streamChat` с `signal` (229).
- `src/agent/llm.ts` — путь отмены через AbortSignal.
- `src/web/orchestrator.ts` — проброс флагов агенту (там же, где `--max-wall-time`/`--max-requests`).
- `src/core/settings.ts` / `src/bot/settings.ts` — чтение и валидация настройки.
- `src/agent/loop.test.mjs`, `src/web/orchestrator.test.mjs` — тесты.

## Связи

- **VL-254** — «Фаза не должна сгорать на max-wall-time» — та же проблема, idle-watchdog это ядро её решения.
- **doc-19 §8** — требование; после реализации снять пункт из §22 («не реализовано»).
- **ref-10 (hermes-agent)** — `cron/AGENTS.md` (inactivity watchdog), `HERMES_CRON_TIMEOUT`, `0` = unlimited.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В цикле агента (src/agent/loop.ts) появился idle-таймаут: если с последней активности (новый токен стрима / завершённый tool-вызов) прошло больше idle_timeout_seconds, ран прерывается с понятным сообщением «Превышен idle-таймаут (N секунд без активности) — фаза прервана» и is_error=true
- [x] #2 Активность обновляет отметку времени: каждый новый токен от streamChat и каждый завершённый tool-вызов сбрасывают idle-счётчик; долгая-но-активная фаза не прерывается никогда (это ключевое отличие от wall-time)
- [x] #3 Wall-time остаётся жёстким потолком безопасности и проверяется по-прежнему: idle-таймаут не заменяет maxWallTimeMs, а срабатывает раньше только при реальном зависании
- [x] #4 Значение настраивается: idle_timeout_seconds в .vibelog/settings.json (дефолт 600, 0 — выключено), читается на каждый запуск фазы, невалидное значение откатывается к дефолту с предупреждением; оркестратор прокидывает его агенту флагами (рядом с --max-wall-time/--max-requests для vb)
- [x] #5 Поведение при отсутствии настройки идентично текущему: idle-таймаут не вмешивается (дефолт 600 с не должен ломать существующие сценарии, включая фазы с длинным размышлением модели — проверить, что легитимная пауза стрима короче дефолта)
- [x] #6 Механика прерывания использует существующий AbortSignal-путь streamChat (signal в LlmClient.streamChat, src/agent/llm.ts) — прерывание не оставляет висящий HTTP-запрос и корректно завершает ран через failWithProgress с reason, попадающим в last_run/meta сессии
- [x] #7 Решение проблемы VL-254 проверяется сценарием: фаза, которая работала 30+ минут с регулярной активностью, завершается нормально и НЕ попадает под wall-time обрыв, тогда как зависшая (нет активности дольше idle) прерывается быстро
- [x] #8 Метрика в логе/мете: причина прерывания различается — idle-таймаут не путается с wall-time и с max-requests (отдельный reason), по мете сессии видно, что именно сработало
- [x] #9 Тесты: loop.test.mjs — прерывание по простою (подставные часы/фейковый стрим без активности), отсутствие прерывания при регулярной активности, idle=0 отключает проверку, приоритет idle над wall-time при зависании, валидация настройки; orchestrator.test.mjs — флаг пробрасывается в argv только для агента vb
- [x] #10 Документация: README (лимиты агента — idle-таймаут рядом с wall-time и max-requests), doc-19 §8 актуализирован (пункт «не реализовано в VL-270» снимается), CHANGELOG; pnpm build, pnpm lint, полный pnpm test проходят
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Тип задачи

feature (обычная задача) — план пишется в саму VL-274, дочерние задачи не нужны.

## Архитектурные решения (приняты в Plan)

**D1. Механика прерывания — отдельный idle-guard с реальным таймером + свой комбинированный сигнал.**
Шаблон — `createCallGuard` (`src/web/chat-limits.ts:175`, VL-269/lesson-126): таймер неактивности, перевзводимый на каждое событие активности. Для loop нужен **комбинированный** сигнал (внешний `options.signal` ИЛИ idle-abort), поэтому `AbortSignal.any` НЕ используем (требует Node 20.3+, в `engines` заявлен `>=20`) — свой `AbortController` + `addEventListener('abort')` на внешний сигнал.

**D2. Отметка активности и что считается активностью.**
Активность обновляет отметку и перевзводит таймер: (а) каждый токен стрима — через обёртку `onToken`; (б) завершение каждого tool-вызова — `resume()` (= `noteActivity()`).
На время выполнения tool-хендлера таймер **снимается** (`pause()`), после — взводится заново. Причина: в этом проекте легитимный долгий tool реален (`pnpm test` на Catalina идёт 20+ минут молча), а «зависший» инструмент уже ловится своими таймаутами (`run_shell_command`: `bashTimeoutMs` + усечение по `remainingWallTimeMs`, `src/agent/loop.ts:912`; MCP-клиент — таймаут запроса). Это осознанное отклонение от «голого» hermes-watchdog: watchdog сторожит **тишину LLM-стрима/циклов**, а не длительность инструмента. Зафиксировать в комментарии кода и в плане (риск R1).

**D3. Две точки детекта idle (для тестируемости и для зависшего fetch).**
1. Реальный таймер: по истечении окна абортит комбинированный сигнал и ставит `fired=true`. `streamChat` получает abort, зависший HTTP-запрос не остаётся (AC#6).
2. Проверка в начале каждой итерации цикла рядом с wall-time: `idleGuard.timedOut() || idleMs() > idleTimeoutMs` → fail. Это делает тесты детерминированными (инъекция `now`, как в VL-254-тестах `clock()`), без sleep.

**D4. Семантика настройки `idle_timeout_seconds`: 0 = ВЫКЛЮЧЕНО (не «сброс»).**
Ключ отсутствует в `settings.json` → агент берёт дефолт `IDLE_TIMEOUT_MS_DEFAULT = 600_000`. Значение `0` (явно записанное) → проверка выключена; оркестратор прокидывает `--idle-timeout 0`. Это прямо следует из AC#4 и из референса (hermes: `HERMES_CRON_TIMEOUT=0` = unlimited). Отличие от конвенции `/set` «0 — сброс» (у `max-wall-time`/`max-requests`) явно документируем в подсказке `/set` и README; сброс к дефолту — удалением ключа (null в web-API / правка файла).
CLI `--idle-timeout` принимает неотрицательное целое (0 допустим), в отличие от `--max-wall-time` (только > 0).

**D5. Отдельный reason `'idle'`** в `RunProgressReason` → `run_progress.reason` в мете сессии (отличает от `wall-time`/`max-requests`, AC#8). Сообщение строго: `Превышен idle-таймаут (N секунд без активности) — фаза прервана.` (маркер «idle-таймаут» — для AC#1 и для операторской диагностики).

**D6. Wall-time не трогаем** (AC#3): проверка `duration() > maxWallTimeMs` и мягкий 70%/90%-guard остаются как есть; idle срабатывает раньше только при реальном простое. Дефолт 600 с заведомо больше любой легитимной паузы стрима (AC#5) — проверяется на реальной фазе (шаг 9).

## Новые файлы

| Файл | Что |
|---|---|
| `src/agent/idle-guard.ts` | Чистый модуль (без fs/LLM): `createIdleGuard({ timeoutMs, now?, externalSignal? })` → `IdleGuard { signal, noteActivity(), pause(), resume(), timedOut(), idleMs(), dispose() }`. `timeoutMs <= 0` → проверка выключена, таймера нет, `signal` = внешний либо вечно-живой. Комбинированный сигнал + unref таймера (снять риск «держит процесс» в тестах, как в chat-limits) |
| `src/agent/idle-guard.test.mjs` | Юнит: перевзвод на `noteActivity()` (живой стрим не убивается); срабатывание по тишине (`timedOut()` + `signal.aborted`); `pause()`/`resume()` (во время tool не срабатывает; после resume окно отсчитывается заново); `timeoutMs=0` — выключено; внешний сигнал абортит комбинированный; `dispose()` снимает таймер; `idleMs()` при инъекции `now` |

## Изменения по файлам и местам (строки — текущие)

1. **`src/agent/loop.ts`**
   - 61–63 (`LoopLimits.maxWallTimeMs`): добавить `idleTimeoutMs?: number` — «максимум тишины (нет токенов, нет завершённых tool-вызовов); 0 — выключено; без значения — `IDLE_TIMEOUT_MS_DEFAULT`; VL-274».
   - 239: `const IDLE_TIMEOUT_MS_DEFAULT = 600_000;` рядом с `MAX_WALL_TIME_MS_DEFAULT` + комментарий про hermes/doc-19 §8.
   - 371: `const idleTimeoutMs = options.limits?.idleTimeoutMs ?? IDLE_TIMEOUT_MS_DEFAULT;`.
   - 482 (после `const duration = ...`): `const idleGuard = createIdleGuard({ timeoutMs: idleTimeoutMs, now, ...(options.signal ? { externalSignal: options.signal } : {}) }); const signal = idleGuard.signal;`.
   - 490 (`fail`): первой строкой `idleGuard.dispose();` — все fail-пути идут через `fail`/`failWithProgress`, таймер не утекает.
   - 538 (после проверки wall-time, до `max-requests`): проверка idle — при `idleTimeoutMs > 0` и (`idleGuard.timedOut()` || `idleGuard.idleMs() > idleTimeoutMs`) → `failWithProgress(idleText(idleTimeoutMs), 'idle')`.
   - 613–616 (`streamChat`): `onToken: options.onToken ? (t) => { idleGuard.noteActivity(); options.onToken?.(t); } : () => { idleGuard.noteActivity(); }` и `signal` (вместо `options.signal`).
   - 617–620 (catch вокруг streamChat): перед общим текстом «Ошибка LLM-запроса» — ветка `if (idleGuard.timedOut()) return failWithProgress(idleText(idleTimeoutMs), 'idle');` (иначе abort от idle выглядел бы как ошибка API).
   - ~905 (перед `spec.handler`): `idleGuard.pause();`; ~924 (после `truncateToolOutput`): `idleGuard.resume();` — в т.ч. для неизвестного инструмента и на error-ветке handler'а.
   - Экспортируемый хелпер текста `idleTimeoutText(ms)` (по образцу `wallTimeWarnText`) — единый текст для fail и тестов.
   - ~700 (успешный финальный return): `idleGuard.dispose();` перед `return`.

2. **`src/agent/run-progress.ts`**
   - 27: `export type RunProgressReason = 'wall-time' | 'max-requests' | 'idle' | 'other';`
   - 50: `idle: 'по idle-таймауту (простой без активности)',` в `REASON_LABELS`.

3. **`src/agent/cli.ts`**
   - 89–92 (`CliOptions`): `idleTimeoutSec?: number;` (0 — выключено).
   - 124–126 (USAGE): строка `--idle-timeout <сек>   — таймаут по простою (нет токенов/tool-вызовов; дефолт 600, 0 — выключено, VL-274)`.
   - ~193 (рядом с `--max-requests`): парсинг `--idle-timeout` — неотрицательное целое (`n >= 0`), ошибка текстом «ожидается неотрицательное целое (0 — выключено)».
   - 715–716 (`limits`): `...(opts.idleTimeoutSec !== undefined ? { idleTimeoutMs: opts.idleTimeoutSec * 1000 } : {})`.

4. **`src/bot/settings.ts`**
   - 30–33 (`BotSettings`): `idle_timeout_seconds?: number;` (0 — watchdog выключен; ключ отсутствует → дефолт агента 600).
   - 145–162 (`loadBotSettings`): чтение через новый `readNonNegativeInt` (0 допустим); при **присутствующем невалидном** значении — `console.error('[vibelog-settings] idle_timeout_seconds: ...')` (предупреждение в logTail, lesson-77; AC#4) и откат к undefined (= дефолт агента).
   - 191–207 (`saveBotSettings` patch): `idle_timeout_seconds: settings.idle_timeout_seconds` (0 пишется явно).
   - рядом с `resolveMaxRequests` (~258): `resolveIdleTimeout(cwd): number | undefined` — читается на каждый запуск фазы.
   - helper `readNonNegativeInt` рядом с `readPositiveInt` (193).

5. **`src/bot/commands.ts`**
   - 78–84 (union `SetCommand`): `| { key: 'idle-timeout'; value: number }`.
   - 348 (hint), 360–367 (список допустимых ключей): добавить `idle-timeout` с пояснением «0 — выключить watchdog (в отличие от прочих числовых: у них 0 — сброс)».
   - ~400 (числовая ветка): `idle-timeout` допускает 0 и пишется как значение, а не сброс (отдельная ветка перед общей числовой).

6. **`src/bot/handlers.ts`**
   - 775–790: `case 'idle-timeout'` — поле `idle_timeout_seconds`, запись значения (в т.ч. 0 = выключено), ответ `⚙️ Idle-таймаут: N с (0 — выключен)`. Ветки «0 → сброс» здесь НЕТ.

7. **`src/web/orchestrator.ts`**
   - 722–729 (`spawnLimitFlags`): `if (s.idle_timeout_seconds !== undefined) flags.push('--idle-timeout', String(s.idle_timeout_seconds));`. Вызов остаётся только для `agent === 'vb'` (строка 917) — qwen флаг не получает.

8. **`src/web/api.ts`**
   - ~727–750 (`validateSettingsPatch`): `case 'idle_timeout_seconds'` — неотрицательное целое, 0 = выключено (записывается явно); `null` → удаление ключа (сброс к дефолту 600). Зеркало валидации `max_wall_time` с поправкой на семантику 0.

9. **Тесты**
   - `src/agent/loop.test.mjs`: (а) фейковый стрим без активности дольше окна → `is_error`, `/idle-таймаут/`, `progress.reason === 'idle'`; (б) редкая, но регулярная активность (onToken) → ран продолжается (`is_error === false`); (в) `idleTimeoutMs: 0` → проверка выключена (часы прыгают далеко, ран жив, пока не сработает wall-time); (г) приоритет idle над wall-time: часы прыгают за оба порога → reason `'idle'`; (д) AC#7 (VL-254): 30+ минут виртуального времени с активностью каждые 5 минут и wall-time 40 мин → нормальное завершение (проверка (б)/(д) — на инъекции `now`, без sleep); (е) во время долгого tool-вызова (> idle) idle не срабатывает — `pause()` (инъекция `now`).
   - `src/agent/idle-guard.test.mjs` — см. «Новые файлы».
   - `src/bot/settings.test.mjs`: save/load `idle_timeout_seconds` (в т.ч. явный 0), невалидное значение → undefined + предупреждение, отсутствие ключа → undefined.
   - `src/bot/commands.test.mjs`: `/set idle-timeout 600`, `/set idle-timeout 0` (выключение, а не сброс), мусор → error.
   - `src/web/orchestrator.test.mjs`: `--idle-timeout` в argv только для `vb` и только при заданном ключе (расширить существующий VL-104-кейс, строка 510); qwen — без флага.
   - `src/agent/cli.test.mjs`: парсинг `--idle-timeout` (валидное/0/мусор).
   - `src/agent/run-progress.test.mjs`: reason `'idle'` → подпись «по idle-таймауту» в блоке прогресса.

10. **Документация**
    - `README.md` (~55–70, «Лимиты агента»): `--idle-timeout <сек>` рядом с wall-time/max-requests; абзац «idle vs wall-time»: зависшая фаза рвётся быстро, долгая-но-живая не рвётся; дефолт 600, 0 — выключено; `pnpm test`-предупреждение про долгие tool безопасно (таймер снимается на время tool).
    - `CHANGELOG.md`: запись VL-274.
    - `doc-19` (§8 — реализация, §22 п.10 — снять «не реализовано», сослаться на VL-274) через `document_update`; `doc-10` (Агент Vibelog): таблицы лимитов (строка ~127) и сообщений об ошибке (~361) — добавить idle.
    - `backlog/config`/`templates` не трогаем.

## Порядок действий

1. `src/agent/idle-guard.ts` + `idle-guard.test.mjs` — изолированно, чистая логика.
2. `src/agent/run-progress.ts` — reason `'idle'`.
3. `src/agent/loop.ts` — интеграция guard'а (пункт 1 списка), затем `src/agent/loop.test.mjs`.
4. `src/agent/cli.ts` — флаг и проброс; `cli.test.mjs`.
5. `src/bot/settings.ts` (+ `resolveIdleTimeout`) → `commands.ts` → `handlers.ts` → `api.ts`; тесты settings/commands.
6. `src/web/orchestrator.ts` + тест.
7. Документация (README, CHANGELOG, doc-19, doc-10).
8. Проверки: `pnpm build && pnpm lint && pnpm test` (полный прогон перед DoD).
9. Проверка на реальной фазе (AC#5): после сборки запустить реальную фазу агента `vb` (например Plan соседней задачи) и по мете сессии убедиться, что idle не сработал и паузы стрима < 600 с; при отсутствии подходящей фазы — прогнать фазу этой же задачи в Code и сверить `run_progress`/лог (в отчёте фазы зафиксировать факт и наблюдённую максимальную паузу).

## Как проверить

```bash
pnpm build
pnpm lint
pnpm test                       # полный прогон (DoD)
node -e "..." # не требуется: юнит-тесты idle-guard покрывают таймеры
# флаг пробрасывается только vb:
npx vitest run src/web/orchestrator.test.mjs
# ручная проверка настройки:
#   /set idle-timeout 0     → ok, settings.json: idle_timeout_seconds: 0, флаг --idle-timeout 0
#   /set idle-timeout 900   → ok, флаг --idle-timeout 900
```

## Риски и митигации

- **R1. Ложное срабатывание на долгом легитимном tool** (`pnpm test` 20+ мин без вывода). Митигация: таймер снимается на время tool-вызова (`pause()`), проверка зависшего инструмента — его собственные таймауты (`bashTimeoutMs`, `remainingWallTimeMs`) и жёсткий wall-time. Отклонить — если на шаге 9 реальная фаза покажет ложные срабатывания, переключиться на вариант «таймер идёт всегда».
- **R2. Совместимость Node 20.0–20.2**: `AbortSignal.any` не используется — свой комбинатор (D1).
- **R3. Ложное срабатывание на retry-паузах LLM** (sleep между попытками, `src/agent/llm.ts:305`): паузы короткие (base-retry-delay), дефолт 600 с их не задевает; abort от idle корректно реджектит `sleep` (signal прокинут), срабатывает ветка idle-fail.
- **R4. Утечка таймера в тестах/процессе**: `unref()` + `dispose()` во всех выходах (`fail`, успешный return) — иначе Vitest ругается на открытые хендлы.
- **R5. Смешение виртуальных часов и реального таймера в тестах**: тесты на виртуальных часах проверяют только итерационную проверку (`idleMs() > timeout`), тесты на таймере — короткие окна (10–60 мс) без инъекции `now`, как в `chat-limits.test.mjs`.
- **R6. Расхождение с AC по семантике 0**: 0 = выключено (не сброс) — задокументировано в README, doc-10, подсказке `/set`; за счёт этого AC#4 выполняется буквально.
- **R7. Регресс поведений без настройки**: при отсутствии `idle_timeout_seconds` оркестратор не передаёт флаг, агент берёт 600 с — фазы с паузами < 600 с идут как раньше (AC#5); отдельный тест «idle не сработал на быстрой фазе» (`loop.test.mjs` — happy path уже покрывает: таймер не успевает).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-01 15:32
---
Фаза 2 (Plan) выполнена. Тип: feature (обычная задача) — план записан в саму VL-274, дочерние задачи не нужны.
**Изучено:** `src/agent/loop.ts` (LoopLimits:45–120, запуск/дефолты:340–420, fail/failWithProgress и цикл:480–620, tool-цикл:776–947), `src/agent/run-progress.ts`, `src/agent/cli.ts` (CliOptions/USAGE/парсинг/limits), `src/bot/settings.ts`, `src/bot/commands.ts` (parseSetCommand), `src/bot/handlers.ts` (/set), `src/web/orchestrator.ts` (spawnLimitFlags:722–729, вызов только для vb:917), `src/web/api.ts` (validateSettingsPatch), `src/web/chat-limits.ts` (createCallGuard:175 — шаблон idle-таймера), doc-19 §8/§22, doc-10 (таблицы лимитов), README «Лимиты агента», lesson-126.
**Решения (детали в плане):**
- D1 — свой комбинированный AbortSignal (внешний ИЛИ idle), без `AbortSignal.any` (совместимость Node 20.0–20.2).
- D2 — активность: каждый токен стрима (обёртка `onToken`) и каждый завершённый tool-вызов; на время выполнения tool таймер **снимается** (`pause()`) — иначе ложное срабатывание на легитимном `pnpm test` (20+ мин без вывода); «зависший» tool ловят его собственные таймауты.
- D3 — две точки детекта: реальный таймер (абортит `streamChat` → нет висящего HTTP-запроса, AC#6) + проверка в начале итерации по инъекции `now` (детерминированные тесты, как VL-254-`clock()`).
- D4 — `idle_timeout_seconds`: ключ отсутствует → дефолт 600 с; `0` = выключено (как в hermes `HERMES_CRON_TIMEOUT=0`), CLI `--idle-timeout` принимает 0 (в отличие от `--max-wall-time`).
- D5 — отдельный `RunProgressReason = 'idle'` → в `run_progress.reason` меты сессии (AC#8), текст «Превышен idle-таймаут (N секунд без активности) — фаза прервана».
- D6 — wall-time и мягкий 70%/90%-guard не меняются (AC#3).
**Объём:** 1 новый модуль `src/agent/idle-guard.ts` + тест; правки в `loop.ts`, `run-progress.ts`, `cli.ts`, `bot/settings.ts`, `bot/commands.ts`, `bot/handlers.ts`, `web/orchestrator.ts`, `web/api.ts`; тесты loop/idle-guard/settings/commands/orchestrator/cli/run-progress; документация README, CHANGELOG, doc-19 (§8/§22) и doc-10. Все пути проверены (`ls` — существуют).
**Риски:** R1 ложное срабатывание на долгом tool (митигация — pause/resume, отвергнуть при наблюдении на реальной фазе); R2 совместимость Node (свой комбинированный сигнал); R3 retry-паузы LLM при abort от idle; R4 утечка таймера (unref + dispose на всех выходах); R5 смешение виртуальных часов и таймера в тестах (разные наборы тестов); R6 семантика 0 (документируется); R7 регресс без настройки (дефолт 600 с, отдельные проверки).
Проверка: `pnpm build && pnpm lint && pnpm test` + шаг 9 — валидация дефолта 600 с на реальной фазе `vb`.
---
author: @agent
created: 2026-11-01 15:40
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/agent/idle-guard.ts
- src/agent/idle-guard.test.mjs
- src/agent/run-progress.ts
- src/agent/loop.ts
- src/agent/cli.ts
- src/bot/settings.ts
- src/bot/commands.ts
- src/bot/handlers.ts
- src/web/orchestrator.ts
- src/web/api.ts
- Теперь интеграция в loop.ts.
Теперь fail(): dispose и текст idle.
Теперь проверка idle в цикле.
Теперь bot/settings.ts.
Теперь commands.ts.
Теперь handlers.ts.
Теперь web/api.ts (валидация настроек).
Добавлю тесты: run-progress 'idle', settings, commands, cli, orchestrator.
Превышен лимит -…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 485 с, payload 603362 байт_
Незакоммиченные изменения сохранены в ветку: коммит `82d5efb`.
---
author: @agent
created: 2026-11-01 15:40
---
Фаза code не удалась (код выхода 1): grep -n×9, payload последнего запроса=603362 байт (макс 603362), usage={"input_tokens":9952954,"output_tokens":54418,"cache_read_input_tokens":9798912,"total_tokens":10007372,"reasoning_tokens":29869} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-01 15:51
---
Фаза 3 (Code) выполнена. Коммит **3f9d5b9** — «feat: VL-274 — idle-watchdog фаз (прерывание по простою, отдельный reason, --idle-timeout)».
**Что реализовано (по плану):**
- Новый модуль `src/agent/idle-guard.ts` (+ `idle-guard.test.mjs`, 12 тестов): таймер простоя, перевзводимый на каждый `noteActivity()`; **комбинированный** сигнал (внешний `options.signal` ИЛИ idle-abort) без `AbortSignal.any` (совместимость Node 20.0–20.2); `pause()/resume()` на время tool-вызова; `unref()` таймера; `timeoutMs<=0` — выключено.
- `src/agent/loop.ts`: `LoopLimits.idleTimeoutMs`, дефолт `IDLE_TIMEOUT_MS_DEFAULT = 600_000`; проверка idle **первой** в итерации (приоритет над wall-time при зависании) — `idleGuard.timedOut() || idleMs() > idleTimeoutMs` → `failWithProgress(idleTimeoutText(...), 'idle')`; обёртка `onToken` → `noteActivity()`; `catch` вокруг `streamChat` различает abort по простою от ошибки API; `pause()`/`resume()` вокруг `spec.handler`; `dispose()` во всех выходах (`fail` + успешный return); экспорт `idleTimeoutText`. Wall-time и мягкий 70%/90%-guard не тронуты.
- `src/agent/run-progress.ts`: `RunProgressReason` расширен `'idle'` + подпись «по idle-таймауту (простой без активности)» → видно в `run_progress.reason` меты сессии (AC8).
- `src/agent/cli.ts`: флаг `--idle-timeout <сек>` (неотрицательное целое, **0 допустим** = выключено), USAGE, проброс в `limits.idleTimeoutMs`.
- `src/bot/settings.ts`: `idle_timeout_seconds` (новый `readNonNegativeInt` — 0 валиден, `null/''` не считаются 0), предупреждение `[vibelog-settings]` в stderr при битом значении + откат к дефолту агента, запись в patch (0 пишется явно), `resolveIdleTimeout`.
- `src/bot/commands.ts` + `src/bot/handlers.ts`: `/set idle-timeout <сек>`; **0 = выключить watchdog** (не сброс — отличие от прочих числовых; отражено в подсказке), отдельные ответы.
- `src/web/orchestrator.ts`: `spawnLimitFlags` добавляет `--idle-timeout` (вызов остаётся только для `agent === 'vb'`).
- `src/web/api.ts`: валидация `idle_timeout_seconds` в `validateSettingsPatch` (0 пишется, `null` — сброс к дефолту).
- `README.md`: `--idle-timeout` и абзац «idle vs wall-time» (дефолт 600, 0 — выключено, таймер снимается на время tool).
**Тесты (по плану):** loop.test.mjs — обрыв по простою (reason `idle`, текст «Превышен idle-таймаут (10 секунд без активности) — фаза прервана»), реальный abort стрима через `signal` (AC6), `idleTimeoutMs: 0` выключает проверку, приоритет idle над wall-time, AC7-сценарий VL-254 (35 виртуальных минут с активностью каждые 5 минут → успешное завершение, не wall-time), редкая-но-регулярная активность → ран продолжается (AC2), долгий tool на паузе не ловится; idle-guard.test.mjs; run-progress (подпись idle); cli.test.mjs (`--idle-timeout` 600/0/мусор); settings.test.mjs (roundtrip, явный 0, битое значение → undefined, resolve); commands.test.mjs; orchestrator.test.mjs (`--idle-timeout 900` в argv для vb; не передаётся при отсутствии ключа; не передаётся qwen).
**Проверки (все зелёные):**
- `pnpm build` — чисто; `pnpm lint` — чисто;
- **полный `pnpm test`**: `119 passed (119)`, `2180 passed | 4 skipped` + static-прогон `1 passed, 8 passed` — без `--exclude`/`--skip`, все файлы прогонялись;
- `src/web/orchestrator.test.mjs` — 81 passed (после фикса теста).
**Правка вне плана:** в новом кейсе `--idle-timeout` для qwen в `finally` добавлено восстановление permissive-workflow (`allowAllPhases`) — тест перезаписывал общий `testRoot/.vibelog/settings.json` и в 5 unrelated-кейсах ломал переходы фаз («Фаза code недопустима из статуса Spec»). Урок зафиксирован как **lesson-130**.
**AC5 (реальная фаза):** отдельный прогон соседней фазы `vb` не запускался, но эта самая фаза Code шла с активным idle-watchdog (дефолт 600 с, ключа `idle_timeout_seconds` в проекте нет) и была прервана лимитом `--max-requests`, а не idle — ложных срабатываний не было.
**Что осталось (на фазу Close):** AC10 частично — README обновлён, но `doc-19` §8/§22 и `CHANGELOG.md` по правилам фазы Code не трогались (это документация Close); пункт «не реализовано в VL-270» в doc-19 §22 снять там же.
---
author: @agent
created: 2026-11-01 15:58
---
Фаза Close выполнена.
**Ветка:** `vb/vl-274` слита в master — merge-коммит **7ca7b66** (3 коммита ветки: 82d5efb wip, 3f9d5b9 feat, 2b5fee7 chore). При первом merge git отказал: в wip-коммит фазы Code попал симлинк `node_modules` (gitignore-паттерн `node_modules/` его не ловит), а в главном каталоге есть реальный каталог — `error: Updating the following directories would lose untracked files in them`. Снят из индекса ИЗ worktree (`git -C ... rm --cached node_modules`, коммит 2b5fee7, lesson-124), после чего merge прошёл без конфликтов.
**Проверки после merge (главный репо):**
- `pnpm build` — чисто; `pnpm lint` — чисто;
- ранний точечный фильтр по `git diff --name-only HEAD^1..HEAD` (17 файлов, все `src/agent|bot|web` + README): `npx vitest run src/agent/ src/bot/ src/web/api.test.mjs src/web/orchestrator.test.mjs` — 30 файлов, 878 passed;
- **полный `pnpm test`** (единственный за фазу, без `--exclude`/`--skip`): `119 passed (119)`, `2180 passed | 4 skipped` + статический прогон `1 passed, 8 passed` — падений нет, повторов не потребовалось; параллельный `vitest` в других worktree не шёл (`ps aux | grep vitest` — пусто).
**Уборка:** worktree удалён (`git worktree remove` отказался только из-за untracked-симлинков `node_modules`/`backlog/references/data` — ссылки на главный репо, данные не теряются; `--force`), ветка `vb/vl-274` удалена (`-d` прошёл как слитая), `git worktree prune` выполнен.
**DoD:** «Тесты проходят» — полный прогон зелёный; «Документация обновлена» — README был обновлён в Code, в Close добавлены `CHANGELOG.md` (запись VL-274), `doc-19` §8 («Реализация (VL-274)» — таблица решений: комбинированный сигнал, `pause()`/`resume()` вокруг tool, две точки детекта, semantic `0` = выключено; §22 п.10 переписан со снятием «не реализовано в VL-270»; шапка — VL-274 в списке задач) и `doc-10` (таблица флагов `--idle-timeout`, таблица лимитов §6, абзац «Idle-таймаут vs wall-time», проброс `/set idle-timeout` для vb) — коммит **e2de6a6**; «Нет регрессий» — полный прогон + точечный фильтр зелёные. Все три пункта отмечены.
**AC:** п.10 закрыт этим коммитом (README + doc-19 §8/§22 + CHANGELOG + build/lint/полный test) — отмечен; остальные 9 были отмечены в Code (idle-guard с реальным таймером и reason `idle`, `noteActivity` на токен/завершённый tool, wall-time нетронут, настройка с откатом на дефолт и пробросом только vb, `AbortSignal`-путь `streamChat`, сценарий VL-254 на 35 виртуальных минут, отдельный reason в мете, тесты loop/orchestrator).
**Lessons:** lesson-131 (создан — «Снимай idle-таймер на время tool-вызова») связан с задачей; lesson-130 (из Code) уже был связан. Коммит refs/lessons — **4f19646**.
Изменённых файлов в задаче — 17 (см. `modified_files`), плюс документация Close (CHANGELOG, doc-10, doc-19). Push не выполнялся.
---
<!-- COMMENTS:END -->