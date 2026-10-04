---
id: VL-39
title: 'Telegram-бот: /task — полноценное отображение файла задачи (все секции, AC/DoD, комментарии)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 20:51'
updated_date: '2026-10-04 18:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.6
references: []
priority: medium
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Уточнение Pavel (2026-10-02): /task показывает summary-карточку. Нужно полноценное отображение файла задачи через **Rich Messages** (sendRichMessage), НЕ MarkdownV2 sendMessage.

**Исследование API (core.telegram.org, 2026-10-02):**
- Метод `sendRichMessage(chat_id, rich_message: InputRichMessage)`; InputRichMessage = { markdown | html | blocks (ровно одно), media?, skip_entity_detection? }.
- Rich Markdown = GFM: **bold**, # заголовки, ~~strike~~, ==marked==, таблицы, task lists, blockquotes, details. Лимит 32768 символов (вместо 4096!), 500 блоков, 16 уровней вложенности.
- **grammy 1.46.0 имеет sendRichMessage нативно** (api.d.ts:167) — ctx.api.sendRichMessage(chatId, { markdown }).
- Ключевое преимущество: markdown-файлы задач уже GFM-совместимы — тело показывается почти без потерь (заголовки секций = #, AC/DoD = task lists [x]/[ ], план = текст/блоки, комментарии = блоки).

Формат: /task <id> → sendRichMessage с Rich Markdown (frontmatter вырезан; секции опускаются, если пусты; AC/DoD — task lists с отметками; комментарии — author: date + текст). Фолбэк при ошибке sendRichMessage → текущий sendMd-путь (MarkdownV2 summary).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Команда /task <id> показывает карточку задачи полноценно: заголовок, статус/приоритет/исполнителей/метки/срок, секции Implementation Plan и Implementation Notes (если заполнены), комментарии — каждая секция с собственным заголовком
- [x] #2 Длинные секции разбиваются на несколько сообщений (лимит Telegram 4096 символов); спецсимволы MarkdownV2 в контенте экранированы
- [x] #3 Юнит-тесты разбивки на части + pnpm test без регрессий; ручная проверка в Telegram на VL-34 (есть plan/notes) и VL-25 (много комментариев)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Факты

- grammy 1.46.0: `ctx.api.sendRichMessage(chatId, { markdown: string })` — нативная типизация (api.d.ts:167), возврат Message.RichMessageMessage.
- Rich Markdown (GFM): **bold**, # H1..H6, ~~strike~~, ==marked==, ||spoiler||, таблицы, task lists, > blockquotes, ``` code. Лимит 32768 символов / 500 блоков — лимит 4096-символьной разбивки отпадает (но safeguard на >32000 оставляем).
- Структура Task (src/core/task.ts): acceptanceCriteria[{text,checked}], definitionOfDone[{text,checked}], comments[{author,created,text}], секции plan/notes/finalSummary (implementationPlan и др. поля через markdownToTask).
- Rich Markdown НЕ требует MarkdownV2-экранирования (GFM-специальные последовательности просты); контент из файлов вставляется как есть, но генерируемые служебные строки экранируем по минимуму (в GFM спецсимволы разрешены в тексте).

## Изменяемые/создаваемые файлы

### 1. src/bot/rich.ts (новый, чистые функции)
- `renderTaskRich(task: Task): string` — собирает Rich Markdown:
  - Шапка: `# {id} — {title}`, строка меты: статус/приоритет/исполнители/метки/срок (жирные метки).
  - `## Описание` — description (если есть).
  - `## Acceptance Criteria` — task list: `- [x] текст` / `- [ ] текст`.
  - `## Definition of Done` — аналогично.
  - `## Implementation Plan`, `## Implementation Notes`, `## Final Summary` — если заполнены.
  - `## Комментарии` — каждый: `**{author}** · {created}` + текст отдельным абзацем.
  - Пустые секции не выводятся; порядок — как в файле.
- `chunkRich(text, limit=32000)`: string[] — safeguard: разбивка по границам абзацев/секций (на практике не задействуется).

### 2. src/bot/handlers.ts
- /task: `const rich = renderTaskRich(task)` → `await ctx.api.sendRichMessage(ctx.chat.id, { markdown: rich })`.
- Фолбэк: catch → текущий путь sendMd(ctx, formatTaskDetail(task)) (summary остаётся запасным).
- /tasks и /board остаются на MarkdownV2 (краткие ответы, sendRichMessage избыточен).

### 3. Тесты: src/bot/rich.test.mjs
- renderTaskRich: шапка, task list AC с [x]/[ ], опускание пустых секций, комментарии, меты.
- chunkRich: порог 32000, границы абзацев.

### 4. CHANGELOG [Unreleased]
- «VL-39: /task — Rich Messages (sendRichMessage, GFM): все секции задачи, AC/DoD-чек-листы, комментарии».

## Порядок действий
1. rich.ts + rich.test.mjs → pnpm test.
2. handlers.ts (sendRichMessage + фолбэк) → pnpm build + test.
3. CHANGELOG.
4. Перезапуск бота → ручная проверка (см. ниже).

## Верификация
- pnpm test — все + новые зелёные.
- Ручной (chrome-проверка не нужна — Telegram): /task VL-34 (plan/notes заполнены) → сообщение с заголовками и секциями; /task VL-25 (много комментариев, длинный description) → полное отображение; /task VL-10000 → фолбэк-сообщение «не найдена»; /tasks /board — без изменений.

## Риски
1. **Клиент Telegram**: Rich Messages поддерживают новые клиенты; старые могут показать заглушку — фолбэк-путь закрывает (catch → sendMd).
2. **Синтаксис GFM из файлов**: description может содержать ``` (блок кода) — сломает структуру; mitigation: в renderTaskRich оборачиваем description в литеральные блоки аккуратно (экранируем ``` внутри текста как \`\`\` или показываем без обёртки, если контент самодостаточен); тест на description с ```. 
3. **32768 лимит**: большие задачи (VL-25 description ~7КБ) — в пределах; safeguard chunkRich на >32000.
4. **ctx.api vs bot.api**: используем ctx.api (тот же Api-инстанс с нашим прокси-fetch) — прокси сохраняется.
<!-- SECTION:PLAN:END -->