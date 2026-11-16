/**
 * Запись памяти персоны в веб-чате (VL-402): инструмент `memory_remember`,
 * команда `/memory` и отмена записи из ленты.
 *
 * Ключевое решение (обсуждение roadmap 2026-11-09): у чата нет «конца», где
 * можно вызвать инструмент (в отличие от фазы Close), поэтому запись идёт В
 * ПРОЦЕССЕ, но не молча. Пользователь жаловался, что auto-memory «неконтролируемо»:
 * запомнило непонятно что, а обнаруживается это через месяц. Компромисс:
 * запись применяется сразу (карточка Allow/Deny на каждую запись превратила бы
 * разговор в тыканье), но видна в ленте событием `memory` с кнопкой «Убрать».
 *
 * Второй канал — явная команда `/memory`: пользователь сам решает, что
 * разговор был содержательным, и просит обновить память по сессии.
 *
 * Изоляция по персонам (AC6): целевой файл берётся из РОЛИ ТРЕДА
 * (`activePersona` в `src/web/chat.ts`), а не из аргументов модели — модель не
 * должна выбирать, в чью память писать. Смена роли в пикере меняет файл
 * следующего хода; уже записанное остаётся в файле прежней роли.
 *
 * Почему роль передаётся ПАРАМЕТРОМ, а не резолвится здесь по threadId:
 * `src/web/chat.ts` импортирует этот модуль, поэтому обратный импорт
 * (`effectiveThreadPersona` из chat.ts) дал бы цикл. Роль уже известна в
 * `produce()` — она и приходит сюда.
 *
 * Классификация read/write: `memory_remember` — НЕ write (см.
 * `src/core/tool-classify.ts`, `REVERSIBLE_WRITE_TOOLS`). Обоснование: запись
 * обратима кнопкой «Убрать», в отличие от `write_file`; а карточка Allow/Deny
 * на каждую запись убила бы саму идею памяти в разговоре.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ToolDef } from '../agent/llm.js';
import {
  appendMemoryEntry,
  clearMemory,
  readMemoryEntries,
  removeMemoryEntry,
  type MemoryEntry,
} from '../core/persona-memory.js';
import type { PersonaConfig } from './personas.js';

/** Имя инструмента записи памяти (единая точка: сервер, тесты, промпт). */
export const MEMORY_REMEMBER_TOOL = 'memory_remember';

/** Локальный инструмент чата: ToolDef + handler (как ChatLocalTool в tool-policy). */
export interface MemoryTool extends ToolDef {
  handler: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * Инструмент `memory_remember {text}` — только для веб-чата.
 *
 * В headless-фазах и TUI его нет по построению: агентская петля берёт
 * инструменты из MCP-реестра `listTools()`, а этот инструмент добавляется
 * ТОЛЬКО в `chatToolDefs()` (как `ask_user`, VL-330).
 *
 * @param cwd — каталог проекта
 * @param persona — роль ТРЕДА (файл памяти берётся из её `prompt`)
 */
export function makeMemoryRememberTool(cwd: string, persona: PersonaConfig): MemoryTool {
  return {
    name: MEMORY_REMEMBER_TOOL,
    description:
      'Записывает устойчивое правило о пользователе в память текущей роли. ' +
      'ЧТО считать устойчивым — решает промпт твоей роли: для одного это стиль ' +
      'общения и работа с тобой, для другого — устойчивые факты о человеке. ' +
      'Запись применяется сразу и видна пользователю в ленте с кнопкой «Убрать» — ' +
      'подтверждения не требуется. НЕ записывай сюда то, что относится к коду проекта ' +
      '(архитектура, соглашения, найденные грабли) — для этого есть lessons. ' +
      'Формулируй как правило в императиве, одной фразой.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description:
            'Текст правила одной фразой, например «Не использовать англицизмы без перевода»',
        },
      },
      required: ['text'],
    },
    handler: async (args: Record<string, unknown>): Promise<string> => {
      const result = appendMemoryEntry(cwd, persona.prompt, args.text as string);
      if (!result.ok) {
        // Отказ — понятным tool-результатом; файл не менялся (AC1/AC3).
        // VL-419: при переполнении модель обязана знать выход — без hint'а
        // память деградировала бы в «первые N записей навсегда». chars/limit
        // заполняются только отказом по лимиту (см. MemoryWriteResult).
        const payload: Record<string, unknown> = { ok: false, error: result.reason };
        if (result.chars !== undefined && result.limit !== undefined) {
          payload.chars = result.chars;
          payload.limit = result.limit;
          payload.hint =
            'Память заполнена. Убери устаревшие записи через memory_forget {index} ' +
            'или попроси пользователя: /memory remove <N>';
        }
        return JSON.stringify(payload);
      }
      return JSON.stringify({
        ok: true,
        applied: ['memory'],
        entry: { index: result.entry.index, text: result.entry.text, date: result.entry.date },
        chars: result.chars,
        limit: result.limit,
      });
    },
  };
}

