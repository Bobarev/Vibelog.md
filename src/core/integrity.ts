/**
 * Проверка целостности ссылок задач (VL-342) — детерминированно, без LLM и сети.
 *
 * Зачем: `lesson_audit` (VL-279) механически проверяет целостность уроков, а у
 * самих задач такой проверки не было. `task.references` → `ref-N`,
 * `task.lessons` → `lesson-N`, `dependencies` → задача, `parent_task_id` →
 * задача: прямая правка фронтматтера (руками или агентом через
 * `backlog_update_task`) могла оставить висячий id, и он был невидим —
 * `backlog_view_task` отдаёт id как есть, `lesson_link`/`reference_link`
 * валидируют только свою сторону связи.
 *
 * Границы: только чтение и отчёт. Автоисправления нет, файлы не пишутся.
 *
 * Правила (осознанные решения):
 * - пустое значение (`parent_task_id: ''`, пустые массивы) — НЕ находка:
 *   пустая строка = сброс родителя (VL-69), иначе на 300 задачах шум;
 * - задача из `completed/` считается существующей: закрытая зависимость —
 *   норма, а не битая ссылка;
 * - `self_link` ловится ДО проверки существования, чтобы сообщение было
 *   понятным («задача ссылается на себя»), а не «не найдено»;
 * - id нормализуется `trim()` и сравнивается регистронезависимо: префикс
 *   берётся из данных (`VL`, `BACK`, …), `task_prefix` не хардкодится;
 * - сбой чтения lessons/references не рушит проверку: секция помечается
 *   `sections.* = false`, ссылки этого типа пропускаются.
 */

import { existsSync, readdirSync } from 'node:fs';
import { findBacklogDir, tasksDir, completedDir, lessonsDir, referencesDir } from './paths.js';
import { listTasks } from './store.js';
import { listLessons } from './lesson.js';
import { listReferences } from './reference.js';

/** Типы находок проверки целостности. */
export type IntegrityFindingType =
  | 'dangling_reference'
  | 'dangling_lesson'
  | 'dangling_dependency'
  | 'dangling_parent'
  | 'self_link';

/** Одна находка: тип, задача, висячий id и человекочитаемое пояснение. */
export interface IntegrityFinding {
  type: IntegrityFindingType;
  /** Задача, в чьём фронтматтере найдена ссылка. */
  taskId: string;
  /** Сам висячий id (как записан в файле, после trim). */
  ref: string;
  /** Поле фронтматтера, где встретилась ссылка. */
  field: string;
  /** Человекочитаемое пояснение для CLI/отчёта. */
  message: string;
}

/** Итог проверки: сколько задач проверено, находки и сводка по типам. */
export interface IntegrityReport {
  /** Сколько задач проверено (активные задачи из `backlog/tasks/`). */
  total: number;
  /** Все находки (плоский список). */
  findings: IntegrityFinding[];
  /** Счётчик по типам находок. */
  summary: Record<IntegrityFindingType, number>;
  /**
   * Состояние секций-источников id:
   * - `ok` — прочитано, ссылки этого типа проверялись;
   * - `missing` — каталога нет (lessons/references не используются) —
   *   ссылки этого типа НЕ проверяются, иначе все они стали бы «битыми»;
   * - `error` — чтение упало: отчёт остаётся валидным, но неполным.
   */
  sections: { lessons: SectionState; references: SectionState };
}

/** Состояние секции-источника id (см. IntegrityReport.sections). */
export type SectionState = 'ok' | 'missing' | 'error';

/** Все типы находок в стабильном порядке — для сводки и печати. */
export const INTEGRITY_FINDING_TYPES: IntegrityFindingType[] = [
  'dangling_reference',
  'dangling_lesson',
  'dangling_dependency',
  'dangling_parent',
  'self_link',
];

/** Нормализует id для сравнения: trim + верхний регистр (регистронезависимо). */
function normalizeId(id: unknown): string {
  return String(id ?? '').trim().toUpperCase();
}

/**
 * Множество id задач репозитория: `tasks/` ∪ `completed/`.
 *
 * Читаем имена файлов (`<ID> - <title>.md` / `<ID>.md`), а не фронтматтер:
 * нужен только факт существования, полный парсинг здесь лишний.
 */
function knownTaskIds(cwd: string): Set<string> {
  const ids = new Set<string>();
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) return ids;
  for (const dir of [tasksDir(backlogDir), completedDir(backlogDir)]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const m = file.match(/^([A-Za-z]+-\d+)/);
      if (m) ids.add(m[1].toUpperCase());
    }
  }
  return ids;
}

