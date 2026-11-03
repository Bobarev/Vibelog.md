/**
 * Проверки окружения для wizard-а настройки проекта (VL-210, шаг 7).
 *
 * Три независимые проверки:
 * - pingLlm — реальный запрос к LLM выбранной модели (chat/completions или
 *   responses, ветвление только по URL и телу — lesson-60);
 * - checkAgentBinary — наличие внешнего агента в PATH и его версия;
 * - checkTelegramToken — getMe Telegram Bot API.
 *
 * Все функции НИКОГДА не бросают: ошибка возвращается полем error, чтобы
 * wizard показал понятное сообщение вместо стектрейса. Сеть и spawn
 * инъектируются (fetchImpl / spawnImpl) — тесты не ходят в реальную сеть
 * (fetch-guard VL-132, spawn-guard VL-226).
 */

import { spawnSync } from 'node:child_process';
import type { ActiveModel } from './models.js';

/** Результат ping-а LLM. */
export interface LlmPingResult {
  ok: boolean;
  /** id/имя модели, к которой обращались. */
  model: string;
  /** Задержка запроса, мс. */
  latencyMs: number;
  /** usage провайдера (если ответил). */
  usage?: { input: number; output: number; total: number };
  /** HTTP-статус (если ответ получен). */
  status?: number;
  /** Понятное сообщение об ошибке. */
  error?: string;
  /** Обрезанное тело ответа (для диагностики 4xx/5xx). */
  bodySnippet?: string;
}

/** Результат проверки внешнего агента. */
export interface AgentCheckResult {
  found: boolean;
  path?: string;
  version?: string;
  error?: string;
}

/** Результат проверки токена Telegram. */
export interface BotCheckResult {
  ok: boolean;
  username?: string;
  error?: string;
}

/** Максимум символов тела ответа в bodySnippet. */
const BODY_SNIPPET_MAX = 300;

/** Дефолтный таймаут ping-а LLM, мс. */
const PING_TIMEOUT_MS = 10_000;

/** Минимальная поддерживаемая версия qwen (описание VL-210). */
const QWEN_MIN_VERSION = '0.24';

/** Обрезает тело ответа до безопасной длины. */
function snippet(text: string): string {
  return text.length > BODY_SNIPPET_MAX ? `${text.slice(0, BODY_SNIPPET_MAX)}…` : text;
}

/** Достаёт usage из ответа chat/completions или responses (терпимо к форме). */
function extractUsage(body: unknown): LlmPingResult['usage'] {
  if (body === null || typeof body !== 'object') return undefined;
  const raw = (body as Record<string, unknown>).usage;
  if (raw === null || typeof raw !== 'object') return undefined;
  const u = raw as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  // chat: prompt_tokens/completion_tokens/total_tokens;
  // responses: input_tokens/output_tokens/total_tokens
  const input = num(u.prompt_tokens) || num(u.input_tokens);
  const output = num(u.completion_tokens) || num(u.output_tokens);
  const total = num(u.total_tokens) || input + output;
  if (input === 0 && output === 0 && total === 0) return undefined;
  return { input, output, total };
}

/**
 * Проверяет доступность LLM одним коротким запросом.
 *
 * @param active — резолвнутая модель (baseUrl/apiKey/model/apiMode)
 * @param opts.fetchImpl — подмена fetch (тесты)
 * @param opts.timeoutMs — таймаут запроса (дефолт 10 с)
 */
