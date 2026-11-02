---
id: VL-298
title: '[mvp] experiments: judge-скоринг (score=null путь, LLM-judge по spec из frontmatter)'
status: Done
assignee: []
reporter: ''
created_date: '2026-11-02 02:04'
updated_date: '2026-11-02 03:51'
due_date: ''
labels:
  - mvp
  - experiments
dependencies:
  - VL-296
milestone: ''
references: []
priority: medium
type: feature
project: ''
parent_task_id: VL-293
ordinal: 0
documentation: []
modified_files:
  - src/core/judge.ts
  - src/cli/commands/experiment-judge.ts
  - src/core/experiment.ts
  - src/cli/commands/experiment.ts
  - src/cli/router.ts
  - src/core/judge.test.mjs
  - src/cli/experiment-judge-cli.test.mjs
  - CHANGELOG.md
  - backlog/docs/doc-7-CLI-справочник-Vibelogmd.md
lessons:
  - lesson-171
token_usage:
  input: 5991432
  output: 51390
  cache: 5860864
  total: 6042822
  requests: 82
  duration_ms: 976772
  reasoning: 23957
  by_phase:
    code:
      input: 5294177
      output: 46663
      cache: 5186560
      requests: 64
    close:
      input: 697255
      output: 4727
      cache: 674304
      requests: 18
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
MVP-шаг 5 эпика VL-293 (зависит от VL-296). LLM-judge как опциональный AI-профиль.

Спецификация: `backlog/docs/doc-21` §4 (схема judge), §11 (cost судьи отдельно).

MVP закрывается уже после VL-297: эта задача — MVP-опция. Путь `score: null` работает без judge (VL-296/297), поэтому judge не блокирует базовый сценарий.

Файлы:
- `src/core/experiment.ts` — **парсер judge-секции уже сделан в VL-294** (`enabled`, `model?`, `prompt?`, `scale: 'numeric'|'pass_fail'`, `score_min`, `score_max`); здесь только использование, не переделка.
- `src/core/judge.ts` (новый): `buildJudgePrompt(row, result, judge)` (использует `expected_ac` + `output`), `parseJudgeScore(text, judge)` (устойчив к «7/10», «0.7», pass/fail; pass_fail → 1/0 числом), `scoreRows(rows, judge, llmOpts)`.
- LLM-клиент — переиспользовать `createLlmClient` из `src/agent/llm.ts` (не писать новый HTTP-слой); модель — `judge.model ?? models.default`, резолв через `resolveModelById` (`src/core/models.ts:187`).
- `src/cli/commands/experiment.ts` — `judge <exp-id> [--run N]` → upsert-ит `score` в existing results-строки.
- Cost судейских вызовов — отдельно от cost варианта: `judge_usage` в meta, `cost_judge`, не примешивать к `cost` варианта.
- Тесты: `src/core/judge.test.mjs` (парс ответов разных форматов, mock-клиент без сети), CLI-тест `judge` на фикстуре с подменённым клиентом. **Обязательно:** `apiMode: 'chat'` явно и `cwd` на mkdtemp — без этого тест подхватит локальный `models.default` с `api_mode: responses` и уедет на `/responses` (lesson-78/84/145).

