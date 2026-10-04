---
id: VL-72
title: 'В шаблоне вывода по команде task (или итоговых ответах spec, plan, code)…'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-04 00:27'
updated_date: '2026-10-04 18:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.6
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
В шаблоне вывода по команде task (или итоговых ответах spec, plan, code) необходимо добавить кнопку (RichMessageButton), по нажатию на которую будет запущен следующий этап воркфлоу plan -> code -> close соответствующий текущему статусу этой задачи (аналог например /code VL-N). Кнопка действует как callback button (отправляет callback query). Кнопку лучше всего разместить после заголовка задачи.

## Уточнение (Фаза 1 Spec, 2026-10-04)

**Механизм кнопки (grammy 1.46.0 / @grammyjs/types 5.0.0, rich.d.ts):** в rich-сообщениях кнопки задаются HTML-тегом `<tg-button type="callback_data" data="...">текст</tg-button>` внутри markdown-поля InputRichMessage (для фич без markdown-синтаксиса — HTML-теги). callback_data — 1–64 байт, формат `next:<id>` (напр. next:VL-72). Обработчика callback_query в боте сейчас нет — он создаётся в этой задаче.

**Маппинг статус → следующая фаза** (фазы spec→plan→code→close через startPhase, шаблоны phase-1..phase-close; статусы из конфига: To Do, Spec, Planned, In Progress, Review, Done, Blocked):
- To Do → spec (phase-1, после — статус Spec)
- Spec → plan (phase-2, после — Planned)
- Planned → code (phase-3, после — Review)
- In Progress → code (ручной статус — продолжение реализации)
- Review → close (phase-close, после — Done)
- Done, Blocked → кнопка не показывается

**Реализация:**
1. `src/bot/rich.ts` — renderTaskRich: вставить `<tg-button type="callback_data" data="next:{{id}}">` сразу после заголовка (`# id — title`), текст кнопки — имя следующей фазы. Чистая функция, кнопка — часть markdown-строки.
2. `src/bot/handlers.ts` — новый `bot.on('callback_query')` (до catch-all message:text): requireBind → разбор callback_data → answerCallbackQuery (обязателен, иначе «часики» на кнопке) → getTask → маппинг статус→фаза → startPhase(cwd, task.id, phase, onExit с notifyPhaseDone — паттерн /plan,/code,/close) → подтверждение sendMd. Для Done/Blocked/неизвестного статуса — answerCallbackQuery с текстом «нет следующего этапа», без запуска.
3. Фолбэк MarkdownV2 (formatTaskDetail) кнопку не содержит — как и старые клиенты без rich; регрессии нет.

**Затронутые файлы:** src/bot/rich.ts, src/bot/handlers.ts, src/bot/rich.test.mjs (тест рендера кнопки + маппинга), docs/user-guide.md, CHANGELOG.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Кнопка следующего этапа есть в rich-выводе /task: renderTaskRich вставляет tg-button (callback_data next:<id>) сразу после заголовка; текст кнопки соответствует маппингу статус→фаза (To Do→spec, Spec→plan, Planned/In Progress→code, Review→close); для Done/Blocked кнопка не рендерится
- [x] #2 Обработчик bot.on('callback_query') в handlers.ts: requireBind → answerCallbackQuery (подтверждение нажатия) → startPhase нужной фазы с onExit-уведомлением notifyPhaseDone (паттерн /plan,/code,/close); для Done/Blocked/неизвестного статуса — answerCallbackQuery «нет следующего этапа» без запуска; обработчик регистрируется до catch-all message:text
- [x] #3 pnpm build и pnpm test проходят; в rich.test.mjs есть юнит-тесты рендера кнопки (после заголовка, data next:<id>, отсутствие для Done/Blocked); CHANGELOG.md и docs/user-guide.md обновлены (кнопка в /task, callback-флоу)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации: кнопка «следующий этап» в rich-выводе /task

Фича целиком укладывается в VL-72 — блокер не нужен.

