---
id: VL-390
title: 'vb create: установка компонентов шаблона игнорирует registryDependencies — base не ставится, button не собирается'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-09 19:16'
updated_date: '2026-11-09 19:42'
due_date: ''
labels:
  - vb-cli
  - create
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
  - src/core/install-chain.ts
  - src/core/create.ts
  - src/core/create.test.mjs
  - src/cli/commands/install.ts
lessons:
  - lesson-266
token_usage:
  input: 6356453
  output: 71234
  cache: 5682688
  total: 6427687
  requests: 91
  duration_ms: 1193334
  reasoning: 45385
  by_phase:
    code:
      input: 5053065
      output: 64618
      cache: 4505088
      requests: 60
    close:
      input: 1303388
      output: 6616
      cache: 1177600
      requests: 31
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
`vb create` устанавливает компоненты шаблона **без их `registryDependencies`** — в результате `button` ставится, а `base` (от которого он зависит) — нет.

**Симптом (реальная приёмка):**
```
✓ Установлены компоненты: vibelog.md/ui/button
```
но в проекте:
```
src/lib/
├── assets/
├── components/     ← button.svelte есть
└── index.ts
```
`utils.ts` и `theme.css` **отсутствуют**, `installed.lock.json` содержит только `button` с `"dependencies": []`.

При этом тот же элемент вручную ставится правильно:
```
$ vibelog install vibelog.md/ui/base
✓ Записан: src/lib/utils.ts
✓ Записан: src/lib/theme.css
✓ Обновлён lock: .vibelog/installed.lock.json (base v1.0.0)
```

**Корень** — `src/core/create.ts`, `installTemplateComponents` (строки ~760–772):
```ts
const item = await fetchInstallItem(ctx);
const contents = await fetchInstallContents(ctx, item);
const plan = buildInstallPlan(ctx.root, config, lock, item, contents, ref);
skipAllConflicts(plan, lock);
applyInstallChain(ctx.root, config, lock, [plan]);   // ← массив из ОДНОГО плана
```
Нет вызова `resolveRegistryDeps` — вся цепочка зависимостей пропущена. `runInstall` (`src/cli/commands/install.ts`) её делает, `installTemplateComponents` — нет.

**Последствия шире, чем «нет utils.ts»:**
1. `button.svelte` импортирует `cn` из `../utils` — без `base` компонент **не собирается** (пользователь и получил `Cannot find module`).
2. `clsx` и `tailwind-merge` (объявлены в `dependencies` элемента `base`) не устанавливаются — `package.json` проекта остаётся без них.
3. В `lock` у `button` пустой `dependencies`, хотя фактически он зависит от пакетов `base`.

**Вторая часть — про импорт.** Пользователь пробовал `import { Button } from '$lib/components/ui/button'` и получал `Cannot find module`. Причина: `button.svelte` экспортирует **default** (обычное поведение Svelte-компонента), а не именованный экспорт; плюс Vite не резолвит `.svelte` без расширения. Правильная форма — `import Button from '$lib/components/ui/button.svelte'`. Это дефект демо-страницы в шаблоне (`Vibelog-md/templates`) и пробел в документации — вынести отдельно, здесь только зафиксировать.

**Границы.** Не меняет `runInstall` (там путь правильный) и не трогает шаблон. Задача — привести `installTemplateComponents` к той же последовательности, что использует обычная установка.

