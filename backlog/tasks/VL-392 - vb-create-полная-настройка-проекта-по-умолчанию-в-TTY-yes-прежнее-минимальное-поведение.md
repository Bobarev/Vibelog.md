---
id: VL-392
title: 'vb create: полная настройка проекта по умолчанию в TTY, --yes — прежнее минимальное поведение'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-09 20:37'
updated_date: '2026-11-09 21:00'
due_date: ''
labels:
  - vb-cli
  - create
  - init
  - ux
  - feature
dependencies:
  - VL-386
  - VL-389
milestone: ''
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/env-markers.ts
  - src/core/create.ts
  - src/core/create.test.mjs
  - src/cli/commands/create.ts
  - src/cli/commands/init.ts
  - src/cli/commands/init-wizard.ts
  - src/cli/router.ts
lessons:
  - lesson-272
token_usage:
  input: 5540213
  output: 45031
  cache: 5114368
  total: 5585244
  requests: 87
  duration_ms: 1035372
  reasoning: 25432
  by_phase:
    code:
      input: 4162628
      output: 37492
      cache: 3776000
      requests: 58
    close:
      input: 1377585
      output: 7539
      cache: 1338368
      requests: 29
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
`vb create` создаёт **пустой** проект: в логе приёмки `Агенты: нет. Шлюз: —, модель: —. Бот: нет. MCP: нет`. Пользователь получает рабочий каркас, но настройку (агент, модель, MCP) всё равно делает `vibelog init` руками.

**Причина.** `postCreate` в шаблоне жёстко — `vb init --components --yes`. Флаг `--yes` отключает wizard, поэтому настройка не выполняется вообще.

**Что нужно.** Дать `vb create` два режима, обойдясь **без нового флага** — семантика `--yes` уже подходит.

| Запуск | Поведение |
|---|---|
| `vb create myapp --template …` в TTY | полный wizard настройки (как `vibelog init` интерактивно) |
| `vb create myapp --template … --yes` | без вопросов, дефолты — только `components` и lock (как сейчас) |
| без TTY (CI, скрипт) | автоматически режим `--yes` + одна строка-пояснение |

**Почему именно `--yes`, без `--minimal`.** В `vibelog init` (VL-210/VL-336) `--yes` уже означает «без вопросов, дефолты», и там дефолт включает секцию `components`. То есть `--yes` = «дефолты без вопросов», а не «ничего не настраивать». Второй флаг создал бы две пересекающиеся семантики: `--yes` и `--minimal` пришлось бы объяснять отдельно друг от друга. Один флаг — одно правило, совпадающее между `create` и `init`.

**Как это проходит через `postCreate`.** `postCreate` — скрипт чужого шаблона, его команда в `package.json` фиксирована. Режим передаётся **через env-маркер** (тем же способом, что `VIBELOG_BIN` в VL-386 и `VIBELOG_CREATE` в VL-389): `vb create` кладёт в окружение признак «интерактивно/нет», а `scripts/init-vibelog.mjs` в шаблоне вызывает `vb init --components` с `--yes` или без. Команду в `package.json` править не нужно.

**Границы.** Не меняет сам wizard (`vibelog init`) и не добавляет флагов конфигурации в `create`. Не трогает порядок установки компонентов (VL-390) и git-шаг.

