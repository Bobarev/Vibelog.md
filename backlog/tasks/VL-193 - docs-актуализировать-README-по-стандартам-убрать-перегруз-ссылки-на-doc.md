---
id: VL-193
title: 'docs: актуализировать README по стандартам (убрать перегруз, ссылки на doc-*)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-26 17:35'
updated_date: '2026-10-29 07:41'
due_date: ''
labels:
  - docs
dependencies: []
milestone: v1.10
references:
  - ref-16
priority: medium
type: docs
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - README.md
lessons:
  - lesson-50
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
docs: актуализировать README по стандартам (убрать перегруз, ссылки на doc-*)

README перегружен: блок «Быстрый старт» — стена про веб-интерфейс (сайдбар, кнопки, роуты), таблица MCP на 21 строку, Workflow JSON на 30 строк, Telegram-бот с /auto, диагностика с выводом. Это должно быть в doc-6/doc-7/doc-8.

## Что сделать

1. Структура по Standard Readme:
   - H1 + одно предложение.
   - Badges (npm version, license, Node 20+).
   - Prerequisites (Node 20+) — до Installation.
   - Installation (npm install -g vibelog.md).
   - Usage (3-4 команды: init, task create, board, browser).
   - Ссылки на документацию (таблица: doc-6, doc-7, doc-8, doc-10, MCP-SETUP).
   - Contributing (если есть CONTRIBUTING) + License.
2. Убрать из README (перенести в doc-6/doc-7/doc-8):
   - Веб-интерфейс (сайдбар, кнопки, роуты, Quick Create) — в doc-6.
   - Таблица MCP-инструментов — в doc-8 (уже есть).
   - Workflow JSON — в doc-6.
   - Telegram-бот и /auto — в doc-6.
   - Диагностика (--version, doctor) — в doc-7.
   - Параллельная разработка (worktree) — в doc-6 или отдельный doc.
3. Проверить: README умещается на 1-2 экрана, все ссылки на doc-* работают.

## AC

- README: H1 + одно предложение, badges, Prerequisites, Installation, Usage (3-4 команды), таблица ссылок на doc-*, Contributing, License.
- Убраны: веб-интерфейс, MCP-таблица, Workflow JSON, Telegram-бот, диагностика, worktree.
- Ссылки на doc-6, doc-7, doc-8, doc-10, MCP-SETUP работают.
- README < 150 строк.
- Тесты: не применимо (docs).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 README по Standard Readme: H1 + одно предложение, badges, Prerequisites, Installation, Usage (3-4 команды), таблица ссылок на doc-*, Contributing, License; длина < 150 строк
- [x] #2 Из README убраны: веб-интерфейс (сайдбар/кнопки/роуты/Quick Create), MCP-таблица, Workflow JSON, Telegram-бот с /auto, диагностика, worktree — перенесены в doc-6/doc-7/doc-8
- [x] #3 Ссылки из README на doc-6, doc-7, doc-8, doc-10, MCP-SETUP проверены и работают
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# Plan: актуализировать README по Standard Readme (VL-193)

Референс: ref-16 (Standard Readme — H1+описание, badges, Prerequisites, Installation, Usage, Contributing, License).

## Карта README.md сейчас (427 строк)

