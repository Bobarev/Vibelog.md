---
id: VL-426
title: 'doc-25 + vb install: тип registry:block — развод контрактов «компоненты/блоки» и установка сборок «копируй и правь»'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-18 07:34'
updated_date: '2026-11-25 15:42'
due_date: ''
labels:
  - doc-25
  - registry
  - vb-cli
  - upstream
dependencies: []
milestone: v1.15
references:
  - ref-33
priority: medium
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/registry-fetch.ts
  - src/core/install.ts
  - src/core/components-config.ts
  - src/core/registry-fetch.test.mjs
  - src/core/install.test.mjs
  - src/core/install-registry-deps.test.mjs
  - src/core/components-config.test.mjs
  - src/cli/init-components.test.mjs
lessons:
  - lesson-101
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 122
  duration_ms: 1333059
  by_phase:
    code:
      input: 0
      output: 0
      cache: 0
      requests: 96
    close:
      input: 0
      output: 0
      cache: 0
      requests: 26
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Источник: входящий отчёт 65a509d4 из Vibelog UI (задача UI-40, важность medium, область cli) — «doc-25: тип registry:block и развод контрактов «компоненты / блоки»». Текст запроса готов к переносу целиком (лежит в отчёте).

Контекст: в реестре Vibelog-md/ui появилась вторая категория артефактов — installable-сборки «копируй и правь» (первый блок — header, шапка из нескольких файлов; модель принята их ADR «Blocks: installable-сборки отдельно от атомарного реестра», статус accepted). doc-25 сейчас описывает только registry:ui и registry:lib → контракт расходится с их инструментарием, а наш vb install блоки не распознает.

Что просит отправитель (пять пунктов):
1. Тип registry:block — в схеме shadcn (на которой стоит $schema в registry.json) такой тип есть — сверить и использовать без своего изобретения;
2. Развод контрактов: компоненты (registry:ui) — строгий API, стабильность между версиями 0.x, перечисленные пропсы и события; блоки (registry:block) — слабая стабильность: описываются состав (files), пропсы-ориентиры и установка, формат «переноси и правь», гарантий совместимости между версиями блока не даётся;
3. CLI (vb install): распознавать registry:block — ставить файлы сборки как есть, без проверок API компонента; в документации отметить, что поведение блока правится потребителем;
4. Target-базис блоков уточнить (у них принято временно: ui-каталог как у мультифайловых элементов — потребитель кладёт файлы куда хочет);
5. Литература: раздел «Блоки» в описании типов.

У отправителя уже сделано: тип поддержан их валидатором/сборщиком, первый блок header установлен в реестр (по временному target-базису), README дополнен разделом «Блоки».

Ключевые точки архитектуры Vibelog.md для реализации:
- §3.3 doc-25 — JSON элемента реестра (files[].target относительно базы алиаса, aliasForType: registry:ui → ui, registry:lib → utils, registry:hook/component → components);
- src/core/install.ts — buildInstallPlan/resolveAliasPath/validateRegistryItem;
- src/core/install-chain.ts — цепочка установки (registryDependencies один уровень);
- валидация типа элемента — где проверяется допустимость type (сверить: если type строго перечислен, registry:block сейчас отклоняется);
- открытый вопрос №1: target-базис — не наследовать «как у мультифайловых» молча, а зафиксировать решение в doc-25 (варианты: ui-каталог как у registry:ui / отдельный blocks-каталог / специальный алиас).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 doc-25: тип registry:block описан по shadcn-схеме ($schema registry.json — сверить с официальным форматом, не изобретать свой) в §3.3 (JSON элемента) и в истории версий
- [x] #2 doc-25: развод контрактов зафиксирован — registry:ui (строгий API, стабильность 0.x, перечисленные пропсы/события) vs registry:block (слабая стабильность, состав files + пропсы-ориентиры, формат «переноси и правь», гарантий между версиями нет)
- [x] #3 doc-25: раздел «Блоки» в описании типов (что это, чем отличается от компонента, как ставить и править) + уточнён target-базис блоков
- [x] #4 vb install: registry:block распознаётся и ставится — файлы сборки как есть, без проверок API компонента; aliasForType/resolveAliasPath и валидация типа покрыты тестами
- [x] #5 Определено и задокументировано, куда блоки пишутся (target-базис) — явное решение, а не наследование по умолчанию
- [x] #6 Регрессия: install.test.mjs / install-registry-deps.test.mjs / registry-fetch.test.mjs зелёные, pnpm test зелёный
- [x] #7 Отчёт 65a509d4 принят (accept) и связан с этой задачей
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Решения, принятые заранее (в чате, до запуска фазы)

