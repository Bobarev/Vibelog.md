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
 * секунды) имеет приоритет. Если стрим негоден — фолбэк non-stream (риск:
 * SSE-формат Cloud.ru может отличаться от OpenAI). Обрыв соединения во
 * время чтения SSE-тела (VL-103: `terminated` от undici) ретраится внешним
 * циклом стриминг-попыток с теми же паузами; после исчерпания попыток —
 * non-stream фолбэк; abort не ретраится, финальная ошибка — русский текст
 * с диагностикой вместо сырого «terminated».
 *
 * VL-178: отказ провайдера «The request was rejected because it was considered
 * high risk» (payload ~1.25 МБ из двух MCP-снапшотов) → автоматический повтор
 * с усечённой полезной нагрузкой (shrink tool-выводов, 2 уровня) вместо
 * ручного «Продолжить»; тело не-ok ответа читается для детекта маркера.
 */

import { truncateToolOutput } from './tools.js';

/** Роль сообщения в диалоге (wire-формат OpenAI chat/completions). */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/** Вызов инструмента модели: id + имя + разобранные аргументы. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Сообщение диалога; tool_calls — только у assistant; usage — только у assistant (VL-198). */
export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; usage?: LlmUsage }
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
  /**
   * Reasoning-токены (VL-198, ref-19): из completion_tokens_details.reasoning_tokens.
   * Отдельное поле — для аналитики, НЕ вычитается из output.
   */
  reasoning_tokens: number;
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
  /**
   * ID сессии агента → заголовок X-Session-Id запросов (VL-198, ref-18):
   * группировка связанных запросов на дашборде RouterAI. Без него заголовок
   * не отправляется (совместимость с провайдерами без этой семантики).
   */
  sessionId?: string;
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
    reasoning_tokens: 0,
  };
}

/**
 * Маппит usage провайдера на наш формат: OpenAI-имена (prompt/completion)
 * и альтернативные (input/output/cache_read) живут вместе — Cloud.ru может
 * отдавать не всё (cache_read отсутствует → 0). Кэш-токены читаются из всех
 * известных вариантов полей (VL-96): прямые cache_read_input_tokens /
 * cache_read_tokens / prompt_cache_hit_tokens и вложенное
 * prompt_tokens_details.cached_tokens — OpenAI-совместимые провайдеры
 * (Cloud.ru) отдают кэш именно во вложенном поле.
 */
