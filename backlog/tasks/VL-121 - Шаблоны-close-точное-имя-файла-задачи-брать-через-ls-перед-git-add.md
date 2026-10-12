---
id: VL-121
title: 'Шаблоны close: точное имя файла задачи брать через ls перед git add'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-12 19:13'
updated_date: '2026-10-12 21:54'
due_date: ''
labels: []
dependencies: []
milestone: v1.7
references: []
priority: low
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - templates/qwen-commands/phase-close.md
  - templates/qwen-commands/phase-close-worktree.md
  - src/web/phase-prompt.test.mjs
  - CHANGELOG.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Инцидент close VL-113: агент в шаге docs(task)-коммита угадал имя файла задачи по её заголовку (Фаза 1 переименовала заголовок — slug файла изменился) — git add упал «fatal: pathspec did not match»; агент восстановился сам за 2 хода через ls. Это классическая ловушка git+кириллица (VL-6: угаданные имена не матчатся).

Фикс — промптовый: в обоих close-шаблонах перед git add явный шаг «получи точное имя: ls backlog/tasks/{{taskId}}* и используй его; не угадывай имя по заголовку — slug может отличаться от заголовка после правок Фазы 1».
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 phase-close.md и phase-close-worktree.md: перед git add — шаг ls backlog/tasks/{{taskId}}* для точного имени файла; подсказка «не угадывай имя по заголовку задачи»
- [x] #2 phase-prompt.test.mjs: оба шаблона содержат ls-подсказку
- [x] #3 pnpm test зелёный; CHANGELOG: запись
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
Промптовый фикс: в обоих close-шаблонах перед `git add` файлов задач — явный шаг получения точного имени файла через `ls backlog/tasks/{{taskId}}*` + подсказка «не угадывай имя по заголовку задачи» (инцидент VL-113: slug файла ≠ заголовок после правок Фазы 1 → `fatal: pathspec did not match`).

## Файлы для изменения (все существуют, проверено ls)

### 1. templates/qwen-commands/phase-close.md — шаг 7 (строки 39–45)
Сейчас:
```
7. Закоммити файлы задач — каждый отдельным docs(task)-коммитом: сначала файл {{taskId}} (...), затем файлы каждой упомянутой подзадачи:
   git add <путь к файлу задачи>            ← строка 41
   git commit -m "docs(task): {{taskId}} — закрытие задачи (Done)"
   git add <путь к файлу подзадачи VL-XX>   ← строка 43
```
Правка: перед строкой 41 вставить подшаг (и заменить плейсхолдер пути):
```
   Точное имя файла получи явно: ls backlog/tasks/{{taskId}}* — и используй ВЫВЕДЕННЫЙ путь в git add. Не угадывай имя по заголовку задачи: slug файла может отличаться от заголовка после правок Фазы 1 (ловушка git+кириллица: угаданный путь не матчится → «fatal: pathspec did not match»).
   git add <вывод ls: точный путь файла задачи {{taskId}}>
```
Аналогично перед строкой 43 (подзадача VL-XX): `ls backlog/tasks/VL-XX*` → точный путь.

### 2. templates/qwen-commands/phase-close-worktree.md — шаг 11 (строки 60–64)
Сейчас строка 62: `git add backlog/tasks/{{taskId}}*.md`. Правка: перед ней добавить явный шаг (glob оставить как fallback, но первым действием — ls):
```
   ls backlog/tasks/{{taskId}}* — получи точное имя файла задачи и используй его в git add. Не угадывай имя по заголовку задачи: slug может отличаться от заголовка после правок Фазы 1 («fatal: pathspec did not match» при угадывании).
   git add backlog/tasks/{{taskId}}*.md   ← существующая строка, не трогаем
```

### 3. src/web/phase-prompt.test.mjs — новый тест в блоке с close-тестами (после describe-блока, заканчивающегося ~строка 108)
Добавить (по образцу существующих тестов, использующих `readFileSync(join(templatesDir, file))`):
```js
it('оба close-шаблона перед git add требуют ls для точного имени файла задачи (VL-121)', () => {
  for (const file of ['phase-close.md', 'phase-close-worktree.md']) {
    const text = readFileSync(join(templatesDir, file), 'utf-8');
    assert.ok(text.includes('ls backlog/tasks/{{taskId}}*'), file + ': ls-подсказка для точного имени');
    assert.ok(text.includes('Не угадывай имя по заголовку'), file + ': запрет угадывать имя по заголовку');
  }
});
```

