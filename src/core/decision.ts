/**
 * Модель архитектурных решений (decisions / ADR) Vibelog.md.
 *
 * Решение — markdown-файл с YAML-фронтматтером в backlog/decisions/.
 * Поля: id (decision-N), title, date, status (proposed|accepted|rejected|
 * superseded, free-form как в оригинале, дефолт proposed).
 * Тело — ADR-секции: ## Context / ## Decision / ## Consequences / ## Alternatives.
 *
 * Совместимо с Decision из оригинала Backlog.md (types/index.ts:203,
 * DECISION_PREFIX = "decision").
 *
 * Формат файла: backlog/decisions/<id>-<slug>.md
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { decisionsDir } from './paths.js';

/** Статусы из интерфейса оригинала — справочно (CLI original: free-form). */
export const DECISION_STATUSES = ['proposed', 'accepted', 'rejected', 'superseded'];

/** Объект решения (метаданные ADR). */
export interface Decision {
  id: string;
  title: string;
  date: string;
  status: string;
}

/** Входные данные решения (create). */
export interface DecisionInput {
  title: string;
  status?: string;
  date?: string;
  context?: string;
  decision?: string;
  consequences?: string;
  alternatives?: string;
}

/** Запись решения: метаданные + ADR-тело + путь к файлу. */
export interface DecisionEntry {
  decision: Decision;
  body: string;
  path: string;
  /**
   * VL-412: id встречается больше одного раза (в `backlog/decisions/` лежат
   * два файла с одним `id`). `getDecision` возвращает ПЕРВЫЙ найденный, и без
   * этого признака вызывающий не узнал бы, что прочитанное может быть
   * устаревшей версией решения. Поле аддитивное — старые вызовы не ломаются.
   */
  ambiguous?: boolean;
}

/** Имена ADR-секций в каноническом порядке (порядок важен при добавлении). */
export const DECISION_SECTIONS = ['Context', 'Decision', 'Consequences', 'Alternatives'] as const;

/** Имя ADR-секции. */
export type DecisionSection = (typeof DECISION_SECTIONS)[number];

/** Точечная правка решения (VL-412): только переданные поля. */
export interface UpdateDecisionInput {
  title?: string;
  status?: string;
  context?: string;
  decision?: string;
  consequences?: string;
  alternatives?: string;
}

/** Результат точечной правки: запись после записи + список изменённых полей. */
export interface UpdateDecisionResult {
  decision: Decision;
  body: string;
  path: string;
  /** Имена полей, которые реально изменились (для ack `applied`). */
  changed: string[];
}

/**
 * Генерирует имя файла решения: <id>-<slug>.md.
 */
