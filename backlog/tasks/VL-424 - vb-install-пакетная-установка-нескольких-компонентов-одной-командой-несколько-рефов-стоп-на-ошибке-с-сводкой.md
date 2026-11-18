---
id: VL-424
title: 'vb install: пакетная установка нескольких компонентов одной командой (несколько рефов) + стоп на ошибке с сводкой'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-17 19:48'
updated_date: '2026-11-18 08:53'
due_date: ''
labels:
  - vb-cli
  - install
  - registry
dependencies: []
milestone: ''
references: []
priority: medium
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/install-batch.ts
  - src/core/install-batch.test.mjs
  - src/cli/commands/install.ts
  - src/cli/router.ts
lessons:
  - lesson-295
token_usage:
  input: 0
  output: 0
  cache: 0
  total: 0
  requests: 111
  duration_ms: 3035265
  by_phase:
    code:
      input: 0
      output: 0
      cache: 0
      requests: 69
    close:
      input: 0
      output: 0
      cache: 0
      requests: 42
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст: doc-25 §2.3 специфицирует `vb install <alias>/<repo>/<name>` — один элемент за вызов. Фактически CLI (src/cli/commands/install.ts, runInstall) читает только positional[0] и НЕ проверяет их число: `vb install vibelog.md/ui/base vibelog.md/ui/button` молча установит только base — второй аргумент проигнорируется без ошибки и предупреждения. То же семантическое семейство, что чинили в parseOptions (молчаливо проигнорированный --forse): пользователь получает ложное «оба установились».

Пользователь выбрал пакетную установку (не запрет с ошибкой):`vb install vibelog.md/ui/base vibelog.md/ui/button vibelog.md/ui/card [--yes] [--force] [--dry-run] [--branch <b>]`— основной сценарий — обновление набора компонентов (`--force`) и установка связки после `vb init --components`.

Почему это реально и недорого:- Пакетный цикл уже существует и проверен: `installTemplateComponents` (src/core/create.ts:759) крутит `installWithDeps` по массиву путей, тредя `lock = outcome.lock` между итерациями — это ровно требуемая механика (тесты VL-390: порядок base → button, идемпотентность, атомарность цепочки). `installWithDeps` возвращает `nextLock` специально для последовательной установки нескольких элементов (комментарий в install-chain.ts).- Транзакционность НЕ меняется: каждый элемент — отдельная транзакция `applyInstallChain` (файлы элемента k+1 планируются против lock после элемента k — владение/конфликты между элементами работают как при двух последовательных запусках). Батч-атомарности (всё или ничего) НЕТ — осознанно: повтор идемпотентен.- Ядро без CLI — уже так устроено (install.ts: «Ядро без CLI»), тесты с HTTP-фикстуром через VIBELOG_REGISTRY_BASE_URL уже есть.

Решения, принятые при проектировании:1. Оркестратор батча — в core (install-chain.ts или install-batch.ts), потому что только там есть тестовая инфраструктура с фикстур-сервером; CLI остаётся печатью/вопросами/кодами (как сейчас).2. Стоп на первой ошибке элемента (не continue): предсказуемо для скриптов (ненулевой код = «что-то не так»), сводка показывает что установлено, повтор добирает. Continue-семантика installTemplateComponents там другая по смыслу (проект уже создан, ошибка не должна его «уронить») — не унифицировать.3. Валидация всех рефов до сети (parseInstallPath + resolveInstallContext по каждому) — иначе опечатка в последнем аргументе = частичная установка.4. Отказ от npm-пакетов запоминается на запуск — иначе при трёх элементах с общим missing (clsx) пользователь отвечает на один и тот же вопрос трижды.5. Дедупликация повторяющихся рефов с предупреждением.6. vb create (installTemplateComponents) НЕ переводится на новый оркестратор — семантики различаются (там onUnresolved=throw, continue при ошибке, всегда skipAllConflicts); вне скоупа.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 vb install принимает несколько рефов (vb install a/b/base a/b/button a/b/card) и устанавливает их последовательно: каждый элемент — своя транзакция, lock тредится между элементами (base, поставленный зависимостью button, виден следующему элементу — не переустанавливается)
- [x] #2 Валидация ВСЕХ рефов ДО сетевых вызовов: невалидный сегмент/неизвестный alias → код 1/2 с указанием номера проблемного аргумента, ни один компонент не установлен
- [x] #3 Дубликаты рефов в одной команде дедуплицируются с предупреждением
- [x] #4 Ошибка на элементе k (сеть/данные) — стоп: сводка «установлено k-1 из n», код ошибки, уже записанные элементы НЕ откатываются (идемпотентный повтор добирает); отмена (Ctrl+C) — код 5 со сводкой
- [x] #5 npm-зависимости: после явного отказа от установки пакетов в этом запуске повторных вопросов нет (одно предупреждение в сводке)
- [x] #6 Агрегация кодов: 0 — успех (в т.ч. частичный — если записан хоть один файл); 4 — ни одного записанного файла и ВСЕ файлы ВСЕХ элементов пропущены по конфликту; 1/2 — до сети; 3 — ошибка сети/данных
- [x] #7 --dry-run печатает планы всех элементов и ничего не пишет
- [x] #8 Регрессия: одиночный vb install и все существующие тесты (install.test.mjs, install-registry-deps.test.mjs, install-deps.test.mjs, install-progress.test.mjs, create.test.mjs) зелёные; pnpm test зелёный
- [x] #9 Документация: doc-25 §2.3 (синтаксис нескольких рефов) + история версий, doc-7 раздел install, справка в src/cli/router.ts
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

