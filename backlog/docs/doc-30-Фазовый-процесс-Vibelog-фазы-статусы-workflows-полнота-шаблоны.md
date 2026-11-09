---
id: doc-30
title: 'Фазовый процесс Vibelog: фазы, статусы, workflows, полнота, шаблоны'
type: guide
created_date: 2026-11-10
tags:
  - phases
  - workflow
  - completeness
  - templates
  - vl-397
---
# Фазовый процесс Vibelog

Как устроен жизненный цикл задачи: какие бывают фазы, какие статусы они двигают, как настроить свой workflow и свои правила полноты, как переопределить шаблоны фаз.

**Дата актуализации:** 2026-11-10.
**Источники (единственные, по которым документ проверен):** `templates/phases/*.md`, `src/web/phase-prompt.ts`, `src/core/workflow.ts`, `src/core/phase-transient.ts`, `src/mcp/tools.ts` (контракт `backlog_finish_phase`).

Документ описывает **смысл и правила**. Полные перечни фаз, статусов и ключей настроек генерируются из кода: `vibelog instructions` (тема `overview`), MCP `initialize` и команда `vibelog capabilities` (в разработке — VL-394/VL-395/VL-396). При расхождении прав код, а не этот текст.

## 1. Фазы

Фаза — это одна автоматическая сессия агента над задачей. Список фаз задан константой `PHASES` (`src/web/phase-prompt.ts`), имя шаблона — `phase-<фаза>.md` в `templates/phases/`.

| Фаза | Шаблон | Что делает |
|---|---|---|
| `spec` | `phase-spec.md` | Уточняет постановку: заголовок, тип, приоритет, labels, критерии приёмки. Код не читает, план не пишет |
| `plan` | `phase-plan.md` | Изучает код и референсы, принимает архитектурные решения, пишет план реализации; разбивает эпик на подзадачи. Код не правит |
| `code` | `phase-code.md` | Реализует план: правки, проверки проекта, отчёт с отметкой AC/DoD |
| `do` | `phase-do.md` | Реализация без планирования (simple workflow): точки правки определяет сам |
| `close` | `phase-close.md` | Закрывает задачу: остатки кода, сборка и тесты, документация, уроки, DoD, терминальный статус. Код не правит |
| `close` (worktree) | `phase-close-worktree.md` | То же для задачи с git worktree: merge ветки, полный прогон после merge, уборка worktree. Выбирается автоматически при наличии worktree |
| `comment` | `phase-comment.md` | Выполняет запрос из комментария к задаче и отчитывается; статус меняет только если это указано в комментарии (служебная фаза) |
| `prompt` | `prompt.md` | Произвольный запрос пользователя без задачи (служебная фаза) |
| `analyze` | `phase-analyze.md` | Разбор сессии агента по её jsonl-транскрипту (служебная фаза) |
| `reject` | `phase-reject.md` | Откат незакоммиченных изменений задачи и итог комментарием |
| `investigate` | `phase-investigate.md` | Расследование инцидента: документ с выводами и предложениями задач. Задачи не создаёт |
| `materialize` | `phase-materialize.md` | Создаёт задачи из согласованных предложений расследования и закрывает задачу-расследование |

Инварианты шаблонов: без интерактивных режимов и подтверждений, промпт фазы не содержит внутренних ID задач репозитория (проверяется тестом), поэтому переносится в чужой проект без правок.

## 2. Статусы и переходы

Workflow — граф «статус → фаза → статус» (`DEFAULT_WORKFLOW` в `src/core/workflow.ts`). Это единственный источник правды для кнопок фаз в боте и вебе, проверки переносов на канбане и для валидации `backlog_finish_phase`.

| Из статуса | Фаза | В статус |
|---|---|---|
| To Do | `spec` | Spec |
| To Do | `reject` | Rejected |
| Spec | `plan` | Planned |
| Spec | `reject` | Rejected |
| Planned | `code` | Review |
| Planned | `reject` | Rejected |
| In Progress | `code` | Review |
| In Progress | `reject` | Rejected |
| Review | `close` | Done |
| Review | `code` | Review (fix-цикл: доработка после ревью) |
| Review | `reject` | Rejected |
| Done | — | финальный статус, фаз нет |
| Rejected | — | финальный статус, фаз нет |

**Служебные фазы** (`SERVICE_PHASES`: `comment`, `prompt`, `analyze`, `resume`) вне workflow: их можно запускать из любого статуса, статус они не меняют. Попытка поставить статус из служебной фазы через `backlog_finish_phase` отклоняется — ручные переносы идут мимо MCP.

## 3. Свой workflow в `.vibelog/settings.json`

Два ключа в одном файле настроек:

```jsonc
{
  "workflows": {
    "default": {
      "initial_status": "To Do",
      "transitions": [
        { "status": "To Do", "phase": "spec", "produces_status": "Spec" },
        { "status": "Done", "phase": null, "produces_status": null }
      ]
    },
    "investigation": {
      "initial_status": "To Do",
      "transitions": [
        { "status": "To Do", "phase": "investigate", "produces_status": "Review" },
        { "status": "Review", "phase": "materialize", "produces_status": "Done" },
        { "status": "Done", "phase": null, "produces_status": null }
      ]
    }
  },
  "task_workflows": { "investigation": "investigation", "chore": "simple" }
}
```

Правила:

