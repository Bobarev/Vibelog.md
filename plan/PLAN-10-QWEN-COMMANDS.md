# PLAN-10: Qwen Code — команды `/vibelog:*`

## Контекст

Vibelog.md работает через Qwen Code. Workflow spec → plan → code проверен на реальном проекте (lb-gift, задачи LB-4/5/6).

Однако сейчас пользователь **каждый раз вручную пишет длинный промпт** для каждой фазы:
- Фаза 1 (Spec): «разбей фичу на задачи, создай через backlog_create_task...»
- Фаза 2 (Plan): «прочитай задачу, изучи репозиторий, запиши план через backlog_update_task...»
- Фаза 3 (Code): «реализуй план, отметь AC, смени статус...»

Это медленно и подвержено ошибкам. Нужна автоматизация.

**Решение:** `vibelog init --skills` создаёт **пользовательские команды Qwen Code** в `.qwen/commands/vibelog/`, которые вызываются как `/vibelog:spec`, `/vibelog:plan`, `/vibelog:code`.

## Почему команды, а не Skills

Qwen Code поддерживает и Skills (`.qwen/skills/`), и пользовательские команды (`.qwen/commands/`).

- **Skills** загружаются **автономно**, по описанию. Проблема: Qwen3-Coder плохо сопоставляет запрос с описанием Skill'а и часто не загружает его без явного указания.
- **Команды** вызываются **явно**: `/vibelog:plan VL-1`. Гарантированно работают.

**Выбор: команды.** Проще, надёжнее, не зависит от эвристик модели.

## Право на корректировку

Если при изучении Qwen Code (документация, `~/.qwen/`, `.qwen/`) обнаружатся расхождения — **правь этот план** и коммить отдельно.

## Часть A: Шаблоны команд

Создать в `templates/qwen-commands/` три файла-шаблона.

### `spec.md`

```markdown
---
description: Разбить фичу на задачи Vibelog (Фаза 1)
---

Ты работаешь с проектом через Vibelog MCP.

Пользователь описал фичу: {{args}}

Твоя задача — Фаза 1 (Spec):

1. Изучи репозиторий через bash: grep, sed, ls. НЕ читай файлы целиком,
   если они > 200 строк. Экранируй кавычками пути с пробелами.

2. Разбей фичу на 2-3 небольшие задачи. Для каждой:
   - Чёткое описание (что и зачем).
   - 2-3 критерия приёмки (конкретные, проверяемые).
   - Приоритет (High/Medium/Low).
   - Зависимости, если задача требует другой.

3. Создай задачи через MCP:
   backlog_create_task {"title": "...", "description": "...", "acceptanceCriteria": [...], "priority": "..."}

4. Покажи список созданных задач с ID и ЖДИ ПОДТВЕРЖДЕНИЯ.
   НЕ начинай Фазу 2 без явного «да».

Правила:
- Не используй python3. Только Node.js.
- Одна фича = 2-3 задачи, не больше. Если больше — фича слишком крупная.
```

### `plan.md`

```markdown
---
description: Составить план реализации для задачи Vibelog (Фаза 2)
---

Ты работаешь с проектом через Vibelog MCP.

Задача: {{args}}

Твоя задача — Фаза 2 (Plan):

1. Прочитай задачу через MCP:
   backlog_view_task {"id": "{{args}}"}

2. Изучи релевантные файлы через bash:
   - Используй grep для поиска строк, sed -n 'A,Bp' для фрагментов.
   - НЕ читай файлы целиком, если они > 200 строк.
   - Экранируй кавычками пути с пробелами.

3. Составь план и запиши через MCP:
   backlog_update_task {"id": "{{args}}", "plan": "..."}

План должен содержать:
- Список файлов для изменения
- Конкретные строки/места (номер строки → что меняем)
- Порядок действий
- Как проверить (команды tsc, grep, SSR)
- Риски

4. Покажи план пользователю и ЖДИ ПОДТВЕРЖДЕНИЯ.
   НЕ начинай Фазу 3 без явного «да».

Правила:
- Не используй python3. Только Node.js.
- Не читай файлы целиком.
- Если план большой — пиши в 2-3 вызова MCP.
```

### `code.md`