/** Имя инструмента удаления записи памяти (VL-419). */
export const MEMORY_FORGET_TOOL = 'memory_forget';

/**
 * Нормализация текста записи для сравнения (дубль в `appendMemoryEntry`,
 * удаление по тексту): регистр, пробелы, хвостовая пунктуация.
 */
function normalizeMemoryText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?;:,]+$/u, '').trim();
}

/**
 * Инструмент `memory_forget {index? | text?}` — удаление одной записи памяти
 * текущей роли (VL-419): без него память при переполнении деградирует в
 * «первые N записей навсегда» — чистить её умеет только человек.
 *
 * Ровно один аргумент: `index` — 1-based номер из `/memory`; `text` — точное
 * совпадение после нормализации (то же сравнение, что при проверке дублей).
 * Оба или ни одного — отказ. Вне диапазона / текст не найден — отказ со
 * СПИСКОМ текущих записей, чтобы модель могла исправиться по номерам.
 *
 * Классификация: входит в `REVERSIBLE_WRITE_TOOLS` (`src/core/tool-classify.ts`)
 * — Allow/Deny на чистку не спрашивается (состояние видно через `/memory`).
 * В `TOOL_KINDS`/MCP-реестре имени нет — инструмент локальный, как
 * `memory_remember`; консультанту не выдаётся (`consultantTools`).
 *
 * @param cwd — каталог проекта
 * @param persona — роль ТРЕДА (файл памяти берётся из её `prompt`)
 */
export function makeMemoryForgetTool(cwd: string, persona: PersonaConfig): MemoryTool {
  return {
    name: MEMORY_FORGET_TOOL,
    description:
      'Удаляет одну запись из памяти текущей роли. Нужен РОВНО один аргумент: ' +
      'index — 1-based номер записи (список в /memory) либо text — точный текст записи. ' +
      'Отказ приходит с entries — текущими записями, исправляйся по ним. ' +
      'Применяй, когда память заполнена (memory_remember вернул hint) и устаревшие записи мешают.',
    inputSchema: {
      type: 'object',
      properties: {
        index: { type: 'number', description: '1-based номер записи из /memory' },
        text: { type: 'string', description: 'Точный текст записи (сравнение без регистра и пунктуации)' },
      },
    },
    handler: async (args: Record<string, unknown>): Promise<string> => {
      const hasIndex = args.index !== undefined && args.index !== null;
      const hasText = typeof args.text === 'string' && args.text.trim() !== '';
      if (hasIndex && hasText) {
        return JSON.stringify({
          ok: false,
          error: 'memory_forget: передай РОВНО один аргумент — index ИЛИ text, не оба сразу',
        });
      }
      if (!hasIndex && !hasText) {
        return JSON.stringify({
          ok: false,
          error: 'memory_forget: нужен один аргумент — index (1-based номер записи) либо text (точный текст записи)',
        });
      }
      const state = readMemoryEntries(cwd, persona.prompt);
      /** Текущие записи для отказа: модель увидит номера и тексты. */
      const entries = state.entries.map(e => ({ index: e.index, text: e.text, date: e.date }));
      let target: MemoryEntry | undefined;
      if (hasIndex) {
        const index = Number(args.index);
        if (!Number.isInteger(index) || index < 1 || index > state.entries.length) {
          return JSON.stringify({
            ok: false,
            error:
              `Записи №${String(args.index)} нет: в памяти ${state.entries.length} ` +
              `запис${state.entries.length === 1 ? 'ь' : 'ей'}`,
            entries,
          });
        }
        target = state.entries[index - 1];
      } else {
        const norm = normalizeMemoryText(args.text as string);
        target = state.entries.find(e => normalizeMemoryText(e.text) === norm);
        if (target === undefined) {
          return JSON.stringify({
            ok: false,
            error: 'Запись с таким текстом в памяти не найдена',
            entries,
          });
        }
      }
      const result = removeMemoryEntry(cwd, persona.prompt, target.index);
      if (!result.ok) return JSON.stringify({ ok: false, error: result.reason });
      return JSON.stringify({
        ok: true,
        applied: ['memory'],
        removed: { index: result.removed.index, text: result.removed.text },
        chars: result.chars,
        limit: result.limit,
      });
    },
  };
}

