/**
 * Интерактивный вопрос `ask_user` в веб-чате (VL-330).
 *
 * Зачем отдельный модуль: у вопроса своя, не похожая на approval-gate логика —
 * валидация аргументов ДО паузы, валидация ответа пользователя, TTL ожидания и
 * формирование синтетического tool-результата. Держать это в `chat.ts` (1800+
 * строк) значило бы утопить три разные ответственности в одном файле; здесь же
 * всё чистое (кроме журнала вопросов) и тестируется без LLM.
 *
 * Ключевые решения (план VL-330):
 * - один вопрос = один вызов `ask_user`; серия вопросов — очередь вызовов,
 *   каждый со своим toolCallId (батч в одном вызове не делаем: частичный
 *   прогресс пришлось бы хранить отдельно от jsonl-состояния гейта);
 * - без multiSelect: один вариант либо свободный текст;
 * - TTL ожидания — тот же, что у записей `idempotency.json` (24 ч): значение
 *   одно на проект (`IDEMPOTENCY_TTL_MS`), чтобы «срок жизни» не разъезжался.
 *
 * Журнал вопросов (`<threadId>.questions.jsonl`) — диагностика и источник
 * времени постановки вопроса для TTL. Отдельный файл, а не поле в jsonl
 * истории: формат ChatMessage совместим с провайдером, лишние поля в нём
 * ломали бы wire-payload. Имя содержит точку, поэтому `listChatThreads`
 * (фильтр `.jsonl` + THREAD_ID_RE) файл тредом не считает.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { IDEMPOTENCY_TTL_MS } from '../mcp/idempotency.js';

/** Имя инструмента вопроса (единая точка: сервер, тесты, промпт). */
export const ASK_USER_TOOL = 'ask_user';

/** Сколько ждём ответа на вопрос: столько же, сколько живёт запись идемпотентности. */
export const QUESTION_TTL_MS = IDEMPOTENCY_TTL_MS;

/** Минимум/максимум вариантов ответа (схема инструмента и валидация). */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 8;

/** Один вариант ответа. */
export interface AskUserOption {
  id: string;
  label: string;
  description?: string;
}

/** Разобранные аргументы `ask_user`. */
export interface AskUserArgs {
  question: string;
  options: AskUserOption[];
  allowCustom: boolean;
}

/** Результат разбора аргументов: значение либо текст ошибки для модели. */
export type AskUserParse =
  | { ok: true; value: AskUserArgs }
  | { ok: false; error: string };

/** Непустая строка после trim (иначе undefined). */
function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Разбор и валидация аргументов `ask_user` ДО постановки хода на паузу.
 *
 * Битый вопрос нельзя показывать пользователю: пустой текст, меньше двух
 * вариантов, дубли `id` — это ошибка модели, и она возвращается ей как
 * tool-результат, а ход продолжается (паузы не будет).
 *
 * @param args — аргументы вызова от модели
 */
export function parseAskUserArgs(args: Record<string, unknown> | undefined): AskUserParse {
  const raw = args ?? {};
  const question = nonEmpty(raw.question);
  if (question === undefined) {
    return { ok: false, error: 'ask_user: поле question обязательно и не может быть пустым' };
  }
  const rawOptions = raw.options;
  if (!Array.isArray(rawOptions)) {
    return { ok: false, error: 'ask_user: поле options обязательно и должно быть массивом вариантов' };
  }
  if (rawOptions.length < MIN_OPTIONS || rawOptions.length > MAX_OPTIONS) {
    return {
      ok: false,
      error: `ask_user: вариантов должно быть от ${MIN_OPTIONS} до ${MAX_OPTIONS} (передано ${rawOptions.length})`,
    };
  }
  const options: AskUserOption[] = [];
  const seen = new Set<string>();
  for (const [index, item] of rawOptions.entries()) {
    if (typeof item !== 'object' || item === null) {
      return { ok: false, error: `ask_user: вариант #${index + 1} должен быть объектом {id, label}` };
    }
    const option = item as Record<string, unknown>;
    const id = nonEmpty(option.id);
    const label = nonEmpty(option.label);
    if (id === undefined) return { ok: false, error: `ask_user: у варианта #${index + 1} пустой id` };
    if (label === undefined) return { ok: false, error: `ask_user: у варианта #${index + 1} пустой label` };
    if (seen.has(id)) return { ok: false, error: `ask_user: повторяющийся id варианта "${id}"` };
    seen.add(id);
    const description = nonEmpty(option.description);
    options.push({ id, label, ...(description !== undefined ? { description } : {}) });
  }
  // allow_custom по умолчанию true: свободный ввод — обычный сценарий, а
  // отключать его модель должна осознанно (вопрос с фиксированным набором).
  const allowCustom = raw.allow_custom === undefined ? true : raw.allow_custom !== false;
  return { ok: true, value: { question, options, allowCustom } };
}

/** Ответ пользователя на вопрос (тело POST /api/chat, поле answer). */
export interface AskUserAnswer {
  toolCallId: string;
  optionId?: string;
  custom?: string;
}

/** Результат валидации ответа: значение либо текст ошибки для SSE. */
export type AnswerValidation =
  | { ok: true; value: { optionId?: string; custom?: string } }
  | { ok: false; error: string };