function mapUsage(raw: unknown): LlmUsage {
  // Отладочный дамп (VL-96): env VIBELOG_LLM_DEBUG_USAGE=1 печатает сырой
  // usage в stderr — по нему видно, под каким именем провайдер отдаёт кэш
  if (process.env.VIBELOG_LLM_DEBUG_USAGE === '1') {
    console.error(`[vibelog-agent] usage raw: ${JSON.stringify(raw)}`);
  }
  const u = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const inputTokens = n(u.prompt_tokens) || n(u.input_tokens);
  const outputTokens = n(u.completion_tokens) || n(u.output_tokens);
  // Кэш-токены (VL-96): прямые поля (Anthropic/DeepSeek-стиль) важнее
  // вложенного prompt_tokens_details (OpenAI-стиль, его отдаёт Cloud.ru)
  const details = (typeof u.prompt_tokens_details === 'object' && u.prompt_tokens_details !== null
    ? u.prompt_tokens_details
    : {}) as Record<string, unknown>;
  const cacheRead =
    n(u.cache_read_input_tokens) ||
    n(u.cache_read_tokens) ||
    n(u.prompt_cache_hit_tokens) ||
    n(details.cached_tokens);
  const totalTokens = n(u.total_tokens) || inputTokens + outputTokens;
  // Reasoning (VL-198, ref-19): OpenAI-стиль completion_tokens_details.reasoning_tokens,
  // альтернативы — прямые поля (qwen thoughtsTokenCount → reasoning_tokens/mimo)
  const compDetails = (typeof u.completion_tokens_details === 'object' && u.completion_tokens_details !== null
    ? u.completion_tokens_details
    : {}) as Record<string, unknown>;
  const reasoningTokens =
    n(u.reasoning_tokens) || n(u.thoughts_token_count) || n(u.thoughtsTokenCount) || n(compDetails.reasoning_tokens);
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheRead,
    total_tokens: totalTokens,
    reasoning_tokens: reasoningTokens,
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
  target.reasoning_tokens += add.reasoning_tokens ?? 0;
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

/**
 * Ошибка обрыва соединения/стрима — имеет смысл повтор (VL-103).
 * `terminated` — TypeError undici: сервер закрыл соединение до конца ответа
 * (реальный кейс из лога VL-103); прочие матчи — типовые сетевые обрывы.
 * Причина (cause) тоже проверяется: обёртки ошибок сохраняют исходную
 * причину, и обрыв при чтении non-stream тела должен ретраиться.
 */
function isRetryableStreamError(err: Error): boolean {
  const cause = err.cause instanceof Error ? err.cause.message : '';
  const haystack = err.message + ' ' + cause;
  return /terminated|fetch failed|ECONNRESET|EPIPE|premature close|UND_ERR|socket hang up/i.test(haystack);
}

/**
 * Ошибка прерывания (abort): пользователь остановил фазу — ретраить
 * бессмысленно (VL-103). Матчит имя AbortError и наше сообщение
 * «Операция прервана пользователем» (см. sleep/requestWithRetry).
 */
function isAbortError(err: Error): boolean {
  return err.name === 'AbortError' || /прервана/i.test(err.message);
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
    if (m.role === 'assistant') {
      // usage (VL-198) — наше поле для учёта в JSONL; провайдеру оно НЕ уходит
      // (строгие API отвечают 400 на неизвестных полях сообщений — риск №3 плана)
      if (m.tool_calls && m.tool_calls.length > 0) {
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
      return { role: 'assistant', content: m.content };
    }
    // VL-178: wire-cap tool-выводов — защита при resume старых jsonl-сессий,
    // где гигантские MCP-выводы (624 КБ) уже записаны: в запрос провайдера
    // уходит ≤8KB + маркер обрезки, ingestion-cap (loop) новых записей не заменяет
    if (m.role === 'tool') {
      return { ...m, content: truncateToolOutput(m.content) };
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

/** Текст ошибки для модели/CLI: русский + статус провайдера (+ фрагмент тела). */
function apiError(status: number, statusText: string, bodySnippet?: string): Error {
  const base = `Ошибка API Cloud.ru: HTTP ${status}${statusText ? ` ${statusText}` : ''}`;
  // VL-178: тело ответа содержит маркер отказа провайдера («high risk») —
  // без него оператор видит только статус и причину угадывает
  return new Error(bodySnippet ? `${base}: ${bodySnippet}` : base);
}

/**
 * Маркер отказа провайдера «high risk» (VL-178). Совпадает и на английском
 * тексте тела («The request was rejected because it was considered high risk»),
 * и на возможных локализациях/аналогах модерации.
 */
export function isHighRiskBody(text: string): boolean {
  return /high\s*risk|rejected\s+because\s+it\s+was\s+considered/i.test(text);
}

/** Уровни усечения tool-выводов при повторе после «high risk» (VL-178). */
const SHRINK_LEVEL_1 = 4096;
const SHRINK_LEVEL_2 = 1024;
/** Максимум shrink-повторов запроса (VL-178): full → L1 → L2. */
export const HIGH_RISK_MAX_SHRINKS = 2;

/**
 * Усекает content tool-сообщений до maxToolChars с маркером для модели.
 *
 * Сообщения НЕ выбрасываются (иначе ломается парность tool_calls ↔ tool
 * и провайдер отклонит историю) — только обрезается длина; assistant/system/
 * user не трогаются.
 */
export function shrinkMessages(messages: ChatMessage[], maxToolChars: number): ChatMessage[] {
  return messages.map((m) => {
    if (m.role !== 'tool' || m.content.length <= maxToolChars) return m;
    return {
      ...m,
      content:
        m.content.slice(0, maxToolChars) +
        `\n…[вывод усечён до ${maxToolChars} символов из ${m.content.length} — повтор после отказа провайдера, VL-178]`,
    };
  });
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
  const sessionId = options.sessionId ?? '';
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
            // X-Session-Id (VL-198, ref-18): группировка запросов сессии
            // на дашборде RouterAI; пустой sessionId → заголовка нет
            ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
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
    const buildBody = (msgs: ChatMessage[]): Record<string, unknown> => ({
      model,
      messages: toWireMessages(msgs),
      ...(tools && tools.length > 0 ? { tools: toWireTools(tools) } : {}),
    });

    // VL-178: внешний цикл усечения при отказе провайдера «high risk».
    // Детект — по телу не-ok ответа (apiError включает фрагмент тела, маркер
    // isHighRiskBody матчится по message исключения). Уровни: full → 4096 →
    // 1024 символов на tool-вывод; максимум 2 повтора, затем ошибка наружу.
    let currentMessages = messages;
    let shrinks = 0;
    for (;;) {
      const baseBody = buildBody(currentMessages);
      try {
        return await attemptWithFallback(baseBody, opts);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (opts.signal?.aborted || isAbortError(e)) throw e;
        if (shrinks >= HIGH_RISK_MAX_SHRINKS || !isHighRiskBody(e.message)) throw e;
        shrinks++;
        currentMessages = shrinkMessages(
          messages,
          shrinks === 1 ? SHRINK_LEVEL_1 : SHRINK_LEVEL_2,
        );
        await sleep(retryDelayMsFor(shrinks - 1, null, baseRetryDelay), opts.signal);
      }
    }
  }

  /**
   * Один запрос с ретраями обрыва стрима (VL-103) и non-stream фолбэком
   * (VL-83). Выделено из streamChat, чтобы внешний shrink-цикл VL-178 мог
   * перезапустить его с усечённым payload.
   *
   * requestWithRetry покрывает только установку соединения/статусы — обрыв
   * ТЕЛА SSE (terminated/ECONNRESET от undici) случается уже в parseSse,
   * поэтому стриминг-попытка обёрнута во внешний цикл ретраев с той же
   * retryDelayMsFor-паузой; в том же цикле живёт non-stream фолбэк — после
   * исчерпания стрим-попыток либо не-ok статуса стрима.
   */
  async function attemptWithFallback(
    baseBody: Record<string, unknown>,
    opts: StreamChatOptions,
  ): Promise<LlmResponse> {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (opts.signal?.aborted) throw new Error('Операция прервана пользователем');
      // Suppress onToken на повторных попытках (VL-103): частичный текст первой
      // попытки уже ушёл в TUI — дублировать его нельзя; авторитетен response.text
      // финальной успешной попытки (риск «дубли токенов» плана VL-103).
      const onToken = attempt === 0 ? opts.onToken : undefined;

      // Фаза 1: стриминг (предпочтительный путь — onToken для TUI).
      try {
        const streamRes = await requestWithRetry(true, baseBody, opts.signal);
        if (streamRes.ok) return await parseSse(streamRes, onToken);
        // Статус не-ok: requestWithRetry уже отработал свои ретраи 429/5xx —
        // идём в non-stream фолбэк (ниже), ошибкой стрима это не считается
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        // Abort не ретраится никогда; прочие не-retryable ошибки (4xx API
        // и т.п.) — тоже сразу наружу, вызывающий показывает их как есть
        if (opts.signal?.aborted || isAbortError(e)) throw e;
        if (!isRetryableStreamError(e)) throw e;
        lastErr = e;
        // Обрыв стрима — повтор стриминг-попытки; фолбэк ниже — после
        // исчерпания ретраев стрима
        if (attempt < maxRetries) {
          await sleep(retryDelayMsFor(attempt, null, baseRetryDelay), opts.signal);
          continue;
        }
      }

      // Фаза 2: фолбэк non-stream (решение плана VL-83 + риск SSE Cloud.ru).
      try {
        const fallbackRes = await requestWithRetry(false, baseBody, opts.signal);
        if (!fallbackRes.ok) {
          // VL-178: тело не-ok ответа читается для детекта «high risk»
          // (guard typeof — тестовые моки дают только json(); json() после
          // text() недоступен, но throw происходит до json() — не доходим)
          let bodySnippet: string | undefined;
          if (typeof fallbackRes.text === 'function') {
            try {
              const bodyText = await fallbackRes.text();
              if (bodyText) bodySnippet = bodyText.slice(0, 300);
            } catch {
              bodySnippet = undefined; // тело не читается — маркер не найден, прежний путь
            }
          }
          throw apiError(fallbackRes.status, fallbackRes.statusText, bodySnippet);
        }
        let parsedBody: unknown;
        try {
          parsedBody = await fallbackRes.json();
        } catch (jsonErr) {
          // cause сохраняем: обрыв соединения при чтении non-stream тела тоже
          // бросает terminated — он должен ретраиться, а не падать как «невалидный JSON»
          throw new Error('Ошибка API Cloud.ru: невалидный JSON в ответе non-stream', {
            cause: jsonErr,
          });
        }
        const response = parseNonStream(parsedBody);
        // Текст режем по словам — эквивалент стриминга для onToken.
        if (response.text && opts.onToken) {
          for (const word of response.text.split(/(?<=\s)/)) opts.onToken(word);
        }
        return response;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (opts.signal?.aborted || isAbortError(e)) throw e;
        if (!isRetryableStreamError(e)) throw e;
        lastErr = e;
        // Фолбэк упал retryable-ошибкой — общий цикл: новая стрим-попытка
        if (attempt < maxRetries) {
          await sleep(retryDelayMsFor(attempt, null, baseRetryDelay), opts.signal);
          continue;
        }
      }
      break; // попытки исчерпаны — финальная ошибка ниже
    }

    // Финальная ошибка вместо голого «terminated» (VL-103): русский текст,
    // счётчик попыток и указание на диагностику — оператору понятно, что
    // произошло и куда смотреть
    throw new Error(
      'Сетевая ошибка LLM (обрыв соединения: ' +
        (lastErr?.message ?? 'неизвестная ошибка') +
        ') после ' + (maxRetries + 1) + ' попыток и non-stream фолбэка. ' +
        'Диагностика: логи stderr агента и .vibelog/agent-sessions/<sessionId>.jsonl; ' +
        'повтори позже либо проверь сеть до LLM-провайдера.',
    );
  }

  return { model, streamChat };
}
