/**
 * Сжатие контекста веб-чата: sidecar-точка и сборка payload (VL-314).
 *
 * Решения (согласованы с Pavel, фича 2 из трёх):
 *
 * 1. **UI-история не сжимается никогда.** Как у агента фаз (VL-122): jsonl
 *    треда и лента остаются полными, сжимается ТОЛЬКО payload, уходящий в
 *    модель. Точка сжатия живёт в sidecar
 *    `<cwd>/.vibelog/chat-sessions/<threadId>.compaction.json` (имя с точкой
 *    → `listChatThreads` по фильтру `.jsonl` его не видит, lesson-151).
 * 2. **Два способа**: `trim` — детерминированное усечение (0 ₽, мгновенно,
 *    из VL-122) и `summary` — LLM-саммари (как в Qwen Code). Оба пишут одну
 *    и ту же точку `fromIndex`; разница — есть ли `summary`-текст.
 * 3. **Сброс — удаление sidecar**: payload снова полный.
 * 4. **Орфан-гард не дублируется**: сборка payload зовёт общий
 *    `compactWireMessages` (`src/agent/compact.ts`), поэтому пара
 *    `tool_calls ↔ tool` не рвётся ни в одном из способов.
 *
 * Модуль намеренно чистый по части LLM: саммари-вызов делает `chat.ts`
 * (у него есть клиент и учёт usage), здесь — только состояние и payload.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ChatMessage } from '../agent/llm.js';
import { compactWireMessages } from '../agent/compact.js';
import { loadSettings } from '../core/settings.js';

/** threadId попадает в имя файла — защита от path-traversal (как в chat.ts). */
const THREAD_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Каталог сессий чата. Дублируем строку, а не импортируем `chatSessionsDir`
 * из `chat.ts`: тот импортирует ЭТОТ модуль — циклическая зависимость ESM
 * (пусть и рабочая) мешала бы изолированным unit-тестам (паттерн chat-usage).
 */
function chatSessionsDir(cwd: string): string {
  return join(cwd, '.vibelog', 'chat-sessions');
}

/** Способ сжатия: детерминированное усечение либо LLM-саммари. */
export type CompactionMethod = 'trim' | 'summary';

/**
 * Точка сжатия треда (содержимое sidecar).
 *
 * `fromIndex` — индекс в jsonl-истории, С которого сообщения уходят в модель
 * (всё до него заменяется первым user-сообщением + заметкой/саммари).
 */
export interface CompactionState {
  /** Индекс первого сообщения хвоста в полной истории треда. */
  fromIndex: number;
  /** Как получена точка: усечение или саммари. */
  method: CompactionMethod;
  /** Текст саммари (только для method === 'summary'). */
  summary?: string;
  /** Оценка токенов payload до сжатия (для отчёта и плашки). */
  tokensBefore?: number;
  /** Оценка токенов payload после сжатия. */
  tokensAfter?: number;
  /** Момент записи точки (ISO). */
  compactedAt: string;
}

/** Файл точки сжатия треда. */
function compactionFile(cwd: string, threadId: string): string {
  return join(chatSessionsDir(cwd), `${threadId}.compaction.json`);
}

/**
 * Прочитать точку сжатия треда.
 *
 * Нет файла / битый JSON / чужой threadId / некорректный `fromIndex` → null
 * (payload собирается полным — сбой sidecar не должен ломать диалог).
 */
export function loadCompaction(cwd: string, threadId: string): CompactionState | null {
  if (!THREAD_ID_RE.test(threadId)) return null;
  const file = compactionFile(cwd, threadId);
  if (!existsSync(file)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const v = raw as Record<string, unknown>;
    const fromIndex = v.fromIndex;
    if (typeof fromIndex !== 'number' || !Number.isInteger(fromIndex) || fromIndex < 0) return null;
    const method: CompactionMethod = v.method === 'summary' ? 'summary' : 'trim';
    const num = (x: unknown): number | undefined =>
      typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined;
    const tokensBefore = num(v.tokensBefore);
    const tokensAfter = num(v.tokensAfter);
    return {
      fromIndex,
      method,
      ...(typeof v.summary === 'string' && v.summary.trim() !== '' ? { summary: v.summary } : {}),
      ...(tokensBefore !== undefined ? { tokensBefore } : {}),
      ...(tokensAfter !== undefined ? { tokensAfter } : {}),
      compactedAt: typeof v.compactedAt === 'string' ? v.compactedAt : '',
    };
  } catch {
    return null; // битый sidecar — считаем, что сжатия нет
  }
}

/** Записать точку сжатия (тихая: сбой записи не рвёт диалог). */
export function saveCompaction(cwd: string, threadId: string, state: CompactionState): void {
  if (!THREAD_ID_RE.test(threadId)) return;
  try {
    mkdirSync(chatSessionsDir(cwd), { recursive: true });
    writeFileSync(compactionFile(cwd, threadId), JSON.stringify(state, null, 2) + '\n', 'utf8');
  } catch {
    // сбой записи точки не должен рвать текущий ход
  }
}