1. **target-базис блоков — ВАРИАНТ B: отдельный алиас `blocks`.** Обоснования: исходники блоков в проекте-реестре уже лежат в `src/lib/blocks/header/` (расхождение A между «как устроено» и «куда ставится»); развод «атомы со строгим API vs каркасы копируй-и-правь» должен быть виден в файловой системе (продолжение decision-2 реестра); минус A — долг (позже ломающее перемещение для уже установивших), а 0.x + переписываемый doc-25 — самый дешёвый момент завести алиас; цена B разовая и тривиальная.
2. **Клиентская сторона Vibelog UI** (их header уже установлен по временному правилу в ui-каталог) — миграция на `blocks`-базис после нашей правки doc-25; упомянуть в итоговом комментарии к отчёту/задаче.

## Файлы

1. **backlog/docs/doc-25-*.md** — спецификация (все пять пунктов их запроса)
2. **src/core/registry-fetch.ts** (или где живёт validateRegistryItem — сверить по коду) — принимать `type: "registry:block"`
3. **src/core/install.ts / install-chain.ts** — `aliasForType`: `registry:block → blocks`
4. **src/core/components-config.ts** — `defaultComponentsConfig`: запись `blocks: "src/lib/blocks"` в aliases; `mergeComponentsConfig` дополняет существующие проекты
5. **Схема §3.1 doc-25** — новый алиас `blocks` в примере секции components
6. **Тесты**: install.test.mjs / install-registry-deps.test.mjs / init-components.test.mjs / components-config

## Шаг 1. Сверка с shadcn-схемой

Подтвердить по официальной схеме shadcn (той, на которую ссылается `$schema` в registry.json): `registry:block` — валидный тип, как он трактуется (рядом есть `registry:page`, `registry:file` — мы их НЕ поддерживаем, это тоже зафиксировать). Источник — reference_add на репо shadcn/ui (или их docs), не изобретать свой формат. Результат фиксируется в doc-25 §3.3 как перечень поддерживаемых типов: `registry:ui`, `registry:lib`, `registry:hook`, `registry:component`, `registry:block`; прочие типы схемы — «не поддерживаются v1» (явно, не молча).

## Шаг 2. doc-25 (спецификация)

1. **§1.2**: `registry:block` — во «Входит» (границы первой версии).
2. **§3.1**: в пример секции `components` добавить `"blocks": "src/lib/blocks"`; правило: база блоков — алиас `blocks`, НЕ `ui`.
3. **§3.3**: 
   - определение `registry:block` — installable-сборка из нескольких файлов (shadcn-схема, сверено на шаге 1);
   - таблица развода контрактов: **registry:ui** — строгий API, стабильность между версиями 0.x, перечисленные пропсы и события; **registry:block** — слабая стабильность: описываются состав (files), пропсы-ориентиры и установка; формат «переноси и правь», гарантий совместимости между версиями блока не даётся; поведение блока правится потребителем;
   - `files[].target` блока — относительно базы алиаса `blocks` (точка входа — `resolveAliasPath`, переходы вверх запрещены, как у алиасов-каталогов — VL-383);