**Связанное:** VL-339 (`vb create`), VL-336 (`vb init --components`, семантика `--yes`), VL-386 (`VIBELOG_BIN` в env `postCreate`), VL-389 (маркер `VIBELOG_CREATE` — режим передаётся тем же путём), VL-390 (порядок `postCreate` → компоненты → git), doc-25 §2.1, §4.1 шаги 10–13, §8 п.5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `vb create` без `--yes` в TTY запускает полный wizard настройки проекта (агенты, шлюз/модель, секреты, бот, MCP) — тот же, что `vibelog init`
- [x] #2 `vb create --yes` (и любой запуск без TTY) — прежнее поведение: без вопросов, дефолты, только секция `components` и lock-файл
- [x] #3 Нового флага не появляется: семантика `--yes` та же, что у `vibelog init` — «без вопросов, дефолты»; документация объясняет, что без флага в TTY настройка полная
- [x] #4 Без TTY флаг не требуется: wizard не запускается автоматически, выводится одна строка-пояснение «не-TTY: использую дефолты; для полной настройки запустите vibelog init интерактивно»
- [ ] #5 Режим передаётся в `postCreate` через существующий env-маркер (VL-386/389): шаблонный runner вызывает `vb init --components` без `--yes` либо с ним, команда в `package.json` шаблона не меняется
- [x] #6 Порядок шагов сохранён: `postCreate` (настройка) → установка `vibelog.components` → `git init` и первый коммит; полная настройка не может утащить `.env` в первый коммит (`.gitignore` пишется до коммита — VL-348)
- [x] #7 Прерывание wizard (Ctrl+C) внутри `postCreate` не оставляет полунастроенный проект: `vb create` сообщает, что проект создан, но настройка отменена, и подсказывает `cd <dir> && vibelog init`; код выхода 5 (как у `init` при отмене)
- [x] #8 `--no-install` сохраняет прежнее поведение: ни зависимостей, ни `postCreate`, значит и полной настройки нет — выводится пояснение
- [x] #9 Существующие тесты `create.test.mjs` остаются зелёными: в тестах нет TTY, значит поведение = `--yes`
- [ ] #10 Ручная приёмка: `vibelog create testapp3 --template vibelog.md/templates/svelte-minimal` в TTY проходит полный wizard и создаёт настроенный проект (агент vb, модель, MCP); повтор с `--yes` даёт минимальный проект, как сейчас
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
**Стратегия.** Режим передаётся тем же env-каналом, что `VIBELOG_BIN`/`VIBELOG_CREATE` (VL-386/389) — шаблонный `postCreate` не меняет команду в `package.json`, а читает маркер и решает, добавлять ли `--yes`.

**Файлы.** `src/core/create.ts` (маркер режима), `src/cli/commands/create.ts` (флаг `--yes` уже есть — уточнить, что он значит), `src/core/env-markers.ts` (константа, если заведена в VL-389), шаблон `scripts/init-vibelog.mjs` (в репозитории `templates`), `create.test.mjs`, doc-25 §2.1/§4.1.

**Шаг 1. Определить режим в `create`.**

1. `const interactive = isInteractive() && options.yes !== true;` — та же проверка, что в `init.ts` (TTY + не `--yes`).
2. Режим передать маркером: `VIBELOG_CREATE_INTERACTIVE=1` (или переиспользовать `VIBELOG_CREATE` со значениями `'1'`/`'yes'`) — выбрать одну форму, константой в общем модуле. Важно: `init` уже читает `VIBELOG_CREATE` для подавления предупреждений (VL-389) — не сломать эту связь.
3. Значения маркера: `interactive` (полная настройка), `yes` (`--yes` или не-TTY). Второе — текущее поведение.

**Шаг 2. Подсказка в не-TTY.**

4. Если `!isInteractive()` и `--yes` не передан — до запуска `postCreate` печатать одну строку: `ℹ не-TTY: использую дефолты, полная настройка недоступна — запустите «vibelog init» интерактивно`. Один раз, не в цикле.

**Шаг 3. Шаблонный runner (репозиторий `templates`, задача там же).**

5. `scripts/init-vibelog.mjs`: читает `VIBELOG_CREATE_INTERACTIVE`; при `'1'` вызывает `vb init --components` **без** `--yes`, иначе `vb init --components --yes`.
6. Путь к CLI — из `VIBELOG_BIN` (VL-386), fallback `vb`.
7. stdio наследуется — иначе wizard не сможет задать вопросы (это критично: без `stdio: 'inherit'` интерактив не работает).

**Шаг 4. Порядок шагов и отмена.**

8. Проверить, что порядок `postCreate` → `vibelog.components` → `git init` сохраняется. Полная настройка внутри `postCreate` не должна ломать установку компонентов (VL-390 перечитывает lock/config после `postCreate`).
9. Отмена wizard (Ctrl+C) внутри `postCreate`: `vb init` вернёт код `5`. `create` должен:
   - не считать это фатальной ошибкой клонирования;
   - сообщить «проект создан, настройка отменена»;
   - подсказать `cd <dir> && vibelog init`;
   - выставить код `5`.
10. `--no-install` — `postCreate` не выполняется, значит полной настройки нет; добавить в итог пояснение.

**Шаг 5. Взаимодействие с VL-389.**

11. Маркер `VIBELOG_CREATE` (VL-389) уже подавляет в `init` предупреждение «проект не в git» и подсказку «Дальше». При интерактивном wizard-е внутри `postCreate` эти подавления должны сохраниться — иначе пользователь увидит «Дальше: vibelog task create» посреди вопросов wizard-а.
12. Убедиться, что подавление не мешает вопросам wizard-а: подавляется только **вывод после** настройки, а не сами вопросы.

