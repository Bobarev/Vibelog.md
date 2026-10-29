---
id: VL-202
title: 'docs: правило пакетного чтения файлов в промптах фаз (один read_file вместо 20 grep-выборок)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-26 23:59'
updated_date: '2026-10-29 07:41'
due_date: ''
labels:
  - docs
  - prompt
dependencies: []
milestone: v1.10
references: []
priority: medium
type: docs
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - templates/phases/phase-plan.md
  - templates/phases/phase-code.md
  - templates/phases/phase-do.md
  - templates/phases/phase-investigate.md
  - templates/agent-prompt.md
  - src/web/phase-prompt.test.mjs
lessons:
  - lesson-69
token_usage:
  input: 6875026
  output: 115499
  cache: 6473984
  total: 6990525
  requests: 96
  duration_ms: 2898884
  reasoning: 100229
  by_phase:
    spec:
      input: 99280
      output: 1589
      cache: 90752
      requests: 4
    plan:
      input: 1321118
      output: 37868
      cache: 1216896
      requests: 28
    code:
      input: 5454628
      output: 76042
      cache: 5166336
      requests: 64
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-197. В сессии-2 VL-193 README затронут в 20+ shell-вызовах, doc-6 читан ≈12 чанками с промежуточными проверками границ — прямой вклад в исчерпание max_wall_time (code-1 упала на 40-й минуте, VL-197). В промпты фаз (templates/phases и/или system-prompt) добавить: «анализируй файл одним read_file (offset/limit при файле >200 строк — последовательно, а не через grep-подстроки); точечные правки — после полного чтения; объединяй связанные проверочные команды в один вызов через &&». Согласовать с правилом «не читать файлы целиком >200 строк» (читать чанками offset/limit, но без промежуточного grep-поиска границ).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 В шаблонах промптов фаз есть правило пакетного чтения/команд; CHANGELOG/документация обновлены.
- [x] #2 На тестовом docs-прогоне число shell-вызовов на файл снижается (метрика из jsonl: README ≤5 обращений вместо 20+).
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# Plan: правило пакетного чтения файлов в промптах фаз (VL-202)

## Контекст (существующие правила, на которые наращиваем)

- &&-пакетирование shell-команд уже есть: phase-code.md:67, phase-do.md:51, phase-investigate.md:57, phase-reject.md:39, phase-close.md:78, phase-close-worktree.md:95 («Пакетируй последовательные git/shell-команды в ОДИН вызов через &&»).
- Лимит «>200 строк не целиком» есть в phase-plan.md:32, phase-do.md:27 («читай фрагментами (sed/grep)» — именно его надо переформулировать), phase-investigate.md:34.
- Инвариантные тесты на формулировки шаблонов — паттерн VL-142 в src/web/phase-prompt.test.mjs:351-368 (по AC задачи — допустимо, вопреки чистке VL-130).
- assert-ы на содержимое templates/agent-prompt.md в тесты НЕ возвращать (решение VL-130: правка системного промпта не должна ломать тесты).

## Единая формулировка нового правила

> Пакетное чтение файлов: целевой файл анализируй ОДНИМ вызовом read_file — при файле >200 строк читай последовательными чанками offset/limit подряд, а не через промежуточные grep-выборки границ; точечные правки вноси только после полного чтения файла. Связанные проверочные команды (ls/grep/git/сборка/тесты) объединяй в один вызов через &&.

Согласование с лимитом 200 строк: чанки offset/limit ОСТАЮТСЯ обязательными; запрещён именно промежуточный grep-поиск границ между чанками (иначе ~12 чтений doc-6 вместо 3-4).

## Файлы и конкретные места правок (8 файлов)

1. **templates/phases/phase-plan.md**
   - Шаг 2 (строка 32): «Изучи релевантные файлы через bash (grep/sed). НЕ читай файлы целиком > 200 строк; …» → «Изучи релевантные файлы: сначала grep/glob — найти нужный файл/раздел, затем целевой файл — одним read_file (при >200 строк последовательные чанки offset/limit подряд, без промежуточного grep-поиска границ). НЕ читай файлы целиком > 200 строк; один файл > 2 раз подряд — признак цикла. …» (остальное предложение сохранить).
   - «Экономия ходов» (перед строкой «Перед записью плана…»): новый буллет — «Пакетное чтение: целевой файл — один read_file (чанки offset/limit подряд вместо grep-подстрок); связанные проверочные команды — один вызов через && (ls … && grep …).»

