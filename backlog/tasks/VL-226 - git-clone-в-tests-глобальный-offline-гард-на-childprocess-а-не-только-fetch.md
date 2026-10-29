---
id: VL-226
title: 'git clone в tests: глобальный offline-гард на child_process, а не только fetch'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-29 20:54'
updated_date: '2026-10-30 00:52'
due_date: ''
labels:
  - core
dependencies: []
milestone: ''
references: []
priority: medium
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/test-setup.mjs
  - src/core/no-network.test.mjs
lessons:
  - lesson-80
  - lesson-84
token_usage:
  input: 9104242
  output: 144020
  cache: 8244800
  total: 9248262
  requests: 165
  duration_ms: 3163543
  reasoning: 70003
  by_phase:
    spec:
      input: 45973
      output: 433
      cache: 22656
      requests: 2
    plan:
      input: 1303857
      output: 42430
      cache: 741312
      requests: 13
    code:
      input: 2897315
      output: 41562
      cache: 2779136
      requests: 61
    prompt:
      input: 4857097
      output: 59595
      cache: 4701696
      requests: 89
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Предложено в VL-224. fetch-guard VL-132 патчит только globalThis.fetch; spawnSync('git'/'npm') проходит мимо. Расширить src/test-setup.mjs (или общий хелпер тестов) гардом, который для spawn-команд с сетевыми протоколами (http://, https://, git@) в tests форсирует fail-fast (или подменяет env: GIT_ALLOW_PROTOCOL=file, http_proxy=127.0.0.1:9, GIT_TERMINAL_PROMPT=0) вместо многоминутного ожидания.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Тест, спавнящий git clone https://<внешний> (или fetch без fetchImpl), падает с ошибкой guard'а за секунды, а не таймаутится.
- [x] #2 src/core/no-network.test.mjs дополнен кейсом spawn-guard'а.
- [x] #3 Loopback/file://-клонирование в тестах продолжает работать.
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
created: 2026-10-29 21:31
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Тип: enhancement. Масштаб: task. Приоритет: Medium. Уточнено: AC переписаны в конкретные проверяемые формулировки (fail-fast за секунды, кейс в no-network.test.mjs, сохранение loopback/file://-клонирования); тип/приоритет/labels подтверждены. Labels: core. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-29 21:34
---
Фаза 2 (Plan) выполнена. Тип: enhancement. План записан: 3 файла (src/test-setup.mjs — spawn-guard через патч node:child_process createRequire-ом с маркером Symbol.for, детекция http(s)/git@ в args git + fail-fast throw [VL-226]; src/core/no-network.test.mjs — секция Spawn-guard: https-clone throw с замером <5с, git@-синтаксис, негативные кейсы git init/file:///loopback; CHANGELOG.md — запись в Unreleased/Исправлено). Решения: только throw (fail-fast) без env-подмены — GIT_ALLOW_PROTOCOL=http заблокировал бы loopback-мок-серверы, поэтому внешние URL реджектим до spawn; loopback/file://-клонирование сохраняется (AC-3). Риски: патч cp-модуля позиционируется до импортов dist (setupFiles первее), ложные срабатывания маловероядны (фикстуры file:// после VL-225), async-обёртки пробрасывают throw до вызова. Проверка: pnpm test + pnpm test:fast по no-network и reference.test.mjs. Ссылок нет. Вопросов нет.
---
author: @agent
created: 2026-10-29 21:39
---
Фаза code не удалась (код выхода 1):  фаза: запросов=4, payload последнего запроса=644142 байт (макс 644142), usage={"input_tokens":262987,"output_tokens":14526,"cache_read_input_tokens":128576,"total_tokens":277513,"reasoning_tokens":0} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-29 23:40
---
Фаза code не удалась (код выхода 1): апросов=60, payload последнего запроса=223204 байт (макс 223204), usage={"input_tokens":2819733,"output_tokens":41557,"cache_read_input_tokens":2702848,"total_tokens":2861290,"reasoning_tokens":30125} — статус возвращён к Planned.
---
author: @agent
created: 2026-10-29 23:47
---
Фаза 3 (Code) выполнена. Коммит 53452bf (2 файла: src/test-setup.mjs, src/core/no-network.test.mjs).
Что сделано:
- Spawn-guard в src/test-setup.mjs: патчит node:child_process (spawnSync, spawn, exec, execSync, execFile, execFileSync). Для команд git/npm/yarn/pnpm/bun с внешним http(s)-URL или scp-синтаксисом git@host:path — throw `[VL-226] … реальная сеть в тестах запрещена` ДО запуска процесса. Loopback (127.0.0.1/::1/localhost) и file:// проходят мимо. Guard идемпотентен (Symbol.for-маркер на модуле, не на функциях).
- Вместо env-подмены (GIT_ALLOW_PROTOCOL/http_proxy) выбран throw: тест сразу видит причину и стек вызова, а не «странную» сетевую ошибку через минуты.
- Особенности реализации, найденные по ходу: (1) первая версия обернула async-функции в `async` — spawn стал возвращать Promise и уронил 130 тестов web/agent/bot (`child.kill is not a function`); исправлено — обёртка всегда синхронная, throw вместо подмены типа возврата; (2) у exec/execSync первый аргумент — вся командная строка, поэтому имя команды берётся как первый токен, а URL ищется по всей строке; без этого `exec('git clone https://…')` проходил мимо guard'а.
- Тесты в src/core/no-network.test.mjs (+6 кейсов): fail-fast для `git clone https://…` за секунды (с замером <5000 мс), scp-синтаксис git@host:path, exec с командной строкой, loopback проходит мимо (не VL-226), file://-клон и локальный git init не затронуты, контракт async-API — spawn возвращает ChildProcess с .on/.kill/.pid.
Проверки: pnpm build (tsc) — без ошибок; полный npx vitest run — 85 файлов / 1537 passed, 4 skipped, 0 failed (два прогона; в первом был единственный флейк src/web/orchestrator.test.mjs «E2E: meta.json сессии», в изоляции 76/76 и в повторном полном прогоне зелёный — это существующая нестабильность, не связанная с задачей).
Примечание по процессу: рабочая копия дважды пострадала от общего на весь репозиторий git stash — stash pop одной сессии подхватил изменения другой (VL-230). Свои правки восстановлены `git checkout 4967d6a -- …`, чужие файлы (src/agent/llm.ts, loop.ts, loop.test.mjs) возвращены в исходное состояние, ничего не потеряно и не закоммичено.
Что осталось: документация (DoD-2) не обновлялась — по правилам фазы 3 CHANGELOG/docs пишет Фаза Close; spawn-guard описан в шапке src/test-setup.mjs. AC-2 «src/core/no-network.test.mjs дополнен кейсом spawn-guard'а» выполнен, AC-1 и AC-3 — тоже.
---
author: @agent
created: 2026-10-30 00:52
---
Фаза Close выполнена.

Ветка vb/vl-226 слита в master (1 коммит: 53452bf; merge 97282db, --no-ff, без конфликтов), worktree .vibelog/worktrees/vl-226 удалена (force — в ней были только untracked node_modules/backlog/references/data, кладутся оркестратором), ветка vb/vl-226 удалена (была 53452bf).

Проверки после merge: `pnpm build` — без ошибок. Первый полный `pnpm test` дал 24 падения в src/agent/llm.test.mjs — разобрано, это НЕ регрессия merge:
- с прежним (до merge, из 8f7c207) src/test-setup.mjs те же 24 падения в изоляции — от spawn-guard'а не зависит;
- причина — локальный gitignored `.vibelog/settings.json` (api_mode: "responses" у моделей): createLlmClient с дефолтным cwd выбирает /responses, а мок-тесты ждут /chat/completions;
- при временно убранном settings.json: полный прогон 86 файлов / 1578 passed, 4 skipped, 0 failed; сам файл llm.test.mjs — 52/52; src/core/no-network.test.mjs — 13/13 (включая 6 новых spawn-guard-кейсов).
Файл возвращён на место, в репозиторий не попал (.gitignore).

DoD: 1 (тесты проходят) — да; 2 (документация обновлена) — да, запись VL-226 в CHANGELOG.md [Unreleased] → Исправлено (коммит 5094213); отдельные доки в backlog/docs не правились — поведение тестовой обвязки там не описано, шапка src/test-setup.mjs уже содержит описание guard'а из Фазы 3; 3 (нет регрессий) — да. AC-1/AC-2/AC-3 подтверждены: fail-fast за секунды, no-network.test.mjs дополнен, loopback/file:// проходят.

Lessons: lesson-80 (обёртка child_process должна throw'ить, а не возвращать Promise — иначе spawn теряет ChildProcess) — уже была от Фазы Code, связана с задачей; lesson-84 (новая: при падениях llm.test.mjs проверяй локальный .vibelog/settings.json с api_mode=responses) — создана и связана. Коммит refs/lessons: ae1e712.

Примечание по процессу: локальный CLI-guard тестов не смог отличить окружение от кода — впредь при «чужих» падениях сначала проверять gitignored-конфиг.
---
<!-- COMMENTS:END -->