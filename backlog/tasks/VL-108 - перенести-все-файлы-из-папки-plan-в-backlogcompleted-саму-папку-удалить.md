---
id: VL-108
title: Перенести планы из plan/ в backlog/completed и очистить упоминания
status: Done
assignee: []
reporter: ''
created_date: '2026-10-06 23:49'
updated_date: '2026-10-12 18:28'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - AGENTS.md
  - plan/PLAN-00-OVERVIEW.md
  - plan/PLAN-01-SCAFFOLD.md
  - plan/PLAN-02-YAML-FRONTMATTER.md
  - plan/PLAN-03-CORE.md
  - plan/PLAN-04-CLI.md
  - plan/PLAN-05-MCP.md
  - plan/PLAN-06-WEB.md
  - plan/PLAN-07-TESTS.md
  - plan/PLAN-08-COMPATIBILITY.md
  - plan/PLAN-09-V1.1.md
  - plan/PLAN-09.1-DIAGNOSTICS.md
  - plan/PLAN-09.2-COMPAT-FIXES.md
  - plan/PLAN-10-QWEN-COMMANDS.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
перенести все файлы из папки plan в backlog/completed, саму папку удалить, файлам добавить backlog совместимые фронтматер и удалить любое упоминание о них из AGENTS.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 13 файлов PLAN-*.md перенесены из plan/ в backlog/completed/ с backlog-совместимым YAML frontmatter (id, title, status: Done и полный набор полей в порядке VL-1)
- [x] #2 Каталог plan/ удалён; git-история файлов сохранена (перемещение, не копия + удаление)
- [x] #3 В AGENTS.md не осталось упоминаний пути plan/ (проверка: grep -n "plan/" AGENTS.md пуст)
- [x] #4 Планы не засоряют выдачу: listMilestones(includeArchived) не возвращает их как вехи; task list/search не показывают их как задачи
- [x] #5 pnpm test проходит без регрессий
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План: перенос планов из plan/ в backlog/completed (VL-108)

## Архитектурные решения

1. **Планы — не задачи и не вехи.** Файлы получают **task-style frontmatter** по образцу `backlog/completed/VL-1 - ...md` (полный набор полей, `status: Done`). Это исключает попадание в `milestone list --include-archived`: `src/core/milestone.ts:124` пропускает файлы, у которых есть `id`/`title`.
2. **Имена файлов сохраняются** (`PLAN-00-OVERVIEW.md` и т.д.) — конвенция `<id> - <slug>.md` для планов не применяется (прецедент: `v15.md` в completed/). Код не читает эти файлы как задачи: `listTasks` сканирует только `tasks/` (store.ts:37), `getTask` матчит имена с префиксом `VL-` + пробел/точку (store.ts:68), `scanMaxNumber` ищет только `^VL-(\d+)` по именам файлов (id.ts:47) — `PLAN-*` не совпадают, нумерация ID не задета.
3. **Frontmatter генерируется сериализатором проекта** `serializeFrontmatter` из `dist/core/frontmatter.js` — гарантирует, что mini-YAML парсер приложения прочитает файлы (тот же код, что пишет задачи).
4. npm-пакет планы не затрагивают: `package.json` files = `["bin","dist","templates","web/dist"]`.

## Файлы для изменения

1. **13 файлов `plan/*.md`** → перенос в `backlog/completed/` + добавление frontmatter:
   PLAN-00-OVERVIEW, PLAN-01-SCAFFOLD, PLAN-02-YAML-FRONTMATTER, PLAN-03-CORE, PLAN-04-CLI, PLAN-05-MCP, PLAN-06-WEB, PLAN-07-TESTS, PLAN-08-COMPATIBILITY, PLAN-09-V1.1, PLAN-09.1-DIAGNOSTICS, PLAN-09.2-COMPAT-FIXES, PLAN-10-QWEN-COMMANDS.
2. **`plan/`** — удалить каталог после переноса.
3. **`AGENTS.md:29`** — убрать упоминание `plan/PLAN-*.md`.
4. **`AGENTS.md:52`** — переписать абзац «Работа через Vibelog».

## Порядок действий (Фаза 3)

1. `pnpm build` — свежий dist (нужен serializeFrontmatter).
2. Перенос с сохранением git-истории:
   `for f in plan/*.md; do git mv "$f" backlog/completed/; done && rmdir plan`