2. **templates/phases/phase-code.md** — «Экономия ходов» (после буллета со && на строке 67): новый буллет — «Целевой файл читай одним read_file (при >200 строках — последовательные чанки offset/limit, не grep-подстроки); точечные правки — после полного чтения.»

3. **templates/phases/phase-do.md**
   - Строка 27: «файлы > 200 строк читай фрагментами (sed/grep), не целиком» → «файлы > 200 строк читай последовательными чанками одним read_file (offset/limit), не целиком и не через промежуточные grep-выборки границ».
   - «Экономия ходов» (после &&-буллета, строка 51): тот же новый буллет про read_file.

4. **templates/phases/phase-investigate.md**
   - Шаг 2 (строка 34): «целевой код: grep/glob по подсказкам … (не читай файлы целиком > 200 строк)» → дополнить: «… > 200 строк; найденный целевой файл — одним read_file чанками offset/limit подряд)».
   - «Экономия ходов» (после &&-буллета): буллет про read_file.

5. **templates/agent-prompt.md** (system-prompt, покрывает фазы spec/comment/prompt/reject): в блок «Правила» после буллета «Не запускай grep -r / find…» — короткий буллет: «- Читай файлы пакетно: целевой файл — один read_file (при >200 строк последовательные чанки offset/limit подряд, не через grep-подстроки); точечные правки — после полного чтения; связанные проверочные команды объединяй в один вызов через &&.» Тестами НЕ покрывается (VL-130).

6. **src/web/phase-prompt.test.mjs** — после describe «VL-142 — phase-2: экономия ходов» (~строка 368): describe «VL-202 — пакетное чтение файлов»:
   - для ['phase-plan.md','phase-code.md','phase-do.md','phase-investigate.md']: `assert.ok(text.includes('одним read_file'))` и `assert.ok(text.includes('offset/limit'))` (одна итерация по массиву);
   - для phase-do.md дополнительно: `assert.ok(!text.includes('фрагментами (sed/grep)'))` — старая формулировка удалена;
   - для phase-plan.md: `assert.ok(text.includes('grep/glob — найти нужный файл'))` или фактическая подстрока шага 2.

7. **CHANGELOG.md** — запись в `## [Unreleased] → ### Изменено`: «**VL-202: правило пакетного чтения файлов в промптах фаз** — в шаблоны phase-plan/phase-code/phase-do/phase-investigate и system-prompt (agent-prompt.md) добавлено: целевой файл — один read_file (чанки offset/limit подряд при >200 строк, без промежуточного grep-поиска границ), точечные правки после полного чтения, связанные проверочные команды через &&; переформулирован лимит >200 строк в phase-do (sed/grep → read_file). Тест phase-prompt.test.mjs (+VL-202).» — **выполняет Фаза Close** (правило phase-code:77 — CHANGELOG и backlog/docs в Фазу 3 не входят).

8. **backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md** (338 строк) — новый подраздел «### 6.3. Пакетное чтение файлов (VL-202)» после §6.2 (3-6 строк: суть правила, согласование с лимитом 200 строк, зачем — экономия wall-time по VL-197/VL-193). **Выполняет Фаза Close** (lesson-63: большие backlog/docs в Фазу 3 не включать).

## Порядок действий (Фаза Code)

