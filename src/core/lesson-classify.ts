/**
 * Классификация lessons и генерация задач техдолга из уроков-обходов (VL-280).
 *
 * Зачем: часть уроков — не правила, а **обходные пути**, легализованные как
 * «урок» (снимай VIBELOG_* через `env -u`, откатывай эксперимент копией файла,
 * проверяй guard-фикс скрипт-файлом). Пока такой урок в статусе active, он
 * подставляется в промпты Plan/Code (loadLessonsForTask) — модель учится
 * обходить проблему вместо того, чтобы её решить. Нужен путь «урок →
 * задача на устранение причины», но ручной: LLM-классификация дорогая и
 * ошибается, поэтому по умолчанию она только отчёт, а записи и создание
 * задач — лишь по явному подтверждению.
 *
 * Модуль сознательно НЕ импортирует LLM-клиент: классифицирующая функция
 * приходит параметром (`LessonClassifyFn`) — ядро остаётся чистым и
 * тестируется на моке (правило «ядро не знает про сеть»), а проводку
 * createLlmClient делает MCP-слой (src/mcp/tools.ts).
 *
 * Контекст для модели: тело урока + findings механического аудита VL-279
 * (битый путь/протухание/висячая задача повышают шанс stale). Пороги не
 * зашиваются в промпт как «магические числа» — findings передаются фактами
 * («путь не найден», «не проверялся 400 дней»), решение принимает модель.
 */

import { listTasks } from './store.js';
import { createTaskFile } from './store.js';
import { getLesson, linkLesson, updateLesson, listLessons, readLessonSettings } from './lesson.js';
import type { LessonEntry } from './lesson.js';
import { auditLessons, extractLessonPaths } from './lesson-audit.js';
import type { LessonFinding } from './lesson-audit.js';

/**
 * Значения kind классификации (AC1): три «хранимых» (rule/workaround/fact —
 * они валидны для фронтматтера, LESSON_KINDS) плюс stale — вердикт о том, что
 * урок устарел. stale НЕ пишется в kind (модель статусов уроков живёт в
 * status: needs-review/outdated); в отчёте он означает «пора проверить».
 */
export const LESSON_CLASSIFY_KINDS = ['rule', 'workaround', 'fact', 'stale'] as const;

/** Тип классификации урока. */
export type LessonClassifyKind = (typeof LESSON_CLASSIFY_KINDS)[number];

/** Виды kind, которые допустимо записывать во фронтматтер урока. */
export const STORABLE_LESSON_KINDS: readonly LessonClassifyKind[] = ['rule', 'workaround', 'fact'];

/** Промпт для классифицирующей модели (собирается в этом модуле — не в MCP-слое). */
export interface LessonClassifyPrompt {
  system: string;
  user: string;
}

/** Параметр ядра: функция вызова модели; ошибка/таймаут — исключение. */
export type LessonClassifyFn = (prompt: LessonClassifyPrompt) => Promise<string>;

/** Классификация одного урока (AC1: kind + обоснование 1–2 предложения). */
export interface LessonClassification {
  id: string;
  title: string;
  /** Итоговый kind (в т.ч. stale — только в отчёте). */
  kind: LessonClassifyKind | null;
  /** Обоснование модели (1–2 предложения). */
  reason: string;
  /** Текст ошибки LLM для этого урока (AC9: остальные продолжают обрабатываться). */
  error?: string;
  /** Записан ли kind в фронтматтер (AC3: только по подтверждению). */
  applied?: boolean;
  /** Причина, по которой классификация не записана. */
  skippedReason?: string;
}

/** Кластер уроков-обходов: одна тема = одна задача техдолга (AC4). */
export interface LessonCluster {
  /** Стабильный ID кластера для подтверждения человеком (tag:/path:/lesson:). */
  id: string;
  /** Уроки кластера (id, отсортированы). */
  lessons: string[];
  /** Общие tags кластера (для labels задачи). */
  tags: string[];
  /** Общие/упомянутые пути темы. */
  paths: string[];
  /** Заголовки уроков (для названия кластера). */
  titles: string[];
}

