/**
 * Общий транспорт GitVerse (VL-380).
 *
 * Зачем модуль. Два клиента — реестр компонентов (`registry-fetch.ts`, VL-335)
 * и Issues-API (`gitverse-issues.ts`, VL-363) — ходили в сеть собственными
 * копиями одного и того же кода: резолв базы с валидацией, `fetchOnce` с
 * `AbortController`/`clearTimeout`, чтение тела с лимитом байт, цикл ретраев,
 * `parseJson`, разбор тела ошибки, набор ретраибельных сетевых кодов. Код был
 * скопирован построчно, поэтому любая правка политики ретраев требовала
 * синхронной правки в двух местах, а расхождение проявлялось как
 * трудноуловимый баг (первый же реальный прогон `vb install` упал на 429,
 * который Issues-клиент уже умел бы обработать иначе).
 *
 * Что здесь общего, а что остаётся клиенту:
 * - общее: таймаут, лимит тела, сетевые коды, разбор тела ошибки, цикл
 *   ретраев (включая 429 и `Retry-After`), маскирование секрета, `parseJson`;
 * - клиентское: базовый URL и имя env-переменной, набор заголовков (включая
 *   `Accept` и `Authorization`), метод и тело, и — главное — функция
 *   `classify(status, text)`: семантика HTTP-статусов у реестра и у Issues
 *   разная (400 = «не найдено» у реестра, 404 — у Issues), и она живёт в
 *   своём модуле, а не в транспорте.
 *
 * Жёсткие инварианты:
 * - таймер таймаута гасится в `finally` (живой `setTimeout` держит event loop
 *   и ломает vitest);
 * - тело читается чанками с подсчётом байт: лимит — реальная защита, а не
 *   проверка `content-length` (его может не быть);
 * - все тексты ошибок проходят через переданный `mask` (токен не должен
 *   попасть ни в сообщение, ни в лог);
 * - ретраи ограничены и по числу попыток, и по суммарному времени: команда
 *   не должна «висеть» минутами без объяснения (VL-380).
 */

import { fetch as undiciFetch } from 'undici';

/** Таймаут одного запроса по умолчанию, мс. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Паузы между повторами для 5xx и сетевых ошибок (два повтора). */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [500, 1500];

/**
 * Паузы для 429, когда сервер не прислал `Retry-After`.
 *
 * Список намеренно длиннее, чем для 5xx: 429 по определению означает «повтори
 * позже», и одна лишняя попытка дешевле, чем упавшая установка.
 */
export const DEFAULT_RATE_LIMIT_DELAYS_MS: readonly number[] = [60_000, 60_000, 60_000];

/**
 * Потолок для `Retry-After`: сервер может попросить ждать сотни секунд, но
 * `vb install` не должен висеть 10 минут молча — ожидание сокращается.
 */
export const MAX_RETRY_AFTER_MS = 120_000;

/** Суммарный бюджет ожидания на 429: после него — ошибка с подсказкой. */
export const RATE_LIMIT_BUDGET_MS = 180_000;

/** Вид ошибки транспорта. Клиент маппит его в свой код выхода CLI. */
export type GitverseHttpErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'timeout'
  | 'too_large'
  | 'invalid_json';

/**
 * Базовая ошибка транспорта GitVerse.
 *
 * `code` — код выхода CLI, его вычисляет клиент (у реестра всё «сеть/данные»
 * → 3, у Issues есть отдельные 2/4). Поля `kind`/`status`/`url`/`attempts`
 * общие: по ним CLI выбирает текст и подсказку, а тесты — ожидание.
 */
export class GitverseHttpError<K extends string = GitverseHttpErrorKind> extends Error {
  /** Код выхода CLI (задаёт клиент). */
  readonly code: number;
  readonly kind: K;
  /** HTTP-статус, если ошибка пришла от сервера. */
  readonly status?: number;
  /** URL запроса (для диагностики). */
  readonly url: string;
  /** Сколько попыток сделали до отказа. */
  readonly attempts: number;

  constructor(
    message: string,
    kind: K,
    url = '',
    details: { status?: number; attempts?: number; code?: number } = {},
  ) {
    super(message);
    this.name = 'GitverseHttpError';
    this.kind = kind;
    this.code = details.code ?? 3;
    this.url = url;
    this.status = details.status;
    this.attempts = details.attempts ?? 1;
  }
}

