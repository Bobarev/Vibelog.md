/**
 * Память персоны веб-чата: чтение и запись (VL-401 — чтение, VL-402 — запись).
 *
 * Память — файл `.vibelog/prompts/personas/<prompt>.memory.md` рядом с промптом
 * роли. VL-401 научил чат ПОДСТАВЛЯТЬ этот файл в системный промпт блоком
 * `## Память персоны`, но заполнять его можно было только руками. Эта задача
 * добавляет запись: инструмент `memory_remember` (модель), команду `/memory`
 * (пользователь) и отмену записи из ленты чата.
 *
 * Почему модуль в core, а не в web: операции над файлом — чистая работа с
 * текстом (парсинг строк, лимит, атомарная запись), без HTTP и без LLM. Их
 * используют и веб-слой (`src/web/chat-memory.ts`), и тесты; держать это в
 * `src/web/personas.ts` значило бы смешать реестр ролей с файловыми правками.
 *
 * Формат записи — список строк с датой в конце:
 *   `- Не использовать англицизмы без перевода. (2026-11-10)`
 * Строка, не начинающаяся с `- `, считается продолжением предыдущей записи
 * (многострочные записи допустимы: правило может занимать два-три предложения).
 * Всё, что стоит ДО первой записи (preamble), сохраняется как есть — файл
 * может быть начат человеком с заголовка, и read-modify-write не должен его
 * терять.
 *
 * Лимит (`persona_memory.max_chars`, дефолт 2500) — жёсткий: при превышении
 * запись НЕ добавляется и НЕ обрезается молча, вызывающий получает причину с
 * текущим размером и лимитом (AC3). Обрезка при ЧТЕНИИ (VL-401) остаётся:
 * файл мог быть заполнен руками сверх лимита.
 *
 * Атомарность: файл маленький (≤ лимита), поэтому каждая операция —
 * read-modify-write целиком через temp+rename (паттерн `writeJsonAtomic` из
 * `src/core/components-config.ts`). Полноценный lock не нужен: гонка двух
 * вкладок редка, потеря одной записи не катастрофа (риск R3 плана VL-402).
 */

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { loadSettings } from './settings.js';

/** Каталог проектных промптов ролей (относительно cwd). */
export const PROJECT_PERSONAS_DIR = join('.vibelog', 'prompts', 'personas');

/** Суффикс файла памяти персоны: `<prompt>.memory.md`. */
export const PERSONA_MEMORY_SUFFIX = '.memory.md';

/**
 * Дефолтный лимит памяти персоны в символах.
 *
 * 2500 символов ≈ 600–800 токенов: память подставляется в КАЖДЫЙ ход чата,
 * поэтому дефолт подобран так, чтобы не раздувать промпт.
 */
export const PERSONA_MEMORY_DEFAULT_MAX_CHARS = 2500;

/** Одна запись памяти. */
export interface MemoryEntry {
  /** Номер записи с 1 (как в `/memory` и в кнопке «Убрать»). */
  index: number;
  /** Текст записи без маркера `- ` и без даты. */
  text: string;
  /** Дата записи `YYYY-MM-DD` ('' — дата не распознана). */
  date: string;
  /** Исходные строки записи (для read-modify-write без потерь). */
  raw: string;
}

/** Состояние памяти персоны: записи + размер + лимит. */
export interface MemoryState {
  entries: MemoryEntry[];
  /** Строки файла до первой записи (заголовок, комментарии) — сохраняются. */
  preamble: string[];
  /** Размер памяти в символах (0 — файла нет). */
  chars: number;
  /** Действующий лимит в символах. */
  limit: number;
}

/** Результат записи: успех с записью либо отказ с понятной причиной. */
export type MemoryWriteResult =
  | { ok: true; entry: MemoryEntry; chars: number; limit: number }
  /**
   * Отказ (файл не меняется). `chars`/`limit` заполняются ТОЛЬКО при
   * превышении лимита (VL-419): вызывающий по ним отличает переполнение
   * от пустого текста/дубля и может подсказать модель выход
   * (`memory_forget` в веб-чате).
   */
  | { ok: false; reason: string; chars?: number; limit?: number };

/** Результат удаления записи. */
export type MemoryRemoveResult =
  | { ok: true; removed: MemoryEntry; chars: number; limit: number }
  | { ok: false; reason: string };

/** Результат очистки памяти. */
export interface MemoryClearResult {
  ok: true;
  /** Сколько записей было удалено. */
  removed: number;
  chars: number;
  limit: number;
}

