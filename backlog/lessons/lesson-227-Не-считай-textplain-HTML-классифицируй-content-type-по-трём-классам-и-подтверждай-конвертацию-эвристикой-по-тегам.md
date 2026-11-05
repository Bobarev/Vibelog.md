---
id: lesson-227
title: 'Не считай text/plain HTML: классифицируй content-type по трём классам и подтверждай конвертацию эвристикой по тегам'
status: active
tags:
  - reference
  - content-type
  - markdown
  - html
  - cache
source_tasks:
  - VL-344
linked_tasks:
  - VL-344
created_date: 2026-11-05
updated_date: 2026-11-05
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

`classifyContentType` в `src/core/reference-cache.ts` знал два класса — `markdown` и `html`, — и всё, что начиналось с `text/`, уходило в `htmlToMarkdown()`. GitVerse raw отдаёт `.md`-файлы как `text/plain`, поэтому markdown-документ конвертировался как HTML: экранировался синтаксис (`---` → `\---`, `**жирный**` → `\*\*жирный\*\*`), выбрасывались плейсхолдеры `<name>`/`<template>` как неизвестные теги, а все переводы строк схлопывались в один пробел — документ превращался в одну нечитаемую строку.

## Решение

Классифицируй content-type по трём классам: `markdown` (сохранять как есть), `text` (прочие `text/*`, включая `text/plain` — сохранять как есть), `html` (`text/html`, `application/xhtml+xml`, пустой — конвертировать). Параметры (`; charset=utf-8`) отрезай до сравнения. Конвертацию подтверждай эвристикой по содержимому (`looksLikeHtml`: два разных HTML-признака в первых 2 КБ), а не только по заголовку — сервер может соврать в обе стороны. Версию конвертера включай в `source_hash` (`sha256(raw + '\0' + CONVERTER_VERSION)`), иначе испорченные кэши не перезапишутся: сырой ответ не изменился — хэш совпал.

## Пример

```ts
const ct = (contentType || '').toLowerCase().split(';')[0].trim();
if (ct === '') return 'html';
if (ct.includes('markdown')) return 'markdown';
if (ct.includes('html')) return 'html';
if (ct.startsWith('text/')) return 'text';   // text/plain — НЕ html
throw new Error(`неподдерживаемый content-type: ${contentType}`);
```

Тест-регрессия: markdown-строка с `---`, `**жирный**`, `[0]`, `vb create <name> --template <alias>/<repo>/<template>`, отданная как `text/plain`, должна сохраниться байт-в-байт (плюс завершающий `\n`), без `\*`/`\[`/`\---` и с переводами строк на месте.
