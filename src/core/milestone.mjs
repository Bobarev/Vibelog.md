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
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import { milestonesDir } from './paths.mjs';

/**
 * Генерирует имя файла milestone.
 *
 * @param {string} name — название вехи
 * @returns {string} — имя файла (пробелы → дефисы)
 */
export function milestoneFilename(name) {
  const slug = name
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'milestone'}.md`;
}

/**
 * Создаёт объект milestone.
 *
 * @param {object} input
 * @param {string} input.name
 * @param {string} [input.description]
 * @param {string} [input.due_date]
 * @returns {object}
 */
export function createMilestone(input) {
  return {
    name: input.name,
    description: input.description || '',
    due_date: input.due_date || '',
    status: input.status || 'active',
  };
}

/**
 * Сериализует milestone в markdown.
 *
 * @param {object} milestone
 * @returns {string}
 */
export function milestoneToMarkdown(milestone) {
  const frontmatter = {
    name: milestone.name,
    description: milestone.description,
    due_date: milestone.due_date,
    status: milestone.status,
  };
  return serializeFrontmatter(frontmatter, '');
}

/**
 * Десериализует markdown в объект milestone.
 *
 * @param {string} content
 * @returns {object}
 */
export function markdownToMilestone(content) {
  const { data } = parseFrontmatter(content);
  return {
    name: data.name || '',
    description: data.description || '',
    due_date: data.due_date || '',
    status: data.status || 'active',
  };
}

/**
 * Создаёт milestone-файл.
 *
 * @param {string} backlogDir — путь к backlog/
 * @param {object} input — { name, description, due_date }
 * @returns {object} — созданный milestone
 */
export function writeMilestone(backlogDir, input) {
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
 * @param {string} backlogDir — путь к backlog/
 * @param {object} [opts]
 * @param {boolean} [opts.includeArchived] — включить архивные вехи из backlog/completed/
 * @returns {object[]} — массив milestones
 */
export function listMilestones(backlogDir, opts = {}) {
  const entries = [];
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
 * Находит milestone по имени.
 *
 * @param {string} backlogDir
 * @param {string} name
 * @returns {object|null}
 */
export function getMilestone(backlogDir, name) {
  return listMilestones(backlogDir).find(m => m.name.toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Переименовывает milestone.
 *
 * @param {string} backlogDir
 * @param {string} from — старое имя
 * @param {string} to — новое имя
 * @returns {object|null} — обновлённый milestone
 */
export function renameMilestone(backlogDir, from, to) {
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
 * @param {string} backlogDir
 * @param {string} name
 * @returns {boolean} — true если удалён
 */
export function deleteMilestone(backlogDir, name) {
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
 * Архивирует milestone (переносит в completed/).
 *
 * @param {string} backlogDir
 * @param {string} name
 * @returns {boolean}
 */
export function archiveMilestone(backlogDir, name) {
  const dir = milestonesDir(backlogDir);
  const file = join(dir, milestoneFilename(name));
  if (!existsSync(file)) return false;

  const content = readFileSync(file, 'utf-8');
  const milestone = markdownToMilestone(content);
  milestone.status = 'archived';

  const completedDir = join(backlogDir, 'completed');
  mkdirSync(completedDir, { recursive: true });
  writeFileSync(join(completedDir, milestoneFilename(name)), milestoneToMarkdown(milestone), 'utf-8');

  try { unlinkSync(file); } catch { /* ignore */ }
  return true;
}
