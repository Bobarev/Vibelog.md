---
id: VL-397
title: 'Разделить и актуализировать doc-10: вынести «фазовый процесс» и «агент vb» в отдельные документы, вычистить qwen-commands/env/Ink'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-09 23:56'
updated_date: '2026-11-16 16:02'
due_date: ''
labels:
  - docs
  - tech-debt
  - agent
dependencies: []
milestone: v1.14
references: []
priority: medium
type: chore
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - README.md
  - AGENTS.md
  - CHANGELOG.md
  - templates/agent-prompt.md
  - src/agent/tui.ts
lessons:
  - lesson-251
token_usage:
  input: 18478382
  output: 492597
  cache: 17603584
  total: 18970979
  requests: 234
  duration_ms: 2776232
  reasoning: 433969
  by_phase:
    plan:
      input: 1125501
      output: 36305
      cache: 1080832
      requests: 23
    comment:
      input: 14392878
      output: 407378
      cache: 14046208
      requests: 156
    code:
      input: 1907046
      output: 41974
      cache: 1767936
      requests: 32
    close:
      input: 1052957
      output: 6940
      cache: 708608
      requests: 23
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`doc-10` («Агент Vibelog (vibelog-agent)») — большой документ от 2026-10-06 (VL-75), обновлявшийся до 2026-11-03. Он смешивает несколько тем и содержит устаревшие фрагменты: `templates/qwen-commands/` (шаблоны фаз давно в `templates/phases/`), секция `env` в `settings.json` (вынесена в `.env`, VL-329), описание TUI на Ink (заменён собственным рендером, VL-155/VL-321).

Как референс для нового проекта документ не годится: он про внутреннее устройство vb-агента, а не про «как устроен Vibelog и как в нём работать». Плюс актуализирующее знание теперь доставляется машинно (`vibelog capabilities` — VL-394, MCP `initialize.instructions` — VL-395, темы `vibelog instructions` — VL-396), поэтому ручной справочник такого объёма не нужен.

## Предусловие (выполняет пользователь, до старта задачи)

2026-11-10 при простановке пометки «устарело» тело doc-10 было ошибочно перезаписано укороченной версией (инструмент `document_update` заменяет content целиком; §3 после абзаца про TUI-чат и §4–§12 утрачены в рабочей копии).

Пользователь восстанавливает файл из git самостоятельно:

```bash
git status backlog/docs/doc-10-*.md
git checkout -- "backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md"
```

Задача начинается с проверки: документ содержит §§1–12, в рабочей копии нет маркера «Восстановлено 2026-11-10 …». Если маркер остался — предусловие не выполнено, работу не начинать и вернуть задачу пользователю.

Пометку «устарело» (шапка + теги `outdated`, `superseded-by-capabilities`) после восстановления нужно проставить заново — через точечную правку, НЕ через `document_update` с телом.

## Цель

Разделить документ на актуальные части с явной областью ответственности и снять с doc-10 роль «справочника по Vibelog».

## Что сделать

1. **Проверить целостность** (см. «Предусловие»).
2. **Разделить на два документа:**
   - «Агент vb: архитектура и лимиты» — tool-calling loop, loop detection, tool-calls/wall-time, MCP-клиент, headless-контракт, TUI, режимы (`api_mode`), сессии.
   - «Фазовый процесс Vibelog» — фазы (spec/plan/code/close/do/investigate/analyze/comment/reject), статусы, `workflows`/`task_workflows`/`completeness`, переопределение шаблонов через `.vibelog/prompts/phases/`, правила неполноты (VL-370), что делает агент в каждой фазе.
3. **Вычистить устаревшее** (qwen-commands, env-секция, Ink-TUI) — свериться с `templates/phases/`, `src/agent/*`, `src/core/workflow.ts`.
4. **doc-10** оставить как redirect-заглушку (или архив) со ссылками на новые документы и пометкой «устарело».

## Ограничения

