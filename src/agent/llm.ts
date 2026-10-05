/**
 * LLM-клиент Cloud.ru (VL-83, компонент 1 эпика VL-75).
 *
 * OpenAI-совместимый chat/completions: tool calling + SSE-стриминг.
 * Базовый URL, ключ и модель берутся из env VIBELOG_LLM_BASE_URL /
 * VIBELOG_LLM_API_KEY / VIBELOG_LLM_MODEL (дефолт URL — endpoint Cloud.ru,
 * решение decision-3 ресёрча VL-77: https://foundation-models.api.cloud.ru/v1).
 *
 * Fetch внедряется параметром (дефолт — глобальный fetch Node 20): без этого
 * loop-тесты потребуют сети. Повторы на 429/5xx/сетевые ошибки (decision-4,
 * п.3) с экспоненциальной паузой; заголовок Retry-After (только числовые
 * секунды) имеет приоритет. Если стрим негоден — один фолбэк-раунд non-stream
 * (риск: SSE-формат Cloud.ru может отличаться от OpenAI).
 */

/** Роль сообщения в диалоге (wire-формат OpenAI chat/completions). */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** Вызов инструмента модели: id + имя + разобранные аргументы. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Сообщение диалога; tool_calls — только у assistant. */
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Описание инструмента для tool calling: схема — JSON Schema объекта. */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Учёт токенов; поля Cloud.ru могут отличаться от OpenAI — маппинг ниже. */
export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  total_tokens: number;
}

/** Ответ модели одной итерации: финальный/промежуточный текст и tool_calls. */
export interface LlmResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: LlmUsage;
}

/** Опции одного вызова streamChat. */
export interface StreamChatOptions {
  /** Вызывается на каждый фрагмент текста (стриминг в TUI/CLI). */
  onToken?: (token: string) => void;
  /** Отмена: прокидывается в fetch и таймеры пауз между ретраями. */
  signal?: AbortSignal;
}

/** Опции создания клиента. */
export interface LlmClientOptions {
  /** Переопределяет env VIBELOG_LLM_BASE_URL. */
  baseUrl?: string;
  /** Переопределяет env VIBELOG_LLM_API_KEY. */
  apiKey?: string;
  /** Переопределяет env VIBELOG_LLM_MODEL; без модели клиент неработоспособен. */
  model?: string;
  /** Фейковый fetch для тестов; дефолт — глобальный fetch Node 20. */
  fetchImpl?: typeof fetch;
  /** Максимум повторов на 429/5xx/сетевые ошибки (дефолт 3). */
  maxRetries?: number;
  /** Базовая пауза между повторами, мс (дефолт 500); в тестах ставят 1. */
  retryDelayMs?: number;
}

/** Публичный интерфейс клиента (loop зависит только от него). */
export interface LlmClient {
  readonly model: string;
  streamChat(
    messages: ChatMessage[],
    tools: ToolDef[] | undefined,
    opts?: StreamChatOptions,
  ): Promise<LlmResponse>;
}

/** Дефолтный endpoint Cloud.ru (решение decision-3, doc-4 §6). */
const DEFAULT_BASE_URL = 'https://foundation-models.api.cloud.ru/v1';
const MAX_RETRIES_DEFAULT = 3;
const RETRY_DELAY_DEFAULT = 500;

/** Ноль-утилита для usage (отсутствующие поля → 0, toQwenResult не ломается). */
export function zeroUsage(): LlmUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    total_tokens: 0,
  };
}

/**
 * Маппит usage провайдера на наш формат: OpenAI-имена (prompt/completion)
 * и альтернативные (input/output/cache_read) живут вместе — Cloud.ru может
 * отдавать не всё (cache_read отсутствует → 0).
 */
function mapUsage(raw: unknown): LlmUsage {
  const u = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const inputTokens = n(u.prompt_tokens) || n(u.input_tokens);
  const outputTokens = n(u.completion_tokens) || n(u.output_tokens);
  const cacheRead = n(u.cache_read_input_tokens) || n(u.cache_read_tokens);
  const totalTokens = n(u.total_tokens) || inputTokens + outputTokens;
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheRead,
    total_tokens: totalTokens,
  };
}

/**
 * Складывает usage двух ответов (loop суммирует по всем итерациям).
 * Побочный эффект на `target` — чтобы не аллоцировать на каждой итерации.
 */
export function addUsage(target: LlmUsage, add: LlmUsage): void {
  target.input_tokens += add.input_tokens;
  target.output_tokens += add.output_tokens;
  target.cache_read_input_tokens += add.cache_read_input_tokens;
  target.total_tokens += add.total_tokens;
}

