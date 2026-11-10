/**
 * Консолидация корпуса lessons (VL-400) — детерминированно, без LLM и сети.
 *
 * Зачем: `lesson_audit` (VL-279) находит дубли и пустые тела, `lesson_classify`
 * (VL-280) находит кластеры воркэраундов, но шага «кластер правил → одна
 * строка в AGENTS.md, дубли → supersede» не было. Правило, которое нарушают
 * снова и снова, живёт в 3–4 дублях-уроках вместо одной строки в AGENTS.md
 * (а AGENTS.md инжектится в каждый ход каждой фазы, кап 8000 символов —
 * `src/agent/system-prompt.ts`). Итог: 274 урока накоплены, а поведение
 * агента не меняется.
 *
 * Модуль строит ПЛАН (read-only) и применяет его ТОЛЬКО по явным ID/строкам —
 * паттерн `applyLessonAudit` (lesson-147): «применить всё найденное» не
 * существует, потому что порог схожести 0.35 на реальном корпусе даёт пары
 * вроде lesson-158/lesson-229 (0.37) — это разные уроки.
 *
 * Запись в AGENTS.md — самая дорогая операция в проекте (файл читается в
 * каждый ход), поэтому: секция-маркер `<!-- lessons:consolidated -->`,
 * дедупликация по нормализованному тексту, dry-run по умолчанию.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { findBacklogDir } from './paths.js';
import { listLessons, supersedeLesson } from './lesson.js';
import type { LessonEntry } from './lesson.js';
import { auditLessons } from './lesson-audit.js';

/** Маркер секции AGENTS.md, которой владеет консолидация (VL-400). */
export const AGENTS_MD_MARKER = '<!-- lessons:consolidated -->';

/** Заголовок секции, который ставится перед строками правил. */
const AGENTS_MD_SECTION_TITLE = '## Правила из lessons (консолидировано)';

/**
 * Кластер правил: одна тема = одна строка в AGENTS.md.
 *
 * `canonical` — урок, чей заголовок предлагается как строка правила (самый
 * свежий в кластере); `supersede` — остальные уроки кластера, которые после
 * применения уходят в `superseded` со ссылкой на canonical.
 */
export interface RuleCluster {
  /** Стабильный ID кластера (tag:<tag> / lesson:<id>) — для подтверждения. */
  id: string;
  /** Общие tags кластера. */
  tags: string[];
  /** Уроки кластера (id, отсортированы). */
  lessons: string[];
  /** Урок-канон: его заголовок предлагается строкой для AGENTS.md. */
  canonical: string;
  /** Предлагаемая строка для AGENTS.md (заголовок canonical). */
  proposedLine: string;
  /** Уроки, которые предлагается пометить superseded (все, кроме canonical). */
  supersede: string[];
  /** Заголовки уроков кластера (для отчёта). */
  titles: string[];
}

/** Пара дублей: два урока, похожих по Jaccard выше порога аудита. */
export interface DuplicatePair {
  a: string;
  b: string;
  similarity: number;
  /** Предлагаемый канон (свежий из пары) и кандидат на supersede. */
  canonical: string;
  supersede: string;
}

/** Урок с незаполненным телом (finding empty_body). */
export interface EmptyBodyLesson {
  id: string;
  title: string;
  /** true — тело равно дефолтному скелету, false — пустое. */
  skeleton: boolean;
}

/** План консолидации: ничего не записано, только предложения. */
export interface ConsolidationPlan {
  /** Всего уроков в корпусе. */
  total: number;
  ruleClusters: RuleCluster[];
  duplicatePairs: DuplicatePair[];
  emptyBodies: EmptyBodyLesson[];
  summary: {
    ruleClusters: number;
    duplicatePairs: number;
    emptyBodies: number;
    /** Сколько уроков уйдёт в superseded, если применить всё (для оценки). */
    supersedeCandidates: number;
  };
}

/** Опции плана (порог дублей — как у аудита). */
export interface ConsolidationOptions {
  /** Порог схожести дублей 0..1 (по умолчанию — настройка/0.35). */
  duplicateThreshold?: number;
  /** Включать ли эвристику «императивный заголовок» для kind: null. */
  includeUnclassified?: boolean;
}