4. **§2.3/§4.3**: `vb install` принимает `registry:block` — установка файлов как есть, без проверок API компонента; npm-зависимости и `registryDependencies` (один уровень) — тот же путь, что у `registry:ui`.
5. **История версий**: v1.7 (если VL-424 ещё не выпустила v1.7 — тогда в ту же вешку дописать, иначе v1.8): тип block, развод контрактов, алиас blocks, поддержка в install.
6. **Раздел «Блоки»** (литература, их п.5): что это, чем отличается от компонента, как ставить и править; ссылка на развод контрактов §3.3.

## Шаг 3. Код

1. **Валидация типа**: `validateRegistryItem` (сверить расположение по коду) — добавить `registry:block` в белый список; невалидные типы (registry:page) по-прежнему ошибка с перечнем допустимых.
2. **`aliasForType`** (`src/core/install.ts` или install-chain.ts — единая точка, комментарий VL-337): `registry:block → 'blocks'`. Остальные типы без изменений.
3. **`defaultComponentsConfig`** (`src/core/components-config.ts`): `aliases.blocks = "src/lib/blocks"`; `mergeComponentsConfig` — «дополнить недостающее»: существующие проекты получат запись при следующем `vb init --force`/upgrade, без --force — просто дополняется.
4. **validateInstallContext** (install.ts): алиас `blocks` — известный (список доступных алиасов в ошибке код 2 пополняется).
5. Никаких «проверок API компонента» для блоков не заводим — их у нас и нет; в doc-25 это зафиксировано как контракт.

## Шаг 4. Тесты

- элемент `type: "registry:block"`, мультифайловый (2 файла, target вида `header/header.svelte`, `header/header-links.svelte`) → оба файла в `src/lib/blocks/header/`, lock записан, повтор идемпотентен;
- блок с `registryDependencies: ["vibelog.md/ui/base"]` → base ставится первым в `src/lib/utils.ts` (регрессия цепочки VL-390);
- `type: "registry:page"` → ошибка (белый список не расширен молча);
- `defaultComponentsConfig` содержит `blocks`; merge со старым config без blocks — дополняет;
- `resolveAliasPath` для блока: `..` в target запрещён (алиас-каталог);
- регрессия: существующие install*/init-components/components-config тесты зелёные; `pnpm test`.

## Порядок

1. Сверка shadcn-схемы (reference).
2. Код: белый список типов → aliasForType → defaultComponentsConfig → validateInstallContext → тесты.
3. doc-25 (по готовому коду — чтобы §4.3 описывал факт).
4. `pnpm test`, CHANGELOG, комментарий в задаче с итогом для отправителя отчёта (учесть их миграцию header → blocks).

## Риски