/** Относительный путь файла памяти персоны (для сообщений и тестов). */
export function personaMemoryRelPath(prompt: string): string {
  return join(PROJECT_PERSONAS_DIR, `${prompt}${PERSONA_MEMORY_SUFFIX}`);
}

/** Абсолютный путь файла памяти персоны. */
export function personaMemoryPath(cwd: string, prompt: string): string {
  return join(cwd, personaMemoryRelPath(prompt));
}

/**
 * Лимит памяти персоны из `.vibelog/settings.json`.
 *
 * Секция `persona_memory`, ключ `max_chars`; дефолт
 * `PERSONA_MEMORY_DEFAULT_MAX_CHARS`. Битое/нечисловое/≤0 значение не роняет
 * чат (паттерн readLessonSettings): берётся дефолт, а в `errors` попадает
 * понятное сообщение — настройка не должна ломать подстановку памяти.
 *
 * @param errors — необязательный аккумулятор предупреждений (реестр ролей)
 */
export function readPersonaMemoryLimit(cwd: string, errors?: string[]): number {
  let raw: unknown;
  try {
    raw = loadSettings(cwd).persona_memory;
  } catch {
    return PERSONA_MEMORY_DEFAULT_MAX_CHARS;
  }
  if (raw === undefined) return PERSONA_MEMORY_DEFAULT_MAX_CHARS;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors?.push('settings.json: секция persona_memory должна быть объектом {max_chars: число}');
    return PERSONA_MEMORY_DEFAULT_MAX_CHARS;
  }
  const value = (raw as Record<string, unknown>).max_chars;
  if (value === undefined) return PERSONA_MEMORY_DEFAULT_MAX_CHARS;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    errors?.push(
      `settings.json: persona_memory.max_chars должен быть положительным числом (получено ${JSON.stringify(value)}) — используется дефолт ${PERSONA_MEMORY_DEFAULT_MAX_CHARS}`,
    );
    return PERSONA_MEMORY_DEFAULT_MAX_CHARS;
  }
  return Math.floor(num);
}

/** Локальная дата `YYYY-MM-DD` (не UTC: пользователь видит свой день). */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Хвост записи с датой: ` (2026-11-10)` в конце последней строки. */
const DATE_TAIL_RE = /\s*\((\d{4}-\d{2}-\d{2})\)\s*$/;

/**
 * Разбирает строки файла на preamble и записи.
 *
 * Строка `- ` начинает новую запись; любая другая непустая строка — её
 * продолжение. Пустые строки внутри записи сохраняются как часть raw, но
 * хвостовые пустые строки файла отбрасываются (файл перезаписывается с одним
 * завершающим переводом строки).
 */
function parseMemoryLines(lines: string[]): {
  preamble: string[];
  entries: { raw: string; text: string; date: string }[];
} {
  const preamble: string[] = [];
  const groups: string[][] = [];
  for (const line of lines) {
    if (line.startsWith('- ')) {
      groups.push([line]);
    } else if (groups.length > 0) {
      groups[groups.length - 1]!.push(line);
    } else {
      preamble.push(line);
    }
  }
  // Хвостовые пустые строки последней записи — форматирование файла, не текст
  const last = groups[groups.length - 1];
  if (last) {
    while (last.length > 0 && last[last.length - 1]!.trim() === '') last.pop();
  }
  while (preamble.length > 0 && preamble[preamble.length - 1]!.trim() === '') preamble.pop();

  const entries = groups.map(group => {
    const body = [...group];
    body[0] = body[0]!.slice(2); // снять маркер "- "
    let date = '';
    const tail = body[body.length - 1]!;
    const match = DATE_TAIL_RE.exec(tail);
    if (match) {
      date = match[1]!;
      body[body.length - 1] = tail.slice(0, match.index);
    }
    return { raw: group.join('\n'), text: body.join('\n').trim(), date };
  });
  return { preamble, entries };
}

/** Читает память персоны: записи, preamble, размер и лимит. */
export function readMemoryEntries(cwd: string, prompt: string): MemoryState {
  const limit = readPersonaMemoryLimit(cwd);
  let raw = '';
  try {
    raw = readFileSync(personaMemoryPath(cwd, prompt), 'utf8');
  } catch {
    // ENOENT — штатное «памяти нет»; прочие ошибки чтения тоже не роняют чат
    return { entries: [], preamble: [], chars: 0, limit };
  }
  const text = raw.trim();
  if (text === '') return { entries: [], preamble: [], chars: 0, limit };
  const { preamble, entries } = parseMemoryLines(raw.split('\n'));
  return {
    entries: entries.map((e, i) => ({ index: i + 1, text: e.text, date: e.date, raw: e.raw })),
    preamble,
    chars: text.length,
    limit,
  };
}

