# PLAN-09.1: Диагностика — `--version` и `doctor`

## Контекст

Во время работы с Qwen Code через MCP возникла проблема: **непонятно, какая версия Vibelog.md запущена**. Qwen был запущен до обновления до v1.1, MCP-сервер отдал старый список из 6 инструментов (вместо 11), и это обнаружилось только по косвенным признакам — `ToolSearch` не нашёл `backlog_update_task`.

Причины такой ситуации могут быть разные:

1. **Глобальный линк `pnpm link --global` указывает на старую копию** — исходники обновили, а `vibelog` в PATH резолвится в другой путь.
2. **MCP-сервер Qwen закэширован** — Qwen запущен до обновления, инструменты не перечитаны.
3. **Две копии Vibelog.md** — например, старая в `~/tmp/` и новая в `~/Dev/ton/ai/`.
4. **Node.js версия ниже требуемой** — `engines.node >= 20`, но фактически 18.

Сейчас нет быстрого способа проверить всё это одной командой. Нужны:

- `vibelog --version` / `vibelog -v` — версия + пути.
- `vibelog --version --json` — то же в JSON (для скриптов).
- `vibelog doctor` — проверка окружения целиком.

## Цель

Дать пользователю инструмент, который **за секунды** показывает:

- Какая версия Vibelog.md выполняется.
- Откуда запущен бинарник (`process.argv[1]`).
- Куда указывает `vibelog` в PATH (резолв через `which`, `readlink`).
- Совпадают ли исходники и PATH.
- Совпадает ли список MCP-инструментов с ожидаемым.
- Найден ли `backlog/` в текущей директории.
- Версия Node.js — проходит ли по `engines`.

После этого проблемы вида «MCP видит старое» диагностируются за 5 секунд, а не за полчаса.

## Право на корректировку

Если при изучении оригинала Backlog.md (`/Users/bob/Dev/ton/ai/Backlog.md`) обнаружатся аналогичные команды (`--version`, `doctor`, `--diagnostics`) — **изучи их формат и сделай совместимо**. Если у Backlog.md таких команд нет — не выдумывай совместимость, делай по-своему, но аккуратно.

При обнаружении расхождений — правь план и коммить отдельно:

```
docs(plan): уточнить формат диагностических команд по результатам анализа Backlog.md
```

## Часть A: `vibelog --version` / `-v`

### Поведение

```bash
$ vibelog --version
vibelog.md 1.1.0
  bin:  /Users/bob/Library/pnpm/vibelog
  src:  /Users/bob/Dev/ton/ai/Vibelog.md/bin/vibelog.mjs
  node: v20.19.0
```

Где:
- `vibelog.md 1.1.0` — `name` и `version` из `package.json`.
- `bin` — путь, откуда резолвится команда `vibelog`. Если `--version` вызван не через глобальный линк (например, `node bin/vibelog.mjs --version`), строка `bin` показывает этот путь.
- `src` — абсолютный путь к запущенному `bin/vibelog.mjs` (`process.argv[1]`, приведённый к реальному пути через `fs.realpathSync`).
- `node` — `process.version`.

### JSON-режим

```bash
$ vibelog --version --json
{
  "name": "vibelog.md",
  "version": "1.1.0",
  "bin": "/Users/bob/Library/pnpm/vibelog",
  "src": "/Users/bob/Dev/ton/ai/Vibelog.md/bin/vibelog.mjs",
  "node": "v20.19.0",
  "engines": { "node": ">=20" }
}
```

### Краткий режим

```bash
$ vibelog -v
1.1.0
```

Одна строка — для использования в скриптах, где не нужны пути.

### Реализация

Создать `src/cli/commands/version.mjs`:

- Читает `package.json` относительно `bin/vibelog.mjs` (не `process.cwd()` — версия не должна зависеть от того, откуда запущена команда).
- Резолвит путь к себе через `fs.realpathSync(process.argv[1])`.
- Определяет, откуда запущен, через `child_process.execSync('which vibelog')` (только если это не Windows; на macOS/Linux работает; на ошибку — fallback на `process.argv[1]`).
- Печатает три строки или JSON.

Флаг `--json` и `-v` парсятся в `src/cli/args.mjs` или в самом `version.mjs`.