/**
 * Разбирает JSON-строку аргументов tool call. Битый JSON не роняет цикл:
 * сохраняем сырой текст под ключом __raw — модель увидит его при следующей
 * попытке, а частично обрезанные потоковые аргументы не потеряются.
 */
function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { __raw: raw };
  } catch {
    return { __raw: raw };
  }
}

/** Статус, при котором имеет смысл повтор (decision-4, п.3). */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Пауза между ретраями; abort сигнала прерывает ожидание немедленно. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveSleep, rejectSleep) => {
    if (signal?.aborted) {
      rejectSleep(new Error('Операция прервана пользователем'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolveSleep();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      rejectSleep(new Error('Операция прервана пользователем'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Пауза перед повтором: Retry-After (секунды) важнее экспоненты.
 * HTTP-даты в Retry-After не разбираем — редкость для LLM-провайдеров.
 */
function retryDelayMsFor(attempt: number, res: Response | null, baseMs: number): number {
  if (res && typeof res.headers?.get === 'function') {
    const retryAfter = res.headers.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    }
  }
  return baseMs * 2 ** attempt;
}

/** Приводит наши сообщения к wire-формату (tool_calls.arguments — JSON-строка). */
function toWireMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    return m;
  });
}

/** Приводит инструменты к wire-формату OpenAI (parameters = наш inputSchema). */
function toWireTools(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

/** Склейка фрагментов tool_calls из SSE-delta по индексу. */
interface PartialCall {
  id: string;
  name: string;
  argsRaw: string;
}

/**
 * Разбирает SSE-поток chat/completions: текст → onToken, tool_calls →
 * склейка по index (id/name/arguments приходят фрагментами), usage — из
 * последнего чанка (stream_options.include_usage). Битые data-строки
 * пропускаются: провайдер не должен ронять фазу из-за одного мусорного чанка.
 */
async function parseSse(
  res: Response,
  onToken: ((t: string) => void) | undefined,
): Promise<LlmResponse> {
  if (!res.body) throw new Error('Ошибка API Cloud.ru: пустое тело SSE-ответа');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let usage = zeroUsage();
  const calls = new Map<number, PartialCall>();

  const handleEvent = (payload: string): void => {
    const trimmed = payload.trim();
    if (!trimmed || trimmed === '[DONE]') return;
    let chunk: unknown;
    try {
      chunk = JSON.parse(trimmed);
    } catch {
      return; // битый чанк — пропускаем, остальной поток валиден
    }
    const obj = (typeof chunk === 'object' && chunk !== null ? chunk : {}) as Record<string, unknown>;
    if (obj.usage) usage = mapUsage(obj.usage);
    const choices = Array.isArray(obj.choices) ? obj.choices : [];
    for (const choice of choices) {
      const c = (typeof choice === 'object' && choice !== null ? choice : {}) as Record<string, unknown>;
      const delta = (typeof c.delta === 'object' && c.delta !== null ? c.delta : {}) as Record<
        string,
        unknown
      >;
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content;
        onToken?.(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tcRaw of delta.tool_calls) {
          const tc = (typeof tcRaw === 'object' && tcRaw !== null ? tcRaw : {}) as Record<string, unknown>;
          const index = typeof tc.index === 'number' ? tc.index : 0;
          const cur = calls.get(index) ?? { id: '', name: '', argsRaw: '' };
          if (typeof tc.id === 'string' && tc.id) cur.id = tc.id;
          const fn = (typeof tc.function === 'object' && tc.function !== null
            ? tc.function
            : {}) as Record<string, unknown>;
          if (typeof fn.name === 'string') cur.name += fn.name;
          if (typeof fn.arguments === 'string') cur.argsRaw += fn.arguments;
          calls.set(index, cur);
        }
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE-события разделяются пустой строкой; \r\n поддерживаем тоже.
    let sepIndex = buffer.indexOf('\n\n');
    while (sepIndex !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('data:')) handleEvent(line.slice(5));
      }
      sepIndex = buffer.indexOf('\n\n');
    }
  }
  // Хвост буфера без завершающего \n\n — тоже событие.
  for (const line of buffer.split('\n')) {
    if (line.startsWith('data:')) handleEvent(line.slice(5));
  }

  const toolCalls: ToolCall[] = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => ({ id: c.id, name: c.name, arguments: parseToolArguments(c.argsRaw) }));
  return { text, toolCalls, usage };
}

/** Non-stream ответ: choices[0].message → текст + tool_calls + usage. */
function parseNonStream(body: unknown): LlmResponse {
  const obj = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const choices = Array.isArray(obj.choices) ? obj.choices : [];
  const first = (choices[0] ?? {}) as Record<string, unknown>;
  const message = (typeof first.message === 'object' && first.message !== null
    ? first.message
    : {}) as Record<string, unknown>;
  const text = typeof message.content === 'string' ? message.content : '';
  const toolCalls: ToolCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const tcRaw of message.tool_calls) {
      const tc = (typeof tcRaw === 'object' && tcRaw !== null ? tcRaw : {}) as Record<string, unknown>;
      const fn = (typeof tc.function === 'object' && tc.function !== null
        ? tc.function
        : {}) as Record<string, unknown>;
      toolCalls.push({
        id: typeof tc.id === 'string' ? tc.id : '',
        name: typeof fn.name === 'string' ? fn.name : '',
        arguments: parseToolArguments(typeof fn.arguments === 'string' ? fn.arguments : ''),
      });
    }
  }
  return { text, toolCalls, usage: mapUsage(obj.usage) };
}

