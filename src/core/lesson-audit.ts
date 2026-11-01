/**
 * Аудит актуальности lessons (VL-279) — механические проверки без LLM.
 *
 * Зачем: в backlog/lessons/ сотни уроков, и они подставляются в промпт
 * Plan/Code (`loadLessonsForTask`). Устаревший урок — не мусор, а неверная
 * инструкция модели, но вручную статусы правили единицы раз. Нужен дешёвый
 * детерминированный аудит, который гоняется в CI и не требует модели.
 *
 * Проверки (уровень 1, только механика):
 * - missing_path — путь, упомянутый в теле урока или в applies_to, не
 *   существует в репозитории;
 * - dangling_task — source_tasks/linked_tasks ссылаются на несуществующую задачу;
 * - broken_supersede — supersedes на несуществующий id или на самого себя;
 * - supersede_cycle — цепочка supersedes зациклена;
 * - duplicate_of — пара уроков с похожим заголовком/tags/телом (Jaccard);
 * - stale — урок не связан с живой задачей ИЛИ не проверялся дольше порога.
 *
 * Всё read-only: отчёт строится по текущему состоянию файлов; записи
 * (last_verified, needs-review) делает отдельная функция applyLessonAudit —
 * и только по явному списку id.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';
import { findBacklogDir, tasksDir, completedDir } from './paths.js';
import { listLessons, readLessonSettings, LESSON_DEFAULTS, updateLesson } from './lesson.js';
import type { Lesson, LessonEntry } from './lesson.js';

/** Типы находок аудита. */
export type LessonFindingType =
  | 'missing_path'
  | 'dangling_task'
  | 'broken_supersede'
  | 'supersede_cycle'
  | 'duplicate_of'
  | 'stale';

/** Одна находка аудита: тип, урок и детали (машиночитаемо + текст). */
export interface LessonFinding {
  type: LessonFindingType;
  lessonId: string;
  /** Детали находки: путь, id задачи, пара уроков, степень похожести и т.п. */
  details: Record<string, unknown>;
  /** Человекочитаемое пояснение для отчёта/CLI. */
  message: string;
}

/** Итог аудита: находки по урокам + сводка по типам. */
export interface LessonAuditReport {
  /** Сколько уроков проверено. */
  total: number;
  /** Все находки (плоский список). */
  findings: LessonFinding[];
  /** Счётчик по типам находок. */
  summary: Record<LessonFindingType, number>;
  /** Находки, сгруппированные по уроку (только уроки с находками). */
  byLesson: { id: string; title: string; status: string; findings: LessonFinding[] }[];
  /** Применённые пороги — чтобы отчёт был воспроизводим. */
  config: { duplicateThreshold: number; staleDays: number };
}

/** Опции аудита: переопределение порогов (CLI --threshold) и «сегодня». */
export interface LessonAuditOptions {
  /** Порог схожести дублей (0..1); по умолчанию — настройка/дефолт. */
  duplicateThreshold?: number;
  /** Порог протухания в днях; по умолчанию — настройка/дефолт. */
  staleDays?: number;
  /** Дата «сейчас» (для тестов): ms since epoch. */
  now?: number;
}

/** Префиксы путей репозитория, которые имеет смысл проверять на существование. */
const PATH_PREFIXES = [
  'src/', 'templates/', 'backlog/', 'scripts/', 'test/', 'tests/',
  'docs/', 'bin/',
];

/** Расширения, которые дописываются при проверке пути без расширения. */
const EXTENSION_FALLBACKS = ['.mjs', '.ts', '.md', '.json', '.jsonl', '.tsx', '.css', '.html'];

/** Токены-пути с этими символами — шаблоны/примеры, а не реальные пути. */
const PATH_PLACEHOLDER_RE = /[*?{}<>$|]|\bN\b|\bXXX\b|<|>/;

/**
 * Достаёт из текста урока пути, претендующие на существование в репозитории.
 *
 * Ловим два вида:
 * 1. токены в обратных апостровах (`` `src/core/lesson.ts:396` ``) — основной
 *    способ ссылаться на код в этом корпусе;
 * 2. «голые» упоминания с известным префиксом (`src/…`, `templates/…`, …).
 *
 * Шаблоны (`src/**\/*.ts`), плейсхолдеры (`backlog/tasks/<id>.md`) и обрезки
 * (`src/web/`) отбрасываются: они не утверждают существование конкретного
 * файла, а проверка на них даёт только шум.
 */
