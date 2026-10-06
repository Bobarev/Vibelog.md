---
id: VL-105
title: Провести ревизию системного промпта и актуализировать AGENTS.md
status: Done
assignee: []
reporter: ''
created_date: '2026-10-06 19:24'
updated_date: '2026-10-06 23:12'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/system-prompt.ts
  - src/cli/commands/init.ts
  - src/cli/skills.test.mjs
  - templates/qwen-commands/phase-2.md
  - templates/qwen-commands/phase-3.md
  - templates/qwen-commands/phase-close.md
  - templates/qwen-commands/phase-comment.md
  - templates/qwen-commands/prompt.md
  - templates/qwen-commands/spec.md
  - templates/qwen-commands/plan.md
  - templates/qwen-commands/code.md
  - .qwen/commands/vibelog/spec.md
  - .qwen/commands/vibelog/plan.md
  - .qwen/commands/vibelog/code.md
  - AGENTS.md
  - README.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Провести ревизию системного промпта проекта Vibelog.md. Есть подозрение на дублирование между начальным вшитым системным промптом и промптами фаз (spec/plan/code) — дубли нужно устранить. Дополнительно: в AGENTS.md очень много устаревшей информации, унаследованной со старта разработки проекта, — документ нужно актуализировать.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Дублирование между вшитым системным промптом и промптами фаз (spec/plan/code) устранено: текст не повторяется в двух местах
- [x] #2 AGENTS.md актуализирован: устаревшая информация, унаследованная со старта разработки проекта, обновлена или удалена
- [x] #3 Рабочий процесс spec → plan → code не сломан: команды /vibelog:spec, /vibelog:plan, /vibelog:code сохраняют свою функциональность
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План: ревизия системного промпта и актуализация AGENTS.md (VL-105)

## Контекст (результаты ревизии)

Промпты проекта живут в трёх слоях:
1. **BASE_PROMPT** — `src/agent/system-prompt.ts:30-39` (вшитый системный промпт vibelog-agent) + вставка AGENTS.md (лимит 8000 символов, `AGENTS_MD_MAX_CHARS`).
2. **Headless-промпты фаз** — `templates/qwen-commands/phase-{1,2,3,close,comment}.md`, `prompt.md`; рендерятся `renderPrompt()` (`src/web/phase-prompt.ts`) для web-оркестратора и CLI `vibelog-agent <phase> <taskId>`.
3. **Интерактивные slash-команды Qwen Code** — `templates/qwen-commands/{spec,plan,code}.md`; `vibelog init --skills` копирует в `.qwen/commands/vibelog/`.

### Дублирование (найдено)

(1) **BASE_PROMPT ↔ AGENTS.md** (оба попадают в system-prompt headless-сессии):
- «Отвечай на русском языке» (`system-prompt.ts:33`) ↔ секция «Язык» (`AGENTS.md:15-25`)
- «после изменений запускай проверки (pnpm build, pnpm test)» (`system-prompt.ts:36`) ↔ «Сборка обязательна... pnpm build... pnpm test» (`AGENTS.md:55-65`). Плюс pnpm-специфика в generic-промпте продукта неверна для чужих проектов.

(2) **phase-*.md ↔ BASE_PROMPT/AGENTS.md**:
- `phase-3.md:15-18` (шаг 2): TypeScript→pnpm build→dist, комментарии на русском, тесты *.test.mjs, pnpm build/pnpm test — дословный дубль AGENTS.md; `phase-3.md:36` — pnpm в шаблоне отчёта
- `phase-3.md:46`, `phase-close.md:42`, `phase-comment.md:23-24`, `prompt.md:11,15`: «Только Node.js (не python3)»/«Только пределы проекта» — дубли AGENTS.md («Запрет на внешние рантаймы») и BASE_PROMPT (cwd-правило)
- `phase-2.md:70`: «не выйди за пределы проекта» — дубль BASE_PROMPT