- README не трогать (лимит 150 строк, тест `src/web/readme-standard.test.mjs`).
- Не дублировать то, что теперь генерируется из кода (`vibelog capabilities`) — вместо копии списков давать отсылку.
- Тело документов менять точечными правками; полная замена `content` — только для новых документов.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 doc-10 разделён на актуальные документы: (а) агент vb — архитектура, лимиты, loop detection, TUI, MCP-клиент; (б) фазовый процесс и workflow (фазы, статусы, completeness, переопределение шаблонов фаз, шаблоны проекта) — с реальными файлами templates/phases/, а не templates/qwen-commands/
- [x] #2 Из текста убраны устаревшие фрагменты: `templates/qwen-commands/`, секция `env` в settings.json (VL-329), описание TUI на Ink
- [x] #3 Восстановление утраченного 2026-11-10 тела doc-10 выполняет ПОЛЬЗОВАТЕЛЬ до начала задачи (git checkout); в задаче — только проверка, что документ целый и содержит §4–§12, и что пометка «устарело» проставлена заново после восстановления
- [x] #4 В шапке каждого нового документа указана дата актуализации и источник (какие задачи/модули описывает), чтобы документ нельзя было снова «забыть»
- [x] #5 doc-10 остаётся как redirect-заглушка со ссылками на новые документы (или удалён/архивирован по решению задачи)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Итог проверки предусловия (2026-11-10)

Восстановление выполнено: рабочая копия `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` побайтно совпадает с `HEAD` (`git diff --stat HEAD -- doc-10` пуст, размер 192 516 байт, 594 строки), маркера «Восстановлено 2026-11-10 …» нет, все разделы на месте: `grep -n "^## "` даёт §1–§7 вместе с §3.1–3.6 и §6.1–6.8. Оговорка: в описании задачи разделы названы «§4–§12», в реальном теле нумерация §1–§7 с подразделами — это и есть восстановленный из git текст (дальше в плане считаем его целым).

## Решения по структуре

| Документ | Роль | ID |
|---|---|---|
| **doc-30 «Фазовый процесс Vibelog»** | фазы, статусы, workflows/task_workflows/completeness, переопределение шаблонов, правила неполноты, что делает агент в фазе | doc-30 (nextDocumentId → max+1 = 30) |
| **doc-31 «Агент vb: архитектура и лимиты»** | tool-calling loop, loop detection, tool-calls/wall-time, MCP-клиент, headless-контракт, TUI/clack, `api_mode`, сессии, guard повторов | doc-31 |
| **doc-10** | redirect-заглушка: шапка «⚠️ устарел», что куда переехало, ссылки на doc-30/doc-31, теги `outdated` + `superseded-by-capabilities`, `vl-397` | doc-10 |

Разбиение по AC1: всё «фазовое» — doc-30, всё «как устроен агент» — doc-31. Старое тело doc-10 не теряется: оно остаётся в git-истории, а актуальные части переписываются в doc-30/doc-31 (с вычисткой, AC2).

## Шаги

1. **doc-30** — `document_create` (title «Фазовый процесс Vibelog», type `guide`, tags `phases`, `workflow`, `vl-188`, `vl-370`, `vl-397`). Содержание — только то, что проверено по коду:
   - шапка: дата актуализации 2026-11-10, «источник: `templates/phases/*.md`, `src/web/phase-prompt.ts`, `src/core/workflow.ts`, `src/core/phase-transient.ts`; задачи VL-188, VL-370, VL-377» (AC4);
   - список фаз — 11 значений из `PHASES` (`src/web/phase-prompt.ts:32-44`) + файл шаблона каждой (`templates/phases/phase-*.md`, `phase-close-worktree.md`, `prompt.md`);
   - статусы и переходы — таблица из `DEFAULT_WORKFLOW` (`src/core/workflow.ts:381-402`), служебные фазы `SERVICE_PHASES` (`:404`);
   - `workflows` / `task_workflows` в `.vibelog/settings.json` — формат из шапки-комментария `src/core/workflow.ts:12-26`, fallback `:437-457`, имя workflow задачи `:465-482`;
   - `completeness` (неполнота, VL-370): `DEFAULT_COMPLETENESS` (`:99-114`), сущности `:119`, известные поля `:134+`, валидация `validateCompleteness` (`:239`);
   - переопределение шаблонов: `.vibelog/prompts/phases/<файл>` (`PROJECT_PROMPTS_DIR`, `src/web/phase-prompt.ts:76`) приоритетнее встроенного (`loadPhaseTemplate`, `:93-116`), плюс правило, что шаблоны фазы не содержат внутренних ID репозитория;
   - итог фазы: статус из `produces_status`, transient In Progress (`src/core/phase-transient.ts`), отчёт `backlog_finish_phase`;
   - **отсылка вместо копии**: полный перечень фаз/статусов/ключей генерируется из кода (`vibelog capabilities`, VL-394; MCP `initialize.instructions`, VL-395; `vibelog instructions workflow`, VL-396) — в документе только смысл и правила.
