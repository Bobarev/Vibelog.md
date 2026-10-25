---
id: VL-179
title: 'checkShellCommandInProject: ложные «Команда отклонена» на путях с экранированными скобками \(main\) (route-группы ref-репозиториев)'
status: Review
assignee: []
reporter: ''
created_date: '2026-10-25 13:23'
updated_date: '2026-10-25 14:23'
due_date: ''
labels:
  - agent
  - bug
  - guard
  - shell
dependencies: []
milestone: ''
references: []
priority: medium
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/tools.ts
  - src/agent/tools.test.mjs
lessons:
  - lesson-26
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Проблема

В сессии agent-1792916033752 (фаза Plan VL-173) 6 из 95 tool-выводов (6,3%) — «Команда отклонена: обращение к путям вне проекта». Разбор показал: **5 из 6 отказов — ложные**, команда шла внутри проекта.

### Корневая причина

`checkShellCommandInProject` (src/agent/tools.ts, ~строка 302, введена в VL-99):

```ts
const tokens = command.match(/"[^"]*"|'[^']*'|[^\s;|&()<>]+/g) ?? [];
```

Токенизатор считает `(` и `)` разделителями shell, но **не учитывает backslash-экранирование**. В путях референс-репозиториев есть route-группы Next.js: `src/app/\(main\)/dashboard/tasks/`. Токен разбивается на фрагменты:

- `src/app/\` + `main\` + **`/dashboard/tasks/`**
- фрагмент `/dashboard/tasks/` начинается с `/` → `isAbsolute` → `relative(cwd, …)` наружу → **reject**, хотя исходный путь полностью внутри проекта.

### Конкретные ложные отказы из транскрипта

1. `ls -la backlog/references/data/next-shadcn-admin-dashboard/src/app/\(main\)/dashboard/tasks/` → reject `/dashboard/tasks/`
2. `cd backlog/references/data/... && grep -rn ... src/app/\(main\)/dashboard/tasks/_components/tasks.tsx` → reject `/dashboard/tasks/_components/tasks.tsx`
3. `cd ... && sed -n '1,120p' src/app/\(main\)/dashboard/tasks/_components/tasks.tsx` → reject аналогично
4. `grep -rn "Tabs\|Search\|Filter\|Sort" .../\(main\)/dashboard/kanban/_components/kanban.tsx` → reject `/dashboard/kanban/_components/kanban.tsx`
5. `grep -rn "AssigneeFilter..." ... \(main\)/dashboard/tasks/_components/columns.tsx` → reject `/dashboard/tasks/_components/columns.tsx`

6-й отказ (`sed ... "web/../../../../../web"`) — **истинный**: `..` резолвится наружу, guard сработал правильно.

### Стоимость

5 потраченных ходов на повторные попытки в одной сессии; каждый отказ заставляет модель переписывать рабочую команду и фрагментировать чтение референсов (а ref-чтение — обязательная часть фаз Plan/Code).

## Решение (направление)

1. Токенизатор должен учитывать `\(`, `\)`, `\'`, `\"` как литералы (не разбивать токен на разделителе после backslash) — либо сначала нормализовать экранированные скобки, затем токенизировать.
2. Альтернатива/дополнение: перед reject проверять не лексему, а фактический путь — фрагмент вида `/dashboard/...`, получившийся после разбиения, не должен считаться абсолютным путём (отбрасывать «фрагменты» без ведущего сегмента-корня или сверять с исходным токеном с учётом экранирования).
3. Не ослаблять истинные срабатывания: `..` наружу, `~`, `$HOME`, абсолютные пути вне cwd, `/etc/hosts` (VL-104).

## Ссылки