(3) **Интерактивные {spec,plan,code}.md ↔ headless phase-{1,2,3}.md** — два описания одних фаз с дрейфом:
- `code.md:27`: статус **Done**; `phase-3.md:49`: статус **Review** + шаг modifiedFiles (VL-94/97) — рассинхрон
- `plan.md`: нет статуса Planned дочерним (в `phase-2.md` шаг 4 есть)
- `spec.md`: нет формата вопросов при неполном описании (`phase-1.md` шаг 6)
- `spec.md:30`, `plan.md:39`, `code.md:34`: «Не используй python3. Только Node.js.» — дубль AGENTS.md

### Устаревшее в AGENTS.md
- «Что нужно сделать» (`AGENTS.md:27-37`): порядок PLAN-00→PLAN-08 — эпоха бутстрэпа; проект реализован (VL-100+), новая работа идёт через backlog/tasks
- «Право на корректировку плана» (`AGENTS.md:38-54`): детали форматов frontmatter/AC/CLI — реализованы, «читай планы последовательно» больше не актуально
- VIBELOG:SKILLS (`AGENTS.md:129-139` + `src/cli/commands/init.ts:196-206`): «На каждой фазе ждать подтверждения» — верно только для интерактивных команд; headless-фазы (web-оркестратор, vibelog-agent) автоматические; close/comment не упомянуты
- `AGENTS.md:115`: «VL-26+» — устаревшая отсылка
- `README.md:191-195`: «/vibelog:spec — Разбить фичу на 2-3 задачи» — устаревшая семантика (spec не создаёт задач)
- AGENTS.md = 7773 симв. при лимите 8000 — запас критически мал; сокращение устаревшего даёт его

## Файлы для изменения

1. `src/agent/system-prompt.ts` — BASE_PROMPT (строки 33, 36)
2. `templates/qwen-commands/phase-3.md` (строки 15-18, 36, 46), `phase-close.md` (42), `phase-comment.md` (23-24), `prompt.md` (11, 15), `phase-2.md` (23-27, 70); `phase-1.md` — проверка без правок
3. `templates/qwen-commands/spec.md` (30), `plan.md` (29-32, 39), `code.md` (27, 34)
4. `AGENTS.md` — секции 27-37, 38-54, 108-123, 129-139
5. `src/cli/commands/init.ts` — updateAgentsMd (196-206)
6. `src/cli/skills.test.mjs` — обновить/добавить проверки
7. `.qwen/commands/vibelog/{spec,plan,code}.md` — пересинхронизировать из templates (в репо копии от 3 окт)
8. `README.md` (191-195)

## Порядок действий

**Шаг 1 — system-prompt.ts (убрать дубли с AGENTS.md):**
- Строка 33 «Отвечай на русском языке» → удалить (язык проекта — в AGENTS.md; в чужих проектах агент отвечает на языке пользователя)
- Строка 36 → generic: «Применяй правки аккуратно; после изменений выполняй проверки проекта, описанные в AGENTS.md (если файл есть)»
- Оставить: роль, cwd, shell-запреты (~, $HOME, abs, ../), grep -r/find-исключения, запрет push, «Контекст — в AGENTS.md ниже»

**Шаг 2 — phase-3.md:**
- Шаг 2 (15-18) заменить на: «Реализуй по плану из задачи. Проверки проекта (сборка, тесты) выполняй по правилам AGENTS.md проекта; если AGENTS.md нет — сделай минимальную самопроверку и зафиксируй в отчёте.»
- Строка 36 (шаблон отчёта): «Проверки: pnpm build OK, pnpm test — N/N» → «Проверки: <список выполненных>»
- Строка 46: удалить «не используй python3 — только Node.js», оставить cwd-часть? Нет — cwd уже в BASE_PROMPT → удалить строку целиком
- Сохранить маркеры тестов: parentTaskId, backlog_list_tasks; статус Review; modifiedFiles

**Шаг 3 — phase-close.md, phase-comment.md, prompt.md:**
- `phase-close.md:42` «Только пределы проекта; только Node.js (не python3).» → удалить; git-правила (feat/docs(task), явные пути, guard гонки) и parentTaskId сохранить
- `phase-comment.md:23-24` (Node.js + пределы) → удалить; «Git-операции запрещены» сохранить
- `prompt.md:11,15` (пределы + Node.js) → удалить; git-политику (commit разрешён, push запрещён) сохранить