/** Множество id уроков (нижний регистр) + состояние секции. */
function knownLessonIds(cwd: string): { ids: Set<string> | null; state: SectionState } {
  const backlogDir = findBacklogDir(cwd);
  // Каталога нет — уроки в проекте не используются: проверять нечего,
  // иначе все ссылки на уроки стали бы «битыми» (шум на пустом проекте).
  if (!backlogDir || !existsSync(lessonsDir(backlogDir))) return { ids: null, state: 'missing' };
  try {
    return {
      ids: new Set(listLessons(cwd).map(e => String(e.lesson.id).trim().toLowerCase())),
      state: 'ok',
    };
  } catch {
    return { ids: null, state: 'error' };
  }
}

/** Множество id референсов (нижний регистр) + состояние секции. */
function knownReferenceIds(cwd: string): { ids: Set<string> | null; state: SectionState } {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir || !existsSync(referencesDir(backlogDir))) return { ids: null, state: 'missing' };
  try {
    return {
      ids: new Set(listReferences(cwd).map(e => String(e.reference.id).trim().toLowerCase())),
      state: 'ok',
    };
  } catch {
    return { ids: null, state: 'error' };
  }
}

/**
 * Прогоняет проверку целостности ссылок задач.
 *
 * Read-only: ни один файл не меняется. Один проход по активным задачам
 * (`backlog/tasks/`), множества существующих id собираются заранее —
 * проверка каждой ссылки O(1).
 *
 * @param cwd — рабочая директория проекта
 */
export function checkTaskIntegrity(cwd: string): IntegrityReport {
  const findings: IntegrityFinding[] = [];
  const push = (f: IntegrityFinding): void => { findings.push(f); };

  const taskIds = knownTaskIds(cwd);
  const lessons = knownLessonIds(cwd);
  const references = knownReferenceIds(cwd);
  const lessonIds = lessons.ids;
  const referenceIds = references.ids;

  let tasks: ReturnType<typeof listTasks> = [];
  try {
    tasks = listTasks(cwd);
  } catch {
    tasks = [];
  }

  for (const task of tasks) {
    const selfId = normalizeId(task.id);

    // 1. references → ref-N
    if (referenceIds) {
      for (const raw of task.references || []) {
        const ref = String(raw ?? '').trim();
        if (!ref) continue;
        if (referenceIds.has(ref.toLowerCase())) continue;
        push({
          type: 'dangling_reference',
          taskId: task.id,
          ref,
          field: 'references',
          message: `references: референс ${ref} не найден`,
        });
      }
    }

    // 2. lessons → lesson-N
    if (lessonIds) {
      for (const raw of task.lessons || []) {
        const ref = String(raw ?? '').trim();
        if (!ref) continue;
        if (lessonIds.has(ref.toLowerCase())) continue;
        push({
          type: 'dangling_lesson',
          taskId: task.id,
          ref,
          field: 'lessons',
          message: `lessons: урок ${ref} не найден`,
        });
      }
    }

    // 3. dependencies → задача (self_link ловим ДО проверки существования)
    for (const raw of task.dependencies || []) {
      const ref = String(raw ?? '').trim();
      if (!ref) continue;
      if (normalizeId(ref) === selfId) {
        push({
          type: 'self_link',
          taskId: task.id,
          ref,
          field: 'dependencies',
          message: `dependencies: задача ссылается на себя (${ref})`,
        });
        continue;
      }
      if (taskIds.has(normalizeId(ref))) continue;
      push({
        type: 'dangling_dependency',
        taskId: task.id,
        ref,
        field: 'dependencies',
        message: `dependencies: задача ${ref} не найдена`,
      });
    }

    // 4. parent_task_id → задача; пустая строка — сброс родителя (VL-69)
    const parent = String(task.parent_task_id ?? '').trim();
    if (parent) {
      if (normalizeId(parent) === selfId) {
        push({
          type: 'self_link',
          taskId: task.id,
          ref: parent,
          field: 'parent_task_id',
          message: `parent_task_id: задача ссылается на себя (${parent})`,
        });
      } else if (!taskIds.has(normalizeId(parent))) {
        push({
          type: 'dangling_parent',
          taskId: task.id,
          ref: parent,
          field: 'parent_task_id',
          message: `parent_task_id: задача ${parent} не найдена`,
        });
      }
    }
  }

  const summary = Object.fromEntries(
    INTEGRITY_FINDING_TYPES.map(t => [t, 0]),
  ) as Record<IntegrityFindingType, number>;
  for (const f of findings) summary[f.type] += 1;

  return {
    total: tasks.length,
    findings,
    summary,
    sections: { lessons: lessons.state, references: references.state },
  };
}

/**
 * Алиас `checkTaskIntegrity` под именем из критериев приёмки VL-342
 * (`checkTaskReferences`): одна реализация, два имени — чтобы не плодить
 * копии и не ломать формулировку AC.
 */
export const checkTaskReferences = checkTaskIntegrity;