**Связанное:** VL-337 (ядро `install`), VL-338 (`registryDependencies`, `resolveRegistryDeps`, `applyInstallChain`), VL-339 (`vb create`), doc-25 §4.1 шаги 11–12 (`postCreate` → установка `vibelog.components`), §3.3 (`registryDependencies`, один уровень).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `installTemplateComponents` (путь `vb create`) резолвит `registryDependencies` так же, как обычный `vb install`: вызывает `resolveRegistryDeps` и применяет цепочку «зависимости → элемент» единой транзакцией
- [x] #2 При шаблоне с `vibelog.components: ["vibelog.md/ui/button"]` в свежем проекте устанавливаются ОБА элемента: сначала `base` (`src/lib/utils.ts`, `src/lib/theme.css`), затем `button` (`src/lib/components/ui/button.svelte`)
- [x] #3 `installed.lock.json` после `vb create` содержит обе записи: `base` с двумя файлами и `button` с одним, с корректными хешами
- [x] #4 npm-зависимости ставятся для всей цепочки: `clsx` и `tailwind-merge` из `base` попадают в `package.json` проекта (сейчас `dependencies: []` у button, и пакеты не установлены)
- [x] #5 Порядок сохранён: `base` на месте до `button` — `button` ссылается на `./utils` и без `base` не соберётся
- [x] #6 Если зависимость установить не удалось, ошибка попадает в `failed` с указанием, какой элемент и какая зависимость, — а не молчаливое «установлено: button»
- [x] #7 Поведение при уже установленной зависимости сохранено: повторный `vb create` в проекте, где `base` есть, не переустанавливает его
- [x] #8 Единый путь: `installTemplateComponents` переиспользует ту же последовательность, что `runInstall` (резолв зависимостей → сверка npm → конфликты → единый `applyInstallChain`), без второй копии логики
- [x] #9 Тест-регрессия в `create.test.mjs`: шаблон с компонентом, у которого `registryDependencies: ["vibelog.md/ui/base"]`, на локальном HTTP-фикстуре → устанавливаются оба элемента, в lock две записи
- [ ] #10 Ручная приёмка: `vibelog create testapp --template vibelog.md/templates/svelte-minimal` в пустом каталоге → в `src/lib/` появляются `utils.ts` и `theme.css`, в `src/lib/components/ui/` — `button.svelte`, импорт в `+page.svelte` резолвится
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
**Стратегия.** Не копировать логику из `runInstall` в `installTemplateComponents`, а вынести общую последовательность в ядро. Иначе через месяц они разойдутся снова — ровно как сейчас разошлись.

**Файлы.** `src/core/create.ts` (`installTemplateComponents`), новый `src/core/install-chain.ts` (общий оркестратор) либо расширение `src/core/install.ts`, `src/cli/commands/install.ts` (перевести на общий оркестратор), `src/core/create.test.mjs`, `src/cli/install-*.test.mjs`.

**Шаг 1. Вынести общую последовательность установки.**

1. В `src/core/install.ts` (или новом `install-chain.ts`) объявить `installWithDeps(options): Promise<InstallChainOutcome>` с параметрами: `root`, `config`, `lock`, `ref` (строка `alias/repo/name`), `fetchOptions`, `depsRunner`/`resolveDeps` (для сверки npm-зависимостей), `onConflict` (стратегия разрешения). Возвращает: `{ plans, installed, skipped, failed, lock }`.
2. Внутри — ровно та последовательность, что сейчас в `runInstall`:
   - `fetchInstallItem` → `fetchInstallContents`;
   - `buildInstallPlan`;
   - `resolveRegistryDeps` (цепочка зависимостей);
   - `checkChainOwnership`;
   - сверка `dependencies` с `package.json` (`readProjectDeps`/`missingDeps`/`detectPackageManager`);
   - разрешение конфликтов (в `create` — `skipAllConflicts`, в `runInstall` — интерактив);
   - `applyInstallChain` единой транзакцией.
3. Стратегию конфликтов передавать функцией — это единственное реальное различие между `create` и `install`.

**Шаг 2. Перевести оба пути на оркестратор.**

4. `runInstall` (`src/cli/commands/install.ts`): заменить тело на вызов `installWithDeps` с интерактивной стратегией конфликтов и печатью плана. Печать (`printPlan`, прогресс) остаётся в CLI — ядро не печатает.
5. `installTemplateComponents` (`src/core/create.ts`): заменить тело на `installWithDeps` с `skipAllConflicts` как стратегией. Логику ошибок (`failed[]`) сохранить: одна неудача не отменяет остальные компоненты.
6. Пакетные менеджеры: в `create` зависимости уже установлены через `pm install` до `postCreate`, поэтому `installWithDeps` должен уметь «поставить недостающие пакеты» — либо использовать уже определённый `pm` и раннер из `createProject`. Передавать их параметрами, не детектить повторно.

