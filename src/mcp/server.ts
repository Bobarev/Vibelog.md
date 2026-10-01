/**
 * MCP-сервер Vibelog.md (stdio, JSON-RPC 2.0).
 *
 * Протокол: JSON-RPC 2.0 поверх stdin/stdout.
 * Каждое сообщение — одна JSON-строка, завершающаяся \n.
 *
 * Методы:
 * - initialize — handshake, возвращает capabilities
 * - notifications/initialized — уведомление после handshake
 * - tools/list — список доступных инструментов
 * - tools/call — вызов инструмента
 *
 * Совместимый с Backlog.md по именам инструментов и формату ответов.
 */

import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handleToolCall, listTools } from './tools.js';
import type { ToolArgs } from './tools.js';

// Версия из package.json — чтобы не дублировать при релизах
const packageJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf-8'),
) as { version: string };

/** JSON-RPC id: число, строка или null (ошибки парсинга). */
type RpcId = number | string | null | undefined;

/** Входящее JSON-RPC сообщение. */
interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

/** Функция отправки JSON-RPC ответа. */
type SendResponse = (id: RpcId, result: unknown) => void;

/** Функция отправки JSON-RPC ошибки. */
type SendError = (id: RpcId, code: number, message: string, data?: unknown) => void;

/**
 * Запускает MCP-сервер.
 *
 * Читает JSON-RPC сообщения из stdin, обрабатывает и отвечает в stdout.
 *
 * @param cwd — рабочая директория проекта
 */
export function startMcpServer(cwd: string): void {
  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  // Отправляем JSON-RPC ответ
  function sendResponse(id: RpcId, result: unknown): void {
    const response = {
      jsonrpc: '2.0',
      id,
      result,
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  // Отправляем JSON-RPC ошибку
  function sendError(id: RpcId, code: number, message: string, data?: unknown): void {
    const response = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
        ...(data ? { data } : {}),
      },
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  // Обрабатываем входящее сообщение
  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: RpcMessage;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      sendError(null, -32700, 'Parse error');
      return;
    }

    // JSON-RPC 2.0 требует id для запросов
    // Уведомления (без id) не требуют ответа
    const { id, method, params } = msg;

    try {
      switch (method) {
        case 'initialize':
          handleInitialize(id, params, sendResponse);
          break;
        case 'notifications/initialized':
          // Уведомление — ответ не нужен
          break;
        case 'tools/list':
          handleToolsList(id, sendResponse);
          break;
        case 'tools/call':
          await handleToolsCall(id, params, cwd, sendResponse, sendError);
          break;
        case 'ping':
          sendResponse(id, {});
          break;
        default:
          if (id !== undefined) {
            sendError(id, -32601, `Method not found: ${method}`);
          }
      }
    } catch (err) {
      if (id !== undefined) {
        sendError(id, -32603, (err as Error).message);
      }
    }
  });

  rl.on('close', () => {
    // Не выходим через process.exit(0) сразу: вывод в pipe буферизуется,
    // и немедленный exit обрывает последний JSON-RPC ответ (гонка на close).
    // Пустая write-операция колбэкуется только после сброса всех очередных данных.
    process.stdout.write('', () => process.exit(0));
  });
}

/**
 * Обрабатывает метод initialize.
 *
 * Возвращает capabilities сервера и информацию о продукте.
 *
 * @param params — параметры запроса (в оригинале не используются)
 * @param send — функция отправки ответа
 */
function handleInitialize(id: RpcId, params: Record<string, unknown> | undefined, send: SendResponse): void {
  send(id, {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'vibelog-md',
      version: packageJson.version,
    },
  });
}

/**
 * Обрабатывает метод tools/list.
 *
 * Возвращает список доступных инструментов.
 *
 * @param send — функция отправки ответа
 */
function handleToolsList(id: RpcId, send: SendResponse): void {
  send(id, {
    tools: listTools(),
  });
}

/**
 * Обрабатывает метод tools/call.
 *
 * Вызывает инструмент по имени и возвращает результат.
 *
 * @param params — { name, arguments }
 * @param cwd — рабочая директория
 * @param send — функция отправки ответа
 * @param sendErr — функция отправки ошибки
 */
async function handleToolsCall(
  id: RpcId,
  params: Record<string, unknown> | undefined,
  cwd: string,
  send: SendResponse,
  sendErr: SendError
): Promise<void> {
  // Деструктуризация намеренно по оригиналу: undefined params → TypeError → -32603
  const { name, arguments: args } = params as { name?: string; arguments?: ToolArgs };

  if (!name) {
    sendErr(id, -32602, 'Missing tool name');
    return;
  }

  try {
    const result = await handleToolCall(name, args || {}, cwd);
    send(id, {
      content: [
        {
          type: 'text',
          text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        },
      ],
    });
  } catch (err) {
    send(id, {
      content: [
        {
          type: 'text',
          text: `Ошибка: ${(err as Error).message}`,
        },
      ],
      isError: true,
    });
  }
}
