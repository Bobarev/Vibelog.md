---
id: VL-298
title: '[mvp] experiments: judge-скоринг (score=null путь, LLM-judge по spec из frontmatter)'
status: Planned
assignee: []
reporter: ''
created_date: '2026-11-02 02:04'
updated_date: '2026-11-02 02:06'
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
modified_files: []
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
MVP-шаг 5 эпика VL-293 (зависит от VL-296). LLM-judge как опциональный AI-профиль.

Файлы:
- `src/core/experiment.ts` — схема `judge` в frontmatter: `{enabled, model?, prompt?, score_min, score_max, scale: 'numeric'|'pass_fail', reasoning?: bool}`. Схема фиксируется сразу (VL-294), здесь — реализация.
- `src/core/judge.ts` (новый): `buildJudgePrompt(row, result, judge)` (использует `expected_ac` + `output`), `parseJudgeScore(text)` (устойчив к «7/10», «0.7», pass/fail), `scoreRows(rows, judge, llmOpts)`.
- LLM-клиент — переиспользовать `createLlmClient` из `src/agent/llm.ts` (не писать новый HTTP-слой); модель — `judge.model ?? models.default`, резолв через `resolveModelById` (`src/core/models.ts:187`).
- `src/cli/commands/experiment.ts` — `judge <exp-id> [--run N]` → upsert-ит `score` в существующие results-строки.
- **Путь `score: null` уже работает в VL-296/297** (нет judge → score null → dropped в отчёте, не NaN); эта задача только добавляет автоматическое заполнение.
- Cost судейских вызовов — отдельно от cost варианта: `judge_usage` в meta, cost судьи в `cost_judge`, не примешивать к `cost` варианта.
- Тесты: `src/core/judge.test.mjs` (парс ответов разных форматов, mock-клиент без сети), CLI-тест `judge` на фикстуре с подменённым клиентом.

Проверка: `pnpm build && pnpm test` (без сетевых вызовов — тесты на моках).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Схема judge в frontmatter (model, prompt, score_min/max, scale) валидируется
- [ ] #2 judge <exp-id> заполняет score в existing results (upsert), парс '7/10'/'0.7'/pass-fail
- [ ] #3 judge_usage и cost_judge отдельно от cost варианта
- [ ] #4 Сеть в тестах не используется (mock клиента, apiMode явно)
- [ ] #5 pnpm build && pnpm test зелёные
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
1) Схема judge (в VL-294 уже в frontmatter; здесь типы + валидация). 2) src/core/judge.ts — промпт, парс score (numeric/pass_fail), устойчивость к мусору. 3) Переиспользовать createLlmClient/src/core/models.ts:resolveModelById. 4) CLI judge + upsert score. 5) judge_usage/cost_judge отдельно в meta. 6) Тесты на моке клиента (без сети) — по образцу src/agent/llm.test.mjs (apiMode передаётся явно, lesson-78/84). 7) pnpm build && pnpm test. Риск: тесты LLM-клиента без явного apiMode подхватывают локальные .vibelog/settings.json — передавать apiMode явно и cwd на временный каталог (VL-240).
<!-- SECTION:PLAN:END -->