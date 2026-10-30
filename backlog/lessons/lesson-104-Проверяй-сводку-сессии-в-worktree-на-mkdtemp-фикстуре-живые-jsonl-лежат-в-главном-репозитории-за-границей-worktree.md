---
id: lesson-104
title: Проверяй сводку сессии в worktree на mkdtemp-фикстуре — живые jsonl лежат в главном репозитории за границей worktree
status: active
tags:
  - worktree
  - cli
  - tests
  - agent-sessions
  - sessions
source_tasks:
  - VL-261
linked_tasks:
  - VL-261
created_date: 2026-10-30
updated_date: 2026-10-30
supersedes: ''
---
## Проблема

AC требовал проверить новую CLI-сводку сессии на живых данных: `agent-1793328615846` → 3 рана, 110 tool-calls, 72 shell, 18 edit, 5 write_file. В фазе Code работа идёт в worktree `vb/vl-261`, а `.vibelog/agent-sessions/*.jsonl` живут в главном репозитории (`.vibelog/` gitignored, worktree получает чистый каталог). Инструмент run_shell_command к тому же отклоняет пути за границей worktree — достучаться до файла нельзя ни по относительному пути, ни через `../`.

## Решение

Верификацию на живых данных разделяй на два уровня:

1. **Инвариант воспроизводимости в тестах** — синтетическая фикстура, повторяющая профиль живой сессии (3 маркера промптов plan/code/«Продолжи», распределение 110 вызовов = 72 shell + 18 edit + 5 write_file + 15 read), и утверждения на ровно те цифры из AC. Тест ловит регрессию логики подсчёта без доступа к живым файлам.
2. **Живой прогон — в фазе Close на master** (или вручную владельцем), где `.vibelog/agent-sessions/` доступен. В отчёте Code явно фиксируй: «живой прогон невозможен из worktree, проверено на эквивалентной фикстуре».

Дополнительно: CLI читает каталог сессий через `process.env.VIBELOG_CWD ?? cwd` (как сам агент), поэтому тесту достаточно подменить `VIBELOG_CWD` на mkdtemp-проект — без spawn'ов и без реального каталога.

## Пример

```js
// фикстура-эквивалент живых данных: цифры AC проверяются в worktree
const calls = [...Array(72)].map(() => call('run_shell_command', { command: 'git status' })) /* … */;
const s = buildSessionSummary({ messages, sessionId: 'agent-1793328615846', path: 'p',
  billingSessions: [{ phase: 'plan' }, { phase: 'code' }, { phase: 'code' }] });
assert.equal(s.totals.toolCalls, 110);
assert.deepEqual(s.runs.map(r => r.phase), ['plan', 'code', 'code']);
```