/** Фабрика ошибки клиента: транспорт сам класс ошибки не знает. */
export type HttpErrorFactory = (
  message: string,
  kind: string,
  url: string,
  details?: { status?: number; attempts?: number },
) => GitverseHttpError<string>;

/**
 * Вид события прогресса сетевой операции (VL-381).
 *
 * `request` — уходит запрос, `response` — пришёл ответ, `waiting` — начинается
 * пауза перед повтором, `error` — попытка закончилась ошибкой (таймаут, лимит
 * тела, сеть).
 */
export type ProgressEventKind = 'request' | 'response' | 'waiting' | 'error';

/** Причина повтора или ошибки в событии прогресса. */
export type ProgressReason = 'rate_limited' | 'server' | 'network' | 'timeout' | 'too_large';

/**
 * Событие прогресса сетевой операции.
 *
 * Транспорт НЕ печатает ничего сам: он лишь рассказывает клиенту, что
 * происходит («молчаливое ожидание 3 минуты» — класс дефектов, VL-381).
 * Печать — забота CLI: библиотека в тестах и MCP-режиме не имеет права
 * писать в stdout (там JSON-RPC).
 */
export interface ProgressEvent {
  kind: ProgressEventKind;
  url: string;
  /** Номер текущей попытки (с 1). */
  attempt: number;
  /** Сколько попыток возможно в худшем случае (для «попытка K/M»). */
  attemptsMax: number;
  /** HTTP-статус ответа (только у `response`). */
  status?: number;
  /** Длительность предстоящей паузы, мс (только у `waiting`). */
  delayMs?: number;
  /** Причина повтора/ошибки. */
  reason?: ProgressReason;
  /** Размер тела ответа в байтах (только у `response`). */
  bytes?: number;
  /** Текст ошибки (только у `error`; уже прошёл через `mask`). */
  message?: string;
}

/** Подписчик на события прогресса (по умолчанию — no-op). */
export type ProgressCallback = (event: ProgressEvent) => void;

/** Коды сетевых ошибок, на которых имеет смысл повторять запрос. */
export const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Минимальный интерфейс заголовков ответа (нужен только `Retry-After`). */
export interface ResponseHeaders {
  get(name: string): string | null;
}

/** Результат одной успешной попытки. */
export interface HttpResponse {
  status: number;
  text: string;
  headers: ResponseHeaders;
}

/** Объект (не null и не массив). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Пауза. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Вырезает секрет из произвольного текста.
 *
 * Токен может попасть в сообщение двумя путями: сервер вернёт его в эхе
 * запроса или мы сами вставим URL с query. Маскирование — последняя линия
 * защиты, поэтому применяется ко всем текстам, выходящим из транспорта.
 */
export function maskText(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join('***');
}

/** Достаёт машинный код сетевой ошибки (undici складывает его в cause). */
export function networkErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  if (typeof e?.code === 'string') return e.code;
  const cause = e?.cause as { code?: unknown } | undefined;
  if (cause && typeof cause.code === 'string') return cause.code;
  return undefined;
}

/** Текст сетевой ошибки для сообщения об одной строке. */
export function networkErrorMessage(err: unknown): string {
  const code = networkErrorCode(err);
  if (code) return code;
  const errno = (err as { cause?: { errno?: unknown } })?.cause?.errno;
  if (typeof errno === 'string') return errno;
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 200);
}

/** Ошибка «сервер закрыл соединение», которую undici отдаёт без кода. */
export function isSocketHangUp(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /socket hang up|other side closed|aborted/i.test(message);
}

/**
 * Разбирает `Retry-After` (секунды или HTTP-дата) в миллисекунды.
 *
 * Невалидное значение → `null`: вызывающий использует дефолтную паузу, а не
 * ждёт «ничего».
 */
export function parseRetryAfter(headers: ResponseHeaders | null | undefined): number | null {
  const raw = headers?.get?.('retry-after');
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '') return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

/** Убирает HTML-разметку: тело ошибки GitVerse на 429 — целая страница. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Обрезка до одной короткой строки — сообщение печатается одной строкой. */
function oneLine(text: string, limit = 200): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Достаёт человекочитаемое сообщение из тела ошибки.
 *
 * Поддерживаются ОБЕ формы, встречающиеся у GitVerse:
 * - `{"error": {"code": "BAD_REQUEST", "message": "...", "status": 400}}`;
 * - `{"code": 4305, "message": "File: ... not found"}` и `{"message": "..."}`.
 *
 * HTML-страница (типичный ответ на 429 «Unauthenticated requests rate-limit
 * exceeded») не обрезается как сырой текст: теги снимаются, иначе
 * пользователь увидит `<!DOCTYPE html><html><head>…` вместо причины.
 */
