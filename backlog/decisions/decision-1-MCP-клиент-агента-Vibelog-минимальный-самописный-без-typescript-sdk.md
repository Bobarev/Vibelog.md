---
id: decision-1
title: MCP-клиент агента Vibelog — минимальный самописный (без typescript-sdk)
date: 2026-10-04
status: proposed
---
## Context

VL-75: агенту Vibelog нужен MCP-клиент для сервера vibelog mcp start. Сервер: JSON-RPC 2.0 newline-delimited (src/mcp/server.ts:116-125), protocolVersion 2024-11-05, capabilities только tools, 21 инструмент. Референс refs/typescript-sdk: StdioClientTransport (packages/client/src/client/stdio.ts:107) спавнит процесс, ReadBuffer (packages/core-internal/src/shared/stdio.ts) фреймит stdout по переводу строки — serializeMessage = JSON.stringify + '\n'. Фрамировка идентична vibelog mcp start.
## Decision

Минимальный самописный MCP-stdio-клиент: child_process.spawn (stdio pipe), newline-delimited JSON-RPC, методы initialize / notifications/initialized / tools/list / tools/call / ping, ответ tools/call — {content:[{type:'text',text}], isError?}. Без @modelcontextprotocol/sdk.
## Consequences

Нет новых зависимостей (Node 20+, без нативных модулей, требования Catalina); полный контроль над протоколом и таймаутами; контракт покрывается тестами на fixtures JSON-RPC. Ограничение: нет resources/prompts/subscriptions — серверу Vibelog не нужны (capabilities только tools).
## Alternatives

typescrit-sdk @modelcontextprotocol/sdk (StdioClientTransport + Client): готовый handshake, валидация схем, транспортные таймауты; но тянет зависимости (cross-spawn, zod-подобные схемы), избыточно для 21 инструмента и tools-only capabilities; подключение SDK не даёт функций, которых нет у vibelog mcp start.