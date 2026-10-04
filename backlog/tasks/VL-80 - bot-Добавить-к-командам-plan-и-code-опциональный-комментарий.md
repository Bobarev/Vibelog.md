---
id: VL-80
title: '#bot Добавить к командам plan и code опциональный комментарий'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-04 20:53'
updated_date: '2026-10-05 00:04'
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
#bot Добавить к командам plan и code опциональный комментарий.

Синтаксис: `/plan VL-N <опциональный комментарий>` и `/code VL-N <опциональный комментарий>` — комментарий идёт после ID задачи (всё до конца строки), как в `/comment VL-N <текст>`.

Поведение (уточнено по результатам исследования кода):

1. Парсеры `parsePlanCommand`/`parseCodeCommand` (src/bot/commands.ts) сейчас возвращают только `id` и игнорируют хвост — расширить: возвращать `{ id, comment? }` (как parseCommentCommand).
2. В обработчиках `/plan` и `/code` (src/bot/handlers.ts): если передан комментарий — вызвать core `addComment(cwd, task.id, text)` (комментарий попадает в задачу), затем `startPhase(cwd, task.id, 'plan'|'code', onExit, { comment: text })`.
3. В шаблоны templates/qwen-commands/phase-2.md и phase-3.md добавить плейсхолдер `{{comment}}` ближе к началу промпта (после инструкции «Прочитай задачу»), чтобы комментарий учитывался при выполнении фазы. При пустом комментарии плейсхолдер подставляется пустой строкой (extraVars всегда передаётся).
4. Обновить подсказки синтаксиса: 'Синтаксис: /plan VL-<id> [комментарий]'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Команда /plan VL-N <текст> добавляет комментарий в задачу через addComment и запускает фазу Plan с подстановкой текста в {{comment}} в начале промпта (шаблон phase-2.md)
- [x] #2 Команда /code VL-N <текст> аналогично добавляет комментарий и запускает фазу Code с подстановкой {{comment}} в шаблон phase-3.md
- [x] #3 Вызов /plan VL-N и /code VL-N без комментария работает как раньше (регрессия отсутствует); обновлены парсеры, обработчики, оба шаблона и их тесты (pnpm test проходит)
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
Команды `/plan VL-N <текст>` и `/code VL-N <текст>`: опциональный комментарий после ID добавляется в задачу через addComment и подставляется в {{comment}} промпта фазы.

## Файлы для изменения
1. src/bot/commands.ts — типы PlanCommand/CodeCommand + парсеры
2. src/bot/handlers.ts — обработчики /plan, /code + next-phase кнопка
3. templates/qwen-commands/phase-2.md — плейсхолдер {{comment}}
4. templates/qwen-commands/phase-3.md — плейсхолдер {{comment}}
5. src/bot/commands.test.mjs — тесты парсеров
6. src/web/orchestrator.test.mjs — тесты renderPrompt
7. docs/user-guide.md — синтаксис в таблице команд
8. src/bot/registry.ts + src/bot/registry.test.mjs — help-строка

## Конкретные места

### 1. src/bot/commands.ts
- Строки 28-30: интерфейс `PlanCommand { id: string }` → добавить `comment?: string`.
- Строки 32-34: `CodeCommand { id: string }` → добавить `comment?: string`.
- `parsePlanCommand` (строки 168-181):
  - hint (строка 175): `'Синтаксис: /plan VL-<id>'` → `'Синтаксис: /plan VL-<id> [комментарий]'`.
  - Логика (строки 176-180) — как parseCommentCommand, но комментарий ОПЦИОНАЛЕН:
    ```ts
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) return { id: trimmed };
    const id = trimmed.slice(0, spaceIdx).trim();
    const comment = trimmed.slice(spaceIdx + 1).trim();
    if (!id) return { error: hint };
    return comment ? { id, comment } : { id };
    ```
  - ВАЖНО: ключ `comment` добавлять ТОЛЬКО при наличии (spread-паттерн как в parseCreateCommand) — иначе сломаются deepEqual-тесты.
