/**
 * Хранилище ключей идемпотентности write-вызовов MCP (VL-262).
 *
 * Зачем: повтор write-вызова после отказа/таймаута не должен дублировать
 * эффект. Инцидент VL-255/VL-256: create со второго раза мог создать дубль
 * задачи, если первый вызов всё-таки прошёл; update — перезаписать
 * updated_date и затереть ручные правки.
 *
 * Где храним: `<cwd>/.vibelog/idempotency.json` — каталог `.vibelog/` уже
 * gitignored и не попадает в backlog (совместимость с Backlog.md не страдает).
 * В branch-mode MCP получает VIBELOG_CWD главного репо, поэтому ключи и
 * результаты живут там же, где файлы задач (lesson-13).
 *
 * Fail-open: любая проблема с файлом (битый JSON, права, ФС) НЕ блокирует
 * write — ключ просто игнорируется, диагностика идёт в console.error
 * (lesson-77: так она доходит до logTail). Кэш — оптимизация, не гарантия.
 *
 * Формат: { version: 1, entries: { "<tool>:<key>": { at: ISO, result: string } } }
 * Ограничения: TTL 24 ч и кап 200 записей (FIFO по `at`) — иначе файл растёт
 * бесконечно (каждая запись хранит полный JSON-ответ).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Время жизни записи: сутки. Дольше повтор вызова смысла не имеет. */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Максимум хранимых записей (FIFO-вытеснение самых старых). */
const MAX_ENTRIES = 200;

/** Максимальная длина ключа — защита от раздувания файла мусорными значениями. */
const MAX_KEY_LENGTH = 200;

/** Одна запись кэша: когда записана и что вернули. */
interface IdempotencyEntry {
  at: string;
  result: string;
}

/** Содержимое файла кэша. */
interface IdempotencyFile {
  version: 1;
  entries: Record<string, IdempotencyEntry>;
}

/** Путь к файлу кэша в директории проекта. */
export function idempotencyPath(cwd: string): string {
  return join(cwd, '.vibelog', 'idempotency.json');
}

/**
 * Читает файл кэша. Любая ошибка → пустой кэш (fail-open).
 *
 * @param cwd — директория проекта (в branch-mode — главный репо через VIBELOG_CWD)
 */
function readStore(cwd: string): IdempotencyFile {
  const path = idempotencyPath(cwd);
  if (!existsSync(path)) return { version: 1, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { version: 1, entries: {} };
    }
    const entries = (parsed as { entries?: unknown }).entries;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      return { version: 1, entries: {} };
    }
    return { version: 1, entries: entries as Record<string, IdempotencyEntry> };
  } catch (err) {
    // Битый JSON — не повод ронять write: пишем диагностику и начинаем с чистого кэша
    console.error(`[idempotency] не удалось прочитать ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return { version: 1, entries: {} };
  }
}

/**
 * Записывает кэш атомарно (tmp + rename), вычищая просроченные и лишние записи.
 *
 * @param cwd — директория проекта
 * @param store — содержимое кэша
 */
function writeStore(cwd: string, store: IdempotencyFile): void {
  const path = idempotencyPath(cwd);
  try {
    mkdirSync(dirname(path), { recursive: true });
    // TTL: просроченные записи не должны переиспользоваться (устаревший ответ
    // описывает состояние, которого уже нет)
    const now = Date.now();
    const fresh: Record<string, IdempotencyEntry> = {};
    for (const [k, v] of Object.entries(store.entries)) {
      const at = Date.parse(v?.at ?? '');
      if (Number.isFinite(at) && now - at <= TTL_MS) fresh[k] = v;
    }
    // Кап: оставляем самые свежие записи (FIFO-вытеснение старых)
    const keys = Object.keys(fresh);
    const trimmed: Record<string, IdempotencyEntry> = {};
    const kept = keys
      .sort((a, b) => (Date.parse(fresh[b].at) || 0) - (Date.parse(fresh[a].at) || 0))
      .slice(0, MAX_ENTRIES);
    for (const k of kept) trimmed[k] = fresh[k];

    const payload: IdempotencyFile = { version: 1, entries: trimmed };
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
    renameSync(tmp, path);
  } catch (err) {
    // Запись кэша — оптимизация: сбой не должен ломать уже выполненный write
    console.error(`[idempotency] не удалось записать ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Валидирует ключ идемпотентности на границе MCP-слоя.
 *
 * Схема объявляет строку, но сервер схемы не проверяет: число/объект в ключе
 * дал бы невнятную ошибку ключа объекта (lesson-34 — валидация на границе).
 *
 * @param key — значение аргумента idempotencyKey (может отсутствовать)
 * @returns нормализованный ключ или undefined (кэш не используется)
 */
export function normalizeIdempotencyKey(key: unknown): string | undefined {
  if (key === undefined || key === null || key === '') return undefined;
  if (typeof key !== 'string') {
    throw new Error('idempotencyKey: ожидается строка до 200 символов');
  }
  const trimmed = key.trim();
  if (trimmed === '') return undefined;
  if (trimmed.length > MAX_KEY_LENGTH) {
    throw new Error(`idempotencyKey: ожидается строка до ${MAX_KEY_LENGTH} символов`);
  }
  return trimmed;
}

/**
 * Выполняет write-операцию с идемпотентностью по ключу.
 *
 * Без ключа — поведение идентично прежнему (`run()` как есть). С ключом:
 * повтор возвращает сохранённый результат первого применения, НЕ вызывая
 * `run()`. Пометка `idempotentReplay: true` добавляется в ответ, чтобы модель
 * понимала, что это воспроизведение, а не новое применение.
 *
 * @param cwd — директория проекта
 * @param tool — имя инструмента (ключ кэша = `<tool>:<key>`)
 * @param key — ключ идемпотентности (произвольная строка от модели)
 * @param run — сама write-операция, возвращает JSON-ответ (ackOk)
 */
export function withIdempotency(
  cwd: string,
  tool: string,
  key: unknown,
  run: () => string,
): string {
  const normalized = normalizeIdempotencyKey(key);
  if (normalized === undefined) return run();

  const cacheKey = `${tool}:${normalized}`;
  const store = readStore(cwd);
  const hit = store.entries[cacheKey];
  if (hit && typeof hit.result === 'string') {
    const at = Date.parse(hit.at ?? '');
    // Просроченную запись не переиспользуем: ответ описывает прошлое состояние
    if (Number.isFinite(at) && Date.now() - at <= TTL_MS) {
      return markReplay(hit.result);
    }
  }

  const result = run();
  store.entries[cacheKey] = { at: new Date().toISOString(), result };
  writeStore(cwd, store);
  return result;
}

/**
 * Добавляет `idempotentReplay: true` в сохранённый ack.
 *
 * Сохранённый результат — уже готовый JSON; пересобираем его, чтобы пометить
 * воспроизведение. Если это не JSON (старый формат/ошибка) — возвращаем как есть.
 */
function markReplay(result: string): string {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    return JSON.stringify({ ...parsed, idempotentReplay: true }, null, 2);
  } catch {
    return result;
  }
}
