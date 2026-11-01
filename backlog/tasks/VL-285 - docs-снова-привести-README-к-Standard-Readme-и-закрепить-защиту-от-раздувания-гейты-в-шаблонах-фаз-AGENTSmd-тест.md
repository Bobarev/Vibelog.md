---
id: VL-285
title: 'docs: снова привести README к Standard Readme и закрепить защиту от раздувания (doc-переносы + гейты в шаблонах фаз + AGENTS.md + тест)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-01 22:00'
updated_date: '2026-11-02 00:23'
due_date: ''
labels: []
dependencies: []
milestone: v1.11
references: []
priority: medium
type: docs
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - README.md
  - AGENTS.md
  - templates/phases/phase-code.md
  - templates/phases/phase-do.md
  - templates/phases/phase-close.md
  - templates/phases/phase-close-worktree.md
  - src/web/readme-standard.test.mjs
lessons:
  - lesson-156
  - lesson-50
token_usage:
  input: 6421720
  output: 32831
  cache: 6104064
  total: 6454551
  requests: 113
  duration_ms: 1561133
  reasoning: 15697
  by_phase:
    code:
      input: 4917006
      output: 23641
      cache: 4696064
      requests: 71
    comment:
      input: 382549
      output: 2489
      cache: 352256
      requests: 13
    close:
      input: 1122165
      output: 6701
      cache: 1055744
      requests: 29
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
README снова раздулся после VL-193: было 78 строк (Standard Readme по ref-16), сейчас 1057 строк. Вернулась та же болезнь, но другими разделами.

## Контекст

VL-193 довёл README до Standard Readme и перенёс веб-интерфейс/MCP-таблицу/Workflow JSON/Telegram-бота/диагностику в doc-6/7/8. После этого в фазах задач в README стали дописываться новые технические разделы: в CHANGELOG у VL-284, VL-239, VL-248, VL-277, VL-242 в строке «Документация:» прямо указано «README (§…), doc-10» — фазы сознательно считали README местом детальной документации, потому что ни шаблоны, ни AGENTS.md этого не запрещали.

Текущая карта README (1057 строк):