- `parseCodeCommand` (строки 183-197): аналогично, hint `'Синтаксис: /code VL-<id> [комментарий]'`.
- Регрессия: `/plan VL-1` (без хвоста) → `{ id: 'VL-1' }` — поведение не меняется.

### 2. src/bot/handlers.ts
- Бейзлайн ДО патча: `grep -n "bot.command('" src/bot/handlers.ts` (ловушка handler-generation-eats-original: все команды должны остаться на месте).
- Обработчик `/plan` (строки ~365-392): после проверки getTask (после строки ~375) вставить:
  ```ts
  try {
    if (parsed.comment) addComment(deps.cwd, task.id, parsed.comment);
  } catch (err) {
    await sendMd(ctx, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  ```
  - `addComment` уже импортирован (строка 10) — новый импорт не нужен.
  - Строка 384: `startPhase(deps.cwd, task.id, 'plan', onExit)` → `startPhase(deps.cwd, task.id, 'plan', onExit, { comment: parsed.comment ?? '' })`.
- Обработчик `/code` (строки ~395-421): те же 2 правки; startPhase (строка 413) → с `{ comment: parsed.comment ?? '' }`.
- Next-phase кнопка (строка 575): `startPhase(deps.cwd, task.id, next.phase, onExit)` → добавить `, { comment: '' }` — иначе в промпте из кнопки останется литеральный `{{comment}}`.
- После патча: сравнить список `bot.command('` с бейзланом — все команды на месте.

### 3. templates/qwen-commands/phase-2.md
- После блока шага 1 (после строки «Определи type задачи: task или epic.») вставить:
  ```
  Дополнительный комментарий пользователя к запуску фазы: {{comment}}
  Если вместо комментария остался неподставленный {{comment}} (запуск без комментария) — просто продолжай по шагам.
  ```
- Вторая строка — фолбэк для web-trigger (src/web/api.ts:68 не передаёт extraVars; глобальную подстановку в renderPrompt делать НЕЛЬЗЯ — сломается фолбэк phase-comment.md, где литеральный {{comment}} означает «возьми последний комментарий»).

### 4. templates/qwen-commands/phase-3.md
- Аналогично, после блока шага 1 (после «Определи type задачи: task или epic.»).

### 5. src/bot/commands.test.mjs (строки 96-137)
- `parsePlanCommand('VL-49')` → остаётся `{ id: 'VL-49' }` (без ключа comment).
- Кейс «хвостовой текст игнорируется» (строки 105-107) → переписать: `parsePlanCommand('VL-49 ещё что-то')` → `{ id: 'VL-49', comment: 'ещё что-то' }`.
- Новые кейсы: комментарий с несколькими словами; hint содержит `[комментарий]`.
- То же для parseCodeCommand (строки 119-137).

### 6. src/web/orchestrator.test.mjs
- После кейса comment (строка 137) добавить:
  - `renderPrompt('plan', 'VL-80', { comment: 'учти риски' })` — match /учти риски/, doesNotMatch /\{\{comment\}\}/.
  - `renderPrompt('code', 'VL-80', { comment: '...' })` — аналогично.
  - `renderPrompt('plan', 'VL-80')` без extraVars — литеральный `{{comment}}` сохраняется (контракт фолбэка шаблона, как у comment-фазы).

### 7. docs/user-guide.md (строки 294-295)
- `/plan <id>` → `/plan <id> [комментарий]`; `/code <id>` → `/code <id> [комментарий]`.

### 8. src/bot/registry.ts (строки 37-38) + registry.test.mjs (строка 46)
- Добавить `usage: '/plan VL-<id> [комментарий]'` и `usage: '/code VL-<id> [комментарий]'` в BOT_COMMANDS (commandsHelp использует usage).
- Обновить ожидаемую строку в registry.test.mjs.

