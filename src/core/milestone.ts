/**
 * Модель milestones (вех/релизов) Vibelog.md.
 *
 * Milestone — markdown-файл с YAML-фронтматтером в backlog/milestones/.
 * Поля: name, description, due_date, status (active/archived).
 *
 * Формат файла: backlog/milestones/<name>.md
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { milestonesDir } from './paths.js';

/** Объект milestone. */
export interface Milestone {
  name: string;
  description: string;
  due_date: string;
  status: string;
}

/** Входные данные milestone. */
export interface MilestoneInput {
  name: string;
  description?: string;
  due_date?: string;
  status?: string;
}

/** Опции listMilestones. */
export interface ListMilestonesOpts {
  includeArchived?: boolean;
}

/**
 * Генерирует имя файла milestone (пробелы → дефисы).
 */
export function milestoneFilename(name: string): string {
  const slug = name
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'milestone'}.md`;
}

/**
 * Создаёт объект milestone.
 */
export function createMilestone(input: MilestoneInput): Milestone {
  return {
    name: input.name,
    description: input.description || '',
    due_date: input.due_date || '',
    status: input.status || 'active',
  };
}

/**
 * Сериализует milestone в markdown.
 */
export function milestoneToMarkdown(milestone: Milestone): string {
  const frontmatter: Record<string, unknown> = {
    name: milestone.name,
    description: milestone.description,
    due_date: milestone.due_date,
    status: milestone.status,
  };
  return serializeFrontmatter(frontmatter, '');
}

/**
 * Десериализует markdown в объект milestone.
 */
export function markdownToMilestone(content: string): Milestone {
  const { data } = parseFrontmatter(content);
  return {
    name: (data.name as string) || '',
    description: (data.description as string) || '',
    due_date: (data.due_date as string) || '',
    status: (data.status as string) || 'active',
  };
}

/**
 * Создаёт milestone-файл.
 *
 * @returns созданный milestone
 */
export function writeMilestone(backlogDir: string, input: MilestoneInput): Milestone {
  const dir = milestonesDir(backlogDir);
  mkdirSync(dir, { recursive: true });

  const milestone = createMilestone(input);
  const filename = milestoneFilename(milestone.name);
  const content = milestoneToMarkdown(milestone);
  writeFileSync(join(dir, filename), content, 'utf-8');
  return milestone;
}

/**
 * Читает все milestones из директории.
 *
 * @param opts — includeArchived: включить архивные вехи из backlog/completed/
 */
export function listMilestones(backlogDir: string, opts: ListMilestonesOpts = {}): Milestone[] {
  const entries: string[] = [];
  const dir = milestonesDir(backlogDir);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.md')) entries.push(join(dir, f));
    }
  }

  // Архивные вехи лежат в backlog/completed/ — читаем их по запросу
  if (opts.includeArchived) {
    const completed = join(backlogDir, 'completed');
    if (existsSync(completed)) {
      for (const f of readdirSync(completed)) {
        if (!f.endsWith('.md')) continue;
        const p = join(completed, f);
        const { data } = parseFrontmatter(readFileSync(p, 'utf-8'));
        // В completed/ лежат и задачи: их отличает id/title во фронтматтере
        if (!data.id && !data.title && (data.name || data.due_date || data.description)) {
          entries.push(p);
        }
      }
    }
  }

  return entries.map(p => markdownToMilestone(readFileSync(p, 'utf-8')));
}

/**
 * Находит milestone по имени (case-insensitive).
 */
export function getMilestone(backlogDir: string, name: string): Milestone | null {
  return listMilestones(backlogDir).find(m => m.name.toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Переименовывает milestone.
 *
 * @returns обновлённый milestone или null если не найден
 */
export function renameMilestone(backlogDir: string, from: string, to: string): Milestone | null {
  const dir = milestonesDir(backlogDir);
  const oldMilestone = getMilestone(backlogDir, from);
  if (!oldMilestone) return null;

  const updated = { ...oldMilestone, name: to };
  writeFileSync(join(dir, milestoneFilename(to)), milestoneToMarkdown(updated), 'utf-8');

  // Удаляем старый файл, если имя изменилось
  const oldFile = join(dir, milestoneFilename(from));
  const newFile = join(dir, milestoneFilename(to));
  if (oldFile !== newFile && existsSync(oldFile)) {
    try { unlinkSync(oldFile); } catch { /* ignore */ }
  }
  return updated;
}

/**
 * Удаляет milestone-файл.
 *
 * @returns true если удалён
 */
export function deleteMilestone(backlogDir: string, name: string): boolean {
  const dir = milestonesDir(backlogDir);
  const file = join(dir, milestoneFilename(name));
  if (!existsSync(file)) return false;
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Архивирует milestone (переносит в completed/ со статусом archived).
 *
 * @returns true если архивация удалась
 */
export function archiveMilestone(backlogDir: string, name: string): boolean {
  const dir = milestonesDir(backlogDir);
  const file = join(dir, milestoneFilename(name));
  if (!existsSync(file)) return false;

  const content = readFileSync(file, 'utf-8');
  const milestone = markdownToMilestone(content);
  milestone.status = 'archived';

  const completed = join(backlogDir, 'completed');
  mkdirSync(completed, { recursive: true });
  writeFileSync(join(completed, milestoneFilename(name)), milestoneToMarkdown(milestone), 'utf-8');

  try { unlinkSync(file); } catch { /* ignore */ }
  return true;
}
