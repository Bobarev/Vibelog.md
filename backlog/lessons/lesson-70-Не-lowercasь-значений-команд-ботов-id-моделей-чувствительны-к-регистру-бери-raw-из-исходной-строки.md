---
id: lesson-70
title: 'Не lowercasь значений команд ботов — id моделей чувствительны к регистру, бери raw из исходной строки'
status: active
tags:
  - bot
  - commands
  - case-sensitivity
  - model
source_tasks:
  - VL-209
linked_tasks:
  - VL-209
created_date: 2026-10-29
updated_date: 2026-10-29
supersedes: ''
---
## Проблема

`parseSetCommand` в `src/bot/commands.ts` lowercasит значение команды (`value = value.toLowerCase()`), но model-id вида `routerai/xiaomi/mimo-v2.6-pro` чувствительны к регистру — после lowercasing id не находится в `models.available` и `set model` падает с «неизвестная модель».

## Решение

Для ключей с регистрозависимыми значениями (model) бери raw-значение из исходной строки команды до нормализации; lowercasi только ключ и регистронезависимые значения (темы, языки). Валидируй id в `loadModels().available` как есть.

## Пример

```
/set model RouterAI/MiMo-Pro   ← сохранить как есть
/set MODEL routerai/mimo-pro   ← ключ нормализуется, значение — raw после ключа
```