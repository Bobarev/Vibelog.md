---
id: VL-404
title: 'Уроки в веб-чате: recall по смыслу разговора вместо подстрочного globalSearch'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-10 11:06'
updated_date: '2026-11-16 16:02'
due_date: ''
labels: []
dependencies:
  - VL-400
milestone: v1.14
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/lesson.ts
  - src/web/chat.ts
  - src/web/chat-lessons.test.mjs
lessons:
  - lesson-278
token_usage:
  input: 5250636
  output: 38841
  cache: 5115392
  total: 5289477
  requests: 99
  duration_ms: 1922957
  reasoning: 15086
  by_phase:
    code:
      input: 3953771
      output: 31809
      cache: 3850752
      requests: 71
    close:
      input: 1296865
      output: 7032
      cache: 1264640
      requests: 28
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст (обсуждение roadmap 2026-11-09, пункт «Agent memory» → память персоны).

Пользователь сформулировал требование: «персона не просто может, а должна использовать уроки, если это относится именно к проекту». Сейчас это не работает: уроки подставляются только в фазы Plan/Code через `{{taskLessons}}` (`loadLessonsForTask`), а в веб-чате их нет вовсе. То есть в чате ассистент не знает, что в этом проекте уже наступлено на грабли.

Частично закрыто `globalSearch` в `buildSystemPrompt` (`src/web/chat.ts`): он ищет по последнему сообщению и отдаёт до 3 уроков. Но это подстрочный поиск по одному сообщению — вопрос «почему падает сборка фронта» не найдёт урок про `pnpm install` в `web/`, если слова не совпали.

VL-400 дала `scoreLessonForTask` — ранжирование уроков по смыслу (title/tags/applies_to/body). Её надо переиспользовать здесь, но источником токенов будет не задача, а последние сообщения разговора.

Зависимости: VL-400 (scoreLessonForTask, recall по смыслу). VL-401 не блокирует, но порядок блоков в промпте согласуется с ней.

Связанные: VL-400, VL-401, VL-153 (lessons), VL-279 (фильтры актуальности).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Персона в веб-чате получает уроки проекта, релевантные текущему разговору: токены берутся из последних N сообщений треда (N настраивается, дефолт 3), а не только из последнего сообщения
- [x] #2 Ранжирование — существующая `scoreLessonForTask` (VL-400), кап — `lessons.prompt_limit`; в промпт попадают только `active` и не протухшие уроки (фильтры `loadLessonsForTask`)
- [x] #3 Уроки подставляются отдельным блоком `## Уроки проекта` после блока памяти персоны и до контекста поиска; пустой результат — блока нет
- [x] #4 В headless-фазы и TUI-агент блок не попадает (инвариант закреплён тестом от обратного)
- [x] #5 Настройка в `settings.json`: секция `chat_lessons` с ключами `enabled` (дефолт true), `max_messages` (дефолт 3), `limit` (дефолт 3); битые значения → дефолт + сообщение в errors
- [x] #6 Стоимость: блок не увеличивает число tool-вызовов модели (подстановка на уровне кода, как `{{taskLessons}}` в фазах)
- [x] #7 Тесты: recall по смыслу разговора (вопрос про worktree находит урок про worktree), кап, фильтр протухших, настройки, инвариант «не в фазы», пустой результат
- [ ] #8 Документация: doc-6 (чат — уроки проекта), doc-31 (системный промпт чата), CHANGELOG
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## ВАЖНО: сверить с кодом после VL-400 и VL-401

VL-400 меняет `src/core/lesson.ts` (добавляет `scoreLessonForTask`, переписывает `loadLessonsForTask`). VL-401 меняет `src/web/chat.ts` (`buildSystemPrompt` — блок памяти). Номера строк ниже — по состоянию ДО этих задач. Перед реализацией прочитать актуальные `src/core/lesson.ts` и `src/web/chat.ts`.

## Проверено по коду (состояние до VL-400/VL-401)

| Утверждение | Где видно |
|---|---|
| `buildSystemPrompt` в чате: шаблон → блок роли → (память, VL-401) → контекст globalSearch | `src/web/chat.ts` (`buildSystemPrompt`) |
| `globalSearch` уже отдаёт `lessons` (до 3) по последнему сообщению | `src/web/chat.ts` (`buildSystemPrompt`, `lastUserText`), `src/core/search.ts` (`globalSearch`) |
| `lastUserText(history)` — последний user-текст, используется как запрос | `src/web/chat.ts` (`lastUserText`) |
| `loadLessonsForTask` фильтрует `active` + не протухшие + кап `promptLimit` | `src/core/lesson.ts` (`loadLessonsForTask`, `readLessonSettings`) |
| `scoreLessonForTask(lesson, tokens, body)` — веса title 3 / tags 2 / applies_to 2 / body 1 | `src/core/lesson.ts` (после VL-400) |
| `tokenizeQuery` / `stemToken` — готовые токенизация и стемминг | `src/core/search.ts:67`, `:82` |
| Настройки lessons: секция `lessons`, `prompt_limit` дефолт 5 | `src/core/lesson.ts` (`LESSON_DEFAULTS`, `readLessonSettings`) |
| Инвариант «чат-блок не протекает в фазы» | `src/agent/system-prompt.ts:127` (`buildSystemPrompt(cwd, opts)`), тест VL-238 |