1. Правки шаблонов 1-5 (5 файлов) — точечно по якорям выше.
2. Тест VL-202 в src/web/phase-prompt.test.mjs (пункт 6).
3. Проверки: `pnpm build && npx vitest run src/web/phase-prompt.test.mjs` (быстрая итерация) → затем полные `pnpm test` и `pnpm lint`.
4. Коммит feat по явным путям (шаг 6 phase-code): `git add templates/phases/phase-plan.md templates/phases/phase-code.md templates/phases/phase-do.md templates/phases/phase-investigate.md templates/agent-prompt.md src/web/phase-prompt.test.mjs && git commit -m "feat: VL-202 — правило пакетного чтения файлов в промптах фаз"`.
5. Тестовый docs-прогон для AC2 (метрика jsonl):
   - `node bin/vibelog-agent.mjs "Прочитай README.md проекта и перечисли его разделы (одна строка на раздел)" --headless --max-tool-calls 40` (LLM-ключи берутся из .env/.vibelog/settings.json; нужен предварительный pnpm build);
   - подсчёт обращений к README в последнем jsonl одной node-командой: разобрать `.vibelog/agent-sessions/*.jsonl` (новейший), для assistant-сообщений посчитать tool_calls, чьи аргументы содержат `README` (read_file/grep/glob/run_shell_command); альтернатива — профиль «чтения по файлам» из phase-analyze (phase-analyze.md:29);
   - **критерий: ≤5 обращений** (база «20+» — историческая сессия VL-193, повторно не измеряется).
6. Отчёт и завершение: acChecks `[2]` (AC2 — после прогона), dodChecks `[1,3]` (тесты, нет регрессий), status «Review».

## Фаза Close (для полного AC1/DoD-2)

- Шаг 4 close: запись CHANGELOG (п.7) + doc-10 §6.3 (п.8) → docs-коммит.
- В backlog_finish_phase передать acChecks `[1]` (AC1 закрывается только после CHANGELOG/доков) и dodChecks `[2]` (документация обновлена). MCP принимает acChecks в любой фазе.

## Проверки (команды)

```bash
pnpm build && npx vitest run src/web/phase-prompt.test.mjs   # быстрая итерация
pnpm test                                                      # build + vitest + static
pnpm lint
# AC2: прогон + подсчёт (см. шаг 5) → ожидаем README ≤5
```

## Риски

- **AC2 зависит от LLM-прогона**: нужны env-ключи, ~1-3 мин и токены; отказ провайдера/нет ключа → AC2 остаётся открытой, честно зафиксировать в отчёте Code (не закрывать задним числом).
- **Тесты на точные подстроки** могут сломаться при будущей перефразировке — осознанный паттерн VL-142 (по AC), не «чинить» удалением.
- **Project override** (.vibelog/prompts/phases/, VL-188): в worktree каталог отсутствует (проверено ls) — правки в templates действуют; если появится — переопределение имеет приоритет.
- **Формулировка «читай фрагментами (sed/grep)» в phase-do** — единственное место, где старое правило ПРОТИВ нового; обязательно заменить, иначе промпт противоречит сам себе (AC1).
- **CHANGELOG/doc-10 в Code не трогать** (phase-code:77, lesson-63) — иначе регрессия процесса Close; итоговые доки пишет Close.

## Соответствие AC/DoD