/** Текст списка памяти для `/memory` (без аргументов). */
export function memoryListText(cwd: string, persona: PersonaConfig): string {
  const state = readMemoryEntries(cwd, persona.prompt);
  const head = `**Память роли «${persona.label}»** — ${state.chars} из ${state.limit} символов`;
  if (state.entries.length === 0) {
    return `${head}\n\nЗаписей нет. Добавить: \`/memory add <текст>\`.`;
  }
  const lines = state.entries.map(e => `${e.index}. ${e.text}${e.date ? ` (${e.date})` : ''}`);
  return [
    head,
    '',
    ...lines,
    '',
    'Удалить запись: `/memory remove <N>`. Очистить всё: `/memory clear`.',
  ].join('\n');
}

/**
 * Исполнение команды `/memory` (AC4).
 *
 * Подкоманды: без аргументов — список с номерами и размером; `add <текст>` —
 * добавить (та же валидация, что у инструмента); `remove <N>` — удалить по
 * номеру; `clear` — очистить (требует `clear yes`: двухшаговое подтверждение,
 * чтобы не стереть память случайно).
 *
 * @param args — аргументы после имени команды
 * @param cwd — каталог проекта
 * @param persona — роль ТРЕДА (AC6: чужую память команда не трогает)
 */
export function runMemoryCommand(
  args: readonly string[],
  cwd: string,
  persona: PersonaConfig,
): { text: string; isError?: boolean } {
  const sub = (args[0] ?? '').toLowerCase();

  if (sub === '') return { text: memoryListText(cwd, persona) };

  if (sub === 'add') {
    const text = args.slice(1).join(' ').trim();
    if (text === '') {
      return { text: 'Использование: `/memory add <текст записи>`', isError: true };
    }
    const result = appendMemoryEntry(cwd, persona.prompt, text);
    if (!result.ok) return { text: `Запись не добавлена: ${result.reason}`, isError: true };
    return {
      text: `Запомнил: ${result.entry.text} (${result.entry.date}). Память: ${result.chars} из ${result.limit} символов.`,
    };
  }

  if (sub === 'remove') {
    const raw = args[1] ?? '';
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 1) {
      return {
        text: 'Использование: `/memory remove <N>` — номер записи из `/memory`',
        isError: true,
      };
    }
    const result = removeMemoryEntry(cwd, persona.prompt, index);
    if (!result.ok) return { text: `Запись не удалена: ${result.reason}`, isError: true };
    return {
      text: `Удалено: ${result.removed.text}. Память: ${result.chars} из ${result.limit} символов.`,
    };
  }

  if (sub === 'clear') {
    if ((args[1] ?? '').toLowerCase() !== 'yes') {
      const state = readMemoryEntries(cwd, persona.prompt);
      return {
        text:
          `Очистка удалит все записи памяти роли «${persona.label}» (${state.entries.length}). ` +
          'Подтвердите: `/memory clear yes`.',
      };
    }
    const result = clearMemory(cwd, persona.prompt);
    return { text: `Память очищена: удалено записей — ${result.removed}.` };
  }

  return {
    text:
      `Неизвестная подкоманда /memory ${sub}. Доступно: /memory, /memory add <текст>, ` +
      '/memory remove <N>, /memory clear.',
    isError: true,
  };
}