## Шаги

1. **`src/core/lesson.ts` — recall по произвольному тексту.** Новая экспортируемая функция:
   ```
   selectLessonsForText(cwd, text: string, opts?: { limit?: number }): LessonEntry[]
   ```
   - Токены: `tokenizeQuery(text)` → `stemToken` для каждого.
   - Кандидаты: `listLessons(cwd)` с теми же фильтрами, что в `loadLessonsForTask` (только `active`, не протухшие по `staleDays`).
   - Ранжирование: `scoreLessonForTask`, свежесть — tie-breaker, `slice(0, limit)`.
   - `loadLessonsForTask` переписать как тонкую обёртку: собрать текст из `title + description + labels` задачи и вызвать `selectLessonsForText`. Так логика фильтрации и ранжирования живёт в одном месте (не дублируется).

2. **`src/web/chat.ts` — сборка текста разговора.** Новая функция:
   ```
   recentConversationText(history: ChatMessage[], maxMessages: number): string
   ```
   - Берёт последние `maxMessages` сообщений с `role === 'user'` (не assistant: вопрос пользователя — сигнал, ответ модели — шум), склеивает через пробел.
   - Обрезка по длине: не более ~2000 символов (иначе токенов больше, чем в самом уроке).

3. **`src/web/chat.ts` — блок в промпте.** После блока памяти (VL-401), до контекста поиска:
   ```
   ## Уроки проекта
   - [lesson-N] <title> (kind)
   ```
   Пустой результат — блока нет. Формат строки — тот же, что в фазах (VL-400), чтобы модель видела одинаковый вид.

4. **Настройки — `src/core/lesson.ts`.** Расширить `LessonSettings` и `readLessonSettings` секцией `chat_lessons`:
   - `enabled` (boolean, дефолт `true`) — выключатель блока;
   - `max_messages` (число, дефолт 3) — сколько последних user-сообщений брать;
   - `limit` (число, дефолт 3) — сколько уроков подставлять.
   Битые значения → дефолт + сообщение в `errors` (паттерн `readLessonSettings`).

5. **Не дублировать с `globalSearch`.** Сейчас `globalSearch` отдаёт `lessons` в контексте поиска. После появления блока `## Уроки проекта` уроки из `globalSearch` надо убрать (оставить задачи/references/documents) — иначе одни и те же уроки придут дважды, разными формулировками. Решение зафиксировать комментарием.

6. **Инвариант.** Блок собирается только в `src/web/chat.ts`. `src/agent/system-prompt.ts` не трогаем. Тест от обратного: headless-промпт не содержит `## Уроки проекта`.

## Как проверить

- `pnpm build && pnpm test` (полный прогон).
- Ручной кейс: в веб-чате спросить «почему падает сборка фронта в worktree» → в промпте (лог/тест) присутствует урок про `pnpm install` в `web/` (lesson-6/lesson-231), хотя слова «pnpm» в вопросе нет.
- Кап: при `limit: 3` в блоке ровно 3 строки.
- Протухший урок (`last_verified` старше `stale_days`) в блок не попадает.
- `chat_lessons.enabled: false` → блока нет.
- Headless: `vibelog agent` и фаза — блока нет.

## Риски