- Сессия-источник: .vibelog/agent-sessions/agent-1792916033752.jsonl (6 отказов, 5 ложных)
- Задача-источник guard: VL-99 (Done) — src/agent/tools.ts checkShellCommandInProject
- Связанная рекомендация: VL-124 (To Do) — политика нативных файловых инструментов вместо shell-обходов
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Токенизатор в checkShellCommandInProject учитывает обратный слэш: токены вида src/app/\(main\)/dashboard/... не разбиваются на «/dashboard/...» и не отклоняются
- [x] #2 Новые тесты: команда с \(main\)-путями внутри проекта возвращает null (не reject); аналогично для одиночного апострофа-экранирования, если поддерживается
- [x] #3 Ложноположительные отказы устранены: ls/grep/sed по backlog/references/data/**/\(main\)/** проходят
- [x] #4 Регрессия не допущена: существующие тесты VL-99/VL-104 (.. наружу, ~, $HOME, /etc/hosts, /Users/bob/Desktop, regex-паттерны grep) продолжают отклоняться
- [x] #5 pnpm test зелёный
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

Устранить ложные отказы `checkShellCommandInProject` на путях с экранированными скобками (route-группы Next.js `\(main\)`) без ослабления истинных срабатываний guard (VL-99/VL-104).

## Файлы для изменения (проверены ls — существуют)

1. `src/agent/tools.ts` — логика guard (VL-99).
2. `src/agent/tools.test.mjs` — новые тесты VL-179.

Больше файлов не меняется: внешней документации по guard нет (grep по docs/README/AGENTS — совпадений нет), документация = JSDoc/комментарии в tools.ts (DoD-2).

## Изменения по местам

### 1. src/agent/tools.ts

**а) Токенизатор — строка 302.**

Было:
```ts
const tokens = command.match(/"[^"]*"|'[^']*'|[^\s;|&()<>]+/g) ?? [];
```
Стало:
```ts
const tokens =
  command.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:\\[^\s]|[^\s;|&()<>])+/g) ?? [];
```
- Неэкранированная ветка `(?:\\[^\s]|[^\s;|&()<>])+`: альтернатива `\\[^\s]` стоит **перед** классом символов (порядок альтернатив важен!) — backslash+непробельный (`\(`, `\)`, `\'`, `\"`, `\<`, `\;`) потребляются вместе, токен не разбивается на разделителе → фрагмент `/dashboard/...` больше не возникает.
- Ветки кавычек `"(?:\\.|[^"\\])*"` / `'(?:\\.|[^'\\])*'` — `\"`/`\'` не закрывают кавычку раньше времени (AC-2).
- Комментарий над строкой 302 дополнить: VL-179, shell-экранирование не разбивает токен.

**б) Нормализация скобок перед путевыми проверками — цикл строки 303–330.**

После снятия кавычек (строка 304) добавить:
```ts
// VL-179: снимаем экранирование ТОЛЬКО скобок — src/app/\(main\)/... проверяется
// как src/app/(main)/... . Полный shell-unescape намеренно НЕ делаем: \.\. в
// regex-паттерне не должен превращаться в сегмент '..' (ложный reject).
const path = token.replace(/\\([()])/g, '$1');
```
Дальше в цикле:
- строка 313: `isRegexPatternToken(token)` → `isRegexPatternToken(path)`. Иначе токен `src/app/\(main\)/../..` содержит `\(` → считался бы regex-паттерном и пропустил проверку `..` (потеря истинного срабатывания, которое раньше давал случайный фрагмент);
- строка 315: `isAbsolute(token)` → `isAbsolute(path)`; строка 316 `relative(cwd, token)` → `relative(cwd, path)`; строка 318 `reject(token)` → `reject(path)`;
- строки 323–327: `token.split('/')` / `resolve(cwd, token)` → `path.split('/')` / `resolve(cwd, path)`; строка 327 `reject(token)` → `reject(path)`;
- проверки `~` (строка 306), флагов/`$`/backtick (строка 308), SPECIAL_FILES (строка 310) — **оставить на `token`**: экранированный `\~` в shell — литерал, отклонять нельзя.

**в) Комментарии-документация (DoD «Документация обновлена»):**
- JSDoc `checkShellCommandInProject` (строки 274–286): добавить про VL-179 — токенизатор учитывает shell-экранирование, route-группы `\(main\)` проверяются как единый относительный путь, фрагменты после разбиения не считаются абсолютными.
- Док-комментарий `isRegexPatternToken` (~строки 258–266): уточнить, что на вход подаётся путь после снятия экранирования скобок.