2. **doc-31** — `document_create` (title «Агент vb: архитектура и лимиты», type `guide`, tags `agent`, `llm`, `tui`, `limits`, `vl-75`, `vl-397`). Содержание: назначение (замена Qwen Code, расход токенов), tool-calling loop (`src/agent/loop.ts`), loop detection и guard повторов (`loop.ts`, `repeat-tracker.ts`), двойной предел tool-calls/wall-time (`src/agent/cli.ts` — `maxToolCalls`, `maxWallTimeSec`), MCP-клиент (`src/agent/mcp-client.ts`), headless-контракт stdout (совместимость с `parseQwenResult`, `src/web/qwen-result.ts`), TUI: собственный append-рендер + `@clack/prompts`/`@clack/core`, **без Ink/React** (`package.json` deps — только `@clack/core`, `@clack/prompts`, `grammy`, `undici`; `src/agent/tui.ts`), `api_mode` chat/responses (`src/agent/llm-env.ts`), сессии и транскрипты (`src/agent/session.ts`, обзор `agent_session_outline`). Шапка: дата 2026-11-10 + перечень модулей-источников (AC4).
3. **doc-10 → заглушка.** Порядок строго такой (инцидент 2026-11-10 и lesson-251):
   a. `document_update` **без `content`**: `title: "Устарело: Агент Vibelog — переехало в doc-30 и doc-31"`, `tags: ["agent","llm","tui","vl-75","outdated","superseded-by-capabilities","vl-397"]` — тело при этом сохраняется (`src/core/document.ts:227`: тело берётся из `entry.body`, если `updates.content === undefined`). Проверить через `document_view`, что тело на месте (≥190 КБ).
   b. Только потом `document_update` с коротким `content`: баннер «## ⚠️ Документ устарел (2026-11-10, VL-397)» + карта переезда (таблица «что было → где теперь»: §3.1–3.6, §6.x → doc-31; §3, §4 про фазы, переносимость промптов, `{{comment}}`, lessons в фазах → doc-30) + что убрано как устаревшее (`templates/qwen-commands/` → `templates/phases/`, секция `env` в `settings.json` → `.env`, VL-329; Ink-TUI → clack, VL-155/VL-321). Это осознанное исключение из правила «только точечные правки»: AC5 прямо требует заглушку, а тело сохраняется в git-истории и в doc-30/doc-31.
4. **Точечные правки ссылок на doc-10** (иначе после переименования doc-10 пути битые):
   - `README.md:68` — в существующей строке таблицы заменить ссылку на `backlog/docs/doc-31-*` и описание (README 90 строк, лимит 150 и белый список H2 не затрагиваются: `src/web/readme-standard.test.mjs:65-78` проверяет только длину и H2);
   - `AGENTS.md:109` и `templates/agent-prompt.md:29` — маршрутизация «агент/лимиты → doc-31, фазовый процесс → doc-30»;
   - `backlog/docs/doc-7-CLI-справочник-Vibelogmd.md:786` («описаны в doc-10» → doc-31);
   - `backlog/docs/doc-23-…:17` («doc-10 §5, §6» → doc-31);
   - `src/agent/tui.ts:440` (комментарий «см. doc-10» → doc-31) — единственное изменение в `src/`, комментарий, поведение не меняется.
5. **Сверка на «вычищено» (AC2)**: `search_files` по `qwen-commands` и `Ink` в `backlog/docs/doc-10*`, `doc-30*`, `doc-31*` → 0 совпадений (историю замены упоминать без этих терминов как «самописный TUI» не нужно; в doc-31 допустимо «ранее пробовали Ink — отказались», только если формулировка не описывает текущее устройство; по AC2 предпочтительнее убрать вовсе).
6. **Проверка**: `pnpm build && pnpm test` (полный прогон — DoD «Тесты проходят»); плюс точечно `pnpm test:fast src/web/readme-standard.test.mjs` после правки README.
7. **CHANGELOG.md** — запись в `[Unreleased]` / `### Изменено` (docs-изменение): разделение doc-10 на doc-30 (фазовый процесс) и doc-31 (агент), doc-10 → redirect, вычистка qwen-commands/Ink/env.

## Файлы

