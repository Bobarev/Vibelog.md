---
id: lesson-283
title: 'Вычисляй следующий шаг фазы из workflow и completeness, а не из списка имён фаз в коде'
status: active
tags:
  - agent
  - workflow
  - repeat-tracker
  - completeness
  - loop
source_tasks:
  - VL-410
linked_tasks:
  - VL-410
created_date: 2026-11-10
updated_date: 2026-11-10
supersedes: ''
last_verified: ''
verified_by: ''
applies_to: []
kind:
---
## Проблема
Директива повтора и признак «нужен отчёт» вычислялись по списку имён фаз в коде (`phase === 'close'`, `REPORT_REQUIRED_PHASES = {close}`), поэтому для любой другой фазы — включая кастомные из `workflows` в settings — модель получала общую фразу «прочитай состояние или смени аргумент», читала её как «попробуй ещё раз» и повторяла вызов дословно до капа noop-повторов. Параллельно гейт неполноты (`completeness`) и шаблон фазы описывали одну фазу по-разному: шаблон `phase-spec.md` объявлял AC обязательными, а дефолт `completeness` требовал только `description`, поэтому `missing` был пуст и директива не называла ни одного конкретного поля.

## Решение
Вычисляй следующий шаг фазы из данных конфигурации, а не из имён фаз: одна функция (`phaseNextStep(cwd, task, phase)`) отвечает и «нужен ли отчёт» (есть ли переход `getStatusAfterPhase`), и «что передать» (неполные поля из `completeness`), а директивы получают готовый текст шага. Держи дефолт `completeness` в согласии с шаблоном фазы: если шаблон объявляет поле обязательным, гейт неполноты обязан требовать то же поле, иначе вызов проходит как `applied` и модель остаётся без следующего шага.

## Пример
VL-408: фаза spec упала на капе noop-повторов — модель трижды обновила задачу (applied), затем 4 раза повторила `{id, type}`; директива «прочитай состояние или смени аргумент» не называла следующий шаг, а `DEFAULT_COMPLETENESS.default.spec` требовал только `description`, поэтому `missing` был пуст и конкретных полей модель не увидела. VL-410: `phaseNextStep(cwd, task, phase)` считает шаг из `SERVICE_PHASES` + `getStatusAfterPhase` + `completeness`, дефолт spec дополнен `acceptanceCriteria`.