**Шаг 4 — phase-2.md:**
- Шаг 2 (23-27) сократить до фазово-специфичного: «Изучи релевантные файлы через bash (grep/sed). НЕ читай файлы целиком > 200 строк; один файл > 2 раз подряд — признак цикла.» — убрать общие правила («используй grep для поиска, sed -n 'A,Bp'», «экранируй кавычками» — это AGENTS.md/базовые правила shell)
- Строка 70: «Не выполняй git-операции и не выйди за пределы проекта.» → «Не выполняй git-операции — фаза Plan только читает код и пишет в задачи.»
- Сохранить: {{taskId}}, {{comment}}, parentTaskId, «Фаза 2 (Plan)»

**Шаг 5 — phase-1.md:** проверить на дубли; правки минимальные (вопросы, статус Spec — фазово-специфичный контент, не трогать). Сохранить маркеры: «НЕ создавай», «type=epic».

**Шаг 6 — интерактивные spec/plan/code.md (синхронизация с headless):**
- `code.md`: статус Done → Review (шаг 4); добавить шаг modifiedFiles (синхронизация с phase-3.md шаг 5); «Запусти tsc или аналогичный линтер, запусти тесты» → «выполни проверки проекта по AGENTS.md»; удалить python3-строку (34); сохранить интерактивный финал («Покажи git diff. Жди подтверждения. Не коммить»)
- `plan.md`: в шаг 4 (epic, 29-32) добавить «установи Planned дочерним»; удалить python3-строку (39); сохранить «Покажи план и ЖДИ ПОДТВЕРЖДЕНИЯ»
- `spec.md`: удалить python3-строку (30); добавить краткое «при неполном описании — задай вопросы пользователю» (синхронизация с phase-1); сохранить «НЕ создаёт новых задач» и ожидание подтверждения
- Фронтматмер (description, {{args}}) сохранить — их проверяет skills.test.mjs

**Шаг 7 — AGENTS.md (актуализация):**
- Удалить «Что нужно сделать» (27-37); в «Работа через Vibelog» уточнить: проект реализован, plan/PLAN-*.md — исторический контекст, новая работа — через backlog/tasks
- Сократить «Право на корректировку плана» (38-54): оставить тезис «правки планов допустимы без спроса»; убрать реализованные детали форматов
- VIBELOG:SKILLS (129-139): «интерактивные команды ждут подтверждения; автоматические фазы (web-оркестратор, vibelog-agent) выполняются без подтверждения; есть фазы close/comment»
- `AGENTS.md:115`: убрать «VL-26+»
- «Контекст: оригинал Backlog.md» (108-113): сократить (refs/ — референс)
- Проверить длину < 8000 символов (node -e с readFileSync)

**Шаг 8 — init.ts:** updateAgentsMd (196-206) — текст section синхронизировать с новым VIBELOG:SKILLS (init в чужих проектах не должен дописывать устаревший). Сохранить BEGIN/END и '/vibelog:spec' — проверяются тестом.

**Шаг 9 — тесты (skills.test.mjs):**
- Маркеры сохраняются: {{args}}, «Фаза 1», BEGIN/END, '/vibelog:spec', parentTaskId, backlog_list_tasks, «НЕ создавай», type=epic — существующие проверки остаются
- Добавить тесты-инварианты против дрейфа:
  - code.md содержит «Review» и не содержит статуса «Done»
  - ни один шаблон phase-*.md / {spec,plan,code}.md не содержит «pnpm build» и «Только Node.js» (правила живут в AGENTS.md)
  - plan.md содержит «Planned»

**Шаг 10 — пересинхронизация копий и доков:**
- `.qwen/commands/vibelog/{spec,plan,code}.md`: пересинхронизировать из templates (в репо копии от 3 окт — устарели): `node bin/vibelog.mjs init T --prefix t --skills --force` в /tmp + копирование через патч-скрипт, либо прямой cp шаблонов
- `README.md:191-195`: spec — «уточнить фичу и определить масштаб»; plan — «составить план»; code — «реализовать план (статус Review)»; «На каждой фазе агент ждёт подтверждения» → уточнить: интерактивные команды — да, автоматические фазы — нет

## Проверки