3. Патч-скрипт `.vibelog/tmp/vl-108-add-frontmatter.mjs` (Node.js, каркас по doc-2):
   - для каждого `backlog/completed/PLAN-*.md`: первый H1 через regex `/^# (PLAN-[\d.]+):\s*(.+)$/` → `id`, `title`;
   - данные frontmatter: `id`, `title`, `status: 'Done'`, `assignee: []`, `reporter: ''`, `created_date`/`updated_date` = mtime файла (`statSync`, формат `YYYY-MM-DD HH:MM`), `due_date: ''`, `labels: []`, `dependencies: []`, `milestone: ''`, `references: []`, `priority: ''`, `type: ''`, `project: ''`, `parent_task_id: ''`, `ordinal: 0`, `documentation: []`, `modified_files: []`;
   - новый контент = `serializeFrontmatter(data, body)` + исходное тело (H1 сохраняется);
   - **round-trip проверка**: `parseFrontmatter(записанного файла).data.id === id` — иначе скрипт падает, файл не трогается.
4. Патч-скрипт `.vibelog/tmp/vl-108-agents-md.mjs` — точечные замены по уникальным якорям:
   - строка 29: `Если план (\`plan/PLAN-*.md\` или Implementation Plan в задаче) содержит` → `Если Implementation Plan в задаче содержит` (остальное предложение без изменений);
   - строка 52: абзац `Проект реализован; файлы \`plan/PLAN-*.md\` — исторический контекст бутстрэпа, ... но задачи всё равно в \`backlog/\`.` → `Проект реализован; исторические планы бутстрэпа (\`PLAN-*.md\`) перенесены в \`backlog/completed/\` — их последовательное чтение не требуется. Новая работа идёт через Vibelog: задачи живут в \`backlog/tasks/\` (создаются через MCP или CLI); план крупного эпика пишется в Implementation Plan задачи.`
5. Проверки (см. ниже), затем коммит: `chore: перенести планы из plan/ в backlog/completed (VL-108)`.

## Как проверить

```bash
pnpm build && pnpm test
ls plan   # ожидаемая ошибка: No such file or directory
grep -n "plan/" AGENTS.md   # ожидаемо пусто

# 1) Фронтматтер всех 13 файлов парсится проектом, поля на месте
node --input-type=module -e "
import { parseFrontmatter } from './dist/core/frontmatter.js';
import { readdirSync, readFileSync } from 'node:fs';
for (const f of readdirSync('backlog/completed').filter(x => x.startsWith('PLAN-'))) {
  const { data } = parseFrontmatter(readFileSync('backlog/completed/' + f, 'utf-8'));
  if (!data.id || !data.title || data.status !== 'Done') throw new Error('фронтматтер битый: ' + f);
  console.log('OK', f, '→', data.id, '|', data.title);
}"

# 2) Планы не засоряют вехи
node --input-type=module -e "
import { listMilestones } from './dist/core/milestone.js';
const bad = listMilestones('backlog', { includeArchived: true }).filter(m => (m.name || '').startsWith('PLAN'));
if (bad.length) throw new Error('планы в вехах: ' + bad.length);
console.log('вехи чисты');"

# 3) Планы не видны как задачи
node --input-type=module -e "
import { listTasks } from './dist/core/store.js';
const bad = listTasks(process.cwd()).filter(t => (t.id || '').startsWith('PLAN'));
if (bad.length) throw new Error('планы в task list');
console.log('task list чист');"
```

## Риски

