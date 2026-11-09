---
id: VL-364
title: 'Шаблоны Close: образец lesson_update должен нести content (и правило про missing: content) — модель копирует неверный вызов из промпта'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-07 21:00'
updated_date: '2026-11-09 21:42'
due_date: ''
labels:
  - agent
  - prompts
  - lessons
  - close
  - bug
dependencies: []
milestone: v1.13
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - templates/phases/phase-close-worktree.md
  - .gitattributes
  - src/web/phase-prompt.test.mjs
lessons:
  - lesson-248
  - lesson-241
token_usage:
  input: 25256527
  output: 288077
  cache: 24624640
  total: 25544604
  requests: 218
  duration_ms: 3140189
  reasoning: 71894
  by_phase:
    code:
      input: 23456612
      output: 277291
      cache: 22876160
      requests: 185
    close:
      input: 1799915
      output: 10786
      cache: 1748480
      requests: 33
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Фазы Close завершаются впустую на шаге уроков: модель 4 раза повторяет `lesson_update` без `content`, урок остаётся скелетом, AC/DoD не отмечены, отчёта нет (сессии `agent-1794064942811` — Close VL-359, `agent-1794067677112` — Close VL-354). Причина — неверный **образец** вызова в шаблоне, а не способность модели писать markdown: она копирует готовый вызов без `content`, получает `partial` + `missing: content` и повторяет тот же вызов, потому что другого образца в промпте нет.

Второй, отдельный раздражитель: Close регулярно падает на конфликте `CHANGELOG.md`. Это не «сложное слияние», а структурный дефект — см. раздел 8.

Кодовая часть образца уже сделана: VL-362 (Done) отдаёт `retryWith: {content: <каркас>}` и пробрасывает `missing` в директиву повтора. Эта задача лечит первопричину — промпт и merge-политику.

## Область: только `phase-close-worktree.md`

Правка идёт **только** в `templates/phases/phase-close-worktree.md` (реальный Close идёт по worktree) + новый `.gitattributes`. `phase-close.md` не трогаем: перенос текста — отдельный шаг после обкатки на боевой фазе.

## 1. Перенумерация 1–11

Сейчас: 1, 2, 3, 4, 5, 6, 7, **7.5**, **7.6**, 8, 9, 10. Дробные появились как вставки без перенумерации и ломают ссылки («шаги 6–10», «хэш из шага 8», «шаг 7»).

| # | Шаг |
|---|---|
| 1 | Тип и ветвление |
| 2 | Worktree (статус) |
| 3 | Слияние в master (включает бывший «Состав ветки»: `git log --oneline master..{{branch}}`) |
| 4 | Проверка после merge (сборка, ранний точечный фильтр, полный прогон) |
| 5 | Уборка worktree и ветки |
| 6 | DoD |
| 7 | Lessons learned |
| 8 | Refs и lessons (коммит) |
| 9 | Документация |
| 10 | Отчёт, статус и DoD |
| 11 | Файлы подзадач |

Правится каждая ссылка на номер.

## 2. Образец `lesson_update` с `content`

`content` в `lesson_update` — **полная замена** тела (VL-319 → VL-355 → VL-356 → VL-362). Образец + оговорка:

```
lesson_update {"id": "lesson-N", "linkedTasks": ["{{taskId}}", ...], "content": "## Проблема\n\n<что было не так>\n\n## Решение\n\n<что сделали>\n\n## Пример\n\n<конкретный пример>"}
```
«`content` — ПОЛНАЯ замена тела: если урок уже содержит текст, перенеси его в вызов целиком и допиши новое, не сокращай.»

## 3. Правило по ответу инструмента

`partial` (`missing: [{field: 'content'}]`, `hint`, `retryWith.content`) → **следующий** вызов ОБЯЗАН нести `content` полным телом; повтор без него вернёт тот же `partial` и бесполезен; каркас из `retryWith.content` — заменить плейсхолдеры. То же правило для `lesson_create`.

## 4. Квота → критерий отбора (с воркэраундом)

«Сформулируй 1–3 урока» — это квота, а квота всегда выполняется: модель придумывает третий урок, потому что велено. Уроков больше 200, `lesson_audit` уже имеет finding `empty_body` и порог дублей (VL-349) — склад пустышек признан проблемой в коде.

Замена:

