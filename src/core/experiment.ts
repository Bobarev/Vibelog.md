/**
 * Модель экспериментов (VL-294) — карточка `backlog/experiments/exp-<id>.md`.
 *
 * Эксперимент — generic A/B-сравнение вариантов (спецификация — doc-21):
 * механика не требует LLM, поэтому карточка обязана хранить всё, что нужно
 * не-AI проекту (датасет, метрики, варианты) и AI-профилю (prompt, model,
 * judge). Секции `metrics` и `judge` фиксируются СРАЗУ, даже если их логика
 * появится позже (judge — VL-298): иначе тот, кто придёт делать judge,
 * начнёт с переделки парсера и потеряет уже записанные файлы.
 *
 * Формат файла: backlog/experiments/exp-<id>.md (YAML-фронтматтер + описание).
 * Каталог — расширение формата Vibelog.md: Backlog.md про него не знает
 * и игнорирует, round-trip задач не затрагивается.
 *
 * Соглашение о `variant.prompt` (фиксируется здесь, резолв — VL-296):
 * - `<name>`         — имя файла в prompts/ (частный → общий);
 * - `builtin:<phase>` — встроенный промпт фазы, файловая система не ищется.
 * Поле хранится просто строкой: парсер не валидирует формат, чтобы
 * не блокировать запись карточки до появления резолва.
 */

