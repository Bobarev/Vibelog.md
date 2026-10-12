/**
 * MCP-клиент Vibelog (VL-84, компонент 4 эпика VL-75).
 *
 * stdio JSON-RPC 2.0 поверх NDJSON: спавнит `vibelog mcp start` (путь к CLI —
 * параметр для тестируемости; в проде — bin/vibelog.mjs пакета или vibelog из
 * PATH), выполняет handshake (initialize → notifications/initialized), берёт
 * список инструментов и проксирует tools/call в tool-calling loop агента.
 *
 * Формат идентичен StdioClientTransport из typescript-sdk (одна JSON-строка —
 * одно сообщение), поэтому typescript-sdk не нужен (decision-1, doc-4 §3).
 * cwd процесса — корень проекта: в нём backlog/ и конфиг, без этого сервер
 * не найдёт директорию задач (src/mcp/server.ts handleToolsCall).
 *
 * Таймаут на каждый вызов (60 с) — зависший сервер не должен вешать фазу.
 * close(): EOF stdin — сервер выходит сам (src/mcp/server.ts rl close);
 * kill(SIGTERM) через 2 с, если не завершился.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ToolDef } from './llm.js';
import type { ToolSpec } from './tools.js';

/** Опции создания клиента. */
export interface McpClientOptions {
  /** Команда CLI (путь к vibelog). Дефолт — VIBELOG_BIN или 'vibelog' из PATH. */
  bin?: string;
  /** Дополнительные аргументы перед 'mcp start' (в тестах — путь к bin/vibelog.mjs). */
  binArgs?: string[];
  /** Корень проекта: cwd процесса сервера (в нём backlog/ и конфиг). */
  cwd: string;
  /** Таймаут одного JSON-RPC запроса, мс (дефолт 60000). */
  requestTimeoutMs?: number;
  /**
   * Окружение процесса сервера (VL-116). По умолчанию наследуется от
   * родителя; тесты чистят VIBELOG_CWD/VIBELOG_PHASE_* — иначе CLI пишет
   * backlog/сессии в реальный репозиторий вместо /tmp-фикстуры.
   */
  env?: NodeJS.ProcessEnv;
}

/** Ожидающий JSON-RPC ответ. */
interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** Ответ сервера tools/call. */
interface ToolsCallResult {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

const REQUEST_TIMEOUT_MS_DEFAULT = 60_000;
// SIGTERM через 2 с после EOF stdin — страховка, если сервер не вышел сам.
const KILL_DELAY_MS = 2_000;

/**
 * stdio JSON-RPC 2.0 клиент MCP-сервера Vibelog.
 *
 * Создание выполняет полный handshake; дальше — listTools/callTool/close.
 * Все протокольные ошибки — исключения request()/callTool(): их ловит
 * обёртка toolsAsSpecs и превращает в текст модели, loop не падает.
 */
export class McpClient {
  private readonly child: ReturnType<typeof spawn>;
  private readonly requestTimeoutMs: number;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private closed = false;

