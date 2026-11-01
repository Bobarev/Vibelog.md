/**
 * Локальный markdown-кэш references (VL-194).
 *
 * Проблема: reference типа url/doc — только ссылка; Plan-фаза при каждом
 * чтении делает web_fetch, парсит HTML, чистит JS/CSS — медленно, дорого,
 * ненадёжно. Решение: опциональный кэш при add (`--cache`) и синхронизация
 * через `reference sync` — скачиваем один раз, дальше Plan читает готовый
 * markdown из reference_view.
 *
 * Конвейер: download → очистка HTML (script/style/nav/footer/header/head) →
 * собственный конвертер `./html-to-markdown.js` (GFM-таблицы, чеклисты) →
 * запись cache/<ref-id>.md + поля cached_path/cached_at/source_hash
 * в frontmatter метаданных.
 *
 * Сеть: fetch инжектируется через deps.fetchFn — юнит-тесты работают без
 * реальной сети (guard VL-132 в src/test-setup.mjs отклоняет не-loopback).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { htmlToMarkdown } from './html-to-markdown.js';
import { findBacklogDir, referencesCacheDir } from './paths.js';
import {
  listReferences, referenceCachePath, updateReference,
} from './reference.js';
import type { Reference } from './reference.js';

/** Максимальный размер скачиваемого ответа: 5 МБ (защита от бинарей/дампов). */
export const MAX_CACHE_BYTES = 5 * 1024 * 1024;

/** Таймаут одного скачивания, мс. */
export const CACHE_TIMEOUT_MS = 15_000;

/** Зависимости для тестов: подменяемый fetch и таймаут. */
export interface CacheDeps {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/** Итог синхронизации кэшей — по образцу SyncResult из reference.ts. */
export interface CacheSyncResult {
  updated: string[];
  skipped: string[];
  failed: { id: string; error: string }[];
}

/** Результат одной операции кэширования. */
export interface CacheResult {
  cached: boolean;
  message: string;
}

/** Скачанный ответ: тело + content-type (для выбора конвертации/сохранения). */
export interface DownloadedText {
  text: string;
  contentType: string;
}

/**
 * Скачивает URL: валидация схемы, таймаут, лимит размера, проверка ok.
 *
 * @returns тело ответа (utf-8) и content-type
 * @throws на любых нарушениях — вызывающий код решает, что делать с ошибкой
 */
export async function downloadText(url: string, deps: CacheDeps = {}): Promise<DownloadedText> {
  // data:/file: и прочее не качаем — только http/https (защита от сюрпризов)
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`неподдерживаемая схема URL (нужен http/https): ${url}`);
  }
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(deps.timeoutMs ?? CACHE_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
  }
  const contentType = res.headers.get('content-type') ?? '';
  // Лимит проверяем ДО чтения тела: content-length врал — досчитаем после
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_CACHE_BYTES) {
    throw new Error(`ответ слишком большой: ${declared} байт (лимит ${MAX_CACHE_BYTES})`);
  }
  const text = await res.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_CACHE_BYTES) {
    throw new Error(`ответ слишком большой: ${Buffer.byteLength(text, 'utf8')} байт (лимит ${MAX_CACHE_BYTES})`);
  }
  return { text, contentType };
}

// htmlToMarkdown живёт в собственном модуле (VL-232, без turndown) и
// ре-экспортируется здесь: его импортируют тесты и внешние вызывающие
// (сигнатура и поведение не меняются).
export { htmlToMarkdown };

/**
 * Проверяет content-type: markdown-ответ сохраняем как есть, остальное
 * конвертируем как HTML; не-текстовые типы (картинки, pdf) отклоняем.
 *
 * @returns 'markdown' | 'html'
 */
export function classifyContentType(contentType: string): 'markdown' | 'html' {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('markdown')) return 'markdown';
  if (ct.startsWith('text/') || ct.includes('html') || ct === '') return 'html';
  // application/octet-stream и прочие бинари — не источник текстовых знаний
  throw new Error(`неподдерживаемый content-type: ${contentType || '(пусто)'}`);
}

/**
 * Кэширует reference: скачивает url, конвертирует в markdown, пишет
 * cache/<ref-id>.md и обновляет cached_path/cached_at/source_hash.
 *
 * Для type=repo операция бессмысленна (у репо есть clone) → ошибка.
 * Ошибка скачивания/конвертации НЕ роняет вызывающий код: возвращается
 * {cached:false, message} — как у cloneReferenceRepo.
 *
 * @param ref — уже созданный reference (у него есть id и url)
 */