**Шаг 3. Порядок и lock.**

7. Убедиться, что `lock` перечитывается между элементами `vibelog.components`: после установки `base` (как зависимости `button`) он должен попасть в lock и не переустанавливаться для следующего компонента.
8. Проверить, что при `vibelog.components: [a, b]`, где `b` зависит от `a`, `a` не ставится дважды (`alreadyInstalled` из `resolveRegistryDeps`).

**Шаг 4. Тесты.**

9. `create.test.mjs`, локальный HTTP-фикстур: шаблон с `components: ['vibelog.md/ui/button']`, `button` объявляет `registryDependencies: ['vibelog.md/ui/base']` → после `installTemplateComponents`:
   - в `src/lib/` есть `utils.ts` и `theme.css`;
   - в `src/lib/components/ui/` есть `button.svelte`;
   - `lock.components` содержит `base` (2 файла) и `button` (1 файл);
   - `rootDeps`/`package.json` содержит `clsx`, `tailwind-merge` (или мок раннера вызван с этими пакетами).
10. Регрессия: `runInstall` после рефакторинга проходит все существующие тесты `install*.test.mjs` без правок ожиданий.
11. Порядок: `lock.components` содержит `base` до `button` при переборе (или проверить, что `base` установлен первым по порядку `applyInstallChain`).
12. Ошибка зависимости не отменяет установку проекта целиком: `failed` содержит пару «элемент → причина».
13. Повторный вызов `installTemplateComponents` не переустанавливает `base` (`alreadyInstalled`).

**Шаг 5. Документация.**

14. doc-25 §4.1 шаг 12: «установка `vibelog.components` использует ту же последовательность, что `vb install`, включая `registryDependencies`, сверку npm-зависимостей и единую транзакцию».
15. `CHANGELOG.md`.

**Риски.**
- Рефакторинг затрагивает **работающий** `vb install` — риск сломать то, что сейчас исправно. Защита: сначала вынести оркестратор и перевести на него `installTemplateComponents` (там сейчас баг), прогнать его тесты, и только потом трогать `runInstall`. Если тесты `runInstall` после перевода не зелёные — откатывать второй шаг, оставив `create` на новом пути.
- `installWithDeps` не должен печатать (ни прогресс, ни план) — иначе `create` получит чужой вывод. Печать — только в CLI-слое.
- Интерактив: `create` не должен спрашивать про конфликты (в свежем проекте их нет), но при `--yes` и существующем файле поведение `vb install` — «пропустить с предупреждением». Убедиться, что стратегия `skipAllConflicts` даёт тот же итог.
- Перечитывание lock между элементами: `applyInstallChain` возвращает обновлённый lock — использовать его, а не исходный объект, иначе второй элемент «не увидит» первый.
- `pnpm`/`npm` раннер в `create` уже определён и использован для `install`; повторный `detectPackageManager` вернёт то же, но лучше передать явно, чтобы не зависеть от lock-файла в `targetDir`.