### 1. src/bot/rich.ts — маппинг статус→фаза + кнопка в renderTaskRich

**1а. Новый экспорт `nextPhaseForStatus` (вставить перед JSDoc renderTaskRich, ~строка 60, до строки 65):**

```ts
/** Следующая фаза workflow для статуса задачи (VL-72). */
export type NextPhase = { phase: 'spec' | 'plan' | 'code' | 'close'; label: string };

/** Маппинг статус → следующая фаза (по умолчанию статусы из config.ts).
 *  Done/Blocked/неизвестные → null — фаза не запускается. */
export function nextPhaseForStatus(status: string): NextPhase | null {
  switch (status) {
    case 'To Do': return { phase: 'spec', label: 'Spec' };
    case 'Spec': return { phase: 'plan', label: 'Plan' };
    case 'Planned':
    case 'In Progress': return { phase: 'code', label: 'Code' };
    case 'Review': return { phase: 'close', label: 'Close' };
    default: return null;
  }
}
```

**1б. Кнопка после заголовка в renderTaskRich (строка 69: `parts.push(\`# ${task.id} — ${task.title}\n\`);` — вставить сразу после):**

```ts
  // VL-72: callback-кнопка следующего этапа — сразу после заголовка
  const next = nextPhaseForStatus(task.status);
  if (next) {
    parts.push(`<tg-button type="callback_data" data="next:${task.id}">${next.label}</tg-button>\n`);
  }
```

Формат тега — по @grammyjs/types 5.0.0 rich.d.ts (строка 169: `<tg-button type="callback_data" data="...">`). callback_data `next:VL-72` — 9 байт, в лимите 64.

Фолбэк formatTaskDetail (MarkdownV2, src/bot/formatting.ts) кнопку НЕ содержит — по регламенту VL-72 (старые клиенты, регрессии нет).

### 2. src/bot/handlers.ts — обработчик callback_query

**2а. Импорт (строка 21):** добавить `nextPhaseForStatus` в импорт из './rich.js':
`import { chunkRich, nextPhaseForStatus, renderPhaseResultRich, renderTaskRich } from './rich.js';`

**2б. Новый `bot.on('callback_query', …)` — вставить перед комментарием строки 498 («Ввод пина — ОБЯЗАТЕЛЬНО ПОСЛЕ ВСЕХ bot.command…»), т.е. после /restart и ДО catch-all `bot.on('message:text')` (строка 502):**

```ts
  // ── Кнопка «следующий этап» (VL-72) ──
  // callback-кнопка из rich-рендера карточки задачи: data = next:<id>.
  // Запускает фазу по маппингу статус→фаза (как /plan,/code,/close),
  // включая notifyPhaseDone. Регистрируется ДО catch-all message:text.
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery?.data ?? '';
    if (!data.startsWith('next:')) return; // чужие callback не трогаем
    const id = data.slice('next:'.length).trim();
    // answerCallbackQuery обязателен в любом исходе — иначе «часики» на кнопке
    if (!requireBind(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Бот не привязан к чату — выполните /start' }).catch(() => {});
      return;
    }
    const task = getTask(deps.cwd, id);
    const next = task ? nextPhaseForStatus(task.status) : null;
    if (!task || !next) {
      await ctx
        .answerCallbackQuery({
          text: !task ? `Задача ${id} не найдена.` : `Для статуса «${task.status}» нет следующего этапа.`,
        })
        .catch(() => {});
      return;
    }
    await ctx.answerCallbackQuery({ text: `🚀 Фаза ${next.label} запускается для ${task.id}` }).catch(() => {});
    // Колбэк завершения — паттерн /plan,/code,/close (VL-63): notifyPhaseDone
    const notifyChat = ctx.chat?.id;
    const onExit: PhaseExitCallback = (run) => {
      if (notifyChat === undefined) return;
      notifyPhaseDone(bot, notifyChat, task, run);
    };
    const result = startPhase(deps.cwd, task.id, next.phase, onExit);
    if ('error' in result) {
      await sendMd(ctx, '⚠️ ' + escapeMarkdownV2(result.error));
      return;
    }
    await sendMd(ctx, `🚀 Фаза ${next.label} запущена для *${task.id}*, PID ${result.pid}`);
  });
```