## Часть B: `vibelog doctor`

### Поведение

```bash
$ cd /Users/bob/Dev/ton/ai/lb-gift
$ vibelog doctor

Vibelog.md doctor
────────────────

✓ Node.js v20.19.0 (требуется >= 20)
✓ vibelog найден в PATH: /Users/bob/Library/pnpm/vibelog
✓ Симлинк ведёт на: /Users/bob/Dev/ton/ai/Vibelog.md/bin/vibelog.mjs
✓ Исходники совпадают с PATH (одна копия)
✓ MCP-сервер отдаёт 11 инструментов
✓ Ожидаемый набор инструментов (v1.1)
✓ backlog/ найден: ./backlog
✓ Конфиг: ./backlog/config.yml (prefix: LB)
✓ Задач в backlog/: 6
✓ Round-trip: 94 задач Backlog.md парсятся без ошибок

⚠ Qwen Code: MCP-сервер мог быть закэширован.
  Если Qwen не видит новые инструменты — перезапусти Qwen.
```

### Проверки

| # | Проверка | Что делать при провале |
|---|---|---|
| 1 | `process.version` ≥ 20 | Показать текущую и требуемую версии. |
| 2 | `vibelog` резолвится в PATH | Если не резолвится — подсказать `pnpm link --global`. |
| 3 | Симлинк ведёт на реальный `bin/vibelog.mjs` | Показать, куда ведёт, и подсказать перезапустить `pnpm link --global`. |
| 4 | Путь из PATH совпадает с `process.argv[1]` | Если разные — предупредить, что запущена не та копия. |
| 5 | MCP-сервер отдаёт N инструментов | Сравнить с ожидаемым списком. |
| 6 | Список MCP-инструментов совпадает с ожидаемым | Показать, каких не хватает. |
| 7 | `backlog/` найден в текущей директории | Если нет — предупредить, что нужно `vibelog init`. |
| 8 | `backlog/config.yml` читается | Показать `project_name`, `task_prefix`. |
| 9 | Задачи в `tasks/` парсятся | Показать количество. |
| 10 | Round-trip с Backlog.md | Если найден `/Users/bob/Dev/ton/ai/Backlog.md` — прогнать парсинг 5 файлов. |

