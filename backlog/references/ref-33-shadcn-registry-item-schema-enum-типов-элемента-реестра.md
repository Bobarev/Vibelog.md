---
id: ref-33
title: shadcn registry-item schema (enum типов элемента реестра)
type: url
url: 'https://ui.shadcn.com/schema/registry-item.json'
tags:
  - реестр
  - shadcn
  - registry
  - schema
  - vl-426
created_date: 2026-11-18
linked_tasks:
  - VL-426
---
Официальная JSON-схема элемента реестра shadcn, на которую ссылается `$schema` в `registry.json` реестров формата shadcn (в т.ч. Vibelog-md/ui). Источник истины по enum типов элемента: `registry:lib`, `registry:block`, `registry:component`, `registry:ui`, `registry:hook`, `registry:theme`, `registry:page`, `registry:file`, `registry:style`, `registry:base`, `registry:font`, `registry:item` (поле `type`, тот же enum у `files[].type`). Сверено в VL-426: `registry:block` — валидный тип shadcn; белый список Vibelog.md (doc-25 §3.3) расширен им осознанно, остальные типы схемы — «не поддерживаются v1».