---
id: VL-312
title: 'Ревью промптов фаз: сократить дубли правил (по образцу phase-spec) и добавить правило параллельного чтения файлов'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-03 00:15'
updated_date: '2026-11-03 22:30'
due_date: ''
labels:
  - prompt
  - templates
  - agent
dependencies: []
milestone: v1.12
references: []
priority: medium
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - templates/agent-prompt.md
  - templates/phases/phase-plan.md
  - templates/phases/phase-code.md
  - templates/phases/phase-do.md
  - templates/phases/phase-close.md
  - templates/phases/phase-close-worktree.md
  - templates/phases/phase-investigate.md
  - templates/phases/phase-materialize.md
  - templates/phases/phase-comment.md
  - templates/phases/phase-reject.md
  - templates/phases/phase-analyze.md
  - templates/phases/prompt.md
  - src/web/phase-prompt.test.mjs
lessons:
  - lesson-181
token_usage:
  input: 19206930
  output: 419917
  cache: 18141696
  total: 19626847
  requests: 201
  duration_ms: 1652026
  reasoning: 328612
  by_phase:
    code:
      input: 16163568
      output: 364807
      cache: 15385600
      requests: 149
    close:
      input: 3043362
      output: 55110
      cache: 2756096
      requests: 52
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст. `templates/phases/phase-spec.md` недавно сокращён примерно на 30% и стал эталоном: короткий «Порядок» (шаги 1–9), один блок «Критерий завершения шага» вместо разбросанных напоминаний, «Запреты» списком. Остальные шаблоны фаз не ревизовались и накопили дубли.

Замеренная картина (grep по `templates/phases/`):
- «Пакетное чтение: целевой файл читай одним read_file (чанки offset/limit подряд вместо grep-подстрок); точечные правки — после полного чтения; связанные проверочные команды — один вызов через &&» — дословно в 4 шаблонах: `phase-plan.md:85`, `phase-code.md:68`, `phase-do.md:53`, `phase-investigate.md:57`. Плюс та же мысль ещё раз в теле шага 2 `phase-plan.md` («сначала grep/glob … затем целевой файл — одним read_file … НЕ читай файлы целиком > 200 строк; один файл > 2 раз подряд — признак цикла») и в `phase-investigate.md` шаг 2 («не читай файлы целиком > 200 строк; найденный целевой файл — одним read_file чанками offset/limit подряд; повторные переборы тех же glob/grep-паттернов запрещены — один проход»).
- «никогда git add -A» — 5 вхождений: `phase-code.md:48`, `phase-do.md:39`, `phase-close.md:94`, `phase-close-worktree.md:26/96/102`.
- «README — витрина, не справочник» — 4 вхождения (`phase-code.md:82`, `phase-do.md:64`, `phase-close.md:99`, `phase-close-worktree.md:108`), причём в code/do версия длиннее (с перечислением doc-6/7/8/10/19), в close — короче.
- «НЕ читай один файл больше 2 раз — это цикл» (`phase-plan.md` Правила) дублирует «один файл > 2 раз подряд — признак цикла» из шага 2 того же файла.
- «Упоминания инцидентов и других задач — контекст, а не задание» — в `phase-plan.md` и `phase-code.md`.
- «Лимиты: --max-tool-calls считает tool-calls текущего рана…» — в `phase-plan.md` и `phase-code.md` дословно.

Проблема: явные указания «не вызывай инструмент несколько раз» повторены 2–3 раза в одном шаблоне и продублированы между шаблонами. Модель читает это как шум и перестаёт различать важное (наблюдение Pavel: после сокращения spec фаза стала вести себя лучше).

Вторая часть — реальная дыра, найденная при разборе вопроса про `read_many_files`: батчинг у нас уже есть на уровне протокола (модель может вернуть несколько `tool_call` в одном assistant-сообщении, `runLoop` исполняет их в цикле `for (const call of validCalls)`; в веб-чате лимит 16 на ход — `CHAT_MAX_TOOL_CALLS_DEFAULT`), но в промптах об этом НЕ сказано ни слова. Модель читает файлы последовательными ходами, хотя могла бы — одним. Отдельный инструмент `read_many_files` не нужен и вреден: единый кап `TOOL_OUTPUT_MAX_CHARS = 8 * 1024` (`src/agent/tools.ts:70`) дал бы 8 КБ на ВСЕ файлы вместо 8 КБ на каждый.

