---
id: VL-415
title: 'ask_persona: ответ консультанта обрезается и теряется — полный ответ, настраиваемые лимиты, частичный результат вместо «не дал ответа»'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-10 21:39'
updated_date: '2026-11-16 16:02'
due_date: ''
labels: []
dependencies: []
milestone: v1.14
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/subagents.ts
  - src/web/chat-subagent.ts
  - src/web/chat.ts
  - src/web/chat-subagent.test.mjs
  - src/web/chat-thread-restore-vl264.test.mjs
  - web/src/components/chat/tool-meta.ts
  - web/src/components/chat/subagent-card.tsx
  - web/src/components/chat/chat-runtime.tsx
lessons:
  - lesson-30
  - lesson-290
token_usage:
  input: 5918500
  output: 32911
  cache: 5794816
  total: 5951411
  requests: 96
  duration_ms: 1810791
  reasoning: 11948
  by_phase:
    code:
      input: 3809639
      output: 21435
      cache: 3738112
      requests: 56
    close:
      input: 2108861
      output: 11476
      cache: 2056704
      requests: 40
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Симптомы (со слов пользователя, 2026-11-10), два дефекта одного инструмента `ask_persona`:

**1. Ответ обрезается.** Протестировали консультацию — ответ пришёл обрезанным. Два независимых лимита:
- `TOOL_OUTPUT_MAX_CHARS = 8 * 1024` (`src/agent/tools.ts:92`), `truncateToolOutput` (`:114`). В веб-чате `executeTool` прогоняет через него **любой** результат (`src/web/chat.ts:1603`), включая `ask_persona`. Ответ консультанта — JSON-строка с полем `answer`, режется на 8192 символах.
- `subagents.max_tokens` дефолт 2000 (`src/web/chat-subagent.ts:219`) — для русского текста ≈ 6–8 тыс. символов, модель может не успеть договорить ещё до обрезки.

Почему кап 8 КБ неверен именно здесь: для `read_file`/`search_files` он оправдан (защита контекста от гигантских файлов), а `ask_persona` возвращает **готовый ответ эксперта**, который пользователь хочет прочитать целиком. Обрезанный совет хуже отсутствия совета.

**2. Ответ теряется — «не дал ответа».** Персона «Бизнес-наставник» постоянно отвечает «Консультант «Бизнес-наставник» не дал ответа — отвечай сам». Причина в цикле `src/web/chat-subagent.ts:214-247`:

```js
for (let iteration = 0; iteration < CONSULTANT_MAX_ITERATIONS; iteration++) {
  const resp = await llm.streamChat(messages, tools, {...});
  if (resp.toolCalls.length === 0) {
    answer = (resp.text ?? '').trim();
    break;
  }
  messages.push({ role: 'assistant', content: resp.text || null, tool_calls: resp.toolCalls });
  // ... инструменты, следующая итерация
}
```

`CONSULTANT_MAX_ITERATIONS = 3` (`:57`) — жёсткая константа.

- **Исчерпание итераций теряет ответ.** Три итерации подряд с вызовами инструментов → цикл кончается по счётчику, `answer` пустой → «не дал ответа». Модель не сломалась, она не успела дойти до текста.
- **Текст вместе с `tool_calls` отбрасывается.** `answer` присваивается только в ветке `toolCalls.length === 0`; если модель вернула и текст, и вызовы — текст теряется.

Почему «Бизнес-наставник» стабильно: его промпт, вероятно, побуждает изучать материалы проекта, и он упирается в лимит итераций почти всегда.

Обе проблемы — в одних файлах (`src/web/chat-subagent.ts`, `src/core/subagents.ts`), поэтому объединены в одну задачу (ранее VL-416, закрыта как дубль).

