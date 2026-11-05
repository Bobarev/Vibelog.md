---
id: VL-340
title: 'doctor: проверять инварианты MCP-реестра вместо хардкода числа инструментов + проверки git-политики .vibelog/'
status: In Progress
assignee: []
reporter: ''
created_date: '2026-11-05 13:20'
updated_date: '2026-11-05 15:37'
due_date: ''
labels:
  - doctor
  - mcp
  - infra
  - repo-hygiene
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
  - src/cli/commands/doctor.ts
  - src/cli/diagnostics.test.mjs
  - MCP-SETUP.md
lessons: []
token_usage:
  input: 3017776
  output: 29806
  cache: 2942976
  total: 3047582
  requests: 64
  duration_ms: 938662
  reasoning: 16236
  by_phase:
    code:
      input: 3017776
      output: 29806
      cache: 2942976
      requests: 64
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Инженерное улучшение из doc-22 §1.2 + ROADMAP «Переносимый `.vibelog/` + `vibelog doctor`». Не пересекается с кодом doc-25 (`install`/`create`/реестр/`installed.lock.json` не трогаются), поэтому может уехать в релиз вместе с задачами doc-25.

**Проблема 1 — хардкод числа инструментов.** `src/cli/commands/doctor.ts` содержит `const expected = 45;` (строка ~248) и рядом полный массив из 45 имён в рантайм-проверке `checkMcpToolsList()`. Каждый новый MCP-инструмент требует правки `doctor.ts` и падающего теста (`src/cli/diagnostics.test.mjs:143` жёстко ждёт `45`). В CHANGELOG это повторялось: 36→37→38→42→43→44→45. Проверка не ловит реальные дефекты (дубли имён, инструмент без схемы), а только «список не тот, что вчера».

**Проблема 2 — нет проверок git-политики `.vibelog/`.** Сам `.vibelog/.gitignore` создан в VL-329, но `doctor` его не проверяет: регресс (вернуть `.vibelog/` в корневой `.gitignore`, уронить `!settings.json`) обнаружится только когда в git уедут сессии или ключи.

**Цель:** заменить проверку числа на проверку инвариантов реестра и добавить пять проверок git-политики `.vibelog/` — всё в одном файле кода, без новых CLI-команд и без правки `router.ts`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `doctor` больше не содержит хардкода числа MCP-инструментов (`const expected = 45` удалён) и полного массива имён в рантайме
- [x] #2 Проверка `mcp_tools_invariants` валидирует: реестр непуст, нет дублей имён, все имена с известными префиксами, у каждого инструмента есть `inputSchema` типа object
- [x] #3 Ожидаемый список имён MCP-инструментов перенесён из `doctor.ts` в тест `src/cli/diagnostics.test.mjs`
- [x] #4 Добавлены проверки git-политики `.vibelog/`: наличие `.vibelog/.gitignore`, `settings.json` не игнорируется, `billing/` не игнорируется, `.env` игнорируется, `.vibelog/` не игнорируется корневым `.gitignore`
- [x] #5 Проверки git-политики используют `git check-ignore` (не парсинг `.gitignore` регулярками) и не падают вне git-репозитория
- [x] #6 Тесты: инварианты ловят дубль имени; отсутствие `.vibelog/.gitignore` даёт не-ok; вне git-репозитория проверки не падают; фикстуры на mkdtemp
- [ ] #7 MCP-SETUP.md актуализирован (число инструментов и таблица), doc-7 дополнен разделом `doctor`
- [ ] #8 CHANGELOG.md обновлён (включая пометку об изменении JSON-схемы `doctor --json`)
- [x] #9 `pnpm build && pnpm test` зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

- `src/cli/commands/doctor.ts` — единственный файл кода.
- `src/cli/diagnostics.test.mjs` — тест (сейчас жёстко `assert.equal(mcpCheck.value, 45)`).
- `MCP-SETUP.md` — попутно актуализировать таблицу (29 → фактическое число) и убрать хардкод числа из текста.
- `doc-7` (CLI-справочник) — раздел `doctor`: описать новые проверки.

## Шаг 1. Инварианты вместо числа

`checkMcpToolsCount()` (строка ~248, `const expected = 45`) заменить на `checkMcpToolsInvariants()`:

1. реестр непуст (`tools.length > 0`);
2. нет дублей имён (`new Set(names).size === names.length`);
3. каждое имя соответствует известному префиксу: `backlog_`, `milestone_`, `reference_`, `document_`, `lesson_`, `project_map`, `git_commit` — список префиксов вынести в константу модуля;
4. у каждого инструмента есть `inputSchema` (объект, `type: 'object'`).

`checkMcpToolsList()` (полный массив 45 имён в рантайме) удалить: ожидаемый список имён переезжает в `src/cli/diagnostics.test.mjs` как фикстура теста. В `requiredNames` заменить `mcp_tools_count`/`mcp_tools_list` на `mcp_tools_invariants`.

## Шаг 2. Проверки git-политики `.vibelog/` (ROADMAP «Переносимый .vibelog/»)

Новые проверки в том же массиве `checks`, все — предупреждающие (не влияют на exit code, кроме отсутствия `.vibelog/.gitignore` при существующем `.vibelog/`):