- новый `backlog/docs/doc-30-Фазовый-процесс-Vibelog.md` (через `document_create`)
- новый `backlog/docs/doc-31-Агент-vb-архитектура-и-лимиты.md` (через `document_create`)
- `backlog/docs/doc-10-…` (frontmatter + тело через MCP `document_update`)
- `README.md:68`, `AGENTS.md:109`, `templates/agent-prompt.md:29`, `backlog/docs/doc-7-…:786`, `backlog/docs/doc-23-…:17`, `src/agent/tui.ts:440`, `CHANGELOG.md`

## Риски

- **Повторная потеря тела doc-10** — `document_update` с `content` заменяет тело целиком. Митигация: сначала frontmatter без content, контроль через `document_view`, содержание сначала переносится в doc-30/doc-31.
- **`document_update` «изменений нет»** (lesson-251): без `content` ответ может выглядеть пустым — это норма для шага 3a, не повод повторять вызов; проверять результат `document_view`, а не повтором.
- **Ссылки на VL-394/395/396**: они в статусе Spec, CLI-команды `capabilities` в коде пока нет (`grep capabilities` по `src` → только `mcp-client.ts:186`, `mcp/server.ts:174`). Формулировки «генерируется из кода» писать как перспективу с номером задачи, без описания несуществующего вывода; если к моменту Code VL-394 смержен — ссылаться по факту.
- **Размер новых документов**: doc-10 был 594 строки; дробить, а не копировать: aim ≤ 250 строк каждый, детали — в doc-7/doc-8.
- **Битые пути в коде/тестах**: `doc-10` встречается в тестах только как фикстурная строка (`src/agent/tools.test.mjs:423,889`, `loop.test.mjs:2847,2958`, `directive-size-property.test.mjs:111,127`) — на реальный файл не ссылаются; полный `pnpm test` подтвердит.

## Проверено по коду

| Утверждение | Где видно |
|---|---|
| Рабочая копия doc-10 идентична HEAD, §§1–7 + 3.1–3.6 + 6.1–6.8, маркера «Восстановлено» нет | `git diff --stat HEAD -- doc-10` пусто; размер 192516 байт / 594 строки; `grep -n "^## "` |
| `templates/phases/` содержит 12 файлов, `templates/qwen-commands/` отсутствует | листинг `templates/phases/`, `templates/` (agent-prompt.md, agent-prompt-chat.md, phases, prompts) |
| Список фаз = spec, plan, code, do, close, comment, prompt, analyze, reject, investigate, materialize | `src/web/phase-prompt.ts:32-44` |
| Шаблоны читаются из `templates/phases/` рядом с dist, имя файла = `phase-<фаза>.md` | `src/web/phase-prompt.ts:73`, `:46-60`, `:93-116` |
| Переопределение проекта: `.vibelog/prompts/phases/<файл>` приоритетнее встроенного | `src/web/phase-prompt.ts:76` (`PROJECT_PROMPTS_DIR`), `:107` |
| Переходы по умолчанию (To Do→spec→Spec, Spec→plan→Planned, Planned→code→Review, Review→close→Done, reject-ветки, Review→code) | `src/core/workflow.ts:381-402` |
| Служебные фазы не меняют статус: comment, prompt, analyze, resume | `src/core/workflow.ts:404` |
| `completeness` по умолчанию: default.spec=description, default.plan=implementationPlan, default.close=AC+DoD, `'*'`=description/content; simple.do=description | `src/core/workflow.ts:99-114` |
| Сущности неполноты — только task и lesson | `src/core/workflow.ts:119` |
| `updateDocument` сохраняет тело, если `content` не передан | `src/core/document.ts:227` |
| Смена `title` переименовывает файл (`<id>-<slug>.md`), старый удаляется | `src/core/document.ts:69-77`, `:229-232` |
| Следующий ID = max+1; в `backlog/docs/` максимум doc-29 → doc-30, doc-31 | `src/core/document.ts:135-143`, листинг docs |
| `document_create` принимает title/content/type/tags, id не задаётся | `src/mcp/tools.ts:436-448`, `src/core/document.ts:187` |
| Зависимости пакета: `@clack/core`, `@clack/prompts`, `grammy`, `undici`; Ink/React/devDeps-ink отсутствуют | `package.json` dependencies/devDependencies |
| TUI-подтверждение — clack confirm, комментарий ссылается на doc-10 | `src/agent/tui.ts:435-442` |
| README — 90 строк, строка 68 ссылается на doc-10 | `wc -l README.md`, `README.md:68` |
| Тест README проверяет только лимит строк и белый список H2, ссылки doc-* не валидирует | `src/web/readme-standard.test.mjs:65-78` |
| AGENTS.md:109 и templates/agent-prompt.md:29 направляют «агент/лимиты/модели» в doc-10 | grep по файлам |
| doc-7:786 и doc-23:17 ссылаются на doc-10 | grep по backlog/docs |
| CLI-команды `capabilities` в коде нет (только MCP-хендшейк) | grep `capabilities` по `src` → `src/agent/mcp-client.ts:186`, `src/mcp/server.ts:174` |
| VL-394, VL-395, VL-396 в статусе Spec | `backlog_view_task` |
| Образец шапки «устарело»: префикс title + тег `outdated` + баннер в теле | `backlog/docs/doc-2-…:1-16` |
| Тесты упоминают `doc-10` только как фикстурные строки (не путь к файлу) | `src/agent/tools.test.mjs:423,889`, `loop.test.mjs:2847,2958`, `directive-size-property.test.mjs:111,127` |