/**
 * Сбросить сжатие треда (удалить sidecar).
 *
 * @returns true — файл был и удалён; false — сбрасывать было нечего
 */
export function resetCompaction(cwd: string, threadId: string): boolean {
  if (!THREAD_ID_RE.test(threadId)) return false;
  const file = compactionFile(cwd, threadId);
  if (!existsSync(file)) return false;
  try {
    rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Грубая оценка токенов сообщений: ~4 символа на токен (тот же порядок,
 * что у эвристик провайдеров). Точность здесь не нужна — значение служит
 * для выбора точки отсечения и для отчёта пользователю.
 */
export function estimateTokens(messages: readonly ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') chars += m.content.length;
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) chars += JSON.stringify(tc.arguments ?? {}).length + tc.name.length;
    }
  }
  return Math.ceil(chars / 4);
}

/**
 * Собрать payload для модели с учётом точки сжатия.
 *
 * `trim` — общий `compactWireMessages` (первый user + заметка + хвост с
 * орфан-гардом). `summary` — первый user заменяется саммари (инкрементальный
 * паттерн: саммари переписывается, а не накапливается), хвост — с той же
 * точки, орфан-гард тот же.
 *
 * @param messages — полная история треда (jsonl), НЕ мутируется
 * @param state — точка сжатия (null — payload полный)
 */
export function buildWireMessages(
  messages: ChatMessage[],
  state: CompactionState | null,
): ChatMessage[] {
  if (state === null) return messages;
  const trimmed = compactWireMessages(messages, state.fromIndex);
  // compactWireMessages вернул исходный массив — отсекать нечего
  if (trimmed === messages) return messages;
  if (state.method !== 'summary' || !state.summary) return trimmed;
  // Саммари заменяет служебную заметку об усечении: модель видит связный
  // пересказ вместо «опущено N сообщений».
  const firstUserIdx = trimmed.findIndex(m => m.role === 'user');
  if (firstUserIdx === -1) return trimmed;
  const head = trimmed.slice(0, firstUserIdx + 1);
  head[firstUserIdx] = {
    role: 'user',
    content: `[Сжатая история диалога]\n\n${state.summary}`,
  };
  return [...head, ...trimmed.slice(firstUserIdx + 1)];
}

/**
 * Выбрать точку отсечения по цели в токенах.
 *
 * Идём с конца, накапливая оценку токенов, пока не наберём `targetTokens`;
 * точка — индекс первого сообщения, попавшего в бюджет. Орфан-гард
 * применяется позже (`buildWireMessages`), поэтому здесь достаточно
 * «сколько хвоста оставить».
 *
 * @returns индекс начала хвоста; `messages.length` — оставлять нечего
 *   (история целиком в бюджете, сжимать не нужно)
 */
export function pickTrimIndex(messages: readonly ChatMessage[], targetTokens: number): number {
  if (messages.length === 0) return 0;
  const target = Math.max(1, Math.floor(targetTokens));
  let acc = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    acc += estimateTokens([messages[i]!]);
    if (acc > target) return i + 1;
  }
  return messages.length; // вся история влезает в цель — сжимать нечего
}

/**
 * Цель сжатия в токенах: процент окна либо абсолютный fallback.
 *
 * Окно неизвестно (модель без `context_window`) → `targetTokens`
 * (дефолт 50 000). Процент ограничен 1..100.
 */
export function resolveTargetTokens(
  contextWindow: number | undefined,
  targetPercent: number,
  targetTokens: number,
): number {
  if (contextWindow !== undefined && Number.isFinite(contextWindow) && contextWindow > 0) {
    const pct = Math.min(100, Math.max(1, targetPercent));
    return Math.max(1, Math.round((contextWindow * pct) / 100));
  }
  return Math.max(1, Math.floor(targetTokens));
}

/** Параметры сжатия контекста веб-чата (секция `chat` settings.json). */
export interface ChatCompactionSettings {
  /** Включено ли сжатие (false — команды /trim и /compact отказывают). */
  enabled: boolean;
  /** Цель сжатия в процентах от контекстного окна модели. */
  targetPercent: number;
  /** Fallback-цель в токенах, когда окно модели неизвестно. */
  targetTokens: number;
  /** Сколько последних сообщений всегда остаётся в payload несжатыми. */
  keepTail: number;
}

/** Дефолты сжатия (решения VL-314: 5% окна / 50 000 токенов / хвост 10). */
export const CHAT_COMPACTION_DEFAULT: ChatCompactionSettings = {
  enabled: true,
  targetPercent: 5,
  targetTokens: 50_000,
  keepTail: 10,
};

/** Потолки значений — защита от «поставлю 100000» (предсказуемость). */
export const CHAT_COMPACTION_CEILING = {
  targetPercent: 100,
  targetTokens: 10_000_000,
  keepTail: 1_000,
} as const;

/** Ключи секции `chat`, относящиеся к сжатию (для валидации настроек). */
export const CHAT_COMPACTION_KEYS = [
  'compact_enabled',
  'compact_target_percent',
  'compact_target_tokens',
  'compact_keep_tail',
] as const;