```markdown
---
description: Реализовать задачу Vibelog (Фаза 3)
---

Ты работаешь с проектом через Vibelog MCP.

Задача: {{args}}

Твоя задача — Фаза 3 (Code). План уже одобрен пользователем.

1. Реализуй план из задачи (см. секцию Implementation Plan в backlog_view_task).

2. Проверки:
   - Запусти tsc или аналогичный линтер.
   - Запусти тесты, если они есть.
   - Если что-то не работает — вернись к плану и уточни.

3. Обнови задачу через MCP:
   - Отметь AC: backlog_manage_ac {"id": "{{args}}", "action": "check", "index": N}
   - Добавь комментарий: backlog_add_comment {"id": "{{args}}", "comment": "..."}
   - Смени статус: backlog_update_status {"id": "{{args}}", "status": "Done"}

4. Покажи git diff пользователю.

Правила:
- Не используй python3. Только Node.js.
- Не коммить, пока пользователь не подтвердил.
- Если что-то пошло не так — не скрывай, сообщи.

## Часть B: Реализация `vibelog init --skills`

### Поведение

- `vibelog init "Name"` — без флага, команды НЕ создаются (по умолчанию).
- `vibelog init "Name" --skills` — эквивалент `--skills=qwen`. Создаёт `.qwen/commands/vibelog/`.
- `vibelog init "Name" --skills=qwen` — явно.
- `vibelog init "Name" --skills=claude` — заглушка на будущее, пока `--skills=claude` не реализован, выводить ошибку.

### Что создаётся

```
.qwen/commands/vibelog/
├── spec.md
├── plan.md
└── code.md
```

Файлы копируются из `templates/qwen-commands/`.

### Идемпотентность

- Если `.qwen/commands/vibelog/` уже существует — не перезаписывать.
- Выводить: «Команды /vibelog:* уже существуют. Пропускаю.»
- Флаг `--force` — перезаписать.

### Обновление AGENTS.md

Дописать в `AGENTS.md` секцию:

```markdown
<!-- VIBELOG:SKILLS:BEGIN -->
## Команды Vibelog

В этом проекте доступны команды Qwen Code:

- `/vibelog:spec <описание>` — разбить фичу на задачи (Фаза 1)
- `/vibelog:plan <ID>` — составить план для задачи (Фаза 2)
- `/vibelog:code <ID>` — реализовать задачу (Фаза 3)

Workflow: spec → plan → code. На каждой фазе ждать подтверждения.
<!-- VIBELOG:SKILLS:END -->
```

Если секция уже есть — не дублировать.

## Часть C: CLI

### Флаги `init`

- `--skills` — boolean, создаёт команды.
- `--skills=<agent>` — string, `qwen` (по умолчанию), `claude` (заглушка).
- `--no-skills` — отключает, даже если в будущем default изменится.
- `--force` — перезаписывать существующие.

### Обновить help

```
vibelog init "Name" [--prefix P] [--skills[=qwen]] [--no-skills] [--force]
```

## Часть D: Тесты

- `vibelog init "Test"` — `.qwen/commands/` НЕ создаётся.
- `vibelog init "Test" --skills` — `.qwen/commands/vibelog/spec.md`, `plan.md`, `code.md` создаются.
- `vibelog init "Test" --skills=qwen` — то же.
- `vibelog init "Test" --skills=claude` — ошибка «claude пока не поддерживается».
- `vibelog init "Test" --skills` дважды — idempotent, второй раз «уже существует».
- `vibelog init "Test" --skills --force` — перезапись.
- `AGENTS.md` дополняется секцией `VIBELOG:SKILLS:BEGIN/END`.
- Если `AGENTS.md` содержит секцию — не дублируется.

## Acceptance Criteria

### A: Шаблоны
- [ ] #1 `templates/qwen-commands/spec.md` создан
- [ ] #2 `templates/qwen-commands/plan.md` создан
- [ ] #3 `templates/qwen-commands/code.md` создан
- [ ] #4 Все три содержат YAML frontmatter с `description` и `{{args}}` в теле

### B: init --skills
- [ ] #5 `vibelog init --skills` создаёт `.qwen/commands/vibelog/{spec,plan,code}.md`
- [ ] #6 `vibelog init` без флага — команды НЕ создаются
- [ ] #7 `--skills=qwen` работает, `--skills=claude` — ошибка
- [ ] #8 Идемпотентность: повторный init не перезаписывает
- [ ] #9 `--force` перезаписывает
- [ ] #10 `AGENTS.md` дополняется секцией `VIBELOG:SKILLS:BEGIN/END`
- [ ] #11 Секция не дублируется при повторном init

### C: CLI
- [ ] #12 Флаги `--skills`, `--no-skills`, `--skills=qwen`, `--force` работают
- [ ] #13 `vibelog help init` показывает новые флаги

### D: Тесты
- [ ] #14 Все сценарии из Части D покрыты

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] Тесты проходят: `pnpm test`
- [ ] Комментарии и документация на русском
- [ ] Не используется python3
- [ ] README обновлён: раздел «Работа с Qwen Code»
- [ ] Если найдены расхождения — план обновлён
- [ ] Round-trip с Backlog.md не сломан
<!-- DOD:END -->

## После выполнения

Версия → 1.2.0 (minor — новая функциональность). Коммит:

```
feat(skills): vibelog init --skills создаёт команды /vibelog:* для Qwen Code
```

## Что НЕ входит в PLAN-10

- Skills (автономные `.qwen/skills/`) — отложено, команды надёжнее.
- Поддержка Claude Code, Codex, других агентов — только Qwen (целевой).
- Интерактивный визард `vibelog config` для Skills — не нужно.
- Worktree-per-task (из vibe-kanban) — отдельная задача, если понадобится.
