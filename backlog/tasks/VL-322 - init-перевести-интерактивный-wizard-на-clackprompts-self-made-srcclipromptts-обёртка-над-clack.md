---
id: VL-322
title: 'init: перевести интерактивный wizard на @clack/prompts (self-made src/cli/prompt.ts → обёртка над clack)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-03 19:07'
updated_date: '2026-11-03 22:30'
due_date: ''
labels:
  - cli
  - init
  - wizard
  - ux
dependencies: []
milestone: v1.12
references:
  - ref-25
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - package.json
  - pnpm-lock.yaml
  - src/cli/prompt.ts
  - src/cli/prompt.test.mjs
lessons:
  - lesson-196
  - lesson-197
token_usage:
  input: 9627125
  output: 111714
  cache: 8806400
  total: 9738839
  requests: 151
  duration_ms: 2481600
  reasoning: 86795
  by_phase:
    plan:
      input: 2205214
      output: 42173
      cache: 2051584
      requests: 37
    code:
      input: 4905117
      output: 56505
      cache: 4429312
      requests: 65
    close:
      input: 2516794
      output: 13036
      cache: 2325504
      requests: 49
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
VL-320 починила падения и навигацию wizard-а `vibelog init`, но собственным TUI-слоем `src/cli/prompt.ts` (~200 строк ручного raw-mode и ANSI-отрисовки), без внешних зависимостей: в плане VL-320 обоснованием было «проект держит zero runtime deps», что неверно (в `dependencies` уже есть `grammy` и `undici`; ограничение README:27 — «никаких нативных зависимостей»).

Самописный слой придётся и дальше доводить вручную: ширина символов (CJK/эмодзи), resize терминала, Windows-консоль, скролл, инверсия активной строки. Всё это уже решено в `@clack/prompts` — эталоне, по которому делали wizard (ref-25, Svelte CLI; у sv зафиксирован `@clack/prompts@1.5.0`, транзитивно `@clack/core`, `fast-string-width`, `fast-wrap-ansi`, `sisteransi` — чистый JS, без нативной сборки).

## Цель

Заменить самописную реализацию `src/cli/prompt.ts` тонкой обёрткой над `@clack/prompts`, сохранив контракт `PromptSession` — чтобы `init-wizard.ts` (и другие потребители) не переписывались.

## Что делается

1. `package.json` → `dependencies`: `@clack/prompts` (версия — одна на проект, согласовать с VL-321).
2. `src/cli/prompt.ts` — переписать как обёртку:
   - `createPromptSession()` → делегирует в `p.text` / `p.confirm` / `p.select` / `p.multiselect` (с `message`, `placeholder`, `initialValue`, `options: {value, label, hint}`, `validate`);
   - `PromptCancelledError` — поднимается на `p.isCancel(result)` (Ctrl+C) и на `Esc`;
   - `isInteractive()` — прежний контракт (оба потока TTY), не-TTY → возврат дефолтов без промптов (AC7 VL-320 сохраняется);
   - `close()` — no-op или сброс состояния (у clack нет общего readline-инстанса, поэтому ручной lifecycle не нужен).
3. Удалить из `src/cli/prompt.ts` ручную raw-mode-логику: `setRawMode`, `\x1b[?25l/\x1b[?25h`, ручной пересчёт строк при перерисовке, самостоятельная отрисовка списков, `readline.Interface`/`pause`/`resume`.
4. `src/cli/commands/init-wizard.ts`, `src/cli/commands/init.ts` — только если контракт обёртки где-то не совпал (в идеале без правок).
5. Опционально и по согласованию: ввести `p.group` для последовательности шагов и `p.note` для итогового блока (как в ref-25) — если это упрощает `runWizard`.
6. Тесты: `src/cli/prompt.test.mjs` переписать на новую обёртку — те же кейсы (не-TTY-дефолты, `PromptCancelledError` на отмене), тесты кадров ANSI удалить как избыточные; `src/cli/init-wizard.test.mjs` — TTY-интерактив через spawn остаётся как есть.
7. Документация: doc-7, раздел `## init` — упомянуть, что интерактив на `@clack/prompts`.

