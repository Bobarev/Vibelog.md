---
id: VL-117
title: 'Промпт vb: backlog (задачи/документы) правится только через MCP, не edit/write в worktree-копию'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-12 14:47'
updated_date: '2026-10-12 21:54'
due_date: ''
labels: []
dependencies: []
milestone: v1.7
references: []
priority: medium
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - templates/agent-prompt.md
  - src/agent/system-prompt.test.mjs
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Инцидент VL-113 2026-10-12: агент обновлял backlog/docs/doc-10 через edit-инструмент, который резолвит пути от cwd = worktree — правка легла в worktree-КОПИЮ backlog (git status worktree: M backlog/docs/doc-10). Агент сам заметил дилемму («куда попала правка doc-10 — worktree vs основной репо»), потратил ~5 ходов на выяснение, но обхода не нашёл: правка останется в worktree и потеряется при worktree remove, а MCP-инструменты пишут backlog в ГЛАВНЫЙ репо через VIBELOG_CWD. Рабочий путь обновления backlog-документов — MCP document_update; рабочий путь задач — backlog_update_task и т.п.

Фикс — промптовый: явное правило в templates/agent-prompt.md (базовая часть системного промпта vb, читается из md после VL-109). Альтернатива (вне рамок задачи): guard в tools.ts, запрещающий edit/write в backlog/ при установленном VIBELOG_CWD.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 templates/agent-prompt.md: правило «файлы backlog/ (задачи, документы, конфиги) правь ТОЛЬКО через MCP-инструменты Vibelog; edit/write_file в backlog-копию не использовать — правка попадает не в то хранилище и теряется при worktree remove»
- [x] #2 src/agent/system-prompt.test.mjs: тест проверяет наличие правила в собранном системном промпте
- [x] #3 pnpm test зелёный
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Контекст

Инцидент VL-113: агент в worktree правил backlog/docs/doc-10 через edit-инструмент; пути резолвятся от cwd = worktree, поэтому правка легла в worktree-КОПИЮ backlog и потерялась бы при worktree remove. MCP-инструменты пишут backlog в ГЛАВНЫЙ репо (через VIBELOG_CWD, см. src/cli/commands/mcp.ts:28-32). Фикс промптовый: правило в templates/agent-prompt.md (базовая часть системного промпта, собирается src/agent/system-prompt.ts:47-76, читается без пересборки кода).

Дополнительно (комментарий Pavel 2026-10-12 18:53): шаблон используется и в других проектах — убрать из него все упоминания VL-N.

## Файлы для изменения (оба существуют, проверено)

1. `templates/agent-prompt.md` (13 строк)
2. `src/agent/system-prompt.test.mjs` (80 строк)

## Шаг 1 — templates/agent-prompt.md: правило «backlog только через MCP»

Вставить новый пункт в список «Правила:» после строки 8 («- Не выполняй push и другие необратимые действия...»):

```
- Файлы backlog/ (задачи, документы, конфиги) правь ТОЛЬКО через MCP-инструменты Vibelog (backlog_update_task, document_update и т.п.); edit/write_file в worktree-копию backlog не использовать — правка попадает не в то хранилище (worktree-копия вместо главного репозитория) и теряется при worktree remove.
```

## Шаг 2 — templates/agent-prompt.md: убрать упоминания VL-N

Промпт通用 для других проектов — ID задач Vibelog в нём не нужны. Удалить только скобки с ID, тексты правил сохранить (на них завязаны существующие тесты):

- строка 10: удалить ` (VL-109)` в конце (правило «одна команда grep» — текст остаётся, тест system-prompt.test.mjs:71 матчит `/одна команда grep/`);
- строка 11: удалить ` (VL-109)` (тест матчит `/git status и git diff/`);
- строка 12: удалить ` (VL-109)` (тест матчит `/BSD/`);
- строка 13: удалить ` (VL-115)` (тест матчит `/Не выводи env целиком/`).

После правки: `grep -n 'VL-' templates/agent-prompt.md` — пусто.

## Шаг 3 — src/agent/system-prompt.test.mjs: два новых теста

Добавить в конец describe-блока (после теста «VL-109: базовая часть читается...», строки 68-79) два it-блока:

```js
it('VL-117: backlog правится только через MCP — правило в базовой части промпта', () => {
  withTmpCwd((dir) => {
    const { content } = buildSystemPrompt(dir);
    assert.match(content, /backlog\//, 'правило про файлы backlog/');
    assert.match(content, /MCP-инструмент/, 'указание править через MCP-инструменты');
    assert.match(content, /worktree/, 'предупреждение про потерю в worktree-копии');
  });
});

it('VL-117: в базовой части нет упоминаний VL-N (шаблон通用 для других проектов)', () => {
  withTmpCwd((dir) => {
    const { content } = buildSystemPrompt(dir);
    assert.ok(!/VL-\d+/.test(content), 'базовая часть промпта не должна содержать ID задач Vibelog');
  });
});
```

Второй тест закрепляет комментарий Pavel и не пустит VL-N обратно. cwd в тестах — tmp без AGENTS.md, поэтому content = только базовая часть, проверка чистая.

## Порядок действий

