---
id: VL-401
title: 'Память персоны веб-чата: файл .memory.md, подстановка в системный промпт, лимит из settings, git-исключение'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-10 10:27'
updated_date: '2026-11-10 10:54'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/web/personas.ts
  - src/web/chat.ts
  - src/web/persona-memory.test.mjs
  - src/web/personas.test.mjs
  - src/core/gitignore.ts
  - src/core/gitignore.test.mjs
  - web/src/components/settings/api.ts
  - .vibelog/.gitignore
lessons:
  - lesson-209
token_usage:
  input: 3745699
  output: 26990
  cache: 3629056
  total: 3772689
  requests: 64
  duration_ms: 711836
  reasoning: 10278
  by_phase:
    code:
      input: 2286418
      output: 19378
      cache: 2213888
      requests: 35
    close:
      input: 1459281
      output: 7612
      cache: 1415168
      requests: 29
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст (обсуждение roadmap 2026-11-09, пункт «Agent memory»).

Исходная формулировка в ROADMAP.md («`.vibelog/agent-memory/`, auto-extract при завершении фазы, recall в system prompt») смешивала две разные вещи: знания о коде проекта (это lessons) и знания о пользователе (как с ним разговаривать, что он не любит, какие решения уже приняты). Вторая — свойство персоны, а не репозитория.

Симптом, с которого началось: пользователь поправляет ассистента («не пиши англицизмами», «объясняй термины»), поправка живёт до конца треда, в новом треде ассистент знакомится заново. Сейчас в проекте нет никакого механизма памяти между тредами: история лежит в `.vibelog/chat-sessions/<threadId>.jsonl` (свой файл у каждого треда), промпт роли — статичный md-файл, который правится руками.

Решения, принятые в обсуждении:
- хранение — в проекте, рядом с промптом роли: `.vibelog/prompts/personas/<prompt>.memory.md`;
- в git НЕ попадает (там может быть личная информация) — точечное исключение в `.vibelog/.gitignore`;
- память своя у каждой персоны (не общая на проект);
- формат — список строк с датой в конце: `- Не использовать англицизмы без перевода. (2026-11-10)`;
- размер — настройка в settings.json, дефолт ~2500 символов; при переполнении ошибка/пометка, не молчаливая обрезка;
- в фазы не подставляется (механизм `buildSystemPrompt(cwd, {chat:true})` уже есть, VL-238/lesson-134).

Эта задача — только чтение и подстановка. Запись (инструмент `memory_remember`, строка в ленте с отменой, команда `/memory`) — отдельная задача. После этой задачи память уже работает, если положить файл руками.

Связанные: ROADMAP.md §«Agent memory (свой)», VL-265 (реестр персон), VL-238 (чат-блок промпта, opt-in), VL-400 (recall уроков — соседняя тема, не пересекается).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Файл памяти персоны читается из `.vibelog/prompts/personas/<prompt>.memory.md` (имя берётся из поля `prompt` роли, как у промпта); отсутствие файла — норма, промпт собирается без блока памяти
- [x] #2 Память подставляется в системный промпт веб-чата отдельным блоком `## Память персоны` между блоком роли и контекстом поиска; в headless-фазы и TUI-агент НЕ попадает (инвариант закреплён тестом от обратного, как VL-238)
- [x] #3 Лимит размера задаётся в `.vibelog/settings.json` (секция `chat_personas` или новая `persona_memory`, ключ `max_chars`), дефолт 2500; битое значение → дефолт + сообщение в errors, без падения чата
- [x] #4 При превышении лимита память НЕ обрезается молча: в промпт уходит блок с явной пометкой «память превышает лимит N символов, показываю первые N» и в `GET /api/personas` приходит предупреждение
- [x] #5 `.vibelog/.gitignore` исключает `prompts/personas/*.memory.md` (личная информация не уезжает в git); существующее правило `!prompts/**` не ломается — проверено `git check-ignore`
- [x] #6 `GET /api/personas` отдаёт для каждой роли флаг наличия памяти и её размер (без текста памяти — как сейчас без текста промпта)
- [x] #7 Тесты: чтение файла и подстановка в промпт, отсутствие файла, превышение лимита, настройка лимита из settings, инвариант «не протекает в фазы», git-исключение
- [x] #8 Документация: doc-6 (раздел ролей — память персоны), doc-31 (системный промпт чата), CHANGELOG
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Проверено по коду