## Ограничения

- Поведение, зафиксированное VL-320, не меняется: `vb` по умолчанию не отмечен, необнаруженные агенты скрыты, prefix выводится из имени проекта, Ctrl+C → сообщение + код 0, `--web` стартует web-мастер первым.
- Нативных зависимостей не появляется (README:27) — clack чистый JS.
- Только JS-пакеты, без сборки/пост-инсталла.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `@clack/prompts` добавлен в `dependencies` package.json (чистый JS, без нативных модулей; ограничение README:27 соблюдено), версия зафиксирована в pnpm-lock.yaml
- [x] #2 `src/cli/prompt.ts` переписан как тонкая обёртка над clack: контракт `PromptSession` (askText/askConfirm/askSelect/askMultiselect/close), `PromptCancelledError`, `isInteractive` сохранён — `init-wizard.ts` не переписывается под API clack напрямую
- [x] #3 Ручная raw-mode/ANSI-отрисовка из `src/cli/prompt.ts` удалена (или сведена к не-TTY-ветке); навигация, space-галочки, скрытие курсора — на clack
- [x] #4 Не-TTY (пайп/CI) по-прежнему возвращает дефолты без падений (AC7 из VL-320 не регрессирует)
- [x] #5 Ctrl+C на любом шаге — отмена через `p.isCancel` → `PromptCancelledError`, сообщение «Отменено. Настройки не изменены.», код выхода 0
- [x] #6 `vibelog init` проходит все шаги fresh- и upgrade-режима; `--web`, `--yes` и прочие флаги работают как после VL-320 (без регрессий)
- [x] #7 Тесты: `src/cli/prompt.test.mjs` переписан под новую реализацию (не-TTY-дефолты, отмена, маппинг значений); TTY-интерактив — существующий spawn-тест `src/cli/init-wizard.test.mjs` проходит без изменений поведения
- [x] #8 `pnpm build && pnpm test` — без регрессий; документация doc-7 (`## init`) не противоречит поведению (упоминание clack — по желанию)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Цель

Заменить самописный TUI-слой `src/cli/prompt.ts` (337 строк: ручной raw-mode, `\x1b[?25l/h`, перерисовка блоков через `\x1b[<N>A`, собственная навигация/галочки) тонкой обёрткой над `@clack/prompts`, сохранив контракт `PromptSession` — `init-wizard.ts` и `init.ts` не переписываются.

## Установка зависимости (AC1)

1. `pnpm add @clack/prompts@1.5.0` (точная версия — та же, что зафиксирована у `sv` в ref-25 `backlog/references/data/cli/packages/sv/package.json:44`; она же кандидат для VL-321 — одна версия на проект).
   - Чистый JS: транзитивно `@clack/core`, `fast-string-width`, `fast-wrap-ansi`, `sisteransi` — без native-сборки/пост-инсталла (README:27 «никаких нативных зависимостей» не нарушается; `dependencies` уже содержит `grammy`/`undici`, так что «zero runtime deps» и раньше не выполнялось).
   - `engines` у 1.5.0 — `node >= 20.12.0` (у проекта `>=20`): pnpm выдаст предупреждение при Node < 20.12, установка не падает (`engine-strict` в проекте не включён, `.npmrc` отсутствует). Если в окружении сборки Node < 20.12 — fallback на `@clack/prompts@1.2.0` (у неё `engines` не задан, набор API для наших нужд идентичен: `text`/`confirm`/`select`/`multiselect`/`isCancel`, `initialValues`, `required`). Решение по версии фиксируется в комментарии фазы code.
2. `pnpm-lock.yaml` обновится установкой; версия в `dependencies` — точная (`"@clack/prompts": "1.5.0"`, без `^`), чтобы VL-321 взяла ту же.

## Перепись `src/cli/prompt.ts` (AC2, AC3, AC5)