### 4. CHANGELOG.md — раздел Unreleased
Запись: «close-шаблоны (VL-121): перед git add файлов задач — ls backlog/tasks/{{taskId}}* для точного имени; запрет угадывать slug по заголовку».

## Порядок действий
1. Правка phase-close.md (шаг 7).
2. Правка phase-close-worktree.md (шаг 11).
3. Добавить тест в phase-prompt.test.mjs.
4. Запись в CHANGELOG.md (Unreleased).
5. Проверка.
6. Коммит: `fix(prompt): VL-121 — close-шаблоны требуют ls для точного имени файла задачи` (в ветку vb/vl-121).

## Как проверить
```bash
pnpm build
node --test src/web/phase-prompt.test.mjs   # новый тест + существующие close-тесты зелёные
pnpm test                                    # полный прогон
```

## Риски
- Текстовые маркеры теста (`ls backlog/tasks/{{taskId}}*`, `Не угадывай имя по заголовку`) должны точно совпадать в шаблонах и тесте — иначе тест ложно упадёт; при правке формулировок менять оба места.
- phase-close-worktree.md: glob в git add уже срабатывает по префиксу ID — ls-шаг дублирует, но это осознанно (AC задачи + единообразие + диагностика, если glob ничего не сматчил).
- Не менять нумерацию шагов шаблонов — во внутренних ссылках (например «шаги 6–11» в close-worktree тесте) на неё полагаются.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-12 20:26
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу: 4 файла (templates/qwen-commands/phase-close.md — шаг 7, строки 41/43; templates/qwen-commands/phase-close-worktree.md — шаг 11, строка 62; src/web/phase-prompt.test.mjs — новый тест ls-подсказки в обоих шаблонах; CHANGELOG.md — запись Unreleased). Риски: текстовые маркеры теста должны точно совпадать с формулировками в шаблонах; в close-worktree glob уже матчит по префиксу ID — ls-шаг добавляется по AC для единообразия; не менять нумерацию шагов шаблонов (на неё ссылаются внутренние отсылки и тесты).
---
author: @agent
created: 2026-10-12 21:14
---
Фаза 3 (Code) выполнена. Изменено: templates/qwen-commands/phase-close.md (шаг 7 — перед git add файла задачи/подзадачи явный `ls backlog/tasks/{{taskId}}*` / `ls backlog/tasks/VL-XX*` с использованием выведенного пути + «не угадывай имя по заголовку задачи»), templates/qwen-commands/phase-close-worktree.md (шаг 11 — ls-шаг перед `git add backlog/tasks/{{taskId}}*.md`, glob оставлен как fallback), src/web/phase-prompt.test.mjs (+1 тест: оба шаблона содержат ls-подсказку и запрет угадывать), CHANGELOG.md (запись Unreleased). Коммит c0f7320 (fix(prompt): VL-121) в ветку vb/vl-121. Проверки: pnpm build — ок; node --test src/web/phase-prompt.test.mjs — 16/16; pnpm test (полный прогон) — 853/853 зелёные. Нумерация шагов шаблонов не менялась (внутренние отсылки и тесты целы). Что осталось: ничего; запись CHANGELOG и docs-документацию при необходимости дособьёт Фаза Close (VL-126).
---
author: @agent
created: 2026-10-12 21:29
---
Фаза Close выполнена. Ветка vb/vl-121 слита в master (1 коммит c0f7320; merge-коммит f23f477 — конфликт в CHANGELOG.md разрешён вручную пользователем), worktree удалена (--force: только untracked-симлинки node_modules/refs), ветка удалена. Проверки после merge: pnpm build — ок; pnpm test — 866/866 зелёные (единичное падение static.test.mjs в первом прогоне — флейк, в повторе и одиночном запуске проходит). DoD отмечено всё (3/3). CHANGELOG.md: запись Unreleased добавлена в составе merge-коммита f23f477, отдельный docs-коммит не потребовался; документы backlog/docs не менялись (изменение — промптовые подсказки в close-шаблонах).
---
<!-- COMMENTS:END -->