| Утверждение | Где видно |
|---|---|
| Реестр персон: встроенные + секция `chat_personas`, поле `prompt` = имя файла шаблона | `src/web/personas.ts` (`BUILTIN_PERSONAS`, `loadPersonas`, `PersonaConfig.prompt`) |
| Резолвер промпта роли: `.vibelog/prompts/personas/<prompt>.md` → `templates/prompts/personas/<prompt>.md`, fail-closed | `src/web/personas.ts` (`loadPersonaPrompt`, `PROJECT_PERSONAS_DIR`) |
| Сборка промпта чата: общая часть → блок роли → контекст поиска | `src/web/chat.ts` (`buildSystemPrompt`), `templates/prompts/chat-system.md` |
| Чат-блок TUI подключается только при `chat: true` (инвариант «не протекает в фазы») | `src/agent/system-prompt.ts:127` (`buildSystemPrompt(cwd, opts)`) |
| `GET /api/personas` отдаёт `{personas:[{id,label,description}], default, errors}` без текстов промптов | `src/web/personas.ts` (`PersonaSummary`), `src/web/api.ts` |
| Политика `.vibelog/.gitignore`: `*` + `!*/`, затем явные `!prompts/`, `!prompts/**` | `.vibelog/.gitignore` (строки 5-го блока) |
| Кап вставки AGENTS.md — 8000 символов с пометкой об обрезке (образец поведения) | `src/agent/system-prompt.ts` (`AGENTS_MD_MAX_CHARS`) |

## Шаги

1. **`src/web/personas.ts` — чтение памяти.**
   - Новая константа `PERSONA_MEMORY_SUFFIX = '.memory.md'`.
   - `loadPersonaMemory(cwd, persona): { text: string; chars: number; truncated: boolean; exists: boolean }` — читает `<PROJECT_PERSONAS_DIR>/<persona.prompt>.memory.md`. Только проектный путь: встроенной памяти у встроенных ролей нет (память — всегда пользовательская). Ошибка чтения (EACCES и т.п.) — не роняет чат: `exists: false` + запись в `errors` реестра.
   - Лимит: `readPersonaMemoryLimit(cwd)` — секция `persona_memory` в settings.json, ключ `max_chars`, дефолт `2500`; битое/нечисловое/≤0 → дефолт + сообщение в `errors` (паттерн `readLessonSettings`).
   - При `chars > maxChars`: `text` обрезается до `maxChars` по границе строки (не рвать запись посередине), `truncated: true`, в конец блока — пометка `[память обрезана: показано N из M символов — почистите файл]`.

2. **`src/web/chat.ts` — подстановка.** В сборке системного промпта чата добавить блок между ролью и контекстом поиска:
   ```
   ## Память персоны
   <текст памяти>
   ```
   Пустая/отсутствующая память — блок не добавляется вовсе (не «(пусто)»: лишний шум в каждом ходе). Порядок блоков фиксирован и закреплён тестом.

3. **Инвариант «не протекает в фазы».** Память читается только в чат-сборке (`src/web/chat.ts`), `src/agent/system-prompt.ts` не трогаем. Тест от обратного: `buildSystemPrompt(cwd)` без `chat: true` не содержит ни текста памяти, ни заголовка `## Память персоны`.

4. **`GET /api/personas`.** В `PersonaSummary` добавить `memory: { exists: boolean; chars: number; truncated: boolean }` — без текста (как сейчас без текста промпта). `errors` реестра дополняются предупреждением при превышении лимита.

5. **`.vibelog/.gitignore`.** Добавить после блока `!prompts/**`:
   ```
   # Память персон — личные заметки о пользователе, в git не едут
   prompts/personas/*.memory.md
   ```
   Порядок важен: правило-исключение должно идти ПОСЛЕ `!prompts/**`, иначе `!` перебьёт игнор. Проверить `git check-ignore -v .vibelog/prompts/personas/helper.memory.md` → должен матчиться, и `git check-ignore -v .vibelog/prompts/personas/helper.md` → не должен.

6. **Шаблон-заготовка.** В `templates/prompts/personas/` файлов памяти НЕ создавать (это пользовательские данные). В `doc-6` дать пример содержимого.

## Как проверить

- `pnpm build && pnpm test` (полный прогон).
- Ручной кейс: создать `.vibelog/prompts/personas/helper.memory.md` с двумя строками, открыть веб-чат под ролью «Помощник», спросить что-нибудь — в системном промпте (лог/тест) блок присутствует; удалить файл — блок исчез.
- Лимит: файл на 5000 символов при `max_chars: 2500` → в промпте первые 2500 по границе строки + пометка, `GET /api/personas` отдаёт `truncated: true`.
- `git check-ignore -v` на оба пути (см. шаг 5).
- Инвариант: тест «headless-промпт не содержит памяти» зелёный.

## Риски