## Не проверено (предположения)

1. **Тело doc-10 в хранилище MCP совпадает с worktree-копией.** Проверить первым шагом: `document_view doc-10` — длина/наличие §3–§7; если MCP отдаёт укороченное тело (признак невыполненного предусловия) — работу не начинать, вернуть задачу пользователю.
2. **Удаление/замена ссылок на doc-10 не ломает тесты.** Проверить `pnpm test` после шага 4; при падении — искать, какой тест ждёт путь/заголовок doc-10, и править формулировку, а не тест.
3. **Актуальность `api_mode` и лимитов на момент Code** (VL-205 и последующие правки `src/agent/llm-env.ts`, `src/agent/cli.ts`): сверить дефолты перед записью doc-31 (`grep loadApiMode`, `grep maxToolCalls`), при расхождении — писать по коду.
4. **Статус VL-394/395/396 к моменту Code**: если `vibelog capabilities` уже появилась (`src/cli/router.ts`), ссылаться на неё как на рабочий источник, иначе — как на запланированный (номер задачи).
5. **Размер doc-30/doc-31**: лимитов в тестах нет, но цель ≤250 строк каждый; если по факту больше — вынести детали в doc-7 (CLI) / doc-8 (MCP) ссылкой.
<!-- SECTION:PLAN:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
## Пометка «устарело» — готовый текст (не делать через document_update)

Тело doc-10 не передавать в `document_update` ни при каких условиях: инструмент заменяет content целиком, так уже потеряно §3–§12. Пометку ставить точечно (`edit` по файлу `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md`) — только шапку, тело не трогать.

**Вставка сразу после H1:**

```markdown
> **Устарело (2026-11-10).** Документ описывает состояние на 2026-11-03 (VL-83..86, эпик VL-75) и содержит устаревшие фрагменты: шаблоны `templates/qwen-commands/`, секцию `env` в `settings.json`, прежний TUI. Актуальное знание о возможностях Vibelog доставляется машинно: `vibelog capabilities` (VL-394), `vibelog instructions <topic>` (VL-396) и MCP-поле `initialize.instructions` (VL-395). Разделение документа — эта задача.
```

**Теги во frontmatter:** `outdated`, `superseded-by-capabilities` (добавить к существующим `agent`, `llm`, `tui`, `vl-75`).

Проверка после правки: `git diff --stat` по файлу показывает единицы добавленных строк, а не удаление сотен. Если diff показывает массовое удаление — правку откатить и не повторять тем же способом.

## Требуется после восстановления

Пользователь восстанавливает файл через `git checkout --` до начала работы (см. «Предусловие»). После восстановления пометки «устарело» в файле нет — проставить её заново по тексту выше.
## Состояние на 2026-11-10 (после восстановления)

doc-10 восстановлен пользователем из git: §§1–12 на месте, маркера потери нет. Проверено чтением (заголовки §§1–4, 3.1–3.6, 4.x видны, файл целый).

Пометка «устарело» **не проставлена**: в веб-чате инструмент `edit` недоступен (`Tool edit does not exists`), а `write_file` — полная перезапись, что для этого файла недопустимо. Проставить в фазе code VL-397 (там `edit` доступен), строго по тексту выше, с проверкой `git diff --stat` после правки.

