/**
 * Локальный markdown-кэш references (VL-194, множественные ссылки — VL-291).
 *
 * Проблема: reference типа url/doc — только ссылка; Plan-фаза при каждом
 * чтении делает web_fetch, парсит HTML, чистит JS/CSS — медленно, дорого,
 * ненадёжно. Решение: опциональный кэш при add (`--cache`) и синхронизация
 * через `reference sync` — скачиваем один раз, дальше Plan читает готовый
 * markdown из reference_view.
 *
 * VL-291: у reference может быть несколько ссылок (`url` + `urls`). Кэш
 * остаётся ОДНИМ файлом — содержимое склеивается секциями в порядке ссылок
 * (`## <url>` + отбивка «Источник» + содержимое). Ошибка одной ссылки не
 * ломает кэш остальных: её секция несёт пометку «⚠ Ошибка загрузки», а
 * результат помечается partial (частичный успех).
 *
 * Конвейер: download → очистка HTML → конвертер `./html-to-markdown.js`
 * (GFM-таблицы, чеклисты) → запись cache/<ref-id>.md + поля
 * cached_path/cached_at/source_hash в frontmatter метаданных.
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
  listReferences, referenceCachePath, referenceUrls, updateReference,
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
  /** Хотя бы одна ссылка закэширована (при partial — остальные с ошибкой). */
  cached: boolean;
  message: string;
  /** Частичный успех (VL-291): часть ссылок не скачалась, но кэш записан. */
  partial?: boolean;
  /** Ссылки, которые не удалось скачать (VL-291). */
  failed?: { url: string; error: string }[];
}

