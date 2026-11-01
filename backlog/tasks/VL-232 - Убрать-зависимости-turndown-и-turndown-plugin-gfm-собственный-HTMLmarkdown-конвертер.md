---
id: VL-232
title: 'Убрать зависимости turndown и turndown-plugin-gfm: собственный HTML→markdown конвертер'
status: Spec
assignee: []
reporter: ''
created_date: '2026-10-30 00:35'
updated_date: '2026-10-30 00:35'
due_date: ''
labels:
  - core
  - refs
  - deps
dependencies:
  - VL-194
milestone: ''
references: []
priority: medium
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Зависимости `turndown ^7.2.4` и `turndown-plugin-gfm ^1.0.2` добавлены в VL-194 (локальный markdown-кэш references, ref-17). Используются ровно в одном месте — `htmlToMarkdown()` в `src/core/reference-cache.ts`. Больше по коду нигде не импортируются.

Сопутствующее:
- `turndown` тянет транзитивную зависимость `@mixmark-io/domino ^2.2.0` — полноценный HTML-DOM парсер (самая весомая часть дерева из-за этой фичи);
- `devDependencies.@types/turndown ^5.0.6` — ради типов;
- `src/types/turndown-plugin-gfm.d.ts` — ручная декларация (у пакета нет types);
- `tsconfig.json → esModuleInterop: true` появился именно из-за `@types/turndown` (стиль `export =`, в NodeNext-ESM без него default-импорт невозможен).

Проект позиционируется как «чистый Node.js, без нативных зависимостей» — свой конвертер сокращает дерево и число точек обновления.

## Цель

Заменить turndown + turndown-plugin-gfm собственным кодом и удалить обе зависимости (вместе с `@mixmark-io/domino`, `@types/turndown` и локальной d.ts), не ухудшив качество markdown-кэша.

## Что должен покрывать свой конвертер

Обязательный минимум (зафиксирован тестами VL-194):
- удаление мусора: `script`, `style`, `nav`, `footer`, `header`, `aside`, `form`, `button`, `iframe`, `svg`, `title`, `head`;
- заголовки `h1`–`h6` → atx (`#`, `##`, …);
- абзацы `p`, переносы `br`;
- списки `ul`/`ol`, включая вложенные (отступ на уровень);
- `pre`/`code` → fenced-блок, `code` inline → `` `…` ``;
- `blockquote` → `>`;
- ссылки `a` → `[text](href)`, изображения `img` → `![alt](src)`;
- GFM-таблицы: `th`/`td` → `| … |` + строка `| --- |`;
- GFM-дополнения: `strikethrough` → `~~…~~`, `taskListItems` → `- [ ]` / `- [x]`;
- декодирование HTML-энтити (`&amp;`, `&nbsp;`, `&lt;` и т.п.).

## Подход (предложение)

Не набор regex-замен (ломается на вложенности), а потоковый токенизатор со стеком открытых элементов: проход по тексту → открывающий/закрывающий тег/текст → вывод в буфер по текущему контексту. Отдельный модуль, напр. `src/core/html-to-markdown.ts`, с чистой функцией `htmlToMarkdown(html: string): string`; `reference-cache.ts` импортирует её (сигнатура сохраняется — вызывающий код не меняется).

## Известные риски

- Таблицы с `colspan`/`rowspan` и многострочным содержимым ячеек — определить поведение (упрощать: игнорировать span, содержимое в одну строку);
- вложенные списки и списки с `<p>` внутри `<li>` (лишние пустые строки);
- `<pre>` — сохранение отступов и отсутствие переноса строк внутри;
- HTML-энтити в code-блоках не должны декодироваться.

## Входные данные

Существующие тесты `src/core/reference-cache.test.mjs` (describe «VL-194 — htmlToMarkdown») фактически задают контракт: их нельзя ослаблять, они должны проходить на новом коде как есть.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 turndown, turndown-plugin-gfm и @types/turndown удалены из package.json и pnpm-lock.yaml; транзитивный @mixmark-io/domino отсутствует в дереве зависимостей
- [ ] #2 htmlToMarkdown реализован собственным кодом (без новых зависимостей), сигнатура и поведение для вызывающего кода сохранены
- [ ] #3 Все существующие тесты VL-194 в src/core/reference-cache.test.mjs проходят без ослабления проверок
- [ ] #4 Покрыты: удаление мусорных тегов, h1-h6 atx, p/br, вложенные ul/ol, fenced code + inline code, blockquote, a, img, GFM-таблицы, strikethrough, taskList, декодирование HTML-энтити
- [ ] #5 Добавлены юнит-тесты на вложенные списки, многострочные ячейки таблиц и pre с отступами
- [ ] #6 Удалены src/types/turndown-plugin-gfm.d.ts и devDependency @types/turndown; esModuleInterop из tsconfig убран, если не требуется сборкой
- [ ] #7 pnpm typecheck и полный pnpm test зелёные; pnpm install не тянет удалённые пакеты
- [ ] #8 Ручная проверка на 2-3 реальных URL: vibelog reference add --cache / reference sync даёт markdown не хуже прежнего
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->