/** Результат чтения параметров сжатия: значения + проблемы конфига. */
export interface ChatCompactionResolution {
  settings: ChatCompactionSettings;
  /** Сообщения о мусорных значениях (откат к дефолту уже сделан). */
  errors: string[];
}

/** Целое в диапазоне 1..ceiling либо null (мусор — вызывающий берёт дефолт). */
function readInt(raw: unknown, ceiling: number): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  return raw >= 1 && raw <= ceiling ? raw : null;
}

/**
 * Параметры сжатия из `.vibelog/settings.json` (секция `chat`).
 *
 * Терпимый парсинг (lesson-117, AC9): отсутствие секции/ключа — дефолт БЕЗ
 * ошибки; присутствующий, но невалидный ключ — дефолт + сообщение в
 * `errors`; битый settings.json — все дефолты. Падения нет ни при каком
 * содержимом файла.
 *
 * @param cwd — каталог проекта (там же, где backlog/ и .vibelog/)
 */
export function resolveChatCompaction(cwd: string): ChatCompactionResolution {
  const errors: string[] = [];
  const settings: ChatCompactionSettings = { ...CHAT_COMPACTION_DEFAULT };
  const raw = loadSettings(cwd).chat;
  if (raw === undefined || raw === null) return { settings, errors };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`chat: ожидается объект с ключами ${CHAT_COMPACTION_KEYS.join(', ')} — взяты дефолты`);
    return { settings, errors };
  }
  const section = raw as Record<string, unknown>;

  if (section.compact_enabled !== undefined) {
    if (typeof section.compact_enabled === 'boolean') settings.enabled = section.compact_enabled;
    else {
      errors.push(
        `chat.compact_enabled: ожидается boolean, получено ${JSON.stringify(section.compact_enabled)} — взято ${CHAT_COMPACTION_DEFAULT.enabled}`,
      );
    }
  }

  const percent = readInt(section.compact_target_percent, CHAT_COMPACTION_CEILING.targetPercent);
  if (percent !== null) settings.targetPercent = percent;
  else if (section.compact_target_percent !== undefined) {
    errors.push(
      `chat.compact_target_percent: ожидается целое 1..${CHAT_COMPACTION_CEILING.targetPercent}, получено ${JSON.stringify(section.compact_target_percent)} — взято ${CHAT_COMPACTION_DEFAULT.targetPercent}`,
    );
  }

  const tokens = readInt(section.compact_target_tokens, CHAT_COMPACTION_CEILING.targetTokens);
  if (tokens !== null) settings.targetTokens = tokens;
  else if (section.compact_target_tokens !== undefined) {
    errors.push(
      `chat.compact_target_tokens: ожидается целое 1..${CHAT_COMPACTION_CEILING.targetTokens}, получено ${JSON.stringify(section.compact_target_tokens)} — взято ${CHAT_COMPACTION_DEFAULT.targetTokens}`,
    );
  }

  const keepTail = readInt(section.compact_keep_tail, CHAT_COMPACTION_CEILING.keepTail);
  if (keepTail !== null) settings.keepTail = keepTail;
  else if (section.compact_keep_tail !== undefined) {
    errors.push(
      `chat.compact_keep_tail: ожидается целое 1..${CHAT_COMPACTION_CEILING.keepTail}, получено ${JSON.stringify(section.compact_keep_tail)} — взято ${CHAT_COMPACTION_DEFAULT.keepTail}`,
    );
  }

  return { settings, errors };
}

/** Путь к встроенному шаблону саммари (dist/web/chat-compaction.js → ../../templates/prompts/). */
const bundledSummaryTemplatePath = fileURLToPath(
  new URL('../../templates/prompts/chat-summary.md', import.meta.url),
);

/** Переопределение проектом (схема VL-188), относительно cwd. */
export const PROJECT_CHAT_SUMMARY_PATH = join('.vibelog', 'prompts', 'chat-summary.md');

/**
 * Шаблон промпта саммари: `<cwd>/.vibelog/prompts/chat-summary.md` →
 * встроенный `templates/prompts/chat-summary.md`, иначе fail-closed throw
 * (зеркало `loadChatSystemTemplate`, VL-188/AC7).
 *
 * В settings.json живут только числа (проценты/токены), текст промпта —
 * файлом: правка формулировок не требует релиза пакета.
 *
 * @throws Error при отсутствии шаблона в обоих каталогах (ошибка установки)
 */
export function loadChatSummaryTemplate(cwd: string): string {
  try {
    return readFileSync(join(cwd, PROJECT_CHAT_SUMMARY_PATH), 'utf8').trimEnd();
  } catch {
    // Нет переопределения — падаем на встроенный шаблон
  }
  try {
    return readFileSync(bundledSummaryTemplatePath, 'utf8').trimEnd();
  } catch {
    throw new Error(
      `Шаблон chat-summary.md не найден: ${PROJECT_CHAT_SUMMARY_PATH} (проект) и ${bundledSummaryTemplatePath} (пакет)`,
    );
  }
}