## Порядок действий
1. commands.ts (типы + парсеры) → commands.test.mjs → `pnpm build && node --test src/bot/commands.test.mjs`.
2. Шаблоны phase-2/phase-3 → orchestrator.test.mjs → `node --test src/web/orchestrator.test.mjs`.
3. handlers.ts (бейзлайн grep → точечный патч по уникальным якорям → сравнение) + registry.ts/registry.test.mjs.
4. docs/user-guide.md.
5. Полная проверка: `pnpm build && pnpm test`.

## Как проверить
- `pnpm build` (tsc → dist/).
- `pnpm test` (build + node --test src). На Catalina игнорировать dyld SIGABRT на file-level (dyld-pwritev — известная ловушка, не регрессия).
- Ручной smoke (VL-53-паттерн): бот + `/plan VL-N` без комментария (регрессия: фаза запускается, {{comment}} → пустая строка) и `/plan VL-N текст` (комментарий в файле задачи + {{comment}} в промпте). Smoke ОБЕИХ смежных команд /plan и /code.

## Риски
1. **Литеральный {{comment}} из web-trigger** (api.ts:68 без extraVars) — фолбэк-строка в шаблонах; renderPrompt глобально не менять (сломается фолбэк phase-comment.md).
2. **Ключ `comment: undefined` ломает deepEqual** — парсер возвращает `{id, comment}` только при наличии комментария.
3. **Ловушка handler-generation-eats-original** — патч только точечными заменами по уникальным якорям, бейзлайн `bot.command('` до/после.
4. **addComment может бросить** (fs) — try/catch в /plan и /code с отправкой «Ошибка: …».
5. **parseCommentCommand требует текст, parsePlan/Code — нет** — не унифицировать: `/plan VL-1` без хвоста обязан работать (AC3).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-04 20:55
---
Фаза 1 (Spec) выполнена. Тип: task.
Краткое описание уточнения: фича укладывается в одну задачу — точечные изменения в 4 местах:
1. **Парсеры** (`src/bot/commands.ts`): `parsePlanCommand`/`parseCodeCommand` сейчас возвращают только `id` (хвост игнорируется, lenient) — расширить до `{ id, comment? }` по образцу `parseCommentCommand`.
2. **Обработчики** (`src/bot/handlers.ts`): в `/plan` и `/code` при наличии комментария — `addComment(cwd, task.id, text)` (уже импортирован из core/store.js) → `startPhase(..., { comment: text })` (extraVars поддерживается с VL-66, см. `/comment`).
3. **Шаблоны** (`templates/qwen-commands/phase-2.md`, `phase-3.md`): добавить плейсхолдер `{{comment}}` ближе к началу промпта (после шага «Прочитай задачу»); при пустом комментарии подставляется пустая строка.
4. **Тесты**: парсеры и обработчики + прогон `pnpm build && pnpm test`.
Уточнены AC (3 критерия): с комментарием — addComment + подстановка в промпт обеих фаз; без комментария — поведение не меняется (регрессия отсутствует).
---
author: @agent
created: 2026-10-04 21:04
---
Фаза 2 (Plan) выполнена. Тип: task — план записан в задачу (implementationPlan).
**Изучено:** парсеры (src/bot/commands.ts:168-197), обработчики /plan и /code (src/bot/handlers.ts:365-421), next-phase кнопка (строка 575), renderPrompt/startPhase с extraVars (src/web/orchestrator.ts:87-140), шаблоны phase-2/phase-3, тесты парсеров и renderPrompt, web-trigger без extraVars (src/web/api.ts:68).
**Ключевые находки для реализации:**
1. addComment уже импортирован в handlers.ts (строка 10) — новый импорт не нужен.
2. extraVars в startPhase поддерживается с VL-60/66 — паттерн есть в commitComment (handlers.ts:187).
3. **Риск:** web-trigger (api.ts:68) не передаёт extraVars → в шаблонах нужна фолбэк-строка для литерального {{comment}} (по образцу phase-comment.md); глобальную подстановку в renderPrompt делать нельзя — сломается фолбэк comment-фазы.
4. **Риск:** deepEqual-тесты сломаются, если парсер вернёт `comment: undefined` — ключ добавлять только при наличии.
5. **Ловушка:** патч handlers.ts — только точечные замены по уникальным якорям, бейзлайн `grep "bot.command('"` до/после (handler-generation-eats-original).
План: 8 файлов, построчные правки, порядок действий и команды проверки (pnpm build && pnpm test + smoke /plan и /code). Статус → Planned.
---
author: @agent
created: 2026-10-04 21:10
---
Фаза 3 (Code) выполнена.
**Изменено (9 файлов по плану):**
1. `src/bot/commands.ts` — типы `PlanCommand`/`CodeCommand` получили `comment?: string`; `parsePlanCommand`/`parseCodeCommand` возвращают `{ id, comment }` при наличии хвоста (ключ добавляется только при наличии — deepEqual-тесты не ломаются), hint'ы обновлены на `[комментарий]`. `/plan VL-N` без хвоста → `{ id }` (регрессия отсутствует).
2. `src/bot/handlers.ts` — в обработчиках `/plan` и `/code`: при наличии комментария `addComment(cwd, task.id, comment)` в try/catch, затем `startPhase(..., { comment: parsed.comment ?? '' })`. Next-phase кнопка (строка 575) — `startPhase(..., { comment: '' })`, чтобы из кнопки не оставался литеральный `{{comment}}`. Бейзлайн `bot.command('` до/после — все 13 команд на месте (ловушка handler-generation не сработала).
3. `templates/qwen-commands/phase-2.md` и `phase-3.md` — после шага 1 добавлен блок: «Дополнительный комментарий пользователя к запуску фазы: {{comment}}» + фолбэк-строка для web-trigger (api.ts не передаёт extraVars). Глобальная подстановка в renderPrompt НЕ менялась (сломался бы фолбэк phase-comment.md).
4. `src/bot/commands.test.mjs` — кейсы «хвост игнорируется» переписаны в «хвост становится комментарием»; новые кейсы: комментарий из нескольких слов, хвост из пробелов → без ключа comment, hint содержит `[комментарий]`. Для /plan и /code.
5. `src/web/orchestrator.test.mjs` — renderPrompt plan/code с extraVars ({{comment}} подставляется), без extraVars (литеральный {{comment}} сохраняется — контракт фолбэка).
6. `docs/user-guide.md` — таблица команд: `/plan <id> [комментарий]`, `/code <id> [комментарий]`.
7. `src/bot/registry.ts` + `registry.test.mjs` — usage-строки для /plan и /code, обновлённая help-строка в тесте.
**Проверки:** `pnpm build` OK (tsc, 0 ошибок); `pnpm test` — **459/459 pass, 0 fail** (было 449, +10 новых кейсов).
**Что осталось:** ручной smoke с реальным ботом (`/plan VL-N текст` → комментарий в файле задачи + {{comment}} в промпте) — требует запущенного бота и Telegram; автотестами покрыты парсеры и renderPrompt. git commit/push — по правилам Фазы 3 не выполнялись.
---
author:  @agent
created: 2026-10-05 00:04
---
Фаза Close выполнена. Статус: Done. Коммит feat: 0408405 — «feat: VL-80 — опциональный комментарий к командам /plan и /code» (7 файлов: commands.ts, commands.test.mjs, registry.ts, registry.test.mjs, orchestrator.test.mjs, phase-2.md, phase-3.md).

Примечания: handlers.ts и docs/user-guide.md (правки VL-80) уже попали в ранее закоммиченный feat 5c75328 (VL-82) — повторно не коммитились. В templates/qwen-commands/phase-2.md закоммичен только ханк VL-80 (блок {{comment}}); чужие правки (статус Planned для детей эпика) оставлены незакоммиченными — не относятся к этой задаче.
---
<!-- COMMENTS:END -->