1. **src/core/install-batch.ts (новый)** — валидация рефов + оркестратор батча + агрегация кодов (ядро без CLI, тестируется на HTTP-фикстуре)
2. **src/cli/commands/install.ts** — рефакторинг runInstall: все позиционные → батч, печать/вопросы/сводка
3. **src/core/install-batch.test.mjs (новый)** — тесты по паттерну install-registry-deps.test.mjs (локальный фикстур-сервер, VIBELOG_REGISTRY_BASE_URL)
4. **Документация**: doc-25 §2.3 + история версий, doc-7 раздел install, справка src/cli/router.ts

## Ядро: src/core/install-batch.ts

### `validateInstallRefs(cwd, rawRefs, {branch?})`

Вызывается ДО сети, возвращает `{ refs, duplicates, root, config, lock }`, кидает `InstallError`:

- пустой список → код 1 с прежней подсказкой формата («не указан компонент…» — формулировку сделать множественную);
- по каждому рефу: `parseInstallPath` (код 1, **с номером аргумента**: «компонент 3 («…»): ожидалось alias/repo/name») → `resolveInstallContext` (код 2: нет секции, schemaVersion, неизвестный alias — там уже есть список доступных);
- дедупликация с сохранением порядка: повтор → в `duplicates` (CLI печатает предупреждение), второй раз не выполняется;
- сеть не трогает ни разу → опечатка в последнем аргументе не даёт частичной установки (AC2).

### `installBatch(options): Promise<InstallBatchResult>`

Цикл по образцу `installTemplateComponents` (create.ts:759), но со стратегией `vb install`:

```
for (const ref of refs) {
  outcome = await installWithDeps({ root, config, lock, ref, branch?, fetchOptions,
                                    onConflict, deps, hooks, dryRun });
  lock = outcome.lock;        // транзакция на элемент; base из button виден дальше
  results.push({ ref, outcome });
  hooks.onElementDone?.(ref, outcome);
}
```

- **Стоп на ошибке**: `err instanceof InstallError` → возврат `{ results, failed: {ref, error}, lock }` — уже записанные элементы НЕ откатываются (повтор идемпотентен). **Любая другая ошибка пробрасывается** — PromptCancelledError из стратегии конфликтов должен долететь до CLI как код 5, а не превратиться в «failed»;
- хуки: `InstallChainHooks` форвардятся по каждому элементу (onBeforeItem/onBeforeContents/onPlanReady — печать плана и вопрос про пакеты идут в привычном месте), плюс новый `onElementDone(ref, outcome)` для поэлементного итога («Записан: …», «Пропущен: …», строка lock);
- `dryRun` форвардится: планы всех элементов, ни temp-каталога, ни записей.

### `batchExitCode(results): 0 | 4` (чистая функция)

