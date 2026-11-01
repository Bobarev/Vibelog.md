---
id: VL-273
title: Удалить устаревшую роль orchestrator из реестра chat_personas (заменена supervisor)
status: Done
assignee: []
reporter: ''
created_date: '2026-11-01 14:59'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - web
  - chat
  - personas
  - cleanup
dependencies: []
milestone: v1.11
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/personas.ts
  - src/web/personas.test.mjs
  - src/web/chat.test.mjs
  - web/src/components/chat/pickers.tsx
  - scripts/npm-smoke.mjs
  - README.md
  - templates/prompts/chat-system.md
  - templates/prompts/personas/orchestrator.md
  - web/dist
lessons:
  - lesson-132
  - lesson-133
token_usage:
  input: 5920701
  output: 65434
  cache: 5507840
  total: 5986135
  requests: 102
  duration_ms: 644690
  reasoning: 40086
  by_phase:
    plan:
      input: 959589
      output: 22915
      cache: 863488
      requests: 20
    code:
      input: 3724991
      output: 35474
      cache: 3481856
      requests: 53
    close:
      input: 1236121
      output: 7045
      cache: 1162496
      requests: 29
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Зачем

Роль `orchestrator` («Оркестратор») устарела и вводит в заблуждение. Решение пользователя: **удалить**.

## Почему она больше не нужна

1. **Дублирует `supervisor`.** У нас теперь две роли примерно об одном: `orchestrator` («согласует, какие задачи запускать и в каком порядке») и `supervisor` («ведёт прогон: запускает фазы, лечит зацикливания, заводит баги»). После VL-268 (MCP-инструменты запуска фаз) и VL-270 (тик, healing) супервизор делает всё, что обещал оркестратор, и делает это реально, а не только на словах.

2. **Её промпт описывает несуществующие ограничения.** `templates/prompts/personas/orchestrator.md` утверждает:

   > «Запуск фаз (`backlog_finish_phase`) и прочие инструменты фазового workflow в чате **технически недоступны** — они входят в запрещённый список веб-чата. Поэтому ты готовишь и согласуешь план оркестрации, а фактический запуск фаз выполняет оркестратор Vibelog (реализация запуска фаз из чата — отдельная задача).»

   Это было верно до VL-268. Сейчас инструменты `backlog_trigger_phase`, `backlog_phase_status`, `backlog_auto_queue`, `backlog_supervisor` в чате **есть** — то есть роль прямо дезинформирует модель, заставляя её отказываться от доступных действий.

3. **Она опирается на отвергнутый критерий.** Промпт предлагает оценивать конфликты по `modified_files`:

   > «задачи, меняющие одни и те же файлы (`modified_files` в задачах, `search_files` по коду), нельзя вести параллельно»

   Это тот самый подход, от которого мы отказались: поле заполняется только фазой `code`, а worktree создаётся на `plan`/`do` (`src/web/orchestrator.ts:818`), поэтому на момент планирования признак пуст. В doc-19 §14 и в промпте супервизора это специально оговорено как ловушка.

4. **Путаница в терминологии.** Имя роли `orchestrator` совпадает с модулем `src/web/orchestrator.ts` (спавнер одной фазы), от которого мы специально ушли, выбрав для роли имя `supervisor` (см. doc-19 §1 «Терминология»). Оставлять роль с «занятым» именем — сохранять ту самую неоднозначность.

## Что сделать

1. Удалить запись `orchestrator` из `BUILTIN_PERSONAS` (`src/web/personas.ts`). Встроенных ролей остаётся три: `helper`, `architect`, `supervisor`.
2. Удалить файл `templates/prompts/personas/orchestrator.md`.
3. Проверить, что удаление не создаёт «дыру» в реестре:
   - запись `orchestrator` в `chat_personas` (.vibelog/settings.json) не должна воскрешать удалённую роль — по текущей логике `loadPersonas` такая запись **добавит новую** проектную роль с этим id. Решить: либо это допустимо (проект может завести себе такую роль осознанно), либо заблокировать id удалённой роли. Рекомендация: **допустимо** — секция и есть механизм «завести свою роль», но в задаче это надо проверить тестом, чтобы поведение было осознанным, а не случайным.
   - `persona: "orchestrator"` в POST /api/chat → понятная ошибка «Неизвестная роль» (существующая валидация, спецобработка не нужна).