- **Разбухание промпта.** Память (2500) + уроки (3 строки) + контекст поиска — суммарно заметно. Митигация: `limit` дефолт 3, строки компактные (id + title + kind), `enabled` для выключения.
- **Ложные совпадения.** `scoreLessonForTask` без И-логики даёт совпадения по одному общему слову («файл», «тест»). На 274 уроках это может вытащить нерелевантное. Митигация: порог минимального score (например ≥ 3, т.е. хотя бы одно совпадение в title) — зафиксировать в плане реализации и проверить на реальном корпусе.
- **Дублирование с globalSearch.** Если уроки останутся и там, и в новом блоке — модель получит два разных представления одного урока. Шаг 5 обязателен.
- **Совместимость.** `loadLessonsForTask` — публичный экспорт, используется в `phase-prompt.ts`. Сигнатура не меняется, меняется только внутренняя реализация (обёртка над `selectLessonsForText`). Тест `phase-prompt.test.mjs` должен остаться зелёным.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 11:25
---
Фаза code не удалась (код выхода 1): локировок=0, payload последнего запроса=346191 байт (макс 346191), usage={"input_tokens":2147037,"output_tokens":23610,"cache_read_input_tokens":2083840,"total_tokens":2170647,"reasoning_tokens":9544} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-10 11:45
---
Фаза 3 (Code) выполнена. Коммит a602378.
Изменено:
- `src/core/lesson.ts` — новый экспорт `selectLessonsForText(cwd, text, opts)` (общий движок recall: токены через `tokenizeQuery`+`stemToken`, фильтры `active` + не протухшие по `staleDays`, ранжирование `scoreLessonForTask` VL-400, свежесть как tie-breaker, кап `limit`, опции `paths`/`minScore`/`keepShortTokens`); `formatLessonLine` — единый формат строки `- [lesson-N] <title> (kind)`; `loadLessonsForTask` переписан тонкой обёрткой над `selectLessonsForText` (сигнатура публичного экспорта не менялась, `phase-prompt.test.mjs` зелёный). Секция `chat_lessons`: `CHAT_LESSON_DEFAULTS` (enabled=true, max_messages=3, limit=3), `ChatLessonSettings`, `readChatLessonSettings(cwd, errors?)` — битые значения → дефолт + сообщение в `errors` (в т.ч. `enabled` принимает только boolean).
- `src/web/chat.ts` — `recentConversationText(history, maxMessages)`: последние N user-сообщений (assistant исключён — ответ модели шум), склейка, обрезка до 2000 символов с сохранением свежего хвоста. `buildSystemPrompt(cwd, history, persona)` вместо `(cwd, lastUser, persona)`: блок `## Уроки проекта` после памяти персоны и до контекста поиска, пустой результат — блока нет, `chat_lessons.enabled=false` — блока нет. Кап — `Math.min(chat_lessons.limit, lessons.prompt_limit)` (AC2 буквально). Порог `CHAT_LESSON_MIN_SCORE = 3` (одно совпадение в title) — отсекает шум по общему слову. Уроки убраны из `globalSearch`-контекста (комментарий в коде: иначе один урок пришёл бы дважды разными формулировками).
- `src/web/chat-lessons.test.mjs` — 20 тестов: recall по смыслу (вопрос про worktree/сборку фронта находит урок про `pnpm install` в `web/`), кап `limit` и `prompt_limit`, фильтр протухших/needs-review, `minScore`, `recentConversationText` (только user, порядок, обрезка), настройки `chat_lessons` (дефолты/чтение/битые значения/не-объект), порядок блоков в промпте, пустой результат, отсутствие дублей в globalSearch, инвариант «не в фазы» (`buildSystemPrompt(cwd)` без `chat:true`).
Проверки: `pnpm build` — ok; полный `pnpm test` — 212 файлов, 4111 passed, 4 skipped (пре-существующие skip в `frontmatter.test.mjs`), 0 failed. Промежуточные падения `report.test.mjs`/`orchestrator.test.mjs` были вызваны двумя параллельными прогонами vitest в одном worktree (таймаутные тесты с дедлайном 4–6 с); в изоляции и в чистом полном прогоне оба файла зелёные.
Что осталось: AC8 и DoD «Документация обновлена» — doc-6, doc-31, CHANGELOG пишет Фаза Close после слияния (в Code документация backlog не правится по регламенту).
---
author: @agent
created: 2026-11-10 12:03
---
Фаза Close выполнена. Ветка vb/vl-404 слита в master (1 коммит a602378, merge без конфликтов), worktree удалена (--force: только untracked-симлинк backlog/references/data от оркестратора), ветка удалена.
Проверки после merge: `pnpm build` — ok; ранний точечный фильтр (lesson/chat-lessons/phase-prompt) — 158 passed; полный `npx vitest run` — 214 файлов, 4143 passed, 4 skipped (пре-существующие skip в frontmatter.test.mjs), 0 failed.
Документация: doc-6 (§10, «Уроки проекта в веб-чате (VL-404)»), doc-31 (§8, блок `## Уроки проекта` в сборке промпта чата), CHANGELOG.md (Unreleased → Добавлено) — коммит c744d7d. Урок lesson-278 (не дублировать каналы подстановки в промпте) создан и связан с задачей — коммит b2d7d01.
DoD: 1 «Тесты проходят» — да (полный прогон зелёный); 2 «Документация обновлена» — да (doc-6, doc-31, CHANGELOG); 3 «Нет регрессий» — да (0 failed, падений относительно master нет).
---
<!-- COMMENTS:END -->