- Существующие проекты без `aliases.blocks`: запись появится только через merge (init --force/upgrade или ручная правка) — без неё install блока упадёт кодом 2 «неизвестный алиас» с подсказкой. Это честно (конфиг — источник истины), но в doc-25 §4.3 упомянуть миграцию.
- Их registry.json уже содержит блоки с target под ui-базисом — после смены базиса их элементы потребуют перевыпуска (их задача, упомянуть в комментарии отчёта).
- Установленные ранее блоки у потребителей Vibelog UI (если есть) — мигрируются их релизом, у нас это не кодируется.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: Pavel Bobarev
created: 2026-11-18 07:34
---
Принят отчёт 65a509d4 из проекта Vibelog UI (задача UI-40). Файл: reports/ui/2026-11-18-UI-40-doc-25-tip-registry-block-i-razvod-kontraktov-komponenty-blo.md
---
author: @agent
created: 2026-11-18 09:03
---
Фаза code не удалась (код выхода 1): ents-config.test.mjs×3, блокировок=2, payload последнего запроса=490619 байт (макс 490619), usage={"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":0,"total_tokens":0,"reasoning_tokens":0} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-18 09:09
---
Фаза 3 (Code) выполнена.
Изменено (коммит 351a227, ветка vb/vl-426): src/core/registry-fetch.ts, src/core/install.ts, src/core/components-config.ts + 5 тест-файлов (registry-fetch/install/install-registry-deps/components-config/init-components).
Что сделано по плану:
1. Сверка shadcn-схемы: https://ui.shadcn.com/schema/registry-item.json — registry:block валиден (enum шире: также theme/page/file/style/base/font/item — они «не поддерживаются v1» и отклоняются с перечнем допустимых). Источник оформлен как ref-33, связан с задачей.
2. Код: REGISTRY_ITEM_TYPES += registry:block; aliasForType: registry:block → blocks; aliases.blocks опционален при чтении (старые settings.json работают как раньше), defaultComponentsConfig blocks=src/lib/blocks, mergeComponentsConfig дополняет недостающее; отсутствующий blocks при установке блока — честная ошибка кода 2 с подсказкой «vb init --components» (aliasBase, конфиг — источник истины); resolveAliasPath: blocks — алиас-каталог, «..» запрещён.
3. doc-25 (через MCP, основной репозиторий): v1.8 в истории (v1.7 уже занята VL-424 — блок перенумерован и перенесён после неё), §1.2 (блоки во «Входит»), §3.1 (пример aliases + правило про blocks), §3.3 (типы по shadcn-схеме, таблица развода контрактов ui vs block, пример JSON блока, target-базис blocks, раздел «Блоки»), §2.3 и §4.3 (шаг 7 + блок «Реализовано в VL-426» с миграцией), §8 п.13 (решение по target-базису — вариант B).
4. Тесты новые: блок мультифайловый → src/lib/blocks/header/ + идемпотентность; блок с registryDependencies → base первым в src/lib/utils.ts; registry:page → код 3; legacy-конфиг без blocks → код 2; default/merge/resuelveAliasPath blocks.
Проверки: pnpm build зелёный; ПОЛНЫЙ pnpm test — 230 тест-файлов, 4440 passed, 4 skipped (штатные скипы в самих тестах, прогон без --exclude/--skip), регрессий нет (install*/init-components/components-config/registry-fetch зелёные).
Что осталось / для Close и отправителя: CHANGELOG в Фазе 3 не правил (по правилу фазы — допишет Close); их registry.json в Vibelog-md/ui содержит блоки с target под ui-базисом — после этой правки doc-25 элементы требуют перевыпуска под blocks-базис (их задача UI-40/релиз), миграцию уже установленных header у их потребителей делает их релиз.
---
author: @agent
created: 2026-11-18 09:15
---
Фаза Close выполнена. Ветка vb/vl-426 слита в master (1 коммит 351a227, merge без конфликтов), worktree удалена (только untracked-симлинка backlog/references/data — удалена с --force), ветка удалена.
Проверки после merge: pnpm build зелёный; ранний точечный фильтр — 5 затронутых diff'ом тест-файлов (registry-fetch/install/install-registry-deps/components-config/init-components), 162 passed; ПОЛНЫЙ pnpm test (build && vitest --exclude static && vitest static, exit 0 всей цепочки) — зелёный, прогон один, без повторов.
DoD: 1) Тесты проходят — полный pnpm test зелёный; 2) Документация обновлена — doc-25 (правка Фазы 3) + CHANGELOG (запись в Unreleased), коммит 7638dad; 3) Нет регрессий — точечный фильтр и полный прогон зелёные.
Также: refs/lessons закоммичены (e9d302b: ref-33 shadcn-схема + lesson-101 дополнен кейсом VL-426 — ловушка «pnpm test | tail» повторилась в этой же фазе); lesson-101 связан с задачей.
Для отправителя отчёта 65a509d4 (Vibelog UI): target-базис блоков принят вариант B — алиас blocks (src/lib/blocks), НЕ ui-каталог; их registry.json содержит блоки с target под ui-базисом — элементы требуют перевыпуска под blocks-базис (задача UI-40/релиз), миграцию уже установленных header у их потребителей делает их релиз.
---
<!-- COMMENTS:END -->