/**
 * Императивный ли заголовок урока (эвристика для `kind: null`).
 *
 * Русский императив почти всегда оканчивается на «-й» («Проверяй»,
 * «Используй», «Не делай») — это сильный маркер. Окончание «-и»/«-ь» не
 * используем: под него попадают существительные («Модель», «Двери»), и
 * эвристика начала бы выдумывать правила из фактов.
 *
 * @param title — заголовок урока
 */
export function isImperativeTitle(title: string): boolean {
  const first = String(title || '').trim().split(/\s+/)[0] || '';
  if (!first) return false;
  // «Не» + глагол — тоже императив (отрицание)
  if (/^не$/i.test(first)) return true;
  return /^[А-ЯЁа-яё][а-яё]{2,}й$/u.test(first);
}

/** Нормализованный текст строки — ключ дедупликации в AGENTS.md. */
function normalizeLine(line: string): string {
  return String(line || '')
    .replace(/^[-*+]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Дата урока для выбора канона: last_verified приоритетнее updated_date. */
function lessonStamp(entry: LessonEntry): number {
  return Date.parse(entry.lesson.last_verified || entry.lesson.updated_date || '') || 0;
}

/** Стоп-слова для сравнения заголовков (служебная лексика, не смысл). */
const TITLE_STOP_WORDS = new Set([
  'для', 'что', 'как', 'это', 'если', 'когда', 'или', 'при', 'над', 'под',
  'без', 'через', 'тоже', 'также', 'все', 'уже', 'том', 'его', 'чтобы',
  'только', 'может', 'можно', 'нужно', 'быть', 'есть', 'них', 'чем', 'где',
  'тот', 'тем', 'этот', 'она', 'они', 'если', 'иначе', 'потом', 'после',
]);

/**
 * Токены заголовка для сравнения смысловой близости (VL-400).
 *
 * Слова короче 4 символов отбрасываются: «не», «на», «по» встречаются в
 * каждом втором заголовке и раздувают схожесть до ложной.
 *
 * @param title — заголовок урока
 */
function tokenizeTitle(title: string): string[] {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 4 && !TITLE_STOP_WORDS.has(t));
}

/** Jaccard по множествам токенов (0 при пустом множестве). */
function jaccardSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const token of a) if (b.has(token)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * Строит план консолидации корпуса lessons (read-only).
 *
 * Кластеры правил: активные уроки с `kind: 'rule'` (плюс, если
 * `includeUnclassified`, уроки с `kind: null` и императивным заголовком),
 * связанные общим «специфичным» tag — тем, что встречается у ≥2 и не более
 * чем у трети уроков выборки. Общие метки (`tests`, `workflow`) иначе склеили
 * бы весь корпус в один кластер.
 *
 * Дубли и пустые тела берутся из `auditLessons` — второй реализации
 * сравнения нет (lesson-37: общий модуль вместо копий).
 *
 * @param cwd — рабочая директория проекта
 * @param opts — порог дублей и включение эвристики kind: null
 */
export function buildConsolidationPlan(
  cwd: string,
  opts: ConsolidationOptions = {},
): ConsolidationPlan {
  const entries = listLessons(cwd);
  const byId = new Map(entries.map(e => [e.lesson.id.toLowerCase(), e]));

  // ── Кластеры правил ──
  //
  // Группировка — по КОМПОНЕНТАМ СВЯЗНОСТИ графа дублей (findings
  // `duplicate_of` из аудита), а не по общим tags. Проверено на реальных 274
  // уроках: группировка по tag давала 81 «кластер» из несвязанных уроков
  // (общая метка `тесты`/`docs` — это область, а не правило), а union-find по
  // пересечению tags сливал весь корпус в один мега-кластер. Дубли — это и
  // есть сигнал «одно правило живёт в 3–4 копиях», ровно то, что нужно
  // консолидировать в одну строку AGENTS.md.
  const includeUnclassified = opts.includeUnclassified !== false;
  const isRuleish = (entry: LessonEntry): boolean => {
    if (entry.lesson.status !== 'active') return false;
    if (entry.lesson.kind === 'rule') return true;
    if (entry.lesson.kind === null && includeUnclassified) return isImperativeTitle(entry.lesson.title);
    return false;
  };

  // ── Дубли и пустые тела — из аудита (единая реализация сравнения) ──
  const audit = auditLessons(cwd, {
    ...(opts.duplicateThreshold !== undefined ? { duplicateThreshold: opts.duplicateThreshold } : {}),
  });

  const seenPairs = new Set<string>();
  const duplicatePairs: DuplicatePair[] = [];
  /** Граф дублей: id → соседи (для компонент связности). */
  const dupGraph = new Map<string, Set<string>>();
  const linkDup = (x: string, y: string): void => {
    if (!dupGraph.has(x)) dupGraph.set(x, new Set());
    if (!dupGraph.has(y)) dupGraph.set(y, new Set());
    dupGraph.get(x)!.add(y);
    dupGraph.get(y)!.add(x);
  };

  for (const finding of audit.findings) {
    if (finding.type !== 'duplicate_of') continue;
    const other = String(finding.details.other || '');
    if (!other) continue;
    const key = [finding.lessonId, other].sort().join('|');
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const a = byId.get(finding.lessonId.toLowerCase());
    const b = byId.get(other.toLowerCase());
    // Канон пары — более свежий урок (при равенстве — меньший id, чтобы
    // повторный прогон давал тот же план)
    const canonical = a && b
      ? (lessonStamp(a) > lessonStamp(b) ? a : lessonStamp(b) > lessonStamp(a) ? b
        : (a.lesson.id.localeCompare(b.lesson.id, 'ru') <= 0 ? a : b))
      : a || b;
    const canonicalId = canonical ? canonical.lesson.id : finding.lessonId;
    const supersedeId = canonicalId === finding.lessonId ? other : finding.lessonId;
    duplicatePairs.push({
      a: finding.lessonId,
      b: other,
      similarity: Number(finding.details.similarity) || 0,
      canonical: canonicalId,
      supersede: supersedeId,
    });
    linkDup(finding.lessonId, other);
  }
  duplicatePairs.sort((x, y) => y.similarity - x.similarity
    || x.a.localeCompare(y.a, 'ru'));

  // Компоненты связности графа дублей
  const visited = new Set<string>();
  const ruleClusters: RuleCluster[] = [];
  for (const start of [...dupGraph.keys()].sort((a, b) => a.localeCompare(b, 'ru'))) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    visited.add(start);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      component.push(cur);
      for (const next of dupGraph.get(cur) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
    // Кластер правил — компонента дублей: два урока с одинаковым смыслом и
    // есть «одно правило в двух копиях», независимо от проставленного kind
    // (kind размечен лишь у 6 уроков из 274 — фильтр по нему обнулял бы план
    // на реальном корпусе). Что именно писать в AGENTS.md, решает человек:
    // план лишь предлагает строку и список на supersede.
    const members = component
      .map(id => byId.get(id.toLowerCase()))
      .filter((e): e is LessonEntry => Boolean(e))
      .sort((a, b) => lessonStamp(b) - lessonStamp(a)
        || a.lesson.id.localeCompare(b.lesson.id, 'ru'));
    if (members.length < 2) continue;
    // Канон — самый свежий урок-правило компоненты (иначе самый свежий)
    const canonical = members.find(isRuleish) || members[0];
    const tagCount = new Map<string, number>();
    for (const entry of members) {
      for (const tag of new Set((entry.lesson.tags || []).map(t => String(t).toLowerCase()))) {
        tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
      }
    }
    const tags = [...tagCount.entries()]
      .filter(([, count]) => count >= 2)
      .map(([tag]) => tag)
      .sort();
    ruleClusters.push({
      id: tags[0] ? `tag:${tags[0]}` : `lesson:${canonical.lesson.id}`,
      tags,
      lessons: members.map(e => e.lesson.id).sort((a, b) => a.localeCompare(b, 'ru')),
      canonical: canonical.lesson.id,
      proposedLine: canonical.lesson.title,
      supersede: members
        .filter(e => e.lesson.id !== canonical.lesson.id)
        .map(e => e.lesson.id)
        .sort((a, b) => a.localeCompare(b, 'ru')),
      titles: members.map(e => e.lesson.title),
    });
  }
  ruleClusters.sort((a, b) => b.lessons.length - a.lessons.length
    || a.id.localeCompare(b.id, 'ru'));

  // ── Второй источник кластеров: связные группы по tag ──
  //
  // Дубли ловят «одно правило в 3–4 копиях», но правило может жить и в
  // перефразированных уроках (Jaccard ниже порога). Тогда сигналом служит
  // тематический tag + СМЫСЛОВАЯ близость заголовков: группа принимается,
  // только если средняя попарная схожесть заголовков ≥ порога. Без этой
  // проверки группировка по tag давала 81 «кластер» из несвязанных уроков
  // (общая метка `тесты`/`docs` — область, а не правило) — проверено на
  // реальных 274 уроках.
  const TAG_CLUSTER_MIN_SIMILARITY = 0.12;
  const TAG_CLUSTER_MAX_SIZE = 4;
  const ruleEntries = entries.filter(isRuleish);
  const titleTokens = new Map<string, Set<string>>();
  for (const entry of ruleEntries) {
    titleTokens.set(entry.lesson.id.toLowerCase(), new Set(tokenizeTitle(entry.lesson.title)));
  }
  const tagFreq = new Map<string, number>();
  for (const entry of ruleEntries) {
    for (const tag of new Set((entry.lesson.tags || []).map(t => String(t).toLowerCase()))) {
      tagFreq.set(tag, (tagFreq.get(tag) || 0) + 1);
    }
  }
  const covered = new Set(ruleClusters.flatMap(c => c.lessons.map(id => id.toLowerCase())));
  const tagClusters: RuleCluster[] = [];
  for (const [tag, count] of [...tagFreq.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'))) {
    if (count < 2 || count > TAG_CLUSTER_MAX_SIZE) continue;
    const members = ruleEntries
      .filter(e => (e.lesson.tags || []).some(t => String(t).toLowerCase() === tag))
      .sort((a, b) => lessonStamp(b) - lessonStamp(a)
        || a.lesson.id.localeCompare(b.lesson.id, 'ru'));
    if (members.length < 2) continue;
    // Уже покрыто кластером дублей — не предлагаем второй раз
    if (members.every(e => covered.has(e.lesson.id.toLowerCase()))) continue;
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        sum += jaccardSets(
          titleTokens.get(members[i].lesson.id.toLowerCase()) || new Set(),
          titleTokens.get(members[j].lesson.id.toLowerCase()) || new Set(),
        );
        pairs += 1;
      }
    }
    if (pairs === 0 || sum / pairs < TAG_CLUSTER_MIN_SIMILARITY) continue;
    const canonical = members[0];
    tagClusters.push({
      id: `tag:${tag}`,
      tags: [tag],
      lessons: members.map(e => e.lesson.id).sort((a, b) => a.localeCompare(b, 'ru')),
      canonical: canonical.lesson.id,
      proposedLine: canonical.lesson.title,
      supersede: members
        .filter(e => e.lesson.id !== canonical.lesson.id)
        .map(e => e.lesson.id)
        .sort((a, b) => a.localeCompare(b, 'ru')),
      titles: members.map(e => e.lesson.title),
    });
    for (const entry of members) covered.add(entry.lesson.id.toLowerCase());
  }
  ruleClusters.push(...tagClusters);
  ruleClusters.sort((a, b) => b.lessons.length - a.lessons.length
    || a.id.localeCompare(b.id, 'ru'));

  const emptyBodies: EmptyBodyLesson[] = audit.findings
    .filter(f => f.type === 'empty_body')
    .map(f => ({
      id: f.lessonId,
      title: byId.get(f.lessonId.toLowerCase())?.lesson.title || '',
      skeleton: f.details.skeleton === true,
    }))
    .sort((a, b) => a.id.localeCompare(b.id, 'ru'));

  const supersedeCandidates = new Set<string>();
  for (const cluster of ruleClusters) for (const id of cluster.supersede) supersedeCandidates.add(id);
  for (const pair of duplicatePairs) supersedeCandidates.add(pair.supersede);

  return {
    total: entries.length,
    ruleClusters,
    duplicatePairs,
    emptyBodies,
    summary: {
      ruleClusters: ruleClusters.length,
      duplicatePairs: duplicatePairs.length,
      emptyBodies: emptyBodies.length,
      supersedeCandidates: supersedeCandidates.size,
    },
  };
}