export function extractLessonPaths(body: string): string[] {
  const found = new Set<string>();
  const candidates: string[] = [];

  for (const m of String(body || '').matchAll(/`([^`\n]{3,200})`/g)) {
    candidates.push(m[1]);
  }
  for (const m of String(body || '').matchAll(/(?:^|[\s(«"'])((?:src|templates|backlog|scripts|test|tests|docs|bin|refs)\/[^\s)`"'»]+)/g)) {
    candidates.push(m[1]);
  }

  for (const raw of candidates) {
    // Путь с ведущим «файл:строка» и хвостовой пунктуацией — нормализуем
    let path = raw.trim();
    // Отбрасываем суффикс «:12» / «:12-34» (ссылка на строки)
    path = path.replace(/:\d+(-\d+)?$/, '');
    path = path.replace(/[.,;:!?)\]»"']+$/, '');
    if (!path) continue;
    // Не путь: пробелы в середине, флаги CLI, команды
    if (/\s/.test(path)) continue;
    if (!PATH_PREFIXES.some(p => path.startsWith(p))) continue;
    if (PATH_PLACEHOLDER_RE.test(path)) continue;
    // Обрезки каталогов («src/web/» как упоминание папки) не проверяем на
    // существование файла — только полные пути.
    if (!path.includes('/')) continue;
    // Иллюстративные имена («templates/phases/x.md») — пример, а не факт
    // о репозитории: односимвольное имя файла считаем плейсхолдером.
    const base = path.split('/').pop() || '';
    if (/^[a-zA-Zа-яА-Я]\.\w+$/.test(base)) continue;
    found.add(path);
  }

  return [...found].sort();
}

/** Нормализует токены для Jaccard: lowercase, слова длиной ≥3 без стоп-слов. */
const STOP_WORDS = new Set([
  'для', 'что', 'как', 'это', 'если', 'когда', 'или', 'при', 'над', 'под',
  'без', 'через', 'тоже', 'также', 'такие', 'все', 'всех', 'всем', 'еще',
  'уже', 'том', 'этой', 'этих', 'его', 'этого', 'который', 'которая',
  'которые', 'чтобы', 'только', 'может', 'можно', 'нужно', 'быть', 'был',
  'была', 'были', 'есть', 'них', 'нее', 'него', 'себя', 'чем', 'где', 'тот',
  'тем', 'этот', 'она', 'они',
]);

function tokenizeForSimilarity(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t));
}

/** Jaccard по множествам токенов: |A∩B| / |A∪B| (0 при пустом множестве). */
function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const token of setA) if (setB.has(token)) inter += 1;
  return inter / (setA.size + setB.size - inter);
}

/**
 * Степень похожести двух уроков (0..1).
 *
 * Веса подобраны на текущем корпусе (145 уроков): заголовок и tags несут
 * смысл урока, тело — контекст, поэтому 0.4/0.4/0.2. При пороге 0.35
 * детектируются как «не вставляй ID задач в templates» (lesson-107 и
 * lesson-140 с одинаковыми tags — 0.52), так и пары с похожим заголовком.
 */
function similarity(a: LessonEntry, b: LessonEntry): number {
  const titleScore = jaccard(
    tokenizeForSimilarity(a.lesson.title),
    tokenizeForSimilarity(b.lesson.title),
  );
  const tagsScore = jaccard(
    (a.lesson.tags || []).map(t => String(t).toLowerCase()),
    (b.lesson.tags || []).map(t => String(t).toLowerCase()),
  );
  const bodyScore = jaccard(
    tokenizeForSimilarity(a.body),
    tokenizeForSimilarity(b.body),
  );
  return 0.4 * titleScore + 0.4 * tagsScore + 0.2 * bodyScore;
}

/** Множество id задач репозитория (tasks/ + completed/) — без полного парсинга. */
function taskIds(cwd: string): Set<string> {
  const ids = new Set<string>();
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) return ids;
  for (const dir of [tasksDir(backlogDir), completedDir(backlogDir)]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      // Имя файла задачи: "<ID> - <title>.md" / "<ID>.md"
      const m = file.match(/^([A-Za-z]+-\d+)/);
      if (m) ids.add(m[1].toUpperCase());
    }
  }
  return ids;
}

/**
 * Статусы задач: id → status (completed/ считается Done — файл там заморожен).
 *
 * Нужно только для проверки сирот (все source-задачи закрыты): читаем
 * фронтматтер задач, тел не касаемся.
 */