1. **YAML-спецсимволы в title** (`.md`, `—`, бэктики в PLAN-09.1 «Диагностика — \`--version\` и \`doctor\`») — mitigation: сериализатор проекта + обязательный round-trip `parseFrontmatter` каждого файла внутри скрипта; при расхождении — скрипт падает до удаления каталога.
2. **Попадание планов в milestone list --include-archived** — исключено полем `id`/`title` (milestone.ts:124); проверяется отдельной командой.
3. **Влияние на нумерацию VL-ID** — исключено: regex `^VL-(\d+)` в id.ts:47 не матчит `PLAN-*`.
4. **Потеря git-истории при перемещении** — `git mv` + добавленный frontmatter (~22 строки) сохраняет сходство > 50% даже для самого маленького PLAN-09.2 (39 строк).
5. **Остаточные текстовые упоминания «PLAN-10»** в `backlog/docs/doc-11` и комментариях тестов — вне scope (ТЗ ограничено AGENTS.md), на работу не влияют; при желании — отдельная задача.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-06 23:50
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Перенести планы из plan/ в backlog/completed и очистить упоминания». Масштаб: task. Уточнено: критерии приёмки (перенос файлов с backlog-совместимым frontmatter, удаление папки plan/, чистка упоминаний в AGENTS.md). Вопросов нет.
---
author: @agent
created: 2026-10-07 00:09
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу. Охвачено: 13 файлов plan/*.md → backlog/completed/ + frontmatter (serializeFrontmatter из dist, round-trip проверка), удаление каталога plan/, правка AGENTS.md:29 и AGENTS.md:52. Решения: планы получают task-style frontmatter (id/title/status: Done) — не путаются с веxами (milestone.ts:124 пропускает файлы с id/title), имена файлов сохраняются (PLAN-* не матчат regex ^VL- в id.ts — нумерация не задета), git mv для сохранения истории. Риски: YAML-спецсимволы в title (бэктики в PLAN-09.1) — mitigated сериализатором проекта + round-trip; остаточные текстовые упоминания PLAN-* в backlog/docs/doc-11 и комментариях тестов — вне scope ТЗ (чистка только AGENTS.md).
---
author: @agent
created: 2026-10-07 01:43
---
Фаза 3 (Code) выполнена. Изменено: AGENTS.md; plan/PLAN-*.md (13 файлов) — перемещены в backlog/completed/ через `git mv` (staged-переименования R081–R097, git-история сохранена), каталог plan/ удалён. Frontmatter: добавлен task-style YAML (id/title/status: Done + полный набор полей в порядке VL-1) генератором проекта `serializeFrontmatter` из dist/core/frontmatter.js с обязательной round-trip проверкой `parseFrontmatter` каждого файла (все 13 парсятся: id, title, status: Done). AGENTS.md: убраны оба упоминания пути `plan/` (разделы «Право на корректировку планов» и «Работа через Vibelog»), текст переписан на Implementation Plan задачи / backlog/completed.
Проверки (в worktree vb/vl-108):
- `ls plan` → No such file or directory; `grep -n "plan/" AGENTS.md` → пусто;
- round-trip через dist: 13/13 файлов читаются парсером приложения (id/title/status на месте);
- `listMilestones(backlog, {includeArchived: true})` — планов среди вех нет (milestone.ts пропускает файлы с id/title);
- `listTasks` — планов среди задач нет (listTasks сканирует только tasks/, PLAN-* не матчат regex ^VL- нумерации);
- `pnpm test` (node v20.19.0 из nvm — системный node 22.8.0 падает dyld-ошибкой _pwritev на Catalina, это окружение, не проект): финальный полный прогон **734 tests / 726 pass / 0 fail / 8 skipped** (skips — отсутствующие refs/Backlog.md, штатно). Примечание: в промежуточных прогонах нестабильно воспроизводился тестерный баг node --test «Unable to deserialize cloned data due to invalid or unsupported version» (падали по очереди static/frontmatter/restart.test.mjs, ничего общего с изменениями — правились только markdown; на master без моих изменений тоже воспроизводился). Финальный прогон чистый, регрессий нет.
Верификация миграции API: searchTasks с фильтром modifiedFiles и milestone list --include-archived на перемещённых файлах отрабатывают штатно. Что осталось: ничего; критерии AC1–AC5 и DoD1–DoD3 отмечены. Изменения staged в worktree vb/vl-108, коммит — задача Фазы Close.
---
author: @agent
created: 2026-10-08 08:21
---
Фаза Close выполнена. Статус: Done. Коммит feat: 6f27c3a — «перенести планы из plan/ в backlog/completed и очистить упоминания» (в ветке vb/vl-108 worktree): 13 rename-перемещений PLAN-*.md plan/ → backlog/completed/ с сохранением git-истории (similarity 81–97%, frontmatter +21 строк на файл) + правка AGENTS.md (убраны упоминания пути plan/). Не закоммичено: файлы задач backlog/tasks/ (в режиме параллельной разработки backlog живёт в основном репозитории — статус и комментарий записаны туда через MCP, в worktree backlog не коммитится). Подзадачек нет; рабочее дерево worktree чистое.
---
author: @agent
created: 2026-10-12 18:28
---
Фаза Close выполнена (повторное закрытие после параллельной разработки). Ветка vb/vl-108 слита в master (1 коммит: 6f27c3a «перенести планы из plan/ в backlog/completed и очистить упоминания», merge-коммит без конфликтов), worktree .vibelog/worktrees/vl-108 удалена, ветка vb/vl-108 удалена. DoD: все 3 пункта отмечены (тесты проходят — 734 tests / 0 fail; документация обновлена — AGENTS.md очищен от упоминаний plan/; нет регрессий). Статус: Done.
---
<!-- COMMENTS:END -->