1. Edit templates/agent-prompt.md: вставить пункт (шаг 1) и вычистить VL-N (шаг 2).
2. Edit src/agent/system-prompt.test.mjs: добавить два теста (шаг 3).
3. Проверки (см. ниже).
4. Коммит в ветку vb/vl-117: `feat(prompt): правило backlog только через MCP и уборка VL-N из agent-prompt.md`.

## Как проверить

```bash
pnpm build                                        # tsc → dist/ (тесты импортируют dist/)
node --test src/agent/system-prompt.test.mjs      # целевые тесты
pnpm test                                          # полный прогон (build + node --test src)
grep -n 'VL-' templates/agent-prompt.md           # ожидаемо пусто
```

## Риски

- Существующие тесты system-prompt.test.mjs завязаны на тексты правил (строки 71-74) — удаляются только скобки «(VL-109)/(VL-115)», сами правила не переписываются → тесты зелёные.
- Новый пункт списка правил не ломает детерминированную сборку («повторная сборка даёт тот же текст», строка 77) — readFileSync стабилен.
- templates/ едет в npm-пакет (package.json files) — правка доступна установленному пакету без пересборки кода.
- Альтернатива guard в src/agent/tools.ts (запрет edit/write в backlog/ при VIBELOG_CWD) — вне рамок этой задачи; если понадобится — отдельная задача.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: Pavel Bobarev
created: 2026-10-12 18:53
---
А так же в agent-prompt.md необходимо убрать упоминание всех VL-N задач, так как не только в этом проекте этот промпт используется.
---
author: @agent
created: 2026-10-12 18:55
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу: 2 файла (templates/agent-prompt.md, src/agent/system-prompt.test.mjs). Суть: (1) новый пункт правила «файлы backlog/ править ТОЛЬКО через MCP-инструменты, не edit/write в worktree-копию — правка попадает не в то хранилище и теряется при worktree remove»; (2) убрать все упоминания VL-N из шаблона (скобки «(VL-109)/(VL-115)» на строках 10-13 — тексты правил сохранить, чтобы не ломать существующие тесты); (3) два новых теста в system-prompt.test.mjs — наличие правила и отсутствие VL-N в собранном промпте. Риски: минимальны — правки только текстовые, шаблон едет с пакетом; существующие тесты матчат тексты правил, а не скобки с ID. Дополнение по комментарию Pavel: уборка VL-N включена в этот же план и закреплена тестом.
---
author: @agent
created: 2026-10-12 19:15
---
Фаза 3 (Code) выполнена. Изменено: templates/agent-prompt.md, src/agent/system-prompt.test.mjs.
**Что сделано (по Implementation Plan):**
1. `templates/agent-prompt.md` — новый пункт правила после «Не выполняй push…»: файлы backlog/ (задачи, документы, конфиги) править ТОЛЬКО через MCP-инструменты Vibelog; edit/write_file в worktree-копию backlog не использовать — правка попадает не в то хранилище и теряется при worktree remove.
2. `templates/agent-prompt.md` — убраны все упоминания VL-N (скобки «(VL-109)» ×3 и «(VL-115)» на правилах экономии ходов и env); тексты правил сохранены. `grep -n 'VL-' templates/agent-prompt.md` — пусто.
3. `src/agent/system-prompt.test.mjs` — два новых теста VL-117: (а) наличие правила «backlog только через MCP» в собранном системном промпте (матчи /backlog\//, /MCP-инструмент/, /worktree/); (б) отсутствие упоминаний VL-N в базовой части промпта (закрепляет комментарий Pavel). Название второго теста поправлено (в плане была опечатка с иероглифами — исправлено на «шаблон универсален для других проектов»).
**Проверки:**
- `pnpm build` — tsc без ошибок.
- `node --test src/agent/system-prompt.test.mjs` — 7/7 зелёные (5 прежних + 2 новых).
- `pnpm test` — 849/849 зелёные. ВАЖНО: при прогоне из этой сессии 4 теста оркестратора (VL-114: задачный env в spawnEnv и др.) падали из-за утечки переменных окружения фазы (`VIBELOG_PHASE_TASK_ID=VL-117`, `VIBELOG_PHASE_NAME=code`) в тестовый процесс — это особенность запуска из Фазы Code, не регрессия: с очисткой этих переменных (`env -u VIBELOG_PHASE_TASK_ID -u VIBELOG_PHASE_NAME -u VIBELOG_CWD pnpm test`) полный прогон зелёный 849/849. Падение воспроизводится и на чистом checkout без моих правок (проверено через git stash).
**Отклонения от плана:** нет (кроме исправления опечатки в названии теста и DoD-пункта «Документация обновлена» — не отмечен: обновлялась только документация в шаблоне промпта, README/доки проекта не менялись).
Что осталось: ничего; коммит сделает Фаза Close.
---
author: @agent
created: 2026-10-12 19:43
---
Фаза Close выполнена. Ветка vb/vl-117 слита в master (1 коммит: 351a4f7 feat: VL-117 — backlog правится только через MCP, убраны VL-N из agent-prompt.md), worktree удалена (untracked-симлинки node_modules/refs — remove --force), ветка удалена. DoD: «Тесты проходят» и «Нет регрессий» — отмечены (pnpm test зелёный 849/849 по фазе Code); «Документация обновлена» оставлено неотмеченным честно — менялся только шаблон agent-prompt.md, README/доки проекта не обновлялись.
---
<!-- COMMENTS:END -->