> **Уроки.** Зафиксируй урок, только если в задаче появилось знание, которого нет в диффе и коммитах: (а) неочевидная причина дефекта; (б) **найденный воркэраунд** — обход, который пришлось применить, потому что прямой путь не работает, с указанием, что именно не работает и когда обход можно снять; (в) ловушка инструмента (ответ, вводящий в заблуждение); (г) правило, которое снова нарушат. Формат — императив, конкретика, одно предложение. Ничего из этого нет — шаг пропусти: пересказ диффа уроком не является. Похожий активный урок есть — **дополни его тело**, а не создавай второй. Воркэраунд помечай `kind: workaround` через `lesson_update` — по этому полю `lesson_classify` собирает кандидатов в техдолг.

## 5. Нефатальность шага

«Не удалось зафиксировать урок — не блокируй Close: пропусти шаг и укажи в отчёте `Урок не зафиксирован: <причина>`».

## 6. Минус два MCP-хода

- Шапка: `Связи (references): {{taskReferences}}`, `Уроки по tags: {{taskLessons}}` — переменные в `taskExtraVars` уже есть (`src/web/phase-prompt.ts:221-229`), их просто не подставляли. Шаг refs/lessons остаётся только с «+ ID, созданные в шаге 7».
- Шаг DoD: без `backlog_manage_dod action list` — `{{taskDoD}}` в шапке уже отрендерен `formatChecklist` как `N. [ ] …`, ровно индексы для `dodChecks`.
- `listLessons` → `lesson_list` (такого инструмента, как `listLessons`, не существует).

## 7. Сжатие

Безопасно: снять противоречие шага 2 («единственная -C — статус») против `git status {{worktreeDir}}` в шаге уборки; дубль предупреждения `allowForeign` в шаге документации → ссылка на шаг refs/lessons; «Экономия ходов» — убрать повторяющее шаги; опечатки (`дополнить..`, нечитаемая скобка «была в Code»).

**Запрещено трогать:** строку с «Не завершай цикл как успех» (тест сверяет её между двумя close-шаблонами дословно); два `"aborted": true`; маркеры VL-242; `pnpm` в тексте (VL-105); буллет «README — витрина» (ровно 1, VL-312).

## 8. Конфликты CHANGELOG: merge-политика вместо «умного резолва»

**Причина структурная.** CHANGELOG пишет только Close — и пишет **в главный репо после merge** (`phase-close-worktree.md:64`; `phase-code.md:67` прямо запрещает Code/Do его трогать). То есть в норме ветка CHANGELOG не меняет и конфликта быть не должно. Он появляется, когда правка всё-таки попала **в ветку** — Code/Do сдрейфовали, либо шаг 2 («грязный worktree — закоммить») притащил её в WIP-коммит, либо батч/подзадача. Плюс все Close вставляют запись в **одну и ту же позицию** `[Unreleased]`, поэтому две любые правки конфликтуют по определению.

Лечим в два слоя:

**(а) `merge=union` — конфликт исчезает как класс.** Новый файл `.gitattributes` в корне:
```
CHANGELOG.md merge=union
```
Встроенный драйвер git, конфигурация не нужна: строки обеих сторон объединяются без конфликт-маркеров. Для этого файла почти идеально — записи однострочные буллеты `- **VL-NNN: …**`. Оговорки: `union` даст дубль заголовка раздела, если обе стороны независимо вводят новый `### Добавлено` (лечится тем, что разделы заведены заранее и фазами не создаются + дешёвая проверка на дубли заголовков); порядок записей не хронологический — для Unreleased нормально, порядок восстанавливается при выпуске релиза.

**(б) Узкий резолв — только для прозы.** Если конфликт всё же пришёл и он **только** в `CHANGELOG.md` или `backlog/docs/*` — разрешаем модели резолвить: «берём оба варианта целиком, ничего не удаляем», затем `git add` по явным путям и `git commit --no-edit`, факт резолва — в отчёт. Любой другой конфликтный путь (`src/`, `templates/`, `*.json`, `backlog/tasks/*`, `backlog/lessons/*`, `backlog/references/*`) по-прежнему `aborted: true` с причиной.

