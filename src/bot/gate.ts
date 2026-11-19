/**
 * Гейт «есть ли что отвечать» (VL-436, doc-34 §3.2, этап 1).
 *
 * Дешёвая классификация входящего ДО запуска полного рана: короткий промпт,
 * дефолтная модель проекта, таймаут 8000 мс (VL-437: оценка doc-34 «2–3 с»
 * НЕ прошла на живце — факт: короткий вызов mimo 3–5 с, ран 6–7 с).
 * Смысл (шторм-инцидент 2026-11-19):
 * раньше «стоило ли отвечать» решала модель ВНУТРИ рана, где её роль
 * «отвечать» — отсюда мета-отчёты, выглядящие как содержательные реплики, и
 * петля. Теперь слушающий выбирает: `read_only` — прочитал и промолчал
 * (штатное поведение), `react` — есть что отвечать, ран идёт прежним путём.
 *
 * Надёжность (решения §8.1–8.2):
 * - модель гейта — дефолтная проекта (`createLlmClient({cwd})`:
 *   settings.models.default → env VIBELOG_LLM_MODEL, паттерн приоритета как
 *   у ранов, БЕЗ меты сессии); отдельная настройка — отложена (decision-модели);
 * - таймаут по умолчанию 8000 мс (VL-437, выровнен по фактической latency;
 *   инвариант «гейт быстрее рана 10+ с» сохранён): AbortSignal прокидывается
 *   в fetch, ПЛЮС Promise.race со сторожем — даже если чтение стрима не
 *   оборвётся по signal, гейт вернётся к сроку (двойная страховка);
 * - fail-open: любой сбой (нет модели, сеть, таймаут, пустой или непонятный
 *   ответ парсера) → `react` + `error` в результате — потерянный вопрос
 *   дороже лишнего ответа; сбой всегда виден вызывающему для trace;
 * - диагностика сырого ответа (AC2): `raw`/`usage` в GateResult → trace —
 *   по ним видно, что реально вернул streamChat (текст/длина/reasoning-токены).
 *
 * `runGate` НИКОГДА не бросает — вся диагностика в `GateResult.error`.
 */

import type { LlmClient } from '../agent/llm.js';
import { createLlmClient } from '../agent/llm.js';
import { loadApiMode } from '../agent/llm-env.js';
import { gateTimeoutMs, readComms } from '../core/comms.js';
import { loadInterbotPrompt, renderPromptTemplate } from '../core/interbot-prompts.js';
import type { IncomingMsg } from './interbot.js';

/**
 * Таймаут гейта по умолчанию, мс (VL-437, doc-34 §3.2/§8.1).
 *
 * Прежний дефолт 2500 мс и оценка «2–3 с» — НЕВЕРНАЯ оценка, не прошедшая
 * на живце 2026-11-19 (7 вызовов → 7 сбоев): короткий вызов mimo через
 * Xiaomi-роутер 3–5 с, ран с 12–14k системника 6–7 с. Инвариант спеки
 * «гейт не задерживает вход» = «быстрее рана» — выполняется и при 8000 мс.
 *
 * VL-438: это дефолт; фактическое значение — секция interbot_limits
 * comms.yaml (gate_timeout_sec), читается на каждый вызов runGate —
 * настройка горячая, перезапуск бота не нужен.
 */
export const GATE_TIMEOUT_MS = 8000;

/** Вердикт гейта: запускать ран или читать молча. */
export type GateVerdict = 'react' | 'read_only';

/** Результат гейта: вердикт + текст сбоя (fail-open: сбой всегда → react). */
export interface GateResult {
  verdict: GateVerdict;
  /** Причина сбоя: сеть/таймаут/отсутствие модели/пустой/непонятный ответ. */
  error?: string;
  /** Сырой ответ модели до парсинга (первые ~120 символов) — для trace. */
  raw?: string;
  /** Usage вызова: output/reasoning-токены — диагностика пустого ответа. */
  usage?: { output_tokens?: number; reasoning_tokens?: number };
}

/**
 * Короткий промпт классификации (doc-34 §3.2) — без системных промптов рана,
 * без MCP: одна user-строка, ответ строго одно слово.
 *
 * VL-438: текст читается из шаблона (.vibelog/prompts/interbot/gate.md →
 * templates/prompts/interbot/ → встроенная строка) на каждый вызов —
 * настройка горячая. Плейсхолдеры: {author} (@ник|чужой бот|человек),
 * {kind} (бот|человек), {text} — собираются сервером.
 *
 * @param msg — входящее сообщение (минимальная форма из dispatch)
 * @param cwd — каталог проекта для чтения шаблона (без него — пакетный дефолт)
 */
export function buildGatePrompt(msg: IncomingMsg, cwd?: string): string {
  const author = msg.from_username
    ? `@${msg.from_username}`
    : msg.is_bot
      ? 'чужой бот'
      : 'человек';
  const template = loadInterbotPrompt('gate', cwd);
  return renderPromptTemplate(template, {
    author,
    kind: msg.is_bot ? 'бот' : 'человек',
    text: msg.text.slice(0, 2000),
  });
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
  // VL-437 (AC2): нормализация — регистр, обёрточные пробелы/переносы,
  // схлопывание внутренних пробелов; маркеры ищутся в реальном тексте
  // ответа (в нормализованной форме — терпимы «READ_ONLY\n», « react. »)
  const t = raw.toLowerCase().trim().replace(/\s+/g, ' ');
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
  // VL-438: таймаут из comms.yaml (interbot_limits.gate_timeout_sec),
  // без конфига — GATE_TIMEOUT_MS; чтение на каждый вызов — горячо
  const timeoutMs = opts.timeoutMs ?? gateTimeoutMs(readComms(cwd, { warn: () => {} }));
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
          [{ role: 'user', content: buildGatePrompt(msg, cwd) }],
          undefined,
          // VL-437 (AC2): 16 токенов НЕ хватало reasoning-модели mimo —
          // reasoning съедал бюджет, content выходил пустым (2 пустых
          // вердикта на живце 2026-11-19); 64 — с запасом на слово-вердикт
          { signal: controller.signal, maxTokens: 64 },
        ),
        timeout,
      ]);
      // VL-437 (AC2): сырой ответ + usage ДО парсинга — trace-диагностика
      // «что реально вернул streamChat» (текст/длина/reasoning-токены)
      const rawText = res.text ?? '';
      const diag: Pick<GateResult, 'raw' | 'usage'> = {
        raw: rawText.slice(0, 120),
        ...(res.usage
          ? {
              usage: {
                output_tokens: res.usage.output_tokens,
                reasoning_tokens: res.usage.reasoning_tokens,
              },
            }
          : {}),
      };
      // Пустой ответ — отдельная ясная причина fail-open (раньше маскировался
      // под «непонятный»: «непонятный ответ гейта: » с пустым хвостом)
      if (rawText.trim() === '') {
        return {
          verdict: 'react',
          ...diag,
          error: `пустой ответ гейта (длина 0, usage: ${JSON.stringify(diag.usage ?? {})})`,
        };
      }
      const verdict = parseGateVerdict(rawText);
      if (verdict === null) {
        return {
          verdict: 'react',
          ...diag,
          error: `непонятный ответ гейта: ${rawText.slice(0, 80)}`,
        };
      }
      return { verdict, ...diag };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // Fail-open (§8.2): нет модели, сеть, таймаут, бросок клиента → react
    return { verdict: 'react', error: (err as Error).message };
  }
}
