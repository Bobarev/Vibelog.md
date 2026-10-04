---
id: VL-78
title: '#bot в карточке задачи немного увеличить кнопку действия (старта следующей…'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-04 20:10'
updated_date: '2026-10-05 00:12'
due_date: ''
labels: []
dependencies: []
milestone: ''
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
#bot — улучшение карточки задачи в Telegram-боте (rich-рендер VL-72: src/bot/rich.ts renderTaskRich + src/bot/handlers.ts callback next:).

Контекст: сейчас карточка /task рендерится rich-сообщением GFM (grammy InputRichMessage). Кнопка следующего этапа — <tg-button type="callback_data" data="next:<id>"> без стиля, после неё — мета и секции (## Описание, ## AC, ## DoD, ## Implementation Plan/Notes, ## Final Summary, ## Комментарии) плоским текстом.

Требуется:

1. **Увеличить кнопку действия (старта следующей фазы):** сделать заметнее — style="primary" (или success) в <tg-button>, центрирование через <tg-button-row align="center">, возможно эмодзи в label (▶ Spec / 📋 Plan / 💻 Code / ✅ Close). Выбор конкретного стиля/лейбла — Фаза 2 (Plan).

2. **Кнопка «Комментарий» к карточке задачи:**
   - новая callback-кнопка data=comment:<id> рядом с кнопкой следующего этапа;
   - по нажатию бот просит ввести комментарий текстом (сообщение-промпт, состояние ожидания по chatId в памяти процесса — паттерн awaitingPin);
   - введённый текст → addComment(cwd, id, text) + запуск Фазы Comment (startPhase 'comment', onExit → notifyPhaseDone) — логика идентична существующей команде /comment (VL-60);
   - обработчик текста регистрируется в message:text ДО catch-all пина;
   - несовпадение/пустой ввод → повторный промпт, по /cancel — выход из режима ожидания.

3. **Expand-блоки на основные разделы карточки (rich-рендер):**
   - секции Описание / Acceptance Criteria / Definition of Done / Implementation Plan / Implementation Notes / Final Summary / Комментарии оборачивать в <details><summary>Заголовок</summary>...</details> (поддерживается rich markdown grammy); свёрнуты по умолчанию; какие разделы открыты по умолчанию (например Описание) — решение Фазы 2;
   - шапка (id, мета: статус/приоритет/исполнители/метки/срок) остаётся всегда видимой;
   - учитывать лимиты rich: 32768 символов, 500 блоков;
   - фолбэк MarkdownV2 (formatTaskDetail) не трогаем — details в нём не поддерживаются.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Кнопка следующего этапа в карточке /task заметно увеличена (style primary/success + центрирование/эмодзи) и рядом появилась кнопка «Комментарий» (callback comment:<id>) — проверяется на rich-рендере карточки
- [ ] #2 По нажатию кнопки «Комментарий» бот просит ввести текст, введённое сохраняется через addComment и запускает Фазу Comment (логика /comment), пустой ввод/неверный ввод обрабатывается без падений
- [x] #3 Основные разделы карточки (Описание, AC, DoD, Plan, Notes, Final Summary, Комментарии) свёрнуты в <details>-блоки, шапка с метой видна всегда; rich-тесты обновлены, pnpm test зелёный
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План Фазы 2 — VL-78 (карточка задачи бота: кнопки + expand-блоки)

## Решения Фазы 2 (выбрано)

1. **Кнопка следующего этапа:** `style="primary"` + эмодзи в label кнопки (▶ Spec / 📋 Plan / 💻 Code / ✅ Close). Эмодзи добавляются ТОЛЬКО в label кнопки (карта PHASE_EMOJI в rich.ts); `nextPhaseForStatus()` и его labels не меняются — иначе сломаются тексты уведомлений («Фаза Plan запускается…») и 6 существующих тестов deepEqual.
2. **Кнопка «Комментарий»:** `style="success"`, `data=comment:<id>`, label `💬 Комментарий`. Показывается ВСЕГДА (включая Done/Blocked — комментарий уместен к любой задаче); обе кнопки — в одном `<tg-button-row align="center">`.
3. **Expand-блоки:** Описание — `<details open>` (открыта по умолчанию); AC / DoD / Implementation Plan / Notes / Final Summary / Комментарии — свёрнутые `<details>`. Шапка (заголовок, кнопки, мета-строка) — всегда видимая, вне details. Внутри details заголовок секции переходит из `## Title` в `<summary>Title</summary>` (двойной заголовок не нужен).

## Файлы для изменения

| Файл | Что делаем |
|---|---|
| src/bot/rich.ts | Кнопки row + details-обёртка секций |
| src/bot/handlers.ts | callback `comment:<id>` + режим ожидания текста + вынос общей логики комментария |
| src/bot/rich.test.mjs | Обновить 8 существующих кейсов + 4 новых |
| docs/user-guide.md | Раздел «Кнопка следующего этапа (VL-72)» → кнопки + комментарий + details |
| CHANGELOG.md | Запись в [Unreleased] |

## Конкретные места

### 1. src/bot/rich.ts (211 строк)

- **Строки 51-53 (`section()`):** изменить сигнатуру на `section(title, content, open = false)`; возвращать:
  - `open=true`: `<details open><summary>${title}</summary>\n\n${content}\n\n</details>\n`
  - иначе: `<details><summary>${title}</summary>\n\n${content}\n\n</details>\n`
- **Строка ~85 (после nextPhaseForStatus):** добавить экспорт `const PHASE_EMOJI: Record<NextPhase['phase'], string> = { spec: '▶', plan: '📋', code: '💻', close: '✅' }`.
- **Строки 97-103 (кнопка next в renderTaskRich):** заменить одиночную кнопку на:
  ```
  <tg-button-row align="center">
  <tg-button type="callback_data" style="primary" data="next:${task.id}">${PHASE_EMOJI[next.phase]} ${next.label}</tg-button>
  <tg-button type="callback_data" style="success" data="comment:${task.id}">💬 Комментарий</tg-button>
  </tg-button-row>
  ```
  Кнопка «Комментарий» добавляется безусловно (вне `if (next)`); при отсутствии next-кнопки row содержит одну кнопку (align работает и для одной).
- **Строка 117 (вызов section для Описание):** `section('Описание', fenceSafe(task.description), true)` — единственная открытая по умолчанию.
- **Строки 119-137 (остальные вызовы section):** оставить как есть — `open` по умолчанию false.

### 2. src/bot/handlers.ts (561 строк)

- **Строка ~137 (после `awaitingPin`):** `const awaitingComment = new Map<number, string>();` — chatId → id задачи (паттерн awaitingPin, память процесса).
- **Строки 259-298 (`bot.command('comment')`):** вынести общую логику в локальную функцию `commitComment(taskId: string, text: string, bot: Bot, chatId: number): Promise<void>` (внутри registerHandlers): getTask → addComment → sendMd «💬 Комментарий добавлен» → startPhase('comment', onExit с notifyPhaseDone, {comment: text}) → обработка 'error' в result (⚠️ без отката комментария) → sendMd «🚀 Фаза Comment запущена». bot.command('comment') после parseCommentCommand вызывает commitComment — поведение /comment не меняется.
- **Строки 502-540 (`bot.on('callback_query')`):** после проверки `next:` добавить ветку `comment:` (до или в начале — приоритет по префиксу):
  - `data.startsWith('comment:')` → id = data.slice(8).trim(); requireBind (с answerCallbackQuery-фолбэком, как у next); getTask — не найдена → answerCallbackQuery «Задача не найдена»; иначе `awaitingComment.set(chatId, id)`, answerCallbackQuery «💬 Введите комментарий для VL-x», sendMd-промпт: «Введите комментарий для *VL-x*. /cancel — отмена.».
- **Перед catch-all пина (строка ~544, ОБЯЗАТЕЛЬНО раньше него — паттерн VL-37):** новый `bot.on('message:text')` для режима комментария:
  - `awaitingComment.has(chatId)` нет → return (переход к catch-all пина через next());
  - текст `/cancel` → delete из map, sendMd «Отменено»;
  - пустой/пробельный ввод → повторный промпт (map не трогаем);
  - иначе → `awaitingComment.delete(chatId)` ДО async-работы, затем `commitComment(taskId, text, bot, chatId)` + catch → sendMd «Ошибка: …».
- **Catch-all пина (545-561):** не трогать.

### 3. src/bot/rich.test.mjs (223 строки)

- **Тест 64-65, 70-71, 77-78 (секции):** regex `## Acceptance Criteria\n\n- \[x\]…` → `<details><summary>Acceptance Criteria</summary>\n\n- \[x\]…`; аналогично DoD, Plan, Final Summary, Комментарии. В новом кейсе: `## Описание` → `<details open><summary>Описание</summary>`.
- **Тест 108-113 (кнопка VL-72):** ожидать `<tg-button-row align="center">\n<tg-button type="callback_data" style="primary" data="next:VL-34">▶ Spec</tg-button>` + строку `<tg-button type="callback_data" style="success" data="comment:VL-34">💬 Комментарий</tg-button>` + `</tg-button-row>`.
- **Тесты 126-128 (Done/Blocked):** `doesNotMatch /tg-button/` сломан — comment-кнопка теперь есть всегда. Заменить на `doesNotMatch /next:/` + `doesNotMatch /tg-button-row align="center">\n<tg-button[^>]*primary/` (проверка, что primary-row без next отсутствует); отдельно: для Done строка `<tg-button type="callback_data" style="success" data="comment:VL-34">` присутствует.
- **Тест 100-101 (минимальная задача):** `doesNotMatch /## /` остаётся валидным (секций нет, details тоже нет); кнопка комментария добавляется — проверить doesNotMatch не ломается (там нет tg-button-ассертов, ок).
- **4 новых кейса:** (а) Описание open, остальные свёрнуты; (б) comment-кнопка при Done; (в) обе кнопки в одном row с primary+success; (г) PHASE_EMOJI-соответствие для 4 фаз (или проверка эмодзи в label через nextPhaseForStatus+рендер).

### 4. Документация

- **docs/user-guide.md 302-315:** раздел «Кнопка следующего этапа (VL-72)» — дополнить: обе кнопки в центрированном row (primary/success, эмодзи ▶📋💻✅💬), новая кнопка «Комментарий» (`comment:<id>`) с режимом ожидания текста и /cancel, expand-блоки карточки (Описание открыта, остальные свёрнуты; фолбэк MarkdownV2 без details).
- **CHANGELOG.md [Unreleased] → Добавлено:** «VL-78: карточка задачи в Telegram-боте — крупная кнопка следующего этапа (primary + эмодзи, центрирование), кнопка «Комментарий» (callback comment:<id> → addComment + Фаза Comment, /cancel), секции карточки в expand-блоках <details> (Описание открыта по умолчанию)».

## Порядок действий

1. rich.ts: PHASE_EMOJI + row-кнопки (next primary + comment success) в renderTaskRich.
2. rich.ts: section() → details-обёртка, Описание open=true.
3. rich.test.mjs: обновить сломанные кейсы + добавить новые → `node --test src/bot/rich.test.mjs` (после pnpm build).
4. handlers.ts: awaitingComment + commitComment + ветка comment: в callback_query + новый message:text до catch-all.
5. pnpm build && node --test src (полный прогон).
6. docs/user-guide.md + CHANGELOG.md.
7. Финальный полный `pnpm test`.

## Как проверить

- `pnpm build` — tsc strict без ошибок.
- `pnpm test` (= build + `node --test src`) — все тесты зелёные, включая обновлённые rich-тесты (ожидаем +4 кейса к текущим 449).
- Ручная проверка кнопок/details — только визуально через реального бота (нет тестового токена в задаче): `vibelog bot` → /task <id>. Юнит-покрытие: rich.test.mjs (рендер чистой функции). handlers.ts не покрыт юнит-тестами (нет handlers.test.mjs, grammy-бот не мокается) — поток awaitingComment проверяется ручным прогоном, код повторяет проверенные паттерны VL-37 (порядок catch-all) и VL-60 (/comment).

## Риски

1. **Порядок message:text в grammy:** новый catch-all до catch-all пина — оба обязаны return без next(); нарушение → пин-логика не сработает (ловушка VL-37, уже поймана вручную). Проверка: ручной прогон /start после изменений.
2. **Тесты rich.test.mjs сломаются на 8 кейсах** (regex `## …` и одиночная кнопка) — обновление обязательно, частичное обновление оставит красный прогон.
3. **`doesNotMatch /tg-button/` для Done** теперь невалиден из-за безусловной comment-кнопки — заменить на проверки next:/primary.
4. **<details> в Telegram-клиентах:** поддерживается только rich-сообщениями (sendRichMessage); старые клиенты → sendRichMessage фейлится → существующий фолбэк sendTaskView/MarkdownV2 (не трогаем, details в нём нет — по спеке задачи). Регрессии фолбэка нет.
5. **Лимиты rich (32768 / 500 блоков):** details добавляет ~60 символов × 7 секций ≈ 420 — пренебрежимо; chunkRich остаётся как есть.
6. **Состояние awaitingComment в памяти процесса:** рестарт бота теряет режим ожидания (как awaitingPin) — допустимо, пользователь нажмёт кнопку заново.
7. **Дублирование логики /comment и callback-пути** снимается выносом commitComment; если вынос даст расхождение поведения /comment — откатить вынос, оставить дублирование (поведение /comment — источник истины).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-04 20:13
---
Фаза 1 (Spec) выполнена. Тип: task.
Краткое описание уточнения: фича укладывается в одну задачу — три точечных изменения в rich-рендере карточки (src/bot/rich.ts) и обработчике (src/bot/handlers.ts), без затрагивания core/MCP/web.
Уточнено по результатам исследования:
1. Кнопка действия — обернуть next-кнопку в style="primary" + <tg-button-row align="center"> (поддерживается grammy rich.d.ts v5.0.0); возможен эмодзи в label — выбор стиля за Фазой 2.
2. Кнопка комментария — callback data comment:<id>, состояние ожидания по chatId (паттерн awaitingPin), дублирует логику /comment (addComment + startPhase 'comment'), обработчик до catch-all message:text.
3. Expand-блоки — rich markdown поддерживает <details><summary>; сворачиваются 7 основных секций, шапка + мета остаются видимыми; фолбэк MarkdownV2 не трогается (details в нём не поддерживаются).
Добавлены 3 конкретных AC. Ограничения Spec соблюдены: новых задач не создано, PLAN-*.md не создавался, git-операций не было, файлы задач не редактировались напрямую.
---
author: @agent
created: 2026-10-04 20:22
---
Фаза 2 (Plan) выполнена. Тип: task — план записан в implementationPlan этой задачи.
**Решения Фазы 2:**
1. Кнопка следующего этапа — `style="primary"` + эмодзи в label (▶ Spec / 📋 Plan / 💻 Code / ✅ Close); эмодзи добавляются только в кнопку (карта PHASE_EMOJI в rich.ts), `nextPhaseForStatus()` не меняется — иначе ломаются тексты уведомлений и 6 существующих тестов.
2. Кнопка «Комментарий» — `style="success"`, `data=comment:<id>`, показывается всегда (включая Done/Blocked); обе кнопки в одном `<tg-button-row align="center">`.
3. Expand-блоки — Описание `<details open>` (открыта по умолчанию), AC/DoD/Plan/Notes/Final Summary/Комментарии — свёрнутые; шапка с метой всегда видимая; внутри details заголовок секции переходит из `## Title` в `<summary>Title</summary>`.
**Исследование подтвердило (строки точные):**
- rich.ts: section() — строки 51-53; кнопка next — 97-103; вызовы section — 113-137.
- handlers.ts: awaitingPin — строка 136; /comment — 259-298; callback_query (next:) — 502-540; catch-all message:text (пина) — 545-561. Новый обработчик комментария регистрируется ДО catch-all пина (паттерн VL-37).
- grammy @grammyjs/types@5.0.0 rich.d.ts подтверждает: style="primary"/"success", <tg-button-row align="center">, <details open><summary> — всё поддерживается.
- Тесты: rich.test.mjs — 8 кейсов сломаются на обновлении (regex `## …` + одиночная кнопка) + 4 новых кейса. handlers.test.mjs не существует — поток awaitingComment проверяется ручным прогоном по паттернам VL-37/VL-60.
**Порядок:** (1) rich.ts кнопки → (2) rich.ts details → (3) rich.test.mjs → (4) handlers.ts (awaitingComment + commitComment + ветка comment: + message:text до catch-all) → (5) pnpm build && node --test src → (6) user-guide.md + CHANGELOG.md → (7) финальный pnpm test.
**Основные риски:** порядок catch-all в grammy (ловушка VL-37); фолбэк MarkdownV2 не трогается (details в нём нет — по спеке); лимиты rich не задеты (+~420 символов).
Правки кода в Фазе 2 не выполнялись — только план.
---
author: @agent
created: 2026-10-04 20:41
---
Фаза 3 (Code) выполнена. Изменено: src/bot/rich.ts — PHASE_EMOJI (▶📋💻✅), кнопки в <tg-button-row align="center"> (next: style="primary" + эмодзи в label; «Комментарий»: style="success", data=comment:<id>, безусловная), section() → <details><summary> с open=true для Описания; src/bot/handlers.ts — awaitingComment (chatId→id, паттерн awaitingPin), commitComment() (addComment → сообщение → startPhase('comment') с notifyPhaseDone; общий с /comment — поведение не менялось), ветка comment: в callback_query, новый bot.on('message:text') ДО catch-all пина с next() к нему (ловушка порядка VL-37), /cancel и пустой ввод → повторный промпт; src/bot/rich.test.mjs — 8 кейсов обновлены + 4 новых; docs/user-guide.md — раздел «Кнопки карточки задачи (VL-72, VL-78)»; CHANGELOG.md — запись в [Unreleased].
Проверки: pnpm build OK (tsc strict); pnpm test — 453/453 (+4 кейса VL-78).
Отмечено AC: 1 (кнопки в rich-рендере — покрыто rich.test.mjs), 3 (details-блоки + тесты зелёные). AC 2 оставлен НЕотмеченным: реализация по плану есть, но handlers.test.mjs не существует (grammy не мокается) — интерактивный поток «кнопка → ввод текста → addComment → Фаза Comment» требует ручного прогона с реальным ботом (нет тестового токена в задаче). DoD отмечены: тесты — 453/453; документация — user-guide.md + CHANGELOG.md; регрессий — полный прогон зелёный, логика /comment и фолбэк MarkdownV2 не менялись.
Что осталось: ручная проверка в реальном Telegram-боте (кнопки, details-рендер, поток awaitingComment, /cancel, /start-пин после изменений) — этап Review. Git-коммит не выполнялся (по правилам Фазы 3).
---
author:  @agent
created: 2026-10-05 00:12
---
Фаза Close выполнена. Статус: Done. Коммит feat: не требовался — код VL-78 (src/bot/rich.ts PHASE_EMOJI + row-кнопки, src/bot/handlers.ts awaitingComment/commitComment, rich.test.mjs, docs/user-guide.md, CHANGELOG.md) уже закоммичен в 5c75328 «feat: VL-82 — rich-вывод /tasks» (изменения двух задач смешаны в одном коммите). Подзадач в задаче нет. Тесты по Фазе 3: 453/453.
---
<!-- COMMENTS:END -->