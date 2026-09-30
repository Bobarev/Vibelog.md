/**
 * MCP-сервер Vibelog.md (stdio, JSON-RPC 2.0).
 *
 * Протокол: JSON-RPC 2.0 поверх stdin/stdout.
 * Каждое сообщение — одна JSON-строка, завершающаяся \n.
 *
 * Методы:
 * - initialize —.handshake, возвращает capabilities
 * - notifications/initialized — уведомление после handshake
 * - tools/list — список доступных инструментов
 * - tools/call — вызов инструмента
 *
 * Совместимый с Backlog.md по именам инструментов и формату ответов.
 */

import { createInterface } from 'node:readline';
import { handleToolCall, listTools } from './tools.mjs';

/**
 * Запускает MCP-сервер.
 *
 * Читает JSON-RPC сообщения из stdin, обрабатывает и отвечает в stdout.
 *
 * @param {string} cwd — рабочая директория проекта
 */
export function startMcpServer(cwd) {
  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  // Отправляем JSON-RPC ответ
  function sendResponse(id, result) {
    const response = {
      jsonrpc: '2.0',
      id,
      result,
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  // Отправляем JSON-RPC ошибку
  function sendError(id, code, message, data) {
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
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg;
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
        sendError(id, -32603, err.message);
      }
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

/**
 * Обрабатывает метод initialize.
 *
 * Возвращает capabilities сервера и информацию о продукте.
 *
 * @param {number|string} id — JSON-RPC id
 * @param {object} params — параметры запроса
 * @param {function} send — функция отправки ответа
 */
function handleInitialize(id, params, send) {
  send(id, {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'vibelog-md',
      version: '0.1.0',
    },
  });
}

/**
 * Обрабатывает метод tools/list.
 *
 * Возвращает список доступных инструментов.
 *
 * @param {number|string} id — JSON-RPC id
 * @param {function} send — функция отправки ответа
 */
function handleToolsList(id, send) {
  send(id, {
    tools: listTools(),
  });
}

/**
 * Обрабатывает метод tools/call.
 *
 * Вызывает инструмент по имени и возвращает результат.
 *
 * @param {number|string} id — JSON-RPC id
 * @param {object} params — { name, arguments }
 * @param {string} cwd — рабочая директория
 * @param {function} send — функция отправки ответа
 * @param {function} sendErr — функция отправки ошибки
 */
async function handleToolsCall(id, params, cwd, send, sendErr) {
  const { name, arguments: args } = params;

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
          text: `Ошибка: ${err.message}`,
        },
      ],
      isError: true,
    });
  }
}