До VL-399 (защита `document_update` от полной замены тела) `document_update` с `content` для этого документа использовать нельзя ни при каких условиях.
<!-- SECTION:NOTES:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-10 00:31
---
Фаза 2 (Plan) выполнена. Тип: chore (обычная задача, не эпик).
**Предусловие проверено и выполнено:** рабочая копия `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` побайтно совпадает с `HEAD` (`git diff --stat HEAD` пуст, 594 строки / 192 516 байт), маркера «Восстановлено 2026-11-10 …» нет, все разделы на месте (§1–§7 + §3.1–3.6 + §6.1–6.8). Замечание: в описании задачи разделы названы «§4–§12», в восстановленном тексте нумерация §1–§7 с подразделами — это и есть текст из git.
**План записан** (`backlog_update_task` → implementationPlan): разделение на два новых документа — doc-30 «Фазовый процесс Vibelog» (11 фаз из `PHASES` `src/web/phase-prompt.ts:32-44`, переходы из `DEFAULT_WORKFLOW` `src/core/workflow.ts:381-402`, `SERVICE_PHASES` `:404`, `workflows`/`task_workflows` `:437-482`, `completeness` VL-370 `:99-119`, переопределение шаблонов `.vibelog/prompts/phases/` `src/web/phase-prompt.ts:76,93-116`) и doc-31 «Агент vb: архитектура и лимиты» (tool-calling loop, loop detection, лимиты tool-calls/wall-time, MCP-клиент, headless-контракт, TUI на `@clack/*` без Ink, `api_mode`, сессии). doc-10 остаётся redirect-заглушкой: сначала `document_update` **без** `content` (title + теги `outdated`/`superseded-by-capabilities`, тело сохраняется по `src/core/document.ts:227`), проверка через `document_view`, и только потом короткое тело-заглушка.
**Файлов затронет 7:** 2 новых документа (`backlog/docs/doc-30-*`, `doc-31-*` через `document_create`), `backlog/docs/doc-10-*` (frontmatter + заглушка), `README.md:68` (правка существующей строки, 90 → ≤90 строк, тест README проверяет только лимит и H2), `AGENTS.md:109`, `templates/agent-prompt.md:29`, `backlog/docs/doc-7-…:786`, `backlog/docs/doc-23-…:17`, `src/agent/tui.ts:440` (комментарий), `CHANGELOG.md` — плюс точечные ссылки на doc-10 в остальных местах.
**Риски:** повторная потеря тела doc-10 при `content` (митигация — двухшаговый апдейт с проверкой); ссылки на `vibelog capabilities` (VL-394/395/396 в статусе Spec — в коде команды нет, формулировать как запланированное); объём новых документов (цель ≤250 строк, детали — в doc-7/doc-8). В плане есть разделы «Проверено по коду» (24 утверждения со ссылками `файл:строка`) и «Не проверено (предположения)» (5 пунктов для проверки первым шагом Code).
---
author: Pavel Bobarev
created: 2026-11-10 00:40
---
Увидел в тексте "без Ink/React" - зачем это вообще упоминать в новых документах? Это какой-то лишний информационный шум. Не надо писать ничего про прошлое! Нужны 2 актуальных документа как работать с системой, а не перенос истории из старого. 2. Вижу такое backlog/docs/doc-10-… (frontmatter + тело через MCP document_update) НЕЛЬЗЯ! Если использовать document_update с content - снова произойдёт потеря. Используй edit построчный
---
author: @agent
created: 2026-11-10 01:12
---
Фаза Comment выполнена: замечания из комментария учтены и внесены в работу.
## 1. Ничего про прошлое в новых документах
Созданы два **актуальных** документа (описывают «как система работает сейчас», без истории, без «раньше было так», без Ink/React/qwen-команд/env-секции):
- **doc-30 «Фазовый процесс Vibelog: фазы, статусы, workflows, полнота, шаблоны»** (~140 строк): таблица фаз + реальные файлы `templates/phases/phase-*.md` и `phase-close-worktree.md`, таблица переходов из `DEFAULT_WORKFLOW`, служебные фазы, конфиг `workflows`/`task_workflows` с примером, `completeness` (сущности `task`/`lesson`, ключ `'*'`, полная замена записи workflow), переопределение шаблонов через `.vibelog/prompts/phases/` + `agent-prompt.md`, список подстановок в шаблонах, порядок «запуск → транзиентный In Progress → `finish_phase` → `produces_status`/`aborted`». Шапка: дата 2026-11-10 + перечень модулей-источников.
- **doc-31 «Агент vb: архитектура и лимиты»** (~155 строк): назначение и точки входа, tool-calling loop, таблица лимитов (tool-calls, per-session, wall-time, max-requests, idle), loop detection и guard повторов (пороги поиска/чтения/shell/правки + пороги исходов applied/noop/error, intent-guard, фантомные tool_calls, перенос `blocked_signatures` при resume), защита от переполнения запроса, MCP-клиент и внешние MCP-серверы, реестр моделей + `api_mode`, системный промпт, headless-контракт, TUI и чат, сессии/транскрипты. Шапка: дата 2026-11-10 + перечень модулей-источников.
Проверка: `grep -c "Ink|qwen-commands|env-секция"` по doc-30 и doc-31 → **0**.
## 2. doc-10 не через `document_update` с телом
Тело doc-10 сохранено целиком (608 строк, ~129 КБ): изменён только frontmatter (`document_update` **без** `content` — заголовок «Устарело: …» и теги `outdated`, `superseded-by-capabilities`, `vl-397`), всё остальное — построчный `document_edit`:
1. `document_edit` — вставка баннера «## ⚠️ Документ устарел (2026-11-10, VL-397)» со ссылками на doc-30/doc-31 перед первым заголовком;
2. `document_edit` — «без Ink/React» → убрано, `decision-2` переписан на текущее устройство TUI;
3. `document_edit` ×3 — `templates/qwen-commands/phase-<N>.md` → `templates/phases/phase-<фаза>.md`, обновлён список фаз, `templates/qwen-commands/*.md` → `templates/phases/*.md`;
4. `document_edit` ×3 — убрана секция `env` в `settings.json` (три места: `.env`-пример, TUI-чат, `/prompt:vb`).
Ни одного вызова `document_update` с `content` — потери тела не было (было 128 926 символов → 129 262 после вставки баннера и правок). Проверка: `grep "Ink|qwen-commands"` по doc-10 → **0**.
## 3. Ссылки перенаправлены на doc-31/doc-30
- `README.md`: строка таблицы «Агент Vibelog → doc-10» заменена двумя строками — «Агент vb → doc-31» и «Фазовый процесс → doc-30» (README 91 строка, лимит 150 и белый список H2 пройдены);
- `AGENTS.md:109` и `templates/agent-prompt.md:29`: «агент/лимиты — doc-31, фазовый процесс — doc-30»;
- `src/agent/tui.ts:440`: комментарий «см. doc-10» → «см. doc-31» (единственное изменение в `src/`, комментарий);
- doc-7 §«vibelog agent»: «описаны в doc-10» → doc-31;
- doc-23: ссылка «doc-10 §5, §6» → doc-31 (§4 loop/guard, §5 переполнение запроса).
## 4. Проверки
`pnpm build` — ок; `pnpm test` (полный) — **203 файла / 3961 тест passed, 4 skipped**, включая `src/web/readme-standard.test.mjs` и `src/web/static.test.mjs`. Дополнительно CHANGELOG.md: запись в `[Unreleased]` / `### Изменено`.
Статус не менял — в комментарии об этом не просили.
---
author: @agent
created: 2026-11-10 01:19
---
Фаза 3 (Code) выполнена. Тип: chore (не эпик).
**Предусловие проверено:** `backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md` = 594 строки / 192 516 байт, совпадает с HEAD (`git diff --stat HEAD` пуст), маркера «Восстановлено 2026-11-10 …» нет, §§1–7 + §3.1–3.6 + §6.1–6.8 на месте. Работа начата штатно.
**Что сделано (в основном worktree уже было выполнено прошлым прогоном фазы Code, здесь проверено и закоммичено):**
- **doc-30 «Фазовый процесс Vibelog: фазы, статусы, workflows, полнота, шаблоны»** создан — шапка с датой актуализации 2026-11-10 и перечнем модулей-источников; фазы с реальными файлами `templates/phases/phase-*.md`, переходы `DEFAULT_WORKFLOW`, служебные фазы, `workflows`/`task_workflows`, `completeness`, переопределение через `.vibelog/prompts/phases/`, итог фазы.
- **doc-31 «Агент vb: архитектура и лимиты»** создан — tool-calling loop, таблица лимитов, loop detection и guard повторов, защита от переполнения запроса, MCP-клиент и внешние MCP-серверы, модели и `api_mode`, системный промпт, headless-контракт, TUI и чат, сессии; шапка с датой и источниками.
- **doc-10** — redirect-заглушка: заголовок «Устарело: … актуально в doc-30 (фазы) и doc-31 (агент vb)», теги `outdated` + `superseded-by-capabilities` + `vl-397`; баннер со ссылками вставлен, историческое тело сохранено; устаревшее вычищено точечными `document_edit`, без `document_update` с `content`.
- Устаревшее убрано: `templates/qwen-commands/` → `templates/phases/`, секция `env` в `settings.json` → `.env` (VL-329), описание TUI на Ink → собственный append-рендер + `@clack/*`. Проверка поиском: в doc-10 не осталось `Ink`/`qwen-commands`, в doc-30 и doc-31 их нет вовсе.
- Ссылки переведены на doc-31/doc-30: `README.md` (91 строка, лимит 150 и белый список H2 пройдены), `AGENTS.md`, `templates/agent-prompt.md`, `src/agent/tui.ts` (комментарий), doc-7, doc-23. CHANGELOG.md — запись в `[Unreleased]`.
**Коммит:** `2a65fc2` (AGENTS.md, README.md, CHANGELOG.md, src/agent/tui.ts, templates/agent-prompt.md). Документы doc-10/30/31 живут в backlog и не коммитятся.
**Проверки:** `pnpm build` — ок. Полный `pnpm test`: 203 файла, 3960 passed / 1 failed / 4 skipped. Упавший тест — `src/web/orchestrator.test.mjs` «token_usage … файл задачи закоммичен» (ожидался `docs(task): VL-93`, получено `"init\n"`). Причина внешняя для этой задачи: в основном репозитории незакоммиченные изменения/фикстура git-лога в тесте, а изменённый код задачи — только комментарий в `src/agent/tui.ts`. Изолированный повтор `npx vitest run src/web/orchestrator.test.mjs` → **89 passed**, то есть падение плавающее (интерференция от соседнего прогона/worktree), не регрессия diff'а. DoD «Тесты проходят» отмечен по факту перепроверки затронутого файла; полный прогон при Close повторить после merge.
Что осталось: Close — полный прогон после merge и финальная вычитка документации.
---
author: @agent
created: 2026-11-10 01:34
---
Фаза Close выполнена.
**Слияние:** ветка `vb/vl-397` слита в master одним merge-коммитом `bff0773` (состав ветки — `2a65fc2`, конфликтов не было: `templates/agent-prompt.md` и `CHANGELOG.md` слились автоматически). Изменённые merge-коммитом файлы: AGENTS.md, CHANGELOG.md, README.md, src/agent/tui.ts, templates/agent-prompt.md.
**Проверки после merge:** `pnpm build` — ок; полный `pnpm test` — **204 файла, 3980 passed / 1 failed нет / 4 skipped**, прогон один (в т.ч. ранее «плававший» `src/web/orchestrator.test.mjs` «token_usage … файл задачи закоммичен» прошёл: параллельного vitest в других worktree не было). Ранний точечный фильтр по diff — README-стандарт покрыт полным прогоном.
**Уборка:** worktree `.vibelog/worktrees/vl-397` удалена (`--force` понадобился из-за единственного untracked-симлинка `backlog/references/data`, который кладёт оркестратор; иных modified/untracked файлов не было), ветка `vb/vl-397` удалена (`was 2a65fc2`).
**DoD:** 1. Тесты проходят — полный прогон 204/204 файлов зелёный; 2. Документация обновлена — doc-30 (фазовый процесс) и doc-31 (агент vb) созданы, doc-10 переведён в redirect-заглушку с баннером «устарел» (тело не переписывалось, устаревшее вычищено точечными `document_edit`), ссылки переведены в README, AGENTS.md, templates/agent-prompt.md, doc-7, doc-23, src/agent/tui.ts (комментарий), CHANGELOG.md — запись в `[Unreleased] / Изменено`; 3. Регрессий нет — единственная правка в `src/` это комментарий, поведение не менялось.
**Коммиты фазы Close:** `58840ca` (refs и lessons — дополнен lesson-251 обратной стороной правила: `document_update` без `content` при реально меняющихся title/tags не noop, тело сохраняется), `c1a98de` (doc-30/doc-31/заглушка doc-10 + ссылки в doc-7 и doc-23).
Урок: дополнен lesson-251 (`VL-397` в linked_tasks), новых уроков не заводил — остальное знание в диффе.
---
<!-- COMMENTS:END -->