---
id: VL-76
title: '#agent В рамках подготовки к созданию агента была создана папка refs и туда…'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-04 19:19'
updated_date: '2026-10-04 23:53'
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
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#agent В рамках подготовки к созданию агента была создана папка refs и туда были перенесены проекты, которые уже были использованы нами как референсы, источники знаний и примеры. Сейчас нужно сделать следующее:
1. Найти все упоминания проектов Backlog.md, next-shadcn-admin-dashboard, vibe-kanban и заменить их относительные пути на новый путь относительный путь refs/* (все эти проекты я перенёс самостоятельно в эту папку)
2. Если мы использовали ещё какие-то проекты, но я забыл об этом - сообщить мне чтобы я это сделал, но пути уже поменять.
3. Внести эту папку в гитигнор и сделать скрипт для разработчиков, который будет делать git clone этих проектов в эту папку
4. Добавить (git clone без install) в refs следующие проекты:
https://github.com/modelcontextprotocol/typescript-sdk
https://github.com/mastra-ai/mastra
https://github.com/earendil-works/pi
https://github.com/google-gemini/gemini-cli
https://github.com/anomalyco/opencode
https://github.com/cline/cline
https://github.com/NousResearch/hermes-agent
https://github.com/openclaw/openclaw
Их так же добавить в скрипт для разработчиков.

5. С помощью mcp создать документацию к этим референсам с небольшим описанием проектов (позже при изучении дополнять эту документацию, если находим что-то интересное, отличающее от других)

---

## Уточнение Фазы 1 (Spec), 2026-10-04

### Результаты исследования репозитория

**refs/ уже содержит** (перенесены пользователем): `Backlog.md`, `next-shadcn-admin-dashboard`, `vibe-kanban`.

**Файлы с относительными путями к референсам** (вне backlog/ и refs/ — их и менять):
- `AGENTS.md` — `../Backlog.md` (3 места: инструкция по изучению оригинала, раздел «Контекст: оригинал Backlog.md»)
- `plan/PLAN-02-YAML-FRONTMATTER.md` (2), `plan/PLAN-07-TESTS.md` (1), `plan/PLAN-08-COMPATIBILITY.md` (5), `plan/PLAN-09-V1.1.md` (1), `plan/PLAN-09.1-DIAGNOSTICS.md` (1) — `../Backlog.md`
- `docs/research/FEATURES-COMPARISON.md` — `../Backlog.md` (6 мест), `../vibe-kanban` (1 место)
- `src/core/compat.test.mjs`, `src/core/compat-full.test.mjs`, `src/core/frontmatter.test.mjs` — константы пути к оригиналу (`BACKLOG_ROOT`/`BACKLOG`/`backlogRoot`). Уже есть guard `existsSync` — при отсутствии refs/Backlog.md тесты корректно skip. После замены пути: на чистых клонах (refs/ в gitignore) compat-тесты будут пропускаться — это ожидаемое изменение.

**Не редактировать:**
- `backlog/tasks/*`, `backlog/completed/*` — исторические записи (журнал), содержат упоминания старых путей (напр. VL-27 — `../some/next-shadcn-admin-dashboard`).
- `README.md`, `CHANGELOG.md`, `MCP-SETUP.md`, `package.json` — упоминания Backlog.md как названия проекта/совместимости, не пути.
- `web/*` — shadcn как npm-зависимость, не референс-проект.

**Других референсных проектов не найдено:** grammy, @dnd-kit, shadcn — npm-пакеты; остальные упоминания — текстовые/исторические. Если пользователь помнит иной использованный референс — сообщить, пути поменять.

### План реализации (Фаза 2 уточнит)

1. Заменить пути `../Backlog.md` → `refs/Backlog.md`, `../vibe-kanban` → `refs/vibe-kanban` патч-скриптами (AGENTS.md, plan/*, docs/research/FEATURES-COMPARISON.md, 3 теста src/core/*.test.mjs).
2. Добавить `refs/` в `.gitignore`.
3. Создать `scripts/clone-refs.mjs` — чистый Node.js, `git clone --depth 1` без install, 11 репозиториев (3 существующих + 8 новых из списка выше), уже склонированные пропускать.
4. Запустить скрипт — клонировать 8 новых проектов в refs/.
5. Создать MCP-документ (document_create) с описаниями референсных проектов.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Все упоминания ../Backlog.md и ../vibe-kanban вне backlog/ и refs/ заменены на refs/* (grep по репозиторию не находит старых путей; backlog/ и упоминания названия проекта не тронуты)
- [x] #2 refs/ добавлен в .gitignore; scripts/clone-refs.mjs (чистый Node.js, git clone --depth 1 без install) клонирует 11 репозиториев (3 существующих + 8 новых) и идемпотентно пропускает уже склонированные
- [x] #3 8 новых проектов склонированы в refs/; через MCP создан документ с описаниями референсных проектов
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План реализации (Фаза 2)

Задача типа task — план здесь же. Правки кода выполняются патч-скриптами Node.js (правило проекта: write_file/edit не используются для файлов репозитория).

## Файлы для изменения (10 файлов, 23 замены)

Замена единая: `../Backlog.md` → `refs/Backlog.md`, `../vibe-kanban` → `refs/vibe-kanban` (replaceAll по файлу).

### 1. Пути к референсам (точные места)

| Файл | Строки | Что меняем |
|---|---|---|
| `AGENTS.md` | 34, 110, 127 | `../Backlog.md` → `refs/Backlog.md` (инструкция по изучению оригинала, раздел «Контекст», ссылки) |
| `plan/PLAN-02-YAML-FRONTMATTER.md` | 9, 73 | `../Backlog.md` → `refs/Backlog.md` |
| `plan/PLAN-07-TESTS.md` | 29 | `../Backlog.md` → `refs/Backlog.md` |
| `plan/PLAN-08-COMPATIBILITY.md` | 18–22 | `../Backlog.md` → `refs/Backlog.md` (5 источников: tasks, config.yml, CLI-INSTRUCTIONS, ADVANCED-CONFIG, src/) |
| `plan/PLAN-09-V1.1.md` | 27 | `../Backlog.md` → `refs/Backlog.md` |
| `plan/PLAN-09.1-DIAGNOSTICS.md` | 36 | `../Backlog.md` → `refs/Backlog.md` |
| `docs/research/FEATURES-COMPARISON.md` | 10, 27, 77, 182, 226 | `../Backlog.md` → `refs/Backlog.md` |
| `docs/research/FEATURES-COMPARISON.md` | 12 | `../vibe-kanban` → `refs/vibe-kanban` |
| `src/core/compat.test.mjs` | 4 (комментарий), 20 (константа `BACKLOG_ROOT`) | `../Backlog.md` → `refs/Backlog.md` |
| `src/core/compat-full.test.mjs` | 29 (константа `BACKLOG`) | `../Backlog.md` → `refs/Backlog.md` |
| `src/core/frontmatter.test.mjs` | 12 (константа `backlogRoot`) | `../Backlog.md` → `refs/Backlog.md` |

### 2. Новые/изменяемые файлы конфигурации и скриптов

| Файл | Действие |
|---|---|
| `.gitignore` | Добавить строку `refs/` (секция после `dist/`) |
| `scripts/clone-refs.mjs` | **Создать** — скрипт разработчика для клонирования референсов |

## Порядок действий

### Шаг 1. Замена путей патч-скриптом

/tmp-скрипт `vl76-patch-paths.mjs`: массив пар `{file, replacements}` для 10 файлов выше; для каждого файла `readFileSync` → `replaceAll('../Backlog.md', 'refs/Backlog.md')` (+ `../vibe-kanban` → `refs/vibe-kanban` для FEATURES-COMPARISON.md) → запись только если количество замен совпало с ожидаемым (3+2+1+5+1+1+6+1+1+1+1 = 23). Если хотя бы один файл не изменился — скрипт падает, файлы не перезаписываются (все-or-nothing по заменам в каждом файле).

Не редактировать: `backlog/tasks/*`, `backlog/completed/*` (исторический журнал), `README.md`, `CHANGELOG.md`, `MCP-SETUP.md`, `package.json`, `docs/user-guide.md`, `docs/cli-reference.md`, `docs/mcp-reference.md`, `docs/best-practices.md` (там «Backlog.md» — название проекта/совместимости, не путь), `src/core/*.ts` (комментарии о совместимости, не пути).

### Шаг 2. .gitignore

Патч-скриптом: после строки `dist/` вставить `refs/` (комментарий: референсные проекты клонируются локально, см. scripts/clone-refs.mjs).

### Шаг 3. scripts/clone-refs.mjs

Чистый Node.js, без зависимостей:
- Вычисляет корень как `join(dirname(fileURLToPath(import.meta.url)), '..')`, целевая папка `refs/`.
- Константа `REPOS` — массив из 11 пар `{dir, url}`:
  - Существующие (перенесены пользователем, URL взяты из `.git/config` в refs/): `Backlog.md` ← https://github.com/MrLesk/Backlog.md.git ; `next-shadcn-admin-dashboard` ← https://github.com/arhamkhnz/next-shadcn-admin-dashboard.git ; `vibe-kanban` ← https://github.com/BloopAI/vibe-kanban.git
  - Новые (из задачи): `typescript-sdk` ← modelcontextprotocol/typescript-sdk ; `mastra` ← mastra-ai/mastra ; `pi` ← earendil-works/pi ; `gemini-cli` ← google-gemini/gemini-cli ; `opencode` ← anomalyco/opencode ; `cline` ← cline/cline ; `hermes-agent` ← NousResearch/hermes-agent ; `openclaw` ← openclaw/openclaw (все `.git`-суффикс).
- Логика на каждый репозиторий: если `refs/<dir>` существует — «пропуск» (идемпотентность); иначе `spawnSync('git', ['clone', '--depth', '1', url, target], {stdio:'inherit'})`; ошибка clone — сообщение на русском, счётчик ошибок, `process.exitCode = 1` в конце при ошибках.
- Без install/update/pull — только clone (требование задачи).
- Итоговая сводка: склонировано / пропущено / ошибок.

### Шаг 4. Клонирование (в Фазе 3, не здесь)

`node scripts/clone-refs.mjs` — ожидаемо: 3 пропуска (уже есть) + 8 клонов. Повторный запуск — 11 пропусков (идемпотентность). Shallow clone (`--depth 1`) критичен для больших репо (mastra, gemini-cli, cline).

### Шаг 5. Документация референсов (в Фазе 3)

MCP `document_create`: документ «Референсные проекты (refs/)» — список 11 проектов с краткими описаниями:
- Backlog.md (MrLesk) — оригинал, эталон совместимости данных; CLI/MCP/web.
- vibe-kanban (BloopAI) — оркестратор AI-агентов с kanban-UI; sunset, опыт переиспользуем.
- next-shadcn-admin-dashboard (arhamkhnz) — admin-дашборд Next.js + shadcn/ui (референс UI web-интерфейса).
- typescript-sdk (modelcontextprotocol) — официальный MCP SDK для TypeScript (референс для src/mcp).
- mastra (mastra-ai) — TS AI-фреймворк: agents/workflows/RAG.
- pi (earendil-works) — AI CLI-ассистент; описание уточнить при изучении.
- gemini-cli (google-gemini) — CLI-агент Google на TypeScript (референс CLI/TUI-опыта).
- opencode (anomalyco) — open-source AI-код-агент с TUI.
- cline (cline) — AI-код-агент для VS Code (референс agent-воркфлоу).
- hermes-agent (NousResearch) — AI-агент NousResearch; описание уточнить при изучении.
- openclaw (openclaw) — open-source AI-агент; описание уточнить при изучении.

Для проектов с неполными знаниями — честная заглушка «уточнить при изучении», документ пополняется по мере изучения (так и сказано в задаче).

## Как проверить

1. `grep -rn '\.\./Backlog\.md\|\.\./vibe-kanban' . --exclude-dir=backlog --exclude-dir=refs --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist` — пусто (старых путей вне backlog/refs нет).
2. `git status` — `refs/` больше не в untracked (лежит в .gitignore).
3. `node scripts/clone-refs.mjs` — идемпотентность: второй запуск пропускает все 11.
4. `pnpm test` (= build + `node --test src`): compat-тесты читают `refs/Backlog.md` (на этой машине склонирован — тесты проходят, не skip). На чистом клоне refs/ отсутствует — compat-тесты корректно skip (guards в compat.test.mjs:25 / compat-full.test.mjs:30; в frontmatter.test.mjs — try/catch ENOENT).
5. Документ создан и виден через `document_list`/`document_view`.

## Риски

1. **Относительные пути в тестах** разрешаются от cwd (корень проекта при `node --test src`) — `refs/Backlog.md` корректен; если запускать тесты из другой директории — сломается (как и раньше с `../`). Не регрессия.
2. **frontmatter.test.mjs без skip-guard** — при отсутствии refs/ тесты ловят ENOENT и логируют «Пропущен» (текущее поведение сохраняется).
3. **Клонирование по сети** — 8 репозиториев могут быть медленными/недоступными; скрипт не падает целиком (счётчик ошибок, продолжение), повторный запуск доклонит недостающее.
4. **Размер refs/** — только local, в git не попадает; shallow clone минимизирует диск.
5. **Других референсов не найдено** — grammy/@dnd-kit/shadcn это npm-пакеты, не референс-проекты; если пользователь вспомнит иной проект — сообщить, пути поменять (пункт 2 задачи).

## Ответственность Фазы 3 (Code)

Все шаги 1–5 выше; после — закрытие AC задачи и DoD (тесты, документация, отсутствие регрессий).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-04 19:26
---
Фаза 1 (Spec) выполнена. Тип: task.
Краткое описание уточнения: фича укладывается в одну задачу — это связный блок «переезд референсов в refs/»: механическая замена путей (~10 файлов: AGENTS.md, 5 планов, docs/research/FEATURES-COMPARISON.md, 3 compat-теста src/core/), gitignore + скрипт clone-refs.mjs, клонирование 8 репозиториев и создание MCP-документации. Независимых подзадач, требующих декомпозиции, нет.
Результаты исследования:
- refs/ уже содержит Backlog.md, next-shadcn-admin-dashboard, vibe-kanban.
- Старые пути: ../Backlog.md — AGENTS.md (3 места), plan/PLAN-02/07/08/09/09.1 (10 мест), docs/research/FEATURES-COMPARISON.md (6), константы в src/core/compat.test.mjs, compat-full.test.mjs, frontmatter.test.mjs (тесты имеют existsSync-guard — при отсутствии refs/ корректно skip); ../vibe-kanban — FEATURES-COMPARISON.md (1).
- Не редактировать: backlog/tasks|completed (исторический журнал), README/CHANGELOG/MCP-SETUP/package.json (упоминания названия проекта, не пути), web/* (shadcn — npm-зависимость).
- Других использованных референсных проектов не найдено — если помните ещё, сообщите, пути поменяем.
В описании задачи добавлен раздел «Уточнение Фазы 1 (Spec)» с полным списком файлов и планом реализации; AC — 3 конкретных критерия.
---
author: @agent
created: 2026-10-04 19:35
---
Фаза 2 (Plan) выполнена. Тип: task — план записан в задачу через backlog_update_task.
**Исследование (точные места для замен):**
- `../Backlog.md` → `refs/Backlog.md` — 20 мест в 9 файлах: AGENTS.md (34, 110, 127), plan/PLAN-02 (9, 73), plan/PLAN-07 (29), plan/PLAN-08 (18–22), plan/PLAN-09 (27), plan/PLAN-09.1 (36), docs/research/FEATURES-COMPARISON.md (10, 27, 77, 182, 226), src/core/compat.test.mjs (4, 20), src/core/compat-full.test.mjs (29), src/core/frontmatter.test.mjs (12).
- `../vibe-kanban` → `refs/vibe-kanban` — 1 место: FEATURES-COMPARISON.md:12.
- Итого 23 замены в 10 файлах — все единым патч-скриптом с подсчётом замен (all-or-nothing).
**Проверено:**
- refs/ уже содержит Backlog.md, next-shadcn-admin-dashboard, vibe-kanban; origin-URL взяты из их .git/config (MrLesk/Backlog.md, arhamkhnz/next-shadcn-admin-dashboard, BloopAI/vibe-kanban) — включены в скрипт клонирования.
- .gitignore сейчас без refs/ — будет добавлено.
- scripts/ существует (npm-smoke.mjs, qwen-json-probe.mjs) — clone-refs.mjs создаётся там же.
- guards тестов: compat.test.mjs:25 и compat-full.test.mjs:30 — existsSync+skip; frontmatter.test.mjs — try/catch ENOENT. После замены пути на чистых клонах compat-тесты будут skip — ожидаемо и безопасно.
**Ключевые решения плана:**
- scripts/clone-refs.mjs — чистый Node.js, git clone --depth 1 без install, 11 репозиториев (3 существующих + 8 новых из задачи), идемпотентная пропуск-логика, счётчик ошибок.
- Документация референсов — через MCP document_create; для частично известных проектов (pi, hermes-agent, openclaw) — честные заглушки «уточнить при изучении».
- Проверка: grep по старым путям (вне backlog/refs — пусто), git status (refs/ не tracked), pnpm test, повторный запуск скрипта (идемпотентность).
**Риски:** относительные пути тестов от cwd (как и раньше — не регрессия); сеть при клонировании (скрипт не падает целиком).
Других использованных референс-проектов (вне npm-пакетов grammy/@dnd-kit/shadcn) не найдено — если вспомните иной, сообщите, пути поменяем (пункт 2 задачи).
---
author: @agent
created: 2026-10-04 19:58
---
Фаза 3 (Code) выполнена.
**Изменено:**
- 10 файлов заменены патч-скриптом `/tmp/vl76-patch-paths.mjs` (all-or-nothing, подсчёт замен): `../Backlog.md` → `refs/Backlog.md` (24 замены: AGENTS.md ×3, plan/PLAN-02 ×2, PLAN-07 ×1, PLAN-08 ×5, PLAN-09 ×1, PLAN-09.1 ×1, docs/research/FEATURES-COMPARISON.md ×6, src/core/compat.test.mjs ×2, compat-full.test.mjs ×1, frontmatter.test.mjs ×1), `../vibe-kanban` → `refs/vibe-kanban` ×1 (FEATURES-COMPARISON.md).
- `.gitignore` — добавлена строка `refs/` (+ комментарий).
- `scripts/clone-refs.mjs` — **создан**: чистый Node.js, `git clone --depth 1` без install, 11 репозиториев (3 существующих + 8 новых), идемпотентный пропуск существующих, счётчик ошибок.
**Клонирование:** 8 новых репозиториев склонировано в `refs/` (typescript-sdk, mastra, pi, gemini-cli, opencode, cline, hermes-agent, openclaw), 3 пропущено (уже были). Повторный запуск: 11 пропусков — идемпотентность подтверждена.
**Документация:** через MCP `document_create` создан документ **doc-3** «Референсные проекты (refs/)» (тип guide, теги: референсы, refs, исследование, VL-76) с описаниями всех 11 проектов.
**Проверки:** `pnpm build` OK, `pnpm test` — **449/449** (compat-тесты читают `refs/Backlog.md`, на этой машине склонирован — проходят, не skip). `git check-ignore` подтверждает: `refs/` игнорируется. `grep` по старым путям `../Backlog.md`/`../vibe-kanban` вне `backlog/` и `refs/` — пусто.
**Отмечено:** AC #1–3, DoD #1–3.
**Что осталось:**
- Описания проектов `pi`, `hermes-agent`, `openclaw` — честные заглушки «уточнить при изучении» (по плану Фазы 2); документ doc-3 пополняется по мере изучения.
- Других использованных референс-проектов (вне npm-пакетов grammy/@dnd-kit/shadcn) не найдено — если вспомните иной, сообщите, пути и скрипт поменяем (пункт 2 задачи).
- Git commit/push не выполнялись (по правилам Фазы 3).
---
author:  @agent
created: 2026-10-04 23:53
---
Фаза Close выполнена. Статус: Done. Коммит feat: 616d728 — референсы в refs/: замена путей ../Backlog.md в AGENTS.md/планах/тестах, refs/ в .gitignore (10 файлов). scripts/clone-refs.mjs и docs/research/FEATURES-COMPARISON.md уже были закоммичены в 870dfbb.
---
<!-- COMMENTS:END -->