4. Проверить, нет ли проектного переопределения `.vibelog/prompts/personas/orchestrator.md` (в этом проекте есть только `researcher.md` и `auditor.md` — не конфликтует).
5. Актуализировать документацию: README (список ролей), CHANGELOG, при необходимости doc-19 §1.
6. Тесты: `src/web/personas.test.mjs` ожидает 4 роли — привести к 3; добавить кейс на `persona: "orchestrator"` → ошибка; проверить, что `supervisor` не затронут.

## История

VL-265 добавила три встроенные роли (helper/architect/orchestrator), VL-270 добавила четвёртую — `supervisor`. Исторические задачи **не переписываем**: они корректно описывают состояние на свой момент. Актуальное состояние фиксируется в README, CHANGELOG и коде.

## Файлы

- `src/web/personas.ts` — `BUILTIN_PERSONAS` (удалить запись), комментарий к шапке (там перечислены имена встроенных ролей).
- `templates/prompts/personas/orchestrator.md` — удалить файл.
- `src/web/personas.test.mjs` — количество ролей и кейс неизвестной роли.
- `README.md`, `CHANGELOG.md` — списки ролей.
- `web/` — если в подписях/подсказках пикера где-то перечислены роли (проверить поиском).

## Связи

- **VL-265** — добавила роль (Done, историю не трогаем).
- **VL-270** — добавила `supervisor`, который её замещает.
- **doc-19 §1** — терминология supervisor vs `src/web/orchestrator.ts`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Роль orchestrator удалена из BUILTIN_PERSONAS в src/web/personas.ts: роль больше не появляется в GET /api/personas и в пикере ролей веб-чата
- [x] #2 Шаблон templates/prompts/personas/orchestrator.md удалён из репозитория; ссылок на него в коде и документации не осталось (проверено поиском по 'orchestrator' в templates/ и src/ — совпадений в контексте роли нет)
- [x] #3 Проектное переопределение .vibelog/prompts/personas/orchestrator.md, если существует, не читается и не ломает загрузку реестра (роль просто отсутствует)
- [x] #4 Отправка persona='orchestrator' в POST /api/chat даёт понятную ошибку «Неизвестная роль: orchestrator» (ход не начинается) — существующая валидация работает без специальной обработки
- [x] #5 Секция chat_personas в .vibelog/settings.json не содержит записи orchestrator; если запись там есть, она игнорируется с понятной ошибкой в списке errors от GET /api/personas (то есть попытка переопределить удалённую встроенную роль не создаёт её заново)
- [x] #6 Роль supervisor остаётся рабочей и не затронута: её промпт, лимиты и defaultStatus не изменились
- [x] #7 Тесты обновлены: personas.test.mjs — вместо ожидания 4 встроенных ролей проверяет 3 (helper, architect, supervisor); тест на ошибку неизвестной роли покрывает 'orchestrator'; отдельная проверка, что проектная запись с id удалённой роли не воскрешает её
- [x] #8 Документация актуализирована: README (раздел «Роли ассистента») и CHANGELOG не упоминают orchestrator как доступную роль; doc-19 не содержит ссылок на роль orchestrator в реестре (проверено поиском)
- [x] #9 pnpm build, pnpm lint и полный pnpm test проходят; web: npm run build и npm run lint проходят (пикер ролей не содержит удалённой роли)
- [x] #10 Исторические задачи (VL-265 и др.), где orchestrator упоминается как третья встроенная роль, не переписываются — актуальное состояние отражено только в README, CHANGELOG и коде
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Решение по спорному пункту (AC5 vs описание)

В описании задачи рекомендация — «допустимо» (запись `chat_personas.orchestrator` создаёт НОВУЮ проектную роль), но AC5 требует обратного: «запись игнорируется с понятной ошибкой в списке errors». Принимаю **блокировку id удалённой роли**: AC5 и AC7 формулируют проверяемое поведение («не воскрешает её»), а блокировка ещё и не даёт пикеру молча вернуть подпись «Оркестратор» из чужого/старого settings.json. Снятие блока — удаление одной строки из `RETIRED_PERSONA_IDS` (если пользователь предпочтёт вариант «допустимо»).

## Файлы и точки правки

### 1. `src/web/personas.ts`
- Шапка, строка 13: `helper / architect / orchestrator` → `helper / architect / supervisor` (перечисление встроенных ролей).
- Новая константа рядом с `BUILTIN_PERSONAS`:
  ```ts
  /** id удалённых встроенных ролей: запись в chat_personas с таким id не воскрешает роль */
  export const RETIRED_PERSONA_IDS: readonly string[] = ['orchestrator'];
  ```
