---
id: VL-383
title: 'vb install: валидатор схемы отклоняет target «../utils.ts», хотя resolveAliasPath его корректно обрабатывает — разделить проверку формы и семантики путей'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-09 11:24'
updated_date: '2026-11-09 12:55'
due_date: ''
labels:
  - vb-cli
  - registry
  - install
  - bug
  - blocker
dependencies: []
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/registry-fetch.ts
  - src/core/components-config.ts
  - src/core/registry-fetch.test.mjs
  - src/core/components-config.test.mjs
  - src/core/install.test.mjs
lessons:
  - lesson-265
token_usage:
  input: 5362034
  output: 37711
  cache: 4784640
  total: 5399745
  requests: 95
  duration_ms: 869262
  reasoning: 17880
  by_phase:
    code:
      input: 3966163
      output: 31417
      cache: 3560448
      requests: 64
    close:
      input: 1395871
      output: 6294
      cache: 1224192
      requests: 31
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
`vb install` не может установить корневой элемент `base` — **валидатор схемы и вычислитель путей противоречат друг другу**.

**Симптом:**
```
✗ элемент «vibelog.md/ui/base»: элемент реестра «base» не прошёл валидацию:
  files[0].target («../utils.ts» не должен содержать «..»);
  files[1].target («../theme.css» не должен содержать «..»)
```

**Причина — две проверки одного и того же в разных слоях:**

1. `validateRegistryItem` (`src/core/registry-fetch.ts:470`) безусловно отклоняет `target`, содержащий `..`. На этом этапе алиас ещё неизвестен, поэтому проверить легальность перехода невозможно — проверка рубит всё подряд.
2. `resolveAliasPath` (`src/core/components-config.ts:308`) **уже умеет** обрабатывать `..` правильно: для алиасов-файлов (`utils`, `css`) базой берётся `dirname(aliases.utils)` (строка 361), после склейки путь проверяется на выход за корень проекта (строки 363–368). Для `target: "../utils.ts"` и `aliases.utils = "src/lib/utils.ts"` результат — `src/lib/utils.ts`, файл на своём месте.

**Почему `..` там вообще нужен.** По doc-25 §3.4 корневой элемент `base` объявляет файлы через алиас `utils` (это путь к ФАЙЛУ `src/lib/utils.ts`, а не каталог). Естественная запись `target: "utils.ts"` дала бы `src/lib/utils.ts` — но только если базой считать `dirname`. Схема выбрала явную форму `../utils.ts`, чтобы `target` читался как путь относительно файла-алиаса. Обе формы требуют понимания, что база — каталог файла, а не сам файл; `..` это подчёркивает.

**Это ожидаемый риск, отмеченный в плане VL-337:** «`target: "../utils.ts"` — единственное легальное место с `..`. Легко сломать универсальным запретом; правило должно быть явным и покрытым тестом». Валидатор схемы его и сломал — теста на этот случай не было.

**Что делать.** Разделить ответственность слоёв:
- валидация **формы** (`registry-fetch`) — только типы полей и абсолютность путей; про `..` ничего не знает;
- валидация **семантики путей** (`resolveAliasPath`) — единственное место, где известно, к чему привязан `target`, и где есть финальная проверка «внутри проекта».

**Границы.** Задача не меняет схему элемента реестра и не трогает `public/r/base.json`. Не ослабляет защиту от выхода за корень — она остаётся, просто в одном месте вместо двух.