Та же логика, что сейчас в конце runInstall, но агрегированная: writtenTotal > 0 → 0; writtenTotal == 0 && skippedTotal > 0 && **каждый** элемент `isAllConflictsSkipped(chain.last)` → 4; иначе 0 («Уже установлено»). Вынесена в core ради теста — в CLI остаётся только `process.exitCode = batchExitCode(...)`.

## CLI: src/cli/commands/install.ts

1. **Разбор**: `const refs = positional.filter(Boolean)` вместо `positional[0]`; прежняя проверка пустоты сохраняется (в множественной формулировке).
2. **Preflight**: `validateInstallRefs` → печать предупреждения о дубликатах → `fail(err)` при коде 1/2 (ничего не установлено — AC2).
3. **Память отказа о пакетах** (замыкание на запуск):
   ```
   let depsDeclined = false;
   confirm = async (missing) => {
     if (depsDeclined || options.dryRun || options.yes || !isInteractive()) return false;
     const ok = await prompts.askConfirm(...); if (!ok) depsDeclined = true; return ok;
   }
   ```
   Согласие НЕ мемоизируется: после установки package.json перечитывается, у следующего элемента missing пересчитан (новые пакеты — новый вопрос, это осмысленно) (AC5).
4. **Печать**: существующий блок «Итоговый блок» (строки 415-470) переезжает в обработчик `onElementDone` — вывод одиночной установки побайтово прежний; `plansPrinted`/`depsDryRunMessage` — состояние на элемент (сбрасывать в onBeforeItem).
5. **Сводка после батча**: для `failed` — «Установлено N из M; ошибка на <ref>: <message>» → `exitCode = failed.error.code`; иначе `batchExitCode(results)` + прежние предупреждения про конфликты.
6. **PromptCancelledError** — возврат как сейчас: «Отменено. Файлы не изменены.» → код 5 (для батча уточнить: «отменено на <ref>; уже установленные элементы не изменяются»).
7. `--branch` — один на весь батч (форвардится в installBatch), это нормально — документировать.

## Тесты: src/core/install-batch.test.mjs

Фикстур-сервер как в install-registry-deps.test.mjs (счётчик запросов — для AC про «до сети»):

1. Валидация: 3 рефа, третий с двумя сегментами → InstallError код 1, **0 запросов к фикстуре**, ничего не записано; неизвестный alias в третьем → код 2, 0 запросов.
2. Батч [base, button, card] → все записаны, lock содержит все три; button не переставляет base (запросов на base.json меньше — уже в lock).
3. Дедуп [button, button] → duplicates=['button'], второй не выполняется.
4. Стоп: [base, 404-реф, card] → results=[base], failed.ref=404-реф, card не запрашивался, lock содержит base; повторная команда добирает (идемпотентность).
5. Не-InstallError из onConflict пробрасывается наружу (не глотается).
6. `batchExitCode`: записан хоть один файл → 0; все элементы all-conflicts-skipped → 4; skip-identical без записи → 0.
7. dryRun батча → планы обоих элементов, файлов нет, lock не изменён.

## Порядок

1. install-batch.ts (validate → installBatch → batchExitCode) + тесты.
2. Рефакторинг runInstall на installBatch с сохранением вывода одиночной установки.
3. Сборка + `pnpm test`.
4. Документация: doc-25 (§2.3 синтаксис `<ref>…`, история версий **v1.7**; §4.3 — батч-уточнения: валидация до сети, стоп, дедуп, код 4 агрегированно), doc-7 (синтаксис + пример `vb install …/base …/button …/card --force`), router.ts help.

## Ручная проверка

- `vb install vibelog.md/ui/base vibelog.md/ui/button` → оба установлены, один вопрос про clsx;
- `vb install vibelog.md/ui/base bad-ref vibelog.md/ui/card` → ошибка до сети, ничего не установлено;
- повтор того же батча → идемпотентно («Уже установлено»);
- `--dry-run` на трёх рефах → три плана, lock без изменений;
- `--force`-батч поверх правленых файлов → обновление (сценарий «обновить компоненты» из обсуждения).

## Риски