/**
 * Валидация ответа пользователя против предложенных вариантов.
 *
 * Правила (AC4): ровно одно из `optionId`/`custom`; `optionId` обязан быть
 * среди предложенных; `custom` — непустой и только при `allowCustom !== false`.
 *
 * @param answer — ответ из тела запроса
 * @param asked — разобранные аргументы вопроса (что было предложено)
 */
export function validateAnswer(
  answer: { optionId?: unknown; custom?: unknown },
  asked: AskUserArgs,
): AnswerValidation {
  const optionId = nonEmpty(answer.optionId);
  const custom = nonEmpty(answer.custom);
  if (optionId !== undefined && custom !== undefined) {
    return { ok: false, error: 'Ответ на вопрос: выберите вариант ИЛИ введите свой текст, не оба сразу' };
  }
  if (optionId === undefined && custom === undefined) {
    return { ok: false, error: 'Ответ на вопрос пуст: выберите вариант или введите свой текст' };
  }
  if (optionId !== undefined) {
    if (!asked.options.some(o => o.id === optionId)) {
      return { ok: false, error: `Ответ на вопрос: варианта "${optionId}" не было среди предложенных` };
    }
    return { ok: true, value: { optionId } };
  }
  if (!asked.allowCustom) {
    return { ok: false, error: 'Ответ на вопрос: свободный ввод для этого вопроса запрещён — выберите вариант' };
  }
  return { ok: true, value: { custom } };
}

/**
 * Синтетический tool-результат с ответом пользователя (AC3).
 *
 * Формат: `{"answer":{"id","label"}}` для варианта либо
 * `{"answer":{"custom":"..."}}` для свободного текста — модель видит ровно то,
 * что выбрал человек, без догадок.
 */
export function answerToolResult(asked: AskUserArgs, value: { optionId?: string; custom?: string }): string {
  if (value.optionId !== undefined) {
    const option = asked.options.find(o => o.id === value.optionId);
    return JSON.stringify({ answer: { id: value.optionId, label: option?.label ?? value.optionId } });
  }
  return JSON.stringify({ answer: { custom: value.custom ?? '' } });
}

/**
 * Синтетический tool-результат «вопрос снят» (пользователь не ответил:
 * прислал новое сообщение, ход упёрся в лимит, истёк TTL).
 *
 * Отдельная форма, а не `ackDenied`: это не отказ в записи, а отсутствие
 * ответа — модель должна задать вопрос заново, а не считать, что получила
 * решение.
 */
export function cancelledQuestionResult(reason: 'cancelled' | 'expired' | 'limit'): string {
  const message =
    reason === 'expired'
      ? 'Вопрос снят по таймауту (24 ч): задайте его заново, если он ещё нужен'
      : reason === 'limit'
        ? 'Вопрос снят: ход остановлен по лимиту, задайте его заново при продолжении'
        : 'Вопрос снят: пользователь не ответил и продолжил диалог';
  return JSON.stringify({ answer: null, cancelled: true, reason, message });
}

/** Запись журнала вопросов треда. */
export interface QuestionLogEntry {
  ts: string;
  event: 'asked' | 'answered' | 'expired' | 'cancelled';
  toolCallId: string;
  question?: string;
  optionId?: string;
  custom?: string;
}

/** Файл журнала вопросов треда (вызывается только с валидным threadId). */
function questionLogFile(cwd: string, threadId: string): string {
  return join(cwd, '.vibelog', 'chat-sessions', `${threadId}.questions.jsonl`);
}

/**
 * Дописать запись в журнал вопросов. Сбой записи не рвёт диалог (паттерн
 * recordApprovalLog): журнал — диагностика и источник времени, а не гарантия.
 */
export function recordQuestionLog(
  cwd: string,
  threadId: string,
  entry: Omit<QuestionLogEntry, 'ts'>,
): void {
  try {
    const dir = join(cwd, '.vibelog', 'chat-sessions');
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      questionLogFile(cwd, threadId),
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n',
      'utf8',
    );
  } catch {
    // журнал не критичен: вопрос уже в jsonl истории
  }
}

/** Чтение журнала вопросов; битые строки пропускаем (паттерн истории). */
export function loadQuestionLog(cwd: string, threadId: string): QuestionLogEntry[] {
  const file = questionLogFile(cwd, threadId);
  if (!existsSync(file)) return [];
  const out: QuestionLogEntry[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as QuestionLogEntry);
    } catch {
      // мусорная строка не должна ронять диагностику
    }
  }
  return out;
}

/**
 * Момент постановки вопроса (мс) либо null, если записи нет.
 *
 * Нет записи (тред создан до VL-330 или журнал потерян) — null: TTL в этом
 * случае НЕ применяется (fail-open). Иначе вопрос, заданный до появления
 * журнала, «снимался» бы сразу после обновления.
 */
export function questionAskedAt(cwd: string, threadId: string, toolCallId: string): number | null {
  for (const entry of loadQuestionLog(cwd, threadId)) {
    if (entry.event !== 'asked' || entry.toolCallId !== toolCallId) continue;
    const at = Date.parse(entry.ts);
    if (Number.isFinite(at)) return at;
  }
  return null;
}

/**
 * Истёк ли срок ожидания ответа (AC: TTL 24 ч).
 *
 * @param askedAt — момент постановки вопроса (null — записи нет, не истекает)
 * @param now — текущее время (мс), параметр для тестов
 */
export function isQuestionExpired(askedAt: number | null, now: number = Date.now()): boolean {
  if (askedAt === null) return false;
  return now - askedAt > QUESTION_TTL_MS;
}
