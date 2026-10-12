---
id: VL-88
title: /diff — RichMessage с незакоммиченными файлами (git status + счётчики строк)
status: Done
assignee: []
reporter: ''
created_date: '2026-10-05 16:16'
updated_date: '2026-10-12 21:54'
due_date: ''
labels: []
dependencies: []
milestone: v1.7
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
#bot Команда `/diff` в Telegram-боте: RichMessage с текущими незакоммиченными файлами и краткими данными о каждом.

## Контекст

Пользователю нужно быстро видеть из чата, что не закоммичено в git-репозитории проекта, без запуска git в терминале. Существующие команды бота (`/tasks`, `/task`, `/board`) показывают только задачи из `backlog/` — git-статус не отображается нигде. Коллекции git status/porcelain в коде нет (проверено grep) — собирается новая core-функция по паттерну `src/core/git-user.ts` (spawnSync).

## Что делает команда

`/diff` (без аргументов) — только в привязанном чате (requireBind, как у остальных команд):

1. Собирает git-данные в `cwd` проекта:
   - `git branch --show-current` — имя ветки для заголовка;
   - `git status --porcelain` — все незакоммиченные файлы (modified/added/deleted/untracked/renamed, staged и unstaged);
   - `git diff --numstat` и `git diff --cached --numstat` — счётчики строк +N/−N по файлу (unstaged и staged раздельно).
2. Рендерит RichMessage (паттерн sendTasksView, VL-82): HTML-таблица `<table bordered striped compact>` с колонками «Файл | Статус | Строки (+/−)»; статус — человекочитаемый (Modified/Added/Deleted/Untracked/Renamed + метка staged); пути и подписи экранируются через `cellSafe`; лимит 32768 — `chunkRich`.
3. Пустой git status → короткое сообщение «Незакоммиченных изменений нет» (таблица не строится — как пустой /tasks).
4. Фолбэк (паттерн sendTaskView → formatTaskDetail): `sendRichMessage` недоступен → MarkdownV2-список файлов со статусами.

## Точки интеграции

- `src/bot/handlers.ts` — обработчик `bot.command('diff', ...)` + sendDiffView (try sendRichMessage → фолбэк MarkdownV2).
- `src/bot/rich.ts` — `renderDiffRich(files, branch)`.
- Новая core-функция (например `src/core/git-status.ts`) — сбор porcelain/numstat, чистая, юнит-тестируемая (spawnSync мокается в тестах, как git-user).
- `src/bot/registry.ts` — запись в BOT_COMMANDS (меню Telegram + help /start через commandsHelp).
- `docs/user-guide.md` (раздел 11 «Telegram-бот»), `CHANGELOG.md` (Unreleased).

## Ограничения

- Read-only: команда ничего не коммитит и не меняет в рабочем дереве.
- Staged показывается отдельной меткой, не сливается с unstaged.
- Git недоступен / не git-репозиторий → сообщение об ошибке в чат, бот не падает.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Команда /diff в привязанном чате отправляет RichMessage: таблица «Файл | Статус | Строки (+/−)» из git status --porcelain + git diff --numstat (staged и unstaged раздельно, staged — отдельной меткой); при пустом статусе — сообщение «Незакоммиченных изменений нет»
- [x] #2 Фолбэк на MarkdownV2 при недоступности sendRichMessage; команда зарегистрирована в BOT_COMMANDS (меню Telegram + help /start); git-сбой или не-git-репозиторий — сообщение об ошибке в чат, бот не падает
- [x] #3 Юнит-тесты core-функции сбора git-данных и renderDiffRich проходят (pnpm test); docs/user-guide.md (раздел «Telegram-бот») и CHANGELOG.md обновлены
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации VL-88: команда /diff в Telegram-боте

### Файлы для изменения

1. **`src/core/git-status.ts` (новый файл)** — core-функция сбора git-данных (паттерн `src/core/git-user.ts`, spawnSync).
2. **`src/bot/rich.ts`** — rich-рендер таблицы diff.
3. **`src/bot/formatting.ts`** — MarkdownV2-фолбэк-список.
4. **`src/bot/handlers.ts`** — обработчик команды + sendDiffView.
5. **`src/bot/registry.ts`** — запись в BOT_COMMANDS.
6. **`src/bot/registry.test.mjs`** — обновить хардкод-счётчики (13 → 14) и help-строку.
7. **`src/core/git-status.test.mjs` (новый)** — тесты сбора/парсинга git-данных.
8. **`src/bot/rich.test.mjs`** — кейсы renderDiffRich.
9. **`src/bot/formatting.test.mjs`** — кейсы formatDiffList.
10. **`docs/user-guide.md`** — подраздел в разделе 11 «Telegram-бот».
11. **`CHANGELOG.md`** — запись в Unreleased → Добавлено.