Связанные: VL-409 (`ask_persona`), VL-354 (усечение вывода поиска — там кап оправдан), VL-230 (байтовый автокомпакт payload — другой механизм).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Ответ консультанта (`ask_persona`) не обрезается общим капом `truncateToolOutput` (8 КБ): результат инструмента возвращается целиком, независимо от длины
- [x] #2 Лимит длины ответа консультанта задаётся отдельно в `subagents.max_answer_chars` (дефолт 20000); при превышении — обрезка с явной пометкой «ответ консультанта обрезан: показано N из M символов» и указанием, что лимит настраивается
- [x] #3 `subagents.max_tokens` (лимит генерации) поднят до значения, при котором ответ не обрывается на середине: дефолт 4000 вместо 2000, с комментарием в коде о связи с `max_answer_chars`
- [x] #4 Обрезка ответа консультанта не ломает JSON-контракт результата инструмента: `answer` остаётся строкой, `truncated: true` и `answerChars` добавлены в ответ
- [x] #5 В ленте чата (событие `subagent` и рендер tool-call) видно, что ответ обрезан — пометка в UI, а не только в тексте для модели
- [x] #6 Тесты: длинный ответ (30 КБ) проходит целиком при дефолтном лимите, обрезка при `max_answer_chars: 1000` с пометкой, `truncated` в ответе, отсутствие влияния на другие инструменты (read_file по-прежнему капается 8 КБ)
- [x] #7 Документация: doc-6 (субагенты — лимиты ответа), doc-8 (`ask_persona`), CHANGELOG
- [x] #8 Если консультант исчерпал итерации, но в последнем ответе был текст — этот текст возвращается как ответ, а не «не дал ответа»
- [x] #9 Если модель вернула текст ВМЕСТЕ с tool_calls, текст сохраняется и используется, когда следующая итерация не даёт лучшего
- [x] #10 При исчерпании итераций без текста возвращается частичный результат: перечень вызванных инструментов + явная причина «исчерпан лимит итераций (N)», а не пустая ошибка
- [x] #11 Лимит итераций настраивается: `subagents.max_iterations` (дефолт 5 вместо жёстких 3), валидация целого положительного числа
- [x] #12 Различаются два исхода: `partial: true` (исчерпаны итерации) и `empty: true` (модель вернула пустоту без вызовов) — у них разные тексты для модели и пользователя
- [x] #13 В промпт консультанта добавлена подсказка экономить итерации: «если нужны материалы проекта — прочитай не более 2 файлов и ответь»
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
| Общий кап вывода инструментов — 8 КБ | `src/agent/tools.ts:92` (`TOOL_OUTPUT_MAX_CHARS = 8 * 1024`), `:114` (`truncateToolOutput`) |
| В веб-чате через кап проходит ЛЮБОЙ результат инструмента | `src/web/chat.ts:1603` (`return truncateToolOutput(raw)`), `:1598` (unchanged-ветка) |
| Ответ консультанта возвращается как JSON-строка с полем `answer` | `src/web/chat-subagent.ts:275-285` |
| Лимит генерации — `settings.maxTokens`, дефолт 2000 | `src/web/chat-subagent.ts:219`, `src/core/subagents.ts` (`readSubagentSettings`) |
| Цикл консультанта: до `CONSULTANT_MAX_ITERATIONS`, `answer` только при `toolCalls.length === 0` | `src/web/chat-subagent.ts:214-247` |
| `CONSULTANT_MAX_ITERATIONS = 3` — жёсткая константа | `src/web/chat-subagent.ts:57` |
| Пустой `answer` → `{ok:false, error: 'не дал ответа'}` | `src/web/chat-subagent.ts:262-267` |
| Текст вместе с tool_calls кладётся в `messages`, но не в `answer` | `src/web/chat-subagent.ts:232` |
| Внутренние tool-выводы консультанта капаются отдельно | `src/web/chat-subagent.ts:242` |
| Таймаут обрабатывается отдельно (не исключение наружу) | `src/web/chat-subagent.ts:248-258` |
| UI-кап блока Result — 4000 символов | `web/src/components/chat/tool-meta.ts` (`formatResult`, `clip(..., 4000)`) |

## Часть A. Полный ответ (обрезка)

1. **`src/core/subagents.ts` — новые настройки.**
   - `maxAnswerChars` (ключ `max_answer_chars`), дефолт `20000`. Валидация: положительное число, иначе дефолт + сообщение в `errors`.
   - `maxTokens` дефолт поднять с `2000` до `4000`. Комментарий: при 4000 токенах русский ответ ≈ 12–16 тыс. символов, укладывается в `max_answer_chars` с запасом.
   - `maxIterations` (ключ `max_iterations`), дефолт `5` (было жёстко 3). Валидация: целое положительное.

2. **`src/web/chat-subagent.ts` — обрезка по своему лимиту.**
   - После получения `answer`, до `onEvent`/`JSON.stringify`: если `answer.length > settings.maxAnswerChars` — обрезать по границе строки/слова (не рвать посередине) и добавить `\n\n[ответ консультанта обрезан: показано N из M символов — увеличьте subagents.max_answer_chars]`.
   - В результат добавить `truncated: boolean` и `answerChars: number` (аддитивные поля).

3. **`src/web/chat.ts` — исключение из общего капа.**
   - В `executeTool` перед `return truncateToolOutput(raw)`: если `name === ASK_PERSONA_TOOL`, вернуть `raw` без капа (свой лимит уже применён).
   - Комментарий: `ask_persona` возвращает готовый ответ эксперта, а не сырые данные; обрезка на 8 КБ делает консультацию бесполезной.

4. **UI — свой рендер без капа.** `web/src/components/chat/`:
   - Для `ask_persona` показывать `answer` целиком, не через `formatResult` (там `clip(..., 4000)`).
   - При `truncated: true` — пометка «ответ обрезан по лимиту N символов».
   - Поле `truncated` должно попадать в сохранённую часть события, иначе после F5 пометка исчезнет.