export function extractErrorMessage(text: string): string {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') return '';
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isPlainObject(parsed)) {
        const nested = parsed.error;
        if (isPlainObject(nested) && typeof nested.message === 'string' && nested.message.trim() !== '') {
          return oneLine(nested.message.trim());
        }
        if (typeof parsed.message === 'string' && parsed.message.trim() !== '') {
          return oneLine(parsed.message.trim());
        }
      }
    } catch {
      // не JSON — падаем в разбор сырого текста
    }
  }
  const plain = trimmed.startsWith('<') ? htmlToText(trimmed) : trimmed.replace(/\s+/g, ' ');
  return oneLine(plain);
}

/** Опции операций транспорта, зависящие от клиента. */
export interface TransportContext {
  /** Как называть адресата в текстах («реестр», «GitVerse»). */
  what: string;
  /** Фабрика ошибки клиента. */
  makeError: HttpErrorFactory;
  /** Маскирование секрета во всех текстах (по умолчанию — тождество). */
  mask?: (text: string) => string;
}

/** Опции резолва базового URL. */
export interface BaseResolverOptions {
  /** Имя env-переменной, подменяющей базу. */
  envName: string;
  /** База по умолчанию. */
  defaultBase: string;
  /**
   * Сфабриковать ошибку «битая база». Клиент знает свой вид и код выхода
   * (реестр: `network`/3, Issues: `config`/2), транспорт — нет.
   */
  fail: (message: string, url: string) => GitverseHttpError<string>;
}

/** Резолвит базовый URL из env с валидацией схемы. */
export function resolveBase(env: NodeJS.ProcessEnv, options: BaseResolverOptions): string {
  const raw = env[options.envName];
  if (raw === undefined || raw.trim() === '') return options.defaultBase;
  const value = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw options.fail(
      `переменная ${options.envName} содержит некорректный URL «${value}»; ожидался полный адрес вида https://<хост>:<порт>`,
      value,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw options.fail(
      `переменная ${options.envName} должна содержать http(s)-адрес, получено «${parsed.protocol}//…»`,
      value,
    );
  }
  return value.replace(/\/+$/, '');
}

/** Собирает URL: склейка без двойных слэшей + query-параметры. */
export function buildUrl(
  base: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const cleanBase = base.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${cleanBase}${cleanPath}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * Читает тело ответа чанками, считая байты.
 *
 * Стриминг, а не `await response.text()`: лимит должен срабатывать ДО
 * буферизации всего тела — иначе защита превращается в способ съесть память.
 */
export async function readBodyLimited(
  body: ReadableStream<Uint8Array> | null,
  maxBodyBytes: number,
  url: string,
  ctx: TransportContext,
): Promise<string> {
  if (!body) return '';
  const mask = ctx.mask ?? ((text: string) => text);
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBodyBytes) {
        // Прерываем загрузку: остаток тела не нужен и не должен скачиваться.
        await reader.cancel().catch(() => undefined);
        throw ctx.makeError(
          mask(
            `ответ ${ctx.what} больше лимита ${maxBodyBytes} байт (${url}); остановлено — проверь источник`,
          ),
          'too_large',
          url,
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Опции одной попытки запроса. */
export interface FetchOnceOptions extends TransportContext {
  url: string;
  method?: 'GET' | 'POST' | 'PATCH';
  headers?: Record<string, string>;
  /** Тело: объект сериализуется в JSON, `content-type` добавляется сам. */
  body?: unknown;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

/**
 * Одна попытка запроса с таймаутом.
 *
 * Таймер обязательно гасится в `finally`: живой `setTimeout` держит event loop
 * и vitest сообщает о висящем хендле (в проде процесс просто не завершается).
 */
export async function fetchOnce(options: FetchOnceOptions): Promise<HttpResponse> {
  const {
    url,
    method = 'GET',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBodyBytes = Number.POSITIVE_INFINITY,
  } = options;
  const mask = options.mask ?? ((text: string) => text);
  const ctx: TransportContext = { ...options, mask };
  const timeoutMessage = mask(
    `${options.what} не ответил за ${Math.max(1, Math.round(timeoutMs / 1000))} с (${url}); проверь сеть и повтори`,
  );

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const timeoutReject = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => reject(options.makeError(timeoutMessage, 'timeout', url)),
      { once: true },
    );
  });

  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body: string | undefined;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    if (headers['content-type'] === undefined) headers['content-type'] = 'application/json';
  }

  const work = (async (): Promise<HttpResponse> => {
    const response = await undiciFetch(url, {
      method,
      signal: controller.signal,
      headers,
      ...(body !== undefined ? { body } : {}),
    });
    const text = await readBodyLimited(
      response.body as unknown as ReadableStream<Uint8Array> | null,
      maxBodyBytes,
      url,
      ctx,
    );
    return {
      status: response.status,
      text,
      headers: response.headers as unknown as ResponseHeaders,
    };
  })();

  try {
    return await Promise.race([work, timeoutReject]);
  } catch (err) {
    if (err instanceof GitverseHttpError) throw err;
    if (timedOut || controller.signal.aborted) {
      throw options.makeError(timeoutMessage, 'timeout', url);
    }
    throw options.makeError(
      mask(
        `не удалось связаться (${networkErrorMessage(err)}): ${url}; проверь сеть и повтори`,
      ),
      'network',
      url,
    );
  } finally {
    clearTimeout(timer);
    // Работа могла остаться в фоне после гонки с таймаутом — не оставляем
    // необработанный rejection.
    work.catch(() => undefined);
  }
}

