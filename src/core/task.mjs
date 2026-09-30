/**
 * Модель задачи Vibelog.md / Backlog.md.
 *
 * Задача — это markdown-файл с YAML-фронтматтером и телом,
 * разделённым на секции HTML-маркетами.
 *
 * Секции тела:
 * - `<!-- SECTION:DESCRIPTION:BEGIN -->...<!-- SECTION:DESCRIPTION:END -->`
 * - `<!-- AC:BEGIN -->...<!-- AC:END -->`
 * - `<!-- DOD:BEGIN -->...<!-- DOD:END -->`
 * - `<!-- SECTION:PLAN:BEGIN -->...<!-- SECTION:PLAN:END -->`
 * - `<!-- SECTION:NOTES:BEGIN -->...<!-- SECTION:NOTES:END -->`
 * - `<!-- SECTION:FINAL_SUMMARY:BEGIN -->...<!-- SECTION:FINAL_SUMMARY:END -->`
 *
 * AC и DoD — нумерованные чеклисты: `- [ ] #1 Текст`.
 */

import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';

/** Маркеры секций тела задачи */
const SECTION_MARKERS = {
  description: { begin: '<!-- SECTION:DESCRIPTION:BEGIN -->', end: '<!-- SECTION:DESCRIPTION:END -->' },
  ac: { begin: '<!-- AC:BEGIN -->', end: '<!-- AC:END -->' },
  dod: { begin: '<!-- DOD:BEGIN -->', end: '<!-- DOD:END -->' },
  plan: { begin: '<!-- SECTION:PLAN:BEGIN -->', end: '<!-- SECTION:PLAN:END -->' },
  notes: { begin: '<!-- SECTION:NOTES:BEGIN -->', end: '<!-- SECTION:NOTES:END -->' },
  finalSummary: { begin: '<!-- SECTION:FINAL_SUMMARY:BEGIN -->', end: '<!-- SECTION:FINAL_SUMMARY:END -->' },
  comments: { begin: '<!-- COMMENTS:BEGIN -->', end: '<!-- COMMENTS:END -->' },
};

/**
 * Создаёт объект задачи из входных данных.
 *
 * Заполняет поля по умолчанию, генерирует ID если не задан.
 *
 * @param {object} input — входные данные задачи
 * @param {string} input.id — ID задачи (например "LB-1")
 * @param {string} input.title — заголовок
 * @param {string} [input.description] — описание
 * @param {string} [input.status] — статус (по умолчанию из конфига)
 * @param {string} [input.priority] — приоритет
 * @param {string[]} [input.assignee] — исполнители
 * @param {string[]} [input.labels] — метки
 * @param {string[]} [input.dependencies] — зависимости
 * @param {string[]} [input.acceptanceCriteria] — критерии приёмки
 * @param {string[]} [input.definitionOfDone] — критерии Done
 * @param {Record<string, unknown>} config — конфиг проекта
 * @returns {object} — объект задачи
 */
export function createTask(input, config) {
  const now = formatDateTime(new Date());
  return {
    // Frontmatter
    id: input.id,
    title: input.title,
    status: input.status || config.default_status || 'To Do',
    priority: normalizePriority(input.priority),
    assignee: input.assignee || [],
    reporter: input.reporter || '',
    created_date: input.created_date || now,
    updated_date: input.updated_date || now,
    due_date: input.due_date || '',
    labels: input.labels || [],
    dependencies: input.dependencies || [],
    milestone: input.milestone || '',
    type: input.type || '',
    project: input.project || '',
    parent_task_id: input.parent_task_id || '',
    ordinal: input.ordinal || 0,
    references: input.references || [],
    documentation: input.documentation || [],
    modified_files: input.modified_files || [],
    // Тело (секции)
    description: input.description || '',
    acceptanceCriteria: input.acceptanceCriteria || [],
    definitionOfDone: input.definitionOfDone || [],
    implementationPlan: input.implementationPlan || '',
    implementationNotes: input.implementationNotes || '',
    finalSummary: input.finalSummary || '',
    comments: input.comments || [],
  };
}

/**
 * Сериализует объект задачи в markdown-строку.
 *
 * Формат:
 * ```
 * ---
 * id: BACK-1
 * title: Example
 * ...
 * ---
 * ## Description
 * <!-- SECTION:DESCRIPTION:BEGIN -->
 * Описание...
 * <!-- SECTION:DESCRIPTION:END -->
 * ## Acceptance Criteria
 * <!-- AC:BEGIN -->
 * - [ ] #1 Критерий
 * <!-- AC:END -->
 * ...
 * ```
 *
 * @param {object} task — объект задачи
 * @returns {string} — полное содержимое markdown-файла
 */