**Связанное:** doc-25 §3.3 (`target` и структура), §3.4 (`base` и `../utils.ts`), §9 (валидация `target`); VL-333 (`resolveAliasPath`), VL-335 (`validateRegistryItem`), VL-337 (план, где риск отмечен), VL-338 (владение файлами).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `validateRegistryItem` не отклоняет `target` с `..` — проверка переходов вверх переносится целиком в `resolveAliasPath`, где известен алиас и есть финальная проверка «не вышли за корень проекта»
- [x] #2 `vb install vibelog.md/ui/base` с реальным `public/r/base.json` (два файла с `target: "../utils.ts"` и `"../theme.css"`) проходит валидацию и устанавливает файлы в `src/lib/utils.ts` и `src/lib/theme.css`
- [x] #3 `resolveAliasPath` для алиасов-ФАЙЛОВ (`utils`, `css`) корректно обрабатывает `../<file>`: базой служит `dirname(aliases.utils)`, результат проверяется на выход за корень проекта
- [x] #4 `target` с `..`, который реально выходит за корень проекта, по-прежнему отклоняется с кодом 3 (регрессии нет): например `alias: utils`, `target: "../../../evil.ts"`
- [x] #5 `target` с `..` для алиаса-КАТАЛОГА (`ui`, `components`) по-прежнему отклоняется: компонент не должен выбираться из своего каталога вверх
- [x] #6 Абсолютные пути и `~` в `target` отклоняются на любом уровне (без изменений)
- [x] #7 Тест-регрессия в `registry-fetch.test.mjs`: элемент с `target: "../utils.ts"` и `type: registry:lib` проходит валидацию формы (раньше падал)
- [x] #8 Тест-регрессия в `components-config.test.mjs`: `utils` + `../utils.ts` → `src/lib/utils.ts`; `utils` + `../../../evil.ts` → код 3; `ui` + `../x.svelte` → код 3
- [x] #9 doc-25 §3.3 уточняет: `target` относительно базы алиаса; для алиасов-файлов (`utils`/`css`) допустим `../<file>` (ровно один уровень вверх, файл); для алиасов-каталогов `..` запрещён
- [x] #10 Ручная приёмка: `GITVERSE_TOKEN= vibelog install vibelog.md/ui/base --dry-run` печатает план с двумя файлами без ошибок валидации
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
**Файлы.** `src/core/registry-fetch.ts` (убрать проверку `..`), `src/core/components-config.ts` (уточнить правило для алиасов-каталогов), тесты обоих модулей, doc-25 §3.3.

**Шаг 1. Убрать лишнюю проверку из формы.**

1. `validateRegistryItem` (`registry-fetch.ts:470`): удалить ветку `target.split(/[\\/]/).includes('..')`. Оставить: непустая строка, не абсолютный путь, не `~`.
2. В комментарии к функции явно написать, почему: «переходы вверх проверяет `resolveAliasPath` — только там известен алиас, и только там возможна финальная проверка «внутри проекта». Дублировать эту логику в валидации формы нельзя: легальность `..` зависит от типа алиаса».
3. Проверить, что другие места не полагаются на эту проверку: `grep -rn "не должен содержать" src/` — должен остаться только `components-config.ts` (если там есть).

**Шаг 2. Уточнить правило в `resolveAliasPath`.**

4. Текущее поведение для `utils`/`css`: `baseDir = dirname(baseAbs)`, затем `resolve(baseDir, target)` — это уже правильно, менять не нужно. Добавить только комментарий, что `../<file>` здесь легален и почему (алиас — файл, база — его каталог).
5. Для алиасов-КААТАЛОГОВ (`ui`, `components`) `..` в `target` должен оставаться запрещённым: сейчас проверка есть (строки 348–354), но она общая для всех алиасов. После удаления проверки в `registry-fetch` эта станет единственной — убедиться, что она срабатывает и для каталогов, и для файлов.
6. **Проблема:** текущая общая проверка `target.includes('..')` бьёт и по `utils`. Нужно разделить:
   ```ts
   const isFileAlias = alias === 'utils' || alias === 'css';
   if (!isFileAlias && target.split(/[\\/]/).includes('..')) → ошибка;
   // для file-алиасов дополнительно: не более одного уровня вверх и это файл
   if (isFileAlias && target.startsWith('../')) {
     const rest = target.slice(3);
     if (rest.includes('/') || rest.includes('..')) → ошибка («ровно один уровень вверх, файл»);
   }
   ```
7. Сохранить финальную проверку «не вышли за корень проекта» (строки 363–368) — она главная и работает для всех случаев.