- **Вывод одиночной установки** — главная зона регрессии (перенос блока печати в onElementDone); страхуется ручным прогоном и тем, что тесты ядра проверяют состояния, а не формат строк.
- CLI-слой install не покрыт юнит-тестами (существующее положение дел) — поэтому вся логика с решением (валидация, цикл, коды) вынесена в core под тесты; в CLI — только печать.
- Стоп на ошибке ≠ continue у installTemplateComponents — осознанное расхождение семантик (см. описание задачи), в коде отмечено комментарием, чтобы «унифицировать» не пытались.
- npm-пакеты: при отказе в батче пакеты не ставятся ни у одного элемента (память отказа) — но файлы элементов ставятся; в сводке одна строка с готовой командой (как сейчас).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-18 07:12
---
Фаза code прервана остановкой процесса — статус возвращён к Planned.
---
author: @agent
created: 2026-11-18 08:46
---
Фаза 3 (Code) выполнена. Изменено: src/core/install-batch.ts (новый), src/core/install-batch.test.mjs (новый, 16 тестов), src/cli/commands/install.ts, src/cli/router.ts; коммит 023d1ed.
Что сделано:
1. Ядро install-batch.ts: validateInstallRefs — валидация всех рефов ДО сети (parseInstallPath + resolveInstallContext по каждому, код 1/2 с номером проблемного аргумента «компонент N («…»)», дедупликация с сохранением порядка, пустой список → подсказка в множественной форме); installBatch — цикл по образцу installTemplateComponents с тредингом lock, стоп на первой InstallError (уже записанные не откатываются), проброс не-InstallError (PromptCancelledError долетает до CLI как код 5), хуки InstallChainHooks + onElementDone; batchExitCode — чистая агрегация 0/4.
2. CLI runInstall: все позиционные → батч; предупреждение о дубликатах; память отказа от npm-пакетов на запуск (depsDeclined, согласие не мемоизируется); печать deps-итога и «Итогового блока» — в onElementDone (вывод одиночной установки побайтово прежний, состояние plansPrinted/depsDryRunMessage сбрасывается в onBeforeItem); сводка «Установлено N из M; ошибка на <ref>» → exitCode=error.code; отмена → код 5 с уточнением; dry-run → планы всех элементов, записей нет.
3. Справка router.ts: синтаксис нескольких рефов, семантика валидации/стопа/дедупликации.
Проверки: pnpm build зелёный; прогон частичный: install-batch.test.mjs (16), install.test.mjs, install-registry-deps.test.mjs, install-deps.test.mjs, install-progress.test.mjs, create.test.mjs — 156 тестов зелёные. Полный pnpm test НЕ запускался (остаток wall-time < 5 мин).
Что осталось:
- Полный pnpm test перед закрытием DoD (обязательно в Close после merge).
- doc-25 §2.3/§4.3 и doc-7 — не обновлялись: документы backlog/docs в Фазе 3 обновляет Close (правило фазы); AC9 отмечен частично (справка router.ts сделана).
- Ручная проверка интерактивных сценариев (вопрос про пакеты один раз при батче, Ctrl+C) — CLI-слой не покрыт юнит-тестами по существующему положению дел.
---
author: @agent
created: 2026-11-18 08:52
---
Фаза Close выполнена. Ветка vb/vl-424 слита в master (1 коммит 023d1ed, merge без конфликтов), worktree удалена (force — только untracked-симлинк backlog/references/data), ветка удалена.
Проверки после merge: сборка `pnpm build` зелёная (1 раз); ранний точечный фильтр — install-batch/install/install-registry-deps/install-deps/install-progress, 51 тест зелёный; полный `pnpm test` — 231 файл / 4452 теста зелёные (+8 в доборном прогоне static.test.mjs), падений нет.
DoD: 1 (Тесты проходят) — полный pnpm test зелёный; 2 (Документация обновлена) — doc-25 §2.3/§4.3 + история версий v1.7, doc-7 раздел install, CHANGELOG Unreleased (коммит bdee95d); 3 (Нет регрессий) — полный прогон зелёный, регрессий нет. Все три пункта отмечены.
Lessons: lesson-295 (валидация всех позиционных аргументов батчевой команды до сети + дедупликация), связана с задачей, закоммичена (c235403). Refs — нет.
Ручная проверка интерактивных сценариев (один вопрос про пакеты при батче, Ctrl+C) не выполнялась — CLI-слой не покрыт юнит-тестами по существующему положению дел; механика покрыта тестами ядра install-batch.test.mjs.
---
<!-- COMMENTS:END -->