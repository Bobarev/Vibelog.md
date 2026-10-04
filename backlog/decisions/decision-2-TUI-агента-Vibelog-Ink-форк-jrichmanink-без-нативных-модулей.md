---
id: decision-2
title: 'TUI агента Vibelog — Ink (форк @jrichman/ink), без нативных модулей'
date: 2026-10-04
status: proposed
---
## Context

VL-75: TUI на Ink. Референсы: refs/gemini-cli — package.json:82/155 'ink': 'npm:@jrichman/ink@6.6.9' (форк, без нативных модулей) + react 19.2.x; TUI-слой packages/cli/src/ui/ (App.tsx, components/, hooks/useGeminiStream.ts — стриминг событий, processGeminiStreamEvents, счётчики StatsDisplay.tsx:106-131 — cachedTokens/inputTokens/outputTokens, duration). refs/opencode — packages/tui использует @opentui/solid (другой рендерер, не Ink).
## Decision

TUI агента Vibelog — Ink (тот же форк @jrichman/ink@6.6.9, что в gemini-cli) + React. Переиспользовать паттерны gemini-cli: события стриминга → хук вида useGeminiStream, отображение tool calls отдельными сообщениями, счётчики токенов/времени в статусной строке (StatsDisplay/ContextUsageDisplay).
## Consequences

Проверенный на macOS стек без нативных модулей (требование Catalina); React-экосистема знакома по web-интерфейсу Vibelog. Ограничение: gemini-cli использует ACP-протокол для gemini — нам нужен свой tool-calling loop, TUI-слой берём только как рендер-референс.
## Alternatives

@opentui/solid (opencode packages/tui) — modern-рендерер, но другая парадигма (Solid), не совпадает с выбранным React; blessed/neo-blessed — устаревшие, без активного сообщества; свой рендерер — неоправданно для MVP.