### 2. src/agent/tools.test.mjs

После describe `'checkShellCommandInProject (VL-99)'` (заканчивается строка 300) — новый блок:

```js
describe('checkShellCommandInProject: экранированные скобки (VL-179)', () => {
  const CWD = '/tmp/vibelog-vl179-fake-project';

  it('\\(main\\)-пути внутри проекта возвращают null (не reject)', () => {
    const allowed = [
      // 5 ложных отказов из транскрипта agent-1792916033752
      'ls -la backlog/references/data/next-shadcn-admin-dashboard/src/app/\\(main\\)/dashboard/tasks/',
      'cd backlog/references/data/x && grep -rn foo src/app/\\(main\\)/dashboard/tasks/_components/tasks.tsx',
      "cd backlog/references/data/x && sed -n '1,120p' src/app/\\(main\\)/dashboard/tasks/_components/tasks.tsx",
      'grep -rn "Tabs\\|Search\\|Filter\\|Sort" docs/src/app/\\(main\\)/dashboard/kanban/_components/kanban.tsx',
      'grep -rn "AssigneeFilter" src/app/\\(main\\)/dashboard/tasks/_components/columns.tsx',
      // экранирование в кавычках обоих видов + одиночный апостроф (AC-2)
      "grep -rn 'src/app/\\(main\\)/dashboard/x.tsx' .",
      'grep -rn "src/app/\\(main\\)/dashboard/x.tsx" .',
      "grep foo src/it\\'s-dir",
      // '..' ВНУТРИ проекта — не reject
      'ls src/app/\\(main\\)/../dashboard',
    ];
    for (const cmd of allowed) {
      assert.equal(checkShellCommandInProject(cmd, CWD), null, 'неожиданный отказ: ' + cmd);
    }
  });

  it('.. наружу из \\(main\\)-пути по-прежнему отклоняется', () => {
    assert.match(
      checkShellCommandInProject('ls src/app/\\(main\\)/../../../etc', CWD),
      /Команда отклонена/,
    );
  });

  it('истинный отказ из транскрипта (6-й кейс) сохраняется', () => {
    assert.match(
      checkShellCommandInProject("sed -n '1,120p' web/../../../../../web", CWD),
      /Команда отклонена/,
    );
  });
});
```

Существующие describe VL-99/VL-104 (строки 231–300) и `run_shell_command` (302–308) **не правятся** — это регрессионная страховка (AC-4).

## Порядок действий

1. Правки tokenizer/цикла/комментариев в `src/agent/tools.ts` (пункты а–в).
2. `pnpm build` — strict tsc чист.
3. Вставка нового describe VL-179 в `src/agent/tools.test.mjs`.
4. Точечный прогон: `pnpm build && npx vitest run src/agent/tools.test.mjs`.
5. Полный прогон: `pnpm test` (AC-5, DoD-1/3).
6. Smoke реальных кейсов транскрипта через node (см. ниже) — AC-3.

## Как проверить

```bash
pnpm build
npx vitest run src/agent/tools.test.mjs   # VL-99/VL-104 + новые VL-179
pnpm test                                  # полный набор (AC-5)
```

Smoke на командах из транскрипта (AC-3), одна команда:
```bash
node --input-type=module -e "
import { checkShellCommandInProject } from './dist/agent/tools.js';
const cwd = process.cwd();
const falsePos = [
  'ls -la backlog/references/data/next-shadcn-admin-dashboard/src/app/\\(main\\)/dashboard/tasks/',
  'grep -rn \"AssigneeFilter\" backlog/references/data/x/src/app/\\(main\\)/dashboard/tasks/_components/columns.tsx',
];
for (const c of falsePos) console.log('ожидаем null :', checkShellCommandInProject(c, cwd));
console.log('ожидаем reject:', checkShellCommandInProject('sed -n \"1,120p\" web/../../../../../web', cwd));
"
```
Ожидание: первые две строки `null`, третья — «Команда отклонена».

## Риски