/**
 * Классификация неспешного ответа, которую отдаёт клиент.
 *
 * `kind` — строка, а не объединение транспорта: у клиентов свои словари видов
 * (`config`, `no_token`, `invalid_schema`), и транспорт не должен их сужать.
 * Сравнение с `'rate_limited'` остаётся рабочим: это значение транспорт знает.
 */
export interface StatusClassification {
  kind: string;
  /** Самодостаточный текст ошибки (без «попыток», их добавит транспорт). */
  message: string;
  /** Повторять ли запрос при этом виде ошибки. */
  retryable: boolean;
  /**
   * Дополнение к тексту ошибки, когда ретраи исчерпаны (например «следующая
   * попытка через 60 с»). Получает паузу, которую транспорт не смог выждать.
   */
  retryHint?: (nextDelayMs: number | null) => string;
}

/** Функция семантики статусов: единственное место, где она живёт. */
export type StatusClassifier = (status: number, text: string) => StatusClassification;

/** Опции запроса с ретраями. */
export interface RequestWithRetriesOptions extends FetchOnceOptions {
  /** Семантика HTTP-статусов клиента. */
  classify: StatusClassifier;
  /** Паузы для 5xx/сети (по умолчанию `DEFAULT_RETRY_DELAYS_MS`). */
  retryDelaysMs?: readonly number[];
  /** Паузы для 429 без `Retry-After` (по умолчанию `DEFAULT_RATE_LIMIT_DELAYS_MS`). */
  rateLimitDelaysMs?: readonly number[];
  /** Суммарный бюджет ожидания на 429, мс. */
  rateLimitBudgetMs?: number;
  /** Инъекция пауз для тестов (по умолчанию `sleep`). */
  sleepFn?: (ms: number) => Promise<void>;
  /**
   * Подписка на прогресс (VL-381). По умолчанию — no-op: транспорт молчит,
   * печатью занимается CLI.
   */
  onProgress?: ProgressCallback;
}

/**
 * Цикл запроса с ретраями и классификацией ответов.
 *
 * Политика:
 * - 2xx — успех;
 * - `classify` вернул `retryable` — повтор с паузой из `retryDelaysMs`;
 * - `kind: 'rate_limited'` — отдельная, более длинная политика: пауза из
 *   `Retry-After` (обрезанная `MAX_RETRY_AFTER_MS`), иначе `rateLimitDelaysMs`,
 *   и суммарный предел времени `rateLimitBudgetMs`;
 * - иначе — сразу ошибка с числом попыток.
 */