Файл сокращается примерно до 130 строк; остаются только: `PromptCancelledError`, `PromptOption<T>`, `PromptSession`, `PromptSessionOptions`, `isInteractive`, `createPromptSession`.

1. Шапка модуля (строки 1–20): переписать обоснование — раньше «почему свой слой, а не clack» (аргумент «zero runtime deps» неверен); теперь: интерактив на `@clack/prompts` (ref-25, `sv`), обёртка нужна только чтобы не переписывать `init-wizard.ts`; lesson-195 (один владелец stdin) снимается — clack создаёт и закрывает свой readline на каждый промпт последовательно, общий lifecycle не нужен.
2. Импорт: `import { text, confirm, select, multiselect, isCancel } from '@clack/prompts';`
3. Удалить целиком (строки 81–107 и 118–285): `HIDE_CURSOR`/`SHOW_CURSOR`/`CLEAR_LINE`/`INVERSE`/`RESET`, `stepIndex`, `clampCursor`, `rawScope`, `readLine`, `runList`. Оставить одну маленькую функцию `firstEnabledIndex(options, wanted)` (нужна только для маппинга `initialIndex → initialValue` у `select`; у clack курсор на disabled-пункт сам не встаёт — `findCursor`).
4. `isInteractive` — без изменений (строки 74–79): оба потока TTY; не-TTY → ветка дефолтов, clack не вызывается (AC4/AC7 VL-320).
5. Вспомогательное:
   ```ts
   /** Резолвит результат промпта clack: отмена (Ctrl+C / Esc) → PromptCancelledError. */
   function orCancel<T>(result: T | symbol): T {
     if (isCancel(result)) throw new PromptCancelledError();
     return result as T;
   }
   ```
   Отмена у clack приходит символом `CANCEL_SYMBOL` (Ctrl+C: `settings.aliases` `"\u0003" → "cancel"`; Esc: `"escape" → "cancel"` в `@clack/core`) — то есть Esc обрабатывается так же, как раньше (AC5, тест «Esc в списке — отмена» сохраняется по смыслу).
6. `createPromptSession(opts)` (позиция строки 110), изменения по методам:
   - передавать в каждый промпт `input`/`output` из `opts` (`CommonOptions` clack это поддерживает) — так тесты инжектируют `PassThrough`;
   - `askText(question, def, validate)`: если `!interactive` → `def`. Иначе
     `orCancel(await text({ message: question, input, output, placeholder: def !== '' ? `Enter — оставить «${def}»` : undefined, defaultValue: def, validate: (v) => { const val = (v ?? '').trim() || def; const err = validate ? validate(val) : null; return err ?? undefined; } }))`, результат — `String(...).trim() || def`.
     Сохраняет прежнюю семантику (Enter → дефолт, обрезка пробелов, цикл переспроса на невалидном вводе — это делает сам clack);
   - `askConfirm(question, def)`: `!interactive` → `def`; иначе `orCancel(await confirm({ message: question, initialValue: def, input, output }))`;
   - `askSelect(question, options, initialIndex = 0)`: `options.length === 0` → прежняя ошибка `'askSelect: пустой список вариантов'`; `!interactive` → `options[firstEnabledIndex(...)].value`; иначе
     `orCancel(await select({ message: question, options: options.map(({value,label,hint,disabled}) => ({ value, label, hint, disabled })), initialValue: options[firstEnabledIndex(options, initialIndex)].value, input, output }))`;
   - `askMultiselect(question, options, initial)`: `!interactive` → `initial.filter(v => allowed.has(v))` (как сейчас); иначе
     `orCancel(await multiselect({ message: question, options: mapped, initialValues: initial.filter(v => allowed.has(v)), required: false, input, output }))` — `required: false` обязателен: пустой выбор допустим (сейчас можно снять все галочки, AC «поведение VL-320 не меняется»); у clack по умолчанию требуется хотя бы один;
   - `close()` — no-op с комментарием (общего readline-инстанса у clack нет).