- `BUILTIN_PERSONAS` (строки 96–111): удалить блок `{ id: 'orchestrator', label: 'Оркестратор', prompt: 'orchestrator', defaultStatus: 'Spec' }`. Остаются три: `helper` (Spec), `architect` (Planned), `supervisor` (Spec). Порядок `helper → architect → supervisor` сохраняем.
- `loadPersonas` (строки 129–183), цикл по `Object.entries(raw)`: ПЕРВОЙ проверкой в теле цикла (до проверки «должна быть объектом») вставить:
  ```ts
  if (RETIRED_PERSONA_IDS.includes(id)) {
    errors.push(`settings.json: роль "${id}" удалена из реестра (заменена ролью "supervisor") — запись чат-персон с этим id игнорируется`);
    continue; // роль не добавляется и НЕ переопределяет встроенные
  }
  ```
  Остальная логика слияния/переопределения по id не меняется (встроенные id — те же три плюс проектные).

### 2. `templates/prompts/personas/orchestrator.md` — удалить файл (в каталоге остаются `helper.md`, `architect.md`, `supervisor.md`). В `package.json` каталог `templates` включён целиком, отдельных ссылок на файл нет.

### 3. `src/web/personas.test.mjs` (ожидания на 4 роли → 3)
- строка 78: `['helper','architect','orchestrator','supervisor']` → `['helper','architect','supervisor']`; строки 88–89: `BUILTIN_PERSONAS.length` 4 → 3; добавить `resolvePersona(cwd,'orchestrator') === null`.
- строки ~112, 124, ~129, ~133: `personas.length` 4 → 3; deepEqual со `'researcher'` — `['helper','architect','supervisor','researcher']`, проектная роль теперь `personas[3]` (индекс в кейсах на researcher/`loadPersonaPrompt`).
- строка ~247 и ~256: `GET /api/personas` — deepEqual ids без `orchestrator`, `personas.length` 4 → 3.
- Новые кейсы (AC5/AC3/AC6):
  - запись `chat_personas.orchestrator` → в `errors` есть про удалённую роль и id, в `personas` id `orchestrator` НЕТ, встроенных 3, `supervisor` (label «Супервизор», prompt `supervisor`, defaultStatus `Spec`) не затронут;
  - наличие `chat_personas.orchestrator` + файл `.vibelog/prompts/personas/orchestrator.md` в проекте → реестр загружается без исключения, роли те же 3, шаблон не читается;
  - `GET /api/personas` с такой секцией → 200, `errors` непуст, `personas.length === 3`.

### 4. `src/web/chat.test.mjs` (AC4)
- Новый кейс по образцу существующего «неизвестная роль → error-событие» (строка ~830): `persona: 'orchestrator'` → `error` с текстом `Неизвестная роль: orchestrator`, `state.calls === 0` (LLM не вызывался), jsonl треда не создан. Кода в `src/web/chat.ts` менять НЕ нужно: валидация generic (`resolvePersona` → null, строки 616–620).

### 5. `web/src/components/chat/pickers.tsx`
- строка 55: удалить `orchestrator: Network,` из `PERSONA_ICONS` (проектные researcher/auditor/coder оставить);
- строка 42: удалить импорт `Network` из `lucide-react` (после удаления записи он больше не используется — иначе `npm run lint` упадёт на unused import).

### 6. `scripts/npm-smoke.mjs`
- строка 165: `['helper','architect','orchestrator']` → `['helper','architect','supervisor']` (проверка «шаблон роли X.md в пакете»; иначе smoke упадёт на удалённом файле).

### 7. Документация
- `README.md`, строки 419–424: в перечне встроенных ролей убрать `orchestrator` «Оркестратор» (план запуска задач); остаются helper/architect/supervisor. Формулировку про supervisor не менять.
- `CHANGELOG.md`: в `## [Unreleased]` → `### Изменено` добавить буллет `- **VL-273: удалена устаревшая роль orchestrator из реестра chat_personas** — …` (роль дублировала supervisor, её промпт описывал несуществующий запрет запуска фаз и опирался на отвергнутый критерий `modified_files`; убраны запись из `BUILTIN_PERSONAS`, шаблон, иконка пикера, id внесён в `RETIRED_PERSONA_IDS`; тесты обновлены; полный `pnpm test`). Исторические буллеты VL-265/VL-270 НЕ править.
- `backlog/docs/doc-19`: правок не требуется — там `orchestrator` встречается только как модуль `src/web/orchestrator.ts` (§1 «Терминология», §22), упоминаний роли-персоны `orchestrator` в реестре нет.

