---
id: doc-3
title: Референсные проекты (backlog/references/)
type: guide
created_date: 2026-10-04
tags:
  - референсы
  - refs
  - references
  - исследование
  - VL-76
  - VL-152
---
# Референсные проекты (backlog/references/)

Локальные клоны референсных проектов, используемых как источники знаний при разработке Vibelog.md. Метаданные — `backlog/references/*.md` (в git), клоны — `backlog/references/data/` (в `.gitignore`, в git не попадают). Управление референсами — `vibelog reference ...` (VL-152).

Синхронизация клонов одной командой:

```
vibelog reference sync
```

Команда делает `git clone --depth 1` отсутствующих репозиториев (без install/build — референсы читаются, не запускаются), идемпотентно пропускает уже существующие клоны. Полный список: 12 репозиториев (ref-1..ref-12).

Документ пополняется по мере изучения референсов — при находках, отличающихся от других проектов, добавляйте сюда.

## 1. Backlog.md (MrLesk) — ref-1

**Локально:** `backlog/references/data/Backlog.md`

Оригинальный markdown-нативный таск-менеджер для git-репозиториев. **Эталон совместимости данных** для Vibelog.md: структура папок `backlog/`, формат frontmatter задач, yaml-конфиг. CLI, MCP-инструменты, web-интерфейс.

Реализован на TypeScript + Bun — нативный рантайм, который не запускается на macOS 10.15 Catalina. Именно поэтому существует Vibelog.md.

## 2. vibe-kanban (BloopAI) — ref-3

**Локально:** `backlog/references/data/vibe-kanban`

Оркестратор AI-агентов с kanban-UI (Rust + TypeScript). Источник идей по воркфлоу оркестрации агентов.

Проект закрывается (sunset) — опыт переиспользуем.

## 3. next-shadcn-admin-dashboard (arhamkhnz) — ref-2

**Локально:** `backlog/references/data/next-shadcn-admin-dashboard`

Admin-дашборд на Next.js + shadcn/ui. Референс UI web-интерфейса Vibelog.md.

## 4. typescript-sdk (modelcontextprotocol) — ref-4

**Локально:** `backlog/references/data/typescript-sdk`

Официальный MCP SDK для TypeScript. Референс для реализации `src/mcp/` — транспорт, схемы инструментов, протокольные детали.

## 5. mastra (mastra-ai) — ref-5

**Локально:** `backlog/references/data/mastra`

AI-фреймворк на TypeScript: агенты, workflows, RAG. Референс по архитектуре AI-приложений.

## 6. pi (earendil-works) — ref-6

**Локально:** `backlog/references/data/pi`

AI CLI-ассистент. Описание уточнить при изучении.

## 7. gemini-cli (google-gemini) — ref-7

**Локально:** `backlog/references/data/gemini-cli`

CLI-агент Google на TypeScript. Референс CLI/TUI-опыта и интеграции с LLM.

## 8. opencode (anomalyco) — ref-8

**Локально:** `backlog/references/data/opencode`

Open-source AI-код-агент с TUI. Референс по интерактивным CLI-агентам.

## 9. cline (cline) — ref-9

**Локально:** `backlog/references/data/cline`

AI-код-агент для VS Code. Референс по agent-воркфлоу (tool use, approval-циклы).

## 10. hermes-agent (NousResearch) — ref-10

**Локально:** `backlog/references/data/hermes-agent`

AI-агент NousResearch. Описание уточнить при изучении.

## 11. openclaw (openclaw) — ref-11

**Локально:** `backlog/references/data/openclaw`

Open-source AI-агент. Описание уточнить при изучении.

## 12. qwen-code (QwenLM) — ref-12

**Локально:** `backlog/references/data/qwen-code`

Официальный Qwen Code — CLI-ассистент на базе gemini-cli (форк google-gemini/gemini-cli, TypeScript + Ink). **Добавлен по запросу Pavel (VL-77, Фаза Comment, 2026-10-04)** — добавочно к списку VL-76.

Для VL-75 это референс особого рода: **qwen-code — текущий целевой агент оркестратора Vibelog** (spawn через `VIBELOG_QWEN_BIN` || 'qwen', контракт stdout `src/web/qwen-result.ts`). Новый vibelog-agent — его замена; изучение qwen-code раскрывает:

- как устроен текущий headless-режим (`--output-format json`, формат NDJSON `type=result` с usage/токенами — источник контракта parseQwenResult);
- TUI на Ink (общие корни с gemini-cli, backlog/references/data/gemini-cli §7 doc-3 — паттерны из §4.1 doc-4 переиспользуемы);
- интеграция MCP-серверов (конфиг .qwen/settings.json, spawn `vibelog mcp start`) — поведение, которое vibelog-agent должен воспроизвести headless-контрактом.

Особенности уточнить при изучении клона (структура packages/, agent loop, JSON-адаптер 0.24.x).

---

## Уточнение (VL-76, 2026-10-04)

Других использованных референс-проектов в репозитории не найдено: grammy, @dnd-kit, shadcn — npm-пакеты, а не референс-проекты. Если вспомните иной использованный референс — сообщите, добавим через `vibelog reference add` и сюда.

## Обновление (VL-152, 2026-10-14)

Референсы переехали из `refs/` в `backlog/references/` (VL-152, Вариант A): метаданные — `backlog/references/ref-N-*.md` (в git), клоны — `backlog/references/data/` (в .gitignore). Скрипт `scripts/clone-refs.mjs` удалён — его логика переехала в `vibelog reference add --type repo` (сам клонирует) и `vibelog reference sync` (доклонировать отсутствующие). Двусторонняя связь с задачами: `vibelog reference link ref-N VL-M` (linked_tasks ↔ task.references). Plan-фаза читает references задачи, Code-фаза добавляет новые — см. doc-6.