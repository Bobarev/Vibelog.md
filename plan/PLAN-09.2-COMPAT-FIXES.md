# PLAN-09.2: Исправление расхождений с Backlog.md

## Найдено в процессе работы над LB-4

### Баг A: Final Summary (Optional)

Vibelog пишет `## Final Summary (Optional)`, но в оригинале Backlog.md
`SECTION_TITLE_VARIANTS` не содержит алиаса для Final Summary. Только базовый
`## Final Summary`.

**Файл:** src/core/task.mjs — генерация заголовка Final Summary.
**Fix:** убрать суффикс `(Optional)`.

### Баг B: drift документации MCP

tools.mjs описывает `plan` как «записывает в ## Implementation Plan»,
а writer пишет `## Implementation Plan (Optional)`. Документация и поведение
расходятся.

**Fix:** синхронизировать. Либо убрать `(Optional)` из writer (предпочтительно
для чистоты), либо поправить описание.

### Баг C: frontmatter — неполный набор полей

Vibelog пишет только непустые поля. Оригинал пишет полный набор, включая
пустые массивы (`assignee: []`, `labels: []`, `dependencies: []`) и
lowercase priority (`high`, не `High`).

**Файл:** src/core/task.mjs — taskToMarkdown.
**Fix:** писать полный набор полей. Priority в lowercase.

## AC

- [x] `## Final Summary` без `(Optional)`
- [x] Документация MCP синхронизирована с writer
- [x] Frontmatter пишется полным набором полей
- [x] Priority в lowercase
- [x] Round-trip с оригиналом сохраняется
- [x] Тесты на все три бага