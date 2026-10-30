---
id: VL-249
title: 'Уборка worktree: запрет удаления собственного cwd фазы'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 02:17'
updated_date: '2026-10-30 21:33'
due_date: ''
labels:
  - agent
  - prompt
  - core
dependencies: []
milestone: ''
references: []
priority: medium
type: chore
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/tools.ts
  - src/agent/tools.test.mjs
  - src/agent/system-prompt.test.mjs
  - templates/agent-prompt.md
  - templates/phases/phase-close-worktree.md
lessons:
  - lesson-109
token_usage:
  input: 8363609
  output: 54019
  cache: 7632128
  total: 8417628
  requests: 123
  duration_ms: 1777179
  reasoning: 26744
  by_phase:
    spec:
      input: 67357
      output: 880
      cache: 61696
      requests: 3
    plan:
      input: 1715395
      output: 14298
      cache: 1418752
      requests: 29
    code:
      input: 5483482
      output: 32691
      cache: 5090816
      requests: 65
    close:
      input: 1097375
      output: 6150
      cache: 1060864
      requests: 26
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-231. В фазе Comment у VL-219 агент удалил каталог, в котором работал (`node -e rmSync`, `.vibelog/worktrees/vl-219`), получив `fatal: Unable to read current working directory`, и оставил пустой `.vibelog/worktrees/vl-219`. Добавить в правила фаз/guard shell-инструмента запрет деструктивных операций с собственным cwd, а пустой каталог worktree убрать (`git worktree prune`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Shell-guard/правила фаз отклоняют команду удаления текущего рабочего каталога агента (rmSync/rm -rf по собственному cwd, git worktree remove изнутри этого worktree) с понятной русской ошибкой, указывающей правильный способ (запуск из главного cwd)
- [x] #2 Пустой каталог .vibelog/worktrees/vl-219 удалён, git worktree list не содержит лишних записей (git worktree prune выполнен)
- [x] #3 Добавлен тест на отказ удаления собственного cwd и на отсутствие ошибки 'fatal: Unable to read current working directory'
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План реализации VL-249 — запрет удаления собственного cwd фазы

## Контекст (изучено)

- Единственная точка запуска shell у агента — `makeRunShellCommand` в `src/agent/tools.ts` (инструмент `run_shell_command`, bash -lc через `execFile`), строка ~1007-1100. Перед запуском вызывается `checkShellCommandInProject(command, cwd)` (строка ~1045); сама функция — `src/agent/tools.ts:872-1000`.
- Guard уже позиционно разбирает токены (разделители `;|&()<>` — отдельные токены, VL-201/lesson-54), знает `FILTER_COMMANDS`, `SPECIAL_FILES`, экранирование (VL-179). Расширяем ЕГО, а не добавляем второй парсер (lesson-37: одна точка логики).
- Рабочий каталог исполнения вычисляется в handler'е как `workDir` (`args.cwd` внутри проекта, иначе корень проекта) — проверку «собственный cwd» надо вести против `workDir`, а не против корня.
- Фактическое состояние `.vibelog/worktrees/vl-219`: каталог существует и **пуст**, в `git worktree list` записи нет (в списке vl-129, vl-230, vl-236, vl-249, vl-256, vl-258, vl-259). То есть `git worktree prune` сам каталог не удалит — нужен `rmdir`.
- Фаза Close идёт в главном репозитории и штатно выполняет `git worktree remove .vibelog/worktrees/<id>` (templates/phases/phase-close-worktree.md:49-52). Это легальный кейс: удаляемый путь НЕ равен cwd → guard обязан его пропускать.

## Файлы и места правок

1. **`src/agent/tools.ts`** (~1265 строк) — главная правка:
   - Новый экспорт `checkSelfCwdDestruction(command: string, workDir: string): ValidateResult` сразу после `checkShellCommandInProject` (после строки ~1000, перед JSDoc `makeRunShellCommand` ~1003).
     - Токенизация — переиспользовать ту же регулярку, что в `checkShellCommandInProject` (вынести её в модульную константу `SHELL_TOKEN_RE` и использовать в обеих функциях — не копировать строку).
     - Правило 1 (`rm`/`rmdir`): если командное слово сегмента — `rm`/`rmdir`/`unlink`/`shred` или `find … -delete`/`-exec rm`, и среди не-флаговых аргументов есть путь `p`, для которого `resolve(workDir, p)` равен `workDir` или является его предком (`workDir.startsWith(abs + sep)`) → отказ. Ловит `rm -rf .`, `rm -rf ./`, `rm -rf <абс. собственный cwd>`, `rm -rf ..`, `rm -rf .vibelog/worktrees/vl-249` изнутри vl-249.
     - Правило 2 (`git worktree remove|move`): если сегмент — `git worktree remove` (флаги `--force/-f` пропускаем) и путь аргумента резолвится в `workDir` или его предка → отказ.
     - Правило 3 (`node -e`/`--eval`/`--input-type`, а также `node` скрипт с `rmSync`): если сегмент — `node`, есть флаг eval-режима и тело скрипта содержит `rmSync|rmdirSync|fs.rm|fs.rmdir|rimraf` → собрать из тела кандидаты путей: `process.cwd()`, `'.'`, `'./'`, `'..'`, и строковые литералы `'…'`/`"…"`/`` `…` ``; если хоть один резолвится в `workDir`/предка или равен `process.cwd()` → отказ. Лексическая эвристика (как VL-99/104): динамическое построение путей не закрываем — фиксируем как остаточный риск в комментарии.
     - Текст ошибки (единый, русский, с указанием правильного способа), обязательные маркеры: «Команда отклонена: удаление собственного рабочего каталога агента (<path>)», «Запусти команду из главного каталога проекта», «git worktree remove .vibelog/worktrees/<id> — из главного репозитория», «не удаляй каталог, в котором выполняется фаза».
   - В `makeRunShellCommand` (строка ~1045): после `checkShellCommandInProject(...)` вызвать `checkSelfCwdDestruction(command, workDir)` и при не-null вернуть текст до `execFile` (никакого спавна процесса — так `fatal: Unable to read current working directory` физически невозможен).
   - Обновить JSDoc `makeRunShellCommand` и шапку модуля (строки ~1-15) — упомянуть guard собственного cwd (VL-249).
   - Экспорт `checkSelfCwdDestruction` добавить в список экспортов шапки модуля не требуется (проект не ведёт явный список), но `project_map` подхватит автоматически.

2. **`src/agent/tools.test.mjs`** (737 строк) — новый `describe('VL-249 — запрет удаления собственного cwd', ...)` в конце файла:
   - reject: `rm -rf .`, `rm -rf ./`, `rm -rf ..`, `cd . && rm -rf .` (проверка разделителя), `rm -rf <tmp cwd>` (абсолютный собственный), `node -e "require('fs').rmSync(process.cwd(),{recursive:true})"`, `node --input-type=module -e "import{rmSync}from'node:fs';rmSync('.')"`, `git worktree remove .vibelog/worktrees/vl-249` при workDir = `<tmp>/.vibelog/worktrees/vl-249`.
   - allowed (регрессии): `rm -rf dist`, `rm -rf node_modules`, `git worktree remove .vibelog/worktrees/vl-219` из корня tmp-проекта, `git worktree prune`, `git status`, `node -e "console.log(1)"`.
   - интеграция через `listLocalTools(cwd)` + handler `run_shell_command`: команда `rm -rf .` возвращает текст с «удаление собственного рабочего каталога» и каталог `cwd` остаётся на диске (`existsSync` === true), иначе (регресс) каталог был бы снесён. Отдельный assert: строка ответа не содержит `fatal: Unable to read current working directory` (AC3).
   - Каталог теста — только `mkdtempSync(join(tmpdir(), 'vibelog-vl249-'))` + `rmSync` в `afterAll` (AGENTS.md, VL-241).

3. **`templates/agent-prompt.md`** — новый буллет в список правил (рядом с правилом про backlog/worktree, строка ~15): «Не удаляй каталог, в котором работаешь: `rm -rf .`/`rmSync(process.cwd())`/`git worktree remove` по собственному worktree отклоняются инструментом. Уборка worktree — только из главного каталога проекта (`git worktree remove .vibelog/worktrees/<id>`, затем `git worktree prune`).»

4. **`src/agent/system-prompt.test.mjs`** — +1 assert: правило присутствует в собранном системном промпте (по образцу VL-115).

5. **`templates/phases/phase-close-worktree.md`** (шаг 6, строка ~49-52) — одна фраза-уточнение: `git worktree remove` выполняется ИЗ главного cwd (не изнутри worktree) — иначе guard отклонит команду.

6. **Документация** (DoD): `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` §Shell (строка 311) — абзац про третий guard: «собственный cwd» (правила 1-3 выше, единый текст отказа, остаточный риск динамических путей); `CHANGELOG.md` — запись VL-249 в Unreleased. Правки doc-10 — через `document_update` (MCP), не через edit.

## Уборка AC2 (выполняется фазой Code из ГЛАВНОГО репозитория, cwd = корень проекта)

```
rmdir .vibelog/worktrees/vl-219   # каталог пуст — rmSync не нужен
git worktree prune
git worktree list                 # нет записи vl-219 и нет лишних
ls .vibelog/worktrees             # vl-219 отсутствует
```
Порядок важен: `prune` до `rmdir` не удалит каталог (записи в git нет), поэтому сначала `rmdir`, затем `prune` (снимает возможные устаревшие admin-записи `.git/worktrees/*`).

## Порядок действий

1. Вынести `SHELL_TOKEN_RE` из `checkShellCommandInProject`, убедиться, что существующие тесты VL-99/104/179/201 зелёные (`pnpm build && pnpm test:fast -- src/agent/tools.test.mjs`).
2. Добавить `checkSelfCwdDestruction` (правила 1-3) + подключить в `makeRunShellCommand` с `workDir`.
3. Тесты в `src/agent/tools.test.mjs` (reject/allowed/интеграция), прогон файла.
4. Промпт-правило + тест системного промпта; правка шага 6 `phase-close-worktree.md`.
5. Уборка AC2 командами из блока выше.
6. Документация: doc-10 §Shell (document_update), CHANGELOG (VL-249).
7. Полный `pnpm test` (build + vitest) — единственная проверка DoD «Тесты проходят»; полный прогон один (AGENTS.md, VL-242).

## Как проверить

- `pnpm build` — типы strict.
- `pnpm test:fast -- src/agent/tools.test.mjs src/agent/system-prompt.test.mjs` — быстрый фильтр.
- `pnpm test` — полный прогон (build + vitest) перед DoD.
- Ручная проверка guard'а (обязательно через скрипт-файл, lesson-26 — MCP-обвязка валидирует старым `dist/`): `write_file` кладёт `<name>.tmp.mjs`, который импортирует `./dist/agent/tools.js`, вызывает `checkSelfCwdDestruction('rm -rf .', process.cwd())` и печатает результат; запуск `node <name>.tmp.mjs; rm <name>.tmp.mjs` (или через `bash -lc 'node <name>.tmp.mjs'`).
- Живой сценарий AC3: в отдельном tmp-каталоге через `listLocalTools(tmp)` вызвать handler `run_shell_command` с `rm -rf .` → ответ-отказ, `existsSync(tmp) === true`, в stderr нет git-фатала.

## Риски

1. **Ложные отказы** — главный риск (VL-104/179/201 — три инцидента подряд на ложных reject'ах guard'а). Митигация: отказ только когда путь резолвится в cwd ИЛИ предка; легальные `rm -rf dist`, `rm -rf node_modules/.cache`, `git worktree remove` из главного cwd покрыты allowed-тестами; правило `node -e` срабатывает только при наличии удаляющей функции в теле.
2. **Close-фаза в главном репозитории**: `git worktree remove .vibelog/worktrees/<id>` должен остаться разрешённым — путь не равен cwd главного репо. Тест-регресс обязателен.
3. **Ослабление существующих проверок** при выносе `SHELL_TOKEN_RE`: токенизатор один, поэтому риск низкий, но прогон существующих describe VL-99/104/179/201 обязателен.
4. **Динамические пути** (`node -e` с конкатенацией, base64) остаются вне лексического guard'а — фиксируется в doc-10 как остаточный риск, компенсируется правилом промпта (как в VL-99).
5. **Тесты и реальная файловая система**: интеграционный тест не должен исполнять `rm -rf` на живом пути — используется `mkdtemp` вне проекта; удаление проверяется по `existsSync`.
6. Guard видит только `run_shell_command` vb-агента; MCP/веб-чат shell не имеют (`src/web/tool-policy.ts` — только read/write/search), qwen-агент — отдельный рантайм, его ограничивает только правило промпта.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 02:24
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Уборка worktree: запрет удаления собственного cwd фазы» (было 88 символов, суммаризировано). Тип: chore (подтверждён). Масштаб: task. Приоритет: Medium. Уточнено: AC расширены до 3 проверяемых пунктов — (1) guard/правила фаз отклоняют удаление собственного cwd с понятной русской ошибкой и указанием правильного способа (из главного cwd), (2) уборка .vibelog/worktrees/vl-219 + git worktree prune, отсутствие лишних записей в git worktree list, (3) тест на отказ удаления собственного cwd и на отсутствие ошибки 'fatal: Unable to read current working directory'. Labels: agent, prompt, core. References: нет (внешних источников не упомянуто). Вопросов нет.
---
author: @agent
created: 2026-10-30 14:04
---
Фаза 2 (Plan) выполнена. Тип: chore (обычная задача, не epic).
Изучено: `makeRunShellCommand` и `checkShellCommandInProject` (`src/agent/tools.ts:872-1100`) — guard shell-команд уже позиционно разбирает токены (VL-201/lesson-54), поэтому расширяем его, а не добавляем второй парсер (lesson-37). Проверку ведём против `workDir` (аргумент `cwd` инструмента), а не против корня проекта.
Уточнение по факту: `.vibelog/worktrees/vl-219` существует и **пуст**, а в `git worktree list` записи vl-219 нет — значит `git worktree prune` каталог не удалит, нужен сначала `rmdir`, затем `prune` (порядок зафиксирован в плане).
План записан в задачу, 6 файлов + 2 документа:
1. `src/agent/tools.ts` — новый экспорт `checkSelfCwdDestruction(command, workDir)` после `checkShellCommandInProject`: вынос `SHELL_TOKEN_RE` в общую константу; правило `rm/rmdir/unlink/find -delete` (путь = cwd или его предок → отказ), правило `git worktree remove|move` (путь = cwd/предок → отказ), правило `node -e/--eval` с `rmSync|rmdirSync|fs.rm` в теле и путями `process.cwd()`/`.`/`..`; подключение в handler до `execFile` (без спавна — `fatal: Unable to read current working directory` физически невозможен); единый русский текст отказа с маркерами «удаление собственного рабочего каталога агента» + «Запусти команду из главного каталога проекта».
2. `src/agent/tools.test.mjs` — describe VL-249: 8 reject-кейсов, 5 allowed-регрессий (обязательно `git worktree remove .vibelog/worktrees/vl-219` из главного cwd — штатный шаг Close, `rm -rf dist`), интеграция через `listLocalTools` handler с проверкой `existsSync(cwd)===true` и отсутствия строки `fatal: Unable to read current working directory` (AC3); каталог теста — только `mkdtempSync`.
3. `templates/agent-prompt.md` — правило «не удаляй каталог, в котором работаешь; уборка worktree — из главного cwd».
4. `src/agent/system-prompt.test.mjs` — assert наличия правила в собранном промпте.
5. `templates/phases/phase-close-worktree.md` (шаг 6) — уточнение, что `git worktree remove` выполняется из главного cwd.
6. Документация: doc-10 §Shell (через `document_update`), CHANGELOG (VL-249).
Уборка AC2 вынесена в фазу Code (требует cwd главного репозитория): `rmdir .vibelog/worktrees/vl-219 && git worktree prune && git worktree list`.
Риски: (1) ложные отказы guard'а — три инцидента истории VL-104/179/201, митигация — отказ только при резолве пути в cwd/предка + allowed-тесты; (2) `git worktree remove` из Close должен остаться разрешённым — тест-регресс обязателен; (3) вынос общего токенизатора — прогон describe VL-99/104/179/201; (4) динамические пути в `node -e` вне лексического guard'а — остаточный риск фиксируется в doc-10; (5) guard покрывает только vb-агента (shell есть лишь в его наборе; у веб-чата — read/write/search, qwen — отдельный рантайм, там только правило промпта).
---
author: @agent
created: 2026-10-30 14:29
---
Фаза 3 (Code) выполнена. Коммит fed0e3a в ветке vb/vl-249.
Изменено:
- `src/agent/tools.ts`: новый экспорт `checkSelfCwdDestruction(command, workDir)` (три правила: rm/rmdir/unlink/shred + find -delete/-exec rm; git worktree remove|move; node с eval-флагом и телом с rmSync/rmdirSync/fs.rm — кандидаты путей process.cwd(), '.', '..', строковые литералы). Токенизатор вынесен в общую константу `SHELL_TOKEN_RE` и используется обоими guard'ами (один парсер, lesson-37). Guard подключён в `makeRunShellCommand` ПОСЛЕ проверки путей и ДО `execFile` — bash не запускается, поэтому `fatal: Unable to read current working directory` физически невозможен. Единый русский текст отказа: «удаление собственного рабочего каталога агента (<путь>)» + «Запусти команду из главного каталога проекта: git worktree remove .vibelog/worktrees/<id>, затем git worktree prune». Шапка модуля и JSDoc обновлены.
- `src/agent/tools.test.mjs`: describe «VL-249 — запрет удаления собственного рабочего каталога» — 14 reject-кейсов (rm -rf . / ./ / .., абсолютный собственный cwd, `cd . && rm -rf .`, rmdir, find -delete, find -exec rm, два node -e-варианта, git worktree remove . / абсолютный / --force) + 10 allowed-регрессий (rm -rf dist, node_modules/.cache, `git worktree remove .vibelog/worktrees/vl-219` из главного cwd — штатный шаг Close, git worktree prune/list, node -e console.log) + интеграция через handler `run_shell_command` ({command:'rm -rf .', cwd: подкаталог} → отказ, файл на месте, ответ не содержит маркера `fatal: Unable to read current working directory`), каталог — mkdtemp.
- `templates/agent-prompt.md`: правило «не удаляй каталог, в котором работаешь; уборка worktree — из главного каталога (`git worktree remove`, затем `git worktree prune`)».
- `src/agent/system-prompt.test.mjs`: +1 тест — технические токены правила (`worktree remove`, `worktree prune`, `rmSync(process.cwd())`) присутствуют в собранном промпте (ассерт на токены, не на прозу — принцип VL-130).
- `templates/phases/phase-close-worktree.md` (шаг 6): `git worktree remove` выполняется ИЗ главного cwd.
AC2 — уборка выполнена из главного репозитория: `rmdir .vibelog/worktrees/vl-219 && git worktree prune` → `git worktree list` больше не содержит записи vl-219, каталог `vl-219` в `.vibelog/worktrees` отсутствует (остались только живые worktree vl-129/230/236/249/256/258/259/263).
Проверки: `pnpm build` (tsc strict) — ок; `npx vitest run src/agent/tools.test.mjs` — 84 passed; `src/agent/system-prompt.test.mjs` (7) + `src/web/phase-prompt.test.mjs` (66) — passed; **полный прогон `pnpm test`: 97 файлов, 1807 passed / 4 skipped (пропуски пре-существующие, не связаны с задачей)**; `static.test.mjs` 7/7. Ручная проверка через dist-скрипт (lesson-26): REJECT на `rm -rf .`, `git worktree remove .`, `node -e rmSync(process.cwd())`; ALLOW на `rm -rf dist`, `git worktree prune`.
Что осталось: DoD «Документация обновлена» — не отмечен: doc-10 §Shell и CHANGELOG по правилам фазы Code обновляет Фаза Close после merge. Lesson: lesson-109 (не цитировать в тексте отказа маркер ошибки, который тест проверяет на отсутствие).
---
author: @agent
created: 2026-10-30 21:33
---
Фаза Close выполнена. Ветка vb/vl-249 слита в master (1 коммит fed0e3a + merge 2b56e30), worktree `.vibelog/worktrees/vl-249` удалён (штатный `git worktree remove` отказался из-за untracked-симлинков node_modules/backlog/references/data → `--force`, данные не терялись), ветка `vb/vl-249` удалена (-d, was fed0e3a).
Проверки после merge: `pnpm build` (tsc strict) — ок; ранний фильтр `src/agent/tools.test.mjs` (86) + `src/agent/system-prompt.test.mjs` (7) + `src/web/phase-prompt.test.mjs` (66) — 159 passed; **полный `pnpm test` (один прогон): 104 файла, 1909 passed / 4 skipped** (пропуски пре-существующие), `static.test.mjs` 8/8.
DoD: «Тесты проходят» — да (полный прогон); «Документация обновлена» — да: запись VL-249 в CHANGELOG.md (раздел Unreleased → Исправлено, коммит 38435da) и абзац «Собственный cwd (VL-249, checkSelfCwdDestruction)» в doc-10 §Ограничения → Shell (три правила, общий SHELL_TOKEN_RE, текст отказа, остаточный риск динамических путей); «Нет регрессий» — да. AC1–AC3 отмечены ранее в фазе Code. Lesson зафиксирован: lesson-109 (коммит 45efb86), связан с задачей.
---
<!-- COMMENTS:END -->