export async function requestWithRetries(
  options: RequestWithRetriesOptions,
): Promise<HttpResponse> {
  const mask = options.mask ?? ((text: string) => text);
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const rateLimitDelays = options.rateLimitDelaysMs ?? DEFAULT_RATE_LIMIT_DELAYS_MS;
  const budget = options.rateLimitBudgetMs ?? RATE_LIMIT_BUDGET_MS;
  const pause = options.sleepFn ?? sleep;
  // Потребитель прогресса может отсутствовать — тогда всё превращается в no-op.
  const progress: ProgressCallback = options.onProgress ?? (() => undefined);

  let serverRetries = 0;
  let rateLimitRetries = 0;
  let waitedMs = 0;
  let attempts = 0;

  for (;;) {
    attempts += 1;
    // Оценка «сколько попыток в худшем случае» — нужна для текста «попытка K/M».
    const attemptsMaxFor = (kind: ProgressReason): number =>
      1 + (kind === 'rate_limited' ? rateLimitDelays.length : retryDelays.length);
    progress({ kind: 'request', url: options.url, attempt: attempts, attemptsMax: attemptsMaxFor('server') });

    let result: HttpResponse;
    try {
      result = await fetchOnce({ ...options, mask });
    } catch (err) {
      const failure = err instanceof GitverseHttpError ? err : undefined;
      // timeout/too_large — не ретраим: повтор даст тот же результат.
      if (!failure || failure.kind !== 'network') {
        progress({
          kind: 'error',
          url: options.url,
          attempt: attempts,
          attemptsMax: attemptsMaxFor('network'),
          reason: failure?.kind === 'timeout' ? 'timeout' : failure?.kind === 'too_large' ? 'too_large' : 'network',
          message: failure?.message ?? (err instanceof Error ? err.message : String(err)),
        });
        throw err;
      }
      const delay = retryDelays[serverRetries];
      if (delay !== undefined) {
        progress({
          kind: 'error',
          url: options.url,
          attempt: attempts,
          attemptsMax: attemptsMaxFor('network'),
          reason: 'network',
          message: failure.message,
        });
        serverRetries += 1;
        progress({
          kind: 'waiting',
          url: options.url,
          attempt: attempts + 1,
          attemptsMax: attemptsMaxFor('network'),
          delayMs: delay,
          reason: 'network',
        });
        await pause(delay);
        continue;
      }
      throw options.makeError(
        `${failure.message} — попыток: ${attempts}`,
        'network',
        options.url,
        { attempts },
      );
    }

    progress({
      kind: 'response',
      url: options.url,
      attempt: attempts,
      attemptsMax: attemptsMaxFor('server'),
      status: result.status,
      bytes: result.text.length,
    });

    if (result.status >= 200 && result.status < 300) return result;

    const classified = options.classify(result.status, result.text);
    const message = `${classified.message} — попыток: ${attempts}`;

    if (classified.retryable && classified.kind === 'rate_limited') {
      const fromHeader = parseRetryAfter(result.headers);
      const capped = fromHeader === null ? null : Math.min(fromHeader, MAX_RETRY_AFTER_MS);
      const delay = capped ?? rateLimitDelays[rateLimitRetries];
      // Суммарное ожидание ограничено: «висим минутами молча» — не вариант.
      if (delay !== undefined && waitedMs + delay <= budget) {
        waitedMs += delay;
        rateLimitRetries += 1;
        progress({
          kind: 'waiting',
          url: options.url,
          attempt: attempts + 1,
          attemptsMax: attemptsMaxFor('rate_limited'),
          delayMs: delay,
          reason: 'rate_limited',
        });
        await pause(delay);
        continue;
      }
      // Паузы больше не будет — в тексте сообщаем, сколько сервер просил ждать.
      const hint = classified.retryHint?.(capped ?? delay ?? null) ?? '';
      throw options.makeError(
        mask(hint === '' ? message : `${message}; ${hint}`),
        'rate_limited',
        options.url,
        { status: result.status, attempts },
      );
    }

    if (classified.retryable) {
      const delay = retryDelays[serverRetries];
      if (delay !== undefined) {
        serverRetries += 1;
        progress({
          kind: 'waiting',
          url: options.url,
          attempt: attempts + 1,
          attemptsMax: attemptsMaxFor('server'),
          delayMs: delay,
          reason: 'server',
        });
        await pause(delay);
        continue;
      }
    }

    throw options.makeError(mask(message), classified.kind, options.url, {
      status: result.status,
      ...(classified.retryable ? { attempts } : {}),
    });
  }
}

/** Разбирает JSON-тело успешного ответа. */
export function parseJson(text: string, url: string, ctx: TransportContext): unknown {
  const mask = ctx.mask ?? ((value: string) => value);
  try {
    return JSON.parse(text);
  } catch {
    throw ctx.makeError(
      mask(`ответ ${ctx.what} не является корректным JSON (${url}); проверь источник`),
      'invalid_json',
      url,
    );
  }
}