export async function pingLlm(
  active: ActiveModel,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<LlmPingResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? PING_TIMEOUT_MS;
  const baseUrl = active.baseUrl.replace(/\/+$/, '');
  const isResponses = active.apiMode === 'responses';
  const url = isResponses ? `${baseUrl}/responses` : `${baseUrl}/chat/completions`;
  // VL-315: апстрим шлюза — структурно в теле (проверено живым запросом:
  // /v1/responses принимает provider, несуществующий вендор → 404)
  const providerField = active.vendor
    ? { provider: { order: [active.vendor], allow_fallbacks: false } }
    : {};
  const body = isResponses
    ? { model: active.model, input: 'ping', max_output_tokens: 16, ...providerField }
    : {
        model: active.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        ...providerField,
      };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(active.apiKey ? { Authorization: `Bearer ${active.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        model: active.model,
        latencyMs,
        status: res.status,
        error: `LLM ответил ${res.status}. Проверьте base_url, api_key и имя модели.`,
        bodySnippet: snippet(text),
      };
    }
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Не-JSON 200 — считаем ошибкой формата, но показываем тело
      return {
        ok: false,
        model: active.model,
        latencyMs,
        status: res.status,
        error: 'Ответ LLM не является JSON. Проверьте base_url (возможно, это не OpenAI-совместимый API).',
        bodySnippet: snippet(text),
      };
    }
    return {
      ok: true,
      model: active.model,
      latencyMs,
      status: res.status,
      usage: extractUsage(parsed),
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const isAbort = (err as Error)?.name === 'AbortError';
    return {
      ok: false,
      model: active.model,
      latencyMs,
      error: isAbort
        ? `LLM не ответил за ${timeoutMs} мс. Проверьте base_url и сеть.`
        : `Не удалось подключиться к LLM: ${(err as Error)?.message ?? String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Сравнивает версии вида "0.24.1" (числовое сравнение по компонентам). */
function versionAtLeast(version: string, min: string): boolean {
  const a = version.split('.').map((x) => parseInt(x, 10) || 0);
  const b = min.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}

/** Достаёт первую версию вида x.y.z из вывода `--version`. */
function parseVersion(output: string): string | undefined {
  const match = output.match(/(\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : undefined;
}

/**
 * Проверяет наличие внешнего агента в PATH и его версию.
 *
 * @param id — qwen | opencode
 * @param opts.spawnImpl — подмена spawnSync (тесты)
 */
export function checkAgentBinary(
  id: 'qwen' | 'opencode',
  opts: { spawnImpl?: typeof spawnSync } = {},
): AgentCheckResult {
  const spawn = opts.spawnImpl ?? spawnSync;
  const installHint =
    id === 'qwen'
      ? 'qwen не найден. Установите: npm i -g @qwen-code/qwen-code'
      : 'opencode не найден. Установите по инструкции https://opencode.ai';

  let whichOut = '';
  try {
    const which = spawn('which', [id], { encoding: 'utf-8', timeout: 2000 });
    if (which.error || which.status !== 0) {
      return { found: false, error: installHint };
    }
    whichOut = String(which.stdout ?? '').trim();
  } catch {
    return { found: false, error: installHint };
  }
  if (whichOut === '') return { found: false, error: installHint };

  let version: string | undefined;
  try {
    const ver = spawn(id, ['--version'], { encoding: 'utf-8', timeout: 2000 });
    if (!ver.error) {
      version = parseVersion(`${ver.stdout ?? ''}${ver.stderr ?? ''}`);
    }
  } catch {
    // Версию получить не удалось — не ошибка: бинарь найден
  }

  if (id === 'qwen' && version && !versionAtLeast(version, QWEN_MIN_VERSION)) {
    return {
      found: true,
      path: whichOut,
      version,
      error: `qwen ${version} устарел: требуется ${QWEN_MIN_VERSION}+. Обновите: npm i -g @qwen-code/qwen-code`,
    };
  }

  return { found: true, path: whichOut, version };
}

/**
 * Проверяет токен Telegram-бота через getMe.
 *
 * Токен НЕ попадает в текст ошибки (он в URL запроса — секрет).
 *
 * @param token — токен бота
 * @param opts.fetchImpl — подмена fetch (тесты)
 * @param opts.timeoutMs — таймаут запроса (дефолт 10 с)
 */
export async function checkTelegramToken(
  token: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<BotCheckResult> {
  if (!token || token.trim() === '') {
    return { ok: false, error: 'Токен не задан. Проверьте TELEGRAM_BOT_TOKEN.' };
  }
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? PING_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token.trim()}/getMe`, {
      method: 'GET',
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const obj = (parsed ?? {}) as Record<string, unknown>;
    if (!res.ok || obj.ok !== true) {
      const description = typeof obj.description === 'string' ? obj.description : `HTTP ${res.status}`;
      return {
        ok: false,
        error: `Токен невалиден (${description}). Проверьте TELEGRAM_BOT_TOKEN или прокси.`,
      };
    }
    const result = (obj.result ?? {}) as Record<string, unknown>;
    const username = typeof result.username === 'string' ? result.username : undefined;
    return { ok: true, username };
  } catch (err) {
    const isAbort = (err as Error)?.name === 'AbortError';
    return {
      ok: false,
      error: isAbort
        ? `Telegram не ответил за ${timeoutMs} мс. Проверьте сеть или прокси.`
        : `Не удалось проверить токен: ${(err as Error)?.message ?? String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