export async function cacheReference(
  cwd: string,
  ref: Reference,
  deps: CacheDeps = {},
): Promise<CacheResult> {
  if (ref.type === 'repo') {
    return { cached: false, message: `Reference ${ref.id}: кэш не для type=repo (у репо есть клон)` };
  }
  if (!ref.url) {
    return { cached: false, message: `Reference ${ref.id}: нет url для кэширования` };
  }
  try {
    const { text, contentType } = await downloadText(ref.url, deps);
    // sha256 сырого ответа — по нему sync решает, устарел ли кэш
    const sourceHash = createHash('sha256').update(text, 'utf8').digest('hex');
    const kind = classifyContentType(contentType);
    const markdown = kind === 'markdown' ? (text.trim() + '\n') : htmlToMarkdown(text);
    const backlogDir = findBacklogDir(cwd);
    if (!backlogDir) throw new Error('Backlog не найден. Выполните: vibelog init');
    const absPath = referenceCachePath(cwd, ref);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, markdown, 'utf-8');
    // cached_path — относительно backlog/, чтобы путь был переносимым между машинами
    const relPath = relative(backlogDir, absPath).split('\\').join('/');
    const cachedAt = new Date().toISOString();
    updateReference(cwd, ref.id, {
      cached_path: relPath,
      cached_at: cachedAt,
      source_hash: sourceHash,
    });
    return { cached: true, message: `Reference ${ref.id}: закэшировано → ${relPath} (${markdown.length} байт markdown)` };
  } catch (err) {
    return { cached: false, message: `Reference ${ref.id}: ошибка кэширования ${ref.url}: ${(err as Error).message}` };
  }
}

/**
 * Перекачивает кэш reference и сравнивает source_hash:
 * совпал и файл существует → без перезаписи; иначе → перезапись + обновление полей.
 *
 * @returns {updated: true} если контент изменился (или кэша не было)
 */
export async function refreshReferenceCache(
  cwd: string,
  ref: Reference,
  deps: CacheDeps = {},
): Promise<{ updated: boolean; message: string }> {
  if (ref.type === 'repo' || !ref.url) {
    return { updated: false, message: `Reference ${ref.id}: нет url (type=${ref.type}) — пропуск` };
  }
  const absPath = referenceCachePath(cwd, ref);
  try {
    const { text, contentType } = await downloadText(ref.url, deps);
    const sourceHash = createHash('sha256').update(text, 'utf8').digest('hex');
    if (sourceHash === ref.source_hash && existsSync(absPath)) {
      return { updated: false, message: `Reference ${ref.id}: без изменений (source_hash совпал)` };
    }
    const markdown = classifyContentType(contentType) === 'markdown'
      ? (text.trim() + '\n')
      : htmlToMarkdown(text);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, markdown, 'utf-8');
    const backlogDir = findBacklogDir(cwd);
    if (!backlogDir) throw new Error('Backlog не найден. Выполните: vibelog init');
    const relPath = relative(backlogDir, absPath).split('\\').join('/');
    updateReference(cwd, ref.id, {
      cached_path: relPath,
      cached_at: new Date().toISOString(),
      source_hash: sourceHash,
    });
    return { updated: true, message: `Reference ${ref.id}: кэш обновлён → ${relPath}` };
  } catch (err) {
    return { updated: false, message: `Reference ${ref.id}: ошибка обновления кэша: ${(err as Error).message}` };
  }
}

/**
 * Читает markdown-кэш reference: абсолютный путь берётся из cached_path
 * метаданных (fallback — стабильный cache/<id>.md по id).
 *
 * @returns markdown или null (нет кэша / файл пропал — вызывающий фолбэчит на url)
 */
export function readReferenceCache(cwd: string, ref: Reference): string | null {
  try {
    const backlogDir = findBacklogDir(cwd);
    if (!backlogDir) return null;
    const candidates = [
      ref.cached_path ? join(backlogDir, ref.cached_path) : null,
      referenceCachePath(cwd, ref),
    ];
    for (const p of candidates) {
      if (p && existsSync(p)) {
        const content = readFileSync(p, 'utf-8');
        if (content.trim()) return content;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Синхронизация кэшей нескольких references.
 *
 * - `ids` — перекачать указанные (пустой массив → ничего);
 * - `all: true` — все url-References типа url/doc/spec (кэшируются даже те,
 *   у кого кэша ещё нет — чтобы Plan-фаза не била по сети).
 *
 * Одна ошибка не прерывает общий запуск — собирается в failed.
 */
export async function syncReferenceCaches(
  cwd: string,
  opts: { ids?: string[]; all?: boolean },
  deps: CacheDeps = {},
): Promise<CacheSyncResult> {
  const result: CacheSyncResult = { updated: [], skipped: [], failed: [] };
  const entries = listReferences(cwd);

  const targets: typeof entries = [];
  if (opts.ids) {
    for (const id of opts.ids) {
      const entry = entries.find(e => e.reference.id.toLowerCase() === id.toLowerCase());
      if (!entry) {
        result.failed.push({ id, error: 'не найден' });
      } else {
        targets.push(entry);
      }
    }
  } else if (opts.all) {
    for (const e of entries) {
      const t = e.reference.type;
      if ((t === 'url' || t === 'doc' || t === 'spec') && e.reference.url) targets.push(e);
    }
  }

  for (const e of targets) {
    // refresh сам решает: нет кэша/хэш разошёлся → updated, иначе skipped
    const res = await refreshReferenceCache(cwd, e.reference, deps);
    if (res.updated) result.updated.push(e.reference.id);
    else if (res.message.includes('без изменений') || res.message.includes('пропуск')) {
      result.skipped.push(e.reference.id);
    } else {
      // ошибка скачивания/конвертации
      result.failed.push({ id: e.reference.id, error: res.message });
    }
  }
  return result;
}