### Шаг 1. `src/core/git-status.ts` (новый)

Экспортируемые чистые парсеры + обёртка spawnSync:

```ts
export interface DiffFile {
  path: string;          // путь из porcelain (раскодированный)
  oldPath?: string;      // для renamed: "R100 old -> new"
  status: string;        // человекочитаемый: Modified/Added/Deleted/Untracked/Renamed/…
  staged: boolean;        // статус из X-колонки (index), не из Y (worktree)
  additions: number;     // +N из numstat (staged и unstaged суммируются)
  deletions: number;     // −N из numstat
}
export function getGitStatus(cwd: string, env?): { branch: string; files: DiffFile[] }
  // throws Error(«git недоступен…») — вызывающая сторона ловит и шлёт сообщение в чат
export function parsePorcelain(stdout: string): DiffFile[]   // чистый парсер (тестируется без git)
export function parseNumstat(stdout: string): Map<string, {additions, deletions}>
```

Детали сбора (4 вызова git, все с `cwd` проекта):
- `git branch --show-current` — ветка для заголовка.
- `git -c core.quotepath=false status --porcelain` — `core.quotepath=false` обязателен: иначе не-ASCII пути (кириллица) экранируются как `\320\240...`. Парсинг X/Y-колонок: `X != ' '` → запись со `staged: true`; `Y != ' '` → запись со `staged: false`; обе — две записи (staged не сливается с unstaged). Untracked (`??`) → status Untracked, numstat нет (0/0). Renamed `R<score> old -> new` → oldPath. Бинарные/неизвестные счётчики в numstat (`-`) → 0/0.
- `git diff --numstat` (unstaged) и `git diff --cached --numstat` (staged) — счётчики по файлу; пути в numstat тоже с `core.quotepath=false` для совпадения с porcelain.
- `spawnSync` c `encoding: 'utf-8'`; `res.error` или `status !== 0` → throw с русским текстом («Git недоступен или это не git-репозиторий»).

### Шаг 2. `src/bot/rich.ts` — renderDiffRich

- Импорт типа `DiffFile` из `../core/git-status.js` (только type).
- Новая функция после `renderTasksRich` (≈ строка 434, до renderPhaseResultRich ≈443):

```ts
export function renderDiffRich(files: DiffFile[], branch: string): string
```

- Заголовок `# 📝 Незакоммиченные изменения — \`<branch>\`` (ветка в одинарных backticks, как в renderPhaseResultRich).
- Таблица `<table bordered striped compact>` (паттерн renderTasksRich, строки 398–434): шапка `<tr><th>Файл</th><th>Статус</th><th>Строки (+/−)</th></tr>`; строки `<tr><td><b>{cellSafe(path)}</b></td><td>{cellSafe(status)}{staged ? ' (staged)' : ''}</td><td>+{additions}/−{deletions}</td></tr>`; путь для renamed — `{newPath} ← {oldPath}` (оба через cellSafe). `cellSafe` (строка 368) — уже в файле, не экспортируется, используется внутри.
- Возврат без кнопок (у git-файлов нет callback-действий).

### Шаг 3. `src/bot/formatting.ts` — formatDiffList (фолбэк)

- Новая функция после `formatTaskList` (≈ строка 46): `export function formatDiffList(files: DiffFile[], branch: string): string` — каждая строка `*{escapeMarkdownV2(path)}* \[{status}{staged ? ' · staged' : ''}\] +{a}/−{d}`; пустой вход не вызывается (обработчик шлёт короткий текст до рендера); ветка — первая строка `*Ветка:* {escapeMarkdownV2(branch)}`.

### Шаг 4. `src/bot/handlers.ts` — обработчик

- Импорты: `renderDiffRich` в блок rich.js (строки 23–29), `formatDiffList` в блок formatting.js (строки 12–19), `getGitStatus`/`type DiffFile` из `../core/git-status.js` (после строки 11).
- `sendDiffView` после `sendTasksView` (после строки 133), паттерн sendTaskView/sendTasksView:

```ts
async function sendDiffView(bot: Bot, chatId: number, files: DiffFile[], branch: string): Promise<void> {
  try {
    for (const part of chunkRich(renderDiffRich(files, branch))) {
      await bot.api.sendRichMessage(chatId, { markdown: part });
    }
  } catch (err) {
    console.error('sendRichMessage не прошёл, фолбэк на MarkdownV2:', err);
    await sendText(bot, chatId, formatDiffList(files, branch));
  }
}
```

- Обработчик после `bot.command('board', ...)` (строки 281–285, ДО комментария «Управление задачами (VL-35)» — тест registry.test.mjs сверяет порядок bot.command с BOT_COMMANDS!):

```ts
bot.command('diff', async (ctx) => {
  if (!requireBind(ctx)) return;
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  let status: { branch: string; files: DiffFile[] };
  try {
    status = getGitStatus(deps.cwd);
  } catch (err) {
    // git-сбой / не git-репозиторий — ошибка в чат, бот не падает (AC#2)
    await sendMd(ctx, err instanceof Error ? err.message : 'Не удалось получить git-статус');
    return;
  }
  if (status.files.length === 0) {
    // Пустой статус — короткое сообщение, таблица не строится (как пустой /tasks)
    await sendMd(ctx, 'Незакоммиченных изменений нет');
    return;
  }
  await sendDiffView(bot, chatId, status.files, status.branch);
});
```

### Шаг 5. `src/bot/registry.ts` — запись в BOT_COMMANDS

- Строка после `{ command: 'board', ... }` (строка 27): `{ command: 'diff', description: 'Незакоммиченные файлы (git status)' },`
- help-строка /start генерируется из реестра (commandsHelp) — отдельной правки не требует.

### Шаг 6. Тесты

- **`src/bot/registry.test.mjs`**:
  - строка 13: `BOT_COMMANDS.length, 13` → `14`;
  - строки 43–47: в ожидаемую help-строку добавить `/diff` после `/board` → `'/tasks, /task <id>, /board, /diff, /create, ...'`;
  - тест «реестр покрывает все bot.command» (строки 31–41) автоматически проверит имя+порядок — порядок в handlers.ts и реестре обязан совпадать.
- **`src/core/git-status.test.mjs` (новый)**:
  - парсеры (чистые): porcelain с кейсами modified staged `M  f` / unstaged ` M f` / обе колонки `MM f` (две записи) / untracked `??` / renamed `R  old -> new` / кириллица; numstat с `-` (бинарник) и обычными `+N\t−N`;
  - интеграция: `mkdtemp` в /tmp (паттерн add-comment.test.mjs), `git init`, файлы с кириллицей в имени, коммит, правка/добавление без коммита — assert ветка, статусы, staged-метки, счётчики; не-git-директория → throw.
- **`src/bot/rich.test.mjs`**: renderDiffRich — заголовок с веткой, `<table bordered striped compact>`, колонки, staged-метка, экранирование `<script>` в пути через cellSafe, renamed-путь.
- **`src/bot/formatting.test.mjs`**: formatDiffList — экранирование спецсимволов MarkdownV2, staged-метка.

### Шаг 7. Документация

- **`docs/user-guide.md`**: новый подраздел «### Git-статус /diff (VL-88)» после подраздела «Список /tasks — rich-таблица (VL-82)» (строка 341, перед «### Самоперезапуск /restart (VL-70)» строка 343): назначение, таблица колонок, staged-метка, пустой статус, фолбэк MarkdownV2, read-only.
- **`CHANGELOG.md`**: в Unreleased → Добавлено первой строкой (перед VL-86, строка 8): «**VL-88: /diff — git-статус в Telegram-боте** …» (команда, core-функция git-status.ts, таблица, staged-метка, фолбэк, registry + docs).

### Порядок действий

1. `src/core/git-status.ts` + тесты парсеров.
2. `rich.ts` renderDiffRich + `formatting.ts` formatDiffList + их тесты.
3. `registry.ts` + правка registry.test.mjs (счётчик/help) — ОБЯЗАТЕЛЬНО в паре, иначе тест падает.
4. `handlers.ts`: импорты → sendDiffView → bot.command('diff') (строго после board).
5. `pnpm build` → `pnpm test`.
6. `docs/user-guide.md` + `CHANGELOG.md`.
7. Финальный прогон `pnpm test`.

