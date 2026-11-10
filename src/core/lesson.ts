/**
 * Модель lessons learned (VL-153) — уроки, извлечённые из закрытых задач.
 *
 * Lesson — markdown-файл с YAML-фронтматтером в backlog/lessons/.
 * Поля: id (lesson-N), title, status (active|outdated|superseded), tags[],
 * source_tasks[] (откуда урок), linked_tasks[] (где применялся),
 * created_date, updated_date, supersedes (id заменённого lesson или '' — нет).
 * Тело — markdown (Проблема / Решение / Пример / Связь с задачами).
 *
 * Отличие от других сущностей:
 * - References (VL-152) — внешние источники (URL, репозитории);
 * - Decisions — архитектурные решения (почему X, не Y);
 * - Docs — документация проекта;
 * - Lessons — workflow-уроки из опыта задач; эволюционируют (устаревают,
 *   объединяются через supersede), поэтому живут отдельно от замороженных
 *   задач Done.
 *
 * Расширение формата Vibelog.md: Backlog.md не знает про lessons и
 * игнорирует директорию backlog/lessons/ — round-trip сохраняется.
 *
 * Формат файла: backlog/lessons/lesson-N-<slug>.md
 */

import {
  readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { findBacklogDir, lessonsDir } from './paths.js';
import { getTask, updateTaskFile } from './store.js';
import { loadSettings } from './settings.js';
// VL-400: recall по смыслу задачи переиспользует токенизацию и минимальную
// морфологию поиска задач (tokenizeQuery/stemToken) — вторая копия правил
// разъехалась бы с searchTasksRanked (lesson-37: общий модуль вместо копий).
// Циклический импорт безопасен: search.ts тянет из lesson.ts только функцию
// searchLessons, а обе стороны объявлены function-декларациями (hoisted).
import { tokenizeQuery, stemToken } from './search.js';

/** Допустимые статусы lesson. */
export const LESSON_STATUSES = ['active', 'needs-review', 'outdated', 'superseded'];

/** Допустимые значения поля verified_by (VL-279). */
export const LESSON_VERIFIERS = ['auto', 'agent', 'human'];

/** Допустимые значения поля kind (VL-279). */
export const LESSON_KINDS = ['rule', 'workaround', 'fact'];

/**
 * Значения kind по умолчанию для решения задач аудита (VL-279):
 * порог схожести дублей, срок актуальности урока и кап подстановки.
 *
 * Живут в коде, а не в конфиге, потому что нужны и без .vibelog/settings.json
 * (чистый клон репозитория, CI). Переопределяются секцией `lessons` настроек.
 */
export const LESSON_DEFAULTS = {
  /** Порог схожести пары lessons (Jaccard по title/tags/body) для duplicate_of. */
  duplicateThreshold: 0.35,
  /** Сколько дней урок считается актуальным без last_verified/updated_date. */
  staleDays: 180,
  /** Максимум lessons, подставляемых в промпт фазы (loadLessonsForTask). */
  promptLimit: 5,
  /**
   * VL-280: максимум задач техдолга за один вызов lesson_classify.
   * 1 по умолчанию — создание задач подтверждается вручную, и «пачка из
   * 40 задач» не должна появляться от одной опечатки в аргументах.
   */
  techDebtMaxTasks: 1,
};

/**
 * Дефолты блока «Уроки проекта» в веб-чате (VL-404, секция `chat_lessons`).
 *
 * Отдельная секция, а не `lessons`: у чата другой бюджет промпта (память
 * персоны + контекст поиска) и другой сигнал — последние сообщения треда,
 * а не задача. Поэтому и лимиты независимые.
 */
export const CHAT_LESSON_DEFAULTS = {
  /** Выключатель блока целиком. */
  enabled: true,
  /** Сколько последних user-сообщений треда брать как запрос. */
  maxMessages: 3,
  /** Сколько уроков подставлять (дополнительно капится lessons.prompt_limit). */
  limit: 3,
};

/** Настройки блока «Уроки проекта» в веб-чате (VL-404). */
export interface ChatLessonSettings {
  enabled: boolean;
  maxMessages: number;
  limit: number;
}

/** Настройки аудита/подстановки lessons (секция `lessons` settings.json). */
export interface LessonSettings {
  duplicateThreshold: number;
  staleDays: number;
  promptLimit: number;
  /** VL-280: лимит задач техдолга, создаваемых за вызов. */
  techDebtMaxTasks: number;
  /** VL-404: блок «Уроки проекта» в веб-чате (секция `chat_lessons`). */
  chatLessons: ChatLessonSettings;
}

/**
 * Читает секцию `lessons` настроек и накладывает её на LESSON_DEFAULTS.
 *
 * Битые значения (не число, отрицательное, 0) игнорируются — настройка
 * не должна ломать ни аудит, ни подстановку уроков в промпт: лучше дефолт.
 *
 * @param cwd — рабочая директория (корень проекта с .vibelog/settings.json)
 */
export function readLessonSettings(cwd: string): LessonSettings {
  // chatLessons копируем отдельно: поверхностный spread оставил бы ссылку на
  // объект дефолтов, и мутация настроек одного вызова правила бы все.
  const result: LessonSettings = { ...LESSON_DEFAULTS, chatLessons: { ...CHAT_LESSON_DEFAULTS } };
  let raw: unknown;
  try {
    raw = loadSettings(cwd).lessons;
  } catch {
    return result;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  const section = raw as Record<string, unknown>;
  const pick = (key: 'duplicateThreshold' | 'staleDays' | 'promptLimit' | 'techDebtMaxTasks', prop: string): void => {
    const value = Number(section[prop]);
    if (Number.isFinite(value) && value > 0) result[key] = value;
  };
  pick('duplicateThreshold', 'duplicate_threshold');
  pick('staleDays', 'stale_days');
  pick('promptLimit', 'prompt_limit');
  // VL-280: лимит задач техдолга за вызов (дробное вниз, минимум 1)
  pick('techDebtMaxTasks', 'tech_debt_max_tasks');
  // Порог — доля [0..1]; после наложения настроек приводим к допустимому диапазону
  if (result.duplicateThreshold > 1) result.duplicateThreshold = LESSON_DEFAULTS.duplicateThreshold;
  result.promptLimit = Math.floor(result.promptLimit);
  result.staleDays = Math.floor(result.staleDays);
  result.techDebtMaxTasks = Math.max(1, Math.floor(result.techDebtMaxTasks));
  result.chatLessons = readChatLessonSettings(cwd);
  return result;
}

/**
 * Читает секцию `chat_lessons` настроек (VL-404) — блок «Уроки проекта» в
 * веб-чате.
 *
 * Битые значения не роняют чат (паттерн readLessonSettings/readPersonaMemoryLimit):
 * берётся дефолт, а в `errors` попадает понятное сообщение. `enabled`
 * принимает только boolean — строка «false» не должна молча включать блок.
 *
 * @param errors — необязательный аккумулятор предупреждений
 */
export function readChatLessonSettings(cwd: string, errors?: string[]): ChatLessonSettings {
  const result: ChatLessonSettings = { ...CHAT_LESSON_DEFAULTS };
  let raw: unknown;
  try {
    raw = loadSettings(cwd).chat_lessons;
  } catch {
    return result;
  }
  if (raw === undefined) return result;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors?.push('settings.json: секция chat_lessons должна быть объектом {enabled, max_messages, limit}');
    return result;
  }
  const section = raw as Record<string, unknown>;
  if (section.enabled !== undefined) {
    if (typeof section.enabled === 'boolean') {
      result.enabled = section.enabled;
    } else {
      errors?.push(
        `settings.json: chat_lessons.enabled должен быть true/false (получено ${JSON.stringify(section.enabled)}) — используется дефолт ${CHAT_LESSON_DEFAULTS.enabled}`,
      );
    }
  }
  const pickNum = (key: 'maxMessages' | 'limit', prop: string): void => {
    const value = section[prop];
    if (value === undefined) return;
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      result[key] = Math.floor(num);
      return;
    }
    errors?.push(
      `settings.json: chat_lessons.${prop} должен быть положительным числом (получено ${JSON.stringify(value)}) — используется дефолт ${CHAT_LESSON_DEFAULTS[key]}`,
    );
  };
  pickNum('maxMessages', 'max_messages');
  pickNum('limit', 'limit');
  return result;
}