/** Явные действия консолидации: только по списку ID и строк. */
export interface ConsolidationApplyOptions {
  /**
   * ID уроков, для которых применяется supersede-план их кластера/пары.
   *
   * Правило: если передан КАНОН кластера — в superseded уходят остальные
   * участники; если передан не-канон — в superseded уходит он сам (каноном
   * становится самый свежий урок кластера). Так `--apply-supersede lesson-211`
   * означает «применить план кластера, где lesson-211 — канон».
   */
  supersede?: string[];
  /** Строки, дописываемые в секцию AGENTS.md (дедуп по нормализованному тексту). */
  appendAgentsMd?: string[];
  /** Дата обновления уроков (YYYY-MM-DD), по умолчанию — сегодня. */
  date?: string;
}

/** Результат применения: что записано, что пропущено и почему. */
export interface ConsolidationApplyResult {
  /** Применённые supersede: oldId → newId. */
  superseded: { oldId: string; newId: string }[];
  /** Строки, реально добавленные в AGENTS.md. */
  appendedLines: string[];
  /** Строки, уже присутствовавшие (дедуп). */
  skippedLines: string[];
  /** ID, для которых не нашлось плана или урока. */
  notFound: string[];
  /** Путь к AGENTS.md, если он был изменён. */
  agentsMdPath: string | null;
}

