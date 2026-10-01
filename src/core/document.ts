/**
 * Модель документов Vibelog.md.
 *
 * Документ — markdown-файл с YAML-фронтматтером в backlog/docs/.
 * Поля: id (doc-N), title, type (readme/guide/specification/other),
 * created_date, tags[]. Тело — markdown (rawContent).
 *
 * Совместимо с Document из оригинала Backlog.md
 * (types/index.ts, DOCUMENT_TYPE_VALUES).
 *
 * Формат файла: backlog/docs/<id>-<slug>.md
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { docsDir } from './paths.js';

/** Типы документов — строго как DOCUMENT_TYPE_VALUES оригинала Backlog.md. */
export const DOCUMENT_TYPES = ['readme', 'guide', 'specification', 'other'];

/** Объект документа (метаданные; тело — отдельно в DocumentEntry). */
export interface Document {
  id: string;
  title: string;
  type: string;
  created_date: string;
  tags: string[];
}

/** Входные данные документа. */
export interface DocumentInput {
  id?: string;
  title: string;
  type?: string;
  created_date?: string;
  tags?: string[];
}

/** Запись документа: метаданные + тело + путь к файлу. */
export interface DocumentEntry {
  document: Document;
  body: string;
  path: string;
}

/**
 * Нормализует тип документа (case-insensitive → каноническое написание).
 *
 * @returns канонический тип, 'other' если пусто
 * @throws если тип не входит в DOCUMENT_TYPES
 */
export function normalizeDocumentType(type: string): string {
  if (!type) return 'other';
  const candidate = String(type).toLowerCase();
  const canonical = DOCUMENT_TYPES.find(t => t === candidate);
  if (!canonical) {
    throw new Error(`Недопустимый тип документа "${type}". Допустимые: ${DOCUMENT_TYPES.join(', ')}`);
  }
  return canonical;
}

/**
 * Генерирует имя файла документа: <id>-<slug>.md.
 *
 * @param id — id документа (doc-N)
 * @param title — заголовок (источник slug)
 */
export function documentFilename(id: string, title: string): string {
  const slug = String(title || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${id}${slug ? `-${slug}` : ''}.md`;
}

/**
 * Создаёт объект документа.
 */
export function createDocument(input: DocumentInput): Document {
  return {
    id: input.id || '',
    title: input.title,
    type: normalizeDocumentType(input.type || ''),
    created_date: input.created_date || '',
    tags: input.tags || [],
  };
}

/**
 * Сериализует документ + тело в markdown.
 *
 * @param body — markdown-тело (rawContent)
 */
export function documentToMarkdown(doc: Document, body?: string): string {
  const frontmatter: Record<string, unknown> = {
    id: doc.id,
    title: doc.title,
    type: doc.type,
    created_date: doc.created_date,
    tags: doc.tags || [],
  };
  return serializeFrontmatter(frontmatter, body || '');
}

/**
 * Десериализует markdown в документ + тело.
 */
export function markdownToDocument(content: string): { document: Document; body: string } {
  const { data, body } = parseFrontmatter(content);
  return {
    document: {
      id: (data.id as string) || '',
      title: (data.title as string) || '',
      type: (data.type as string) || 'other',
      created_date: (data.created_date as string) || '',
      tags: Array.isArray(data.tags) ? (data.tags as string[]) : (data.tags ? [data.tags as string] : []),
    },
    body: body || '',
  };
}

/** Текущая дата YYYY-MM-DD — для created_date по умолчанию. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Следующий id вида doc-N (max+1).
 *
 * @param entries — записи listDocuments
 */
function nextDocumentId(entries: DocumentEntry[]): string {
  let max = 0;
  for (const e of entries) {
    const m = String(e.document.id).match(/^doc-(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `doc-${max + 1}`;
}

/**
 * Читает все документы из backlog/docs/.
 */
export function listDocuments(backlogDir: string): DocumentEntry[] {
  const dir = docsDir(backlogDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const path = join(dir, f);
      const { document, body } = markdownToDocument(readFileSync(path, 'utf-8'));
      return { document, body, path };
    })
    // Пропускаем файлы без id (посторонние markdown в docs/)
    .filter(e => e.document.id);
}

/**
 * Находит документ по id (case-insensitive).
 */
export function getDocument(backlogDir: string, id: string): DocumentEntry | null {
  const needle = String(id).toLowerCase();
  return listDocuments(backlogDir).find(e => e.document.id.toLowerCase() === needle) || null;
}

/** Вход writeDocument: метаданные + markdown-содержимое. */
export interface WriteDocumentInput extends DocumentInput {
  content?: string;
}

/**
 * Создаёт документ-файл (id генерируется doc-N, если не задан;
 * created_date — сегодня, если не задан).
 *
 * @returns созданный документ
 */
export function writeDocument(backlogDir: string, input: WriteDocumentInput): Document {
  const dir = docsDir(backlogDir);
  mkdirSync(dir, { recursive: true });

  const entries = listDocuments(backlogDir);
  const doc = createDocument({
    ...input,
    id: input.id || nextDocumentId(entries),
    created_date: input.created_date || today(),
  });
  writeFileSync(
    join(dir, documentFilename(doc.id, doc.title)),
    documentToMarkdown(doc, input.content || ''),
    'utf-8',
  );
  return doc;
}

/** Обновляемые поля документа. */
export interface UpdateDocumentInput {
  title?: string;
  type?: string;
  tags?: string[];
  content?: string;
}

/**
 * Обновляет документ: поля и/или тело. При смене title файл переименовывается.
 *
 * @returns обновлённая запись или null если не найден
 */
export function updateDocument(
  backlogDir: string,
  id: string,
  updates: UpdateDocumentInput
): DocumentEntry | null {
  const entry = getDocument(backlogDir, id);
  if (!entry) return null;

  const doc = createDocument({
    ...entry.document,
    ...updates,
    id: entry.document.id,
    title: updates.title !== undefined ? updates.title : entry.document.title,
    type: updates.type !== undefined ? updates.type : entry.document.type,
    tags: updates.tags !== undefined ? updates.tags : entry.document.tags,
  });
  const body = updates.content !== undefined ? updates.content : entry.body;

  const newPath = join(docsDir(backlogDir), documentFilename(doc.id, doc.title));
  writeFileSync(newPath, documentToMarkdown(doc, body), 'utf-8');
  if (newPath !== entry.path && existsSync(entry.path)) {
    try { unlinkSync(entry.path); } catch { /* ignore */ }
  }
  return { document: doc, body, path: newPath };
}

/**
 * Поиск документов: substring по id/title/tags/телу (case-insensitive).
 */
export function searchDocuments(backlogDir: string, query: string): DocumentEntry[] {
  const all = listDocuments(backlogDir);
  if (!query || !query.trim()) return all;

  const q = query.toLowerCase().trim();
  return all.filter(e => {
    if (e.document.id.toLowerCase().includes(q)) return true;
    if (e.document.title.toLowerCase().includes(q)) return true;
    if (e.document.tags.some(t => String(t).toLowerCase().includes(q))) return true;
    if (e.body && e.body.toLowerCase().includes(q)) return true;
    return false;
  });
}
