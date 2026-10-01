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
 * Находит решение по id (case-insensitive).
 */
export function getDecision(backlogDir: string, id: string): DecisionEntry | null {
  const needle = String(id).toLowerCase();
  return listDecisions(backlogDir).find(e => e.decision.id.toLowerCase() === needle) || null;
}