function taskStatuses(cwd: string): Map<string, string> {
  const statuses = new Map<string, string>();
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) return statuses;
  const sources: [string, string | null][] = [
    [tasksDir(backlogDir), null],
    [completedDir(backlogDir), 'Done'],
  ];
  for (const [dir, forced] of sources) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const m = file.match(/^([A-Za-z]+-\d+)/);
      if (!m) continue;
      const id = m[1].toUpperCase();
      if (forced) {
        statuses.set(id, forced);
        continue;
      }
      try {
        const content = readFileSync(join(dir, file), 'utf-8');
        const { data } = parseFrontmatter(content);
        statuses.set(id, String(data.status || ''));
      } catch {
        statuses.set(id, '');
      }
    }
  }
  return statuses;
}

/** Корень проекта: родитель backlog-директории (там лежат src/, templates/). */
function projectRoot(cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  return backlogDir ? dirname(backlogDir) : cwd;
}

/**
 * Проверяет существование пути внутри корня проекта (без выхода наружу).
 *
 * Для backlog-сущностей точное совпадение имени файла слишком строго: файлы
 * задач/уроков называются «VL-254 - <title>.md», «lesson-7-<slug>.md», а
 * уроки ссылаются на них по короткому виду (`backlog/tasks/VL-254.md`).
 * Поэтому при промахе ищем файл с тем же префиксом-ID в каталоге — иначе
 * аудит тонул бы в ложных missing_path (VL-279).
 */
function pathExists(root: string, relPath: string): boolean {
  const normalized = relPath.split('/').join(sep);
  const abs = join(root, normalized);
  if (existsSync(abs)) return true;

  // Путь без расширения или с «расширением»-именем модуля
  // («src/core/reference.test» — ссылка на файл reference.test.mjs):
  // реальный файл имеет .mjs/.ts, поэтому пробуем дописать расширение.
  if (!EXTENSION_FALLBACKS.some(ext => relPath.toLowerCase().endsWith(ext))) {
    for (const ext of EXTENSION_FALLBACKS) {
      if (existsSync(join(root, (relPath + ext).split('/').join(sep)))) return true;
    }
  }

  const m = relPath.match(/^(backlog\/(?:tasks|completed|lessons|docs|decisions)\/)([^/]+?)(?:\.md)?$/);
  if (!m) return false;
  const dirAbs = join(root, m[1].split('/').join(sep));
  if (!existsSync(dirAbs)) return false;
  const needle = m[2].toLowerCase();
  // Префикс-ID: «VL-254» совпадёт с «VL-254 - Заголовок.md», «lesson-7» — с
  // «lesson-7-slug.md»; границей служит « -», «.» или конец имени.
  return readdirSync(dirAbs).some(file => {
    const lower = file.toLowerCase();
    if (!lower.startsWith(needle)) return false;
    const rest = lower.slice(needle.length);
    return rest === '' || rest.startsWith(' -') || rest.startsWith('-') || rest.startsWith('.');
  });
}

/** Сегодняшняя дата YYYY-MM-DD. */
function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Прогоняет механический аудит lessons.
 *
 * Read-only: ни один файл не меняется. Пути в теле урока проверяются
 * относительно корня проекта (родителя backlog/), ссылки на задачи — по
 * фактическим файлам tasks/ и completed/.
 *
 * @param cwd — рабочая директория проекта
 * @param opts — переопределение порогов и «сейчас» (для тестов)
 */