/** Черновик задачи техдолга (AC4): описание с причиной, цитатами и критерием. */
export interface TechDebtDraft {
  clusterId: string;
  title: string;
  description: string;
  labels: string[];
  lessonIds: string[];
}

/** Итог создания задач техдолга (AC5–AC8). */
export interface TechDebtCreationResult {
  created: { clusterId: string; taskId: string; lessons: string[] }[];
  /** Кластеры, пропущенные из-за идемпотентности (уже есть задача). */
  skipped: { clusterId: string; reason: string; taskId?: string }[];
  /** Кластеры, не созданные из-за лимита задач за вызов. */
  limited: { clusterId: string }[];
  /** Ошибки записи (кладём в отчёт, не роняем весь вызов). */
  errors: { clusterId: string; error: string }[];
}

/** Отчёт `lesson_classify` (всё, что нужно для решения человеком). */
export interface LessonClassifyReport {
  /** Сколько уроков попало в выборку. */
  total: number;
  classifications: LessonClassification[];
  /** Сводка по kind (включая stale и error). */
  summary: Record<string, number>;
  clusters: LessonCluster[];
  drafts: TechDebtDraft[];
  /** Записанные в фронтматтер kind (AC3). */
  applied: string[];
  creation?: TechDebtCreationResult;
}

/** Опции выборки уроков для классификации (AC1: ids[] либо фильтр). */
export interface LessonClassifyOptions {
  /** Явный список ID (приоритетнее фильтра). */
  ids?: string[];
  /** Фильтр по статусу (active/needs-review/outdated/superseded). */
  status?: string;
  /** Фильтр по меткам (любое пересечение). */
  tags?: string[];
  /** Максимум уроков в выборке (дефолт 20 — дорогой путь, не массовый). */
  limit?: number;
  /** Разрешить запись kind всем классифицированным (AC3). */
  apply?: boolean;
  /** Явный список ID, для которых kind разрешено записать (AC3). */
  confirmIds?: string[];
  /** Кластеры, для которых создавать задачи техдолга (AC5: явное подтверждение). */
  createClusters?: string[];
  /** Лимит задач за вызов (дефолт — настройка lessons.tech_debt_max_tasks / 1). */
  maxTasks?: number;
}

/** Дефолт выборки: дорогой LLM-путь не должен случайно уйти на весь корпус. */
export const LESSON_CLASSIFY_LIMIT = 20;

/** Сколько символов тела урока уходит в промпт (контекст без раздувания). */
const BODY_PROMPT_CHARS = 1800;

/** Сколько символов цитаты урока попадает в описание задачи техдолга. */
const QUOTE_CHARS = 240;

/** Системная инструкция классификатора. */
const SYSTEM_PROMPT = [
  'Ты классифицируешь «уроки» (lessons learned) инженерного проекта.',
  'Верни СТРОГО один JSON-объект без markdown-обёртки:',
  '{"kind":"rule|workaround|fact|stale","reason":"1-2 предложения на русском"}',
  '',
  'Значения kind:',
  '- rule — правило поведения, которое останется верным при исправном коде;',
  '- workaround — обходной путь из-за дефекта/ограничения инструмента, среды или',
  '  процесса (env-переменные, git-ритуалы, ручные проверки вместо автотестов);',
  '  его надо УСТРАНИТЬ, а не соблюдать вечно;',
  '- fact — утверждение о коде/структуре проекта, проверяемое тестом или аудитом;',
  '- stale — урок описывает уже несуществующее (битые пути, старый API, давно не',
  '  проверялся, ссылка на закрытую задачу);',
  '',
  'Опирайся на перечисленные ниже факты механического аудита: они, а не догадки,',
  'определяют stale.',
].join('\n');

/**
 * Подбирает уроки под опции выборки (ids → фильтр status/tags → limit).
 *
 * Порядок детерминированный (по id), чтобы повторный вызов с теми же
 * аргументами классифицировал те же уроки: отчёт должен быть воспроизводим.
 */