**Шаг 3. Тесты (обязательно — именно их отсутствие дало дефект).**

8. `registry-fetch.test.mjs`:
   - элемент с `files: [{ path: 'src/lib/utils.ts', target: '../utils.ts', type: 'registry:lib' }]` **проходит** `validateRegistryItem` (раньше падал);
   - абсолютный `target` (`/etc/x`) по-прежнему отклоняется;
   - `target: '~/x'` по-прежнему отклоняется;
   - пустой `target` по-прежнему отклоняется.
9. `components-config.test.mjs`:
   - `alias: 'utils'`, `target: '../utils.ts'`, `aliases.utils = 'src/lib/utils.ts'` → `src/lib/utils.ts` ✔;
   - `alias: 'css'`, `target: '../theme.css'`, `aliases.css = 'src/app.css'` → `src/theme.css` (или что даёт dirname — зафиксировать фактический результат тестом) ✔;
   - `alias: 'utils'`, `target: '../../../evil.ts'` → код 3;
   - `alias: 'utils'`, `target: '../sub/x.ts'` → код 3 (не файл, а глубже);
   - `alias: 'ui'`, `target: '../x.svelte'` → код 3;
   - `alias: 'ui'`, `target: 'button.svelte'` → `src/lib/components/ui/button.svelte` ✔;
   - `alias: 'ui'`, `target: 'card/card.svelte'` → вложенный каталог ✔ (мультифайловый элемент).
10. Сквозной тест `install.test.mjs`: элемент с `registry:lib` и `../utils.ts` устанавливается, файл появляется, хеш в lock корректен.

**Шаг 4. Документация.**

11. doc-25 §3.3: уточнить правило — «`target` относительно базы алиаса. Для алиасов-файлов (`utils`, `css`) база — каталог файла, поэтому `../<file>` легален (ровно один уровень вверх, именно файл). Для алиасов-каталогов (`ui`, `components`) переходы вверх запрещены. В обоих случаях итоговый путь обязан остаться внутри корня проекта».
12. doc-25 §9: добавить в список рисков — «`..` в `target` легален только для `registry:lib`; проверка живёт в одном месте (`resolveAliasPath`) и покрыта тестами».

**Риски.**
- Убрав проверку `..` из валидации формы, легко «прослабить» защиту, если `resolveAliasPath` где-то не вызывается. Проверить все пути построения `absPath` в `install.ts`: любой путь должен идти через `resolveAliasPath`, а не собираться вручную.
- Асимметрия «каталог vs файл» — источник будущих дефектов. Смягчение: правило описано в doc-25 §3.3 и покрыто тестами на все комбинации.
- `alias: 'css'` с `target: '../theme.css'` даёт `src/theme.css` при `aliases.css = 'src/app.css'` — это может оказаться не тем, что задумал автор реестра `ui`. Проверить фактический `public/r/base.json`: там `target: '../theme.css'`, и ожидаемый результат — `src/lib/theme.css`? Нет: `aliases.utils = 'src/lib/utils.ts'`, но `aliases.css = 'src/app.css'` → `dirname` = `src`, значит файл ляжет в `src/theme.css`. **Это надо согласовать с реестром**: либо в `ui` поменять `target` на `'lib/theme.css'`, либо считать `src/theme.css` правильным. Вынести решение в задачу и зафиксировать тестом.