- `vibelog_gitignore` — `.vibelog/.gitignore` существует;
- `vibelog_settings_tracked` — `settings.json` НЕ игнорируется (`git check-ignore -q .vibelog/settings.json` → код 1);
- `vibelog_billing_tracked` — `billing/` НЕ игнорируется;
- `env_ignored` — `.env` в корне игнорируется (`git check-ignore -q .env` → код 0);
- `vibelog_root_ignored` — `.vibelog/` НЕ игнорируется корневым `.gitignore` (регресс VL-329).

Реализация: `spawnSync('git', ['check-ignore', '-q', '--', path], { cwd })`, код возврата 0 = игнорируется, 1 = нет, 128 = не git-репозиторий → проверка `ok: true` с `value: 'не git-репозиторий'` (не ломать doctor вне git). Никаких чтений `.gitignore` регулярками — только git.

## Шаг 3. Тесты

`src/cli/diagnostics.test.mjs`:
- убрать `assert.equal(mcpCheck.value, 45)`, заменить на проверку `mcp_tools_invariants.ok === true`;
- добавить кейс «дубль имени в реестре → проверка падает» (мок `listTools` либо прямой вызов экспортированной функции инвариантов — предпочтительно экспортировать `checkMcpToolsInvariants` для юнит-теста);
- кейс «нет `.vibelog/.gitignore` → проверка не ok» на mkdtemp-фикстуре (lesson-104: не полагаться на живой репозиторий);
- кейс «вне git-репозитория проверки git-политики не падают».

## Шаг 4. Проверка

`pnpm build && pnpm test`; вручную `node bin/vibelog.mjs doctor --json` — все проверки ok, `mcp_tools_invariants.ok: true`.

## Риски

- `git check-ignore` в worktree задачи смотрит на `.gitignore` worktree, а не главного репозитория — тесты гонять на mkdtemp-фикстуре с собственным `git init` (lesson-104).
- Удаление `checkMcpToolsList` меняет JSON-схему вывода `doctor --json` (поле `mcp_tools_list` исчезает) — это осознанно, но упомянуть в CHANGELOG.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-05 13:34
---
Фаза code не удалась (код выхода 1): окировок=0, payload последнего запроса=257994 байт (макс 257994), usage={"input_tokens":2518995,"output_tokens":26120,"cache_read_input_tokens":2466816,"total_tokens":2545115,"reasoning_tokens":14666} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-05 15:15
---
Фаза 3 (Code) выполнена. Коммит 03851e5.
Изменено:
- `src/cli/commands/doctor.ts` — `checkMcpToolsCount()` (`const expected = 45`) и `checkMcpToolsList()` (полный массив 45 имён в рантайме) удалены. Вместо них экспортируемая `checkMcpToolsInvariants(tools = listTools())`: реестр непуст, нет дублей имён, все имена соответствуют политике префиксов (`MCP_TOOL_PREFIXES` — константа модуля: backlog_/milestone_/reference_/document_/lesson_/project_map/git_commit), у каждого инструмента `inputSchema` — объект с `type: 'object'`. В `requiredNames` вместо `mcp_tools_count`/`mcp_tools_list` теперь `mcp_tools_invariants`.
- Добавлены пять проверок git-политики `.vibelog/` (`checkGitPolicy`): `vibelog_gitignore` (единственная обязательная — при существующем `.vibelog/` в git-репозитории), `vibelog_settings_tracked`, `vibelog_billing_tracked`, `env_ignored`, `vibelog_root_ignored`. Все — через `spawnSync('git', ['check-ignore','-q','--',path])`, без парсинга `.gitignore` регулярками; код 128/ошибка git → `ok: true` со значением «не git-репозиторий».
- `src/cli/diagnostics.test.mjs` — `assert.equal(mcpCheck.value, 45)` убран; ожидаемый перечень имён переехал в фикстуру `EXPECTED_MCP_TOOLS` (проверка «инструмент не пропал»); юнит-кейсы на дубль имени, пустой реестр, чужой префикс, отсутствие/не-object `inputSchema`; кейсы git-политики на mkdtemp-фикстурах с собственным `git init` (lesson-104): нет `.vibelog/.gitignore` → не ok, есть → ok, вне git → не падает, регресс `.vibelog/` в корневом `.gitignore` → `vibelog_root_ignored` не ok.
- `MCP-SETUP.md` — таблица дополнена до фактического состава, хардкод числа («Всего 29 инструментов») убран, добавлено пояснение про `mcp_tools_invariants`.
Проверки: `pnpm build` — ok; полный `pnpm test` — 178 файлов / 3400 тестов passed, 4 skipped (пропуски — штатные `it.skip` в существующих файлах, не связаны с задачей); `node bin/vibelog.mjs doctor --json` — `ok: true`, `mcp_tools_invariants.ok: true` (count 45, problems []), все пять git-проверок ok.
Что осталось (по правилам фазы — пишет Close): AC7 в части doc-7 (раздел `doctor` с новыми проверками) и AC8 (CHANGELOG.md, включая пометку об изменении JSON-схемы `doctor --json`: поле `mcp_tools_list` исчезло, `mcp_tools_count` заменено на `mcp_tools_invariants`). Поэтому AC7, AC8 и DoD «Документация обновлена» не отмечены.
---
<!-- COMMENTS:END -->