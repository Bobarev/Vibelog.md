---
id: lesson-15
title: Иконки бренда (Github) удалены в lucide-react 1.x — используй GitBranch/Repo и проверяй наличие иконки перед импортом
status: active
tags:
  - web
  - lucide
  - иконки
  - сборка
source_tasks:
  - VL-166
linked_tasks:
  - VL-166
created_date: 2026-10-15
updated_date: 2026-10-15
supersedes: ''
---
## Проблема

В VL-166 планировали иконку Github для кнопки репо — в lucide-react 1.x бренд-иконки (Github, Gitlab и т.п.) удалены, импорт падает при сборке.

## Решение

Перед использованием иконки из lucide-react проверь её наличие в установленной версии (1.x удалил бренды). Для кнопок репо/ git используй нейтральные GitBranch/Repo. Стандартные иконки (Monitor, Sun, Moon, Search, Settings) есть всегда.

## Пример

```tsx
import { GitBranch } from "lucide-react"; // вместо Github (удалена в 1.x)
```