- `pnpm build` (tsc — system-prompt.ts, init.ts)
- `pnpm test` (skills.test.mjs, orchestrator.test.mjs renderPrompt, system-prompt.test.mjs)
- `node bin/vibelog.mjs init Test --prefix tst --skills --force` в /tmp — секция генерируется, файлы копируются
- `node -e "console.log(require('fs').readFileSync('AGENTS.md','utf8').length)"` < 8000
- `grep -c "pnpm build" templates/qwen-commands/*.md` = 0; `grep -c "Review" templates/qwen-commands/code.md` ≥ 1

## Риски

1. Тесты skills.test.mjs/orchestrator.test.mjs падают на изменении текстов — обновлять согласованно; сохранить все маркеры ({{args}}, Фаза 1, BEGIN/END, parentTaskId, backlog_list_tasks, «НЕ создавай», type=epic)
2. Удаление «Только Node.js» из фаз — в проектах без AGENTS.md агент не получит запрет рантаймов; для Vibelog.md репо покрыто AGENTS.md. Альтернатива (не выбирается): дублировать в BASE_PROMPT
3. Дрейф интерактивных и headless промптов в будущем — закрывается тестами-инвариантами (шаг 9)
4. AGENTS.md = 7773 из лимита 8000 — после актуализации проверить длину; если растёт — сократить chrome-devtools-секцию
5. `.qwen/commands` в репо — копии; без пересинхронизации (шаг 10) в репо останутся устаревшие интерактивные команды
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-06 19:27
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Провести ревизию системного промпта и актуализировать AGENTS.md». Масштаб: task. Уточнено: формулировка цели (ревизия системного промпта, устранение дублирования промптов фаз и актуализация AGENTS.md), уточнены 3 проверяемых критерия приёмки. Вопросов нет.
---
author: @agent
created: 2026-10-06 22:27
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу.
**Результаты ревизии:**
- Найдено 3 группы дублей: (1) BASE_PROMPT (`system-prompt.ts:33,36`) ↔ AGENTS.md — русский язык и «pnpm build/pnpm test» в обоих; (2) headless-промпты фаз (`phase-3.md:15-18,36,46`, `phase-close.md:42`, `phase-comment.md:23-24`, `prompt.md:11,15`, `phase-2.md:70`) — «Только Node.js», «пределы проекта», pnpm-блок дублируют AGENTS.md/BASE_PROMPT; (3) интерактивные `{spec,plan,code}.md` ↔ `phase-{1,2,3}.md` — два описания одних фаз с дрейфом (code.md ставит Done при Review в phase-3; plan.md без Planned дочерним; spec.md без вопросов при неполном описании).
- Устаревшее в AGENTS.md: секции «Что нужно сделать» (27-37) и «Право на корректировку плана» (38-54) — эпоха бутстрэпа PLAN-00..08; VIBELOG:SKILLS (129-139) + генератор в `init.ts:196-206` — «ждать подтверждения» неверно для headless-фаз; отсылка «VL-26+» (115); README:191-195 — устаревшая семантика spec. Длина AGENTS.md = 7773 симв. при лимите 8000 — запас критически мал.
**План:** 8 файлов (system-prompt.ts, 6 шаблонов templates/qwen-commands/, 3 интерактивных команды, AGENTS.md, init.ts, skills.test.mjs, .qwen/commands-копии, README), 10 шагов, проверки pnpm build/test + grep-инварианты. Риски: маркеры тестов на шаблонах (сохраняются), потеря запрета рантаймов в проектах без AGENTS.md (для Vibelog.md покрыто), будущий дрейф двух наборов промптов (закрывается тестами-инвариантами).
---
author: @agent
created: 2026-10-06 22:52
---
Фаза 3 (Code) выполнена. Изменено (16 файлов вне backlog/): `src/agent/system-prompt.ts`, `src/cli/commands/init.ts`, `src/cli/skills.test.mjs`, `templates/qwen-commands/{phase-2,phase-3,phase-close,phase-comment,prompt,spec,plan,code}.md`, `.qwen/commands/vibelog/{spec,plan,code}.md`, `AGENTS.md`, `README.md`.
**Что сделано (по плану):**
1. **BASE_PROMPT** (`system-prompt.ts`): удалена строка «Отвечай на русском языке» (язык проекта — в AGENTS.md); pnpm-специфика проверок заменена на generic «выполняй проверки проекта, описанные в AGENTS.md».
2. **Headless-шаблоны фаз**: из `phase-2/3/close/comment`, `prompt.md` удалены дубли AGENTS.md/BASE_PROMPT («Только Node.js», пределы cwd, pnpm-блок из `phase-3` шаг 2 и шаблона отчёта → «Проверки: \<список выполненных\>»). Фазово-специфичное сохранено: parentTaskId, backlog_list_tasks, статус Review, modifiedFiles (VL-94/97), git-политика close/comment/prompt. `phase-1.md` — проверен, правок не требует.
3. **Интерактивные команды синхронизированы с headless**: `code.md` — статус исходной задачи Done→Review + шаг modifiedFiles + «проверки по AGENTS.md» (Done оставлен только у эпика — закрытие при всех детях Done); `plan.md` — дочерним ставится Planned; `spec.md` — вопросы пользователю при неполном описании; удалены python3-строки; описание фронматтера spec.md исправлено («Разбить фичу на задачи» → «Уточнить фичу и определить масштаб» — семантика spec не включает создание задач).
4. **AGENTS.md актуализирован** (7773 → 6883 симв., лимит 8000): удалены «Что нужно сделать» (эпоха бутстрэпа PLAN-00..08) и реализованные детали «Права на корректировку планов»; «Работа через Vibelog» — проект реализован, планы = исторический контекст; VIBELOG:SKILLS — интерактивные команды ждут подтверждения, автоматические фазы (web-оркестратор, vibelog-agent) — нет, упомянуты фазы close/comment; убрана отсылка «VL-26+»; сокращён блок про оригинал Backlog.md.
5. **`init.ts` (updateAgentsMd)**: генерируемая секция VIBELOG:SKILLS синхронизирована с новым текстом (BEGIN/END и '/vibelog:spec' сохранены — проверяются тестом).
6. **README.md**: таблица /vibelog:* актуализирована (spec — уточнение/масштаб; code — статус Review); подтверждение — только интерактивные команды.
7. **Тесты-инварианты** (`skills.test.mjs`): ни один шаблон фаз не содержит «pnpm» и «Только Node.js»; `code.md` — статус задачи Review, Done ровно один раз (эпик); `plan.md` — Planned; `spec.md` — вопросы; BASE_PROMPT без русского языка и pnpm.
8. **Копии `.qwen/commands/vibelog/*`** пересинхронизированы из templates (в репо были версии от 3 окт).
**Проверки:** pnpm build OK (tsc, 0 ошибок); pnpm test — 762/762 pass, 0 fail (включая skills/orchestrator/system-prompt); smoke `vibelog init --skills --force` — секция генерируется новым текстом, файлы копируются; длина AGENTS.md 6883 < 8000; grep-инварианты по шаблонам — дублей нет.
**Отклонения/примечания:**
- Инвариант «code.md не содержит Done» реализован как «статус исходной задачи — Review; Done только у эпика (все дети Done)» — иначе эпик-флоу ломается (Done для эпика обязателен).
- Сборка/тесты гонялись через nvm-node v20.19.0: `/usr/local/bin/node` v22.8.0 падает на Catalina (dyld: `_pwritev`) — шим `.patch-tmp/bin/node` (временный, удалён). Это ограничение окружения, не проекта.
- В рабочем дереве есть посторонние незакоммиченные изменения (`backlog/config.yml`, задачи VL-107/VL-108, `scripts/tmp-vl103-*.mjs`) — не мои, в modifiedFiles не включал.
**Что осталось:** ничего по задаче; все AC/DoD закрыты. Рекомендация на Phase Close: feat-коммит по списку modifiedFiles.
---
author: @agent
created: 2026-10-06 23:12
---
Фаза Close выполнена. Статус: Done. Коммит feat: 5891ff1 — ревизия системного промпта и актуализация AGENTS.md (устранение дублей промптов), 16 файлов. Не закоммичено: backlog/config.yml, задачи VL-107/VL-108, .patch-tmp/ (посторонние/временные — не относятся к задаче).
---
<!-- COMMENTS:END -->