**Почему не «резолвить всё, что не код»:** опасность не в резолве, а в файлах, где потеря данных **невидима**. В `backlog/tasks/*.md` живут отмеченные AC/DoD, статус, комментарии и `token_usage` — резолв теряет их молча, и ни один тест этого не покажет. CHANGELOG и doc-* человек читает, ошибка видна.

**Запрет остаётся:** `git merge --abort` не делать в любом случае.

## Что НЕ входит

- Правка `templates/phases/phase-close.md` — отдельно, после обкатки.
- Per-task changelog-фрагменты (`backlog/changelog/VL-NNN.md` + сборка при релизе, паттерн changesets) — правильнее по построению, но дороже; кандидат в отдельную задачу.
- Генерация `.gitattributes` в `vibelog init` для новых проектов — только этот репозиторий.
- Правка кода `retryWith`/`missing` — сделана в VL-362.

## Альтернатива (обсуждена, не делаем)

Убрать шаг уроков из Close совсем. Не убираем: это единственное место workflow, где уроки рождаются. Решение — верный образец + критерий отбора с воркэраундами + нефатальность.

## Связанные задачи

VL-362 (`retryWith`-каркас), VL-361 (`runHasProgress`), VL-356, VL-355, VL-353, VL-349 (`empty_body`), VL-359 и VL-354 (сессии с падением).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `templates/phases/phase-close-worktree.md` перенумерован подряд 1–11 без дробных шагов; шаг «Состав ветки» слит с merge; все перекрёстные ссылки на номера шагов обновлены и проверены глазами
- [x] #2 Шаг уроков: образец `lesson_update` содержит `content` с заголовками `## Проблема` / `## Решение` / `## Пример`; под образцом оговорка, что `content` — ПОЛНАЯ замена тела (существующий текст переносится в вызов целиком)
- [x] #3 Шаг уроков: правило по ответу — `partial` / `missing: content` → следующий вызов несёт `content` полным телом; повтор без `content` бесполезен; каркас из `retryWith.content` — заменить плейсхолдеры, а не копировать
- [x] #4 Шаг уроков: то же правило продублировано для `lesson_create`
- [x] #5 Квота «Сформулируй 1–3 урока» заменена критерием отбора, включающим воркэраунд: фиксируется (а) неочевидная причина дефекта, (б) найденный воркэраунд — что именно не работает и когда обход можно снять, (в) ловушка инструмента, (г) правило, которое снова нарушат; ничего из этого нет — шаг пропустить; дополнение существующего похожего урока приоритетнее создания нового
- [x] #6 Шаг уроков: воркэраунд помечается `kind: workaround` через `lesson_update` (по этому полю `lesson_classify` собирает кандидатов в техдолг)
- [x] #7 Шаг уроков нефатален: не удалось зафиксировать — не блокировать Close, указать в отчёте «Урок не зафиксирован: <причина>»; `listLessons` заменён на реальное имя `lesson_list`
- [x] #8 В репозитории создан `.gitattributes` со строкой `CHANGELOG.md merge=union`; проверка `git check-attr merge CHANGELOG.md` → `union`
- [x] #9 `.gitattributes` закреплён тестом/doctor-проверкой: строка `CHANGELOG.md merge=union` присутствует и не удалена случайно
- [x] #10 В Close разрешён резолв конфликта merge ТОЛЬКО в `CHANGELOG.md` и `backlog/docs/*`: правило «берём оба варианта целиком, ничего не удаляем», затем `git add` по явным путям и `git commit --no-edit`; факт резолва упоминается в отчётном комментарии
- [x] #11 Любой конфликт за пределами `CHANGELOG.md` и `backlog/docs/*` (включая `src/`, `templates/`, `*.json`, `backlog/tasks/*`, `backlog/lessons/*`, `backlog/references/*`) по-прежнему ведёт к `aborted: true` с причиной — формулировка «не завершай цикл как успех» и требования VL-247 не изменены (тест сверяет строку между двумя close-шаблонами дословно, `"aborted": true` — минимум дважды)
- [x] #12 Буллет «Конфликты слияния не резолвь и не откатывай» в «Запретах» переписан под новое правило (резолв docs/CHANGELOG разрешён, остальное — нет); `git merge --abort` по-прежнему запрещён
- [x] #13 Шапка шаблона содержит `{{taskReferences}}` и `{{taskLessons}}`; шаг refs/lessons не вызывает `backlog_view_task`
- [x] #14 Шаг DoD не вызывает `backlog_manage_dod action list` — индексы берутся из `{{taskDoD}}`
- [x] #15 Дубль предупреждения про `allowForeign` в шаге документации заменён ссылкой на шаг refs/lessons; маркеры тестов VL-318/VL-323 на месте
- [x] #16 «Экономия ходов» очищена от правил, повторяющих шаги; объём шаблона меньше исходного минимум на 10%
- [x] #17 `templates/phases/phase-close.md` НЕ изменён — перенос правки в обычный Close отдельным шагом после проверки на боевой фазе
- [x] #18 `TASK_VARS` в `src/web/phase-prompt.test.mjs` дополнен ключом `taskLessons`; новый `describe` (VL-364) проверяет образец `lesson_update` с `content`, правило про `missing`, отсутствие дробных шагов и наличие узкой ветки резолва docs/CHANGELOG
- [x] #19 Документация: doc-10 §6 (критерий отбора уроков с воркэраундом, поведение при `missing`), doc-7 или doc-10 (merge-политика `merge=union` и узкий резолв в Close), CHANGELOG.md
- [x] #20 `pnpm build && pnpm test` без регрессий
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

