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
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import { docsDir } from './paths.mjs';

/** Типы документов — строго как DOCUMENT_TYPE_VALUES оригинала Backlog.md. */
export const DOCUMENT_TYPES = ['readme', 'guide', 'specification', 'other'];

/**
 * Нормализует тип документа (case-insensitive → каноническое написание).
 *
 * @param {string} type — тип из ввода
 * @returns {string} — канонический тип, 'other' если пусто
 * @throws {Error} — если тип не входит в DOCUMENT_TYPES
 */
export function normalizeDocumentType(type) {
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
 * @param {string} id — id документа (doc-N)
 * @param {string} title — заголовок (источник slug)
 * @returns {string}
 */
export function documentFilename(id, title) {
  const slug = String(title || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${id}${slug ? `-${slug}` : ''}.md`;
}

/**
 * Создаёт объект документа.
 *
 * @param {object} input — { id, title, type, created_date, tags }
 * @returns {object}
 */
export function createDocument(input) {
  return {
    id: input.id,
    title: input.title,
    type: normalizeDocumentType(input.type),
    created_date: input.created_date || '',
    tags: input.tags || [],
  };
}

/**
 * Сериализует документ + тело в markdown.
 *
 * @param {object} doc
 * @param {string} [body] — markdown-тело (rawContent)
 * @returns {string}
 */
export function documentToMarkdown(doc, body) {
  const frontmatter = {
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
 *
 * @param {string} content
 * @returns {{document: object, body: string}}
 */
export function markdownToDocument(content) {
  const { data, body } = parseFrontmatter(content);
  return {
    document: {
      id: data.id || '',
      title: data.title || '',
      type: data.type || 'other',
      created_date: data.created_date || '',
      tags: Array.isArray(data.tags) ? data.tags : (data.tags ? [data.tags] : []),
    },
    body: body || '',
  };
}

/**
 * Следующий id вида doc-N (max+1).
 *
 * @param {object[]} entries — записи listDocuments
 * @returns {string}
 */
/** Текущая дата YYYY-MM-DD — для created_date по умолчанию. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nextDocumentId(entries) {
  let max = 0;
  for (const e of entries) {
    const m = String(e.document.id).match(/^doc-(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `doc-${max + 1}`;
}

/**
 * Читает все документы из backlog/docs/.
 *
 * @param {string} backlogDir
 * @returns {Array<{document: object, body: string, path: string}>}
 */
export function listDocuments(backlogDir) {
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
 *
 * @param {string} backlogDir
 * @param {string} id
 * @returns {Array<{document: object, body: string, path: string}>|null}
 */
export function getDocument(backlogDir, id) {
  const needle = String(id).toLowerCase();
  return listDocuments(backlogDir).find(e => e.document.id.toLowerCase() === needle) || null;
}

/**
 * Создаёт документ-файл (id генерируется doc-N, если не задан).
 *
 * @param {string} backlogDir
 * @param {object} input — { title, type, tags, content, created_date }
 * @returns {object} — созданный документ
 */
export function writeDocument(backlogDir, input) {
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

/**
 * Обновляет документ: поля и/или тело. При смене title файл переименовывается.
 *
 * @param {string} backlogDir
 * @param {string} id
 * @param {object} updates — { title, type, tags, content }
 * @returns {object|null} — обновлённый документ или null если не найден
 */
export function updateDocument(backlogDir, id, updates) {
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
 *
 * @param {string} backlogDir
 * @param {string} query
 * @returns {Array<{document: object, body: string, path: string}>}
 */
export function searchDocuments(backlogDir, query) {
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