  private constructor(child: ReturnType<typeof spawn>, requestTimeoutMs: number) {
    this.child = child;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  /**
   * Спавнит сервер, выполняет handshake и возвращает готовый клиент.
   * ENOENT спавна → reject «MCP-сервер не запущен: …».
   */
  static async create(options: McpClientOptions): Promise<McpClient> {
    const bin = options.bin ?? process.env.VIBELOG_BIN ?? 'vibelog';
    const binArgs = options.binArgs ?? [];
    const args = [...binArgs, 'mcp', 'start'];
    // stdio:'pipe' — все три потока через pipe; stdin закрывается в close().
    const child = spawn(bin, args, { cwd: options.cwd, stdio: 'pipe', env: options.env });
    const client = new McpClient(child, options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS_DEFAULT);

    // EPIPE на stdin после смерти сервера не должен ронять процесс агента.
    child.stdin?.on('error', () => {});
    child.on('error', (err) => {
      // Спавн не удался (обычно ENOENT): все ожидающие запросы — reject.
      client.failAllPending(
        new Error(`MCP-сервер не запущен: ${bin} mcp start недоступен (проверь VIBELOG_BIN / PATH): ${err.message}`),
      );
    });
    child.on('exit', (code, signal) => {
      // Сервер вышел с незакрытыми запросами — не вечно их держим.
      client.failAllPending(
        new Error(`MCP-сервер завершился (code=${code}, signal=${signal}) — ответ не получен`),
      );
    });

    client.readStdout();
    try {
      await client.handshake();
    } catch (err) {
      // Handshake не удался: процесс-сирота не должен остаться висеть
      // (иначе зависший фазу сервер держит открытый pipe).
      child.kill('SIGTERM');
      throw err;
    }
    return client;
  }

  /** Код выхода процесса сервера (null — ещё работает). Для тестов и диагностики. */
  get exitCode(): number | null {
    return this.child.exitCode;
  }

  /**
   * JSON-RPC запрос: ждёт ответ по id, reject при error-ответе или таймауте.
   * timeoutMs переопределяет таймаут клиента на один вызов (тесты, редкие
   * долгие операции).
   */
  request<T = Record<string, unknown>>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('MCP-клиент закрыт'));
    }
    const id = this.nextId++;
    const timeout = timeoutMs ?? this.requestTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP-запрос ${method} не выполнен: таймаут ${timeout} мс`));
      }, timeout);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  /** JSON-RPC уведомление: без id, ответа не ждём. */
  notify(method: string, params?: Record<string, unknown>): void {
    if (this.closed) return;
    this.child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  /** Handshake: initialize → notifications/initialized. */
  async handshake(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'vibelog-agent' },
    });
    this.notify('notifications/initialized', {});
  }

  /** Список инструментов сервера; схема нормализуется к полю inputSchema. */
  async listTools(): Promise<ToolDef[]> {
    const result = await this.request<{ tools?: Array<Record<string, unknown>> }>('tools/list');
    return (result.tools ?? []).map((t) => ({
      name: String(t.name ?? ''),
      description: String(t.description ?? ''),
      // Фактический сервер отдаёт inputSchema; parameters — на случай
      // совместимости с другими реализациями MCP.
      inputSchema: (t.inputSchema ?? t.parameters ?? { type: 'object' }) as Record<string, unknown>,
    }));
  }

  /**
   * Вызов инструмента: возвращает текст для модели. isError=true сервера —
   * тоже tool-результат с пометкой, не исключение (AC#2 VL-84).
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = await this.request<ToolsCallResult>('tools/call', { name, arguments: args });
    const text = (result.content ?? [])
      .filter((c) => (c.type ?? 'text') === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n');
    return result.isError ? `Ошибка MCP-инструмента ${name}: ${text}` : text;
  }

  /**
   * Завершение: EOF stdin — сервер выходит сам; SIGTERM через 2 с, если
   * не завершился. Резолвится по событию exit процесса.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAllPending(new Error('MCP-клиент закрыт'));
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        if (this.child.exitCode === null && this.child.signalCode === null) {
          this.child.kill('SIGTERM');
        }
      }, KILL_DELAY_MS);
      this.child.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });
      this.child.stdin?.end();
    });
  }

  /** Разбор stdout построчно (NDJSON); ответы сопоставляются по id. */
  private readStdout(): void {
    // При stdio:'pipe' stdout не null; проверка — для strict-типов.
    const stdout = this.child.stdout;
    if (!stdout) return;
    const rl = createInterface({ input: stdout, terminal: false });
    rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      // Строки вне JSON — не ответы; при VIBELOG_AGENT_DEBUG — в stderr.
      if (!trimmed.startsWith('{')) {
        if (process.env.VIBELOG_AGENT_DEBUG) {
          process.stderr.write(`[mcp-client] не-JSON строка: ${trimmed}\n`);
        }
        return;
      }
      let msg: { id?: number | string; result?: unknown; error?: { code: number; message: string } };
      try {
        msg = JSON.parse(trimmed);
      } catch {
        return;
      }
      // Уведомления сервера (без id) игнорируем.
      if (msg.id === undefined || msg.id === null) return;
      const waiter = this.pending.get(msg.id as number);
      if (!waiter) return;
      this.pending.delete(msg.id as number);
      clearTimeout(waiter.timer);
      if (msg.error) {
        waiter.reject(new Error(`MCP ошибка ${msg.error.code}: ${msg.error.message}`));
      } else {
        waiter.resolve(msg.result);
      }
    });
  }

  /** Reject всех ожидающих запросов (спавн упал / сервер завершился / close). */
  private failAllPending(error: Error): void {
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }
}

/**
 * Проксирование MCP-инструментов в loop агента: из ToolDef сервера — в
 * ToolSpec локального формата. Handler возвращает текст модели; исключение
 * протокола — тоже текст «MCP-вызов X не выполнен: …», loop продолжает.
 */
export function toolsAsSpecs(client: McpClient, defs: ToolDef[]): ToolSpec[] {
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    handler: async (args) => {
      try {
        return await client.callTool(def.name, args);
      } catch (err) {
        return `MCP-вызов ${def.name} не выполнен: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  }));
}