| Файл | Что меняется |
|---|---|
| `templates/phases/phase-close-worktree.md` | перенумерация 1–11, шаг уроков, шапка, шаг DoD, шаг refs/lessons, ветка резолва в шаге merge, сжатие |
| `.gitattributes` | **новый файл**: `CHANGELOG.md merge=union` |
| `src/web/phase-prompt.test.mjs` | `TASK_VARS` + `taskLessons`, новый `describe` VL-364 |
| `CHANGELOG.md` | запись в Unreleased |
| `backlog/docs/doc-10-*` | §6 — уроки (критерий + воркэраунд), merge-политика |

`templates/phases/phase-close.md` — НЕ меняется.

## Шаг 0. `.gitattributes`

Создать в корне:
```
# CHANGELOG собирается из параллельных Close: записи — однострочные буллеты
# под одним якорем [Unreleased], поэтому конфликт по определению структурный.
# union объединяет строки обеих сторон без конфликт-маркеров.
CHANGELOG.md merge=union
```
Проверка: `git check-attr merge CHANGELOG.md` → `CHANGELOG.md: merge: union`.

⚠️ Файл вступает в силу только для merge, начатых **после** его коммита (атрибуты читаются из дерева). Первый же merge после merge этой задачи — проверка.

Регресс-тест (в `src/web/phase-prompt.test.mjs` или `src/core/gitignore.test.mjs` — по месту): файл `.gitattributes` существует и содержит `/^CHANGELOG\.md\s+merge=union$/m`.

## Шаг 1. Перенумерация (отдельным проходом, до правки текста)

1. Переименовать заголовки: 7 → 6 (DoD), 7.5 → 7 (уроки), 7.6 → 8 (refs/lessons), 8 → 9 (документация), 9 → 10 (отчёт), 10 → 11 (файлы подзадач).
2. Слить «Состав ветки» в шаг merge (`git log --oneline master..{{branch}}` — первой строкой шага 3).
3. Пройтись по ссылкам: `grep -n 'шаг' templates/phases/phase-close-worktree.md` — сверить каждую («шаги 3–5», «шаги 6–11», «шаг 6», «шаг 7», «шаг 8», «шаг 9», «шаг 11»).
4. Контроль: `grep -nE '^[0-9]+\.5\.|^[0-9]+\.6\.' templates/phases/phase-close-worktree.md` — пусто.

## Шаг 2. Шапка: подстановки вместо MCP-хода

Добавить в блок «Задача (подставлена автоматически)»:
```
Связи (references): {{taskReferences}}
Уроки по tags: {{taskLessons}}
```
Шаг 8 сократить: убрать `backlog_view_task {"fields": ["references","lessons"]}`, оставить «ID = `{{taskReferences}}` + refs/lessons, созданные в шаге 7».

⚠️ `src/web/phase-prompt.test.mjs:44-56` — в `TASK_VARS` добавить `taskLessons: '(нет)'`, иначе тест «нет неподставленных `{{…}}`» упадёт на `renderPrompt({closeWorktree:true})` (строки ~86-100).

## Шаг 3. Шаг уроков (новый номер 7)

