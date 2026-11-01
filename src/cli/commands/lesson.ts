/**
 * Команда `vibelog lesson` — управление уроками из задач (VL-153).
 *
 * Подкоманды:
 * - list — список lessons (фильтры --status, --tags)
 * - create <title> — создать lesson (--tags, -d content, --source-tasks)
 * - view <id> — показать lesson
 * - search <query> — поиск по lessons
 * - link <lessonId> <taskId> — двусторонняя связь с задачей (--remove — отвязать)
 * - supersede <oldId> <newId> — пометить oldId как заменённый newId
 * - audit [--write] [--threshold N] [--stale-days N] [--json] — механический
 *   аудит актуальности уроков (VL-279): битые пути, висячие ссылки, дубли,
 *   протухание; --verify/--needs-review — явные правки по списку id
 *
 * Файлы: backlog/lessons/lesson-N-<slug>.md (YAML-фронтматтер + markdown).
 */

import { getFlag, getFlagArray, hasFlag } from '../args.js';
import type { FlagValues } from '../args.js';
import { printSuccess, printError, printInfo } from '../ui.js';
import { findBacklogDir, lessonsDir } from '../../core/paths.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  listLessons, getLesson, createLessonFile,
  searchLessons, linkLesson, supersedeLesson,
} from '../../core/lesson.js';
import {
  auditLessons, applyLessonAudit, formatLessonAuditMarkdown,
} from '../../core/lesson-audit.js';

/**
 * Выполняет команду lesson.
 *
 * @param subcommand — подкоманда (list/create/view/search/link/supersede)
 * @param positional — позиционные аргументы
 * @param flags — флаги CLI
 * @param cwd — рабочая директория (core-функции сами найдут backlog)
 */
export async function runLesson(
  subcommand: string,
  positional: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) {
    printError('Backlog не найден. Выполните: vibelog init');
    process.exitCode = 1;
    return;
  }

  switch (subcommand) {
    case 'list':
      return lessonList(flags, cwd);
    case 'create':
      return lessonCreate(positional, flags, cwd);
    case 'view':
      return lessonView(positional, cwd);
    case 'search':
      return lessonSearch(positional, cwd);
    case 'link':
      return lessonLink(positional, flags, cwd);
    case 'supersede':
      return lessonSupersede(positional, cwd);
    case 'audit':
      return lessonAudit(flags, cwd);
    default:
      printError(`Неизвестная подкоманда: ${subcommand}`);
      printInfo('Доступные: list, create, view, search, link, supersede, audit');
  }
}

function lessonList(flags: FlagValues, cwd: string): void {
  let entries = listLessons(cwd);
  const statusFilter = getFlag(flags, 'status', '');
  if (statusFilter) {
    entries = entries.filter(e => e.lesson.status === statusFilter.toLowerCase());
  }
  const tags = getFlagArray(flags, 'tags')
    .flatMap(t => t.split(',')).map(s => s.trim().toLowerCase()).filter(Boolean);
  if (tags.length > 0) {
    entries = entries.filter(e =>
      tags.every(t => e.lesson.tags.some(rt => String(rt).toLowerCase() === t))
    );
  }
  if (entries.length === 0) {
    printInfo('Lessons нет.');
    return;
  }
  console.log('');
  for (const e of entries) {
    const l = e.lesson;
    const tags2 = l.tags.length ? ` [${l.tags.join(', ')}]` : '';
    const linked = l.linked_tasks.length ? ` → ${l.linked_tasks.join(', ')}` : '';
    const sup = l.supersedes ? ` (заменяет ${l.supersedes})` : '';
    console.log(`  ${l.id}  ${l.title}  (${l.status})${tags2}${linked}${sup}`);
  }
  console.log(`\n  ${entries.length} lessons`);
}

