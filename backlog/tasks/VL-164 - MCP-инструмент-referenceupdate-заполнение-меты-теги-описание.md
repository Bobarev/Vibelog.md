---
id: VL-164
title: MCP инструмент reference_update — обновление тегов и описания
status: Done
assignee: []
reporter: ''
created_date: '2026-10-15 08:28'
updated_date: '2026-10-25 10:15'
due_date: ''
labels:
  - core
  - mcp
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
  - src/mcp/tools.ts
  - src/mcp/reference-tools.test.mjs
  - src/mcp/documents.test.mjs
  - src/mcp/server.test.mjs
  - src/core/compat-full.test.mjs
  - src/cli/commands/doctor.ts
  - src/cli/diagnostics.test.mjs
  - MCP-SETUP.md
lessons:
  - lesson-10
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
MCP инструмент reference_update — заполнение меты (теги, описание) у существующих references.

В Vibelog есть набор MCP-инструментов для ссылок (reference_add, reference_link, reference_list, reference_search, reference_view, reference_remove), но обновление метаданных уже существующей ссылки невозможно. Нужен инструмент reference_update, который позволяет менять теги и описание у существующей reference.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Инструмент reference_update доступен через MCP и принимает id ссылки (ref-N)
- [x] #2 reference_update корректно обновляет теги ссылки (полная замена списка tags)
- [x] #3 reference_update корректно обновляет описание ссылки (полная замена body/description)
- [x] #4 Обновлённые метаданные сохраняются в файле reference и видны через reference_view / reference_list
- [x] #5 При несуществующем id возвращается понятное сообщение об ошибке на русском
- [x] #6 Документация MCP-инструментов обновлена с учётом reference_update
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План: MCP-инструмент reference_update (VL-164)

## Контекст

Core-слой уже готов: `updateReference(cwd, id, updates)` в `src/core/reference.ts:254` поддерживает обновление tags, content (тело/описание), title и др. с полной заменой; возвращает `null` при несуществующем id. Тип `UpdateReferenceInput` и функция `updateReference` уже импортированы в `src/mcp/tools.ts` (строки 36, 40). Нужен только MCP-слой: описание инструмента, dispatch, хендлер, тесты, документация.

Образец для хендлера — `toolLessonUpdate` (`src/mcp/tools.ts:1484`): сбор updates → ошибка «Не указаны поля…» → вызов core-функции → ошибка «не найден» → success-строка.

## Файлы для изменения

### 1. `src/mcp/tools.ts` — 3 правки

**а) Описание инструмента.** Вставить блок `{ name: 'reference_update', ... }` между `reference_remove` (заканчивается строкой 454) и `reference_link` (строка 455), по образцу остальных reference-инструментов:

```ts
{
  name: 'reference_update',
  description: 'Обновить reference: теги и/или описание (полная замена).',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID reference (ref-N)' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Метки (полная замена)' },
      description: { type: 'string', description: 'Описание (markdown, полная замена тела)' },
    },
    required: ['id'],
  },
},
```

**б) Dispatch.** После `case 'reference_remove':` (строки 630-631) вставить:

```ts
case 'reference_update':
  return toolReferenceUpdate(args, cwd);
```

**в) Хендлер.** После функции `toolReferenceRemove` (заканчивается строкой ~1428, перед `toolReferenceLink`) добавить `toolReferenceUpdate`:

```ts
function toolReferenceUpdate(args: ToolArgs, cwd: string): string {
  const updates: UpdateReferenceInput = {};
  if (args.tags !== undefined) updates.tags = args.tags as string[];
  if (args.description !== undefined) updates.content = args.description as string;
  if (Object.keys(updates).length === 0) {
    throw new Error('Не указаны поля для обновления (tags, description).');
  }
  const entry = updateReference(cwd, args.id as string, updates);
  if (!entry) throw new Error(`Reference ${args.id} не найден.`);
  return `Reference ${entry.reference.id} обновлён: ${Object.keys(updates).join(', ')}`;
}
```

Важно: имя MCP-параметра — `description` (как в `reference_add`), маппится в `UpdateReferenceInput.content`. Полная замена обоих полей (не merge) — семантика core `updateReference`.

### 2. `src/mcp/reference-tools.test.mjs` — обновить счётчики + новые тесты

- Строка 53-55: «все 7 reference_* … всего 36» → «все 8 reference_* … всего 37»; `assert.equal(tools.length, 36)` → `37`.
- Строка 57: добавить `'reference_update'` в список имён.
- Новый `describe('VL-164 — reference_update')`:
  1. add ref с tags ['a','b'] и description → `reference_update {id, tags: ['c']}` → `reference_view`: tags === ['c'] (полная замена, 'a'/'b' нет) — AC2, AC4;
  2. `reference_update {id, description: 'Новое тело'}` → view: body === 'Новое тело' — AC3, AC4;
  3. `reference_list` показывает обновлённый reference — AC4;
  4. `assert.rejects(..., /не найден/)` для `id: 'ref-999'` — AC5;
  5. `assert.rejects(..., /Не указаны поля/)` при вызове только с id.

### 3. `src/mcp/documents.test.mjs` — счётчик инструментов

- Строка 8 (комментарий), 59 (заголовок теста): 29/36 → 37.
- Строка 61: `assert.equal(tools.length, 37)`.

### 4. `src/mcp/server.test.mjs` — счётчик инструментов

- Строка 129 (заголовок) и 136: 36 → 37.

### 5. `src/core/compat-full.test.mjs` — реестр совместимости

- Строка 179 (заголовок) и 182: `tools.length` 36 → 37.
- В массив `expected` после `'reference_sync'` (строка 218) добавить `'reference_update'` с комментарием `// VL-164`.