export function decisionFilename(id: string, title: string): string {
  const slug = String(title || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${id}${slug ? `-${slug}` : ''}.md`;
}

/** Текущая дата YYYY-MM-DD — для date по умолчанию. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Следующий id вида decision-N (max+1).
 *
 * @param entries — записи listDecisions
 */
function nextDecisionId(entries: DecisionEntry[]): string {
  let max = 0;
  for (const e of entries) {
    const m = String(e.decision.id).match(/^decision-(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `decision-${max + 1}`;
}

/**
 * Собирает ADR-тело из полей.
 */
function buildBody(input: DecisionInput): string {
  const sections: string[] = [];
  if (input.context) sections.push('## Context', '', input.context);
  if (input.decision) sections.push('## Decision', '', input.decision);
  if (input.consequences) sections.push('## Consequences', '', input.consequences);
  if (input.alternatives) sections.push('## Alternatives', '', input.alternatives);
  return sections.join('\n');
}

/**
 * Создаёт решение-файл (id decision-N, date = сегодня).
 *
 * @returns созданный решение {id, title, date, status}
 */
export function writeDecision(backlogDir: string, input: DecisionInput): Decision {
  const dir = decisionsDir(backlogDir);
  mkdirSync(dir, { recursive: true });

  const decision: Decision = {
    id: nextDecisionId(listDecisions(backlogDir)),
    title: input.title,
    date: input.date || today(),
    status: input.status || 'proposed',
  };
  const frontmatter: Record<string, unknown> = {
    id: decision.id,
    title: decision.title,
    date: decision.date,
    status: decision.status,
  };
  writeFileSync(
    join(dir, decisionFilename(decision.id, decision.title)),
    serializeFrontmatter(frontmatter, buildBody(input)),
    'utf-8',
  );
  return decision;
}

/**
 * Читает все решения из backlog/decisions/.
 *
 * @param opts — фильтр по статусу (case-insensitive)
 */
export function listDecisions(
  backlogDir: string,
  opts: { status?: string } = {}
): DecisionEntry[] {
  const dir = decisionsDir(backlogDir);
  if (!existsSync(dir)) return [];

  let entries = readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const path = join(dir, f);
      const { data, body } = parseFrontmatter(readFileSync(path, 'utf-8'));
      return {
        decision: {
          id: (data.id as string) || '',
          title: (data.title as string) || '',
          date: (data.date as string) || '',
          status: (data.status as string) || 'proposed',
        },
        body: body || '',
        path,
      };
    })
    .filter(e => e.decision.id);

  if (opts.status) {
    const needle = String(opts.status).toLowerCase();
    entries = entries.filter(e => e.decision.status.toLowerCase() === needle);
  }
  return entries;
}

/**
 * Находит id, встречающиеся больше одного раза (VL-412).
 *
 * В `backlog/decisions/` реально лежат два файла с `id: decision-10`
 * (устаревшая версия про `manifest.json` и актуальная про
 * `installed.lock.json`). `nextDecisionId` берёт max+1, поэтому новые id не
 * ломаются, но `getDecision` вернёт первый попавшийся, а `listDecisions`
 * покажет оба как разные решения. Автоматически удалять дубль нельзя —
 * решение, какая версия актуальна, принимает человек; инструменты лишь
 * сообщают о конфликте.
 *
 * @param entries — записи listDecisions
 * @returns id (в порядке первого появления), встречающиеся >1 раза
 */
export function findDuplicateIds(entries: DecisionEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const id = String(e.decision.id || '').toLowerCase();
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
}

/**
 * Заменяет тело ADR-секции `## <name>` (VL-412).
 *
 * Почему не регулярка по всему телу: `## ` встречается внутри fenced-блоков
 * кода и цитат, и «до следующего `## `» разрезало бы секцию по строке кода.
 * Поэтому идём по строкам, отслеживаем fenced-состояние (``` / ~~~) и
 * считаем заголовком только строку, начинающуюся РОВНО с `## ` (без отступа).
 *
 * Секции нет — она добавляется в каноническом порядке
 * Context → Decision → Consequences → Alternatives (перед первой секцией,
 * которая по порядку идёт позже), а не просто в конец: иначе `## Context`
 * оказался бы после `## Alternatives`.
 *
 * @param body — текущее ADR-тело
 * @param name — имя секции (Context/Decision/Consequences/Alternatives)
 * @param content — новое тело секции (markdown)
 * @returns новое тело
 */
export function replaceDecisionSection(body: string, name: string, content: string): string {
  const lines = String(body ?? '').split('\n');
  const headingRe = /^##\s+(.+?)\s*$/;
  const wanted = name.trim().toLowerCase();

  // Индексы заголовков верхнего уровня (вне fenced-блоков)
  const headings: Array<{ index: number; title: string }> = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1];
      else if (fence === fenceMatch[1]) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = line.match(headingRe);
    if (m) headings.push({ index: i, title: m[1].trim() });
  }

  const newSection = [`## ${name}`, '', ...String(content ?? '').split('\n')];
  const existing = headings.find(h => h.title.toLowerCase() === wanted);

  if (existing) {
    const pos = headings.indexOf(existing);
    const next = headings[pos + 1];
    const end = next ? next.index : lines.length;
    // Хвостовые пустые строки старой секции не сохраняем — их даёт join ниже
    const tail = lines.slice(end);
    const head = lines.slice(0, existing.index);
    const merged = [...head, ...newSection];
    if (tail.length > 0) merged.push('');
    return [...merged, ...tail].join('\n');
  }

  // Секции нет — вставляем в каноническом порядке
  const order = DECISION_SECTIONS.map(s => s.toLowerCase());
  const myPos = order.indexOf(wanted);
  const insertBefore = myPos >= 0
    ? headings.find(h => {
        const p = order.indexOf(h.title.toLowerCase());
        return p > myPos;
      })
    : undefined;

  if (insertBefore) {
    const head = lines.slice(0, insertBefore.index);
    const tail = lines.slice(insertBefore.index);
    const merged = [...head, ...newSection, ''];
    return [...merged, ...tail].join('\n');
  }

  // В конец: отделяем пустой строкой, если тело непустое
  const base = lines.join('\n').replace(/\s+$/, '');
  return base ? `${base}\n\n${newSection.join('\n')}` : newSection.join('\n');
}

/**
 * Точечно обновляет решение (VL-412): статус, заголовок и/или ADR-секции.
 *
 * Тело НЕ перезаписывается целиком: каждая переданная секция заменяется
 * отдельно (`replaceDecisionSection`), остальные остаются как были. Смена
 * `title` переименовывает файл (`decisionFilename`); если файл с новым именем
 * уже существует — отказ (не перезапись чужого решения).
 *
 * @returns результат с фактически изменёнными полями либо null, если id не найден
 * @throws если новый статус вне DECISION_STATUSES или файл-цель переименования занят
 */
export function updateDecision(
  backlogDir: string,
  id: string,
  patch: UpdateDecisionInput
): UpdateDecisionResult | null {
  const entry = getDecision(backlogDir, id);
  if (!entry) return null;

  const changed: string[] = [];
  const decision: Decision = { ...entry.decision };
  let body = entry.body;

  if (patch.status !== undefined) {
    const status = String(patch.status).trim();
    if (!DECISION_STATUSES.includes(status)) {
      throw new Error(
        `Недопустимый статус решения: "${status}". Допустимые: ${DECISION_STATUSES.join(', ')}`
      );
    }
    if (status !== decision.status) {
      decision.status = status;
      changed.push('status');
    }
  }

  if (patch.title !== undefined) {
    const title = String(patch.title).trim();
    if (!title) throw new Error('Пустой title: заголовок решения не может быть пустым');
    if (title !== decision.title) {
      decision.title = title;
      changed.push('title');
    }
  }

  // Секции: имя поля в аргументах → имя заголовка ADR
  const sectionFields: Array<[keyof UpdateDecisionInput, DecisionSection]> = [
    ['context', 'Context'],
    ['decision', 'Decision'],
    ['consequences', 'Consequences'],
    ['alternatives', 'Alternatives'],
  ];
  for (const [field, section] of sectionFields) {
    const value = patch[field];
    if (value === undefined) continue;
    const next = replaceDecisionSection(body, section, String(value));
    if (next !== body) {
      body = next;
      changed.push(field);
    }
  }

  if (changed.length === 0) {
    return { decision, body, path: entry.path, changed };
  }

  const dir = decisionsDir(backlogDir);
  const newPath = join(dir, decisionFilename(decision.id, decision.title));
  if (newPath !== entry.path && existsSync(newPath)) {
    throw new Error(
      `Файл ${decisionFilename(decision.id, decision.title)} уже существует — переименование отменено, чтобы не перезаписать другое решение`
    );
  }

  const frontmatter: Record<string, unknown> = {
    id: decision.id,
    title: decision.title,
    date: decision.date,
    status: decision.status,
  };
  writeFileSync(newPath, serializeFrontmatter(frontmatter, body), 'utf-8');
  if (newPath !== entry.path && existsSync(entry.path)) {
    try { unlinkSync(entry.path); } catch { /* ignore */ }
  }
  return { decision, body, path: newPath, changed };
}

/**
 * Поиск решений: substring по id/title/телу (case-insensitive).
 *
 * Добавлено в VL-412 вместе с группой `decisions` в `globalSearch`: до этого
 * агент не видел архитектурные решения ни в чате, ни в фазах, и мог
 * предложить уже отвергнутый вариант (например, `manifest.json` вместо
 * `installed.lock.json`).
 */
export function searchDecisions(backlogDir: string, query: string): DecisionEntry[] {
  const all = listDecisions(backlogDir);
  if (!query || !query.trim()) return all;

  const q = query.toLowerCase().trim();
  return all.filter(e => {
    if (e.decision.id.toLowerCase().includes(q)) return true;
    if (e.decision.title.toLowerCase().includes(q)) return true;
    if (e.body && e.body.toLowerCase().includes(q)) return true;
    return false;
  });
}

/**
 * Находит решение по id (case-insensitive).
 *
 * При дубле id возвращает ПЕРВЫЙ найденный и помечает запись
 * `ambiguous: true` (VL-412): вызывающий видит, что прочитанное может быть
 * устаревшей версией, и не принимает её за единственную.
 */
export function getDecision(backlogDir: string, id: string): DecisionEntry | null {
  const needle = String(id).toLowerCase();
  const all = listDecisions(backlogDir);
  const found = all.find(e => e.decision.id.toLowerCase() === needle);
  if (!found) return null;
  const duplicates = findDuplicateIds(all);
  if (duplicates.includes(needle)) {
    return { ...found, ambiguous: true };
  }
  return found;
}
