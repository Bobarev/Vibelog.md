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

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import { decisionsDir } from './paths.mjs';

/** Статусы из интерфейса оригинала — справочно (CLI original: free-form). */
export const DECISION_STATUSES = ['proposed', 'accepted', 'rejected', 'superseded'];

/**
 * Генерирует имя файла решения: <id>-<slug>.md.
 *
 * @param {string} id
 * @param {string} title
 * @returns {string}
 */
export function decisionFilename(id, title) {
  const slug = String(title || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${id}${slug ? `-${slug}` : ''}.md`;
}

/** Текущая дата YYYY-MM-DD — для date по умолчанию. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Следующий id вида decision-N (max+1).
 *
 * @param {object[]} entries
 * @returns {string}
 */
function nextDecisionId(entries) {
  let max = 0;
  for (const e of entries) {
    const m = String(e.decision.id).match(/^decision-(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `decision-${max + 1}`;
}

/**
 * Собирает ADR-тело из полей.
 *
 * @param {object} input — { context, decision, consequences, alternatives }
 * @returns {string}
 */
function buildBody(input) {
  const sections = [];
  if (input.context) sections.push('## Context', '', input.context);
  if (input.decision) sections.push('## Decision', '', input.decision);
  if (input.consequences) sections.push('## Consequences', '', input.consequences);
  if (input.alternatives) sections.push('## Alternatives', '', input.alternatives);
  return sections.join('\n');
}

/**
 * Создаёт решение-файл (id decision-N, date = сегодня).
 *
 * @param {string} backlogDir
 * @param {object} input — { title, status, context, decision, consequences, alternatives }
 * @returns {object} — созданный решение {id, title, date, status}
 */
export function writeDecision(backlogDir, input) {
  const dir = decisionsDir(backlogDir);
  mkdirSync(dir, { recursive: true });

  const decision = {
    id: nextDecisionId(listDecisions(backlogDir)),
    title: input.title,
    date: input.date || today(),
    status: input.status || 'proposed',
  };
  const frontmatter = {
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
 * @param {string} backlogDir
 * @param {{status?: string}} [opts]
 * @returns {Array<{decision: object, body: string, path: string}>}
 */
export function listDecisions(backlogDir, opts = {}) {
  const dir = decisionsDir(backlogDir);
  if (!existsSync(dir)) return [];

  let entries = readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const path = join(dir, f);
      const { data, body } = parseFrontmatter(readFileSync(path, 'utf-8'));
      return {
        decision: {
          id: data.id || '',
          title: data.title || '',
          date: data.date || '',
          status: data.status || 'proposed',
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
 * Находит решение по id (case-insensitive).
 *
 * @param {string} backlogDir
 * @param {string} id
 * @returns {{decision: object, body: string, path: string}|null}
 */
export function getDecision(backlogDir, id) {
  const needle = String(id).toLowerCase();
  return listDecisions(backlogDir).find(e => e.decision.id.toLowerCase() === needle) || null;
}