export function taskToMarkdown(task) {
  // Фронтматтер — полный набор полей, как в оригинале Backlog.md.
  // Пустые массивы пишутся как `[]`, priority — lowercase.
  const frontmatter = {
    id: task.id,
    title: task.title,
    status: task.status,
    assignee: task.assignee || [],
    reporter: task.reporter || '',
    created_date: task.created_date,
    updated_date: task.updated_date,
    due_date: task.due_date || '',
    labels: task.labels || [],
    dependencies: task.dependencies || [],
    milestone: task.milestone || '',
    references: task.references || [],
    priority: task.priority ? task.priority.toLowerCase() : '',
    type: task.type || '',
    project: task.project || '',
    parent_task_id: task.parent_task_id || '',
    ordinal: task.ordinal || 0,
    documentation: task.documentation || [],
    modified_files: task.modified_files || [],
  };

  // Тело — собираем секции
  const sections = [];

  sections.push('## Description');
  sections.push(SECTION_MARKERS.description.begin);
  sections.push(task.description || '');
  sections.push(SECTION_MARKERS.description.end);

  if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
    sections.push('');
    sections.push('## Acceptance Criteria');
    sections.push(SECTION_MARKERS.ac.begin);
    for (let i = 0; i < task.acceptanceCriteria.length; i++) {
      const criterion = task.acceptanceCriteria[i];
      // Сохраняем как есть, если уже содержит `- [ ] #N`
      if (typeof criterion === 'string' && criterion.match(/^- \[[ x]\] #\d+/)) {
        sections.push(criterion);
      } else {
        // Форматируем как нумерованный чеклист
        const checked = typeof criterion === 'object' ? criterion.checked : false;
        const text = typeof criterion === 'object' ? criterion.text : criterion;
        const mark = checked ? 'x' : ' ';
        sections.push(`- [${mark}] #${i + 1} ${text}`);
      }
    }
    sections.push(SECTION_MARKERS.ac.end);
  }

  if (task.definitionOfDone && task.definitionOfDone.length > 0) {
    sections.push('');
    sections.push('## Definition of Done');
    sections.push(SECTION_MARKERS.dod.begin);
    for (let i = 0; i < task.definitionOfDone.length; i++) {
      const criterion = task.definitionOfDone[i];
      if (typeof criterion === 'string' && criterion.match(/^- \[[ x]\] #\d+/)) {
        sections.push(criterion);
      } else {
        const checked = typeof criterion === 'object' ? criterion.checked : false;
        const text = typeof criterion === 'object' ? criterion.text : criterion;
        const mark = checked ? 'x' : ' ';
        sections.push(`- [${mark}] #${i + 1} ${text}`);
      }
    }
    sections.push(SECTION_MARKERS.dod.end);
  }

  if (task.implementationPlan) {
    sections.push('');
    sections.push('## Implementation Plan');
    sections.push(SECTION_MARKERS.plan.begin);
    sections.push(task.implementationPlan);
    sections.push(SECTION_MARKERS.plan.end);
  }

  if (task.implementationNotes) {
    sections.push('');
    sections.push('## Implementation Notes');
    sections.push(SECTION_MARKERS.notes.begin);
    sections.push(task.implementationNotes);
    sections.push(SECTION_MARKERS.notes.end);
  }

  if (task.finalSummary) {
    sections.push('');
    sections.push('## Final Summary');
    sections.push(SECTION_MARKERS.finalSummary.begin);
    sections.push(task.finalSummary);
    sections.push(SECTION_MARKERS.finalSummary.end);
  }

  if (task.comments && task.comments.length > 0) {
    sections.push('');
    sections.push('## Comments');
    sections.push(SECTION_MARKERS.comments.begin);
    for (const comment of task.comments) {
      sections.push(`author: ${comment.author || '@agent'}`);
      sections.push(`created: ${comment.created || formatDateTime(new Date())}`);
      sections.push('---');
      sections.push(comment.text || '');
      sections.push('---');
    }
    sections.push(SECTION_MARKERS.comments.end);
  }

  const body = sections.join('\n');
  return serializeFrontmatter(frontmatter, body);
}

/**
 * Десериализует markdown-строку в объект задачи.
 *
 * @param {string} content — содержимое markdown-файла задачи
 * @returns {object} — объект задачи
 */
export function markdownToTask(content) {
  const { data, body } = parseFrontmatter(content);

  // Извлекаем секции из тела
  const description = extractSection(body, SECTION_MARKERS.description);
  const ac = extractChecklist(body, SECTION_MARKERS.ac);
  const dod = extractChecklist(body, SECTION_MARKERS.dod);
  const plan = extractSection(body, SECTION_MARKERS.plan);
  const notes = extractSection(body, SECTION_MARKERS.notes);
  const finalSummary = extractSection(body, SECTION_MARKERS.finalSummary);
  const comments = extractComments(body, SECTION_MARKERS.comments);

  return {
    // Frontmatter
    id: data.id || '',
    title: data.title || '',
    status: data.status || 'To Do',
    priority: normalizePriority(data.priority),
    assignee: Array.isArray(data.assignee) ? data.assignee : (data.assignee ? [data.assignee] : []),
    reporter: data.reporter || '',
    created_date: data.created_date || '',
    updated_date: data.updated_date || '',
    due_date: data.due_date || '',
    labels: Array.isArray(data.labels) ? data.labels : (data.labels ? [data.labels] : []),
    dependencies: Array.isArray(data.dependencies) ? data.dependencies : (data.dependencies ? [data.dependencies] : []),
    milestone: data.milestone || '',
    type: data.type || '',
    project: data.project || '',
    parent_task_id: data.parent_task_id || '',
    ordinal: data.ordinal || 0,
    references: Array.isArray(data.references) ? data.references : (data.references ? [data.references] : []),
    documentation: Array.isArray(data.documentation) ? data.documentation : (data.documentation ? [data.documentation] : []),
    modified_files: Array.isArray(data.modified_files) ? data.modified_files : (data.modified_files ? [data.modified_files] : []),
    // Тело
    description,
    acceptanceCriteria: ac,
    definitionOfDone: dod,
    implementationPlan: plan,
    implementationNotes: notes,
    finalSummary,
    comments,
  };
}

/**
 * Извлекает текст секции по маркерам BEGIN/END.
 *
 * @param {string} body — тело задачи (markdown)
 * @param {{ begin: string, end: string }} markers — маркеры секции
 * @returns {string} — содержимое секции ( trimmed ), или ''
 */
function extractSection(body, markers) {
  const beginIdx = body.indexOf(markers.begin);
  const endIdx = body.indexOf(markers.end);
  if (beginIdx === -1 || endIdx === -1) return '';
  return body.slice(beginIdx + markers.begin.length, endIdx).trim();
}

/**
 * Извлекает нумерованный чеклист из секции.
 *
 * Формат строк: `- [ ] #1 Текст` или `- [x] #1 Текст`
 *
 * @param {string} body — тело задачи
 * @param {{ begin: string, end: string }} markers — маркеры секции
 * @returns {Array<{text: string, checked: boolean}>} — массив элементов чеклиста
 */
function extractChecklist(body, markers) {
  const section = extractSection(body, markers);
  if (!section) return [];

  const items = [];
  const lines = section.split('\n');
  for (const line of lines) {
    const match = line.match(/^- \[([ x])\] #\d+\s+(.*)/);
    if (match) {
      items.push({
        text: match[2].trim(),
        checked: match[1] === 'x',
      });
    }
  }
  return items;
}

/**
 * Извлекает комментарии из секции.
 *
 * Формат каждого комментария:
 * ```
 * author: @username
 * created: 2026-01-01 12:00
 * ---
 * Текст комментария
 * ---
 * ```
 *
 * @param {string} body — тело задачи
 * @param {{ begin: string, end: string }} markers — маркеры секции
 * @returns {Array<{author: string, created: string, text: string}>} — массив комментариев
 */
function extractComments(body, markers) {
  const section = extractSection(body, markers);
  if (!section) return [];

  const comments = [];
  const lines = section.split('\n');
  let current = null;

  for (const line of lines) {
    // Новый комментарий: author: @username
    const authorMatch = line.match(/^author:\s*(.+)/);
    if (authorMatch) {
      if (current) comments.push(current);
      current = { author: authorMatch[1].trim(), created: '', text: '' };
      continue;
    }

    // Дата комментария
    const createdMatch = line.match(/^created:\s*(.+)/);
    if (createdMatch && current) {
      current.created = createdMatch[1].trim();
      continue;
    }

    // Разделитель --- начинает/заканчивает текст
    if (line.trim() === '---') {
      continue;
    }

    // Текст комментария
    if (current && line.trim()) {
      current.text += (current.text ? '\n' : '') + line;
    }
  }

  if (current) comments.push(current);
  return comments;
}

/**
 * Нормализует приоритет к канонической форме (первая буква заглавная).
 *
 * В файле хранится lowercase (`high`), в API используется `High`.
 *
 * @param {string} raw — приоритет из frontmatter
 * @returns {string}
 */
function normalizePriority(raw) {
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/**
 * Форматирует дату в формате YYYY-MM-DD HH:MM.
 *
 * @param {Date} date
 * @returns {string}
 */
function formatDateTime(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}

/**
 * Генерирует имя файла задачи по формату Backlog.md.
 *
 * @param {object} task — объект задачи
 * @returns {string} — имя файла (например "back-100 - Add-web-server.md")
 */
export function taskFilename(task) {
  // Сохраняем буквы (включая кириллицу), цифры, пробелы и дефисы
  const slug = task.title
    .replace(/[^\p{L}\p{N}\s-]/gu, '') // убираем всё кроме букв, цифр, пробелов, дефисов
    .replace(/\s+/g, '-') // пробелы → дефисы
    .replace(/-+/g, '-') // множественные дефисы → один
    .replace(/^-|-$/g, ''); // убираем дефисы в начале/конце
  return `${task.id} - ${slug || 'task'}.md`;
}