/** Корень проекта: родитель backlog-директории (там лежит AGENTS.md). */
function projectRoot(cwd: string): string {
  const backlogDir = findBacklogDir(cwd);
  return backlogDir ? dirname(backlogDir) : cwd;
}

/**
 * Дописывает строки в секцию-маркер AGENTS.md (создаёт секцию при отсутствии).
 *
 * Дедупликация — по нормализованному тексту (без маркера списка, без лишних
 * пробелов, нижний регистр): повторный apply не плодит дубли, даже если
 * строка пришла с другим регистром или маркером.
 *
 * @returns добавленные и пропущенные (уже существующие) строки
 */
function appendToAgentsMd(
  root: string,
  lines: string[],
): { appended: string[]; skipped: string[]; path: string | null } {
  const path = join(root, 'AGENTS.md');
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  const existingNormalized = new Set(
    existing.split('\n').map(normalizeLine).filter(Boolean),
  );

  const appended: string[] = [];
  const skipped: string[] = [];
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) continue;
    const key = normalizeLine(line);
    if (!key) continue;
    if (existingNormalized.has(key)) {
      skipped.push(line);
      continue;
    }
    existingNormalized.add(key);
    appended.push(line);
  }
  if (appended.length === 0) return { appended, skipped, path: null };

  const bulletLines = appended.map(l => (l.startsWith('- ') ? l : `- ${l}`));
  let content = existing;
  if (content.includes(AGENTS_MD_MARKER)) {
    // Секция есть: дописываем строки в её конец (перед следующим H2 или в конец файла)
    const markerIdx = content.indexOf(AGENTS_MD_MARKER);
    const afterMarker = content.slice(markerIdx + AGENTS_MD_MARKER.length);
    const nextHeading = afterMarker.search(/\n##\s/);
    const insertAt = nextHeading === -1
      ? content.length
      : markerIdx + AGENTS_MD_MARKER.length + nextHeading + 1;
    const before = content.slice(0, insertAt).replace(/\n*$/, '\n');
    const after = content.slice(insertAt);
    content = `${before}${bulletLines.join('\n')}\n${after ? `\n${after.replace(/^\n+/, '')}` : ''}`;
  } else {
    const tail = content.replace(/\n*$/, '');
    content = `${tail ? `${tail}\n\n` : ''}${AGENTS_MD_SECTION_TITLE}\n\n${AGENTS_MD_MARKER}\n${bulletLines.join('\n')}\n`;
  }
  writeFileSync(path, content, 'utf-8');
  return { appended, skipped, path };
}

