---
id: lesson-69
title: 'Сбрасывай VIBELOG_CWD при тестовых прогонах агента в worktree, иначе jsonl пишется в основной репозиторий'
status: active
tags:
  - worktree
  - agent-sessions
  - метрики
  - vl-202
source_tasks:
  - VL-202
linked_tasks:
  - VL-202
created_date: 2026-10-27
updated_date: 2026-10-27
supersedes: ''
---
# Проблема

При проверке метрик из jsonl в git worktree (например AC2 VL-202: подсчёт обращений к README после тестового прогона) команда `ls .vibelog/agent-sessions/` в worktree пуста: CLI vibelog-agent резолвит каталог сессий как `VIBELOG_CWD ?? cwd` (src/agent/cli.ts:354), а VIBELOG_CWD указывает на основной репозиторий. Тестовый прогон молча записал транскрипт в основной репо, jsonl «пропал», метрику посчитать было нельзя.

# Решение

Для тестовых прогонов внутри worktree сбрасывай переменную: `env -u VIBELOG_CWD node bin/vibelog-agent.mjs "<промпт>" --headless` — тогда сессия запишется в `<worktree>/.vibelog/agent-sessions/`. Либо читай jsonl из `$VIBELOG_CWD/.vibelog/agent-sessions/` (нужен доступ к основному репо).

# Пример

```bash
env -u VIBELOG_CWD node bin/vibelog-agent.mjs "Прочитай README.md проекта и перечисли его разделы" --headless --max-tool-calls 40
ls .vibelog/agent-sessions/   # ← файл сессии теперь здесь
```