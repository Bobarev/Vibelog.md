---
id: ref-3
title: vibe-kanban
type: repo
url: 'https://github.com/BloopAI/vibe-kanban.git'
path: data/vibe-kanban
tags:
  - orchestration
  - kanban
  - agents
created_date: 2026-10-14
linked_tasks: []
---
Канбан-оркестратор AI-агентов (React + Rust backend) — референс канбана и диалогов.

**Модалки (для VL-163):** `packages/ui/src/components/` содержит собственный Dialog.tsx (примитив) и множество готовых диалогов: ConfirmDialog.tsx, CreateRepoDialog.tsx, RenameWorkspaceDialog.tsx, DeleteWorkspaceDialog.tsx, KeyboardDialog.tsx, ErrorDialog.tsx, GuideDialogShell.tsx — референс паттерна «один примитив + специализированные обёртки».