1. **Отбор** вместо квоты: критерий (а) неочевидная причина, (б) **воркэраунд** (что не работает + когда снять обход), (в) ловушка инструмента, (г) правило, которое снова нарушат. Ничего нет — пропустить шаг. Похожий активный — дополнить тело, не создавать второй.
2. **Пометка воркэраунда:** `lesson_update {…, "kind": "workaround"}` — по `kind` `lesson_classify` (VL-280) собирает кандидатов в техдолг.
3. **Поиск похожего:** `lesson_search_lessons {"query": "<ключевые слова>"}` и/или `lesson_list` (НЕ `listLessons` — не существует) с tags задачи, status=active.
4. **Обновление с телом** — образец:
   ```
   lesson_update {"id": "lesson-N", "linkedTasks": ["{{taskId}}", ...], "content": "## Проблема\n\n<что было не так>\n\n## Решение\n\n<что сделали>\n\n## Пример\n\n<конкретный пример>"}
   ```
   + «`content` — ПОЛНАЯ замена тела: существующий текст переносится в вызов целиком».
5. **Создание:** `lesson_create {"title","tags","sourceTasks","content"}` + `lesson_link`; `content` обязателен (инвариант VL-319).
6. **Правило по ответу:** `partial` / `missing: content` → следующий вызов с полным `content`; повтор без него бесполезен; `retryWith.content` — заменить плейсхолдеры, не копировать.
7. **Связь задачи:** `backlog_update_task {"id","lessons": [...]}` (полная замена).
8. **Нефатальность:** не удалось — пропустить, в отчёт «Урок не зафиксирован: <причина>».

Проверка: `grep -n 'lesson_update' templates/phases/phase-close-worktree.md` — образец с `content`.

## Шаг 4. Шаг DoD (новый номер 6)

Убрать `backlog_manage_dod action list`. Текст: «DoD — в блоке задачи выше (`{{taskDoD}}`), индексы 1..N те же; отдельные `check` не вызывай, передай индексы выполненных в `dodChecks` шага 10». Неотмеченные пункты — честно в отчёте.

## Шаг 5. Ветка резолва в шаге merge (новый номер 3)

Сейчас при конфликте — сразу `aborted`. Добавить **одну** проверку перед аварией:

```
git diff --name-only --diff-filter=U
```
- **все** конфликтные пути ∈ {`CHANGELOG.md`, `backlog/docs/*`} → резолв разрешён: «в каждом конфликтном файле оставь ОБА варианта целиком (ничего не удаляй), убери маркеры `<<<<<<<`/`=======`/`>>>>>>>`, затем `git add -- <эти пути>` и `git commit --no-edit`; факт резолва перечисли в отчётном комментарии (файлы и что оставил)»;
- **любой** путь вне этого множества (в т.ч. `backlog/tasks/*`, `backlog/lessons/*`, `backlog/references/*`, `src/`, `templates/`, `*.json`) → прежний `aborted: true` с причиной, шаги 6–11 не выполняются;
- `git merge --abort` — запрещён в обоих случаях.

⚠️ Буллет «Конфликты слияния не резолвь и не откатывай — только отчёт (шаг 4)» в «Запретах» переписать: «Резолв конфликта разрешён ТОЛЬКО в `CHANGELOG.md` и `backlog/docs/*` (оставить оба варианта целиком); любой другой конфликт — аварийный итог, `merge --abort` не делать». Ссылку «(шаг 4)» поправить на новый номер merge-шага.

⚠️ **Формулу «Не завершай цикл как успех» и два `"aborted": true` не менять** — тест `VL-247` сверяет строку между двумя close-шаблонами дословно.

## Шаг 6. Сжатие (по одному месту за проход)

- шаг 2: «-C только для чтения статуса worktree; merge и удаление — из главного cwd»;
- шаг 9 (документация): длинное предупреждение про `allowForeign` → «флаг обязателен по той же причине, что в шаге 8»;
- «Экономия ходов»: оставить только то, чего нет в шагах (пакетирование через `&&`, «код не читай»);
- опечатки: `дополнить..` → `дополнить`; «(была в Code: modified_files непусты …)» → «Условие: задача была в Code (`modified_files` непусты или в комментариях отчёт Фазы 3), иначе шаг пропусти».

**Не трогать:** VL-242-маркеры, буллет «README — витрина», отсутствие `pnpm` в тексте.

