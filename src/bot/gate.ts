/**
 * Гейт «есть ли что отвечать» (VL-436, doc-34 §3.2, этап 1).
 *
 * Дешёвая классификация входящего ДО запуска полного рана: короткий промпт,
 * дефолтная модель проекта, таймаут 2–3 с. Смысл (шторм-инцидент 2026-11-19):
 * раньше «стоило ли отвечать» решала модель ВНУТРИ рана, где её роль
 * «отвечать» — отсюда мета-отчёты, выглядящие как содержательные реплики, и
 * петля. Теперь слушающий выбирает: `read_only` — прочитал и промолчал
 * (штатное поведение), `react` — есть что отвечать, ран идёт прежним путём.
 *
 * Надёжность (решения §8.1–8.2):
 * - модель гейта — дефолтная проекта (`createLlmClient({cwd})`:
 *   settings.models.default → env VIBELOG_LLM_MODEL, паттерн приоритета как
 *   у ранов, БЕЗ меты сессии); отдельная настройка — отложена (decision-модели);
 * - таймаут по умолчанию 2500 мс: AbortSignal прокидывается в fetch,
 *   ПЛЮС Promise.race со сторожем — даже если чтение стрима не оборвётся по
 *   signal, гейт вернётся к сроку (двойная страховка);
 * - fail-open: любой сбой (нет модели, сеть, таймаут, непонятный ответ
 *   парсера) → `react` + `error` в результате — потерянный вопрос дороже
 *   лишнего ответа; сбой всегда виден вызывающему для trace.
 *
 * `runGate` НИКОГДА не бросает — вся диагностика в `GateResult.error`.
 */

import type { LlmClient } from '../agent/llm.js';
import { createLlmClient } from '../agent/llm.js';
import { loadApiMode } from '../agent/llm-env.js';
import type { IncomingMsg } from './interbot.js';

/** Таймаут гейта по умолчанию, мс (спека: 2–3 с — гейт не задерживает вход). */
export const GATE_TIMEOUT_MS = 2500;

/** Вердикт гейта: запускать ран или читать молча. */
export type GateVerdict = 'react' | 'read_only';

/** Результат гейта: вердикт + текст сбоя (fail-open: сбой всегда → react). */
export interface GateResult {
  verdict: GateVerdict;
  /** Причина сбоя: сеть/таймаут/отсутствие модели/непонятный ответ. */
  error?: string;
}

/**
 * Короткий промпт классификации (doc-34 §3.2) — без системных промптов рана,
 * без MCP: одна user-строка, ответ строго одно слово.
 *
 * @param msg — входящее сообщение (минимальная форма из dispatch)
 */
export function buildGatePrompt(msg: IncomingMsg): string {
  const author = msg.from_username
    ? `@${msg.from_username}`
    : msg.is_bot
      ? 'чужой бот'
      : 'человек';
  return [
    'Ты — фильтр входящих сообщений interbot-канала другого проекта. Реши, есть ли в сообщении что-то, требующее НАШЕЙ реакции.',
    'Верни ТОЛЬКО одно слово: react — если есть что отвечать; read_only — если отвечать нечего (прочитал и молчишь).',
    'react: вопрос к нам; реплика в нашу ветку; обращение к человеку в нашем присутствии; приветствие человеку (разовая вежливость допустима).',
    'read_only: отчёт или ответ другого бота о том же; служебная ошибка или статус; пустая вежливость либо уже отвеченное сообщение.',
    '',
    `Автор: ${author} (${msg.is_bot ? 'бот' : 'человек'}):`,
    msg.text.slice(0, 2000),
  ].join('\n');
}

/**
 * Разбор ответа гейта в вердикт.
 *
 * Терпим к форме (модель может вернуть «READ_ONLY», «react.», перевод строки);
 * `null` — непонятный ответ, вызывающий трактует как сбой → fail-open react.
 *
 * @returns 'react' | 'read_only' | null
 */
export function parseGateVerdict(raw: string): GateVerdict | null {
  const t = raw.toLowerCase();
  if (t.includes('read_only')) return 'read_only';
  if (t.includes('react')) return 'react';
  return null;
}

/**
 * Запуск гейта для входящего сообщения.
 *
 * @param cwd — каталог проекта (модель из settings.json/env)
 * @param msg — входящее сообщение
 * @param opts.client — готовый клиент (тесты: мок без сети)
 * @param opts.timeoutMs — таймаут, мс (по умолчанию GATE_TIMEOUT_MS)
 * @returns вердикт; при сбое — react + error (никогда не бросает)
 */
export async function runGate(
  cwd: string,
  msg: IncomingMsg,
  opts: { client?: LlmClient; timeoutMs?: number } = {},
): Promise<GateResult> {
  const timeoutMs = opts.timeoutMs ?? GATE_TIMEOUT_MS;
  try {
    // Приоритет модели — как у ранов (llm.ts: options → models.default → env),
    // БЕЗ меты сессии; maxRetries: 0 — ретраи не влезут в таймаут гейта
    const client =
      opts.client ?? createLlmClient({ cwd, apiMode: loadApiMode(cwd), maxRetries: 0 });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Сторож: и abort для fetch, и reject в race — гейт вернётся к сроку
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`таймаут гейта ${timeoutMs} мс`));
      }, timeoutMs);
    });
    try {
      const res = await Promise.race([
        client.streamChat(
          [{ role: 'user', content: buildGatePrompt(msg) }],
          undefined,
          { signal: controller.signal, maxTokens: 16 },
        ),
        timeout,
      ]);
      const verdict = parseGateVerdict(res.text ?? '');
      if (verdict === null) {
        return {
          verdict: 'react',
          error: `непонятный ответ гейта: ${(res.text ?? '').slice(0, 80)}`,
        };
      }
      return { verdict };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // Fail-open (§8.2): нет модели, сеть, таймаут, бросок клиента → react
    return { verdict: 'react', error: (err as Error).message };
  }
}