## Часть B. Не терять ответ (цикл)

5. **`src/web/chat-subagent.ts` — накопление текста.**
   - `let lastText = ''`; на каждой итерации: `if (resp.text?.trim()) lastText = resp.text.trim()`.
   - Ветка `toolCalls.length === 0`: `answer = (resp.text ?? '').trim() || lastText; break;`.
   - После цикла: если `answer === ''`, но `lastText !== ''` — `answer = lastText`.
   - `const usedTools: string[] = []`; пушить `tc.name` — для частичного результата.

6. **Частичный результат вместо пустой ошибки.**
   - `answer === ''` и итерации исчерпаны:
     ```
     { ok: false, partial: true,
       error: `Консультант «<label>» исчерпал лимит итераций (<N>) и не успел ответить. Вызванные инструменты: <список|«нет»>. Отвечай сам или повтори вопрос проще.`,
       iterations: N, usedTools: [...] }
     ```
   - `answer === ''` без вызовов вообще → `{ ok: false, empty: true, error: '... вернул пустой ответ ...' }`.
   - Два исхода различаются явно: `partial` (исчерпал итерации) vs `empty` (вернул пустоту).

7. **Событие в ленте.** `SubagentEvent` += `partial?: boolean`, `usedTools?: string[]`, `truncated?: boolean`; клиент показывает соответствующую пометку.

8. **Промпт консультанта.** В `buildConsultantPrompt` добавить строку: «Отвечай по существу; если нужны материалы проекта — прочитай не более 2 файлов и ответь». Снижает вероятность упереться в лимит, не увеличивая его.

## Как проверить

- `pnpm build && pnpm test` + `cd web && npm run build && npm run lint`.
- **Обрезка:** развёрнутый ответ > 8 КБ → в ленте целиком, без пометки. `max_answer_chars: 1000` → обрезан с пометкой, `truncated: true`.
- **Потеря ответа:** фикстура — три итерации с `toolCalls`, на третьей текст вместе с вызовами → `answer` содержит текст, `ok: true`.
- Фикстура — пять итераций только с `toolCalls`, текста нет → `ok: false`, `partial: true`, `usedTools` заполнен.
- Фикстура — одна итерация без вызовов и без текста → `ok: false`, `empty: true`.
- Ручной кейс: «Бизнес-наставник» на реальном вопросе → отвечает.
- `read_file` на файле 20 КБ → по-прежнему обрезан на 8 КБ (регресс не допущен).
- F5 после консультации → пометки на месте.

## Риски