Последний пункт (#10) — опциональный. Если оригинального Backlog.md нет по указанному пути — просто пропустить без ошибки.

### Формат вывода

- `✓` — успех, зелёный (`\x1b[32m`).
- `⚠` — предупреждение, жёлтый (`\x1b[33m`).
- `✗` — ошибка, красный (`\x1b[31m`).
- Все цвета — только если `process.stdout.isTTY`. Иначе — без ANSI.

### JSON-режим

```bash
$ vibelog doctor --json
{
  "ok": true,
  "checks": [
    { "name": "node", "ok": true, "value": "v20.19.0", "expected": ">=20" },
    { "name": "path", "ok": true, "value": "/Users/bob/Library/pnpm/vibelog" },
    { "name": "symlink", "ok": true, "value": "/Users/bob/Dev/ton/ai/Vibelog.md/bin/vibelog.mjs" },
    { "name": "sources_match_path", "ok": true },
    { "name": "mcp_tools_count", "ok": true, "value": 11, "expected": 11 },
    { "name": "backlog_dir", "ok": true, "value": "./backlog" },
    { "name": "config", "ok": true, "value": { "project_name": "LB GIFT", "task_prefix": "LB" } },
    { "name": "tasks_count", "ok": true, "value": 6 },
    { "name": "roundtrip", "ok": true, "value": 94 }
  ],
  "warnings": [
    "Qwen Code: MCP-сервер мог быть закэширован. Перезапусти Qwen."
  ]
}
```

### Реализация

Создать `src/cli/commands/doctor.mjs`:

- Каждая проверка — отдельная функция, возвращающая `{ ok, value, expected, name, hint }`.
- Собирает результаты, печатает в терминал или JSON.
- Возвращает exit code `0`, если все обязательные проверки прошли, и `1`, если есть `✗`.

Обязательные проверки (влияют на exit code): 1, 2, 5, 6, 7.
Опциональные (только предупреждения): 3, 4, 8, 9, 10.

### Ожидаемый список MCP-инструментов

Хардкодить в `doctor.mjs` (или в `src/mcp/tools.mjs` как экспорт) список из 11 имён:

```
backlog_create_task
backlog_list_tasks
backlog_view_task
backlog_update_status
backlog_update_task
backlog_manage_ac
backlog_manage_dod
backlog_add_comment
backlog_update_dependencies
backlog_search
backlog_ready
```

Если список в `tools.mjs` изменится — `doctor` должен подхватить это автоматически (импортировать список, а не хардкодить).

## Часть C: Регистрация в CLI

В `src/cli/router.mjs` добавить:

- `--version`, `-v` — перехват **до** роутинга, на уровне `bin/vibelog.mjs` или в самом начале `router.mjs`.
- `doctor` — обычная команда, роутится как остальные.

В `vibelog help` добавить:

```
vibelog --version, -v    Показать версию и пути
vibelog doctor           Проверить окружение
```

## Acceptance Criteria

### A: `--version`
- [ ] #1 `vibelog --version` выводит имя, версию, пути (`bin`, `src`), версию Node
- [ ] #2 `vibelog --version --json` выводит то же в JSON
- [ ] #3 `vibelog -v` выводит только номер версии
- [ ] #4 Версия читается из `package.json` относительно `bin/vibelog.mjs`, а не `process.cwd()`
- [ ] #5 Работает при запуске и через глобальный линк, и через `node bin/vibelog.mjs`

### B: `doctor`
- [ ] #6 Проверяет Node.js >= 20
- [ ] #7 Проверяет, что `vibelog` резолвится в PATH
- [ ] #8 Проверяет, куда ведёт симлинк
- [ ] #9 Проверяет, что PATH и `process.argv[1]` — одна копия
- [ ] #10 Проверяет количество MCP-инструментов
- [ ] #11 Сравнивает список MCP-инструментов с ожидаемым
- [ ] #12 Ищет `backlog/` в текущей директории
- [ ] #13 Читает `backlog/config.yml`
- [ ] #14 Считает задачи в `tasks/`
- [ ] #15 Прогоняет round-trip 5 файлов из Backlog.md (если найден)
- [ ] #16 `vibelog doctor --json` выводит структурированный результат
- [ ] #17 Exit code 0 при успехе, 1 при провале обязательных проверок
- [ ] #18 Цвета только при `process.stdout.isTTY`

### C: Интеграция
- [ ] #19 `vibelog --version`, `-v`, `doctor` зарегистрированы в роутере
- [ ] #20 `vibelog help` показывает новые команды

## Definition of Done

<!-- DOD:BEGIN -->
- [ ] Все тесты проходят: `pnpm test`
- [ ] Новые тесты для `--version`, `--version --json`, `-v`, `doctor`, `doctor --json`
- [ ] Тесты не зависят от окружения (используют фикстуры, не реальный PATH)
- [ ] README обновлён: раздел «Диагностика» с примерами вывода
- [ ] Комментарии и документация на русском
- [ ] Если найдены расхождения с оригиналом — план обновлён
- [ ] Round-trip с Backlog.md не сломан
<!-- DOD:END -->

## После выполнения

Версия → 1.1.1 (патч, без breaking changes). Коммиты:

```
feat(diagnostics): добавить --version и doctor
docs(readme): раздел «Диагностика»
```

## Что НЕ входит в PLAN-09.1

- `vibelog doctor --fix` (автоисправление) — отдельная задача, v1.2+.
- Проверка доступности новых версий через npm — не нужно, инструмент локальный.
- Телеметрия — принципиально нет.

## Зачем это нужно (для контекста)

Qwen Code при запуске загружает MCP-сервер один раз и **кэширует список инструментов до перезапуска**. Это нормальное поведение MCP-клиентов. Но при активной разработке Vibelog.md (когда каждые 15 минут появляются новые MCP-инструменты) это создаёт путаницу: «А почему Qwen не видит `backlog_update_task`? Я же только что его добавил».

`vibelog doctor` решает эту проблему: он показывает **фактическое состояние** MCP-сервера (не то, что закэшировал Qwen), и напоминает: «Если Qwen не видит новые инструменты — перезапусти Qwen».

Плюс `--version` решает проблему «две копии» — когда непонятно, из какой именно папки запускается команда `vibelog`.
