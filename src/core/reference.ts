/**
 * Модель references (VL-152) — метаданные о внешних источниках знаний.
 *
 * Reference — markdown-файл с YAML-фронтматтером в backlog/references/.
 * Поля: id (ref-N), title, type (repo/url/file/doc/spec/experiment), url?, path?,
 * tags[], created_date, linked_tasks[]. Тело — markdown-описание (rawContent).
 *
 * Расширение формата Vibelog.md: Backlog.md не знает про references и
 * игнорирует директорию backlog/references/ — round-trip сохраняется.
 *
 * Каталог clones: backlog/references/data/<dir> (в .gitignore).
 * `cloneReferenceRepo` сам клонирует type=repo; `syncReferenceRepos`
 * доклонирует отсутствующие (для разработчиков без data/).
 *
 * Формат файла: backlog/references/<id>-<slug>.md
 */

import {
  readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { findBacklogDir, referencesDir, referencesDataDir, referencesCacheDir } from './paths.js';
import { getTask, updateTaskFile } from './store.js';

/** Типы референсов. `experiment` (VL-294) позволяет ссылаться на карточку
 * эксперимента backlog/experiments/exp-<id>.md без изменения схемы lesson. */
export const REFERENCE_TYPES = ['repo', 'url', 'file', 'doc', 'spec', 'experiment'];

/** Объект reference (метаданные; тело — отдельно в ReferenceEntry). */
export interface Reference {
  id: string;
  title: string;
  type: string;
  url?: string;
  path?: string;
  tags: string[];
  created_date: string;
  linked_tasks: string[];
  /** Относительный (от backlog/) путь к markdown-кэшу, если скачивался (VL-194). */
  cached_path?: string;
  /** Дополнительные URL (VL-291): `url` — первая ссылка, `urls` — все последующие.
   * Порядок важен: кэш склеивается секциями в этом же порядке. */
  urls?: string[];
  /** ISO-8601 UTC момент последнего обновления кэша (VL-194). */
  cached_at?: string;
  /** sha256 сырого HTML-ответа — для проверки устаревания при sync (VL-194). */
  source_hash?: string;
}

/** Входные данные reference. */
export interface ReferenceInput {
  id?: string;
  title: string;
  type: string;
  url?: string;
  /** Дополнительные URL (VL-291); первый элемент может нести основную ссылку. */
  urls?: string[];
  path?: string;
  tags?: string[];
  created_date?: string;
  linked_tasks?: string[];
}

/** Запись reference: метаданные + тело + путь к файлу. */
export interface ReferenceEntry {
  reference: Reference;
  body: string;
  path: string;
}

/** Результат syncReferenceRepos: что клонировано/пропущено/упало. */
export interface SyncResult {
  cloned: string[];
  skipped: string[];
  failed: { id: string; error: string }[];
}

/**
 * Ищет backlog-директорию или бросает понятную ошибку.
 * (findBacklogDir возвращает null — все операции references требуют backlog.)
 */
function requireBacklogDir(cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден. Выполните: vibelog init');
  return backlogDir;
}

/**
 * Нормализует тип reference (case-insensitive → каноническое написание).
 *
 * @throws если тип не входит в REFERENCE_TYPES
 */
export function normalizeReferenceType(type: string): string {
  const candidate = String(type || '').toLowerCase();
  const canonical = REFERENCE_TYPES.find(t => t === candidate);
  if (!canonical) {
    throw new Error(`Недопустимый тип reference "${type}". Допустимые: ${REFERENCE_TYPES.join(', ')}`);
  }
  return canonical;
}

/**
 * Генерирует имя файла reference: <id>-<slug>.md.
 *
 * @param id — id reference (ref-N)
 * @param title — заголовок (источник slug)
 */
export function referenceFilename(id: string, title: string): string {
  const slug = String(title || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${id}${slug ? `-${slug}` : ''}.md`;
}

/**
 * Нормализует дополнительные URL (VL-291): trim, отбрасывает пустые значения
 * и дубликаты (порядок первого вхождения сохраняется — он же порядок секций
 * склеенного кэша). Первая ссылка (`firstUrl`) участвует в дедупе: её повтор
 * в списке дополнительных отбрасывается.
 *
 * @param firstUrl — первая ссылка (поле url), уже занявшая место в списке
 * @param urls — дополнительные ссылки (поле urls)
 */
function normalizeExtraUrls(firstUrl: string | undefined, urls?: string[]): string[] {
  const seen = new Set<string>();
  if (firstUrl) seen.add(firstUrl);
  const out: string[] = [];
  for (const raw of urls || []) {
    const value = String(raw ?? '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * Полный упорядоченный список URL reference (VL-291).
 *
 * `url` — первая ссылка, `urls` — дополнительные; пустые отбрасываются,
 * дубликаты схлопываются. Порядок = порядок секций в склеенном кэше.
 */
export function referenceUrls(ref: Reference): string[] {
  const list: string[] = [];
  if (ref.url) list.push(ref.url);
  for (const u of ref.urls || []) {
    const value = String(u ?? '').trim();
    if (value && !list.includes(value)) list.push(value);
  }
  return list;
}

/**
 * Создаёт объект reference (валидирует type).
 */
export function createReference(input: ReferenceInput): Reference {
  const ref: Reference = {
    id: input.id || '',
    title: input.title,
    type: normalizeReferenceType(input.type),
    url: input.url || undefined,
    path: input.path || undefined,
    tags: input.tags || [],
    created_date: input.created_date || '',
    linked_tasks: input.linked_tasks || [],
  };
  // Продвижение первой ссылки (VL-291): url не задан, но пришёл список —
  // первая ссылка становится `url`, чтобы `referenceUrls`/клонирование/repo
  // видели её как основную (обратная совместимость: url остаётся основным)
  if (!ref.url && input.urls && input.urls.length > 0) {
    const first = String(input.urls[0] ?? '').trim();
    if (first) ref.url = first;
  }
  // Доп. ссылки: ключ создаём только при непустом массиве — старые url-only
  // файлы остаются без «висячего» поля (round-trip VL-152 сходится)
  const extra = normalizeExtraUrls(ref.url, input.urls);
  if (extra.length > 0) ref.urls = extra;
  return ref;
}

/**
 * Сериализует reference + тело в markdown.
 *
 * Пустые опциональные поля (url/path) опускаются — frontmatter чистый.
 */
export function referenceToMarkdown(ref: Reference, body?: string): string {
  const frontmatter: Record<string, unknown> = {
    id: ref.id,
    title: ref.title,
    type: ref.type,
  };
  if (ref.url) frontmatter.url = ref.url;
  // Доп. ссылки (VL-291): пишем только при непустом массиве — файлы без
  // дополнительных ссылок сохраняют прежний frontmatter байт-в-байт
  if (ref.urls && ref.urls.length > 0) frontmatter.urls = ref.urls;
  if (ref.path) frontmatter.path = ref.path;
  frontmatter.tags = ref.tags || [];
  frontmatter.created_date = ref.created_date;
  frontmatter.linked_tasks = ref.linked_tasks || [];
  // Поля кэша (VL-194): пишем только если заданы — старые файлы без кэша
  // остаются без «висячих» ключей, frontmatter чистый.
  if (ref.cached_path) frontmatter.cached_path = ref.cached_path;
  if (ref.cached_at) frontmatter.cached_at = ref.cached_at;
  if (ref.source_hash) frontmatter.source_hash = ref.source_hash;
  return serializeFrontmatter(frontmatter, body || '');
}

/**
 * Десериализует markdown в reference + тело.
 */
export function markdownToReference(content: string): { reference: Reference; body: string } {
  const { data, body } = parseFrontmatter(content);
  const reference: Reference = {
    id: (data.id as string) || '',
    title: (data.title as string) || '',
    type: (data.type as string) || 'repo',
    url: (data.url as string) || undefined,
    path: (data.path as string) || undefined,
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : (data.tags ? [data.tags as string] : []),
    created_date: (data.created_date as string) || '',
    linked_tasks: Array.isArray(data.linked_tasks)
      ? (data.linked_tasks as string[])
      : (data.linked_tasks ? [data.linked_tasks as string] : []),
  };
  // Поля кэша (VL-194): в старых файлах их нет — ключи не создаём,
  // чтобы round-trip давал строго равный объект (см. VL-152 round-trip тест)
  if (data.cached_path) reference.cached_path = data.cached_path as string;
  // Доп. ссылки (VL-291): в старых файлах ключа нет — не создаём (round-trip);
  // скалярная строка принимается по аналогии с tags
  if (data.urls !== undefined && data.urls !== null) {
    const raw = Array.isArray(data.urls) ? (data.urls as unknown[]) : [data.urls];
    const list = raw
      .map(u => String(u ?? '').trim())
      .filter(u => u.length > 0 && u !== reference.url);
    if (list.length > 0) reference.urls = list;
  }
  if (data.cached_at) reference.cached_at = data.cached_at as string;
  if (data.source_hash) reference.source_hash = data.source_hash as string;
  return { reference, body: body || '' };
}

/** Текущая дата YYYY-MM-DD — для created_date по умолчанию. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Следующий id вида ref-N (max+1).
 */
function nextReferenceId(entries: ReferenceEntry[]): string {
  let max = 0;
  for (const e of entries) {
    const m = String(e.reference.id).match(/^ref-(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `ref-${max + 1}`;
}

/**
 * Читает все references из backlog/references/ (data/ пропускается).
 */
export function listReferences(cwd: string): ReferenceEntry[] {
  const backlogDir = requireBacklogDir(cwd);
  const dir = referencesDir(backlogDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.md'))
    .map(d => {
      const path = join(dir, d.name);
      const { reference, body } = markdownToReference(readFileSync(path, 'utf-8'));
      return { reference, body, path };
    })
    // Пропускаем файлы без id (посторонние markdown в references/)
    .filter(e => e.reference.id);
}

/**
 * Находит reference по id (case-insensitive).
 */
export function getReference(cwd: string, id: string): ReferenceEntry | null {
  const needle = String(id).toLowerCase();
  return listReferences(cwd).find(e => e.reference.id.toLowerCase() === needle) || null;
}

/** Вход writeReference: метаданные + markdown-тело. */
export interface WriteReferenceInput extends ReferenceInput {
  content?: string;
}

/**
 * Создаёт reference-файл (id генерируется ref-N, created_date — сегодня,
 * если не заданы).
 *
 * @returns созданный reference
 */
export function writeReference(cwd: string, input: WriteReferenceInput): Reference {
  const backlogDir = requireBacklogDir(cwd);
  const dir = referencesDir(backlogDir);
  mkdirSync(dir, { recursive: true });

  const entries = listReferences(cwd);
  const ref = createReference({
    ...input,
    id: input.id || nextReferenceId(entries),
    created_date: input.created_date || today(),
  });
  writeFileSync(
    join(dir, referenceFilename(ref.id, ref.title)),
    referenceToMarkdown(ref, input.content || ''),
    'utf-8',
  );
  return ref;
}

/** Обновляемые поля reference. */
export interface UpdateReferenceInput {
  title?: string;
  type?: string;
  url?: string;
  /** Дополнительные URL (VL-291): полная замена набора; [] — очистить. */
  urls?: string[];
  path?: string;
  tags?: string[];
  linked_tasks?: string[];
  content?: string;
  /** Поля кэша (VL-194): записываются reference-cache, иначе merge их сотрёт. */
  cached_path?: string;
  cached_at?: string;
  source_hash?: string;
}

/**
 * Обновляет reference: поля и/или тело. При смене title файл переименовывается.
 *
 * @returns обновлённая запись или null если не найден
 */
export function updateReference(
  cwd: string,
  id: string,
  updates: UpdateReferenceInput
): ReferenceEntry | null {
  const backlogDir = requireBacklogDir(cwd);
  const entry = getReference(cwd, id);
  if (!entry) return null;

  const merged: Reference = {
    ...entry.reference,
    title: updates.title !== undefined ? updates.title : entry.reference.title,
    type: updates.type !== undefined ? normalizeReferenceType(updates.type) : entry.reference.type,
    url: updates.url !== undefined ? updates.url : entry.reference.url,
    path: updates.path !== undefined ? updates.path : entry.reference.path,
    tags: updates.tags !== undefined ? updates.tags : entry.reference.tags,
    linked_tasks: updates.linked_tasks !== undefined ? updates.linked_tasks : entry.reference.linked_tasks,
    // Кэш-поля (VL-194): без них в merge любой update (link/rename/tags)
    // молча стирал бы cached_path/cached_at/source_hash
    cached_path: updates.cached_path !== undefined ? updates.cached_path : entry.reference.cached_path,
    cached_at: updates.cached_at !== undefined ? updates.cached_at : entry.reference.cached_at,
    source_hash: updates.source_hash !== undefined ? updates.source_hash : entry.reference.source_hash,
  };
  // Доп. ссылки (VL-291): та же ловушка, что у кэш-полей VL-194 — без явной
  // ветки merge любой link/rename/tags-апдейт терял бы urls. updates.urls
  // undefined → сохраняем прежние (минус совпавшие с новым url); [] → очистка.
  const extraUrls = normalizeExtraUrls(
    merged.url,
    updates.urls !== undefined ? updates.urls : entry.reference.urls,
  );
  if (extraUrls.length > 0) merged.urls = extraUrls;
  else delete merged.urls;
  const body = updates.content !== undefined ? updates.content : entry.body;

  const newPath = join(referencesDir(backlogDir), referenceFilename(merged.id, merged.title));
  writeFileSync(newPath, referenceToMarkdown(merged, body), 'utf-8');
  if (newPath !== entry.path && existsSync(entry.path)) {
    try { unlinkSync(entry.path); } catch { /* ignore */ }
  }
  return { reference: merged, body, path: newPath };
}

/**
 * Удаляет reference-файл.
 *
 * Клон в data/ НЕ удаляется (данные ценнее метаданных; удалить клон —
 * ручное действие rm -rf).
 *
 * @returns true если удалён
 */
export function removeReference(cwd: string, id: string): boolean {
  const entry = getReference(cwd, id);
  if (!entry) return false;
  try { unlinkSync(entry.path); } catch { return false; }
  return true;
}

/**
 * Поиск references: substring по id/title/url/path/tags/телу (case-insensitive).
 */
export function searchReferences(cwd: string, query: string): ReferenceEntry[] {
  const all = listReferences(cwd);
  if (!query || !query.trim()) return all;

  const q = query.toLowerCase().trim();
  return all.filter(e => {
    const r = e.reference;
    if (r.id.toLowerCase().includes(q)) return true;
    if (r.title.toLowerCase().includes(q)) return true;
    if (r.url && r.url.toLowerCase().includes(q)) return true;
    if ((r.urls || []).some(u => String(u).toLowerCase().includes(q))) return true;
    if (r.path && r.path.toLowerCase().includes(q)) return true;
    if (r.tags.some(t => String(t).toLowerCase().includes(q))) return true;
    if (e.body && e.body.toLowerCase().includes(q)) return true;
    return false;
  });
}

/**
 * Находит references, которым принадлежит путь.
 *
 * Совпадение (после нормализации — без завершающих слэшей, lowercase):
 * - точное равенство path;
 * - path — префикс пути или наоборот («файл внутри клона», «каталог целиком»);
 * - путь содержит path как сегмент (абсолютный путь содержит
 *   относительный «data/<dir>» из frontmatter).
 *
 * @param path — путь к файлу/каталогу (абсолютный или относительный)
 */
export function findByPath(cwd: string, path: string): ReferenceEntry[] {
  const needle = String(path || '').replace(/\/+$/, '').toLowerCase();
  if (!needle) return [];
  return listReferences(cwd).filter(e => {
    const p = String(e.reference.path || '').replace(/\/+$/, '').toLowerCase();
    if (!p) return false;
    if (needle === p) return true;
    if (needle.startsWith(p + '/') || p.startsWith(needle + '/')) return true;
    // Абсолютный/относительный путь содержит относительный data/<dir> как
    // целый сегмент пути (в середине или в конце — не затрагивая соседние dir)
    return needle.includes('/' + p + '/') || needle.endsWith('/' + p);
  });
}

/**
 * Находит references, связанные с задачей (linked_tasks содержит taskId).
 *
 * @param taskId — ID задачи, например VL-42
 */
export function findByTask(cwd: string, taskId: string): ReferenceEntry[] {
  const needle = String(taskId).toLowerCase();
  return listReferences(cwd).filter(e =>
    (e.reference.linked_tasks || []).some(t => String(t).toLowerCase() === needle)
  );
}

/**
 * Абсолютный путь markdown-кэша reference (VL-194).
 *
 * Имя файла — по id, не по title: переименование reference не ломает кэш.
 */
export function referenceCachePath(cwd: string, ref: Reference): string {
  const backlogDir = requireBacklogDir(cwd);
  return join(referencesCacheDir(backlogDir), `${ref.id}.md`);
}

/**
 * Абсолютный путь каталога клона репозитория reference.
 *
 * Если path не задан — берётся basename(url) без .git.
 */
export function referenceCloneDir(cwd: string, ref: Reference): string {
  const backlogDir = requireBacklogDir(cwd);
  let dir = ref.path || '';
  if (dir.startsWith('data/')) dir = dir.slice('data/'.length);
  if (!dir && ref.url) {
    dir = ref.url.replace(/\.git\/?$/, '').split('/').pop() || '';
  }
  if (!dir) throw new Error(`Reference ${ref.id}: не удалось вычислить каталог клона (нет path и url)`);
  return join(referencesDataDir(backlogDir), dir);
}

/**
 * Клонирует репозиторий reference в backlog/references/data/<dir>.
 *
 * Идемпотентно: каталог уже существует → skip (сообщение «уже клонирован»).
 * Ошибка клона НЕ роняет вызывающий код — возвращается сообщение; для
 * списка (sync) ошибка собирается в failed.
 *
 * @returns {cloned: true|false, message} — message всегда заполнен
 */
export function cloneReferenceRepo(
  cwd: string,
  ref: Reference,
  env: NodeJS.ProcessEnv = process.env
): { cloned: boolean; message: string } {
  if (ref.type !== 'repo') {
    return { cloned: false, message: `Reference ${ref.id}: клонирование только для type=repo (сейчас ${ref.type})` };
  }
  if (!ref.url) {
    return { cloned: false, message: `Reference ${ref.id}: нет url для клонирования` };
  }
  const target = referenceCloneDir(cwd, ref);
  if (existsSync(target)) {
    return { cloned: false, message: `Reference ${ref.id}: уже клонирован (${target}), пропуск` };
  }
  mkdirSync(dirname(target), { recursive: true });
  // timeout 15 с (VL-225): защита от зависания git clone на офлайн-DNS/битом
  // хосте — без него spawnSync блокируется до бесконечности (в тестах до
  // testTimeout 120 с). Локальный file:// clone укладывается в доли секунды.
  const res = spawnSync('git', ['clone', '--depth', '1', ref.url, target], { encoding: 'utf-8', env, timeout: 15_000 });
  if (res.error || res.status !== 0) {
    const detail = ((res.stderr ?? '') + (res.error?.message ?? '')).trim();
    return { cloned: false, message: `Reference ${ref.id}: ошибка клонирования ${ref.url}: ${detail}` };
  }
  return { cloned: true, message: `Reference ${ref.id}: клонирован в ${target}` };
}

/**
 * Клонирует отсутствующие репозитории для всех references type=repo.
 *
 * Одна ошибка не прерывает общий запуск — собирается в failed.
 *
 * @returns итоги: cloned/skipped/failed (id-шники reference)
 */
export function syncReferenceRepos(cwd: string, env: NodeJS.ProcessEnv = process.env): SyncResult {
  const result: SyncResult = { cloned: [], skipped: [], failed: [] };
  for (const entry of listReferences(cwd)) {
    const ref = entry.reference;
    if (ref.type !== 'repo') continue;
    const res = cloneReferenceRepo(cwd, ref, env);
    if (res.cloned) {
      result.cloned.push(ref.id);
    } else if (res.message.includes('уже клонирован')) {
      result.skipped.push(ref.id);
    } else {
      result.failed.push({ id: ref.id, error: res.message });
    }
  }
  return result;
}

/**
 * Двусторонняя связь reference ↔ задача (VL-152, AC9).
 *
 * action=add:    reference.linked_tasks += taskId; task.references += refId
 * action=remove: из обоих списков удаляется
 *
 * Идемпотентно: повторное add не дублирует, remove отсутствующего — no-op.
 *
 * @returns true если reference и задача найдены и обновлены
 * @throws если reference или задача не найдены
 */
export function linkReferenceTask(
  cwd: string,
  refId: string,
  taskId: string,
  action: 'add' | 'remove' = 'add'
): boolean {
  const entry = getReference(cwd, refId);
  if (!entry) throw new Error(`Reference ${refId} не найден.`);
  const task = getTask(cwd, taskId);
  if (!task) throw new Error(`Задача ${taskId} не найдена.`);

  const linked = new Set(entry.reference.linked_tasks || []);
  const taskRefs = new Set(task.references || []);
  if (action === 'add') {
    linked.add(taskId);
    taskRefs.add(refId);
  } else {
    linked.delete(taskId);
    taskRefs.delete(refId);
  }

  updateReference(cwd, entry.reference.id, { linked_tasks: [...linked] });
  updateTaskFile(cwd, task.id, { references: [...taskRefs] });
  return true;
}