- **Разбухание контекста.** Ответ 20 КБ ≈ 5–7 тыс. токенов в контексте основного хода. Митигация: `max_calls_per_turn` (дефолт 2); при обкатке следить за payload, при необходимости снизить `max_answer_chars` до 10000.
- **Стоимость.** `max_tokens` 2000→4000 и `max_iterations` 3→5 увеличивают потолок стоимости консультации. Митигация: это потолки, а не факт; учёт токенов в billing уже есть.
- **`lastText` может быть «болтовнёй».** Модель пишет «Сейчас посмотрю файлы…» перед вызовом. Использовать `lastText` только как fallback, когда финального ответа нет; в тексте частичного результата явно писать, что это промежуточный текст.
- **Зацикливание консультанта.** Больше итераций — больше шансов зациклиться на чтении. Митигация: подсказка в промпте (шаг 8) + частичный результат вместо бесконечного цикла.
- **Обрезка по границе.** Резать посередине слова/предложения выглядит как баг — резать по последнему переводу строки или пробелу в пределах лимита.
- **UI-кап.** Если оставить `formatResult` с `clip(4000)`, починка серверной обрезки не даст видимого результата — нужен свой рендер (шаг 4).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 22:19
---
Фаза 3 (Code) выполнена. Коммит 2d505e6.
**Изменено:**
- `src/core/subagents.ts` — новые настройки `maxAnswerChars` (`max_answer_chars`, дефолт 20000) и `maxIterations` (`max_iterations`, дефолт 5), `maxTokens` 2000→4000 с комментарием о связи с `max_answer_chars`; валидация целых ≥ 1 с сообщениями в `errors`, обновлён текст ошибки про состав секции.
- `src/web/chat-subagent.ts` — цикл консультанта: `lastText` (текст, пришедший вместе с `tool_calls`, больше не теряется), `usedTools`, лимит итераций из настроек; после цикла fallback на `lastText`; два разных исхода — `partial: true` (исчерпаны итерации, с перечнем инструментов и номером лимита) и `empty: true` (пустой ответ без вызовов); функция `limitAnswer` — обрезка по границе строки/слова с пометкой «ответ консультанта обрезан: показано N из M символов — увеличьте subagents.max_answer_chars», поля `truncated`/`answerChars` в результате и в событии; в `buildConsultantPrompt` добавлена секция «Как отвечать» («прочитай не более 2 файлов и ответь»).
- `src/web/chat.ts` — `executeTool` возвращает результат `ask_persona` без общего капа `truncateToolOutput` (8 КБ); в тип события `subagent` добавлены `truncated`/`answerChars`/`partial`/`usedTools`.
- `web/src/components/chat/tool-meta.ts` — `formatResult` для `ask_persona` больше не режет ответ `clip(4000)`, при `truncated` добавляет пометку с лимитом.
- `web/src/components/chat/subagent-card.tsx` — пометка об обрезке в карточке (widget-режим).
- `web/src/components/chat/chat-runtime.tsx` — `truncated`/`answerChars` попадают в data-часть `chat-subagent`, поэтому пометка переживает F5.
- Тесты: `src/web/chat-subagent.test.mjs` (+8 кейсов VL-415: 30 КБ проходит целиком, обрезка при `max_answer_chars: 1000`, read_file по-прежнему капается, lastText при исчерпании итераций, текст вместе с tool_calls, partial, empty, подсказка в промпте; обновлены ожидания дефолтов), `src/web/chat-thread-restore-vl264.test.mjs` (+2 кейса formatResult для ask_persona).
**Проверки:**
- `pnpm build` — ок.
- `pnpm test` — полный прогон: 223 файла, 4304 passed, 4 skipped (предсуществующие skip, не связаны с задачей), падений нет.
- `cd web && npm run build` — ок (потребовался `pnpm install` в web: node_modules в worktree был пуст).
- `cd web && npm run lint` — 1 error + 1 warning, оба ПРЕДСУЩЕСТВУЮЩИЕ и в файлах, не затронутых задачей: `web/src/components/activity/activity-item.tsx:107` (react-hooks/immutability, `window.location.hash = …`) и warning `grant-scope.tsx:110` (exhaustive-deps). Мои файлы (`tool-meta.ts`, `subagent-card.tsx`, `chat-runtime.tsx`) замечаний не дали.
**Что осталось:** AC7 (документация doc-6/doc-8/CHANGELOG) — по правилам фазы Code документацию пишет фаза Close после слияния, поэтому пункт не отмечен. Ручной кейс «Бизнес-наставник на реальном вопросе» требует живого провайдера — проверяется пользователем после merge.
---
author: @agent
created: 2026-11-10 22:33
---
Фаза Close выполнена. Ветка vb/vl-415 слита в master (1 коммит, merge 411320b), worktree удалена (force — только untracked-симлинк backlog/references/data), ветка vb/vl-415 удалена.
**Merge:** прошёл без конфликтов. Перед merge пришлось убрать в stash локально пересобранные артефакты `web/dist` в главном репо (отслеживаемые файлы, мешали merge) — stash `close-vl-415: локальная сборка web/dist` остался в списке, при необходимости `git stash pop`.
**Проверки после merge:**
- `pnpm build` — ок.
- Ранний точечный фильтр: `src/web/chat-subagent.test.mjs` + `src/web/chat-thread-restore-vl264.test.mjs` — 46 passed.
- Полный прогон `npx vitest run`: первый прогон дал 1 падение в `src/core/report.test.mjs:375` (файл вне diff). Классификация: изолированно файл зелёный (27 passed), параллельного vitest не было — утечка глобального `process.exitCode` между файлами при `isolate: false`, не регрессия. Один повтор полного прогона: 226 файлов, 4333 passed, 4 skipped, падений нет.
**DoD:** 1. Тесты проходят — да (полный прогон зелёный). 2. Документация обновлена — да: CHANGELOG.md (запись в Unreleased/Исправлено), doc-6 §10 (лимиты `max_tokens` 4000, `max_answer_chars` 20000, `max_iterations` 5, полный ответ и частичный результат), doc-8 (`ask_persona` — длина ответа, итерации, partial/empty). 3. Нет регрессий — да (`read_file` по-прежнему капается 8 КБ, закреплено тестом).
**AC:** отмечен AC7 (документация). Остальные AC были отмечены в фазе Code.
**Lessons:** lesson-30 дополнен (единый кап tool-вывода обязан знать исключения для инструментов-ответов), создан lesson-290 (накапливай текст модели на каждой итерации, не выдавай исчерпание лимита за пустой ответ), связан с задачей.
**Коммиты:** d2f294d (refs и lessons), 3df8ff9 (документация и CHANGELOG).
**Не проверено:** ручной кейс «Бизнес-наставник на реальном вопросе» требует живого провайдера — проверяется пользователем после merge.
---
<!-- COMMENTS:END -->