function lessonCreate(positional: string[], flags: FlagValues, cwd: string): void {
  const title = positional.join(' ');
  if (!title) {
    printError('Укажите заголовок: vibelog lesson create <title> [--tags ...] [--source-tasks VL-1,VL-2] [-d desc]');
    return;
  }
  try {
    const tags = getFlagArray(flags, 'tags')
      .flatMap(t => t.split(',')).map(s => s.trim()).filter(Boolean);
    const sourceTasks = getFlagArray(flags, 'source-tasks')
      .flatMap(t => t.split(',')).map(s => s.trim()).filter(Boolean);
    const lesson = createLessonFile(cwd, {
      title,
      tags,
      source_tasks: sourceTasks,
      content: getFlag(flags, 'description', '') || '',
    });
    printSuccess(`Lesson ${lesson.id} создан: ${lesson.title} (${lesson.status})`);
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}

function lessonView(positional: string[], cwd: string): void {
  const id = positional[0];
  if (!id) {
    printError('Укажите ID: vibelog lesson view <id>');
    return;
  }
  const entry = getLesson(cwd, id);
  if (!entry) {
    printError(`Lesson ${id} не найден.`);
    process.exitCode = 1;
    return;
  }
  const l = entry.lesson;
  console.log(`\n${l.id}: ${l.title}`);
  console.log(`  статус: ${l.status} | создан: ${l.created_date} | обновлён: ${l.updated_date}${l.tags.length ? ` | теги: ${l.tags.join(', ')}` : ''}`);
  console.log(`  source_tasks: ${l.source_tasks.length ? l.source_tasks.join(', ') : '(нет)'}`);
  console.log(`  linked_tasks: ${l.linked_tasks.length ? l.linked_tasks.join(', ') : '(нет)'}`);
  if (l.supersedes) console.log(`  заменяет: ${l.supersedes}`);
  console.log(`  файл: ${entry.path}\n`);
  if (entry.body.trim()) {
    console.log(entry.body.trim());
  } else {
    printInfo('(тело пустое)');
  }
}

function lessonSearch(positional: string[], cwd: string): void {
  const query = positional.join(' ');
  if (!query) {
    printError('Укажите запрос: vibelog lesson search <query>');
    return;
  }
  const entries = searchLessons(cwd, query);
  if (entries.length === 0) {
    printInfo(`По запросу "${query}" lessons не найдено.`);
    return;
  }
  console.log(`\nРезультаты поиска "${query}":\n`);
  for (const e of entries) {
    console.log(`  ${e.lesson.id}  ${e.lesson.title}  (${e.lesson.status})`);
  }
  console.log(`\n  ${entries.length} lessons`);
}

function lessonLink(positional: string[], flags: FlagValues, cwd: string): void {
  const [lessonId, taskId] = positional;
  if (!lessonId || !taskId) {
    printError('Укажите ID: vibelog lesson link <lessonId> <taskId> [--remove]');
    return;
  }
  try {
    const action = hasFlag(flags, 'remove') ? 'remove' : 'add';
    linkLesson(cwd, lessonId, taskId, action);
    printSuccess(action === 'add'
      ? `Lesson ${lessonId} связан с задачей ${taskId}.`
      : `Связь Lesson ${lessonId} ↔ задача ${taskId} удалена.`);
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}

function lessonSupersede(positional: string[], cwd: string): void {
  const [oldId, newId] = positional;
  if (!oldId || !newId) {
    printError('Укажите ID: vibelog lesson supersede <oldId> <newId>');
    return;
  }
  try {
    supersedeLesson(cwd, oldId, newId);
    printSuccess(`Lesson ${newId} заменяет ${oldId} (${oldId} → superseded, ${newId} → active).`);
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}

/**
 * `vibelog lesson audit` — механический аудит актуальности (VL-279).
 *
 * Без флагов — только отчёт в stdout (read-only). `--write` дополнительно
 * пишет backlog/lessons/AUDIT.md. Пороги: `--threshold` (дубли, 0..1) и
 * `--stale-days` (протухание), по умолчанию — секция `lessons` настроек.
 * `--json` — машиночитаемый вывод (для CI).
 */
function lessonAudit(flags: FlagValues, cwd: string): void {
  const thresholdRaw = getFlag(flags, 'threshold', '');
  const staleRaw = getFlag(flags, 'stale-days', '');
  const threshold = thresholdRaw ? Number(thresholdRaw) : undefined;
  const staleDays = staleRaw ? Number(staleRaw) : undefined;
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1)) {
    printError('--threshold должен быть числом в диапазоне (0, 1].');
    process.exitCode = 1;
    return;
  }
  if (staleDays !== undefined && (!Number.isFinite(staleDays) || staleDays <= 0)) {
    printError('--stale-days должен быть положительным числом.');
    process.exitCode = 1;
    return;
  }

  try {
    const report = auditLessons(cwd, {
      ...(threshold !== undefined ? { duplicateThreshold: threshold } : {}),
      ...(staleDays !== undefined ? { staleDays } : {}),
    });

    if (hasFlag(flags, 'write')) {
      const backlogDir = findBacklogDir(cwd);
      if (!backlogDir) {
        printError('Backlog не найден. Выполните: vibelog init');
        process.exitCode = 1;
        return;
      }
      const target = join(lessonsDir(backlogDir), 'AUDIT.md');
      writeFileSync(target, formatLessonAuditMarkdown(report), 'utf-8');
      printSuccess(`Отчёт аудита записан: ${target}`);
    }

    if (hasFlag(flags, 'json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`\nАудит lessons: проверено ${report.total}, находок ${report.findings.length}`);
      console.log(`  дубли → порог ${report.config.duplicateThreshold}; протухание → ${report.config.staleDays} дн.\n`);
      for (const [type, count] of Object.entries(report.summary)) {
        console.log(`  ${type}: ${count}`);
      }
      if (report.byLesson.length > 0) {
        console.log('');
        for (const group of report.byLesson) {
          console.log(`  ${group.id} (${group.status}) — ${group.title}`);
          for (const f of group.findings) console.log(`    · ${f.type}: ${f.message}`);
        }
      }
      console.log('');
    }

    // Явные решения по конкретным id — не «массовые правки»: только с флагами
    const verifyIds = getFlagArray(flags, 'verify')
      .flatMap(v => v.split(',')).map(s => s.trim()).filter(Boolean);
    const reviewIds = getFlagArray(flags, 'needs-review')
      .flatMap(v => v.split(',')).map(s => s.trim()).filter(Boolean);
    if (verifyIds.length > 0 || reviewIds.length > 0) {
      const applied = applyLessonAudit(cwd, {
        ...(verifyIds.length > 0 ? { verified: verifyIds } : {}),
        ...(reviewIds.length > 0 ? { needsReview: reviewIds } : {}),
      });
      if (applied.verified.length > 0) {
        printSuccess(`Отмечено проверенными (last_verified, verified_by=auto): ${applied.verified.join(', ')}`);
      }
      if (applied.needsReview.length > 0) {
        printSuccess(`Переведено в needs-review: ${applied.needsReview.join(', ')}`);
      }
      if (applied.notFound.length > 0) {
        printError(`Не найдены: ${applied.notFound.join(', ')}`);
        process.exitCode = 1;
      }
    }
  } catch (err) {
    printError((err as Error).message);
    process.exitCode = 1;
  }
}