- AC1 → шаблоны+тесты (Code) + CHANGELOG/doc-10 (Close) → отметить acChecks [1] в Close.
- AC2 → тестовый прогон, README ≤5 (Code) → acChecks [2] в Code.
- DoD 1,3 → Code (dodChecks [1,3]); DoD 2 → Close (dodChecks [2]).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-27 12:42
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен (информативный, <80 символов). Тип: docs (подтверждён). Масштаб: task. Приоритет: Medium (описание полное; предложение №4 из VL-197/docs-14, Medium). Уточнено: цель — добавить в шаблоны промптов фаз правило пакетного чтения (один read_file с offset/limit при >200 строках без промежуточного grep-поиска границ; точечные правки после полного чтения; объединение связанных проверок в один вызов через &&); контекст — перерасход shell-вызовов в сессиях VL-193 (README 20+, doc-6 ≈12 чанков) как вклад в исчерпание max_wall_time (VL-197); AC уточнены до 3 проверяемых пунктов (наличие правила + CHANGELOG, согласование с лимитом 200 строк, метрика README ≤5 обращений из jsonl). Labels: docs, prompt. References: нет (VL-197 — внутренняя задача, не внешний источник). Вопросов нет.
---
author: @agent
created: 2026-10-27 14:41
---
Фаза 2 (Plan) выполнена. Тип: docs (обычная задача — план записан в VL-202). Изучены шаблоны templates/phases/*.md (якоря: &&-пакетирование уже в 6 шаблонах, лимит 200 строк в plan/do/investigate), system-prompt (templates/agent-prompt.md), паттерн инвариантных тестов VL-142 в phase-prompt.test.mjs, CHANGELOG.md, doc-10. План: 8 файлов — 5 шаблонов промптов (phase-plan/phase-code/phase-do/phase-investigate + agent-prompt.md), тест VL-202 в phase-prompt.test.mjs, CHANGELOG + doc-10 §6.3 (закрывает Фаза Close по правилу phase-code:77 и lesson-63). Ключевое решение: единая формулировка «целевой файл — один read_file, чанки offset/limit подряд при >200 строк без промежуточного grep-поиска границ; точечные правки после полного чтения; связанные команды через &&»; переформулировать противоречащий лимит в phase-do.md:27 («фрагментами (sed/grep)» → read_file). AC2 — тестовый docs-прогон (vibelog-agent headless + подсчёт обращений к README из jsonl, критерий ≤5). Разметка: Code отмечает acChecks [2] и dodChecks [1,3] → Review; Close — acChecks [1] и dodChecks [2] после CHANGELOG/doc-10. Риски: AC2 зависит от LLM-ключей/прогона (не закрывать задним числом), тесты на точные подстроки — паттерн VL-142, project override отсутствует в worktree.
---
author: @agent
created: 2026-10-27 22:05
---
Фаза 3 (Code) выполнена. Изменено: templates/phases/phase-plan.md, phase-code.md, phase-do.md, phase-investigate.md, templates/agent-prompt.md, src/web/phase-prompt.test.mjs; коммит b0a7111 (feat: VL-202 — правило пакетного чтения файлов в промптах фаз). Что сделано: во все 4 шаблонах фаз, читающих целевой код, добавлено правило «целевой файл читай одним read_file (чанки offset/limit подряд вместо grep-подстрок); точечные правки после полного чтения; связанные проверочные команды через &&»; в system-prompt (agent-prompt.md) — короткий буллет того же правила; в phase-do.md:27 лимит >200 строк переформулирован («фрагментами (sed/grep)» → последовательные чанки read_file) — убрано противоречие; в phase-plan.md шаг 2 ведёт grep/glob → один read_file; в phase-investigate.md шаг 2 дополнен. Тесты: +describe «VL-202 — пакетное чтение файлов» в phase-prompt.test.mjs (3 it, паттерн VL-142 по AC). Проверки: pnpm build; полный pnpm test — зелёные (все файлы); pnpm lint — ок. AC2 — тестовый docs-прогон выполнен: vibelog-agent headless «Прочитай README.md и перечисли разделы» → 2 запроса, 1 tool call, обращений к README в jsonl = 1 (критерий ≤5; база 20+ из VL-193). Метрика: .vibelog/agent-sessions/agent-1793127875896.jsonl, подсчёт аргументов tool_calls с README. Новый lesson-69 (VIBELOG_CWD: jsonl тестового прогона в worktree пишется в основной репо — сбрасывать env -u) связан. References не использовались. Отмечено: AC2, DoD-1 (тесты), DoD-3 (нет регрессий). Осталось на Close: AC1 (CHANGELOG-запись + doc-10 §6.3) и DoD-2 (документация) — по плану в Фазе Close.
---
author: @agent
created: 2026-10-27 22:32
---
Фаза Close выполнена. Ветка vb/vl-202 слита в master (1 коммит b0a7111, merge b228063), worktree .vibelog/worktrees/vl-202 удалена (были только untracked-симлинки node_modules/refs — удалена с force), ветка удалена. Проверки после merge: pnpm build и полный pnpm test — зелёные (81 файл, 1457 passed + 4 skipped; static — 7 passed). Документация (docs-коммит b5ae894): CHANGELOG.md — запись в Unreleased/Изменено про правило пакетного чтения; doc-10 — новый §6.3 «Пакетное чтение файлов (VL-202)» (суть правила, согласование с лимитом 200 строк, экономия wall-time по VL-197/VL-193). Lesson-69 закоммичена отдельно (d7b80c9). Отмечено: AC1 (шаблоны + CHANGELOG/документация), DoD-2 (документация обновлена). Итог DoD: 1 ✓ (тесты), 2 ✓ (документация), 3 ✓ (нет регрессий).
---
<!-- COMMENTS:END -->