/** Собирает содержимое файла из preamble и записей (с завершающим \n). */
function serializeMemory(preamble: string[], entries: readonly { raw: string }[]): string {
  const lines: string[] = [...preamble];
  if (lines.length > 0 && entries.length > 0) lines.push('');
  for (const e of entries) lines.push(e.raw);
  if (lines.length === 0) return '';
  return `${lines.join('\n')}\n`;
}

/** Атомарная запись текста: temp-файл в том же каталоге + rename. */
function writeTextAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const fd = openSync(tmp, 'w');
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // temp мог не создаться — тогда и чистить нечего
    }
    throw err;
  }
}

/**
 * Нормализация текста для сравнения дублей: регистр, пробелы, хвостовая
 * пунктуация. «Не пиши англицизмами» и «не пиши англицизмами.» — дубль.
 */
function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?;:,]+$/u, '')
    .trim();
}

/** Точка в конце записи не дублируется, если текст уже кончается на .!? */
function withSentenceDot(text: string): string {
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

/**
 * Добавляет запись в память персоны (AC1/AC3).
 *
 * Отказы (файл НЕ меняется): пустой текст, дубль существующей записи
 * (сравнение без даты и пунктуации), превышение лимита `max_chars`.
 * Формат строки — `- <текст>. (YYYY-MM-DD)`.
 */
export function appendMemoryEntry(
  cwd: string,
  prompt: string,
  text: string,
  now: Date = new Date(),
): MemoryWriteResult {
  const clean = typeof text === 'string' ? text.trim() : '';
  if (clean === '') {
    return { ok: false, reason: 'Текст записи пуст: нечего запоминать' };
  }
  const state = readMemoryEntries(cwd, prompt);
  const normalized = normalizeForCompare(clean);
  const duplicate = state.entries.find(e => normalizeForCompare(e.text) === normalized);
  if (duplicate) {
    return {
      ok: false,
      reason: `Такая запись уже есть в памяти (№${duplicate.index}): «${duplicate.text}»`,
    };
  }
  const date = todayLocal(now);
  const raw = `- ${withSentenceDot(clean)} (${date})`;
  const content = serializeMemory(state.preamble, [...state.entries, { raw }]);
  const chars = content.trim().length;
  if (chars > state.limit) {
    return {
      ok: false,
      reason:
        `Память персоны заполнена: ${state.chars} из ${state.limit} символов, ` +
        `запись добавит ещё ${chars - state.chars}. Удалите лишние записи (/memory remove <N>) ` +
        'или увеличьте persona_memory.max_chars в settings.json',
      // VL-419: текущий размер и лимит — чтобы вызывающий (инструмент
      // memory_remember) мог дать модели точный hint с выходом из тупика
      chars: state.chars,
      limit: state.limit,
    };
  }
  writeTextAtomic(personaMemoryPath(cwd, prompt), content);
  return {
    ok: true,
    entry: { index: state.entries.length + 1, text: clean, date, raw },
    chars,
    limit: state.limit,
  };
}

/**
 * Удаляет запись по номеру (1-based, как в `/memory` и в кнопке «Убрать»).
 * Остальные записи перенумеровываются автоматически (номер = позиция).
 */
export function removeMemoryEntry(cwd: string, prompt: string, index: number): MemoryRemoveResult {
  const state = readMemoryEntries(cwd, prompt);
  if (!Number.isInteger(index) || index < 1 || index > state.entries.length) {
    return {
      ok: false,
      reason:
        state.entries.length === 0
          ? 'Память персоны пуста — удалять нечего'
          : `Записи №${index} нет: в памяти ${state.entries.length} запис${state.entries.length === 1 ? 'ь' : 'ей'}`,
    };
  }
  const removed = state.entries[index - 1]!;
  const rest = state.entries.filter(e => e.index !== index);
  const content = serializeMemory(state.preamble, rest);
  writeTextAtomic(personaMemoryPath(cwd, prompt), content);
  return { ok: true, removed, chars: content.trim().length, limit: state.limit };
}

/** Полностью очищает память персоны (файл остаётся пустым). */
export function clearMemory(cwd: string, prompt: string): MemoryClearResult {
  const state = readMemoryEntries(cwd, prompt);
  writeTextAtomic(personaMemoryPath(cwd, prompt), '');
  return { ok: true, removed: state.entries.length, chars: 0, limit: state.limit };
}