- 1–54: H1/бейджи/Зачем/Prerequisites/Installation/Usage — норма, трогать не надо (Usage: 4-5 команд, ок)
- 55–158: «Лимиты агента (vibelog-agent)» — VL-223/229/274/284/261/258 → doc-10 §6, doc-19 §8
- 159–452: «Веб-чат (#/chat)» — VL-204/209/219/252/265/236 → doc-6 §10, doc-8
- 453–521: «Роли ассистента (chat_personas, VL-265)» → doc-19/doc-10
- 522–585: «Супервизор: запуск фаз из чата и grant (VL-268)» → doc-19 §5–7
- 586–741: «Супервизор: тик, лечение и планировщик (VL-270)» → doc-19 §8–12
- 742–916: «Учёт токенов (billing)» — VL-242/277 → doc-7/doc-10
- 917–1005: «Модели и провайдеры (VL-209)» + «Модель фиксируется на сессии (VL-239)» → doc-10 §2, doc-7
- 1006–1029: «/auto — автоочередь фаз» (failed_permanent) → doc-6 §11
- 1030–1057: Документация / Contributing / Совместимость / Лицензия — норма (таблицу ссылок дополнить doc-19)

## Цель

1. README снова ≤150 строк по Standard Readme (ref-16), детали — в doc-*.
2. Чтобы раздувание не повторилось: гейты в шаблонах фаз и AGENTS.md + автоматический инвариант-тест.

## План

### Шаг 1 — Перенос ДО перезаписи (lesson-50)
Сначала досдать переносимое в doc-*, только потом резать README:
- doc-10: лимиты агента (VL-284 write-порог/эскалация, idle-watchdog VL-274, session summary/outline, resume-хэш), модели и провайдеры (VL-209/239).
- doc-19: веб-чат (инструменты/полICY read-write, fields-отбор), chat_personas, grant, тик/лечение/планировщик, billing-учёт в тике.
- doc-6: раздел /auto (failed_permanent, реанимация, миграция), ссылка на веб-чат.
- doc-7: billing (учёт токенов, token_usage, коммит после close).
- doc-8: инструменты чата (trigger_phase, phase_status, supervisor, auto_queue) — если они там есть не полностью.
Проверить маркерами (document_search) что переносимое действительно есть в doc-*, затем удалять из README.

### Шаг 2 — Перезапись README (≤150 строк)
H1 + одно предложение, badges, Prerequisites, Installation, Usage (4 команды), таблица ссылок (doc-6/7/8/9/10/19 + MCP-SETUP), Contributing, Совместимость с Backlog.md, Лицензия. Таблицу ссылок дополнить doc-19.

### Шаг 3 — Гейты против повторного раздувания
- `templates/phases/phase-close.md` + `phase-close-worktree.md` + `phase-code.md` + `phase-do.md`: явное правило «README.md не расширять: новая техническая деталь → backlog/docs/doc-*; в README допустима только правка существующей строки/ссылки; рост README > 150 строк — не делать, переносить в doc-*».
- `AGENTS.md`: короткий раздел «README — витрина, не справочник»: зафиксированная структура, лимит 150 строк, правило «детали в doc-*».
- Инвариант-тест по образцу `src/web/phase-prompt.test.mjs`: README ≤150 строк и H2 только из белого списка (Зачем, Prerequisites, Installation, Usage, Документация, Contributing, Совместимость с Backlog.md, Лицензия) — падение в `pnpm test`.

### Шаг 4 — Lesson
Новый lesson: «README — витрина: детали пиши в doc-*, лимит закреплён тестом» (lesson-50 говорит про порядок переноса, но не про защиту от повторного раздувания). Указать source VL-193, VL-285.

## Входные данные из диалога
Пользователь: «Была выполнена в своё время задача VL-193, которая приводила README в правильный вид... Но после этого в процессе решения задач README снова раздулся. Нужно снова привести README к правильному виду и посмотреть чтобы в будущем только правильные правки были.»
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 README ≤ 150 строк по Standard Readme: H1 + одно предложение, badges, Prerequisites, Installation, Usage (3-4 команды), таблица ссылок на doc-*, Contributing, Совместимость с Backlog.md, Лицензия
- [x] #2 Перенос содержимого ДО перезаписи: лимиты агента и модели/провайдеры → doc-10, веб-чат/chat_personas/grant/тик-лечение → doc-19, /auto → doc-6, billing → doc-7, инструменты чата → doc-8; проверено поиском по маркерам, что переносимое есть в doc-*
- [x] #3 Удалённые из README разделы не потеряны: каждый раздел имеет адрес в doc-* (проверка через document_search по ключевым маркерам)
- [x] #4 Гейт в шаблонах фаз: phase-close.md, phase-close-worktree.md, phase-code.md, phase-do.md содержат запрет расширять README (детали — в backlog/docs/doc-*)
- [x] #5 AGENTS.md: раздел «README — витрина, не справочник» с зафиксированной структурой, лимитом 150 строк и правилом переноса деталей в doc-*
- [x] #6 Инвариант-тест: README ≤150 строк и H2 только из белого списка — падает при раздувании, проходит на текущем README; полный pnpm test зелёный
- [x] #7 Новый lesson «README — витрина: детали в doc-*, лимит закреплён тестом» создан и связан с VL-193 и VL-285
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
created: 2026-11-01 22:46
---
Фаза 3 (Code) выполнена. Изменено: README.md (1057 → 76 строк), AGENTS.md (новый раздел «README — витрина, не справочник»), templates/phases/{phase-code,phase-do,phase-close,phase-close-worktree}.md (гейт против расширения README), новый src/web/readme-standard.test.mjs. Коммит ea2f6ad.
Шаг 1 — перенос ДО перезаписи (lesson-50): проверено grep по маркерам в backlog/docs, что всё переносимое уже есть там: лимиты агента/idle-watchdog/session summary/outline/resume-хэш/guard повторов и эскалация до блокировки — doc-10 §3.4/3.5/6/6.6/6.7; модели и провайдеры VL-209/239, api_mode responses — doc-6 §8 «Модели и провайдеры LLM» + doc-7 (`vibelog model|provider`, `--api-mode`) + doc-10 (мета сессии model_id/api_mode); веб-чат (инструменты, read/write-политика и isWriteOperation, отбор fields) — doc-8 (isWriteOperation, «Отбор полей», «инструменты модели») + doc-6 §10; chat_personas, grant, тик/лечение/планировщик, self-tuning, параллельность — doc-19 §1–17; /auto и failed_permanent/реанимация/миграция — doc-6 §11 + doc-8 backlog_auto_queue; billing/token_usage/дельтами/startedAt — doc-10 §3.3 + doc-8 (backlog_finish_phase, aborted, dodOverride, VL-243/245/248/251/259). Ничего не потеряно: каждый удалённый раздел имеет адрес в doc-*.
Шаг 2 — README перезаписан: H1 + один абзац, badges, Зачем, Prerequisites, Installation, Usage (3 команды в одном блоке), таблица «Документация» (doc-6/7/8/9/10/19 + MCP-SETUP), Contributing, Совместимость с Backlog.md, Лицензия. 76 строк.
Шаг 3 — гейт: в четырёх шаблонах фаз пункт «README — витрина, не справочник» (в README допустима только правка существующей строки/ссылки, детали → doc-*); в AGENTS.md раздел с зафиксированной структурой H2, лимитом 150 строк и картой «что куда»; инвариант-тест src/web/readme-standard.test.mjs (длина ≤150, H2 из белого списка и в порядке, H1 первым) — падает при раздувании, проходит сейчас.
Шаг 4 — lesson-156 «README — витрина: технические детали пиши в doc-*, лимит 150 строк закрепляй инвариант-тестом» создан, sourceTasks VL-193+VL-285, связан с VL-285; в задаче lessons = [lesson-156, lesson-50].
Проверки: `pnpm test` (build + полный Vitest) — зелёный: 129 test-файлов, 2408 passed, 5 skipped, 0 failed. Промежуточные прогоны в worktree давали транзиентные падения chat-limits/orchestrator/supervisor-tools — классифицированы: в этот момент в другом worktree (vl-286) шёл параллельный vitest; все три файла по отдельности и финальный полный прогон проходят. Из-за ограничений тестов фаз пришлось убрать из шаблонов внутренние ID задач VL-* и слово pnpm (инварианты VL-157/VL-105 phase-prompt.test.mjs) — правило переформулировано без них.
Осталось (для Фазы Close): в doc-10 §3.2 и doc-19 §8 есть circular-ссылки на уже несуществующие разделы README («см. README, раздел "Системная инструкция"», «Задокументировано в README и в подсказке /set») — поправить в Close вместе с CHANGELOG (в Code фазу backlog/docs не правится). Один невыполненный нюанс плана: правки doc-* (Шаг 1) не понадобились — переносимое уже было на месте.
---
author: Pavel Bobarev
created: 2026-11-01 22:48
---
Фаза close — только финальная верификация docs-задачи, без тяжёлых операций. Не запускай полный pnpm test и не перечитывай весь репозиторий/README целиком: проверь ровно критерии приёмки (README уложен в границы Standard Readme по ref-16; гейты раздувания добавлены в шаблоны фаз; doc-переносы веб/MCP/JSON/Telegram/диагностики сохранены; правки AGENTS.md; есть тест-страж). Используй уже полученные ранее результаты из кэша, не повторяй run_shell_command вида ps aux/cd backlog/docs. Держи payload запроса минимальным (текущий уже на максимуме 374459/374459 — следующий упадёт по max-payload). Заверши фазу, как только чеклист подтверждён.
---
author: @agent
created: 2026-11-01 22:49
---
Фаза Comment выполнена: финальная верификация критериев приёмки — чеклист подтверждён, тяжёлых операций не выполнялось (полного `pnpm test` и перечитывания README/репозитория не было).
Проверки (лёгкие, точечные):
1. **README в границах Standard Readme (ref-16)** — `wc -l README.md` = **76 строк** (лимит 150). H2 = ровно белый список: Зачем (11), Prerequisites (20), Installation (25), Usage (35), Документация (49), Contributing (61), Совместимость с Backlog.md (70), Лицензия (74). AC-1 ✓
2. **Гейты раздувания в шаблонах фаз** — правило «README — витрина, не справочник» присутствует: `templates/phases/phase-code.md:83`, `phase-do.md:64`, `phase-close.md:99`, `phase-close-worktree.md:108` (лимит 150 строк + белый список H2 + «детали в backlog/docs/doc-*», в README допустима только правка существующей строки/ссылки). AC-4 ✓
3. **AGENTS.md** — раздел «README — витрина, не справочник» на строке 90. AC-5 ✓
4. **Тест-страж** — `src/web/readme-standard.test.mjs` существует (4256 байт), прогон `npx vitest run src/web/readme-standard.test.mjs` → 3 tests passed, зелёный; тест одновременно проверяет и текущий README (≤150 строк, белый список H2), т.е. не падает на актуальном состоянии. AC-6 ✓
5. **Doc-переносы сохранены** — маркерный `document_search` подтверждает адреса разделов: `failed_permanent`/автоочередь → doc-6 (+ упоминания doc-19, doc-8); `chat_personas`, grant, тик/лечение → doc-19; веб-чат/инструменты чата → doc-6/doc-8/doc-10; `token_usage` (биллинг) и `write-порог` (лимиты агента, VL-284) → doc-10/doc-7. Ни один удалённый раздел не остался без адреса. AC-2, AC-3 ✓
6. **Ссылки в README** — таблица «Документация» содержит doc-6/7/8/9/10/**19** и MCP-SETUP.md (doc-19 добавлен). AC-1 ✓
7. **Lesson** — AC-7 закрыт в фазе code (lesson создан и связан с VL-193/VL-285), здесь не перепроверялся (файлы backlog/lesson живут в основном репозитории, not worktree).
Итог: все 7 AC и 3 DoD подтверждены точечной верификацией, регрессий не обнаружено. Статус не меняю — в запросе указана только финальная верификация фазы, без просьбы сменить статус.
---
author: @agent
created: 2026-11-01 22:56
---
Фаза Close прервана: конфликт слияния vb/vl-285 → master (файлы: UU README.md). Merge остановлен на контентном конфликте README.md (git merge --no-ff vb/vl-285: «Auto-merging README.md / CONFLICT (content)»; AGENTS.md слился автоматически). Конфликт не резолвил и merge --abort не делал — файл оставлен в состоянии UU для ручного разбора. Прочие шаги (тесты, DoD, статус, worktree/branch, docs-коммиты) не выполнялись: worktree .vibelog/worktrees/vl-285 и ветка vb/vl-285 сохранены, задача остаётся в статусе Review. Разреши конфликт README.md вручную (ветка несёт 76-строчный README по Standard Readme, master за это время получил правки README от VL-286 и соседних задач) и повтори Фазу Close.
---
author: @agent
created: 2026-11-01 22:56
---
Фаза close прервана агентом (aborted): Фаза Close прервана: конфликт слияния vb/vl-285 → master (файлы: UU README.md). Merge остановлен на контентном конфликте README.md (git merge --no-ff vb/vl-285: «Auto-merging README.md / CONFLICT (content)»; AGENTS.md слился автоматически). Конфликт не резолвил и merge --abort не делал — файл оставлен в состоянии UU для ручного разбора. Прочие шаги (тесты, DoD, статус, worktree/branch, docs-коммиты) не выполнялись: worktree .vibelog/worktrees/vl-285 и ветка vb/vl-285 сохранены, задача остаётся в — статус возвращён к Review.
---
author: @agent
created: 2026-11-02 00:05
---
Фаза Close выполнена. Ветка vb/vl-285 слита в master (merge-коммит 50461e4 + docs-коммит 79d0fb8 — резолв конфликта README был выполнен до этого рана), worktree .vibelog/worktrees/vl-285 удалена, ветка vb/vl-285 удалена.
Проверки: сборка `pnpm build` — зелёная; ранний точечный фильтр по diff'у merge (src/web/readme-standard.test.mjs + src/web/phase-prompt.test.mjs, следящий за templates/ и AGENTS.md) — 81 passed; полный `pnpm test` — 129 файлов, 2406 passed, 4 skipped, без падений. Сборка за фазу один раз.
Коммиты этой фазы: 6775eb4 «docs(task): VL-285 — refs и lessons» (lesson-156, созданный в Code), db5a1cf «docs: VL-285 — документация и CHANGELOG» (запись Unreleased в CHANGELOG.md). README в этой фазе не расширялся: 77 строк, инвариант-тест проходит.
DoD: все три пункта (тесты проходят, документация обновлена, нет регрессий) выполнены.
---
<!-- COMMENTS:END -->