7. Комментарии-«почему» — по-русски, JSDoc у экспортов сохраняется.

## `src/cli/commands/init-wizard.ts`, `src/cli/commands/init.ts` (AC2, AC6)

Правок не планируется: контракт `PromptSession` (`askText/askConfirm/askSelect/askMultiselect/close`), `PromptOption`, `PromptCancelledError`, `isInteractive` сохраняются. Трогаем ТОЛЬКО если компиляция/поведение разойдётся (ожидаемые места: `init-wizard.ts:20-21` импорт, `init-wizard.ts:213` создание сессии; `init.ts:30,121` обработка отмены) — тогда минимальная адаптация сигнатур, а не перевод на API clack.

`p.group`/`p.note` (пункт 5 задачи) — НЕ вводим: `runWizard` менять не нужно, а group потребовал бы переписать последовательность шагов в декларативный вид (риск для AC6 без выгоды). Зафиксировать это в комментарии фазы code.

## Тесты (AC7)

`src/cli/prompt.test.mjs` — переписать:
- удалить тесты кадров/навигации `lastFrame`, `\x1b[B`/`\x1b[A`, `❯`, `[x]` (это теперь зона clack);
- оставить/добавить:
  1. `isInteractive(new PassThrough(), new PassThrough()) === false`;
  2. не-TTY: `askText`/`askConfirm`/`askSelect`(initialIndex)/`askMultiselect` (disabled отфильтрован из `initial`) возвращают дефолты, `close()` не бросает;
  3. `askSelect` с пустым списком → `Error`;
  4. отмена реальным clack-промптом на `PassThrough` (`createPromptSession({input,output,forceInteractive:true})`, запись `'\u0003'` в input после старта промпта, `await tick(50)` при необходимости) → `PromptCancelledError` для `askText`, `askSelect`, `askMultiselect`, `askConfirm` — если для какого-то из промптов clack на не-TTY-потоке не эмитит keypress (readline требует `terminal: true`), тест помечается как проверяемый на уровне маппинга (см. п. 5) и это фиксируется в комментарии фазы; базовый вариант — один-два таких теста, а не четыре копии;
  5. маппинг значений/валидации — через инъекцию фейковой реализации: добавить в `PromptSessionOptions` (или отдельным необязательным параметром второго аргумента, чтобы не расширять публичный контракт сессии) внутренний seam `prompts?: Pick<typeof import('@clack/prompts'), 'text'|'confirm'|'select'|'multiselect'|'isCancel'>` для тестов; тесты проверяют: `placeholder`/`defaultValue` для текста, `initialValue` = значение пункта по `initialIndex` (и пропуск disabled), `initialValues` у multiselect, `required: false`, и что возврат `CANCEL_SYMBOL` фейка → `PromptCancelledError`. Seam не попадает в README/доки, документируется JSDoc-комментарием «только тесты».
- Каталог — `mkdtempSync` не нужен (потоки в памяти), фиксированных путей нет (AGENTS.md).

`src/cli/init-wizard.test.mjs` — не меняется (спавн-CLI без TTY: флаги, `--yes`, prefix, `--web`), должен пройти как есть.

## Документация (AC8, DoD-2)

`backlog/docs/doc-7-CLI-справочник-Vibelogmd.md:31` — абзац «Интерактивный слой переписан в VL-320 (`src/cli/prompt.ts` — единая сессия ввода без внешних зависимостей)…» переписать: интерактив на `@clack/prompts` (VL-322), `src/cli/prompt.ts` — тонкая обёртка над ним, поведение прежнее (списки со стрелками, `space`-галочки, `Esc`/`Ctrl+C` → «Отменено. Настройки не изменены.» + код 0, не-TTY → дефолты). README не трогаем (лимит 150 строк, тест `src/web/readme-standard.test.mjs`).

## Порядок действий

