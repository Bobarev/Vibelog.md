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
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handleToolCall, listTools } from './tools.js';
import { isUpstreamConfigured } from '../core/gitverse-issues.js';
import { tmpFile } from '../core/tmp.js';
import type { ToolArgs } from './tools.js';

// Версия из package.json — чтобы не дублировать при релизах
const packageJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf-8'),
) as { version: string };

/**
 * Журнал RPC (диагностика задержек VL-58): таймлайн in/out сообщений.
 *
 * VL-329: файл живёт в `.vibelog/tmp/` проекта, а не в системном tmpdir —
 * единое место временных артефактов проекта (core/tmp.ts), которое не
 * попадает в git.
 */
let rpcLogPath: string | null = null;

/** Ленивый путь: каталог создаётся при первой записи, не на импорте модуля. */

function logRpc(dir: 'in' | 'out', payload: unknown): void {
  try {
    if (rpcLogPath === null) rpcLogPath = tmpFile(process.cwd(), 'mcp-rpc.log');
    const ts = new Date().toTimeString().slice(0, 8);
    appendFileSync(rpcLogPath, `${ts} ${dir} ${JSON.stringify(payload).slice(0, 200)}\n`);
  } catch {
    // Журнал — диагностика; его ошибки не должны ломать сервер
  }
}

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
    logRpc('out', response);
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
    logRpc('out', response);
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
      logRpc('in', { raw: trimmed.slice(0, 200) });
      sendError(null, -32700, 'Parse error');
      return;
    }
    logRpc('in', msg);

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
          handleToolsList(id, cwd, sendResponse);
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
 * Текст-ориентир для поля `instructions` ответа MCP `initialize` (VL-395).
 *
 * Почему именно `instructions`, а не AGENTS.md и не шаблоны фаз:
 * - `instructions` — штатное место протокола MCP для «нулевого хода» агента:
 *   клиент (qwen, opencode, claude) получает его в handshake, без чтения файлов
 *   и без догадки «что тут надо прочитать»;
 * - AGENTS.md — место под правила конкретного проекта, и он режется лимитом
 *   `AGENTS_MD_MAX_CHARS = 8000` (src/agent/system-prompt.ts:29);
 * - шаблоны фаз (templates/phases/*.md) агент видит только при запуске фазы,
 *   а в новом проекте схемы workflow в файлах нет вообще — она дефолт в коде,
 *   и поиск «где лежит workflow» стоил инцидентных ~250k токенов.
 *
 * Текст статичен и НЕ читает settings.json: ориентир не должен разъезжаться с
 * протоколом при битом конфиге. Намеренно без перечня MCP-инструментов (они в
 * `tools/list`) и без шаблонов фаз — только ориентир, ≤ 2000 символов.
 */
export const MCP_INSTRUCTIONS = `Vibelog.md — markdown-нативный таск-менеджер для git-репозиториев. Задачи — markdown-файлы в backlog/tasks/; читай и правь их через MCP-инструменты (backlog_*), а не через edit/write_file.

Фазы workflow по умолчанию: To Do --spec--> Spec --plan--> Planned --code--> Review --close--> Done. Ветки: reject --> Rejected (из To Do, Spec, Planned, In Progress, Review) и fix-цикл Review --code--> Review. Служебные фазы вне workflow (статус не меняют): comment, prompt, analyze, resume.

Это ДЕФОЛТ В КОДЕ (DEFAULT_WORKFLOW, src/core/workflow.ts). Секции \`workflows\` в .vibelog/settings.json может не быть — её отсутствие нормально и означает «работает дефолт». Переопределение — ключ \`workflows.default\` (плюс \`task_workflows\`: тип задачи → имя workflow).

Доступ: чтение (list/view/search/status/map) — сразу; запись (create/update/delete/complete/trigger_phase/commit) — через подтверждение пользователя Allow/Deny.

Полный справочник, генерируемый из кода: \`vibelog capabilities\` (--json — машиночитаемо) и \`vibelog instructions\`; карта кода — \`vibelog map\`.`;

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
    // VL-395: ориентир для «нулевого хода» агента. Поле необязательное по
    // спецификации MCP — клиенты, которые его не знают, просто игнорируют.
    instructions: MCP_INSTRUCTIONS,
  });
}

/**
 * Инструменты upstream-транспорта: видны только при настроенной секции (VL-375, VL-391).
 *
 * Константа живёт здесь (реестр), а предикат видимости применяют MCP-сервер и
 * веб-чат: набор из трёх имён должен совпадать в обоих местах, иначе чат
 * покажет инструмент, которого нет в `tools/list`.
 */
export const UPSTREAM_TOOLS: readonly string[] = [
  'upstream_report_bug',
  'upstream_list_reports',
  'upstream_ack_report',
];

/**
 * Обрабатывает метод tools/list.
 *
 * VL-375: список фильтруется по состоянию проекта — инструменты upstream
 * видны только при валидной секции `upstream` (инструмент, который всё равно
 * не сработает, клиент не должен даже видеть). `listTools()` остаётся без
 * параметров: реестр описывает возможности системы (доктор, тесты паритета,
 * валидация персон), а видимость — политика сервера.
 *
 * @param id — id запроса
 * @param cwd — рабочая директория проекта (для предиката видимости)
 * @param send — функция отправки ответа
 */
function handleToolsList(id: RpcId, cwd: string, send: SendResponse): void {
  const tools = listTools().filter(
    (tool) => !UPSTREAM_TOOLS.includes(tool.name) || isUpstreamConfigured(cwd),
  );
  send(id, {
    tools,
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
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    // VL-413: неизменяющая запись больше не ошибка на транспортной границе —
    // исход `noop` удалён, ответ `{ok:true, outcome:'applied', unchanged:[…]}`
    // уходит как обычный успех. isError остаётся только для исключений.
    send(id, {
      content: [
        {
          type: 'text',
          text,
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