/**
 * Применяет план консолидации — ТОЛЬКО по явным ID и строкам (lesson-147).
 *
 * Никакого «применить всё найденное»: порог дублей 0.35 даёт ложные пары, а
 * AGENTS.md читается в каждый ход агента — мусор там дороже отсутствия
 * правила. План пересчитывается внутри, чтобы не зависеть от того, что
 * вызывающий передал из dry-run (корпус мог измениться).
 *
 * @param cwd — рабочая директория проекта
 * @param opts — списки ID для supersede и строки для AGENTS.md
 */
export function applyConsolidation(
  cwd: string,
  opts: ConsolidationApplyOptions,
): ConsolidationApplyResult {
  const result: ConsolidationApplyResult = {
    superseded: [],
    appendedLines: [],
    skippedLines: [],
    notFound: [],
    agentsMdPath: null,
  };

  const supersedeIds = (opts.supersede || []).map(s => String(s).trim()).filter(Boolean);
  if (supersedeIds.length > 0) {
    const plan = buildConsolidationPlan(cwd);
    // Карта «урок → канон его кластера/пары»
    const canonicalOf = new Map<string, string>();
    for (const cluster of plan.ruleClusters) {
      for (const id of cluster.lessons) canonicalOf.set(id.toLowerCase(), cluster.canonical);
    }
    for (const pair of plan.duplicatePairs) {
      if (!canonicalOf.has(pair.a.toLowerCase())) canonicalOf.set(pair.a.toLowerCase(), pair.canonical);
      if (!canonicalOf.has(pair.b.toLowerCase())) canonicalOf.set(pair.b.toLowerCase(), pair.canonical);
    }
    const membersOf = new Map<string, string[]>();
    for (const cluster of plan.ruleClusters) {
      for (const id of cluster.lessons) membersOf.set(id.toLowerCase(), cluster.lessons);
    }

    for (const id of supersedeIds) {
      const canonical = canonicalOf.get(id.toLowerCase());
      if (!canonical) {
        result.notFound.push(id);
        continue;
      }
      // Передан канон → supersede всех остальных участников кластера;
      // передан не-канон → supersede его самого каноном.
      const targets = canonical.toLowerCase() === id.toLowerCase()
        ? (membersOf.get(id.toLowerCase()) || []).filter(m => m.toLowerCase() !== id.toLowerCase())
        : [id];
      if (targets.length === 0) {
        result.notFound.push(id);
        continue;
      }
      for (const oldId of targets) {
        try {
          supersedeLesson(cwd, oldId, canonical);
          result.superseded.push({ oldId, newId: canonical });
        } catch {
          result.notFound.push(oldId);
        }
      }
    }
  }

  const lines = (opts.appendAgentsMd || []).map(s => String(s).trim()).filter(Boolean);
  if (lines.length > 0) {
    const written = appendToAgentsMd(projectRoot(cwd), lines);
    result.appendedLines = written.appended;
    result.skippedLines = written.skipped;
    result.agentsMdPath = written.path;
  }

  return result;
}