### Как проверить

```bash
pnpm build          # tsc → dist/ (обязательно перед тестами)
pnpm test           # build + node --test src — все тесты, включая новые
```

Ручная проверка (по желанию Pavel): `pnpm build && vibelog bot` в проекте с незакоммиченными файлами → `/diff` в привязанном чате.

### Риски

1. **registry.test.mjs хардкодит счётчик 13 и help-строку** — при добавлении команды оба падают; правятся в том же коммите (шаг 6). Порядок в BOT_COMMANDS и в handlers.ts обязан совпадать (тест deepEqual по строке 31–41).
2. **core.quotepath=false** — без него кириллические пути в porcelain приходят в octal-экранировании и не совпадут с numstat; флаг обязателен для всех git-вызовов, читающих пути.
3. **numstat для renamed/бинарников**: `-` в колонках → 0/0; для renamed счётчик берётся по новому пути. Порядок «old → new» в porcelain — проверить на реальном git в интеграционном тесте.
4. **Git-сбой** (нет git в PATH, не репозиторий): getGitStatus бросает → sendMd с текстом ошибки, бот не падает (AC#2). Ловить в обработчике, не в core.
5. **Большой репозиторий** (сотни файлов): chunkRich дробит по 32768 — таблица может разорваться между сообщениями; допустимо (паттерн всех rich-рендеров), лимит не поднимаем.
6. **Тесты с реальным git**: интеграционные тесты git-status полагаются на git в PATH (на машине Pavel есть) и изолируются в mkdtemp /tmp (память: CLI-тесты — только /tmp, findBacklogDir не должен цеплять проект).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-05 16:20
---
Фаза 1 (Spec) выполнена. Тип: task.
Краткое описание уточнения: команда `/diff` в Telegram-боте — RichMessage с текущими незакоммиченными файлами. Исходное описание дополнено исследованием репозитория:
- **Данные**: `git status --porcelain` + `git diff --numstat` (staged и unstaged раздельно) + `git branch --show-current` для заголовка. Сбора git status в коде нет (grep подтверждён) — новая core-функция по паттерну `src/core/git-user.ts` (spawnSync).
- **Рендер**: HTML-таблица `<table bordered striped compact>` (паттерн sendTasksView/VL-82), колонки «Файл | Статус | Строки (+/−)», экранирование cellSafe, chunkRich для лимита 32768; пустой статус → «Незакоммиченных изменений нет».
- **Интеграция**: обработчик в handlers.ts + sendDiffView (try sendRichMessage → фолбэк MarkdownV2, паттерн sendTaskView), запись в BOT_COMMANDS (registry.ts), тесты core-функции и renderDiffRich, docs/user-guide.md + CHANGELOG.md.
- **Ограничения**: read-only (ничего не коммитит); staged — отдельная метка; git-сбой → ошибка в чат без падения бота.
Масштаб — одна задача (type=task): одна команда, один рендер, одна core-функция, без декомпозиции.
---
author: @agent
created: 2026-10-05 16:35
---
Фаза 2 (Plan) выполнена. Тип: task — план записан в задачу (Implementation Plan).
Краткое содержание плана:
1. Новая core-функция src/core/git-status.ts (паттерн git-user.ts, spawnSync): getGitStatus(cwd) собирает git branch --show-current + git status --porcelain (с флагом -c core.quotepath=false — иначе кириллические пути octal-экранируются и не совпадут с numstat) + git diff --numstat и git diff --cached --numstat (staged/unstaged раздельно); чистые парсеры parsePorcelain/parseNumstat тестируются без git. Staged и unstaged — раздельные записи с меткой staged; untracked/renamed/binary — отдельные кейсы.
2. src/bot/rich.ts: renderDiffRich(files, branch) — заголовок с веткой + HTML-таблица bordered striped compact, колонки Файл | Статус | Строки (+/-), staged — метка (staged), пути через cellSafe (уже в файле), renamed — new от old; дробление chunkRich.
3. src/bot/formatting.ts: formatDiffList — MarkdownV2-фолбэк (паттерн sendTaskView → formatTaskDetail).
4. src/bot/handlers.ts: sendDiffView (try sendRichMessage → catch фолбэк) + bot.command('diff') строго ПОСЛЕ board (тест registry.test.mjs сверяет порядок bot.command с BOT_COMMANDS); пустой статус → сообщение «Незакоммиченных изменений нет»; git-сбой → sendMd с ошибкой, бот не падает.
5. src/bot/registry.ts: запись diff после board + ОБЯЗАТЕЛЬНАЯ правка registry.test.mjs: хардкод-счётчик 13→14 и help-строка /start (иначе тест падает).
6. Тесты: новый git-status.test.mjs (чистые парсеры + интеграция с реальным git в mkdtemp /tmp, паттерн add-comment.test.mjs), кейсы renderDiffRich в rich.test.mjs, formatDiffList в formatting.test.mjs.
7. Докс: docs/user-guide.md — подраздел «Git-статус /diff (VL-88)» после раздела VL-82 (строка 341); CHANGELOG.md — запись в Unreleased первым пунктом.
Проверка: pnpm build && pnpm test. Риски раскрыты в плане (quotepath, счётчики registry, порядок команд, git-изоляция тестов в /tmp).
---
author: @agent
created: 2026-10-05 18:20
---
Фаза 3 (Code) выполнена.
**Изменено:**
- `src/core/git-status.ts` (новый) — core-функция `getGitStatus(cwd)` (паттерн git-user.ts, spawnSync): `git branch --show-current` + `git status --porcelain` + `git diff --numstat`/`--cached --numstat` с `-c core.quotepath=false` (кириллические пути); чистые парсеры `parsePorcelain`/`parseNumstat` (staged/unstaged — раздельные записи, renamed `old -> new` → oldPath, numstat-rename ` => ` → ключ по новому пути, бинарники `-` → 0/0). Записи `DiffFile`/`GitStatus`.
- `src/bot/rich.ts` — `renderDiffRich(files, branch)`: заголовок с веткой + HTML-таблица `<table bordered striped compact>` (Файл | Статус | Строки (+/−)), staged-метка, renamed «new ← old», пути через cellSafe.
- `src/bot/formatting.ts` — `formatDiffList(files, branch)`: MarkdownV2-фолбэк (ветка, пути через escapeMarkdownV2, staged-метка « · staged»).
- `src/bot/handlers.ts` — импорты + `sendDiffView` (try sendRichMessage → catch фолбэк MarkdownV2, паттерн sendTasksView) + `bot.command('diff')` строго после board (до комментария VL-35); requireBind, пустой статус → «Незакоммиченных изменений нет», git-сбой → sendMd с ошибкой, бот не падает.
- `src/bot/registry.ts` — запись `diff` в BOT_COMMANDS после `board` (меню Telegram + help /start через commandsHelp).
- Тесты: `src/core/git-status.test.mjs` (новый — чистые парсеры + интеграция с реальным git в mkdtemp /tmp + не-git-директория → throw), `src/bot/rich.test.mjs` (renderDiffRich: заголовок/таблица/staged/счётчики/renamed/cellSafe/пустой), `src/bot/formatting.test.mjs` (formatDiffList: ветка/строки/staged/экранирование), `src/bot/registry.test.mjs` (13→14, help-строка /diff после /board).
- `docs/user-guide.md` — подраздел «Git-статус /diff (VL-88)» в разделе «Telegram-бот» (перед /restart).
- `CHANGELOG.md` — запись VL-88 первой в Unreleased → Добавлено.
**Проверки:** `pnpm build` OK; `pnpm test` — **580/580** (было 560/560 + 20 новых). Smoke: `getGitStatus` на реальном репо — ветка master, 27 файлов, кириллица и staged/unstaged корректно.
**Отмечены AC#1-3, DoD#1-3** — все выполнены.
**Что осталось:** git commit/push — по правилам фазы не выполняются; ручная проверка `/diff` в Telegram-чате (по желанию Pavel).
---
author: @agent
created: 2026-10-05 18:27
---
Фаза Close выполнена. Статус: Done. Коммит feat: bf53e17 — feat: VL-88 — /diff: RichMessage с незакоммиченными файлами (git status + счётчики строк). В коммит вошли: src/core/git-status.ts + тест (новые), src/bot/{rich,formatting,handlers,registry}.ts + тесты, docs/user-guide.md, строка VL-88 в CHANGELOG.md (строки VL-85/86 оставлены незакоммиченными — это чужие параллельные задачи).
---
<!-- COMMENTS:END -->