- **Порядок правил в `.gitignore`.** `!prompts/**` перебивает более ранние игноры; исключение памяти обязано идти после. Ошибка здесь = личные заметки в публичном репозитории. Проверка `git check-ignore` — обязательный шаг, не «на глаз».
- **Разбухание промпта.** Память в каждом ходе. Лимит 2500 символов ≈ 600-800 токенов — приемлемо, но при нескольких персонах и больших промптах стоит следить за общим размером; в задаче на запись (следующая) добавить предупреждение при приближении к лимиту.
- **Обрезка по границе строки.** Обрезка посередине записи даёт модели обрубок инструкции — хуже, чем отсутствие. Резать только по `\n`.
- **Встроенные роли.** Память есть только у проектных файлов; для встроенных ролей (helper/architect/supervisor) файл создаётся в `.vibelog/prompts/personas/` — путь тот же, отдельной логики не нужно, но в документации это надо назвать явно.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 10:41
---
Фаза 3 (Code) выполнена. Коммит 5d46a73.
Реализовано по плану:
- `src/web/personas.ts`: `PERSONA_MEMORY_SUFFIX = '.memory.md'`, `PERSONA_MEMORY_DEFAULT_MAX_CHARS = 2500`, `loadPersonaMemory(cwd, persona, errors?)` (читает `<PROJECT_PERSONAS_DIR>/<persona.prompt>.memory.md`, ENOENT — норма, прочие ошибки чтения → `exists:false` + запись в errors), `readPersonaMemoryLimit(cwd, errors?)` (секция `persona_memory`, ключ `max_chars`; битое/≤0/не-объект → дефолт + сообщение в errors, паттерн readLessonSettings). При превышении лимита — обрезка по границе `\n` + пометка `[память обрезана: показано N из M символов — почистите файл]`, `truncated: true`, предупреждение в errors. `PersonaSummary.memory: {exists, chars, truncated}` — без текста.
- `src/web/chat.ts`: блок `## Память персоны` в `buildSystemPrompt` между блоком роли и контекстом поиска; пустая/отсутствующая память — блок не добавляется. `src/agent/system-prompt.ts` не тронут.
- `src/core/gitignore.ts` + `.vibelog/.gitignore`: правило `prompts/personas/*.memory.md` ПОСЛЕ `!prompts/**` (в шаблоне политики и в файле проекта).
- `web/src/components/settings/api.ts`: тип `PersonaInfo.memory?`.
Проверки:
- `pnpm build` — ok.
- Полный `pnpm test` — 211 файлов, 4091 тест passed, 4 skipped (пропуски — предсуществующие `it.skip` в проекте, не связаны с задачей). Исключённых файлов нет.
- `git check-ignore -v` в `.vibelog/`: `prompts/personas/helper.memory.md` → правило `.vibelog/.gitignore:46:prompts/personas/*.memory.md`; `prompts/personas/helper.md` → `!prompts/**` (не игнорируется). Дополнительно тест по факту индексации (lesson-243): `*.memory.md` не в `git ls-files`, промпт роли и settings.json — в индексе.
- Новый тест-файл `src/web/persona-memory.test.mjs` (20 тестов): чтение/подстановка/порядок блоков, отсутствие файла, лимит из settings, битые значения, обрезка по границе строки с пометкой, API без текста, инвариант «не протекает в фазы» (`buildSystemPrompt(cwd)` без `chat:true`), git-исключение.
Что осталось: AC8 (документация — doc-6, doc-31, CHANGELOG) не отмечен: по правилам фазы Code документация пишется в фазе Close. DoD «Документация обновлена» по той же причине не отмечен.
---
author: @agent
created: 2026-11-10 10:54
---
Фаза Close выполнена. Ветка vb/vl-401 слита в master (1 коммит, merge 4a8de37), worktree удалена (force — единственный untracked был симлинк backlog/references/data от оркестратора), ветка vb/vl-401 удалена.
Проверки после merge:
- `pnpm build` — ok (один раз за фазу).
- Ранний точечный фильтр: `src/web/persona-memory.test.mjs`, `src/web/personas.test.mjs`, `src/core/gitignore.test.mjs` — 58 тестов passed.
- Полный `pnpm test` (vitest run) — 212 файлов, 4099 passed, 4 skipped (предсуществующие `it.skip` в `src/core/frontmatter.test.mjs`, к задаче не относятся). Исключённых файлов нет, повторных прогонов не было.
Документация (AC8, DoD 2):
- doc-6 §10 — новый подраздел «Память персоны веб-чата (VL-401)»: путь `.vibelog/prompts/personas/<prompt>.memory.md`, git-исключение, формат строк с датой, блок `## Память персоны` в промпте чата, инвариант «не в фазы», секция `persona_memory.max_chars` (дефолт 2500) с примером JSON, поведение при превышении (обрезка по границе строки + пометка), `GET /api/personas` → `memory: {exists, chars, truncated}`.
- doc-31 §8 — блок памяти в сборке промпта веб-чата, порядок блоков, лимит, инвариант headless/TUI.
- CHANGELOG.md — запись в Unreleased/Добавлено (VL-401).
Lessons: обновлён существующий lesson-209 (git-политика `.vibelog/`) — добавлена вторая ловушка: точечный игнор обязан идти ПОСЛЕ широкого `!`-исключения, иначе `!` его перебивает; связан с VL-401. Коммиты: 5a67d3c (refs и lessons), 232b94a (документация и CHANGELOG).
DoD: 1 (тесты) — выполнен, 2 (документация) — выполнен, 3 (нет регрессий) — выполнен. AC8 отмечен.
---
<!-- COMMENTS:END -->