requireBind использует ctx.chat — для callback_query с кнопки на сообщении бота ctx.chat доступен (callbackQuery.message.chat). Все зависимости (getTask, startPhase, notifyPhaseDone, sendMd, escapeMarkdownV2, PhaseExitCallback) уже импортированы в файле.

### 3. src/bot/rich.test.mjs — юнит-тесты

**3а. Импорт (строка 8):** добавить `nextPhaseForStatus` в импорт из '../../dist/bot/rich.js'.

**3б. Новый describe «Кнопка следующего этапа (VL-72)» — вставить после describe('renderTaskRich …') (после строки 100):**

- кнопка есть и стоит сразу после заголовка: для `{...fullTask, status: 'To Do'}` — `assert.match(md, /^# VL-34 — Telegram-бот: каркас\n\n<tg-button type="callback_data" data="next:VL-34">Спецификация<\/tg-button>/)` — тексты кнопок: Spec/Plan/Code/Close (по маппингу);
- маппинг через nextPhaseForStatus: To Do→{spec,'Spec'}, Spec→{plan,'Plan'}, Planned→{code,'Code'}, In Progress→{code,'Code'}, Review→{close,'Close'};
- Done и Blocked → кнопки нет: `assert.doesNotMatch(md, /tg-button/)` (статусы из fullTask: Done; отдельно Blocked);
- неизвестный статус ('QA') → null и нет кнопки.

Существующие тесты не ломаются: fullTask имеет status 'Done' — кнопка для Done не рендерится, все текущие assert остаются валидными.

### 4. Документация

**4а. CHANGELOG.md — секция [Unreleased] → «Добавлено», добавить после строки 21 (после VL-70):**

`- **VL-72: кнопка «следующий этап» в rich-выводе /task** — в карточке задачи (renderTaskRich) сразу после заголовка появляется callback-кнопка (tg-button, data next:<id>), запускающая следующую фазу workflow по статусу: To Do→Spec, Spec→Plan, Planned/In Progress→Code, Review→Close; для Done/Blocked кнопка не показывается. Новый обработчик bot.on('callback_query') в handlers.ts: requireBind → answerCallbackQuery → startPhase с notifyPhaseDone (паттерн /plan,/code,/close). Фолбэк MarkdownV2 кнопку не содержит.`

**4б. docs/user-guide.md — раздел 11 «Telegram-бот», вставить новый подраздел «### Кнопка следующего этапа (VL-72)» между концом подраздела «Фазы через qwen» (строка ~299, перед строкой 302 «### Самоперезапуск /restart»):** — таблица маппинга статус→кнопка/фаза + примечание: кнопка только в rich-рендере (/task и карточка после фазы), Done/Blocked — без кнопки, MarkdownV2-фолбэк без кнопки.

### 5. Порядок действий

1. rich.ts (1а, 1б).
2. handlers.ts (2а, 2б).
3. rich.test.mjs (3а, 3б).
4. pnpm build.
5. node --test src/bot/rich.test.mjs.
6. CHANGELOG.md (4а), docs/user-guide.md (4б).
7. pnpm test (полный прогон).

### 6. Проверка

- `pnpm build` — tsc без ошибок (strict).
- `node --test src/bot/rich.test.mjs` — новые тесты зелёные, старые не упали.
- `pnpm test` — полный набор (build + node --test src).
- Ручной smoke (после pnpm build + vibelog bot): /task <id> со статусом To Do — кнопка видна сразу после заголовка; нажатие — запускается Фаза Spec, приходит уведомление фазы; /task задачи в Done — кнопки нет.

### 7. Риски