- `task_workflows` — соответствие «тип задачи → имя workflow»; тип берётся из `config.yml`, сравнение без учёта регистра.
- Имя workflow из `task_workflows` не объявлено в `workflows` → задача остаётся на `default` (задача без workflow остаться не может).
- Fallback: нет файла, битый JSON, невалидная запись → `DEFAULT_WORKFLOW`. Валидация нестрогая: битая запись выпадает, остальные именованные workflow сохраняются; `default` при невалидности заменяется встроенным.
- `phase: null` + `produces_status: null` — финальный статус: исходящих фаз у него нет.

## 4. Неполнота сущности (`completeness`)

Агент завершает фазу через `backlog_finish_phase`, и сервер отвечает, какие поля ещё не заполнены. Правила — тоже данные, потому что для simple workflow плана и критериев в задаче не бывает вовсе.

```jsonc
"completeness": {
  "default": {
    "plan":  { "task": ["implementationPlan"] },
    "close": { "task": ["acceptanceCriteria", "definitionOfDone"] },
    "*":     { "task": ["description"], "lesson": ["content"] }
  }
}
```

- Ключ `'*'` — правило, действующее в любой фазе (задаче — описание, уроку — тело); наборы `'*'` и конкретной фазы объединяются без дублей.
- Сущности фиксированы: `task` и `lesson` (имена не настраиваются — опечатка в имени сущности считается дефектом конфигурации).
- Семантика полей: `acceptanceCriteria`/`definitionOfDone` — «все пункты отмечены, пустой чеклист полон»; остальные — «значение непустое».
- Запись workflow из settings **полностью** заменяет одноимённую дефолтную (не сливается по фазам): добавление фазы в дефолт не ужесточит настройку, сделанную осознанно. Workflow объявлен, но не настроен → набор пуст, дефолт в него не протекает.
- Проверка конфигурации — `vibelog doctor` (там же проверки `task_workflows` и имён полей).

## 5. Шаблоны фаз и переопределение

- Встроенные шаблоны едут с пакетом: `templates/phases/<файл>`, имя файла = `phase-<фаза>.md` (у `close` есть отдельный worktree-вариант `phase-close-worktree.md`, у фазы `prompt` — `prompt.md`).
- Проект переопределяет любой шаблон без правки пакета: файл с тем же именем в `.vibelog/prompts/phases/` приоритетнее встроенного. Нет файла — берётся встроенный; нет ни там, ни там — ошибка запуска фазы.
- Аналогично переопределяются части системного промпта агента: `.vibelog/prompts/agent-prompt.md` (базовая часть) и `.vibelog/prompts/agent-prompt-chat.md` (правила чата).
- Подстановки в шаблоне: `{{taskId}}`, `{{comment}}` (всегда непустой — при отсутствии комментария подставляется текст-заглушка), `{{prompt}}`, `{{producesStatus}}` (статус из перехода workflow), поля задачи (`{{taskTitle}}`, `{{taskType}}`, `{{taskStatus}}`, `{{taskDescription}}`, `{{taskPlan}}`, `{{taskAC}}`, `{{taskDoD}}`, `{{taskModifiedFiles}}`, `{{taskLastComment}}`, `{{taskReferences}}`, `{{taskLessons}}`), списки из `config.yml` (`{{availableLabels}}`, `{{availableTypes}}`, `{{availablePriorities}}`), переменные worktree/session-фаз.
- Поля задачи подставляются одним чтением задачи на фазу: агенту не нужен отдельный `backlog_view_task` ради title/описания/AC.

## 6. Запуск фазы и её итог

1. Фазу запускает бот, веб или CLI (`vibelog agent run <фаза> <task-id>`); допустимость фазы проверяется по workflow текущего статуса.
2. На время выполнения задачи с workflow-фазой ставится транзиентный `In Progress` (видно на канбане). Статус «до фазы» хранится в `.vibelog/phase-in-progress.json`, а не в frontmatter (совместимость хранения с Backlog.md); зависшие записи откатываются при рестарте процесса с проверкой pid.
3. Фаза завершается вызовом `backlog_finish_phase`: отчёт-комментарий, `modifiedFiles`, отметки AC/DoD, `status` = `{{producesStatus}}`.
4. Успех → применяется `produces_status`, посчитанный от исходного статуса (если агент сам не зафиксировал статус — его запись приоритетнее).
5. Провал → откат к статусу до фазы + комментарий с причиной. Аварийная ветка шаблона обязана передать `aborted: true`: иначе незавершённая работа получила бы `produces_status`.
6. Терминальный статус при непройденных пунктах DoD отклоняется: либо отметить пункты, либо передать причину (`dodOverride`). Повторный вызов с уже выставленным статусом возвращает дату и источник существующего отчёта — повторять его не нужно.

## 7. Куда идти за деталями

- Настройка workflow/типов/статусов в проекте — `backlog/config.yml` и `.vibelog/settings.json` (ключи `workflows`, `task_workflows`, `completeness`).
- Модель, лимиты и внутреннее устройство исполнителя фаз — doc-31 «Агент vb: архитектура и лимиты».
- Команды и флаги — doc-7 (CLI-справочник), MCP-инструменты (включая `backlog_finish_phase`) — doc-8.
- Машинный справочник, генерируемый из кода — `vibelog instructions`, MCP `initialize`, `vibelog capabilities` (VL-394/VL-395/VL-396).