/** Объект lesson (метаданные; тело — отдельно в LessonEntry). */
export interface Lesson {
  id: string;
  title: string;
  status: string;
  tags: string[];
  source_tasks: string[];
  linked_tasks: string[];
  created_date: string;
  updated_date: string;
  /** id заменённого lesson ('' — не заменяет ничего). */
  supersedes: string;
  // VL-279: additive-поля аудита. Пустая строка / null — «не задано»:
  // старые файлы без этих ключей читаются без ошибок.
  /** Дата последней проверки актуальности (YYYY-MM-DD) или ''. */
  last_verified: string;
  /** Кто проверил: auto|agent|human ('' — не задано). */
  verified_by: string;
  /** Glob-пути/имена символов, которые валидируются механически. */
  applies_to: string[];
  /** Тип урока: rule|workaround|fact (null — не классифицирован). */
  kind: string | null;
}

/** Входные данные lesson. */
export interface LessonInput {
  id?: string;
  title: string;
  status?: string;
  tags?: string[];
  source_tasks?: string[];
  linked_tasks?: string[];
  created_date?: string;
  updated_date?: string;
  supersedes?: string;
  /** VL-279: дата последней проверки актуальности (YYYY-MM-DD). */
  last_verified?: string;
  /** VL-279: кто проверил — auto|agent|human. */
  verified_by?: string;
  /** VL-279: glob-пути/имена символов для механической проверки. */
  applies_to?: string[];
  /** VL-279: тип урока — rule|workaround|fact (null/'' — не задан). */
  kind?: string | null;
}