1. **Ослабление guard**: путь с `\(` и `..` наружу раньше отклонялся (случайно, через фрагмент), мог бы пройти. Закрыто: paren-unescape до проверки `..` + явный reject-тест «.. наружу из \(main\)-пути».
2. **Регрессия кавычек**: новая ветка `"(?:\\.|[^"\\])*"` иначе граничит незакрытые кавычки. Существующие тесты VL-99/VL-104 покрывают базу. Запасной вариант (если тесты падают): вернуть старые ветки кавычек и чинить только неэкранированную ветку — для AC-1/AC-3 её исправления достаточно.
3. **Ложные reject regex-паттернов**: сознательно НЕ полный shell-unescape — `\.\.` не должен стать сегментом `..`; unescape только `\( \)`; страховка — тесты `/set\|max-wall-time`, `^start`, `(foo\|bar)`.
4. **isRegexPatternToken после paren-unescape**: первый branch (`\\[метасимвол]`) срабатывает реже — покрыт существующими VL-104-тестами.
5. Работа в worktree vb/vl-179: коммитить только код (src/), backlog/ файловыми инструментами не править.

## Привязка к AC

- AC1 → шаг 1а (токенизатор).
- AC2 → тесты: unquoted/`'…'`/`"…"`/`it\'s` — все `null`.
- AC3 → тесты 5 кейсов транскрипта + smoke-команда.
- AC4 → существующие describe VL-99/VL-104 без правок + 2 новых reject-теста.
- AC5 → `pnpm test`.
- DoD-2 (документация) → JSDoc и комментарии в tools.ts.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-25 14:02
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: 2 файла (src/agent/tools.ts — токенизатор стр. 302 с backslash-ветками + paren-unescape перед путевыми проверками и правки JSDoc; src/agent/tools.test.mjs — новый describe VL-179 с 5 кейсами транскрипта, quoted/unquoted экранированием и reject-регрессиями). Существующие describe VL-99/VL-104 не правятся — регрессионная страховка. Проверка: pnpm build → vitest по tools.test.mjs → pnpm test + smoke реальных команд транскрипта через node. Риски: возможная регрессия кавычек (запасной вариант — чинить только неэкранированную ветку), ослабление guard на путях с \( и .. (закрыто paren-unescape до проверки .. + reject-тест); полный shell-unescape намеренно не делается, чтобы \.\. в regex-паттернах не стал сегментом '..'. Внешней документации по guard нет — документация обновляется JSDoc/комментариями в tools.ts.
---
author: @agent
created: 2026-10-25 14:23
---
Фаза 3 (Code) выполнена. Изменено: src/agent/tools.ts (токенизатор line ~302 с backslash-ветками "\\[^\s]" и экранированными кавычками; paren-unescape path = token.replace(/\\([()])/g) перед isRegexPatternToken/absolute/..-проверками; проверки ~ / флагов / SPECIAL_FILES оставлены на token; JSDoc checkShellCommandInProject и isRegexPatternToken дополнены про VL-179), src/agent/tools.test.mjs (новый describe VL-179: 9 allowed-кейсов из транскрипта + quoted/'-экранирование + 2 reject-теста). Коммит eb715a6. Проверки: pnpm build чист (strict tsc); npx vitest run src/agent/tools.test.mjs — 50 passed; pnpm test — 67 test files / 1165 passed + 4 skipped (итоговый блок: ещё 7 passed), exit 0; smoke из скрипт-файла против dist — 5 ложных отказов транскрипта → null, 5 истинных (web/../../../../../web, /Users/bob/Desktop, ~, $HOME, \(main\)+4×.. наружу) → reject. Отклонение от плана: в reject-тесте 3×.. из глубины src/app/(main)=3 резолвятся ровно в cwd (внутрь) — исправлено на 4×.. в тесте, код не менялся. Опыт: создан lesson-26 (smoke guard-фиксов в worktree — через скрипт-файл, т.к. MCP run_shell_command валидировался старым dist основного репо и ложно отклонял саму smoke-команду), связан с задачей. References не использовались (поле пустое). Документация (DoD-2): JSDoc/комментарии в tools.ts; CHANGELOG/документы не трогал по правилам Фазы 3 — допишет Close. Осталось: ничего.
---
<!-- COMMENTS:END -->