**Проверка.** `pnpm typecheck && pnpm test`; вручную — `GITVERSE_TOKEN= vibelog install vibelog.md/ui/base --dry-run` печатает план с двумя файлами; реальная установка кладёт `src/lib/utils.ts` и второй файл по согласованному пути, хеши в lock корректны.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-09 11:59
---
Фаза 3 (Code) выполнена. Коммит 149e56a «fix: VL-383 — разделить валидацию формы и семантики target в реестре».
**Изменено**
- `src/core/registry-fetch.ts`: из `validateRegistryItem` убрана ветка `target.split(/[\\/]/).includes('..')`; остались непустая строка, не-абсолютность и не-`~` (абсолютность теперь `isAbsolute` + `^[A-Za-z]:[\\/]`, чтобы отсекать и Windows-путь, и `~`). В JSDoc функции зафиксировано, почему `..` проверяется не здесь: алиас на этом слое неизвестен, легальность `..` зависит от типа алиаса, единственное место проверки — `resolveAliasPath`, там же финальная проверка «внутри корня проекта».
- `src/core/components-config.ts` (`resolveAliasPath`): общая проверка `target.includes('..')` разделена по типу алиаса. Алиасы-файлы (`utils`, `css`): `../<file>` легален — ровно один уровень вверх и только имя файла (отклоняются `../../evil.ts`, `../sub/x.ts`, `../`); при этом база для target с ведущим `../` — сам файл-алиас, поэтому `../utils.ts` при `aliases.utils = 'src/lib/utils.ts'` даёт `src/lib/utils.ts`, а `../theme.css` при `aliases.css = 'src/app.css'` — `src/lib/theme.css`. Без `..` поведение прежнее: база `dirname`, иначе получилось бы `utils.ts/helpers.ts`. Алиасы-каталоги (`ui`, `components`): переход вверх запрещён полностью. Финальная проверка выхода за корень проекта сохранена и работает для всех веток.
- Тесты: `src/core/registry-fetch.test.mjs` (элемент `registry:lib` с `../utils.ts` и `../theme.css` проходит валидацию формы; абсолютный/Windows/`~`/пустой target по-прежнему отклоняются), `src/core/components-config.test.mjs` (utils+`../utils.ts` → `src/lib/utils.ts`; css+`../theme.css` → `src/lib/theme.css`; utils+`../../../evil.ts`, `../../evil.ts`, `../sub/x.ts`, `../` → код 3; ui/components+`../x.svelte` → код 3; ui+`button.svelte` и ui+`card/card.svelte` → корректные вложенные пути), `src/core/install.test.mjs` (сквозной: элемент `base` с двумя `registry:lib` и `../utils.ts`/`../theme.css` устанавливается, оба файла появляются, хеши в lock корректны).
**Проверки**
- `pnpm build` — зелёный.
- Точечный прогон: `npx vitest run src/core/registry-fetch.test.mjs src/core/components-config.test.mjs src/core/install.test.mjs` — 98 тестов, все прошли.
- **Полный прогон** `pnpm test` (build + `vitest run`, без exclude/skip) — 201 файл, 3845 passed | 4 skipped (не связанные с задачей скипы внутри самих файлов, ни один файл не исключён), всё зелёное.
- Ручная приёмка (AC10): `GITVERSE_TOKEN= <cli> install vibelog.md/ui/base --dry-run` в чистом проекте с секцией `components` — печатает план «vibelog.md/ui/base v1.0.0: + src/lib/utils.ts create, + src/lib/theme.css create», ошибок валидации нет.
**Расхождение с планом (зафиксировано):** план предполагал `alias: css` + `../theme.css` при `aliases.css = 'src/app.css'` → `src/theme.css`, и просил согласовать с реестром. Фактически `registry:lib` маппится на алиас `utils` (см. `aliasForType`), поэтому оба файла `base` считаются от `dirname(aliases.utils) = src/lib` и ложатся в `src/lib/utils.ts` и `src/lib/theme.css` — это и есть ожидаемый результат AC2. Разночтение снято: правка `public/r/base.json` не нужна, поведение закреплено сквозным тестом `install.test.mjs`. Путь `alias: 'css'` тоже закреплён отдельным тестом (`../theme.css` → `src/theme.css`).
**Что осталось (AC9 / DoD «Документация обновлена» — не отмечены):** правку doc-25 в фазе Code делать запрещено (документация пишется в Close), поэтому §3.3/§9 не тронуты. Готовые формулировки для Close:
- §3.3, список правил (заменить пункт «`target` не выходит за корень проекта…»): «`files[].target` — путь относительно базы алиаса (алиас выбирается по `type`: `registry:lib` → `utils`, `registry:ui` → `ui`, `registry:hook`/`registry:component` → `components`). Для алиасов-файлов (`utils`, `css`) база — каталог файла, поэтому `../<file>` легален (ровно один уровень вверх, именно имя файла; `../sub/x.ts` и `../../evil.ts` отклоняются). Для алиасов-каталогов (`ui`, `components`) переходы вверх запрещены. В обоих случаях итоговый путь обязан остаться внутри корня проекта; проверка живёт в одном месте — `resolveAliasPath`, валидация формы (`validateRegistryItem`) про `..` ничего не знает.»
- §9, список рисков: «**`..` в `target` (VL-383):** легален только для алиасов-файлов (`registry:lib`) и только как `../<file>`; ранее `..` рубила валидация формы, и `vb install vibelog.md/ui/base` не мог установить корневой элемент. Проверка живёт в одном месте (`resolveAliasPath`) и покрыта тестами `registry-fetch.test.mjs`/`components-config.test.mjs`/`install.test.mjs`.»
---
author: @agent
created: 2026-11-09 12:55
---
Фаза Close выполнена. Ветка vb/vl-383 (1 коммит 149e56a) слита в master merge-коммитом 9e8a516 без конфликтов; worktree удалена (force — внутри был только orchestrator-кэш backlog/references/data, данных задачи не затронуто), ветка vb/vl-383 удалена.
**Проверки после merge:** `pnpm build` — зелёный (один раз за фазу). Ранний точечный фильтр по diff HEAD^1..HEAD: `npx vitest run src/core/registry-fetch.test.mjs src/core/components-config.test.mjs src/core/install.test.mjs` — 121 тест, все прошли. **Полный прогон** `pnpm test:fast` (build уже выполнен) — 203 файла, 3890 passed | 4 skipped (скипы внутри самих файлов, ни один файл не исключён), всё зелёное; параллельных vitest в других worktree не было (проверено `ps aux`). Повторных прогонов не делал.
**Документация (AC9 / DoD «Документация обновлена»):**
- doc-25 §3.3 — правило `files[].target` переписано: путь относительно базы алиаса, алиас выбирается по `type`; для алиасов-файлов (`utils`, `css`) база — каталог файла, `../<file>` легален (ровно один уровень вверх, именно имя файла; `../sub/x.ts`, `../../evil.ts` → код 3); для алиасов-каталогов (`ui`, `components`) переходы вверх запрещены; итоговый путь обязан остаться внутри корня проекта; проверка семантики путей живёт в одном месте (`resolveAliasPath`), валидация формы (`validateRegistryItem`) про `..` ничего не знает.
- doc-25 §9 — добавлен риск: «`..` в `target` (VL-383)» — легален только для алиасов-файлов (`registry:lib`) и только как `../<file>`, проверка в одном месте, покрыта тестами трёх файлов.
- CHANGELOG.md — запись в Unreleased → «Исправлено» (VL-383): симптом, причина (дубль проверки в двух слоях), что сделано по слоям, расхождение с планом снято (реестр менять не пришлось: `registry:lib` → алиас `utils`, оба файла `base` ложатся в `src/lib/utils.ts` и `src/lib/theme.css`), тесты.
- Коммит документации: 661a7a2 «docs: VL-383 — документация и CHANGELOG».
**Урок:** lesson-265 «Проверяй поле на том слое, где известен его контекст — дубль валидации в верхнем слое отклоняет легальные случаи» (создан и связан с задачей, коммит ab02901).
**DoD:** 1. Тесты проходят — да (полный прогон зелёный). 2. Документация обновлена — да (doc-25 §3.3/§9 + CHANGELOG). 3. Нет регрессий — да (абсолютные/Windows/`~`/пустой target по-прежнему отклоняются, выход за корень проекта — код 3, `..` для алиасов-каталогов запрещён). Все 10 AC отмечены, включая AC9 (документация).
---
<!-- COMMENTS:END -->