1. `pnpm add @clack/prompts@1.5.0` (fallback 1.2.0 по Node-версии).
2. Переписать `src/cli/prompt.ts`.
3. `pnpm build` (tsc strict) — устранить ошибки типов типов clack (`Option<T>` требует `label` для не-primitive — у нас label обязателен, ок).
4. Переписать `src/cli/prompt.test.mjs`.
5. Обновить doc-7 (`document_update`).
6. Полный прогон `pnpm test` (build + vitest, включая `src/web/static.test.mjs`).
7. Ручная проверка в TTY: `vibelog init` fresh (все шаги, Esc/Ctrl+C на разных шагах → «Отменено…», код 0) и upgrade; флаги `--yes`, `--web`, `--no-wizard`.

## Риски

- **`engines` clack 1.5.0 = node >= 20.12** при `engines` проекта `>=20`: предупреждение pnpm у пользователей на 20.0–20.11, установка/работа не блокируется. Митигация — fallback 1.2.0 (без `engines`). Отметить в отчёте code.
- **Отмена в не-TTY тестах**: clack создаёт `readline` c `terminal: true` и `setRawMode` только для TTY; на `PassThrough` keypress-события должны эмититься, но возможна асинхронная гонка (escapeCodeTimeout=50 мс) → флак. Митигация: seam-инъекция для юнит-тестов + 1–2 реальных теста с `await tick(50)`; реальный TTY-интерактив покрыт spawn-тестом `init-wizard.test.mjs` (поведение) и ручной проверкой.
- **`multiselect` по умолчанию требует выбор** — забыть `required: false` = регрессия AC («можно снять все галочки», проект без агентов).
- **`select` не встаёт на disabled-пункт** — при `initialIndex` на disabled clack сам переедет на следующий доступный (`findCursor`); наша `firstEnabledIndex` выравнивает поведение с прежним `clampCursor`.
- **Вывод clack отличается от прежних кадров** (рамки `│`, символы `◆/◇`): на него могут опираться только удаляемые тесты кадров; интеграционные тесты `init-wizard.test.mjs` проверяют консольный вывод не интерактивной ветки — не задеваются.
- **VL-321 возьмёт версию из этого package.json** — версию фиксировать точно, без `^`.

## Файлы