### 6. `MCP-SETUP.md` — таблица инструментов

После строки 32 (`| reference_remove | … |`) добавить строку:
`| `reference_update` | Обновить теги/описание reference (полная замена) |`

### 7. Документ `doc-8` (MCP-справочник) — через MCP `document_update`

В раздел references (после секции `### reference_view`, строка 255-262) добавить секцию `### reference_update — обновить метаданные`: назначение, параметры (id, tags?, description?), семантика полной замены, ошибка при несуществующем id. Файл `backlog/docs/doc-8-…` править ТОЛЬКО через MCP `document_update {"id": "doc-8", ...}` (backlog/ не правится файлово).

## Порядок выполнения

1. Правки в `src/mcp/tools.ts` (описание → dispatch → хендлер).
2. Тесты `reference-tools.test.mjs` (счётчики + новые кейсы).
3. Счётчики в `documents.test.mjs`, `server.test.mjs`, `compat-full.test.mjs`.
4. `pnpm build && pnpm test:fast` — быстрая итерация.
5. Документация: `MCP-SETUP.md` (файлово) + doc-8 (через MCP `document_update`).
6. Финальный прогон `pnpm test` (DoD: тесты проходят, нет регрессий).

## Проверка

```bash
pnpm build
pnpm test:fast    # после правок кода
pnpm test         # финальный прогон (build + vitest run)
```

Ручная проверка AC1-AC5 — новыми тестами в `reference-tools.test.mjs` (регистрация, tags, description, view/list, ошибки).

## Риски

- **Счётчик 36→37 продублирован в 4 файлах** (`reference-tools`, `documents`, `server.test`, `compat-full`) — пропуск любого уронит тесты. Все 4 правятся в шаге 3.
- **Имя параметра**: в MCP — `description` (единообразие с `reference_add`), в core — `content`; не перепутать при маппинге.
- **doc-8 живёт в backlog/** — файловая правка уйдёт не в то хранилище; только MCP `document_update`.
- Core `updateReference` поддерживает также title/type/url/path — НЕ выносим в эту задачу (вне AC); при необходимости расширить позже одной строкой в хендлере и схеме.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-15 08:34
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «MCP инструмент reference_update — обновление тегов и описания». Масштаб: task. Уточнено: добавлен контекст (в Vibelog есть набор MCP-инструментов reference_*, но обновление метаданных существующей ссылки невозможно), определено поведение (полная замена tags и description, сообщение об ошибке при несуществующем id, сохранение в файле reference), добавлено требование документации. Labels: core, mcp. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-15 08:46
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в Implementation Plan: 7 файлов. Ключевые решения: core-функция updateReference (src/core/reference.ts:254) уже готова — расширяется только MCP-слой src/mcp/tools.ts (описание reference_update между reference_remove/reference_link ~стр.454, dispatch ~стр.631, хендлер toolReferenceUpdate ~стр.1429 по образцу toolLessonUpdate); MCP-параметр description маппится в UpdateReferenceInput.content; полная замена tags/description. Тесты: reference-tools.test.mjs (счётчик 36→37, +5 кейсов VL-164), счётчики инструментов в documents.test.mjs, server.test.mjs, compat-full.test.mjs (+ 'reference_update' в expected). Документация: MCP-SETUP.md (таблица) + doc-8 через MCP document_update. Проверка: pnpm build && pnpm test. Риски: счётчик инструментов продублирован в 4 тест-файлах; doc-8 в backlog/ правать только через MCP. AC отмечены как запланированные (1-5 покрыты планом; AC6 — документация — в шагах 5-6 плана).
---
author: @agent
created: 2026-10-15 08:58
---
Фаза 3 (Code) выполнена. Изменено: src/mcp/tools.ts (описание reference_update, dispatch, хендлер toolReferenceUpdate — MCP-параметр description → UpdateReferenceInput.content, ошибки «Не указаны поля…»/«не найден»), src/mcp/reference-tools.test.mjs (+4 теста VL-164: полная замена tags, замена body, ошибки; счётчик 36→37), счётчики инструментов в src/mcp/documents.test.mjs, src/mcp/server.test.mjs, src/core/compat-full.test.mjs (+'reference_update' в expected), src/cli/commands/doctor.ts и src/cli/diagnostics.test.mjs (mcp_tools_count 36→37 — вне плана, пойман прогоном тестов), MCP-SETUP.md (строка в таблице), doc-8 обновлён через MCP document_update (секция reference_update + счётчик 37 + пример). Проверки: pnpm build && pnpm test:fast — 65 файлов/1121 тест passed, 4 skipped; doctor-тесты теперь зелёные. Коммит 8a8ac3a (8 файлов, +90/−13). Что осталось: references/lessons задачи пусты — источники не использовались, lessons не создавались.
---
author: @agent
created: 2026-10-15 09:06
---
Фаза Close выполнена. Ветка vb/vl-164 слита в master (--no-ff, 1 коммит 8a8ac3a + merge-коммит), worktree удалена (--force: только untracked-симлинки node_modules/refs), ветка удалена. После merge в главном репо: pnpm build && pnpm test — сборка и все тесты прошли (exit 0), регрессий нет. DoD: все 3 пункта выполнены (тесты проходят, документация обновлена — CHANGELOG + MCP-SETUP.md + doc-8, нет регрессий). Документация: запись в CHANGELOG.md (Unreleased → Добавлено), коммит fb5f3ab. Урок lesson-10 (счётчик MCP-инструментов продублирован в doctor.ts вне плана) связан с задачей.
---
<!-- COMMENTS:END -->