**Проверка.** `pnpm typecheck && pnpm test`; вручную — `vibelog create testapp --template vibelog.md/templates/svelte-minimal` в пустом каталоге: в `src/lib/` есть `utils.ts` и `theme.css`, в lock две записи, `package.json` содержит `clsx` и `tailwind-merge`; затем `npm run dev` и страница с `import Button from '$lib/components/ui/button.svelte'` собирается.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-09 19:36
---
Фаза 3 (Code) выполнена. Коммит e3ef5a5.
**Что сделано (по плану):**
1. Новый общий оркестратор `src/core/install-chain.ts` — `installWithDeps(options)`: манифест → файлы → `buildInstallPlan` → `resolveRegistryDeps` → `checkChainOwnership` → сверка npm-зависимостей (`readProjectDeps`/`missingDeps`, pm передаётся параметром) → стратегия конфликтов (`onConflict`) → `transferOwnership` → единый `applyInstallChain`. Возвращает `{ item, plans, depCount, reuses, alreadyInstalled, warnings, deps, transferred, results, lock }`. Ядро НИЧЕГО не печатает: прогресс/план/итог — через хуки и возвращаемые данные, печать осталась в CLI.
2. `src/cli/commands/install.ts`: `runInstall` переведён на `installWithDeps` (интерактивная стратегия конфликтов + `--force`/`--yes`, вопрос про пакеты через `deps.confirm`, печать плана в `hooks.onPlanReady` с сохранением прежнего порядка вывода — планы и npm-секция печатаются ДО вопроса об установке пакетов). Код выхода и все тексты сохранены.
3. `src/core/create.ts`: `installTemplateComponents` переведена на `installWithDeps` со стратегией `skipAllConflicts`, `confirm: () => true` (пакеты проекта уже поставлены `pm install` до `postCreate`), `onUnresolved: 'throw'` — неудача с пакетами попадает в `failed[]` с указанием элемента и пакетов, а не в молчаливое «установлено». Lock перечитывается из результата оркестратора между компонентами. `packageManager`/`depsRunner` передаются параметрами из `createProject`, повторного `detectPackageManager` нет.
4. Тесты (`src/core/create.test.mjs`, +4 кейса на локальном `node:http`-фикстуре): base+button ставятся цепочкой (utils.ts/theme.css/button.svelte), в lock две записи (2 и 1 файл), `clsx`/`tailwind-merge` попадают в `package.json` одной командой; неудача npm → `failed` с причиной и без изменений на диске; повторный вызов не переустанавливает `base` (installedAt сохранён); два компонента шаблона — `base` ставится один раз.
**Проверки:** `pnpm build` — ок; `pnpm test` — полный прогон без исключений: 203 файла, 3933 passed, 4 skipped, падений нет. Затронутые наборы (`install.test.mjs`, `install-registry-deps.test.mjs`, `install-progress.test.mjs`, `install-deps.test.mjs`, `create.test.mjs`) зелёные без правок ожиданий — регрессий `vb install` нет.
**Что осталось:** AC10 (ручная приёмка `vibelog create testapp --template vibelog.md/templates/svelte-minimal` с реальным реестром и `npm run dev`) не выполнялась — требует сети/реального реестра компонентов, в фазе Code недоступна. DoD «Документация обновлена» не отмечен: по правилам фазы 3 doc-25 §4.1 шаг 12 и CHANGELOG.md пишет фаза Close.
---
author: @agent
created: 2026-11-09 19:42
---
Фаза Close выполнена. Ветка vb/vl-390 слита в master (1 коммит e3ef5a5, merge --no-ff без конфликтов), worktree удалена (с --force: единственный untracked-путь — симлинк backlog/references/data, данные не теряются), ветка vb/vl-390 удалена.
**Проверки после merge:** `pnpm build` — ок; ранний точечный фильтр по diff (src/core/create.test.mjs, src/core/install*.test.mjs) — 5 файлов, 107 тестов зелёные; полный прогон `vitest run` — 204 файла, 3941 passed, 4 skipped, падений нет. Регрессий `vb install` нет.
**Документация:** doc-25 §4.1 шаг 13 (установка `vibelog.components` использует ту же последовательность, что `vb install`: `registryDependencies`, сверка npm-зависимостей, единая транзакция, общий оркестратор `installWithDeps`, различия — параметрами) и запись в CHANGELOG.md (Unreleased → Исправлено) — коммит f8044b2.
**Урок:** дополнен существующий lesson-266 (общая функция/конвейер для всех команд вместо копии) — коммит a581d42.
**DoD:** 1 «Тесты проходят» — полный прогон зелёный; 2 «Документация обновлена» — doc-25 + CHANGELOG; 3 «Нет регрессий» — полный прогон и затронутые наборы зелёные без правок ожиданий.
**Не выполнено:** AC10 (ручная приёмка `vibelog create testapp --template vibelog.md/templates/svelte-minimal` с реальным реестром и `npm run dev`) — требует сети и реального реестра компонентов, в автоматической фазе недоступна; остаётся на ручную проверку. Остальные AC (1–9) отмечены в фазе Code.
---
<!-- COMMENTS:END -->