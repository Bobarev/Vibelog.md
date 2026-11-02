---
id: exp-1
title: 'Фаза plan: deepseek-v4.1-flash vs mimo-v2.6-flash'
status: draft
schema_version: 1
dataset: plan-vl111
runner: manual
metrics:
  score_field: score
  higher_is_better: true
  baseline: A
  custom: []
variants:
  A:
    prompt: 'builtin:plan'
    label: 'deepseek-v4.1-flash'
    model: 'routerai/deepseek/deepseek-v4.1-flash@morph'
  B:
    prompt: 'builtin:plan'
    label: 'mimo-v2.6-flash'
    model: 'routerai/xiaomi/mimo-v2.6-flash@makora'
created_date: 2026-11-02
updated_date: 2026-11-02
---

## Гипотеза

Один и тот же встроенный промпт фазы plan на двух моделях даёт разное качество плана:
deepseek-v4.1-flash (текущая default) против mimo-v2.6-flash.

## Как прогонять

Manual runner: фаза запускается вручную, результат вводится через `record`.

```bash
# вариант A
vibelog-agent plan VL-111 --model routerai/deepseek/deepseek-v4.1-flash@morph --headless

# откатить файл задачи перед вариантом B (иначе B стартует с планом от A)
git checkout -- "backlog/tasks/VL-111 - Тестовая задача.md"

# вариант B
vibelog-agent plan VL-111 --model routerai/xiaomi/mimo-v2.6-flash@makora --headless
```

## Ограничения

- Одна задача в датасете: `n = 1`, статистики нет — только качественная оценка.
- `score` ставится вручную (0..10) либо через `judge` (в карточке не включён).
- VL-111 — тестовая задача без описания: обе модели должны явно сказать, что данных мало.