/** Запись lesson: метаданные + тело + путь к файлу. */
export interface LessonEntry {
  lesson: Lesson;
  body: string;
  path: string;
}

/**
 * Ищет backlog-директорию или бросает понятную ошибку.
 * (findBacklogDir возвращает null — все операции lessons требуют backlog.)
 */
function requireBacklogDir(cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  if (!backlogDir) throw new Error('Backlog не найден. Выполните: vibelog init');
  return backlogDir;
}

/** Текущая дата YYYY-MM-DD — для created_date/updated_date по умолчанию. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Нормализует статус lesson (проверка по LESSON_STATUSES).
 *
 * @throws если статус не входит в LESSON_STATUSES
 */
export function normalizeLessonStatus(status: string): string {
  const candidate = String(status || '').toLowerCase();
  if (!LESSON_STATUSES.includes(candidate)) {
    throw new Error(`Недопустимый статус lesson "${status}". Допустимые: ${LESSON_STATUSES.join(', ')}`);
  }
  return candidate;
}

/**
 * Генерирует имя файла lesson: lesson-N-<slug>.md.
 *
 * @param id — id lesson (lesson-N)
 * @param title — заголовок (источник slug)
 */
export function lessonFilename(id: string, title: string): string {
  const slug = String(title || '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${id}${slug ? `-${slug}` : ''}.md`;
}

/**
 * Создаёт объект lesson (валидирует status).
 */
export function createLesson(input: LessonInput): Lesson {
  return {
    id: input.id || '',
    title: input.title,
    status: normalizeLessonStatus(input.status || 'active'),
    tags: input.tags || [],
    source_tasks: input.source_tasks || [],
    linked_tasks: input.linked_tasks || [],
    created_date: input.created_date || '',
    updated_date: input.updated_date || '',
    supersedes: input.supersedes || '',
    last_verified: input.last_verified || '',
    verified_by: input.verified_by || '',
    applies_to: input.applies_to || [],
    kind: input.kind || null,
  };
}

/**
 * Сериализует lesson + тело в markdown.
 *
 * supersedes пустой → поле пишется как '' (пустая строка, не null) —
 * парсинг обратно даёт ''.
 *
 * VL-279: новые поля (last_verified/verified_by/applies_to/kind) пишутся
 * всегда — '' / [] / null. Так файл, прошедший через update, сразу получает
 * явный вид полей (аудит опирается на наличие ключа) и round-trip остаётся
 * точным: markdownToLesson(lessonToMarkdown(l)) === l.
 */
export function lessonToMarkdown(lesson: Lesson, body?: string): string {
  const frontmatter: Record<string, unknown> = {
    id: lesson.id,
    title: lesson.title,
    status: lesson.status,
    tags: lesson.tags || [],
    source_tasks: lesson.source_tasks || [],
    linked_tasks: lesson.linked_tasks || [],
    created_date: lesson.created_date,
    updated_date: lesson.updated_date,
    supersedes: lesson.supersedes || '',
    last_verified: lesson.last_verified || '',
    verified_by: lesson.verified_by || '',
    applies_to: lesson.applies_to || [],
    kind: lesson.kind || null,
  };
  return serializeFrontmatter(frontmatter, body || '');
}

/** Нормализует поле-массив из frontmatter (строка → [строка], иначе []). */
function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (value) return [value as string];
  return [];
}

/**
 * Десериализует markdown в lesson + тело.
 */
