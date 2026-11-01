---
id: lesson-137
title: В HTML один pre может содержать несколько code — рендери каждый отдельным fenced-блоком
status: active
tags:
  - html
  - markdown
  - html-to-markdown
  - reference-cache
source_tasks:
  - VL-232
linked_tasks:
  - VL-232
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

Разметка подсветки кода (nodejs.org, shiki) кладёт в один `<pre>` несколько `<code class="language-mjs">…</code><code class="language-cjs">…</code>` — это переключатель вариантов примера. Конвертер, который берёт из `pre` только первый (или только последний) `code` либо склеивает их в один блок, теряет целые примеры кода: на `https://nodejs.org/api/fs.html` пропало 23 строки CJS-примеров (включая `require(...)` и `function(path)`).

## Решение

При рендере `pre` собирай **все** дочерние `code`, каждый — собственным fenced-блоком с языком из его `class` (`language-x`/`lang-x`), блоки соединяй пустой строкой; UI-обвязку внутри `pre` (`input`, `div.code-language`, `button`) не выводи. Проверяй не только синтетическими кейсами, но и сравнением «до/после» на реальной странице: нормализуй старый и новый вывод (убрать пробелы и markdown-разметку) и проверь, что каждая уникальная строка старого вывода встречается в новом.

## Пример

VL-232: замена turndown собственным конвертером; первый вариант брал `children.find(tag === 'code')` — сравнение со снимком turndown на `<pre>` со сдвоенным `code` показало потерю CJS-примеров; `codeChildren.map(renderCodeFence)` + нормализованный diff по строкам кода дал 0 потерянных строк на обоих проверяемых URL.