Цель: (1) привести шаблоны фаз к структуре phase-spec — одно правило в одном месте, без повторов; (2) добавить одно правило про параллельные вызовы инструментов в одном ходе; (3) закрепить результат тестами-инвариантами, чтобы дубли не наросли снова.

Границы: поведение фаз не меняется — только формулировки и структура. Никаких новых инструментов. `templates/agent-prompt.md` (системный промпт агента) — тоже в скоупе, если там есть те же дубли.

Входные данные: `templates/phases/phase-spec.md` (эталон), `templates/phases/{plan,code,do,close,close-worktree,investigate,materialize,comment,reject,analyze}.md`, `templates/agent-prompt.md`, `src/web/phase-prompt.test.mjs` (инварианты шаблонов), doc-10 §6.3 (пакетное чтение, VL-202).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Каждый шаблон фазы приведён к структуре phase-spec: короткий «Порядок», отдельный блок «Запреты», нет повторов одного правила в двух местах одного шаблона
- [x] #2 Устранены замеренные дубли: «Пакетное чтение…» (4→1 на шаблон), «никогда git add -A» (5→1 общая формулировка), «README — витрина» (4→1 общая), «НЕ читай один файл больше 2 раз» не дублирует шаг 2, «Упоминания инцидентов — контекст» и «Лимиты --max-tool-calls» не повторяются между plan и code
- [x] #3 Добавлено правило про параллельные вызовы инструментов в ОДНОМ ходе (несколько read_file/поисков независимых файлов — в одном assistant-сообщении, а не последовательными ходами); формулировка — одна, в agent-prompt + шаблонах фаз, где чтение уместно
- [x] #4 Суммарный объём шаблонов фаз уменьшен (зафиксировать до/после по строкам и символам в отчёте фазы); поведение фаз не изменилось — ни один шаг, запрет или обязательный вызов backlog_finish_phase не потерян
- [x] #5 Тест-инвариант в src/web/phase-prompt.test.mjs: каждый шаблон содержит обязательные маркеры шагов (finish_phase, отчёт, запреты) и НЕ содержит повторов ключевых правил (проверка «правило встречается не более N раз»); пустой/урезанный шаблон валит тест
- [x] #6 pnpm build и полный pnpm test зелёные; документация (doc-10 §6.3 — правило параллельного чтения вместо read_many_files, CHANGELOG)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-03 01:46
---
Фаза code не удалась (код выхода 1): ировок=0, payload последнего запроса=623635 байт (макс 623635), usage={"input_tokens":5980712,"output_tokens":171603,"cache_read_input_tokens":5709056,"total_tokens":6152315,"reasoning_tokens":135708} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-03 01:53
---
Фаза 3 (Code) выполнена. Коммит 7076263 «feat: VL-312 — ревизия шаблонов фаз: структура phase-spec, без дублей правил, правило параллельных вызовов».
**Изменено (13 шаблонов + тест):** templates/agent-prompt.md, templates/phases/{phase-plan,phase-code,phase-do,phase-close,phase-close-worktree,phase-investigate,phase-materialize,phase-comment,phase-reject,phase-analyze,prompt}.md, src/web/phase-prompt.test.mjs.
**AC1 — структура phase-spec.** Каждый шаблон приведён к виду: «Что делает фаза» → короткий «Порядок» (нумерованные шаги) → «Экономия ходов» → отдельный «Запреты» → «Финал». «## Запреты» теперь есть у всех 12 шаблонов (было у 8; comment/reject/analyze/prompt — добавлены, «Правила» в investigate/materialize слиты в «Запреты»). У phase-analyze ранее не было «Порядок» — добавлен.
**AC2 — замеренные дубли устранены, счётчики вхождений (после правки):**
- «Пакетное чтение» — 1 на шаблон (было 1 в тексте, но правило повторялось ещё раз в теле шага 2 phase-plan и шага 2 phase-investigate — эти вхождения удалены, осталось одно на шаблон);
- «git add -A» — 0 вхождений в фазах (было 5), канон — 1 раз в agent-prompt («массовый add… отклоняет инструмент коммита»);
- «README — витрина» — канон в agent-prompt (1), в close/close-worktree — короткие ссылки на канон (1 каждая), в code/do локальные копии удалены;
- «НЕ читай один файл больше 2 раз» — оставлено ровно одним буллетом в «Экономии ходов» phase-plan, дубль шага 2 («признак цикла») снят;
- «Упоминания инцидентов» — только в agent-prompt (в phase-plan/phase-code удалено);
- «--max-tool-calls…» — только в agent-prompt и prompt.md (в phase-plan/phase-code удалено).
**AC3 — правило параллельных вызовов.** Канон в templates/agent-prompt.md: «Независимые вызовы (несколько read_file, несколько поисков, несколько независимых shell-команд) собирай в ОДИН ход — несколькими tool_calls в одном assistant-сообщении: рантайм исполняет их по очереди за один ход модели». В шаблонах чтения (plan/code/do/investigate) — буллет «Параллельные вызовы» ровно по одному разу; в prompt.md — короткая формулировка.
**AC4 — объём (до/после, замер по git show HEAD:<file> против рабочего дерева):** 909 строк / 72 910 символов → 794 / 70 070, то есть **−115 строк, −2840 символов (−3.9 %)** на 13 файлах. Крупнее всего phase-plan.md: 103/6528 → 64/5218. Поведение фаз не изменилось: сверка diff по шагам — ни один шаг, запрет, аварийная ветка и обязательный вызов backlog_finish_phase не потеряны; маркеры, которые читают существующие тесты ({{producesStatus}}, «Только явные пути файлов задачи», «Никогда git add -A» заменено на «массовый add запрещён — правило в agent-prompt», «Не завершай цикл как успех», «не более одного раза за фазу», «его коммитит framework», «refs и lessons», «Не все дети закрыты», «сборка/тесты падают»), проверены точечно.
**AC5 — тест-инвариант** добавлен в src/web/phase-prompt.test.mjs: блок VL-312 (4 it). Карта REQUIRED_MARKERS по каждому из 12 шаблонов (длина > 400 символов, первая строка «Ты — », терминальный вывод, «## Порядок», «## Запреты» и профильные маркеры: backlog_finish_phase / backlog_add_comment / document_create / backlog_create_task / backlog_search / git restore / {{prompt}}); карта RULE_MAX_IN_PHASE («правило встречается не более N раз»: Пакетное чтение=1, Параллельные вызовы=1, README — витрина=1, Упоминания инцидентов=1, --max-tool-calls=1, git add -A=0); проверка, что каноны правил живут в agent-prompt. Пустой/урезанный шаблон валит первый it (проверено: файл без «Готово» даёт AssertionError).
**AC6 — частично.** pnpm build и полный pnpm test — зелёные (см. ниже). Документация (doc-10 §6.3 про параллельное чтение вместо read_many_files, CHANGELOG) НЕ обновлялась: по правилам фазы Code CHANGELOG.md и backlog/docs правит Фаза Close после слияния — оставляю AC6 незакрытым, пункт переходит в Close.
**Проверки:** `pnpm build` — OK; полный `pnpm test` — **147 файлов, 2756 тестов passed, 4 skipped, 0 failed** (полный прогон, без --exclude/--skip; все файлы включены). Ранний точечный прогон src/web/phase-prompt.test.mjs (88 тестов) и src/agent/session-summary.test.mjs — зелёные.
**Что осталось (для фазы Close):** обновить doc-10 §6.3 (параллельные чтения вместо read_many_files; батч tool_calls в одном ходе, лимит веб-чата 16 на ход) и CHANGELOG; в README ничего не добавлять — лимит 150 строк закреплён тестом readme-standard.
**Lessons:** создан lesson-181 (канон правила — в agent-prompt, в шаблонах ссылка, дубли ловятся тестом-счётчиком вхождений) и связан с задачей. DoD «Документация обновлена» не отмечаю — перенесено в Close вместе с AC6.
---
author: @agent
created: 2026-11-03 02:03
---
Фаза Close прервана: конфликт слияния vb/vl-312 → master.
Ветка vb/vl-312 содержит 1 коммит (7076263 «feat: VL-312 — ревизия шаблонов фаз: структура phase-spec, без дублей правил, правило параллельных вызовов»). Worktree .vibelog/worktrees/vl-312 чист (только untracked-симлинки node_modules и backlog/references/data). `git merge --no-ff` из главного репозитория остановился на конфликте; согласно правилам фазы конфликт НЕ разрешался и merge --abort НЕ делался — конфликтное состояние оставлено как есть.
Конфликтные файлы (from `git status --porcelain`, ветка master, merge в состоянии UU):
- templates/phases/phase-do.md (UU)
- templates/phases/phase-code.md (UU)
- templates/phases/phase-close.md (UU)
- templates/phases/phase-close-worktree.md (UU)
Авто-слитые без конфликта: templates/agent-prompt.md, src/web/phase-prompt.test.mjs, templates/phases/{phase-analyze,phase-comment,phase-investigate,phase-materialize,phase-plan,phase-reject,prompt}.md.
Шаги 6–10 не выполнялись: worktree и ветка не удалялись, DoD и статус не менялись, документация (CHANGELOG, doc-10 §6.3 — параллельное чтение вместо read_many_files) не правилась, отчёт не фиксировался как успех.
Что нужно сделать, чтобы повторить фазу Close: разрешить конфликты в четырёх файлах templates/phases/{phase-do,phase-code,phase-close,phase-close-worktree}.md в главном репозитории (учтя, что задача VL-312 как раз ревизует эти шаблоны — выигравшей должна быть версия из vb/vl-312, приведённая к структуре phase-spec, с каноном правил в agent-prompt), затем либо завершить начатый merge коммитом, либо `git merge --abort` и повторно слить vb/vl-312, после чего запустить Фазу Close заново новым раном.
---
author: @agent
created: 2026-11-03 02:03
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-312 → master.
Ветка vb/vl-312 содержит 1 коммит (7076263 «feat: VL-312 — ревизия шаблонов фаз: структура phase-spec, без дублей правил, правило параллельных вызовов»). Worktree .vibelog/worktrees/vl-312 чист (только untracked-симлинки node_modules и backlog/references/data). `git merge --no-ff` из главного репозитория остановился на конфликте; согласно правилам фазы конфликт НЕ разрешался и merge --abort НЕ делался — конфликтное состояние оставлено ка — статус возвращён к Review.
---
author: @agent
created: 2026-11-03 02:06
---
Фаза: авто-отчёт (comment не передан моделью)
Статус: Done
AC отмечено: 5 из 6
DoD отмечено: 2 из 3
AC не отмечены (1): 6. pnpm build и полный pnpm test зелёные; документация (doc-10 §6.3 — правило параллельного чтения вместо read_many_files, CHANGELOG)
DoD не отмечены (1): 2. Документация обновлена
Файлы (13): templates/agent-prompt.md, templates/phases/phase-plan.md, templates/phases/phase-code.md, templates/phases/phase-do.md, templates/phases/phase-close.md, templates/phases/phase-close-worktree.md, templates/phases/phase-investigate.md, templates/phases/phase-materialize.md, templates/phases/phase-comment.md, templates/phases/phase-reject.md, …
Фрагмент плана/резюме: план и резюме отсутствуют.
Отчёт собран сервером автоматически (VL-253): модель не передала comment.
Статус не изменён: терминальный «Done» при неотмеченных пунктах (DoD: #2; AC: #6) возможен только через backlog_finish_phase с dodOverride или aborted (VL-248/VL-309). Задача оставлена в «Review».
---
author: @agent
created: 2026-11-03 02:14
---
Фаза: авто-отчёт (comment не передан моделью)
Статус: Done
AC отмечено: 5 из 6
DoD отмечено: 2 из 3
AC не отмечены (1): 6. pnpm build и полный pnpm test зелёные; документация (doc-10 §6.3 — правило параллельного чтения вместо read_many_files, CHANGELOG)
DoD не отмечены (1): 2. Документация обновлена
Файлы (13): templates/agent-prompt.md, templates/phases/phase-plan.md, templates/phases/phase-code.md, templates/phases/phase-do.md, templates/phases/phase-close.md, templates/phases/phase-close-worktree.md, templates/phases/phase-investigate.md, templates/phases/phase-materialize.md, templates/phases/phase-comment.md, templates/phases/phase-reject.md, …
Фрагмент плана/резюме: план и резюме отсутствуют.
Отчёт собран сервером автоматически (VL-253): модель не передала comment.
Статус не изменён: терминальный «Done» при неотмеченных пунктах (DoD: #2; AC: #6) возможен только через backlog_finish_phase с dodOverride или aborted (VL-248/VL-309). Задача оставлена в «Review».
---
author: @agent
created: 2026-11-03 02:22
---
Фаза Close выполнена (повторный ран: merge уже был сделан предыдущим Close, который не завершил документацию и DoD).
**Состояние ветки.** Ветка `vb/vl-312` содержала 1 коммит (`7076263` «ревизия шаблонов фаз: структура phase-spec, без дублей правил, правило параллельных вызовов») и уже была слита в master merge-коммитом `898e61e` (merge: VL-312) от предыдущего Close-рана — `git merge-base --is-ancestor vb/vl-312 master` подтвердил. Конфликты, на которых упал предыдущий ран (phase-do/code/close/close-worktree.md), разрешены в том merge вручную; повторный merge не требовался, новый конфликт не возникал.
**Проверки после merge.** `pnpm build` — OK; полный `pnpm test` — **149 файлов, 2794 теста passed, 4 skipped, 0 failed** (полный прогон, без --exclude/--skip). Повторный прогон не выполнялся: первый был зелёным. Правки этой фазы — только документация (`CHANGELOG.md`, `backlog/docs/doc-10`); точечно проверены инвариант-тесты, читающие шаблоны/README: `src/web/phase-prompt.test.mjs` (91 тест) и `src/web/readme-standard.test.mjs` (3) — зелёные.
**Уборка.** `git worktree remove --force .vibelog/worktrees/vl-312` (в worktree оставались только untracked-симлинки node_modules/backlog-references-data), `git branch -d vb/vl-312` — ветка удалена (была слита). В `git worktree list` остались только чужие worktree.
**Документация (AC6/DoD2).** doc-10 §6.3 переписан: «Пакетное и параллельное чтение файлов (VL-202, уточнено VL-312)» — правило «независимые вызовы — в один ход» (несколько `tool_call` в одном assistant-сообщении, `runLoop` исполняет цикл `for (const call of validCalls)`, лимит веб-чата `CHAT_MAX_TOOL_CALLS_DEFAULT = 16`), и почему отдельный `read_many_files` не нужен и вреден (единый кап `TOOL_OUTPUT_MAX_CHARS = 8 * 1024` дал бы 8 КБ на все файлы вместо 8 КБ на каждый). CHANGELOG.md — запись VL-312 в Unreleased/Добавлено. Коммит `ceee3cc` «docs: VL-312 — документация и CHANGELOG»; урок — отдельным коммитом `beb5c6a` «docs(task): VL-312 — refs и lessons» (lesson-181, уже связан с задачей).
**Объём (из отчёта Code).** Шаблоны фаз: 909 строк / 72 910 символов → 794 / 70 070 — **−115 строк, −2840 символов (−3.9 %)** на 13 файлах; поведение фаз не изменилось, ни один шаг, запрет или обязательный вызов `backlog_finish_phase` не потерян. Механический сторож — блок VL-312 в `src/web/phase-prompt.test.mjs` (`REQUIRED_MARKERS`, `RULE_MAX_IN_PHASE`).
**Итог.** Все 6 AC выполнения достигнуты (AC6 закрыт этой фазой: build + полный test + документация); DoD закрыт полностью: «Тесты проходят» — да, «Документация обновлена» — да, «Нет регрессий» — да. Подзадач у задачи нет, чужие незакоммиченные файлы (VL-313, doc-24, ref-23/24) не трогались.
---
<!-- COMMENTS:END -->