- **Отсутствие обработчика callback_query в старых версиях бота:** после деплоя старый процесс не обрабатывает нажатия — кнопка «часики». Снимается /restart (VL-70) после pnpm build.
- **answerCallbackQuery обязателен во всех ветках** — при ошибке без него Telegram показывает бесконечные «часики»; в коде все ответы через .catch(() => {}), чтобы устаревший callback не ронял хендлер.
- **chunkRich может разрезать кнопку по кускам** — практически исключено (кнопка в первом абзаце, разрез по границам абзацев); при гигантской задаче части ≥ половины лимита.
- **Кастомные статусы конфига** — маппинг фиксированный (как в спеке); статус вне списка → кнопки нет / «нет следующего этапа», фаза не запускается — безопасно.
- **Чужие callback_data** (другие боты/кнопки в чате) — обработчик пропускает всё, что не начинается с `next:`, не отвечая (не гасит чужие callback).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-04 00:35
---
Фаза 1 (Spec) выполнена. Тип: task.
Краткое описание уточнения: фича укладывается в одну задачу — кнопка запуска следующего этапа воркфлоу в rich-выводе /task. Уточнены детали по результатам исследования кода:
- **Механизм кнопки**: grammy 1.46.0 / @grammyjs/types 5.0.0 — в rich-сообщениях кнопки задаются HTML-тегом `<tg-button type="callback_data" data="next:<id>">` внутри markdown-поля InputRichMessage (rich.d.ts, «для фич без markdown-синтаксиса — HTML-теги»). callback_data — 1–64 байт. Обработчика callback_query в боте сейчас нет — он создаётся в этой задаче (bot.on('callback_query') до catch-all).
- **Маппинг статус→фаза** (статусы из src/core/config.ts: To Do, Spec, Planned, In Progress, Review, Done, Blocked): To Do→spec, Spec→plan, Planned/In Progress→code, Review→close; Done/Blocked — кнопка не показывается. Фазы запускаются через startPhase с onExit notifyPhaseDone — тот же паттерн, что у /plan,/code,/close в handlers.ts.
- **Размещение**: сразу после заголовка `# id — title` в renderTaskRich (src/bot/rich.ts) — по формулировке задачи «лучше всего после заголовка». Кнопка — часть markdown-строки чистой функции, фолбэк MarkdownV2 (formatTaskDetail) её не содержит, регрессии нет.
- **Затронутые файлы**: src/bot/rich.ts (кнопка в renderTaskRich), src/bot/handlers.ts (callback_query-хендлер), src/bot/rich.test.mjs (тесты), CHANGELOG.md, docs/user-guide.md.
Установлен type=task, добавлены 3 критерия приёмки.
---
author: @agent
created: 2026-10-04 16:35
---
Фаза 2 (Plan) выполнена. Тип: task — план записан в задачу, блокер не создавался.
**Исследование (факты, подтверждённые по коду):**
- renderTaskRich (src/bot/rich.ts:65-108) — чистая функция, заголовок вставляется на строке 69 (`parts.push(\`# ${task.id} — ${task.title}\n\`)`). Кнопка вставляется сразу после — маркер `<tg-button type="callback_data" data="next:<id>">` подтверждён в @grammyjs/types 5.0.0 rich.d.ts (строка 169).
- handlers.ts (518 строк): паттерн /plan,/code,/close — getTask → onExit notifyPhaseDone → startPhase(cwd, id, phase, onExit) → sendMd-подтверждение; catch-all bot.on('message:text') на строке 502 — callback_query регистрируется перед ним (строка 498 — комментарий «Ввод пина…»). Все зависимости хендлера уже импортированы (getTask, startPhase, notifyPhaseDone, sendMd, escapeMarkdownV2, PhaseExitCallback).
- Статусы из src/core/config.ts:32: To Do, Spec, Planned, In Progress, Review, Done, Blocked — маппинг из спеки покрывает их полностью.
**План (5 файлов, 7 шагов):**
1. rich.ts: экспорт nextPhaseForStatus (To Do→spec, Spec→plan, Planned/In Progress→code, Review→close, иначе null) + кнопка после заголовка в renderTaskRich.
2. handlers.ts: импорт nextPhaseForStatus + bot.on('callback_query') перед catch-all: requireBind → answerCallbackQuery (все ветки, .catch) → getTask → маппинг → startPhase с notifyPhaseDone; для Done/Blocked/неизвестного — «нет следующего этапа».
3. rich.test.mjs: 6+ кейсов — кнопка после заголовка с data next:<id>, маппинг всех статусов, отсутствие для Done/Blocked/неизвестного.
4. pnpm build → node --test src/bot/rich.test.mjs → CHANGELOG.md + docs/user-guide.md → pnpm test.
5. Smoke: /task задачи To Do — кнопка и запуск Spec по нажатию.
**Риски:** старый процесс бота не обрабатывает callback (снимается /restart после build); answerCallbackQuery обязателен во всех ветках (иначе «часики»); chunkRich теоретически может разрезать кнопку (практически исключено — первый абзац); кастомные статусы → кнопки нет, фаза не запускается (безопасно).
Статус не меняю — план ждёт одобрения (Фаза 3 — /code VL-72).
---
author: @agent
created: 2026-10-04 16:42
---
Фаза 3 (Code) выполнена.
**Изменено (5 файлов):**
- `src/bot/rich.ts` — новый экспорт `nextPhaseForStatus` (маппинг статус→фаза: To Do→spec, Spec→plan, Planned/In Progress→code, Review→close; Done/Blocked/неизвестные → null) + callback-кнопка `<tg-button type="callback_data" data="next:<id>">` в `renderTaskRich` сразу после заголовка (рендерится только если маппинг не null).
- `src/bot/handlers.ts` — импорт `nextPhaseForStatus` + новый `bot.on('callback_query')` ЗАРЕГИСТРИРОВАН ДО catch-all `message:text` (между /restart и вводом пина): фильтр `next:` → requireBind → answerCallbackQuery во всех ветках (.catch, иначе «часики») → getTask → маппинг → `startPhase` с `onExit` = notifyPhaseDone (паттерн /plan,/code,/close); для Done/Blocked/неизвестного статуса и ненайденной задачи — answerCallbackQuery «нет следующего этапа» без запуска.
- `src/bot/rich.test.mjs` — импорт `nextPhaseForStatus` + describe «Кнопка следующего этапа (VL-72)»: 3 теста — кнопка сразу после заголовка с data next:<id>, маппинг всех статусов (включая null для Done/Blocked/QA), отсутствие кнопки для Done/Blocked/неизвестного.
- `CHANGELOG.md` — пункт VL-72 в [Unreleased] → Добавлено.
- `docs/user-guide.md` — подраздел «Кнопка следующего этапа (VL-72)» в разделе 11 (таблица маппинга статус→кнопка/фаза + описание callback-флоу).
**Проверки:** `pnpm build` OK (tsc strict, 0 ошибок); `node --test src/bot/rich.test.mjs` — 17/17; полный `pnpm test` — **449/449 pass, 0 fail**.
**Соответствие плану Фазы 2:** реализация дословно по плану (пункты 1-4: rich.ts, handlers.ts, rich.test.mjs, документация). Фолбэк MarkdownV2 (`formatTaskDetail`) кнопку не содержит — по регламенту задачи.
**Что осталось:** ручной smoke в реальном чате (задача в статусе To Do: /task → кнопка видна, нажатие запускает Spec; /restart после деплоя — чтобы бот поднял свежий dist/ с обработчиком callback_query). Smoke не выполнялся — headless-окружение, статус бота/привязки чата недоступны из этой сессии.
---
author: @agent
created: 2026-10-04 16:48
---
Фаза Close выполнена. Статус: Done. Коммит feat: 6fed26a — «VL-72 — кнопка «следующий этап» в rich-выводе /task (callback-запуск фазы по статусу)» (5 файлов: src/bot/rich.ts, src/bot/handlers.ts, src/bot/rich.test.mjs, CHANGELOG.md, docs/user-guide.md).
---
<!-- COMMENTS:END -->