export function markdownToLesson(content: string): { lesson: Lesson; body: string } {
  const { data, body } = parseFrontmatter(content);
  // VL-279: поля добавлены additive — старые файлы без ключей читаются с
  // дефолтами ('' / [] / null). kind нормализуется в нижний регистр и
  // отбрасывается, если значение вне LESSON_KINDS (битый фронтматтер не
  // должен ронять listLessons).
  const rawKind = data.kind === null || data.kind === undefined ? '' : String(data.kind).toLowerCase();
  return {
    lesson: {
      id: (data.id as string) || '',
      title: (data.title as string) || '',
      status: (data.status as string) || 'active',
      tags: toArray(data.tags),
      source_tasks: toArray(data.source_tasks),
      linked_tasks: toArray(data.linked_tasks),
      created_date: (data.created_date as string) || '',
      updated_date: (data.updated_date as string) || '',
      supersedes: (data.supersedes as string) || '',
      last_verified: (data.last_verified as string) || '',
      verified_by: (data.verified_by as string) || '',
      applies_to: toArray(data.applies_to),
      kind: LESSON_KINDS.includes(rawKind) ? rawKind : null,
    },
    body: body || '',
  };
}

/**
 * Следующий id вида lesson-N (max+1).
 */
function nextLessonId(entries: LessonEntry[]): string {
  let max = 0;
  for (const e of entries) {
    const m = String(e.lesson.id).match(/^lesson-(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `lesson-${max + 1}`;
}

/**
 * Читает все lessons из backlog/lessons/.
 *
 * Файлы без id и с битым YAML пропускаются — один сломанный файл не должен
 * ронять чтение остальных.
 */
export function listLessons(cwd: string): LessonEntry[] {
  const backlogDir = requireBacklogDir(cwd);
  const dir = lessonsDir(backlogDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.md'))
    .map(d => {
      const path = join(dir, d.name);
      try {
        const { lesson, body } = markdownToLesson(readFileSync(path, 'utf-8'));
        return { lesson, body, path };
      } catch {
        return null;
      }
    })
    // Пропускаем файлы без id (посторонние markdown в lessons/)
    .filter((e): e is LessonEntry => e !== null && Boolean(e.lesson.id));
}

/**
 * Находит lesson по id (case-insensitive).
 */
export function getLesson(cwd: string, id: string): LessonEntry | null {
  const needle = String(id).toLowerCase();
  return listLessons(cwd).find(e => e.lesson.id.toLowerCase() === needle) || null;
}

/** Вход createLessonFile: метаданные + markdown-тело. */
export interface WriteLessonInput extends LessonInput {
  content?: string;
}

/**
 * Скелет тела урока (VL-319).
 *
 * Зачем: шаблоны Close вызывали `lesson_create` без `content`, и
 * `createLessonFile` писал пустое тело — рождались уроки-пустышки (lesson-191),
 * которые потом нельзя было «дополнить» через `lesson_update` без явного
 * `content` (noop → повтор → кап → fail → авто-resume, сессия
 * agent-1793712738536). Скелет даёт осмысленную структуру и CLI
 * (`vibelog lesson create` без `-d`), и MCP-вызову без `content`.
 */
export const LESSON_BODY_SKELETON = '## Проблема\n\n## Решение\n\n## Пример\n';

/**
 * Тело урока не заполнено по смыслу (VL-349).
 *
 * Два состояния: пусто/пробелы И тело, равное скелету `LESSON_BODY_SKELETON`.
 * Второе появилось после VL-319: `createLessonFile` подставляет скелет, и
 * урок-заглушка перестал отличаться от заполненного по проверке `trim() === ''`.
 * Из-за этого `lesson_update` без `content` уходил в noop вместо ошибки
 * (сессия agent-1794045441657: 4 повтора → кап → fail).
 *
 * Единственная точка правды: этим предикатом обязаны пользоваться
 * `toolLessonUpdate`, `toolLessonCreate` и audit-finding `empty_body`.
 * Нормализация — `trim()` с обеих сторон: скелет оканчивается `\n`, файл может
 * быть перезаписан без него (или с CRLF-хвостами).
 */
export function isLessonBodyUnfilled(body: string | undefined | null): boolean {
  const text = String(body ?? '').trim();
  if (text === '') return true;
  return text === LESSON_BODY_SKELETON.trim();
}

/**
 * Создаёт lesson-файл (id генерируется lesson-N, даты — сегодня, если не заданы).
 *
 * VL-319: пустой/пробельный `content` заменяется скелетом
 * `LESSON_BODY_SKELETON` — урок без тела не создаётся «пустым», но создаётся
 * со скелетом. VL-356: это единственное поведение и для MCP-пути (жёсткий
 * отказ VL-349 замыкал петлю: урок не создан → привязать нечего → модель
 * повторяла вызов до капа); о незаполненном теле сообщают `missing`/`hint`,
 * а контроль «склада пустышек» — finding `empty_body` в `lesson_audit`.
 *
 * @returns созданный lesson
 */
export function createLessonFile(cwd: string, input: WriteLessonInput): Lesson {
  const backlogDir = requireBacklogDir(cwd);
  const dir = lessonsDir(backlogDir);
  mkdirSync(dir, { recursive: true });

  const entries = listLessons(cwd);
  const todayStr = today();
  const lesson = createLesson({
    ...input,
    id: input.id || nextLessonId(entries),
    created_date: input.created_date || todayStr,
    updated_date: input.updated_date || todayStr,
  });
  const body = String(input.content ?? '').trim() === '' ? LESSON_BODY_SKELETON : String(input.content);
  writeFileSync(
    join(dir, lessonFilename(lesson.id, lesson.title)),
    lessonToMarkdown(lesson, body),
    'utf-8',
  );
  return lesson;
}

/** Обновляемые поля lesson. */
export interface UpdateLessonInput {
  title?: string;
  status?: string;
  tags?: string[];
  source_tasks?: string[];
  linked_tasks?: string[];
  supersedes?: string;
  content?: string;
  // VL-279: поля аудита
  last_verified?: string;
  verified_by?: string;
  applies_to?: string[];
  kind?: string | null;
}

/**
 * Обновляет lesson: поля и/или тело. При смене title файл переименовывается.
 * updated_date всегда обновляется на сегодня.
 *
 * @returns обновлённая запись или null если не найден
 */
export function updateLesson(
  cwd: string,
  id: string,
  updates: UpdateLessonInput
): LessonEntry | null {
  const backlogDir = requireBacklogDir(cwd);
  const entry = getLesson(cwd, id);
  if (!entry) return null;

  const merged: Lesson = {
    ...entry.lesson,
    title: updates.title !== undefined ? updates.title : entry.lesson.title,
    status: updates.status !== undefined ? normalizeLessonStatus(updates.status) : entry.lesson.status,
    tags: updates.tags !== undefined ? updates.tags : entry.lesson.tags,
    source_tasks: updates.source_tasks !== undefined ? updates.source_tasks : entry.lesson.source_tasks,
    linked_tasks: updates.linked_tasks !== undefined ? updates.linked_tasks : entry.lesson.linked_tasks,
    supersedes: updates.supersedes !== undefined ? updates.supersedes : entry.lesson.supersedes,
    // VL-279: поля аудита — additive, передаются только при явном запросе
    last_verified: updates.last_verified !== undefined ? updates.last_verified : entry.lesson.last_verified,
    verified_by: updates.verified_by !== undefined ? updates.verified_by : entry.lesson.verified_by,
    applies_to: updates.applies_to !== undefined ? updates.applies_to : entry.lesson.applies_to,
    kind: updates.kind !== undefined ? (updates.kind || null) : entry.lesson.kind,
    updated_date: today(),
  };
  const body = updates.content !== undefined ? updates.content : entry.body;

  // Старый файл удаляется, новый пишется под новым именем (при смене title).
  const dir = lessonsDir(backlogDir);
  const newPath = join(dir, lessonFilename(merged.id, merged.title));
  writeFileSync(newPath, lessonToMarkdown(merged, body), 'utf-8');
  if (entry.path !== newPath && existsSync(entry.path)) {
    unlinkSync(entry.path);
  }
  return { lesson: merged, body, path: newPath };
}

/**
 * Ищет lessons по запросу (substring по id/title/tags/телу).
 *
 * @param query — поисковый запрос; пустой → все lessons
 */
export function searchLessons(cwd: string, query: string): LessonEntry[] {
  const all = listLessons(cwd);
  if (!query || !query.trim()) return all;

  const q = query.toLowerCase().trim();
  return all.filter(e => {
    const l = e.lesson;
    if (l.id.toLowerCase().includes(q)) return true;
    if (l.title.toLowerCase().includes(q)) return true;
    if (l.tags.some(t => String(t).toLowerCase().includes(q))) return true;
    if (e.body && e.body.toLowerCase().includes(q)) return true;
    return false;
  });
}

/**
 * Двусторонняя связь lesson ↔ задача (VL-153).
 *
 * action=add:    lesson.linked_tasks += taskId; task.lessons += lessonId
 * action=remove: из обоих списков удаляется
 *
 * Идемпотентно: повторное add не дублирует, remove отсутствующего — no-op.
 *
 * @throws если lesson или задача не найдены
 */
export function linkLesson(
  cwd: string,
  lessonId: string,
  taskId: string,
  action: 'add' | 'remove' = 'add'
): boolean {
  const entry = getLesson(cwd, lessonId);
  if (!entry) throw new Error(`Lesson ${lessonId} не найден.`);
  const task = getTask(cwd, taskId);
  if (!task) throw new Error(`Задача ${taskId} не найдена.`);

  const linked = new Set(entry.lesson.linked_tasks || []);
  const taskLessons = new Set(task.lessons || []);
  if (action === 'add') {
    linked.add(taskId);
    taskLessons.add(lessonId);
  } else {
    linked.delete(taskId);
    taskLessons.delete(lessonId);
  }

  updateLesson(cwd, entry.lesson.id, { linked_tasks: [...linked] });
  updateTaskFile(cwd, task.id, { lessons: [...taskLessons] });
  return true;
}

/**
 * Помечает lesson newId как заменяющий oldId (VL-153).
 *
 * Новый lesson: supersedes=oldId, status=active (если был не active).
 * Старый lesson: status='superseded'.
 * Оба updated_date → сегодня.
 *
 * @throws если любой из lessons не найден
 */
export function supersedeLesson(cwd: string, oldId: string, newId: string): void {
  if (String(oldId).toLowerCase() === String(newId).toLowerCase()) {
    throw new Error('Lesson не может заменять сам себя: oldId и newId совпадают.');
  }
  const oldEntry = getLesson(cwd, oldId);
  if (!oldEntry) throw new Error(`Lesson ${oldId} не найден.`);
  const newEntry = getLesson(cwd, newId);
  if (!newEntry) throw new Error(`Lesson ${newId} не найден.`);

  // Старый lesson уходит в superseded, новый становится active с supersedes
  updateLesson(cwd, oldEntry.lesson.id, { status: 'superseded' });
  updateLesson(cwd, newEntry.lesson.id, { status: 'active', supersedes: oldEntry.lesson.id });
}

/**
 * Веса полей при оценке релевантности урока задаче (VL-400).
 *
 * И-логика (как в `searchTasksRanked`) здесь не нужна: урок про «worktree»
 * полезен задаче про worktree даже без совпадения всех токенов. Поэтому —
 * сумма весов, а не фильтр. title/applies_to весят больше тела: заголовок
 * урока и есть сформулированное правило.
 */
const LESSON_FIELD_WEIGHTS = {
  title: 3,
  tags: 2,
  appliesTo: 2,
  body: 1,
} as const;

/**
 * Множитель score для урока, чей `applies_to` не пересекается с путями задачи
 * (VL-400). Не 0 и не отбрасывание: на фазе Plan план ещё пуст, и жёсткий
 * фильтр выкинул бы все уроки с applies_to.
 */
const APPLIES_TO_MISMATCH_FACTOR = 0.5;

/** Префиксы путей репозитория, которые имеет смысл искать в тексте задачи. */
const TASK_PATH_RE = /(?:^|[\s(`"'])((?:src|templates|backlog|scripts|test|tests|docs|bin|web|refs)\/[^\s)`"'»,;]+)/g;

/**
 * Достаёт из текста задачи пути репозитория (план + modified_files).
 *
 * Нужно для сверки с `applies_to` урока: если урок привязан к `src/core/*.ts`,
 * а задача трогает `src/web/`, урок менее релевантен.
 *
 * @param text — склеенный текст (implementationPlan + modified_files)
 */
export function extractTaskPaths(text: string): string[] {
  const found = new Set<string>();
  for (const m of String(text || '').matchAll(TASK_PATH_RE)) {
    const path = m[1].replace(/[.,;:!?)\]»"']+$/, '');
    if (path) found.add(path);
  }
  return [...found];
}

/**
 * Проверяет, пересекается ли glob урока с путём задачи.
 *
 * Минимальный матчер без зависимостей: `**` → любая последовательность,
 * `*` → всё кроме `/`, `?` → один символ. Glob без wildcard'ов сравнивается
 * как префикс пути (урок про `src/core/lesson.ts` релевантен задаче, которая
 * правит `src/core/lesson.ts`).
 *
 * @param glob — шаблон из applies_to
 * @param path — путь из плана/описания задачи
 */
export function globMatchesPath(glob: string, path: string): boolean {
  const pattern = String(glob || '').trim();
  const target = String(path || '').trim();
  if (!pattern || !target) return false;
  if (!/[*?]/.test(pattern)) {
    return target === pattern || target.startsWith(`${pattern}/`) || pattern.startsWith(`${target}/`);
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '.');
  try {
    return new RegExp(`^${escaped}$`).test(target);
  } catch {
    return false;
  }
}

/**
 * Считает релевантность урока задаче (VL-400) — чистая функция, экспорт для тестов.
 *
 * Сумма весов полей: title 3, tags 2, applies_to 2, body 1. Каждое поле даёт
 * вес не более одного раза за токен (повтор слова в теле не накачивает score).
 * Токены приходят уже усечёнными (`stemToken`), сравнение — подстрокой.
 *
 * @param lesson — урок
 * @param tokens — токены задачи (нижний регистр, после stemToken)
 * @param body — тело урока (для веса body; необязательно)
 * @returns score >= 0 (0 — ни одного совпадения)
 */
export function scoreLessonForTask(
  lesson: Lesson,
  tokens: string[],
  body = '',
): number {
  if (tokens.length === 0) return 0;
  const title = String(lesson.title || '').toLowerCase();
  const tags = (lesson.tags || []).map(t => String(t).toLowerCase());
  const appliesTo = (lesson.applies_to || []).map(t => String(t).toLowerCase());
  const bodyText = String(body || '').toLowerCase();

  let score = 0;
  for (const token of tokens) {
    // Токены с дефисом сравниваем целиком (как в searchTasksRanked): усечение
    // основы сделало бы «findme-desc» → «findm» и цепляло соседние метки.
    const needle = token.includes('-') ? token : stemToken(token);
    if (title.includes(needle)) score += LESSON_FIELD_WEIGHTS.title;
    if (tags.some(t => t.includes(needle))) score += LESSON_FIELD_WEIGHTS.tags;
    if (appliesTo.some(t => t.includes(needle))) score += LESSON_FIELD_WEIGHTS.appliesTo;
    if (bodyText.includes(needle)) score += LESSON_FIELD_WEIGHTS.body;
  }
  return score;
}

/**
 * Опции подбора уроков по произвольному тексту (VL-404).
 */
export interface SelectLessonsOptions {
  /** Кап результата (по умолчанию `lessons.prompt_limit`). */
  limit?: number;
  /**
   * Пути репозитория для сверки с `applies_to` урока (VL-400). Не переданы —
   * сверка не выполняется (у чата путей задачи нет).
   */
  paths?: string[];
  /**
   * Минимальный score для попадания в результат (0 — любое совпадение).
   * Нужен там, где нет контекста задачи: в веб-чате одно общее слово
   * («файл», «тест») иначе вытащит нерелевантный урок.
   */
  minScore?: number;
  /**
   * Короткие токены (<3 символов), которые надо сохранить: labels задачи
   * («ci», «ui») несут смысл, хотя и короче порога.
   */
  keepShortTokens?: string[];
}

/**
 * Форматирует урок для подстановки в промпт: `- [lesson-N] <title> (kind)`.
 *
 * Один формат на все места подстановки (фазы и веб-чат, VL-404): модель
 * должна видеть уроки одинаково, иначе сравнивать их между блоками нельзя.
 * kind помогает отличить правило от воркэраунда; у неквалифицированных
 * уроков скобок нет.
 */
export function formatLessonLine(entry: LessonEntry): string {
  const kind = entry.lesson.kind ? ` (${entry.lesson.kind})` : '';
  return `- [${entry.lesson.id}] ${entry.lesson.title}${kind}`;
}

/**
 * Подбирает уроки по произвольному тексту (VL-404) — общий движок recall.
 *
 * Токены берутся из текста через `tokenizeQuery` и усекаются `stemToken`
 * (та же морфология, что у поиска задач). Кандидаты фильтруются как в
 * `loadLessonsForTask` (VL-279): только `active` и не протухшие по
 * `staleDays`. Ранжирование — `scoreLessonForTask` (VL-400), свежесть —
 * tie-breaker, кап — `limit` (по умолчанию `lessons.prompt_limit`).
 *
 * Логика живёт здесь одна: `loadLessonsForTask` (фазы) и блок «Уроки
 * проекта» в веб-чате — тонкие обёртки над этой функцией (lesson-37:
 * общий модуль вместо копий).
 *
 * @param cwd — рабочая директория
 * @param text — текст-запрос (задача или последние сообщения разговора)
 * @param opts — кап, пути для applies_to, порог score, короткие токены
 */
export function selectLessonsForText(
  cwd: string,
  text: string,
  opts: SelectLessonsOptions = {},
): LessonEntry[] {
  const keepShort = (opts.keepShortTokens ?? []).map(t => String(t).toLowerCase());
  // Токены короче 3 символов отбрасываем: «с», «в», «и» — предлоги, и
  // подстрочный матч по ним дал бы score > 0 почти каждому уроку (recall
  // превратился бы в «подставь первые N по свежести»). Короткие labels
  // («ci», «ui») сохраняем: они несут смысл и приходят явно.
  const tokens = tokenizeQuery(String(text || ''))
    .filter(t => t.length >= 3 || keepShort.includes(t));
  // Нет токенов вовсе — подбирать нечего.
  if (tokens.length === 0) return [];

  const settings = readLessonSettings(cwd);
  const limit = Math.max(0, Math.floor(opts.limit ?? settings.promptLimit));
  if (limit === 0) return [];
  const minScore = Number(opts.minScore ?? 0);
  const paths = opts.paths ?? [];

  const now = Date.now();
  const maxAgeMs = settings.staleDays * 24 * 60 * 60 * 1000;

  return listLessons(cwd)
    .filter(e => e.lesson.status === 'active')
    .filter(e => {
      // Дата проверки: явный last_verified приоритетнее updated_date; нет
      // обеих дат — урок считается актуальным (нечего протухать).
      const stamp = e.lesson.last_verified || e.lesson.updated_date;
      if (!stamp) return true;
      const time = Date.parse(stamp);
      if (Number.isNaN(time)) return true;
      return now - time <= maxAgeMs;
    })
    .map(e => {
      let score = scoreLessonForTask(e.lesson, tokens, e.body);
      const appliesTo = (e.lesson.applies_to || []).map(p => String(p).trim()).filter(Boolean);
      if (appliesTo.length > 0 && paths.length > 0) {
        const intersects = appliesTo.some(glob => paths.some(path => globMatchesPath(glob, path)));
        if (!intersects) score *= APPLIES_TO_MISMATCH_FACTOR;
      }
      return { entry: e, score };
    })
    // Релевантность вперёд, свежесть — tie-breaker: при капе top-N в промпт
    // попадают уроки «про этот текст», а не просто недавно проверенные.
    .filter(item => item.score > 0 && item.score >= minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ta = Date.parse(a.entry.lesson.last_verified || a.entry.lesson.updated_date || '') || 0;
      const tb = Date.parse(b.entry.lesson.last_verified || b.entry.lesson.updated_date || '') || 0;
      return tb - ta;
    })
    .slice(0, limit)
    .map(item => item.entry);
}

/**
 * Подбирает lessons для подстановки в промпт Plan/Code (VL-153, VL-279, VL-400).
 *
 * VL-400 — recall по СМЫСЛУ задачи, а не только по labels:
 * - токены берутся из title + description + labels задачи и усекаются
 *   `stemToken` (та же морфология, что у поиска задач);
 * - уроки ранжируются по `scoreLessonForTask` (title/tags/applies_to/body),
 *   свежесть — tie-breaker; кап `promptLimit` сохранён;
 * - урок с непустым `applies_to`, не пересекающимся с путями из плана/
 *   modified_files задачи, получает множитель 0.5 (не отбрасывается: на фазе
 *   Plan план ещё пуст).
 *
 * VL-404: вся фильтрация и ранжирование — в `selectLessonsForText`; здесь
 * только сборка текста задачи и форматирование строк. Сигнатура публичного
 * экспорта не менялась (её использует `src/web/phase-prompt.ts`).
 *
 * VL-279 — фильтры «не подставлять устаревшее»:
 * - только status='active' (needs-review/outdated/superseded отбрасываются:
 *   урок под вопросом или заменённый — неверная инструкция модели);
 * - дата актуальности (last_verified, иначе updated_date) не старше
 *   staleDays дней — урок, не проверявшийся полгода, мог описывать уже
 *   несуществующий API.
 *
 * Формат строки: `- [lesson-N] <title> (kind)` — kind помогает модели
 * отличить правило от воркэраунда; у неквалифицированных уроков скобок нет.
 *
 * Пороги — секция `lessons` settings.json, дефолты — LESSON_DEFAULTS.
 * Пустой результат — задача не найдена либо у неё нет ни title, ни description,
 * ни labels (токенов для recall нет).
 *
 * @param cwd — рабочая директория
 * @param taskId — ID задачи (VL-N)
 */
export function loadLessonsForTask(cwd: string, taskId: string): string[] {
  let task;
  try {
    task = getTask(cwd, taskId);
  } catch {
    return [];
  }
  if (!task) return [];

  const taskText = [
    task.title || '',
    String(task.description || ''),
    (task.labels || []).join(' '),
  ].join(' ');
  const taskPaths = extractTaskPaths([
    String(task.implementationPlan || ''),
    (task.modified_files || []).join(' '),
  ].join(' '));

  return selectLessonsForText(cwd, taskText, {
    paths: taskPaths,
    keepShortTokens: (task.labels || []).map(l => String(l).toLowerCase()),
  }).map(formatLessonLine);
}