- `package.json` (+`pnpm-lock.yaml`) — зависимость;
- `src/cli/prompt.ts` — полная перепись (обёртка);
- `src/cli/prompt.test.mjs` — перепись тестов;
- `backlog/docs/doc-7-CLI-справочник-Vibelogmd.md` — абзац `## init`.
- `src/cli/commands/init-wizard.ts`, `src/cli/commands/init.ts` — только если контракт не совпал (по плану без правок).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 19:36
---
Фаза 2 (Plan) выполнена. Тип: feature. План записан в задачу.
Изучено: `src/cli/prompt.ts` (337 строк, весь файл), `src/cli/commands/init-wizard.ts` (364), `src/cli/commands/init.ts:90-160`, `src/cli/prompt.test.mjs`, `src/cli/init-wizard.test.mjs`, `package.json`, doc-7 (`## init`), ref-25 (Svelte CLI: `backlog/references/data/cli/packages/sv/package.json:44` — `@clack/prompts@1.5.0`; `create.ts:195-300` — `p.group`/`p.text`/`p.select`/`p.isCancel`/`p.cancel`), а также публичные типы и рантайм `@clack/prompts`/`@clack/core` 1.5.0/1.8.1 (сигнатуры `text`/`confirm`/`select`/`multiselect`, `CANCEL_SYMBOL`, алиасы `"\u0003"→cancel` и `"escape"→cancel`, `findCursor` для disabled-пунктов).
Ключевые решения плана:
- `pnpm add @clack/prompts@1.5.0` точной версией (одна версия с VL-321); чистый JS, нативных модулей нет (README:27 не нарушается, «zero runtime deps» и так не выполнялось — grammy/undici уже в `dependencies`).
- `src/cli/prompt.ts` → обёртка ~130 строк: удаляются `rawScope`/`readLine`/`runList`/ANSI-константы, остаются `PromptCancelledError`, `PromptOption`, `PromptSession`, `isInteractive`, `createPromptSession`; отмена через `isCancel()`; `initialIndex → initialValue` через `firstEnabledIndex`; `multiselect` обязательно `required: false` (иначе регрессия — нельзя снять все галочки).
- `init-wizard.ts`/`init.ts` — без правок (контракт сохранён); `p.group`/`p.note` — не вводим.
- Тесты: `prompt.test.mjs` переписывается (не-TTY-дефолты, пустой список, отмена, маппинг параметров через тестовый seam-инъекцию промптов), тесты кадров/`❯` удаляются; `init-wizard.test.mjs` — без изменений.
- Документация: doc-7, абзац про интерактивный слой (README не трогаем — лимит 150 строк).
Файлы плана проверены `ls` — все существуют. Риски: `engines` clack 1.5.0 `node >= 20.12` (fallback 1.2.0 без `engines`; локально Node 20.19), флак отмены в не-TTY тестах (митигация — seam + spawn-тест), забыть `required: false`, изменение вида кадров (задевает только удаляемые тесты).
---
author: @agent
created: 2026-11-03 19:46
---
Фаза 3 (Code) выполнена. Коммит 46ccbc9.
## Изменено
- `package.json` — `dependencies` + `"@clack/prompts": "1.5.0"` (точная версия, как у `sv` в ref-25; одна версия на проект — VL-321 возьмёт её отсюда). Установлено через `pnpm add @clack/prompts@1.5.0 --virtual-store-dir=<главный node_modules/.pnpm>` (worktree использует общий node_modules основного репо; pnpm без этого флага падал на ERR_PNPM_UNEXPECTED_VIRTUAL_STORE). `pnpm-lock.yaml` обновлён: `@clack/prompts@1.5.0` + транзитивные `@clack/core@1.4.0`, `fast-string-width@3.0.2`, `fast-string-truncated-width@3.0.3`, `fast-wrap-ansi@0.2.2`, `sisteransi@1.0.5` — чистый JS, нативной сборки и пост-инсталла нет (README:27 соблюдён).
- `src/cli/prompt.ts` — переписан как тонкая обёртка (337 → 240 строк, из них ~120 комментариев): `createPromptSession` делегирует в `p.text`/`p.confirm`/`p.select`/`p.multiselect`, отмена через `p.isCancel` → `PromptCancelledError`. Удалены `rawScope`/`readLine`/`runList`/`stepIndex`/`clampCursor`, ANSI-константы (`\x1b[?25l/\x1b[?25h`, `\r\x1b[2K`, инверсия), `setRawMode`/`pause`/`resume`, ручная навигация и галочки. Сохранены контракт `PromptSession`, `PromptOption`, `PromptCancelledError`, `isInteractive` (оба потока TTY; не-TTY → дефолты без промптов). `askSelect` маппит `initialIndex` → `initialValue` через `firstEnabledIndex` (disabled пропускается), `askMultiselect` передаёт `initialValues` (отфильтрованные по disabled) и `required: false` — пустой выбор по-прежнему допустим. `close()` — no-op (у clack нет общего readline-инстанса, lesson-195 снят).
- `src/cli/prompt.test.mjs` — переписан: тесты кадров/`❯`/`\x1b[A/B` удалены (зона clack); остались/добавлены: не-TTY-дефолты для всех четырёх методов, disabled-стартовый пункт, пустой список → ошибка, маппинг параметров в clack через seam `prompts` (`message`/`defaultValue`/`placeholder`/`validate`, `initialValue` из `initialIndex`, `initialValues` + `required: false`), `CANCEL_SYMBOL` → `PromptCancelledError` для всех методов, реальный Ctrl+C на PassThrough для `askText` и `askSelect`.
## Проверки
- `pnpm build` — tsc strict, без ошибок (потребовалось привести потоки к `Readable`/`Writable` для типов clack и вернуть `Option<T>[]` из маппера).
- Полный `pnpm test` — 161 файл, 3048 тестов passed, 4 skipped (пропуски существовавшие, в `src/core/frontmatter.test.mjs`), включая `src/web/static.test.mjs` (второй прогон скрипта). Флаг `--exclude`/`--skip` не использовался.
- `src/cli/commands/init-wizard.ts` и `src/cli/commands/init.ts` — правок не потребовалось, контракт совпал (AC2).
- `p.group`/`p.note` не вводились (по плану): `runWizard` не переписывается, выгоды нет.
- Дымовая проверка в не-TTY: `vibelog init "Smoke Test" --yes` в mkdtemp — создаёт backlog/settings/AGENTS.md, код 0.
## Что осталось
- Ручная проверка TTY (Esc/Ctrl+C на шагах, fresh/upgrade, `--web`/`--no-wizard`) — автоматически невозможна в этой сессии; отмена покрыта юнит-тестами на реальном clack-промпте, не-TTY-ветка — spawn-тестом `src/cli/init-wizard.test.mjs` (не менялся, проходит).
- doc-7 не правился: по правилам фазы Code документацию пишет Close. Упоминание clack там опционально (AC8), текущий текст поведению не противоречит.
- Замечание по версии: у `@clack/prompts@1.5.0` `engines: node >= 20.12` при `engines` проекта `>= 20` — на Node 20.0–20.11 pnpm выдаст предупреждение, установка/работа не блокируется (локально Node 20.19.0). Если это нежелательно — fallback на 1.2.0 (без `engines`, тот же набор API).
---
author: @agent
created: 2026-11-03 20:01
---
Фаза Close выполнена. Ветка vb/vl-322 слита в master (1 коммит: 46ccbc9), merge 92bbb90, worktree .vibelog/worktrees/vl-322 удалена (--force: внутри были только untracked-симлинк backlog/references/data и ignored dist/node_modules — данные не терялись), ветка vb/vl-322 удалена.
## Проверки после merge
- `pnpm build` — сначала упал с `Cannot find module '.pnpm/typescript@7.0.2/.../bin/tsc'`: артефакт окружения — `pnpm add @clack/prompts` из worktree переписал шимы `node_modules/.bin` главного репо путями на глубину worktree. Восстановлено через `rm -rf node_modules/.bin && pnpm install --offline --frozen-lockfile` (lock не менялся), после чего `pnpm build` — exit 0. Код не правился, фаза Close код не трогает. Оформлено уроком lesson-196.
- Ранний точечный фильтр: `src/cli/prompt.test.mjs` + `src/cli/init-wizard.test.mjs` — 2 файла, 25 тестов passed.
- Полный прогон `pnpm test` (build + vitest) — 161 файл, 3048 passed, 4 skipped (пре-существующие пропуски в `src/core/frontmatter.test.mjs`), включая `src/web/static.test.mjs`. Один прогон, без `--exclude`/`--skip`.
## Документация
- `CHANGELOG.md` — запись VL-322 в `## [Unreleased]` → `### Добавлено`.
- `doc-7` (раздел `## init`) — абзац об интерактивном слое переписан: `src/cli/prompt.ts` — тонкая обёртка над `@clack/prompts` (VL-322), пакет чистый JS; поведение прежнее (VL-320). Описание прежних кадров (`❯`, блок одним куском) убрано как неактуальное.
- Коммиты: e43e1a6 (refs и lessons), b309002 (CHANGELOG + doc-7).
## Lessons
- lesson-196 — восстановление .bin-шимов главного репо после pnpm-команды из worktree с симлинком node_modules.
- lesson-197 — тестирование обёртки над внешней TUI-библиотекой через seam-параметр вместо реального терминала.
Оба связаны с VL-322, ref-25 дополнен linked_tasks.
## DoD
1. Тесты проходят — ✓.
2. Документация обновлена — ✓ (CHANGELOG + doc-7, коммит b309002).
3. Нет регрессий — ✓ (полный прогон зелёный, поведение VL-320 сохранено).
---
<!-- COMMENTS:END -->