## Шаг 7. Инвариант-тесты

```js
describe('VL-364 — шаг уроков close-worktree: образец lesson_update с content', () => {
  const text = readFileSync(join(templatesDir, 'phase-close-worktree.md'), 'utf-8');

  it('образец lesson_update содержит content', () => {
    const calls = [...text.matchAll(/lesson_update\s*\{([^\n]*)\}/g)];
    assert.ok(calls.length > 0, 'вызов lesson_update присутствует');
    assert.ok(calls.some(c => c[1].includes('"content"')), 'образец обязан нести content');
  });

  it('рядом с образцом — правило про missing: content', () => {
    const idx = text.indexOf('lesson_update {');
    assert.match(text.slice(idx, idx + 900), /missing/, 'нет правила про missing: content');
  });

  it('нумерация без дробных шагов', () => {
    assert.deepEqual(text.match(/^[0-9]+\.5\./gm) ?? [], [], 'дробных шагов нет');
  });

  it('узкая ветка резолва: только CHANGELOG.md и backlog/docs', () => {
    assert.ok(text.includes('CHANGELOG.md') && /backlog\/docs/.test(text), 'пути резолва названы');
    assert.ok(!text.includes('merge --abort"), () => {}), 'сентинел-строка не нужна');
  });
});
```
Плюс кейс на `.gitattributes` (см. шаг 0).

Не делать строгим «каждый `lesson_update` содержит `content`» (в отличие от VL-319 для `lesson_create`): вариант «тело есть → привязка без `content`» законен.

## Шаг 8. Проверки

```
pnpm build
npx vitest run src/web/phase-prompt.test.mjs
pnpm test        # один раз
git diff --stat templates/phases/phase-close.md   # пусто
git check-attr merge CHANGELOG.md                  # union
```
Объём: `wc -c templates/phases/phase-close-worktree.md` до/после — ≥10% меньше.

## Риски