/**
 * Рендерит план консолидации в markdown (для CLI без --json).
 *
 * @param plan — план из buildConsolidationPlan
 */
export function formatConsolidationMarkdown(plan: ConsolidationPlan): string {
  const lines: string[] = [];
  lines.push(`Консолидация lessons: уроков ${plan.total}`);
  lines.push(`  кластеров правил: ${plan.summary.ruleClusters}`);
  lines.push(`  пар дублей: ${plan.summary.duplicatePairs}`);
  lines.push(`  пустых тел: ${plan.summary.emptyBodies}`);
  lines.push(`  кандидатов в superseded: ${plan.summary.supersedeCandidates}`);
  lines.push('');

  if (plan.ruleClusters.length > 0) {
    lines.push('## Кластеры правил → строка в AGENTS.md');
    lines.push('');
    for (const cluster of plan.ruleClusters) {
      lines.push(`  ${cluster.id} (${cluster.lessons.length} уроков)`);
      lines.push(`    строка: ${cluster.proposedLine}`);
      lines.push(`    канон: ${cluster.canonical}; supersede: ${cluster.supersede.join(', ')}`);
      for (const title of cluster.titles) lines.push(`      · ${title}`);
    }
    lines.push('');
  }

  if (plan.duplicatePairs.length > 0) {
    lines.push('## Пары дублей → supersede');
    lines.push('');
    for (const pair of plan.duplicatePairs) {
      lines.push(`  ${pair.a} ↔ ${pair.b} (${pair.similarity}) → канон ${pair.canonical}, supersede ${pair.supersede}`);
    }
    lines.push('');
  }

  if (plan.emptyBodies.length > 0) {
    lines.push('## Пустые тела (дозаполнить через lesson_update)');
    lines.push('');
    for (const item of plan.emptyBodies) {
      lines.push(`  ${item.id} — ${item.title}${item.skeleton ? ' (скелет)' : ''}`);
    }
    lines.push('');
  }

  lines.push('Ничего не записано: применение — только явными списками');
  lines.push('  --apply-supersede <id,…>   (канон кластера или урок-дубль)');
  lines.push('  --apply-agents <строка,…>  (дописать в секцию AGENTS.md)');
  return lines.join('\n');
}

/** Реэкспорт для CLI/MCP: маркер секции — единая точка правды. */
export { AGENTS_MD_SECTION_TITLE };