## Порядок действий
1. Правки `src/web/personas.ts` (шапка, `RETIRED_PERSONA_IDS`, `BUILTIN_PERSONAS`, guard в `loadPersonas`).
2. Удалить `templates/prompts/personas/orchestrator.md` (`git rm`).
3. Обновить и дополнить `src/web/personas.test.mjs`, добавить кейс в `src/web/chat.test.mjs`.
4. Убрать роль из `web/src/components/chat/pickers.tsx` (запись + импорт).
5. Поправить `scripts/npm-smoke.mjs`.
6. README + CHANGELOG.
7. Поисковая проверка на остатки: `search_files 'orchestrator'` по `templates/**`, `src/web/personas*`, `web/src/**`, README — совпадений в контексте роли быть не должно (модуль `src/web/orchestrator.ts` и его упоминания — ожидаемы).

## Проверка
```
pnpm build && pnpm lint && pnpm test          # полный прогон (DoD «Тесты проходят»)
cd web && npm run build && npm run lint       # пикер ролей и сборка фронта
node scripts/npm-smoke.mjs                    # после pnpm build + web:build
```
Ожидаемо: `BUILTIN_PERSONAS.length === 3`, GET /api/personas отдаёт 3 роли (без orchestrator), `persona: 'orchestrator'` → `Неизвестная роль: orchestrator`.