export function selectLessonsForClassify(
  cwd: string,
  opts: LessonClassifyOptions = {},
): LessonEntry[] {
  const all = listLessons(cwd);
  const ids = (opts.ids || []).map(id => String(id).trim().toLowerCase()).filter(Boolean);
  let selected: LessonEntry[];
  if (ids.length > 0) {
    const wanted = new Set(ids);
    selected = all.filter(e => wanted.has(e.lesson.id.toLowerCase()));
  } else {
    const status = String(opts.status || '').toLowerCase();
    const tags = (opts.tags || []).map(t => String(t).toLowerCase()).filter(Boolean);
    selected = all.filter(e => {
      if (status && e.lesson.status.toLowerCase() !== status) return false;
      if (tags.length > 0) {
        const own = (e.lesson.tags || []).map(t => String(t).toLowerCase());
        if (!tags.some(t => own.includes(t))) return false;
      }
      return true;
    });
  }
  selected.sort((a, b) => a.lesson.id.localeCompare(b.lesson.id, 'ru'));
  const limit = Number.isFinite(opts.limit) && (opts.limit as number) > 0
    ? Math.floor(opts.limit as number)
    : LESSON_CLASSIFY_LIMIT;
  return selected.slice(0, limit);
}

/** Строки findings для конкретного урока — факты для модели (AC2). */
function findingsLines(findings: LessonFinding[]): string[] {
  return findings.map(f => {
    const details = Object.entries(f.details || {})
      .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : String(v)}`)
      .join(', ');
    return `- ${f.type}${details ? ` (${details})` : ''}`;
  });
}

/**
 * Собирает промпт для одного урока.
 *
 * Findings передаются как факты («путь не найден: src/x.ts») — решение о
 * stale принимает модель, а не захардкоженный в прокси порог (AC2).
 */
export function buildClassifyPrompt(
  entry: LessonEntry,
  findings: LessonFinding[] = [],
): LessonClassifyPrompt {
  const l = entry.lesson;
  const body = String(entry.body || '').slice(0, BODY_PROMPT_CHARS);
  const user = [
    `Урок ${l.id}: ${l.title}`,
    `Статус: ${l.status}`,
    `Tags: ${(l.tags || []).join(', ') || '—'}`,
    `Применяется к: ${(l.applies_to || []).join(', ') || '—'}`,
    `Последняя проверка: ${l.last_verified || l.updated_date || '—'}`,
    `Уже классифицирован как: ${l.kind || '—'}`,
    '',
    'Факты механического аудита (VL-279):',
    ...(findings.length > 0 ? findingsLines(findings) : ['- находок нет']),
    '',
    'Тело урока:',
    '"""',
    body,
    '"""',
  ].join('\n');
  return { system: SYSTEM_PROMPT, user };
}

/** Достаёт JSON-объект из ответа модели (снимает ```json-обёртку и текст вокруг). */
function extractJsonObject(text: string): unknown {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('в ответе модели нет JSON-объекта');
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Разбирает ответ модели в kind + reason.
 *
 * @throws если JSON невалиден или kind вне LESSON_CLASSIFY_KINDS
 */
export function parseClassifyResponse(text: string): { kind: LessonClassifyKind; reason: string } {
  const obj = extractJsonObject(text);
  const source = (typeof obj === 'object' && obj !== null ? obj : {}) as Record<string, unknown>;
  const kind = String(source.kind || '').trim().toLowerCase();
  if (!LESSON_CLASSIFY_KINDS.includes(kind as LessonClassifyKind)) {
    throw new Error(`недопустимый kind "${source.kind}" (ожидается ${LESSON_CLASSIFY_KINDS.join('|')})`);
  }
  const reason = String(source.reason || '').trim();
  return { kind: kind as LessonClassifyKind, reason };
}

/**
 * Классифицирует выбранные уроки через переданную LLM-функцию.
 *
 * Поведение по умолчанию — только отчёт (AC3): kind пишется во фронтматтер
 * лишь для `confirmIds` (явный список) или для всех при `apply=true`.
 * Ошибка модели по одному уроку не прерывает обработку остальных (AC9):
 * в отчёте появляется запись с `error`, файлы не меняются.
 *
 * @param cwd — рабочая директория проекта
 * @param opts — выборка и подтверждения
 * @param classify — функция вызова модели (мок в тестах)
 */
export async function classifyLessons(
  cwd: string,
  opts: LessonClassifyOptions,
  classify: LessonClassifyFn,
): Promise<LessonClassifyReport> {
  const entries = selectLessonsForClassify(cwd, opts);
  const audit = auditLessons(cwd);
  const findingsByLesson = new Map<string, LessonFinding[]>(
    audit.byLesson.map(item => [item.id.toLowerCase(), item.findings]),
  );

  const confirm = new Set((opts.confirmIds || []).map(id => String(id).toLowerCase()));
  const report: LessonClassifyReport = {
    total: entries.length,
    classifications: [],
    summary: {},
    clusters: [],
    drafts: [],
    applied: [],
  };

  for (const entry of entries) {
    const findings = findingsByLesson.get(entry.lesson.id.toLowerCase()) || [];
    const prompt = buildClassifyPrompt(entry, findings);
    let item: LessonClassification;
    try {
      const text = await classify(prompt);
      const parsed = parseClassifyResponse(text);
      item = {
        id: entry.lesson.id,
        title: entry.lesson.title,
        kind: parsed.kind,
        reason: parsed.reason,
      };
      // AC3: запись только по подтверждению; stale в kind не пишется никогда —
      // это вердикт о статусе, а фронтматтер держит только rule/workaround/fact.
      const mayWrite = opts.apply === true || confirm.has(entry.lesson.id.toLowerCase());
      if (parsed.kind === 'stale') {
        item.skippedReason = 'stale не пишется в kind — переведите урок в needs-review/outdated';
      } else if (!mayWrite) {
        item.skippedReason = 'нужно подтверждение (apply=true или confirmIds)';
      } else {
        try {
          updateLesson(cwd, entry.lesson.id, { kind: parsed.kind });
          item.applied = true;
          report.applied.push(entry.lesson.id);
        } catch (err) {
          item.skippedReason = `не удалось записать: ${(err as Error).message}`;
        }
      }
    } catch (err) {
      item = {
        id: entry.lesson.id,
        title: entry.lesson.title,
        kind: null,
        reason: '',
        error: (err as Error).message || 'ошибка LLM',
      };
    }
    report.classifications.push(item);
    const key = item.error ? 'error' : (item.kind || 'unknown');
    report.summary[key] = (report.summary[key] || 0) + 1;
  }

  // Кластеры и черновики — только по урокам, классифицированным как workaround.
  const workaroundIds = new Set(
    report.classifications.filter(c => c.kind === 'workaround' && !c.error).map(c => c.id),
  );
  const byId = new Map(entries.map(e => [e.lesson.id.toLowerCase(), e]));
  const workaroundEntries = entries.filter(e => workaroundIds.has(e.lesson.id));
  report.clusters = clusterWorkarounds(workaroundEntries);
  report.drafts = report.clusters.map(cluster => buildTechDebtDraft(cluster, byId));

  if ((opts.createClusters || []).length > 0) {
    report.creation = createTechDebtTasks(cwd, report.drafts, {
      clusters: opts.createClusters || [],
      maxTasks: opts.maxTasks,
    });
  }
  return report;
}

/** Токены tags для кластеризации: lowercase, без пустых. */
function normTags(entry: LessonEntry): string[] {
  return (entry.lesson.tags || []).map(t => String(t).toLowerCase()).filter(Boolean);
}

/** Пути темы урока: из тела + applies_to (детерминированно, отсортированы). */
function lessonPaths(entry: LessonEntry): string[] {
  const fromBody = extractLessonPaths(entry.body || '');
  const fromApplies = (entry.lesson.applies_to || [])
    .map(p => String(p).trim())
    .filter(p => p && !/[*?{}<>$|]/.test(p));
  return [...new Set([...fromBody, ...fromApplies])].sort();
}

/** Простой union-find (число уроков в выборке мало — рекурсия безопасна). */
function makeUnionFind(size: number): { find: (i: number) => number; union: (a: number, b: number) => void } {
  const parent = Array.from({ length: size }, (_, i) => i);
  const find = (i: number): number => {
    let cur = i;
    while (parent[cur] !== cur) cur = parent[cur];
    // сжатие пути
    let node = i;
    while (parent[node] !== cur) {
      const next = parent[node];
      parent[node] = cur;
      node = next;
    }
    return cur;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  return { find, union };
}

/**
 * Кластеризует уроки-обходы детерминированно (AC4): связь по общему пути
 * (`extractLessonPaths`/`applies_to`) либо по «специфичному» tag.
 *
 * Специфичный tag — тот, что встречается не более чем у трети уроков-обходов:
 * `tests`, `workflow` и подобные общие метки иначе склеили бы весь корпус в
 * одну мега-задачу, а задача техдолга должна быть про одну тему.
 * LLM для названия кластера не зовём — ID кластера строится из anchor'а
 * (tag/path/id), чтобы повторный вызов с теми же ids давал те же кластеры
 * и подтверждение «createClusters: [...]» оставалось валидным.
 */
export function clusterWorkarounds(entries: LessonEntry[]): LessonCluster[] {
  const list = [...entries].sort((a, b) => a.lesson.id.localeCompare(b.lesson.id, 'ru'));
  if (list.length === 0) return [];

  const tagsPer = list.map(normTags);
  const pathsPer = list.map(lessonPaths);

  // Частота тегов: общие метки (встречаются у >1/3 уроков) не связывают.
  const tagFreq = new Map<string, number>();
  for (const tags of tagsPer) for (const t of new Set(tags)) tagFreq.set(t, (tagFreq.get(t) || 0) + 1);
  const specificThreshold = Math.max(2, Math.floor(list.length / 3));
  const specificTags = new Map<string, number[]>();
  tagsPer.forEach((tags, index) => {
    for (const tag of new Set(tags)) {
      if ((tagFreq.get(tag) || 0) > specificThreshold) continue;
      const owners = specificTags.get(tag) || [];
      owners.push(index);
      specificTags.set(tag, owners);
    }
  });

  const uf = makeUnionFind(list.length);
  // Общий путь → та же тема
  const pathOwner = new Map<string, number>();
  pathsPer.forEach((paths, index) => {
    for (const path of paths) {
      const owner = pathOwner.get(path);
      if (owner !== undefined) uf.union(owner, index);
      else pathOwner.set(path, index);
    }
  });
  // Специфичный tag, встречающийся у нескольких уроков → та же тема
  for (const [, owners] of specificTags) {
    for (let i = 1; i < owners.length; i += 1) uf.union(owners[0], owners[i]);
  }

  const groups = new Map<number, number[]>();
  list.forEach((_, index) => {
    const root = uf.find(index);
    const group = groups.get(root) || [];
    group.push(index);
    groups.set(root, group);
  });

  const clusters: LessonCluster[] = [];
  for (const indices of groups.values()) {
    const lessonIds = indices.map(i => list[i].lesson.id).sort((a, b) => a.localeCompare(b, 'ru'));
    const titles = indices.map(i => list[i].lesson.title);
    const paths = [...new Set(indices.flatMap(i => pathsPer[i]))].sort();
    const tagCount = new Map<string, number>();
    for (const i of indices) for (const t of new Set(tagsPer[i])) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    // Теги кластера — общие для ≥2 уроков; одиночный урок отдаёт свои теги
    const shared = [...tagCount.entries()]
      .filter(([, count]) => (lessonIds.length > 1 ? count >= 2 : count >= 1))
      .map(([tag]) => tag)
      .sort();
    const tags = shared.length > 0 ? shared : [...tagCount.keys()].sort();
    const anchor = tags[0] ? `tag:${tags[0]}`
      : paths[0] ? `path:${paths[0]}`
      : `lesson:${lessonIds[0]}`;
    clusters.push({
      id: anchor,
      lessons: lessonIds,
      tags,
      paths,
      titles: titles.sort((a, b) => a.localeCompare(b, 'ru')),
    });
  }
  return clusters.sort((a, b) => b.lessons.length - a.lessons.length
    || a.id.localeCompare(b.id, 'ru'));
}

/** Выдержка из тела урока для цитаты: первая содержательная строка. */
function excerpt(body: string, limit = QUOTE_CHARS): string {
  const lines = String(body || '')
    .split('\n')
    .map(l => l.replace(/^[-*#>\s]+/, '').trim())
    // Ярлыки секций («Решение:», «Проблема —») не выбрасывают строку: в них
    // и лежит суть обхода, поэтому снимаем только сам ярлык.
    .map(l => l.replace(/^(Проблема|Решение|Пример|Связь с задачами)\s*[:—–-]\s*/i, '').trim())
    .filter(l => l.length > 0 && !/^(Проблема|Решение|Пример|Связь с задачами)$/i.test(l));
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Строит черновик задачи техдолга по кластеру (AC4).
 *
 * В описании: причина обхода, цитаты уроков-источников с ID и критерий
 * «workaround больше не нужен» (что должно стать правдой, чтобы уроки можно
 * было перевести в outdated/superseded — замыкание цикла, AC7).
 */
export function buildTechDebtDraft(
  cluster: LessonCluster,
  byId: Map<string, LessonEntry>,
): TechDebtDraft {
  const theme = cluster.tags[0] || cluster.paths[0] || cluster.lessons[0];
  const lines: string[] = [];
  lines.push(`## Причина обхода`);
  lines.push('');
  lines.push(
    `Уроки ниже описывают обходной путь, а не правило: причина не устранена, и корпус ` +
    `lessons легализует обход как норму поведения (тема: ${theme}).`,
  );
  lines.push('');
  lines.push('## Уроки-источники');
  lines.push('');
  for (const id of cluster.lessons) {
    const entry = byId.get(id.toLowerCase());
    const title = entry ? entry.lesson.title : id;
    const quote = entry ? excerpt(entry.body) : '';
    lines.push(`- ${id} «${title}»${quote ? ` — ${quote}` : ''}`);
  }
  lines.push('');
  if (cluster.paths.length > 0) {
    lines.push('## Затронутые пути');
    lines.push('');
    for (const path of cluster.paths) lines.push(`- \`${path}\``);
    lines.push('');
  }
  lines.push('## Ожидаемый результат');
  lines.push('');
  lines.push(
    'workaround больше не нужен: после устранения причины уроки ' +
    `${cluster.lessons.join(', ')} можно перевести в \`outdated\`/\`superseded\`, а обходные ` +
    'инструкции — удалить из корпуса lessons (проверка: повторная классификация не даёт workaround).',
  );
  lines.push('');
  return {
    clusterId: cluster.id,
    title: `Устранить причину обхода: ${theme}`,
    description: lines.join('\n'),
    labels: ['tech-debt', 'lessons', ...cluster.tags.filter(t => t !== 'lessons')],
    lessonIds: cluster.lessons,
  };
}

/**
 * Ищет уже созданную задачу техдолга, покрывающую любой из уроков (AC8).
 *
 * Идемпотентность без внешнего хранилища: задачи с меткой `tech-debt`, в
 * описании которых упомянут ID урока (`lesson-N`). Так повторный вызов
 * с теми же ids не создаёт дубль, даже если кластер пересчитался иначе.
 */
export function findExistingTechDebtTask(
  cwd: string,
  lessonIds: string[],
): { id: string; lessonId: string } | null {
  if (lessonIds.length === 0) return null;
  const wanted = lessonIds.map(id => id.toLowerCase());
  let tasks;
  try {
    tasks = listTasks(cwd);
  } catch {
    return null;
  }
  for (const task of tasks) {
    if (!(task.labels || []).some(l => String(l).toLowerCase() === 'tech-debt')) continue;
    const text = `${task.title}\n${task.description || ''}`.toLowerCase();
    for (const id of wanted) {
      if (text.includes(id)) return { id: task.id, lessonId: id };
    }
  }
  return null;
}

/** Раздел «Устранение» в теле урока — ссылка на задачу техдолга (AC7). */
const REMEDIATION_HEADER = '## Устранение';

/**
 * Дописывает (или обновляет) раздел «Устранение» в теле урока.
 *
 * При закрытии задачи техдолга этот раздел и linked_tasks показывают, какой
 * урок пора перевести в outdated/superseded (замыкание цикла, AC7).
 */
export function appendRemediationSection(body: string, taskIds: string[], date: string): string {
  const text = String(body || '');
  const lines: string[] = [REMEDIATION_HEADER, ''];
  for (const id of taskIds) lines.push(`- Задача техдолга: ${id} (создана ${date})`);
  lines.push('');
  lines.push('Когда задача закрыта — переведите урок в `outdated`/`superseded`');
  lines.push('(`lesson_update`/`lesson_supersede`), чтобы обход не подставлялся в промпты.');
  lines.push('');
  const block = lines.join('\n');

  const start = text.indexOf(REMEDIATION_HEADER);
  if (start === -1) {
    const base = text.replace(/\s+$/, '');
    return `${base ? `${base}\n\n` : ''}${block}`;
  }
  // Заменяем существующий раздел до следующего заголовка второго уровня
  const after = text.slice(start + REMEDIATION_HEADER.length);
  const nextHeading = after.search(/\n## /);
  const tail = nextHeading === -1 ? '' : after.slice(nextHeading + 1);
  return `${text.slice(0, start)}${block}${tail ? `\n${tail}` : ''}`;
}

/** Сегодня YYYY-MM-DD (локальная дата). */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Создаёт задачи техдолга по явно перечисленным кластерам (AC5–AC8).
 *
 * Жёсткие границы:
 * - только указанные кластеры (никакого «создать всё»);
 * - не более N задач за вызов (дефолт из настроек `lessons.tech_debt_max_tasks`,
 *   минимум 1) — бэклог не заваливается молча;
 * - идемпотентность по уже связанным задачам техдолга (AC8);
 * - каждая созданная задача двусторонне связана с уроками (linkLesson) и
 *   получает ссылку в теле урока (AC6/AC7).
 */
export function createTechDebtTasks(
  cwd: string,
  drafts: TechDebtDraft[],
  opts: { clusters: string[]; maxTasks?: number },
): TechDebtCreationResult {
  const result: TechDebtCreationResult = { created: [], skipped: [], limited: [], errors: [] };
  const wanted = new Set((opts.clusters || []).map(c => String(c).trim()));
  const configured = Number.isFinite(opts.maxTasks) && (opts.maxTasks as number) > 0
    ? Math.floor(opts.maxTasks as number)
    : readLessonSettings(cwd).techDebtMaxTasks;
  const maxTasks = Math.max(1, configured);

  const selected = drafts.filter(d => wanted.has(d.clusterId));
  for (const draft of selected) {
    if (result.created.length >= maxTasks) {
      result.limited.push({ clusterId: draft.clusterId });
      continue;
    }
    const existing = findExistingTechDebtTask(cwd, draft.lessonIds);
    if (existing) {
      result.skipped.push({
        clusterId: draft.clusterId,
        reason: `уже есть задача техдолга по уроку ${existing.lessonId}`,
        taskId: existing.id,
      });
      continue;
    }
    try {
      const task = createTaskFile(cwd, {
        title: draft.title,
        description: draft.description,
        labels: draft.labels,
        type: 'task',
        noDodDefaults: true,
      });
      const date = todayIso();
      for (const lessonId of draft.lessonIds) {
        const entry = getLesson(cwd, lessonId);
        if (!entry) continue;
        // Двусторонняя связь lesson ↔ задача (AC6)
        linkLesson(cwd, entry.lesson.id, task.id, 'add');
        // Ссылка в теле урока: при закрытии техдолга видно, что переводить
        // в outdated/superseded (AC7)
        const body = appendRemediationSection(entry.body, [task.id], date);
        updateLesson(cwd, entry.lesson.id, { content: body });
      }
      result.created.push({ clusterId: draft.clusterId, taskId: task.id, lessons: draft.lessonIds });
    } catch (err) {
      result.errors.push({ clusterId: draft.clusterId, error: (err as Error).message });
    }
  }
  return result;
}