- 1–5: H1 + описание + репозиторий; 7–14: «Зачем»; 16–40: «Установка» (+ «Из исходников» 30–40); 42–52: таблица «Документация» (уже содержит doc-6/7/8/9/10/MCP-SETUP)
- 53–171: «Быстрый старт»-стена; **81–151 — веб-интерфейс** (сайдбар, роуты #/references #/documents #/lessons #/tasks, фильтры VL-176, виды VL-177, Quick Create, поиск VL-185)
- 172–203: таблица MCP (21 строка) → **в doc-8 уже есть все 37 инструментов**
- 204–254: диагностика (`--version`/`doctor` с выводом) → **в doc-7 §doctor (л.298) и §Глобальные флаги (л.323) есть синтаксис, но НЕТ примеров вывода**
- 255–277: «Работа с Qwen Code» + Агент + флаги init → покрыто doc-10 (VIBELOG_QWEN_BIN, default_agent) и doc-7 §init (л.19, `--no-mcp`/`--force`)
- 278–314: Workflow JSON → **уже целиком в doc-6 §Workflow (л.281–330)**; в doc-6 л.332 — circular-ссылка «подробнее: README, раздел Workflow»
- 315–367: Telegram-бот + `/auto` → doc-6 §11 (команды л.376–384, `/auto` л.386); **не хватает**: «успех = exitCode 0 + смена статуса», «dep-задачи ждут до 60 с»
- 368–387: Фаза Code в сессии Plan → doc-6 л.412+ покрывает целиком
- 388–414: worktree → doc-6 л.525–537; **не хватает**: `/web start/stop` (VL-161), сериализация Close (VL-146), шаблон `phase-close-worktree.md` (merge --no-ff, конфликт → остаётся Review), `rootCliPath` (VL-151)
- 415–424: «Совместимость» (оставить, сократить); 425–427: «Лицензия» (Unlicense)

## Файлы для изменения

1. **README.md** — полная перезапись, 427 → **<150 строк** (цель ~90–110)
2. **backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md** — досдать переносимое
3. **backlog/docs/doc-7-CLI-справочник-Vibelogmd.md** — примеры вывода диагностики

## Шаг 1 — Перенос ДО правки README (чтобы не потерять содержимое)

### 1a. doc-6 §10 «Доска и веб-интерфейс» (после л.364, перед `---`/§11)
Вставить из README л.82–151 (переформатировать из bash-комментариев в нормальный текст):
- Сайдбар: роуты References (#/references, VL-174), Documents (VL-181), Lessons (VL-182), вложенное меню «Настройки» (#/settings, #/config)
- **Заменить** в л.358 устаревшее «неактивная кнопка „Поиск“ (скоро)» → фактический глобальный поиск (VL-185: debounce 300ms, GET /api/search по задачам/lessons/references/documents)
- Роут #/tasks (VL-175 таблица + сортировка + пагинация; VL-176 multi-select фильтры + localStorage; VL-177 переключатель Board/List/Table)
- Quick Create, запуск фаз с default_agent (VL-180), кнопка Reject (VL-163)

### 1b. doc-6 §11 Telegram-бот
- `/auto` (после л.386): дописать «успех фазы = exitCode 0 **и** смена статуса (фаза без прогресса → retry)» и «dep-блокированные задачи ждут до 60 с» (из README л.357–365)
- Worktree (после л.537): дописать из README л.403–414 — `/web start [VL-N]`/`/web stop` (VL-161); сериализация Close (VL-146, очередь оркестратора); закрытие по шаблону `templates/qwen-commands/phase-close-worktree.md` (чистота worktree → merge --no-ff → при конфликте задача остаётся в Review → удаление worktree/ветки); `rootCliPath` у пустого `/restart` (VL-151)

### 1c. doc-7 CLI-справочник
- §doctor (л.304): добавить пример вывода `vibelog doctor` (✓ node/path/symlink/…, ⚠ Qwen) — из README л.232–249; MCP-число в примере привести к актуальному «36» (в README было 22)
- §Глобальные флаги (после л.330): добавить примеры вывода `vibelog --version` / `-v` / `--version --json` — из README л.208–227

### 1d. doc-6 л.332
- «Подробнее и с примерами настроек: README, раздел „Workflow…“» → удалить (Workflow остаётся только в doc-6; circular-ссылка)

## Шаг 2 — Новый README.md (Standard Readme, ref-16)

Структура и ориентировочный объём:
1. `# Vibelog.md` + **одно предложение** (Markdown-нативный таск-менеджер для git, совместим с Backlog.md, работает на Node 20+) — 3 строки
2. **Badges** (img.shields.io): npm version `vibelog.md` → npmjs.com/package/vibelog.md; license Unlicense; Node ≥20 — 1 строка
3. `## Зачем` — 4 буллета из л.9–14 (сократить) — ~6 строк
4. `## Prerequisites` — Node.js 20+ — 2 строки (**до Installation**)
5. `## Installation` — `npm install -g vibelog.md` + `npx vibelog.md` + одна строка про алиасы `vibelog`/`vb` — ~7 строк
6. `## Usage` — ровно 4 команды: `vibelog init "Мой проект"`, `vibelog task create …`, `vibelog board`, `vibelog browser` — ~12 строк
7. `## Документация` — таблица ссылок: **doc-6, doc-7, doc-8, doc-10, MCP-SETUP** (+ doc-9) — ~10 строк (пути оставить текущие: `backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md` и т.д.)
8. `## Contributing` — CONTRIBUTING.md нет: кратко «исходники TypeScript, `pnpm install && pnpm build`, тесты `pnpm test`, правила — AGENTS.md» (перенос из «Из исходников» л.32–40) — ~7 строк
9. `## Совместимость с Backlog.md` — сократить до 4 строк (формат файлов/frontmatter/round-trip)
10. `## Лицензия` — Unlicense — 2 строки

**Удаляется целиком:** «Быстрый старт»-стена (веб-интерфейс, прочие команды), MCP-таблица, диагностика, «Работа с Qwen Code», Workflow JSON, Telegram-бот, `/auto`, Фаза Code в сессии Plan, worktree.

## Шаг 3 — Проверки (после правок)

```bash
wc -l README.md                      # < 150
node -e "…вытащить ](path) из README, fs.existsSync для не-http путей…"  # все локальные ссылки существуют
grep -nE "Сайдбар|auto-queue|transitions|vibelog doctor|worktree|Default_agent|Quick Create" README.md   # 0 совпадений (контент перенесён)
pnpm test                            # build + vitest (DoD: тесты проходят)
```
(Номера строк в doc-6/doc-7 после вставок сместятся — сверять якоря по заголовкам `## 10.`, `## 11.`, `## doctor`, не по номерам.)

## Риски

- **Потеря содержимого при перезаписи README** → строгий порядок: сначала перенос в doc-6/doc-7 (шаг 1), потом новый README (шаг 2)
- **Circular-ссылка doc-6 л.332** на удаляемый раздел README → чинить в шаге 1d
- **Устаревшие числа в примерах вывода** (MCP 22 vs 36, версия 1.1.1 vs 1.9.0) → в примерах поставить актуальные/нейтральные значения
- Слом ссылок npm-пакета: README включается в tarball автоматически, ссылки на backlog/docs/ в пакете не валидны — но это уже так сейчас, регрессии нет
- В doc-6/8/9 есть легаси-ссылки `cli-reference.md`/`user-guide.md` (файлов нет) — **вне AC этой задачи**, зафиксировать как известную проблему (не чинить, чтобы не расширять scope)

## Не делается

- Тестов на README нет (AC: «Тесты: не применимо») — но `pnpm test` прогоняется для DoD
- doc-8 не меняется (таблица MCP уже полная)
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-26 17:37
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Тип: docs. Масштаб: task. Приоритет: Medium. Уточнено: цель (привести README к Standard Readme и разгрузить его переносом веб-интерфейса, MCP-таблицы, Workflow JSON, Telegram-бота, диагностики и worktree в doc-6/doc-7/doc-8), добавлены 3 проверяемых AC (структура README + <150 строк; убранные блоки; рабочие ссылки на doc-*). Labels: docs. References: ref-16 (Standard Readme spec, зарегистрирован). Вопросов нет.
---
author: @agent
created: 2026-10-26 18:41
---
Фаза 2 (Plan) выполнена. Тип: docs. План записан в задачу: 3 файла (README.md — перезапись 427→<150 строк по Standard Readme/ref-16; doc-6 — перенос веб-интерфейса из README л.82–151 в §10 + /auto и worktree-деталей VL-151/146/161 в §11 + удаление circular-ссылки л.332; doc-7 — примеры вывода --version и doctor из README л.204–254). Порядок: сначала перенос содержимого в doc-6/doc-7, потом новая структура README (H1+1 предложение, badges, Prerequisites, Installation, Usage 4 команды, таблица doc-6/7/8/10/MCP-SETUP, Contributing — CONTRIBUTING.md нет, краткий блок из «Из исходников», License). Проверки: wc -l <150, node-скрипт существования локальных ссылок, grep остатков перенесённого, pnpm test. Риски: потеря контента при перезаписи (порядок шагов), circular-ссылка doc-6→README, устаревшие числа в примерах вывода (MCP 22→36, версия). doc-8 не меняется — таблица MCP уже полная. Учтён lesson-49 (ROADMAP читался на Spec-фазе, отвергнутого не предлагается).
---
author: @agent
created: 2026-10-26 19:32
---
Фаза 3 (Code) выполнена. Изменено: README.md (коммит a29133d: 427→78 строк, Standard Readme по ref-16 — H1+1 предложение, badges npm/license/Node20+, Prerequisites, Installation, Usage 4 команды, таблица doc-6/7/8/10/MCP-SETUP+doc-9, Contributing, License) + документы через MCP: doc-7 (примеры вывода vibelog doctor с mcp_tools_count 36 и --version/-v/--version --json), doc-6 (перенос из README: сайдбар-роуты References/Documents/Lessons VL-174/181/182, глобальный поиск VL-185 вместо устаревшего «Поиск (скоро)», роут #/tasks VL-175/176/177 + Quick Create, default_agent VL-180 + Reject VL-163; /auto: успех = exitCode 0 + смена статуса, dep-задачи ждут 60 с; worktree: /web start/stop VL-161, шаблон phase-close-worktree.md (merge --no-ff, конфликт → Review), сериализация Close VL-146, rootCliPath VL-151; удалена circular-ссылка «подробнее: README, раздел Workflow»; заодно вылечен дублированный frontmatter файла). Проверки: pnpm test — 73 файла/1292 теста прошли; node-скрипт — все локальные ссылки README существуют; grep — перенесённый контент (Сайдбар/Quick Create/auto-queue/transitions/doctor/worktree) в README отсутствует; document_search — маркеры переноса в doc-6/doc-7 найдены, «README, раздел» не найден. doc-8 не менялся (MCP-таблица там уже полная — 37 инструментов). Что осталось: легаси-ссылки cli-reference.md/user-guide.md в doc-6/8/9 (вне AC этой задачи); правки backlog/docs лежат в основном репозитории незакоммиченными (файлы backlog/ в ветку не коммитятся — закоммитит Close). Ref-16 уже связан; новых references/lessons не создавалось.
---
author: @agent
created: 2026-10-26 19:38
---
Фаза Close выполнена. Ветка vb/vl-193 слита в master (1 коммит a29133d, merge --no-ff), worktree удалена (--force: только untracked node_modules/refs), ветка удалена. После merge: pnpm build + pnpm test — прошли. DoD честно: 1) Тесты проходят — да (build+vitest после merge); 2) Документация обновлена — да (CHANGELOG запись в Unreleased «Изменено», doc-6/doc-7 из Code; docs-коммит aaa387c «docs: VL-193 — документация и CHANGELOG», refs+lessons коммит 847232c); 3) Нет регрессий — да (сборка и тесты зелёные, изменён только README/docs). Урок lesson-50 создан и связан. Легаси-ссылки cli-reference.md/user-guide.md в doc-6/8/9 — вне AC, зафиксированы как известная проблема.
---
<!-- COMMENTS:END -->