## Риски
- **npm-smoke** проверяет наличие `orchestrator.md` в tarball — без правки шага 6 smoke падает (единственная внешняя проверка роли, найденная поиском).
- **Unused import** `Network` в `pickers.tsx` — падает `npm run lint` фронта, поэтому убирать запись и импорт вместе.
- **Индексы-зависимые ассерты** `personas.test.mjs` (`personas[4]`, длины 4) — при пропуске кейса проектная роль сдвинется на `personas[3]`; менять все перечисленные точки.
- **Интерференция с проектной конфигурацией**: локальный (gitignored) `.vibelog/settings.json` может содержать `chat_personas.orchestrator` — после правки будет ошибка в `errors` от GET /api/personas и роль исчезнет из пикера; это и есть целевое поведение (в worktree `.vibelog/` нет).
- **Ложное «не осталось ссылок»**: grep по `orchestrator` даёт много легитимных совпадений (модуль `src/web/orchestrator.ts`, его импорты, doc-19 §1). Проверять только контекст роли (templates/prompts/personas, BUILTIN_PERSONAS, PERSONA_ICONS, README §«Роли ассистента»).
- **Роль supervisor не затрагивается**: её промпт, `supervisor.limits` и `defaultStatus: 'Spec'` в план не входят; кейс-инвариант на неизменность supervisor добавляется в тесты (AC6).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-01 16:00
---
Фаза 2 (Plan) выполнена. Тип: task (обычная задача, не epic — план записан в саму задачу).
**Изучено:** `src/web/personas.ts` (полностью: шапка, `BUILTIN_PERSONAS`, `loadPersonas`, `loadPersonaPrompt`), `src/web/personas.test.mjs` (полностью), `src/web/chat.ts:600-632` (валидация роли), `src/web/chat.test.mjs:~830` (кейс неизвестной роли), `README.md:411-465`, `CHANGELOG.md` (§Unreleased), `web/src/components/chat/pickers.tsx:40-70`, `scripts/npm-smoke.mjs:150-185`, doc-19 (§1 «Терминология», §22) + целевой поиск по `orchestrator`.
**План:** записан в Implementation Plan задачи — 7 точек правки, порядок действий, команды проверки, 6 рисков.
**Ключевые находки (сверх описания задачи):**
1. **`web/src/components/chat/pickers.tsx:55` — `orchestrator: Network` в `PERSONA_ICONS`** и импорт `Network` (строка 42). В задаче было «проверить поиском» — нашлось: иконку и импорт надо удалить вместе (иначе `npm run lint` фронта падает на unused import).
2. **`scripts/npm-smoke.mjs:165`** — smoke проверяет наличие `templates/prompts/personas/{helper,architect,orchestrator}.md` в tarball; без правки на `supervisor` падает. Это единственная внешняя проверка удаляемой роли.
3. **`personas.test.mjs` зависим от индексов** (`personas[4]`, длины 4 в 6 местах) — после удаления роли проектная сдвигается на `personas[3]`; перечислены все точки.
4. **doc-19 правок не требует**: там `orchestrator` встречается только как модуль `src/web/orchestrator.ts` (§1 «Терминология», §22), упоминаний персоны `orchestrator` в реестре нет.
5. Реестр загружает `loadPersonas` терпимо (`errors`), кода в `src/web/chat.ts` менять НЕ нужно — валидация роли generic (`resolvePersona` → null).
**Противоречие внутри задачи, решение принято и зафиксировано в плане:** описание рекомендует «допустимо» (запись `chat_personas.orchestrator` создаёт новую проектную роль), а AC5/AC7 требуют обратного («запись игнорируется с понятной ошибкой в errors… не воскрешает её»). Принят вариант AC: новая константа `RETIRED_PERSONA_IDS = ['orchestrator']`, guard первым в цикле `loadPersonas` → запись отбрасывается с понятной ошибкой. Снятие блока — удаление одной строки, если пользователь предпочтёт вариант «допустимо». Расхождение рекомендуется уточнить в AC5 (или принять оба варианта как уже сделанный выбор).
**Объём:** 7 файлов (2 src, 1 шаблон на удаление, 1 web, 1 scripts, README, CHANGELOG); новых файлов не создаётся; блокеры не нужны — задача локальная, зависимости отсутствуют. Риски перечислены в плане.
---
author: @agent
created: 2026-11-01 16:05
---
Фаза 3 (Code) выполнена. Коммит `5aa6939` (`feat: VL-273 — удалить устаревшую роль orchestrator из реестра chat_personas`).
**Изменено (8 файлов):**
- `src/web/personas.ts` — шапка (`helper / architect / supervisor`), удалён блок `orchestrator` из `BUILTIN_PERSONAS` (осталось 3: helper/architect/supervisor), новая экспортируемая константа `RETIRED_PERSONA_IDS = ['orchestrator']`, guard первым действием в цикле `loadPersonas` — запись `chat_personas.orchestrator` отбрасывается с ошибкой «роль "orchestrator" удалена из реестра (заменена ролью "supervisor") — запись chat_personas с этим id игнорируется».
- `templates/prompts/personas/orchestrator.md` — удалён (`git rm`); в каталоге остались helper/architect/supervisor.
- `src/web/personas.test.mjs` — ожидания 4→3 роли и индексы (`personas[3]` вместо `[4]`), импорт `RETIRED_PERSONA_IDS`, новый describe «удалённая роль orchestrator (VL-273)»: (1) запись `chat_personas.orchestrator` → ошибка + ролей 3 + `resolvePersona('orchestrator') === null`, (2) проектный `.vibelog/prompts/personas/orchestrator.md` не читается и не ломает реестр, (3) `GET /api/personas` → 200, errors непуст, ролей 3, (4) `RETIRED_PERSONA_IDS` содержит только живых соседей. Кейс-инвариант: label/prompt/defaultStatus supervisor («Супервизор», `supervisor`, `Spec`) не изменились. Итого 21 тест в файле.
- `src/web/chat.test.mjs` — кейс `persona: 'orchestrator'` → `error` «Неизвестная роль: orchestrator», `state.calls === 0`, jsonl не создан (кода `chat.ts` менять не понадобилось — валидация generic).
- `web/src/components/chat/pickers.tsx` — убраны `orchestrator: Network` из `PERSONA_ICONS` и импорт `Network` (иначе unused-import ломает lint фронта).
- `scripts/npm-smoke.mjs` — проверка шаблонов ролей в tarball: `['helper','architect','orchestrator']` → `['helper','architect','supervisor']`.
- `README.md` — в перечне встроенных ролей убран «Оркестратор».
- `templates/prompts/chat-system.md` — **сверх плана**: в общей части промпта чата перечислялись роли «(Помощник, Архитектор, Оркестратор или проектная роль)» → «(Помощник, Архитектор, Супервизор или проектная роль)». Это единственная оставшаяся ссылка на роль в templates/ (найдена поиском на шаге 7 плана).
**Проверки (все зелёные):**
- `pnpm build` — OK; `pnpm lint` (`node --check` bin/*.mjs) — OK.
- **полный `pnpm test`** — 2 прогона: 2185 passed | 4 skipped, затем статик-прогон `src/web/static.test.mjs` 8 passed. Никаких `--exclude`/`--skip`, исключённых файлов нет.
- точечный прогон до полного: `npx vitest run src/web/personas.test.mjs src/web/chat.test.mjs` — 74 passed.
- `web`: `npm run build` — OK (✓ built 2.06s), `npm run lint` — 0 errors, 1 warning (предсуществующий `react-hooks/exhaustive-deps` в `grant-scope.tsx`, к этой задаче не относится).
- `node scripts/npm-smoke.mjs` — **30/30 PASS** (в т.ч. три шаблона ролей: helper/architect/supervisor).
- Поиск остатков: `orchestrator` в README/`src/web/personas.ts`/`pickers.tsx`/`templates/` встречается только в guard'е `RETIRED_PERSONA_IDS` и его комментарии; прочие совпадения — легитимный модуль `src/web/orchestrator.ts` и исторические записи CHANGELOG/backlog (не трогались, AC10).
**Осталось (не отмечаю):**
- **AC8 — частично**: README обновлён, но CHANGELOG в фазе Code править запрещено (документация пишется в Close) — пункт закрывает фаза Close вместе с буллетом VL-273 в `## [Unreleased] → ### Изменено`. Соответственно DoD «Документация обновлена» тоже оставлен открытым для Close.
- doc-19 правок не требует: `orchestrator` там только как модуль `src/web/orchestrator.ts` (§1 «Терминология», §22).
**Расхождение AC5 vs описания задачи** (см. план): реализован вариант AC — блокировка id. Реестр загружается терпимо, чат не падает; снятие блока — удаление одной строки из `RETIRED_PERSONA_IDS`.
---
author: @agent
created: 2026-11-01 16:09
---
Фаза Close выполнена.
**Merge:** ветка `vb/vl-273` слита в master одним коммитом `5aa6939` → merge-коммит (12 файлов изменено, 159 insertions / 78 deletions): `src/web/personas.ts`, `src/web/personas.test.mjs`, `src/web/chat.test.mjs`, `web/src/components/chat/pickers.tsx`, `scripts/npm-smoke.mjs`, `README.md`, `templates/prompts/chat-system.md`, удалён `templates/prompts/personas/orchestrator.md`, пересобран `web/dist`. Конфликтов не было.
**Проверки после merge (все зелёные):**
- `pnpm build` + `pnpm lint` — OK.
- Ранний точечный фильтр по diff (`personas.test.mjs` + `chat.test.mjs`) — 74 passed.
- Полный `pnpm test` — 119 файлов, 2185 passed | 4 skipped; второй статик-прогон `src/web/static.test.mjs` 8 passed. Никаких `--exclude`/`--skip`.
- `web`: `npm run build` OK, `npm run lint` — 0 errors, 1 warning (предсуществующий `react-hooks/exhaustive-deps` в `grant-scope.tsx`, к задаче не относится).
- `node scripts/npm-smoke.mjs` — 30/30 PASS (три шаблона ролей: helper/architect/supervisor).
**Уборка:** worktree `.vibelog/worktrees/vl-273` удалена (`--force` — в ней были только untracked-симлинки `node_modules`/`backlog/references/data`, ведущие в главный репо, данные не терялись), `git worktree prune`, ветка `vb/vl-273` удалена (`git branch -d`, was 5aa6939).
**Документация:** CHANGELOG получил буллет VL-273 в `## [Unreleased] → ### Изменено` (док-коммит `c4a0aee`). README §«Роли ассистента» был обновлён ещё в фазе Code (встроенных ролей три: helper/architect/supervisor). doc-19 правок не требует — `orchestrator` там только как модуль `src/web/orchestrator.ts` (§1 «Терминология», §22). Исторические буллеты VL-265/VL-270 не правились (AC10).
**Lessons:** созданы и связаны lesson-132 (внешние точки роли: PERSONA_ICONS+импорт, npm-smoke, chat-system.md, README) и lesson-133 (RETIRED_PERSONA_IDS — блокировка воскрешения id через chat_personas). Коммит `docs(task): VL-273 — refs и lessons`.
**DoD:** «Тесты проходят» — полный `pnpm test` после merge; «Документация обновлена» — README + CHANGELOG + проверка doc-19; «Нет регрессий» — регрессий нет (шумных падений и различий с родительским коммитом не обнаружено).
**AC8** закрыт в этой фазе: README и CHANGELOG больше не упоминают orchestrator как роль, doc-19 чист по поиску (совпадения — только модуль `src/web/orchestrator.ts`).
---
<!-- COMMENTS:END -->