export function auditLessons(cwd: string, opts: LessonAuditOptions = {}): LessonAuditReport {
  const settings = readLessonSettings(cwd);
  const threshold = opts.duplicateThreshold ?? settings.duplicateThreshold;
  const staleDays = opts.staleDays ?? settings.staleDays;
  const now = opts.now ?? Date.now();

  const root = projectRoot(cwd);
  const knownTasks = taskIds(cwd);
  const statuses = taskStatuses(cwd);
  const entries = listLessons(cwd);
  const byId = new Map(entries.map(e => [e.lesson.id.toLowerCase(), e]));

  const findings: LessonFinding[] = [];
  const push = (f: LessonFinding): void => { findings.push(f); };

  const maxAgeMs = staleDays * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    const lesson = entry.lesson;

    // 1. Битые пути: тело урока + applies_to (механически проверяемые пути)
    const bodyPaths = extractLessonPaths(entry.body);
    const appliesPaths = (lesson.applies_to || [])
      .map(p => String(p).trim())
      .filter(Boolean)
      // glob-шаблоны проверяем по статическому префиксу: src/core/*.ts → src/core
      .map(p => p.replace(/[*?{].*$/, '').replace(/\/$/, ''))
      .filter(p => p && !PATH_PLACEHOLDER_RE.test(p));
    for (const path of [...new Set([...bodyPaths, ...appliesPaths])]) {
      if (!path) continue;
      if (pathExists(root, path)) continue;
      push({
        type: 'missing_path',
        lessonId: lesson.id,
        details: { path },
        message: `путь не найден: ${path}`,
      });
    }

    // 2. Ссылки на задачи
    for (const [field, list] of [
      ['source_tasks', lesson.source_tasks || []],
      ['linked_tasks', lesson.linked_tasks || []],
    ] as const) {
      for (const taskId of list) {
        if (knownTasks.has(String(taskId).toUpperCase())) continue;
        push({
          type: 'dangling_task',
          lessonId: lesson.id,
          details: { field, task_id: taskId },
          message: `${field}: задача ${taskId} не найдена`,
        });
      }
    }

    // 3. supersedes: на себя / на несуществующий / цикл
    const target = String(lesson.supersedes || '').trim();
    if (target) {
      if (target.toLowerCase() === lesson.id.toLowerCase()) {
        push({
          type: 'broken_supersede',
          lessonId: lesson.id,
          details: { supersedes: target, reason: 'self' },
          message: `supersedes указывает на самого себя (${target})`,
        });
      } else if (!byId.has(target.toLowerCase())) {
        push({
          type: 'broken_supersede',
          lessonId: lesson.id,
          details: { supersedes: target, reason: 'missing' },
          message: `supersedes: урок ${target} не найден`,
        });
      } else {
        // Цикл: идём по цепочке supersedes до выхода/повтора
        const chain: string[] = [lesson.id.toLowerCase()];
        let cursor = target.toLowerCase();
        while (byId.has(cursor)) {
          if (chain.includes(cursor)) {
            push({
              type: 'supersede_cycle',
              lessonId: lesson.id,
              details: { chain: [...chain, cursor] },
              message: `цикл supersedes: ${[...chain, cursor].join(' → ')}`,
            });
            break;
          }
          chain.push(cursor);
          const next = String(byId.get(cursor)?.lesson.supersedes || '').trim().toLowerCase();
          if (!next) break;
          cursor = next;
        }
      }
    }

    // 4. Сироты и протухание. superseded/outdated — уже помечены, их не трогаем.
    if (lesson.status !== 'superseded' && lesson.status !== 'outdated') {
      const linked = (lesson.linked_tasks || []).filter(Boolean);
      const sources = (lesson.source_tasks || []).filter(Boolean);
      // Сирота: нет linked_tasks И все source-задачи закрыты (Done) или исчезли.
      // Урок без единой source-задачи сиротой не считается: источник мог быть
      // внешним (инцидент, разбор сессии) — иначе свежие уроки шумят в stale.
      const allSourcesClosed = sources.length > 0 && sources.every(id => {
        const status = statuses.get(String(id).toUpperCase());
        return status === undefined || status === 'Done';
      });
      const orphan = linked.length === 0 && allSourcesClosed;
      const stamp = lesson.last_verified || lesson.updated_date || '';
      const stampMs = stamp ? Date.parse(stamp) : NaN;
      const old = !Number.isNaN(stampMs) && now - stampMs > maxAgeMs;
      if (orphan || old) {
        push({
          type: 'stale',
          lessonId: lesson.id,
          details: {
            reason: orphan && old ? ['orphan', 'aged'] : orphan ? 'orphan' : 'aged',
            last_verified: lesson.last_verified || '',
            updated_date: lesson.updated_date || '',
            stale_days: staleDays,
          },
          message: [
            orphan ? 'нет связанных задач (linked_tasks пуст)' : '',
            old ? `не проверялся дольше ${staleDays} дн. (${stamp || 'нет даты'})` : '',
          ].filter(Boolean).join('; '),
        });
      }
    }
  }

  // 5. Дубли: пара уроков со степенью похожести ≥ порога
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      // Заменённые уроки не дублируют: разбираться с ними — задача supersede
      if (a.lesson.status === 'superseded' || b.lesson.status === 'superseded') continue;
      const score = similarity(a, b);
      if (score < threshold) continue;
      const round = Math.round(score * 100) / 100;
      push({
        type: 'duplicate_of',
        lessonId: a.lesson.id,
        details: { other: b.lesson.id, similarity: round, threshold },
        message: `похож на ${b.lesson.id} (${round} ≥ ${threshold})`,
      });
      push({
        type: 'duplicate_of',
        lessonId: b.lesson.id,
        details: { other: a.lesson.id, similarity: round, threshold },
        message: `похож на ${a.lesson.id} (${round} ≥ ${threshold})`,
      });
    }
  }

  const summary: Record<LessonFindingType, number> = {
    missing_path: 0,
    dangling_task: 0,
    broken_supersede: 0,
    supersede_cycle: 0,
    duplicate_of: 0,
    stale: 0,
  };
  for (const f of findings) summary[f.type] += 1;

  const grouped = new Map<string, LessonFinding[]>();
  for (const f of findings) {
    const list = grouped.get(f.lessonId) || [];
    list.push(f);
    grouped.set(f.lessonId, list);
  }

  return {
    total: entries.length,
    findings,
    summary,
    byLesson: [...grouped.entries()].map(([id, list]) => {
      const lesson: Lesson | undefined = byId.get(id.toLowerCase())?.lesson;
      return {
        id,
        title: lesson?.title || '',
        status: lesson?.status || '',
        findings: list,
      };
    }),
    config: { duplicateThreshold: threshold, staleDays },
  };
}