Проверка: `pnpm build && pnpm test` (без сетевых вызовов — тесты на моках).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Схема judge в frontmatter (model, prompt, scale, score_min/max) читается из парсера VL-294 (не переделывать парсер) и валидируется
- [ ] #2 judge <exp-id> заполняет score в existing results (upsert), парс '7/10'/'0.7'/pass-fail (pass_fail → числом 1/0)
- [ ] #3 judge_usage и cost_judge отдельно от cost варианта
- [ ] #4 Сеть в тестах не используется: mock клиента + apiMode: 'chat' явно + cwd на mkdtemp (lesson-78/84/145)
- [x] #5 CHANGELOG.md обновлён
- [ ] #6 pnpm build && pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
1) Схема judge (в VL-294 уже в frontmatter; здесь типы + валидация). 2) src/core/judge.ts — промпт, парс score (numeric/pass_fail), устойчивость к мусору. 3) Переиспользовать createLlmClient/src/core/models.ts:resolveModelById. 4) CLI judge + upsert score. 5) judge_usage/cost_judge отдельно в meta. 6) Тесты на моке клиента (без сети) — по образцу src/agent/llm.test.mjs (apiMode передаётся явно, lesson-78/84). 7) pnpm build && pnpm test. Риск: тесты LLM-клиента без явного apiMode подхватывают локальные .vibelog/settings.json — передавать apiMode явно и cwd на временный каталог (VL-240).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-02 03:48
---
Фаза 3 (Code) выполнена. Коммит 83bc8e0.
**Реализовано:**
- `src/core/judge.ts` (новый): `validateJudgeConfig` (числа конечны, `score_min < score_max`, для `pass_fail` шкала фиксирована 0..1, `enabled=false` — неблокирующее предупреждение; парсер frontmatter из VL-294 НЕ переделывался — только валидация значений), `buildJudgePrompt`/`buildJudgeMessages` (используют `expected_ac` + `input` + `output`, шкала описывается явно), `parseJudgeScore` (дроби «7/10» при шкале 1..10 → 7, «0.7» и «0,7» при 0..1, проценты «85%» → 0.85, `pass_fail` → PASS/FAIL/passed/failed/да/нет/соответствует/не соответствует → 1/0 ЧИСЛОМ; значения вне шкалы → `null`, а не обрезка), `scoreRows` (одна строка — один вызов, ошибка клиента/неразборчивый ответ не роняют прогон: строка остаётся, `error_kind: 'judge'`; строки без `output` не оцениваются — путь `score: null` сохранён).
- LLM-клиент переиспользован: `createLlmClient` из `src/agent/llm.ts`, модель — `judge.model` через `resolveModelById` → `models.default`; неизвестный явный id — ошибка (тихий откат на default врал бы при сравнении прогонов). `apiMode` передаётся явно (дефолт `'chat'`), `cwd` настроек — параметром (lesson-78/84/145).
- `src/cli/commands/experiment-judge.ts` (новый): `vibelog experiment judge <exp-id> [--run N]` — читает `results.jsonl` рана, upsert-ит `score` в СУЩЕСТВУЮЩИЕ строки по ключу `(task_id, variant)` (строк не добавляется), `expected_ac` берёт из датасета рана; пишет `judge_usage`, `cost_judge`, `judge_pricing_missing`, `judge_model` в `meta.json` — **`cost` вариантов не трогается**; `cost_judge: null` при отсутствии тарифа (не 0).
- `src/core/experiment.ts`: в `RunMeta` добавлены `judge_usage`/`cost_judge`/`judge_pricing_missing`/`judge_model`.
- `src/cli/commands/experiment.ts` + `src/cli/router.ts`: подкоманда `judge` зарегистрирована, справка обновлена.
**Тесты** (сеть не используется):
- `src/core/judge.test.mjs` — 34 теста на мок-`LlmClient` (парс всех форматов, валидация, промпты, upsert/скипы/ошибки/usage/cost).
- `src/cli/experiment-judge-cli.test.mjs` — 10 тестов CLI: реальный `bin/vibelog.mjs`, провайдер — loopback-мок `node:http` (loopback разрешён fetch-guard'ом VL-132), `api_mode: chat` и `cwd` на mkdtemp из `testSpawnEnv`. Проверены: upsert + `judge_usage`/`cost_judge` = 0.00028 (по тарифу судьи), `cost` варианта не изменён, `cost_total: null`, `expected_ac` в теле запроса, pass_fail → 1 числом, неразборчивый ответ → `error_kind: judge` и score null, сбой провайдера не роняет команду, все ошибочные ветки (нет judge/disabled/нет ранов/неверный --run/пустые results/строка без output).
**Проверки:** `pnpm build` — ok; `pnpm test` — полный прогон: **140 файлов, 2634 passed, 4 skipped** (skipped — `src/core/frontmatter.test.mjs`, предсуществующие `it.skip`, к задаче не относятся); отдельный повторный прогон `src/web/static.test.mjs` тоже зелёный.
**Не сделано (по правилам фазы Code):** AC5 (CHANGELOG.md) и DoD «Документация обновлена» — фаза Code не правит CHANGELOG и backlog/docs, это делает фаза Close после merge. Ничего другого не осталось.
Урок: lesson-171 (spawnSync блокирует event loop родителя — мок-сервер в том же процессе не ответит; нужен async `spawn`).
---
author: @agent
created: 2026-11-02 03:51
---
Фаза Close выполнена. Статус: Done. Коммиты: feat 83bc8e0 (LLM-judge экспериментов — сделан в фазе Code), docs 047be12 (CHANGELOG + doc-7: раздел `experiment judge`), docs(task) f2afad7 (lesson-171).
**Проверки после merge:** `pnpm build` — ok (один раз); ранний точечный фильтр `src/core/judge.test.mjs` + `src/cli/experiment-judge-cli.test.mjs` — 44 passed; полный `npx vitest run` — 141 файл, 2642 passed, 4 skipped (skipped — предсуществующие `it.skip` в `src/core/frontmatter.test.mjs`, к задаче не относятся). Повторных полных прогонов не было.
**Документация (AC5, DoD «Документация обновлена»):** CHANGELOG.md — запись VL-298 в Unreleased/Добавлено; doc-7 (CLI-справочник) — новый раздел `experiment judge` (формат вызова, резолв модели, устойчивость парса, `judge_usage`/`cost_judge` отдельно от cost варианта).
**Lessons:** lesson-171 (spawnSync блокирует event loop родителя — мок-сервер в том же процессе не ответит, нужен async `spawn`) создан в фазе Code, в Close обновлены `tags`/`source_tasks`, связан с задачей (lesson_link через поле `lessons`).
Не закоммичено: нет. В рабочем дереве остаются файлы других задач (VL-299/VL-300/VL-301, completed VL-287/VL-288) — не принадлежат VL-298, не трогал.
---
<!-- COMMENTS:END -->