/** Текст ошибки для модели/CLI: русский + статус провайдера. */
function apiError(status: number, statusText: string): Error {
  return new Error(`Ошибка API Cloud.ru: HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
}

/**
 * Создаёт клиент LLM. Модель обязательна: дефолта у Cloud.ru нет, а молчаливый
 * пустой model давал бы HTTP 400 без внятного сообщения.
 */
export function createLlmClient(options: LlmClientOptions = {}): LlmClient {
  const baseUrl = (
    options.baseUrl ??
    process.env.VIBELOG_LLM_BASE_URL ??
    DEFAULT_BASE_URL
  ).replace(/\/+$/, '');
  const apiKey = options.apiKey ?? process.env.VIBELOG_LLM_API_KEY ?? '';
  const model = options.model ?? process.env.VIBELOG_LLM_MODEL ?? '';
  const fetchImpl: typeof fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const maxRetries = options.maxRetries ?? MAX_RETRIES_DEFAULT;
  const baseRetryDelay = options.retryDelayMs ?? RETRY_DELAY_DEFAULT;
  if (!model) {
    throw new Error('Не задана модель LLM: установи env VIBELOG_LLM_MODEL');
  }

  const url = `${baseUrl}/chat/completions`;

  /**
   * Один HTTP-запрос с ретраями на 429/5xx/сетевые ошибки.
   * `stream` управляет телом; последняя попытка возвращает response как есть
   * (в т.ч. не-retryable 4xx — их разбирает вызывающий).
   */
  async function requestWithRetry(
    stream: boolean,
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new Error('Операция прервана пользователем');
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(stream ? { ...body, stream: true, stream_options: { include_usage: true } } : body),
          signal,
        });
      } catch (err) {
        if (signal?.aborted) throw new Error('Операция прервана пользователем');
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          await sleep(retryDelayMsFor(attempt, null, baseRetryDelay), signal);
          continue;
        }
        throw new Error(
          `Сетевая ошибка при запросе к LLM после ${maxRetries + 1} попыток: ${lastError.message}`,
        );
      }
      if (res.ok) return res;
      if (isRetryableStatus(res.status) && attempt < maxRetries) {
        await sleep(retryDelayMsFor(attempt, res, baseRetryDelay), signal);
        continue;
      }
      return res; // не-retryable либо ретраи исчерпаны — статус решает вызывающий
    }
    // Недостижимо (цикл всегда завершается return/throw), но TS требует пути.
    throw lastError ?? new Error('Ошибка API Cloud.ru: неизвестная ошибка запроса');
  }

  async function streamChat(
    messages: ChatMessage[],
    tools: ToolDef[] | undefined,
    opts: StreamChatOptions = {},
  ): Promise<LlmResponse> {
    const baseBody: Record<string, unknown> = {
      model,
      messages: toWireMessages(messages),
      ...(tools && tools.length > 0 ? { tools: toWireTools(tools) } : {}),
    };

    // Фаза 1: стриминг (предпочтительный путь — onToken для TUI).
    const streamRes = await requestWithRetry(true, baseBody, opts.signal);
    if (streamRes.ok) return parseSse(streamRes, opts.onToken);

    // Фаза 2: фолбэк non-stream (решение плана VL-83 + риск SSE Cloud.ru).
    const fallbackRes = await requestWithRetry(false, baseBody, opts.signal);
    if (!fallbackRes.ok) throw apiError(fallbackRes.status, fallbackRes.statusText);
    let parsedBody: unknown;
    try {
      parsedBody = await fallbackRes.json();
    } catch {
      throw new Error('Ошибка API Cloud.ru: невалидный JSON в ответе non-stream');
    }
    const response = parseNonStream(parsedBody);
    // Текст режем по словам — эквивалент стриминга для onToken.
    if (response.text && opts.onToken) {
      for (const word of response.text.split(/(?<=\s)/)) opts.onToken(word);
    }
    return response;
  }

  return { model, streamChat };
}