/** Секция склеенного кэша: одна ссылка — успех или ошибка (VL-291). */
export interface CacheSection {
  url: string;
  markdown?: string;
  error?: string;
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
 * Скачивает одну ссылку и конвертирует её в markdown (VL-291).
 *
 * @returns markdown-содержимое и сырой ответ (для source_hash)
 * @throws при ошибке скачивания/конвертации — вызывающий решает судьбу ссылки
 */
async function fetchMarkdown(
  url: string,
  deps: CacheDeps,
): Promise<{ markdown: string; raw: string }> {
  const { text, contentType } = await downloadText(url, deps);
  const markdown = classifyContentType(contentType) === 'markdown'
    ? (text.trim() + '\n')
    : htmlToMarkdown(text);
  return { markdown, raw: text };
}

/**
 * Склеивает секции в единый markdown-кэш (VL-291).
 *
 * Формат секции: заголовок `## <url>`, строка-отбивка `> Источник: <url>`,
 * затем содержимое. Секция с ошибкой вместо содержимого несёт пометку
 * `> ⚠ Ошибка загрузки: <текст>` — частичный сбой виден прямо в кэше,
 * а остальные ссылки остаются доступны Plan-фазе.
 */
export function mergeCachedSections(sections: CacheSection[]): string {
  const parts = sections.map(s => {
    const head = `## ${s.url}\n\n> Источник: ${s.url}\n`;
    if (s.error) return `${head}\n> ⚠ Ошибка загрузки: ${s.error}\n`;
    return `${head}\n${(s.markdown || '').trim()}\n`;
  });
  return parts.join('\n---\n\n');
}

/**
 * Хэш набора ссылок: sha256 по «url\0sha256(raw)» на каждую УСПЕШНУЮ ссылку.
 *
 * Устойчив к перестановке и к ошибкам части ссылок (упавшие в хэш не входят),
 * поэтому refresh верно определяет «содержимое не изменилось».
 */
function sectionsHash(sections: CacheSection[], raws: Map<string, string>): string {
  const lines = sections
    .filter(s => !s.error)
    .map(s => `${s.url}\u0000${createHash('sha256').update(raws.get(s.url) ?? '', 'utf8').digest('hex')}`)
    .sort();
  return createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

/**
 * Готовит содержимое кэша и его source_hash (VL-291).
 *
 * Одна ссылка и без ошибок → ПРЕЖНИЙ формат (VL-194): markdown как есть,
 * хэш = sha256 сырого ответа. Обратная совместимость важна и для чтения
 * существующих кэшей, и для тестов/потребителей, сравнивающих файл с
 * исходным ответом. Несколько ссылок (или частичный сбой) → склеенные
 * секции + хэш по набору успешных ссылок.
 */
function buildCacheOutput(
  sections: CacheSection[],
  raws: Map<string, string>,
): { markdown: string; sourceHash: string } {
  if (sections.length === 1 && !sections[0].error) {
    const raw = raws.get(sections[0].url) ?? '';
    return { markdown: sections[0].markdown || '', sourceHash: createHash('sha256').update(raw, 'utf8').digest('hex') };
  }
  return { markdown: mergeCachedSections(sections), sourceHash: sectionsHash(sections, raws) };
}

/** Описание неудачных ссылок для сообщений: «url: ошибка; url2: ошибка2». */
function describeFailures(failed: { url: string; error: string }[]): string {
  return failed.map(f => `${f.url}: ${f.error}`).join('; ');
}

/**
 * Кэширует reference: скачивает все его ссылки, склеивает в markdown, пишет
 * cache/<ref-id>.md и обновляет cached_path/cached_at/source_hash.
 *
 * Для type=repo операция бессмысленна (у репо есть clone) → ошибка.
 * Ошибка скачивания НЕ роняет вызывающий код: если не удалась ни одна
 * ссылка — {cached:false}; если часть — {cached:true, partial:true}
 * (секции упавших ссылок остаются в кэше с пометкой).
 *
 * @param ref — уже созданный reference (id + url/urls)
 */
export async function cacheReference(
  cwd: string,
  ref: Reference,
  deps: CacheDeps = {},
): Promise<CacheResult> {
  if (ref.type === 'repo') {
    return { cached: false, message: `Reference ${ref.id}: кэш не для type=repo (у репо есть клон)` };
  }
  const urls = referenceUrls(ref);
  if (urls.length === 0) {
    return { cached: false, message: `Reference ${ref.id}: нет url для кэширования` };
  }
  const sections: CacheSection[] = [];
  const raws = new Map<string, string>();
  const failed: { url: string; error: string }[] = [];
  for (const url of urls) {
    try {
      const { markdown, raw } = await fetchMarkdown(url, deps);
      sections.push({ url, markdown });
      raws.set(url, raw);
    } catch (err) {
      const error = (err as Error).message;
      sections.push({ url, error });
      failed.push({ url, error });
    }
  }
  const okCount = urls.length - failed.length;
  if (okCount === 0) {
    return {
      cached: false,
      partial: false,
      failed,
      message: `Reference ${ref.id}: ошибка кэширования (все ${urls.length} ссылок): ${describeFailures(failed)}`,
    };
  }
  try {
    const { markdown, sourceHash } = buildCacheOutput(sections, raws);
    const backlogDir = findBacklogDir(cwd);
    if (!backlogDir) throw new Error('Backlog не найден. Выполните: vibelog init');
    const absPath = referenceCachePath(cwd, ref);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, markdown, 'utf-8');
    // cached_path — относительно backlog/, чтобы путь был переносимым между машинами
    const relPath = relative(backlogDir, absPath).split('\\').join('/');
    updateReference(cwd, ref.id, {
      cached_path: relPath,
      cached_at: new Date().toISOString(),
      source_hash: sourceHash,
    });
    const partial = failed.length > 0;
    const linkInfo = urls.length > 1 ? `, ссылок: ${urls.length}` : '';
    const message = partial
      ? `Reference ${ref.id}: частичный успех — закэшировано ${okCount} из ${urls.length} ссылок (ошибок: ${failed.length}: ${describeFailures(failed)}) → ${relPath}`
      : `Reference ${ref.id}: закэшировано → ${relPath} (${markdown.length} байт markdown${linkInfo})`;
    return { cached: true, partial, failed, message };
  } catch (err) {
    return {
      cached: false,
      failed,
      message: `Reference ${ref.id}: ошибка кэширования: ${(err as Error).message}`,
    };
  }
}

/** Итог обновления кэша: явный статус вместо разбора текста сообщения (VL-291). */
export interface CacheRefreshResult {
  updated: boolean;
  /** updated — перезаписан; skipped — hash совпал; partial — часть ссылок упала; failed — ни одна не удалась. */
  status: 'updated' | 'skipped' | 'partial' | 'failed' | 'none';
  message: string;
}

/**
 * Перекачивает кэш reference и сравнивает source_hash:
 * совпал и файл существует → без перезаписи; иначе → перезапись + обновление полей.
 *
 * VL-291: ссылки обходятся все; при частичном сбое кэш всё равно
 * перезаписывается (status='partial'), упавшие секции несут пометку.
 *
 * @returns статус + сообщение (подстроки «без изменений»/«пропуск» сохранены:
 *          на них опираются CLI-вывод и обработчики MCP)
 */
export async function refreshReferenceCache(
  cwd: string,
  ref: Reference,
  deps: CacheDeps = {},
): Promise<CacheRefreshResult> {
  const urls = referenceUrls(ref);
  if (ref.type === 'repo' || urls.length === 0) {
    return {
      updated: false,
      status: 'none',
      message: `Reference ${ref.id}: нет url (type=${ref.type}) — пропуск`,
    };
  }
  const absPath = referenceCachePath(cwd, ref);
  const sections: CacheSection[] = [];
  const raws = new Map<string, string>();
  const failed: { url: string; error: string }[] = [];
  for (const url of urls) {
    try {
      const { markdown, raw } = await fetchMarkdown(url, deps);
      sections.push({ url, markdown });
      raws.set(url, raw);
    } catch (err) {
      const error = (err as Error).message;
      sections.push({ url, error });
      failed.push({ url, error });
    }
  }
  const okCount = urls.length - failed.length;
  if (okCount === 0) {
    return {
      updated: false,
      status: 'failed',
      message: `Reference ${ref.id}: ошибка обновления кэша: все ${urls.length} ссылок: ${describeFailures(failed)}`,
    };
  }
  try {
    const sourceHash = buildCacheOutput(sections, raws).sourceHash;
    // Сравнение с прежним хэшем: частичный сбой меняет набор успешных ссылок,
    // поэтому хэш разойдётся и кэш перезапишется с актуальной пометкой
    if (failed.length === 0 && sourceHash === ref.source_hash && existsSync(absPath)) {
      return {
        updated: false,
        status: 'skipped',
        message: `Reference ${ref.id}: без изменений (source_hash совпал)`,
      };
    }
    const markdown = buildCacheOutput(sections, raws).markdown;
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
    if (failed.length > 0) {
      return {
        updated: true,
        status: 'partial',
        message: `Reference ${ref.id}: частичный успех — обновлено ${okCount} из ${urls.length} ссылок (ошибок: ${failed.length}: ${describeFailures(failed)}) → ${relPath}`,
      };
    }
    return { updated: true, status: 'updated', message: `Reference ${ref.id}: кэш обновлён → ${relPath}` };
  } catch (err) {
    return {
      updated: false,
      status: 'failed',
      message: `Reference ${ref.id}: ошибка обновления кэша: ${(err as Error).message}`,
    };
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
 * Классификация — по явному status из refreshReferenceCache (VL-291:
 * раньше разбирались подстроки сообщения — хрупко).
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
      if ((t === 'url' || t === 'doc' || t === 'spec') && referenceUrls(e.reference).length > 0) {
        targets.push(e);
      }
    }
  }

  for (const e of targets) {
    // refresh сам решает: нет кэша/хэш разошёлся → updated, иначе skipped
    const res = await refreshReferenceCache(cwd, e.reference, deps);
    if (res.status === 'updated') result.updated.push(e.reference.id);
    else if (res.status === 'skipped' || res.status === 'none') result.skipped.push(e.reference.id);
    // partial — часть ссылок не скачалась: это не полный успех, сообщаем как ошибку
    else result.failed.push({ id: e.reference.id, error: res.message });
  }
  return result;
}