1. **Затирание тела чужого урока** — снимается оговоркой «`content` — полная замена».
2. **Перенумерация ломает ссылки** — греп по `шаг` + контроль дробных.
3. **Сжатие задевает тестовые маркеры** — список «не трогать»; `phase-prompt.test.mjs` прогнать отдельно до полного прогона.
4. **`{{taskLessons}}` роняет VL-137** — `TASK_VARS` правится в том же коммите.
5. **`merge=union` даёт дубль заголовка раздела** — разделы Unreleased заведены заранее, фазами не создаются; при появлении дубля — ручная правка при выпуске релиза (приемлемо).
6. **Расхождение с `phase-close.md`** — на время правки шаблоны разойдутся по нумерации, тексту урока и merge-ветке; перенос — следующей задачей.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-07 22:14
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- templates/phases/phase-close-worktree.md
- .vibelog/tmp/patch-vl364.mjs
- .vibelog/tmp/build-vl364.mjs
- .vibelog/tmp/build2-vl364.mjs
- .vibelog/tmp/build3-vl364.mjs
- .vibelog/tmp/build4-vl364.mjs
- .vibelog/tmp/patch2-vl364.mjs
- .vibelog/tmp/patch3-vl364.mjs
- .vibelog/tmp/patch4-vl364.mjs
- .vibelog/tmp/patch5-vl364.mjs
- I'll start by orienting in the worktree and reading the target template.
Baseline green. Now writing the new template.
Now compressing to meet the ≥10% size reduction requirement.
The template is currently larger than the original; I need the ≥10% reduction. I'll apply the remaining compression atom…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 1022 с, payload 724885 байт_
Незакоммиченные изменения сохранены в ветку: коммит `57933f6`.
---
author: @agent
created: 2026-11-07 22:14
---
Фаза code не удалась (код выхода 1): кировок=5, payload последнего запроса=724885 байт (макс 724885), usage={"input_tokens":9595091,"output_tokens":134219,"cache_read_input_tokens":9315840,"total_tokens":9729310,"reasoning_tokens":32205} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-07 22:50
---
Фаза 3 (Code) выполнена. Коммит 004c5c2 (fix: VL-364 — образец lesson_update с content, критерий отбора уроков, merge=union для CHANGELOG).
Изменено:
- `templates/phases/phase-close-worktree.md` — перенумерация шагов 1–11 (дробные 7.5/7.6 убраны, «Состав ветки» слит с merge, все перекрёстные ссылки обновлены); шаг уроков переписан: образец `lesson_update` с `content` (`## Проблема`/`## Решение`/`## Пример`) + оговорка «content — ПОЛНАЯ замена тела»; правило по ответу `partial`/`missing: content` → следующий вызов с полным телом, каркас `retryWith.content` — заменить плейсхолдеры (продублировано для `lesson_create`); квота «1–3 урока» заменена критерием отбора с воркэраундом, `kind: workaround`, приоритет дополнения существующего урока; нефатальность шага («Урок не зафиксирован: <причина>»); `listLessons` → `lesson_list`; шапка получила `{{taskReferences}}`/`{{taskLessons}}` (минус два MCP-хода), шаг refs/lessons больше не вызывает `backlog_view_task`; шаг DoD без `backlog_manage_dod action list`; узкая ветка резолва конфликта (только `CHANGELOG.md` и `backlog/docs/*`, «оставить оба варианта целиком», `git add` по явным путям + `git commit --no-edit`), остальные пути — `aborted: true`; буллет «Конфликты слияния не резолвь» переписан; дубль `allowForeign` в шаге документации → ссылка на шаг 8; «Экономия ходов» очищена; объём 21660 → 19485 байт (−10.0%).
- `.gitattributes` (новый) — `CHANGELOG.md merge=union`; `git check-attr merge CHANGELOG.md` → `union`.
- `src/web/phase-prompt.test.mjs` — `TASK_VARS.taskLessons`, новый `describe` VL-364 (образец с `content`, правило про `missing`, отсутствие дробных шагов, узкая ветка резолва, критерий отбора/`kind: workaround`/нефатальность, отсутствие `backlog_manage_dod action list`, подстановки шапки) + кейс на `.gitattributes`.
Проверки: `pnpm build` — ок; `npx vitest run src/web/phase-prompt.test.mjs` — 103 passed; полный `npx vitest run` — 190 файлов, 3569 passed, 4 skipped, 0 failed (лог `.vibelog/tmp/vl364-test.log`); `git diff --stat templates/phases/phase-close.md` — пусто (шаблон не тронут); `git check-attr merge CHANGELOG.md` → `union`; строка «Не завершай цикл как успех» дословно совпадает с `phase-close.md`, `"aborted": true` — 4 вхождения.
Что осталось: AC19 (документация — doc-10 §6 про критерий отбора уроков и merge-политику, CHANGELOG.md) — по правилам фазы Code документацию пишет Фаза Close после merge, поэтому пункт не отмечен. Перенос правки в `templates/phases/phase-close.md` — отдельной задачей (вне области этой).
---
author: @agent
created: 2026-11-08 00:05
---
Фаза Close выполнена. Ветка vb/vl-364 слита в master (1 коммит 004c5c2, merge bb1d779), worktree удалена (--force: в ней оставались только untracked `backlog/references/data` и игнорируемые `dist/`/`node_modules`-симлинк), ветка vb/vl-364 удалена.
Проверки после merge: `pnpm build` — ок; ранний точечный фильтр `npx vitest run src/web/phase-prompt.test.mjs` — 103 passed; полный прогон `npx vitest run` — 196 файлов, 3665 passed, 4 skipped, 0 failed (один прогон, повторов не было). Diff merge затронул `.gitattributes`, `src/web/phase-prompt.test.mjs`, `templates/phases/phase-close-worktree.md`.
Уроки: lesson-241 (готовый образец вызова в retryWith) — тело заполнено (было скелетом), linked_tasks += VL-364; создан lesson-248 (merge=union для CHANGELOG вместо ручного резолва) + lesson_link. Коммит refs/lessons: 72c3ca1.
Документация: doc-10 §6 — критерий отбора уроков с воркэраундом, правило `content`/`missing` для `lesson_update`/`lesson_create`, merge-политика (`merge=union` + узкий резолв прозы), номера шагов обновлены (7/8); CHANGELOG.md — запись VL-364 в Unreleased/Исправлено. Коммит: 0106846.
DoD: 1. Тесты проходят — да (полный прогон зелёный); 2. Документация обновлена — да (doc-10 §6 + CHANGELOG, AC19 отмечен); 3. Нет регрессий — да.
---
<!-- COMMENTS:END -->