**Шаг 6. Тесты.**

13. `create.test.mjs`: не-TTY (в тестах TTY нет) → `env.VIBELOG_CREATE_INTERACTIVE` отсутствует/`'yes'`, поведение прежнее (тесты зелёные без правок).
14. Инъекция `isInteractive = () => true` → маркер `'1'`, раннер получает env с признаком интерактива.
15. `--yes` + `isInteractive = () => true` → маркер `'yes'` (флаг сильнее TTY).
16. Отмена `postCreate` с кодом 5 → код выхода `5`, сообщение «проект создан, настройка отменена», проект не удалён.
17. `--no-install` → пояснение в итоге, `postCreate` не вызывался.

**Шаг 7. Документация.**

18. doc-25 §2.1: описать поведение `--yes` и режим по умолчанию; таблица «TTY / `--yes` / не-TTY».
19. doc-25 §4.1 шаг 11: полная настройка через `postCreate`, маркер режима.
20. `CHANGELOG.md` — изменение поведения по умолчанию (раньше `create` всегда был минимальным).

**Риски.**
- **Изменение поведения по умолчанию**: раньше `vb create` никогда не спрашивал ничего кроме пакетного менеджера; теперь в TTY запустится длинный wizard. Пользователи, привыкшие к «создалось и готово», удивятся. Смягчение: `--yes` в справке описать как «минимум, без вопросов», и в CHANGELOG явно указать смену дефолта.
- Wizard внутри npm-скрипта: `npm run postCreate` может буферизовать вывод или мешать raw-mode (интерактивные стрелки в `@clack/prompts`). Проверить вживую: если TTY-детект внутри `npm run` ломается (stdio не тот), wizard не запустится — тогда придётся вызывать `vb init` из `create` напрямую, а не через `postCreate`. Это существенный риск, проверить первым делом.
- Двойной TTY-детект: `create` решает «интерактивно», `init` внутри тоже проверяет TTY. При `stdio: 'inherit'` оба увидят TTY, но если npm перенаправит stdio — `init` решит, что не-TTY, и молча пойдёт по дефолтам, хотя `create` передал маркер интерактива. Нужно, чтобы маркер был решающим, а не TTY внутри `init`.
- Отмена внутри вложенного wizard-а: Ctrl+C может убить весь процесс, не дав `create` напечатать итог. Проверить обработку `SIGINT` в `@clack/prompts` и в `create`.
- `VIBELOG_CREATE` (VL-389) и новый маркер режима — две переменные с похожими именами. Либо объединить (`VIBELOG_CREATE=interactive|yes`), либо явно разделить и задокументировать в одном месте.