/**
 * Sidecar отменённых записей треда: `<threadId>.memory.json`.
 *
 * Зачем отдельный файл, а не правка jsonl: история треда — контекст модели,
 * и служебная пометка «эту запись убрали» попала бы в промпт. Sidecar (паттерн
 * `.allow.json`/`.persona.json`, VL-264/VL-283) `listChatThreads` не видит,
 * формат jsonl не ломается. Нужен он ровно для одного: после F5 карточка
 * «Запомнил: …» восстанавливается из jsonl, и кнопка «Убрать» должна быть
 * неактивна, если запись уже удалена.
 */
function memoryRemovalFile(cwd: string, threadId: string): string {
  return join(cwd, '.vibelog', 'chat-sessions', `${threadId}.memory.json`);
}

/** Список отменённых записей треда (текст + время отмены). */
export function loadMemoryRemovals(
  cwd: string,
  threadId: string,
): { text: string; at: string }[] {
  const file = memoryRemovalFile(cwd, threadId);
  if (!existsSync(file)) return [];
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const list = (raw as { removed?: unknown } | null)?.removed;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (item): item is { text: string; at: string } =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as { text?: unknown }).text === 'string',
    );
  } catch {
    // битый sidecar — считаем, что отмен не было (карточка просто активна)
    return [];
  }
}

/** Записать отмену в sidecar треда (идемпотентно по тексту). */
function recordMemoryRemoval(cwd: string, threadId: string, text: string): void {
  const removed = loadMemoryRemovals(cwd, threadId);
  if (removed.some(r => r.text === text)) return;
  removed.push({ text, at: new Date().toISOString() });
  try {
    mkdirSync(join(cwd, '.vibelog', 'chat-sessions'), { recursive: true });
    writeFileSync(memoryRemovalFile(cwd, threadId), `${JSON.stringify({ removed }, null, 2)}\n`, 'utf8');
  } catch {
    // сбой записи sidecar не должен ломать отмену: файл памяти уже поправлен
  }
}

/**
 * Удаление записи по кнопке «Убрать» (AC2).
 *
 * Номер записи в ленте мог устареть: после удаления соседней записи номера
 * сдвигаются. Поэтому предпочтение — удаление по ТЕКСТУ (точное совпадение
 * после нормализации), а номер — фолбэк. Иначе «Убрать» на второй карточке
 * после удаления первой снесла бы не ту запись.
 */
export function removeMemoryByEvent(
  cwd: string,
  threadId: string,
  persona: PersonaConfig,
  request: { index?: unknown; text?: unknown },
): { ok: true; removed: MemoryEntry; chars: number; limit: number } | { ok: false; error: string } {
  const state = readMemoryEntries(cwd, persona.prompt);
  const text = typeof request.text === 'string' ? request.text.trim() : '';
  let target: MemoryEntry | undefined;
  if (text !== '') {
    // Та же нормализация, что у дублей и у memory_forget (VL-419)
    target = state.entries.find(e => normalizeMemoryText(e.text) === normalizeMemoryText(text));
  }
  if (target === undefined) {
    const index = Number(request.index);
    if (Number.isInteger(index) && index >= 1) {
      target = state.entries.find(e => e.index === index);
    }
  }
  if (target === undefined) {
    return { ok: false, error: 'Запись не найдена: возможно, она уже удалена' };
  }
  const result = removeMemoryEntry(cwd, persona.prompt, target.index);
  if (!result.ok) return { ok: false, error: result.reason };
  recordMemoryRemoval(cwd, threadId, result.removed.text);
  return { ok: true, removed: result.removed, chars: result.chars, limit: result.limit };
}