import {
  readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { experimentsDir, experimentRunsDir } from './paths.js';

/** Версия схемы карточки эксперимента: растёт при несовместимом изменении. */
export const SCHEMA_VERSION = 1;

/** Допустимые статусы эксперимента (производны от последнего прогона, doc-21 §4). */
export const EXPERIMENT_STATUSES = ['draft', 'running', 'completed', 'failed'];

/** Статус эксперимента. */
export type ExperimentStatus = 'draft' | 'running' | 'completed' | 'failed';

/** Описание варианта эксперимента (A/B/…). */
export interface VariantConfig {
  /** Человекочитаемая метка варианта. */
  label?: string;
  /** `<name>` файла в prompts/ или `builtin:<phase>` (резолв — VL-296). */
  prompt: string;
  /** id модели из models.available (опционально, AI-профиль). */
  model?: string;
  /** Произвольные параметры раннера (temperature и т.п.). */
  params?: Record<string, unknown>;
}

/** Метрики эксперимента (doc-21 §4). */
export interface ExperimentMetrics {
  /** Имя поля оценки в results.jsonl. */
  score_field: string;
  /** Направление улучшения для win-rate/дельты. */
  higher_is_better: boolean;
  /** Вариант-эталон (по умолчанию A). */
  baseline: string;
  /** Доп. метрики из row.custom. */
  custom: string[];
}

/** Конфигурация LLM-judge (логика — VL-298, схема фиксируется в VL-294). */
export interface JudgeConfig {
  enabled: boolean;
  /** id модели судьи; по умолчанию — models.default. */
  model?: string;
  /** Файл prompts/judge-*.md (без .md). */
  prompt?: string;
  /** Шкала оценки. */
  scale: 'numeric' | 'pass_fail';
  score_min: number;
  score_max: number;
}

/** Объект эксперимента (метаданные; тело — отдельно в ExperimentEntry). */
export interface Experiment {
  id: string;
  title: string;
  status: ExperimentStatus;
  schema_version: number;
  dataset: string;
  runner: string;
  metrics: ExperimentMetrics;
  /** MAP, не массив: A/B/C/D без миграции схемы (doc-21 §4). */
  variants: Record<string, VariantConfig>;
  judge?: JudgeConfig;
  created_date: string;
  updated_date: string;
  notes: string;
}

/** Входные данные эксперимента (все поля, кроме title, опциональны). */
export interface ExperimentInput {
  id?: string;
  title: string;
  status?: string;
  schema_version?: number;
  dataset?: string;
  runner?: string;
  metrics?: Partial<ExperimentMetrics>;
  variants?: Record<string, Partial<VariantConfig>>;
  judge?: Partial<JudgeConfig>;
  created_date?: string;
  updated_date?: string;
  notes?: string;
}

/** Запись эксперимента: метаданные + тело + путь к файлу. */
export interface ExperimentEntry {
  experiment: Experiment;
  body: string;
  path: string;
}

/** Текущая дата YYYY-MM-DD — для created_date/updated_date по умолчанию. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Имя файла карточки эксперимента: `exp-<id>.md` без slug.
 *
 * Slug намеренно не добавляется: id уже уникален, а прогоны и каталог
 * `exp-<id>/` строятся по тому же короткому имени — переименование
 * заголовка не должно ломать пути.
 */
export function experimentFilename(id: string): string {
  return `${id}.md`;
}

/**
 * Нормализует статус эксперимента.
 *
 * @throws если статус не входит в EXPERIMENT_STATUSES
 */
export function normalizeExperimentStatus(status: string): ExperimentStatus {
  const candidate = String(status || '').trim().toLowerCase();
  const canonical = EXPERIMENT_STATUSES.find(s => s === candidate);
  if (!canonical) {
    throw new Error(`Недопустимый статус эксперимента "${status}". Допустимые: ${EXPERIMENT_STATUSES.join(', ')}`);
  }
  return canonical as ExperimentStatus;
}

/** Нормализует произвольную map параметров (строки ключей, undefined → нет ключа). */
function normalizeParams(params?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Нормализует один вариант: prompt обязателен (пустая строка допускается —
 * валидация формата в VL-296), необязательные поля не создаются, если не заданы.
 */
function normalizeVariant(raw: Partial<VariantConfig>): VariantConfig {
  const variant: VariantConfig = { prompt: String(raw.prompt ?? '') };
  if (raw.label !== undefined && raw.label !== null && String(raw.label) !== '') {
    variant.label = String(raw.label);
  }
  if (raw.model !== undefined && raw.model !== null && String(raw.model) !== '') {
    variant.model = String(raw.model);
  }
  const params = normalizeParams(raw.params);
  if (params) variant.params = params;
  // Порядок ключей в объекте для карточки: label, prompt, model, params —
  // при сериализации это даёт стабильный frontmatter (диффы не шумят)
  const ordered: VariantConfig = { prompt: variant.prompt };
  if (variant.label !== undefined) ordered.label = variant.label;
  if (variant.model !== undefined) ordered.model = variant.model;
  if (variant.params !== undefined) ordered.params = variant.params;
  return ordered;
}

/** Нормализует метрики: значения по умолчанию — как в doc-21 §4. */
function normalizeMetrics(raw?: Partial<ExperimentMetrics>): ExperimentMetrics {
  const customRaw = raw?.custom;
  const custom = Array.isArray(customRaw)
    ? customRaw.map(c => String(c)).filter(c => c !== '')
    : (customRaw ? [String(customRaw)] : []);
  return {
    score_field: raw?.score_field !== undefined ? String(raw.score_field) : 'score',
    higher_is_better: raw?.higher_is_better === undefined ? true : Boolean(raw.higher_is_better),
    baseline: raw?.baseline !== undefined && String(raw.baseline) !== '' ? String(raw.baseline) : 'A',
    custom,
  };
}

/** Нормализует judge: enabled=false по умолчанию, опциональные поля не создаются. */
function normalizeJudge(raw?: Partial<JudgeConfig>): JudgeConfig | undefined {
  if (!raw) return undefined;
  const scale = raw.scale === 'pass_fail' ? 'pass_fail' : 'numeric';
  const judge: JudgeConfig = {
    enabled: raw.enabled === undefined ? false : Boolean(raw.enabled),
    scale,
    score_min: raw.score_min === undefined ? 1 : Number(raw.score_min),
    score_max: raw.score_max === undefined ? (scale === 'pass_fail' ? 1 : 10) : Number(raw.score_max),
  };
  if (raw.model !== undefined && raw.model !== null && String(raw.model) !== '') {
    judge.model = String(raw.model);
  }
  if (raw.prompt !== undefined && raw.prompt !== null && String(raw.prompt) !== '') {
    judge.prompt = String(raw.prompt);
  }
  return judge;
}

/**
 * Создаёт объект эксперимента с дефолтами (без записи файла).
 *
 * @throws если статус недопустим
 */
export function createExperiment(input: ExperimentInput): Experiment {
  const created = input.created_date || today();
  const variants: Record<string, VariantConfig> = {};
  for (const [key, value] of Object.entries(input.variants || {})) {
    variants[key] = normalizeVariant(value || {});
  }
  const experiment: Experiment = {
    id: input.id || '',
    title: input.title,
    status: normalizeExperimentStatus(input.status || 'draft'),
    schema_version: input.schema_version ?? SCHEMA_VERSION,
    dataset: input.dataset !== undefined ? String(input.dataset) : '',
    runner: input.runner !== undefined && String(input.runner) !== '' ? String(input.runner) : 'manual',
    metrics: normalizeMetrics(input.metrics),
    variants,
    created_date: created,
    updated_date: input.updated_date || created,
    notes: input.notes !== undefined && input.notes !== null ? String(input.notes) : '',
  };
  const judge = normalizeJudge(input.judge);
  if (judge) experiment.judge = judge;
  return experiment;
}

/** Приводит распарсенные из YAML значения к объекту Experiment (round-trip). */
function experimentFromData(data: Record<string, unknown>, fallbackId: string): Experiment {
  const rawVariants = (data.variants && typeof data.variants === 'object')
    ? data.variants as Record<string, unknown>
    : {};
  const variants: Record<string, Partial<VariantConfig>> = {};
  for (const [key, value] of Object.entries(rawVariants)) {
    // Вариант может быть записан скаляром (`A: builtin:spec`) — принимаем
    // такую сокращённую запись: prompt без label/model/params
    if (value && typeof value === 'object') {
      variants[key] = value as Partial<VariantConfig>;
    } else {
      variants[key] = { prompt: value === null || value === undefined ? '' : String(value) };
    }
  }
  const metricsRaw = (data.metrics && typeof data.metrics === 'object')
    ? data.metrics as Record<string, unknown>
    : {};
  const customRaw = metricsRaw.custom;
  const custom = Array.isArray(customRaw)
    ? customRaw.map(c => String(c))
    : (customRaw !== undefined && customRaw !== null && String(customRaw) !== '' ? [String(customRaw)] : []);
  const judgeRaw = (data.judge && typeof data.judge === 'object')
    ? data.judge as Record<string, unknown>
    : undefined;

  return createExperiment({
    id: (data.id as string) || fallbackId,
    title: (data.title as string) || '',
    status: (data.status as string) || 'draft',
    schema_version: data.schema_version === undefined || data.schema_version === null
      ? SCHEMA_VERSION
      : Number(data.schema_version),
    dataset: data.dataset === undefined || data.dataset === null ? '' : String(data.dataset),
    runner: data.runner === undefined || data.runner === null ? 'manual' : String(data.runner),
    metrics: {
      score_field: metricsRaw.score_field !== undefined ? String(metricsRaw.score_field) : undefined,
      higher_is_better: metricsRaw.higher_is_better === undefined
        ? undefined
        : Boolean(metricsRaw.higher_is_better),
      baseline: metricsRaw.baseline !== undefined ? String(metricsRaw.baseline) : undefined,
      custom,
    },
    variants,
    judge: judgeRaw
      ? {
        enabled: judgeRaw.enabled === undefined ? false : Boolean(judgeRaw.enabled),
        model: judgeRaw.model === undefined ? undefined : String(judgeRaw.model),
        prompt: judgeRaw.prompt === undefined ? undefined : String(judgeRaw.prompt),
        scale: judgeRaw.scale === 'pass_fail' ? 'pass_fail' : 'numeric',
        score_min: judgeRaw.score_min === undefined ? 1 : Number(judgeRaw.score_min),
        score_max: judgeRaw.score_max === undefined
          ? (judgeRaw.scale === 'pass_fail' ? 1 : 10)
          : Number(judgeRaw.score_max),
      }
      : undefined,
    created_date: (data.created_date as string) || '',
    updated_date: (data.updated_date as string) || (data.created_date as string) || '',
    notes: data.notes === undefined || data.notes === null ? '' : String(data.notes),
  });
}

/**
 * Сериализует эксперимент + тело в markdown.
 *
 * Пустые опциональные секции (judge, notes) опускаются — frontmatter чистый,
 * файл без judge остаётся байт-в-байт прежним при повторной записи.
 */
export function experimentToMarkdown(exp: Experiment, body?: string): string {
  const metrics = exp.metrics || normalizeMetrics();
  const variants: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(exp.variants || {})) {
    variants[key] = value;
  }
  const frontmatter: Record<string, unknown> = {
    id: exp.id,
    title: exp.title,
    status: exp.status,
    schema_version: exp.schema_version,
    dataset: exp.dataset,
    runner: exp.runner,
    metrics: {
      score_field: metrics.score_field,
      higher_is_better: metrics.higher_is_better,
      baseline: metrics.baseline,
      custom: metrics.custom || [],
    },
    variants,
    created_date: exp.created_date,
    updated_date: exp.updated_date,
  };
  if (exp.judge) {
    const judge: Record<string, unknown> = { enabled: exp.judge.enabled };
    if (exp.judge.model) judge.model = exp.judge.model;
    if (exp.judge.prompt) judge.prompt = exp.judge.prompt;
    judge.scale = exp.judge.scale;
    judge.score_min = exp.judge.score_min;
    judge.score_max = exp.judge.score_max;
    frontmatter.judge = judge;
  }
  if (exp.notes) frontmatter.notes = exp.notes;
  return serializeFrontmatter(frontmatter, body || '');
}

/**
 * Десериализует markdown в эксперимент + тело.
 *
 * @param content — содержимое файла exp-<id>.md
 * @param fallbackId — id по умолчанию (из имени файла), если во frontmatter его нет
 */
export function parseExperimentMarkdown(
  content: string,
  fallbackId: string = ''
): { experiment: Experiment; body: string } {
  const { data, body } = parseFrontmatter(content);
  return { experiment: experimentFromData(data, fallbackId), body: body || '' };
}

/**
 * Следующий id вида exp-<n> (max+1).
 *
 * Файлы без префикса exp- и посторонние markdown в каталоге игнорируются:
 * в backlog/experiments/ могут лежать служебные md (README и т.п.).
 */
export function nextExperimentId(entries: { experiment: Experiment }[]): string {
  let max = 0;
  for (const e of entries) {
    const m = String(e.experiment?.id || '').match(/^exp-(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `exp-${max + 1}`;
}

/**
 * Читает все эксперименты из backlog/experiments/.
 *
 * Берутся только файлы `exp-<n>.md` (или любые `*.md` с валидным id exp-N):
 * остальные файлы каталога пропускаются — id-нумерация не должна сбиваться
 * посторонним markdown.
 */
export function listExperiments(backlogDir: string): ExperimentEntry[] {
  const dir = experimentsDir(backlogDir);
  if (!existsSync(dir)) return [];
  const entries: ExperimentEntry[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isFile() || !d.name.endsWith('.md')) continue;
    const path = join(dir, d.name);
    const fallbackId = d.name.replace(/\.md$/, '');
    let parsed: { experiment: Experiment; body: string };
    try {
      parsed = parseExperimentMarkdown(readFileSync(path, 'utf-8'), fallbackId);
    } catch {
      // Битый YAML в постороннем файле не должен ломать листинг экспериментов
      continue;
    }
    if (!/^exp-\d+$/i.test(parsed.experiment.id)) continue;
    entries.push({ experiment: parsed.experiment, body: parsed.body, path });
  }
  // Сортировка по номеру: exp-2 идёт до exp-10 (строковое сравнение сломалось бы)
  entries.sort((a, b) => Number(a.experiment.id.replace(/\D/g, '')) - Number(b.experiment.id.replace(/\D/g, '')));
  return entries;
}

/**
 * Находит эксперимент по id (case-insensitive).
 *
 * @returns запись или null
 */
export function getExperiment(backlogDir: string, id: string): ExperimentEntry | null {
  const needle = String(id || '').toLowerCase();
  return listExperiments(backlogDir).find(e => e.experiment.id.toLowerCase() === needle) || null;
}

/** Вход writeExperiment: метаданные + markdown-тело. */
export interface WriteExperimentInput extends ExperimentInput {
  content?: string;
}

/**
 * Создаёт файл эксперимента (id генерируется exp-N, даты — сегодня,
 * если не заданы).
 *
 * @returns созданный эксперимент
 */
export function writeExperiment(backlogDir: string, input: WriteExperimentInput): Experiment {
  const dir = experimentsDir(backlogDir);
  mkdirSync(dir, { recursive: true });
  const entries = listExperiments(backlogDir);
  const exp = createExperiment({
    ...input,
    id: input.id || nextExperimentId(entries),
    created_date: input.created_date || today(),
    updated_date: input.updated_date || input.created_date || today(),
  });
  writeFileSync(join(dir, experimentFilename(exp.id)), experimentToMarkdown(exp, input.content || ''), 'utf-8');
  return exp;
}

// ── Прогоны (VL-296, doc-21 §8) ──

/** Статус прогона (`meta.json`). */
export type RunStatus = 'running' | 'completed' | 'failed';

/** `meta.json` прогона (doc-21 §8) — единственный «живой» файл каталога run-N. */
export interface RunMeta {
  schema_version: number;
  exp_id: string;
  run: number;
  status: RunStatus;
  runner: string;
  started_at: string;
  finished_at: string | null;
  /** pid процесса, который начал прогон; null — процесс не fork-ался (manual). */
  pid: number | null;
  /** Структура резолва (dataset + prompts) — воспроизводимость прогона. */
  resolution: Record<string, unknown>;
  results_ignored: boolean;
  /** Число валидных строк (заполняет `report`, не `record`). */
  n: number;
  /** Число отброшенных строк (заполняет `report`). */
  dropped: number;
  cost_total: number | null;
  pricing_missing: boolean;
  /** Номер прогона, перезапуском которого является этот (v2 `--rerun`). */
  rerun_of: number | null;
  /** Причина failed (обрыв, таймаут, ручной --recover). */
  reason: string | null;
  /**
   * Сводка, которую пишет `report` при завершении прогона (VL-297, doc-21 §8).
   *
   * Дублирует `n`/`dropped`/`cost_total` (они остаются для чтения старыми
   * потребителями), но сгруппированно: отчёт можно прочитать, не парся
   * `results.jsonl` — это важно при `results_ignored: true` (файл > 10 MB).
   * `null` — прогон ещё не закрыт.
   */
  summary?: RunSummary | null;
}

/** Сводка закрытого прогона (пишет `report`, VL-297). */
export interface RunSummary {
  /** Число валидных строк (конечный `score`). */
  n: number;
  /** Число отброшенных строк: ошибки и `score: null`. */
  dropped: number;
  /** Сумма стоимостей; null — тарифов нет. */
  cost_total: number | null;
}

/** Номер прогона по имени каталога `run-<N>`; null — имя не подходит. */
function runNumberFromName(name: string): number | null {
  const m = /^run-(\d+)$/.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * Номера существующих прогонов эксперимента (по возрастанию).
 *
 * @param runsDir — каталог эксперимента (`experiments/exp-<id>/`)
 */
export function listRunNumbers(runsDir: string): number[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => runNumberFromName(d.name))
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
}

/**
 * Следующий номер прогона: `max(существующих run-<N>) + 1`.
 *
 * Считается по каталогам, а не по meta.json: каталог — факт создания рана,
 * и «дырка» после ручного rm не должна приводить к переиспользованию номера.
 */
export function nextRunNumber(runsDir: string): number {
  const numbers = listRunNumbers(runsDir);
  return numbers.length === 0 ? 1 : numbers[numbers.length - 1] + 1;
}

/**
 * Создаёт каталог прогона атомарно.
 *
 * `mkdir` вызывается БЕЗ `recursive` на листовом уровне (родитель создаётся
 * отдельно, рекурсивно): именно нерекурсивный `mkdir` даёт `EEXIST` при гонке
 * двух процессов, и тогда номер увеличивается и попытка повторяется. С
 * `recursive: true` ядро молча вернуло бы существующий каталог, и два прогона
 * писали бы в один `results.jsonl` (потеря данных).
 *
 * @returns номер и путь созданного каталога
 * @throws если каталог не удалось создать за 100 попыток (не EEXIST-ошибка)
 */
export function createRunDir(backlogDir: string, expId: string): { run: number; runDir: string } {
  const runsDir = experimentRunsDir(backlogDir, expId);
  mkdirSync(runsDir, { recursive: true });
  let run = nextRunNumber(runsDir);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const runDir = join(runsDir, `run-${run}`);
    try {
      mkdirSync(runDir);
      return { run, runDir };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      run += 1;
    }
  }
  throw new Error(`Не удалось создать каталог прогона для ${expId}: номера run-* заняты (${run})`);
}

/** Путь к `meta.json` каталога прогона. */
export function metaPath(runDir: string): string {
  return join(runDir, 'meta.json');
}

/**
 * Записывает `meta.json` атомарно (temp + rename).
 *
 * Атомарность нужна по той же причине, что и для results: SIGINT посреди
 * записи не должен оставить битый JSON — иначе прогон «не читается» и
 * `--recover` нечего восстанавливать.
 */
export function writeMetaJson(runDir: string, meta: RunMeta): void {
  const path = metaPath(runDir);
  const tmp = join(runDir, `.${process.pid}.${Date.now()}.meta.tmp`);
  try {
    writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`, 'utf-8');
    renameSync(tmp, path);
  } catch (err) {
    try {
      if (existsSync(tmp)) rmSync(tmp, { force: true });
    } catch {
      // Уборка temp-файла не должна заслонять исходную ошибку записи
    }
    throw err;
  }
}

/**
 * Читает `meta.json` прогона.
 *
 * @returns meta или null, если файла нет либо он битый
 */
export function readMetaJson(runDir: string): RunMeta | null {
  const path = metaPath(runDir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as RunMeta;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    // Битый meta.json — не исключение: команды чтения ранов должны показывать
    // остальные раны, а битый лечится тем же --recover
    return null;
  }
}

/** Каталог прогона по номеру (без проверки существования). */
export function runDirFor(backlogDir: string, expId: string, run: number): string {
  return join(experimentRunsDir(backlogDir, expId), `run-${run}`);
}

/** Последний (наибольший) номер прогона эксперимента; null — прогонов нет. */
export function latestRunNumber(backlogDir: string, expId: string): number | null {
  const numbers = listRunNumbers(experimentRunsDir(backlogDir, expId));
  return numbers.length === 0 ? null : numbers[numbers.length - 1];
}

/** Результат проверки «завис ли прогон». */
export interface StaleRunInfo {
  /** true — прогон считается зависшим. */
  stale: boolean;
  /** Причина/пояснение для пользователя (пусто, если не завис). */
  reason: string;
}

/**
 * Проверяет правило «stale running» (doc-21 §4).
 *
 * Прогон завис, если `meta.status === 'running'`, `finished_at` пуст и pid
 * не жив (`process.kill(pid, 0)` бросает ESRCH). EPERM означает «процесс есть,
 * но не наш» — это НЕ зависание (например, ран запущен другим пользователем).
 *
 * @param meta — `meta.json` прогона
 */
export function detectStaleRun(meta: RunMeta | null): StaleRunInfo {
  if (!meta) return { stale: false, reason: '' };
  if (meta.status !== 'running') return { stale: false, reason: '' };
  if (meta.finished_at) return { stale: false, reason: '' };
  if (!meta.pid) {
    // manual-ран без процесса: «живость» определяется только данными,
    // закрывать его может report/recover — автоматически не считаем зависшим
    return { stale: false, reason: '' };
  }
  try {
    process.kill(meta.pid, 0);
    return { stale: false, reason: '' };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      return {
        stale: true,
        reason: `процесс ${meta.pid} не жив, прогон run-${meta.run} остался в статусе running`,
      };
    }
    // EPERM и прочее — процесс существует, значит не завис
    return { stale: false, reason: '' };
  }
}

/** Опции восстановления зависшего прогона. */
export interface RecoverRunOptions {
  /** Причина для meta.reason (по умолчанию — текст от detectStaleRun). */
  reason?: string;
}

/**
 * Переводит зависший прогон в `failed`, сохраняя частичные результаты.
 *
 * `results.jsonl` не трогается намеренно: upsert уже записал то, что успели
 * сделать, и эти строки валидны (doc-21 §4).
 *
 * @throws если прогон не зависший (status ≠ running или pid жив)
 */
export function recoverRun(backlogDir: string, expId: string, run: number, opts: RecoverRunOptions = {}): RunMeta {
  const runDir = runDirFor(backlogDir, expId, run);
  const meta = readMetaJson(runDir);
  if (!meta) {
    throw new Error(`meta.json прогона run-${run} не найден или битый: ${runDir}`);
  }
  if (meta.status !== 'running') {
    throw new Error(`Прогон run-${run} не в статусе running (${meta.status}) — восстанавливать нечего`);
  }
  const stale = detectStaleRun(meta);
  if (!stale.stale && opts.reason === undefined) {
    throw new Error(`Прогон run-${run} не завис (pid ${meta.pid ?? '—'} жив) — --recover не требуется`);
  }
  const updated: RunMeta = {
    ...meta,
    status: 'failed',
    finished_at: new Date().toISOString(),
    reason: opts.reason || stale.reason || 'прогон восстановлен вручную (--recover)',
  };
  writeMetaJson(runDir, updated);
  return updated;
}

/**
 * Пересчитывает статус эксперимента по его последнему прогону (doc-21 §4).
 *
 * Статус производный: он дублируется в карточке, чтобы `experiment list`
 * не читал все meta.json. Карточка без прогонов остаётся draft.
 */
export function syncExperimentStatus(backlogDir: string, expId: string): ExperimentStatus | null {
  const entry = getExperiment(backlogDir, expId);
  if (!entry) return null;
  const last = latestRunNumber(backlogDir, expId);
  let status: ExperimentStatus = 'draft';
  if (last !== null) {
    const meta = readMetaJson(runDirFor(backlogDir, expId, last));
    if (meta) status = meta.status as ExperimentStatus;
  }
  if (entry.experiment.status === status) return status;
  const updated: Experiment = {
    ...entry.experiment,
    status,
    updated_date: today(),
  };
  writeFileSync(entry.path, experimentToMarkdown(updated, entry.body), 'utf-8');
  return status;
}