/** Явные действия аудита (VL-279): только по списку id, никогда массово. */
export interface LessonAuditApplyOptions {
  /** Уроки, у которых находки закрываются: last_verified=today, verified_by=auto. */
  verified?: string[];
  /** Уроки, которые надо перевести в needs-review. */
  needsReview?: string[];
  /** Дата отметки (YYYY-MM-DD), по умолчанию — сегодня. */
  date?: string;
  now?: number;
}

/** Результат применения: какие id обновлены, какие не найдены. */
export interface LessonAuditApplyResult {
  verified: string[];
  needsReview: string[];
  notFound: string[];
}

/**
 * Применяет явные решения аудита к урокам (единственная пишущая операция).
 *
 * Вызывается ТОЛЬКО с явным списком id: аудит никогда не правит корпус
 * целиком (иначе один прогон в CI перевёл бы в needs-review половину уроков).
 *
 * @param cwd — рабочая директория проекта
 * @param opts — списки id и дата отметки
 */
export function applyLessonAudit(cwd: string, opts: LessonAuditApplyOptions): LessonAuditApplyResult {
  const date = opts.date || isoDate(opts.now ?? Date.now());
  const result: LessonAuditApplyResult = { verified: [], needsReview: [], notFound: [] };

  for (const id of opts.verified || []) {
    const updated = updateLesson(cwd, id, { last_verified: date, verified_by: 'auto' });
    if (updated) result.verified.push(updated.lesson.id);
    else result.notFound.push(id);
  }
  for (const id of opts.needsReview || []) {
    const updated = updateLesson(cwd, id, { status: 'needs-review' });
    if (updated) result.needsReview.push(updated.lesson.id);
    else result.notFound.push(id);
  }
  return result;
}

/**
 * Рендерит отчёт аудита в markdown для backlog/lessons/AUDIT.md.
 *
 * Структура: сводка по типам + таблица находок (ID/тип/детали). Таблица
 * сортируется по типу, затем по id — диффы в git остаются маленькими.
 */
export function formatLessonAuditMarkdown(report: LessonAuditReport): string {
  const order: LessonFindingType[] = [
    'missing_path', 'dangling_task', 'broken_supersede',
    'supersede_cycle', 'duplicate_of', 'stale',
  ];
  const lines: string[] = [];
  lines.push('# Аудит lessons');
  lines.push('');
  lines.push(`Уроков проверено: ${report.total}. Находок: ${report.findings.length}.`);
  lines.push('');
  lines.push(`Порог дублей: ${report.config.duplicateThreshold}; порог протухания: ${report.config.staleDays} дн.`);
  lines.push('');
  lines.push('## Сводка по типам');
  lines.push('');
  lines.push('| Тип | Находок |');
  lines.push('| --- | --- |');
  for (const type of order) lines.push(`| ${type} | ${report.summary[type] || 0} |`);
  lines.push('');
  lines.push('## Находки');
  lines.push('');
  lines.push('| Lesson | Тип | Детали |');
  lines.push('| --- | --- | --- |');
  const sorted = [...report.findings].sort((a, b) => {
    const byType = order.indexOf(a.type) - order.indexOf(b.type);
    if (byType !== 0) return byType;
    return a.lessonId.localeCompare(b.lessonId, 'ru');
  });
  for (const f of sorted) {
    const details = JSON.stringify(f.details).replace(/\|/g, '\\|');
    lines.push(`| ${f.lessonId} | ${f.type} | ${details} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Дефолты аудита — реэкспорт для CLI/MCP (единый источник значений). */
export { LESSON_DEFAULTS };