**Проверка.** `pnpm typecheck && pnpm test`; вручную в TTY — `vibelog create testapp3 --template vibelog.md/templates/svelte-minimal` проходит полный wizard (агенты, модель, MCP), проект настроен; повтор с `--yes` — минимальный проект; в неинтерактивном запуске (`| cat`) — дефолты плюс пояснение.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-09 20:54
---
Фаза 3 (Code) выполнена. Коммит 7af0a80.
**Что сделано**
- `src/core/env-markers.ts`: новый маркер режима настройки — `VIBELOG_CREATE_INTERACTIVE` со значениями `'1'` (полный wizard) и `'yes'` (дефолты) + `createInteractiveMarkerValue()`. Отдельная переменная, а не третье значение `VIBELOG_CREATE`: там уже закодировано «git будет / git не будет» (`1`/`no-git`), смешивать две независимые оси в одном значении — комбинаторика. `readCreateContext()` расширен полем `forceInteractive`.
- `src/core/create.ts`: опция `interactive` у `createProject`, `postCreateEnv(…, interactive)` ставит маркер; при `post.status === 5` и `interactive` — `setupCancelled` в результате, проект НЕ считается провалившимся (каталог сохранён, git-шаг выполняется), иначе прежняя ошибка с кодом 3.
- `src/cli/commands/create.ts`: режим `interactive = isInteractive() && !--yes` (нового флага нет), в не-TTY без `--yes` — одна строка-пояснение «не-TTY: использую дефолты… запустите «vibelog init» интерактивно»; в итоге печатается «Настройка отменена … Дальше: cd <dir> && vibelog init» и код выхода 5; при `--no-install` — пояснение, что настройка не выполнялась (postCreate не запускается).
- `src/cli/commands/init.ts` + `init-wizard.ts`: маркер `forceInteractive` решающий для TTY-детекта и передаётся в `runWizard` (внутри `npm run postCreate` stdio может быть перенаправлен — иначе wizard молча ушёл бы в дефолты). При отмене внутри `create` `init` выставляет код 5, прямой запуск `init` сохраняет прежний код 0.
- `src/cli/router.ts`: справка `create` — что значит `--yes`, поведение без флага в TTY и в не-TTY, код 5 (включая отмену настройки). Нового флага не появилось.
- `src/core/create.test.mjs`: +9 тестов (маркер `1`/`yes`, `forceInteractive`, env раннера в обоих режимах, отмена с кодом 5 → `setupCancelled` без удаления проекта, код 5 без интерактива → прежний код 3, `--no-install`).
**Проверки**
- `pnpm typecheck` — чисто.
- `pnpm test` — полный прогон: 203 файла, 3961 тест passed, 4 skipped, падений нет.
- Порядок шагов сохранён: `postCreate` → `vibelog.components` → `git init`; при отмене wizard-а `applySetup` не вызывался, значит `.env` не создан и в первый коммит не утащен.
**Что осталось (вне этого репозитория)**
- AC5 (шаблонный runner `scripts/init-vibelog.mjs` в репозитории шаблонов должен читать `VIBELOG_CREATE_INTERACTIVE` и звать `vb init --components` без `--yes` при `'1'`, путь — из `VIBELOG_BIN` с fallback `vb`, `stdio: 'inherit'`) — файла шаблонов в этом репозитории нет, правка нужна в vibelog.md/templates (это отметка в отчёте, не закрываю AC). Со стороны CLI контракт готов и покрыт тестами.
- AC10 (ручная приёмка `vibelog create testapp3 --template vibelog.md/templates/svelte-minimal` в реальном TTY с полным wizard-ом и повтор с `--yes`) — требует сети и терминала, в фазе Code не выполнялась.
- Документация (doc-25 §2.1/§4.1, CHANGELOG) — по регламенту пишется в фазе Close.
---
author: @agent
created: 2026-11-09 21:00
---
Фаза Close выполнена. Ветка vb/vl-392 слита в master (1 коммит 7af0a80, merge 71867f6), worktree удалена (force — только untracked-симлинк backlog/references/data от оркестратора), ветка vb/vl-392 удалена.
**Проверки после merge**
- `pnpm build` — чисто.
- Ранний точечный фильтр: `src/core/create.test.mjs` — 58 тестов passed.
- Полный прогон `npx vitest run`: 204 файла, 3969 passed, 4 skipped, падений нет. Merge-интерференции не выявлено.
**Документация (коммит b3c0a3d)**
- doc-25 §2.1: таблица «TTY / `--yes` / не-TTY», описание маркера `VIBELOG_CREATE_INTERACTIVE`, отмена wizard-а (код 5), `--no-install`.
- doc-25 §4.1 шаг 11: полная настройка через `postCreate`, маркер режима, `forceInteractive` как решающий для TTY-детекта, сохранение подавлений VL-389.
- doc-25 §5.2: код 5 — в том числе отмена настройки внутри `postCreate`.
- CHANGELOG.md, Unreleased / «Изменено (ломающие изменения)»: смена поведения по умолчанию (`create` в TTY теперь запускает полный wizard, `--yes` — прежний минимум).
**Lessons (коммит 152a974)**
- Создан lesson-272 «Передавай решение об интерактивности маркером в env, а не полагайся на повторный TTY-детект в дочерней команде», связан с VL-392.
**DoD**
1. Тесты проходят — да (полный прогон после merge).
2. Документация обновлена — да (doc-25 §2.1/§4.1/§5.2 + CHANGELOG).
3. Нет регрессий — да (полный прогон зелёный, сборка чистая).
**Незакрытые AC (честно)**
- AC5 (шаблонный runner `scripts/init-vibelog.mjs` в репозитории шаблонов читает `VIBELOG_CREATE_INTERACTIVE`, зовёт `vb init --components` без `--yes` при `'1'`, путь из `VIBELOG_BIN`, `stdio: 'inherit'`) — файла шаблонов в этом репозитории нет; правка нужна в vibelog.md/templates. Со стороны CLI контракт готов и покрыт тестами.
- AC10 (ручная приёмка в реальном TTY с полным wizard-ом и повтор с `--yes`) — требует сети и терминала, в фазах Code/Close не выполнялась.
---
<!-- COMMENTS:END -->