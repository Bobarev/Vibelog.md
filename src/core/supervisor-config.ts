/**
 * Конфигурация роли «Супервизор» (VL-270, doc-19 §7, §9, §12, §16).
 *
 * Модуль собирает в одном месте три источника настроек, которые раньше были бы
 * размазаны по вебу (lesson-37 — дублирующуюся логику выносим при первом праве):
 *
 * 1. Секция `supervisor` в `.vibelog/settings.json` — «пользовательская» часть
 *    (тик, лимиты, heal_attempts, режим параллельности). Модель её НЕ пишет:
 *    это страховка, которую нельзя разрешить себе самому (doc-19 §16).
 * 2. Файл `.vibelog/supervisor/settings.json` — знание о проекте: правила
 *    лечения `heal_rules` и `default_action`. Их модель МОЖЕТ править, но
 *    только при `allow_self_tuning: true`.
 * 3. `tuning.log` — история самонастроек (когда, что было, что стало, почему).
 *
 * Валидация терпимая (паттерн `loadWorkflows` в `src/core/workflow.ts` и
 * lesson-117): битое правило выпадает с предупреждением, битое значение
 * откатывается к дефолту — секция никогда не роняет тик и не отключает
 * остальные правила. Именно поэтому здесь нет ни throw, ни fail-closed:
 * супервизор обязан работать даже с наполовину испорченным конфигом.
 *
 * Модуль чистый (только fs + settings.js): его импортируют и core, и web, и
 * тесты — никаких зависимостей от оркестратора и LLM здесь быть не должно.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadSettings } from './settings.js';

/** Каталог данных супервизора (дублирует SUPERVISOR_DIR из web — core не зависит от web). */
export const SUPERVISOR_DATA_DIR = join('.vibelog', 'supervisor');

/** Период тика по умолчанию, секунды (doc-19 §7). */
export const DEFAULT_SUPERVISOR_TICK_SECONDS = 60;
/** Нижняя граница периода: тик чаще 5 с бессмысленно (фазы живут минутами). */
export const MIN_TICK_SECONDS = 5;
/** Верхняя граница периода: тик реже часа — уже не наблюдение. */
export const MAX_TICK_SECONDS = 3600;

/** Параллельных фаз по умолчанию (doc-19 §7 — 3, до VL-270 был 2). */
export const DEFAULT_MAX_PARALLEL_PHASES = 3;
/** Потолок параллельности: больше 8 одновременных фаз не проверяемо на практике. */
export const MAX_PARALLEL_PHASES_CEILING = 8;

/** Лечебных попыток на фазу по умолчанию (итого максимум 3 запуска, doc-19 §7). */
export const DEFAULT_HEAL_ATTEMPTS = 2;
/** Потолок лечебных попыток: 10 — предел здравого смысла, дальше нужен человек. */
export const MAX_HEAL_ATTEMPTS = 10;

/** Режим группировки по умолчанию: модель обязана обосновать каждую группу. */
export const DEFAULT_PARALLEL_MODE: ParallelMode = 'conservative';

/** Лимит итераций инструментов роли supervisor (doc-19 §7: 30 против 8 у прочих). */
export const DEFAULT_SUPERVISOR_CHAT_MAX_ITERATIONS = 30;
/** Потолок итераций роли (страховка от «сам себе разрешил»). */
export const MAX_SUPERVISOR_CHAT_MAX_ITERATIONS = 200;
/** Бюджет хода роли supervisor, секунды (doc-19 §7: 600 против 120 у прочих). */
export const DEFAULT_SUPERVISOR_CHAT_MAX_WALL_TIME = 600;
/** Потолок бюджета хода, секунды (сутки). */
export const MAX_SUPERVISOR_CHAT_MAX_WALL_TIME = 86400;

/** Закрытый набор действий лечения (doc-19 §12). */
export const HEAL_ACTIONS = ['retry', 'comment_and_retry', 'retry_once_then_bug', 'bug', 'stop'] as const;
export type HealAction = (typeof HEAL_ACTIONS)[number];

/** Известные ключи `when`: неизвестный — ошибка правила, но не выпадение. */
export const KNOWN_HEAL_WHEN_KEYS = [
  'repeat_share_min',
  'repeat_calls_min',
  'fail_reason_contains',
  'status_unchanged',
  'aborted',
] as const;

/**
 * Защищённые поля (doc-19 §16): их нельзя править самонастройкой — иначе модель
 * сама себе разрешает больше (снимает ограничение параллельности, добавляет
 * лечебных попыток). Лежат в основном `.vibelog/settings.json`; патч модели
 * отклоняется с причиной, а не молча игнорируется (AC14).
 */
export const PROTECTED_SUPERVISOR_KEYS: readonly string[] = [
  'max_parallel_phases',
  'heal_attempts',
  'allow_self_tuning',
  'parallel_mode',
];

/** Режим группировки фаз (doc-19 §14). */
export type ParallelMode = 'conservative' | 'aggressive';

/** Условие срабатывания правила лечения. */
export interface HealWhen {
  /** Доля повторов tool-вызовов, при которой правило срабатывает (0..1). */
  repeat_share_min?: number;
  /** Абсолютное число повторных tool-вызовов (≥1). */
  repeat_calls_min?: number;
  /** Подстроки в `fail_reason` (любая из них — совпадение, регистр не важен). */
  fail_reason_contains?: string[];
  /** Фаза завершилась, а статус задачи не сменился (нет прогресса). */
  status_unchanged?: boolean;
  /**
   * VL-289: фаза сама сообщила аварийное завершение (`aborted: true`).
   * Перезапуск такую причину детерминированно воспроизведёт (инцидент VL-285:
   * merge-конфликт) — правило обязано стоять раньше `no-progress` и давать
   * `bug`/`stop`, без retry.
   */
  aborted?: boolean;
}

/** Правило лечения уровня 1 (декларативное, модель может править). */
export interface HealRule {
  id: string;
  when: HealWhen;
  action: HealAction;
  /** Шаблон директивы (обязателен для comment_and_retry). */
  commentTemplate?: string;
}

/** Конфигурация лечения: упорядоченные правила + действие по умолчанию. */
export interface HealConfig {
  rules: HealRule[];
  defaultAction: HealAction;
  /** Предупреждения валидации (битые правила, неизвестные ключи). */
  errors: string[];
}

/** Настройки прогона целиком (секция supervisor + лимиты роли). */
export interface SupervisorRuntime {
  tickSeconds: number;
  maxParallelPhases: number;
  healAttempts: number;
  allowSelfTuning: boolean;
  parallelMode: ParallelMode;
  limits: {
    chatMaxIterations: number;
    /** Бюджет хода в миллисекундах (наружу конфиг в секундах — как в VL-269). */
    chatMaxWallTimeMs: number;
  };
  /** Ошибки валидации секции supervisor (битое значение → дефолт + текст). */
  errors: string[];
}

/**
 * Дефолтные правила лечения — ровно те, что в doc-19 §12. Лежат в коде, а не в
 * файле: проект без `.vibelog/supervisor/settings.json` должен получить рабочий
 * цикл лечения сразу (иначе фича есть, а пользы нет до ручной настройки).
 */
export const DEFAULT_HEAL_RULES: HealRule[] = [
  {
    // VL-289: фаза сама сказала «нужны действия человека» (aborted: true).
    // Перезапуск детерминированно воспроизведёт причину (VL-285: merge-конфликт
    // UU README.md воспроизводился, пока heal_attempts не сгорел) — поэтому
    // правило стоит ПЕРВЫМ, раньше repeat-loop-stuck и no-progress.
    // Действие `bug`, а не `stop`: bug и причину сохраняет, и задачу
    // замораживает; stop причину теряет.
    id: 'aborted-requires-human',
    when: { aborted: true },
    action: 'bug',
  },
  {
    // VL-284: раньше repeat-loop (comment_and_retry) перезапускал действительно
    // зацикленный ран, и повтор детерминированно воспроизводил тот же
    // payload-лимит (инцидент close VL-280: 5 попыток, payload 508 КБ). Порог
    // выше и действие жёстче: если повторов много, лечение рестартом уже
    // бесполезно — нужен разбор человеком/моделью в авто-баге.
    id: 'repeat-loop-stuck',
    when: { repeat_share_min: 0.3, repeat_calls_min: 15 },
    action: 'bug',
  },
  {
    id: 'repeat-loop',
    when: { repeat_share_min: 0.25, repeat_calls_min: 8 },
    action: 'comment_and_retry',
    commentTemplate:
      'Ты повторно обращался к тем же путям: {top_repeats}. Используй ранее полученный результат; ' +
      'следующий шаг — правка, а не чтение.',
  },
  {
    id: 'payload-limit',
    when: { fail_reason_contains: ['payload', 'max-payload'] },
    action: 'retry',
  },
  {
    id: 'wall-timeout',
    when: { fail_reason_contains: ['max-wall-time', 'таймаут', 'timeout'] },
    action: 'retry',
  },
  {
    id: 'no-progress',
    when: { status_unchanged: true },
    action: 'retry_once_then_bug',
  },
];

/** Действие по умолчанию, когда ни одно правило не совпало (doc-19 §12). */
export const DEFAULT_HEAL_ACTION: HealAction = 'bug';

/** Путь к файлу правил лечения. */
export function healRulesPath(cwd: string): string {
  return join(cwd, SUPERVISOR_DATA_DIR, 'settings.json');
}

/** Путь к журналу самонастроек. */
export function tuningLogPath(cwd: string): string {
  return join(cwd, SUPERVISOR_DATA_DIR, 'tuning.log');
}

/** Целое в диапазоне или null (мусор и границы — повод для дефолта). */
function intInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

/**
 * Читает секцию `supervisor` `.vibelog/settings.json` и лимиты роли.
 *
 * Дефолты берутся из doc-19 §7; невалидное значение откатывается к дефолту, а
 * в `errors` попадает человекочитаемая причина (AC: битая секция не роняет тик).
 */
export function resolveSupervisorRuntime(cwd: string): SupervisorRuntime {
  const errors: string[] = [];
  let tickSeconds = DEFAULT_SUPERVISOR_TICK_SECONDS;
  let maxParallelPhases = DEFAULT_MAX_PARALLEL_PHASES;
  let healAttempts = DEFAULT_HEAL_ATTEMPTS;
  let allowSelfTuning = false;
  let parallelMode: ParallelMode = DEFAULT_PARALLEL_MODE;
  let chatMaxIterations = DEFAULT_SUPERVISOR_CHAT_MAX_ITERATIONS;
  let chatMaxWallTimeMs = DEFAULT_SUPERVISOR_CHAT_MAX_WALL_TIME * 1000;

  const raw = loadSettings(cwd).supervisor;
  const section: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    errors.push('settings.json: секция supervisor должна быть объектом — взяты дефолты');
  }

  const tick = section.tick_seconds;
  if (tick !== undefined) {
    const v = intInRange(tick, MIN_TICK_SECONDS, MAX_TICK_SECONDS);
    if (v === null) {
      errors.push(`settings.json: supervisor.tick_seconds должен быть целым ${MIN_TICK_SECONDS}..${MAX_TICK_SECONDS}`);
    } else tickSeconds = v;
  }

  const mp = section.max_parallel_phases;
  if (mp !== undefined) {
    const v = intInRange(mp, 1, MAX_PARALLEL_PHASES_CEILING);
    if (v === null) {
      errors.push(
        `settings.json: supervisor.max_parallel_phases должен быть целым 1..${MAX_PARALLEL_PHASES_CEILING}`,
      );
    } else maxParallelPhases = v;
  }

  const attempts = section.heal_attempts;
  if (attempts !== undefined) {
    const v = intInRange(attempts, 0, MAX_HEAL_ATTEMPTS);
    if (v === null) {
      errors.push(`settings.json: supervisor.heal_attempts должен быть целым 0..${MAX_HEAL_ATTEMPTS}`);
    } else healAttempts = v;
  }

  const tuning = section.allow_self_tuning;
  if (tuning !== undefined) {
    if (typeof tuning !== 'boolean') {
      errors.push('settings.json: supervisor.allow_self_tuning должен быть true/false');
    } else allowSelfTuning = tuning;
  }

  const mode = section.parallel_mode;
  if (mode !== undefined) {
    if (mode !== 'conservative' && mode !== 'aggressive') {
      errors.push('settings.json: supervisor.parallel_mode должен быть conservative|aggressive');
    } else parallelMode = mode;
  }

  const limits = section.limits;
  if (limits !== undefined) {
    if (limits === null || typeof limits !== 'object' || Array.isArray(limits)) {
      errors.push('settings.json: supervisor.limits должен быть объектом с chat_max_iterations/chat_max_wall_time');
    } else {
      const l = limits as Record<string, unknown>;
      const it = l.chat_max_iterations;
      if (it !== undefined) {
        const v = intInRange(it, 1, MAX_SUPERVISOR_CHAT_MAX_ITERATIONS);
        if (v === null) {
          errors.push(
            `settings.json: supervisor.limits.chat_max_iterations должен быть целым 1..${MAX_SUPERVISOR_CHAT_MAX_ITERATIONS}`,
          );
        } else chatMaxIterations = v;
      }
      const wt = l.chat_max_wall_time;
      if (wt !== undefined) {
        const v = intInRange(wt, 1, MAX_SUPERVISOR_CHAT_MAX_WALL_TIME);
        if (v === null) {
          errors.push(
            `settings.json: supervisor.limits.chat_max_wall_time должен быть целым 1..${MAX_SUPERVISOR_CHAT_MAX_WALL_TIME} (сек)`,
          );
        } else chatMaxWallTimeMs = v * 1000;
      }
    }
  }

  return {
    tickSeconds,
    maxParallelPhases,
    healAttempts,
    allowSelfTuning,
    parallelMode,
    limits: { chatMaxIterations, chatMaxWallTimeMs },
    errors,
  };
}

/**
 * Валидирует одно правило лечения.
 *
 * Возвращает правило либо null и пишет причину в `errors` — правило выпадает,
 * остальные продолжают работать (паттерн loadWorkflows). Неизвестный ключ в
 * `when` — предупреждение без выпадения: правило описано по будущей версии
 * конфига, и терять его из-за лишнего ключа неверно (fail-soft).
 */
export function validateHealRule(value: unknown, index: number, errors: string[]): HealRule | null {
  const label = typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'
    ? `"${(value as { id: string }).id}"`
    : `#${index + 1}`;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`supervisor.settings.json: heal_rules[${index}] — не объект, правило выпало`);
    return null;
  }
  const r = value as Record<string, unknown>;

  if (typeof r.id !== 'string' || r.id.trim() === '') {
    errors.push(`supervisor.settings.json: heal_rules[${index}] — пустой id, правило выпало`);
    return null;
  }
  const id = r.id.trim();

  if (typeof r.action !== 'string' || !HEAL_ACTIONS.includes(r.action as HealAction)) {
    errors.push(
      `supervisor.settings.json: правило ${label} — action "${String(r.action)}" вне набора ${HEAL_ACTIONS.join('|')}, правило выпало`,
    );
    return null;
  }
  const action = r.action as HealAction;

  if (r.when === null || typeof r.when !== 'object' || Array.isArray(r.when)) {
    errors.push(`supervisor.settings.json: правило ${label} — "when" должен быть объектом, правило выпало`);
    return null;
  }
  const when: HealWhen = {};
  const w = r.when as Record<string, unknown>;
  let knownKeys = 0;

  for (const [key, val] of Object.entries(w)) {
    if (!(KNOWN_HEAL_WHEN_KEYS as readonly string[]).includes(key)) {
      // Неизвестный ключ — предупреждение, правило остаётся рабочим
      errors.push(`supervisor.settings.json: правило ${label} — неизвестный ключ when.${key} (игнорируется)`);
      continue;
    }
    knownKeys += 1;
    if (key === 'repeat_share_min') {
      if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 1) {
        errors.push(`supervisor.settings.json: правило ${label} — repeat_share_min должен быть числом 0..1, правило выпало`);
        return null;
      }
      when.repeat_share_min = val;
    } else if (key === 'repeat_calls_min') {
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 1) {
        errors.push(`supervisor.settings.json: правило ${label} — repeat_calls_min должен быть целым ≥1, правило выпало`);
        return null;
      }
      when.repeat_calls_min = val;
    } else if (key === 'fail_reason_contains') {
      if (
        !Array.isArray(val) ||
        val.length === 0 ||
        !val.every((x): x is string => typeof x === 'string' && x.trim() !== '')
      ) {
        errors.push(
          `supervisor.settings.json: правило ${label} — fail_reason_contains должен быть непустым массивом строк, правило выпало`,
        );
        return null;
      }
      when.fail_reason_contains = val.map(x => x.trim());
    } else if (key === 'status_unchanged') {
      if (typeof val !== 'boolean') {
        errors.push(`supervisor.settings.json: правило ${label} — status_unchanged должен быть true/false, правило выпало`);
        return null;
      }
      when.status_unchanged = val;
    } else if (key === 'aborted') {
      // VL-289: булев признак «фаза сама сообщила aborted» — проверка типа как
      // у status_unchanged, невалидное значение выкидывает правило
      if (typeof val !== 'boolean') {
        errors.push(`supervisor.settings.json: правило ${label} — aborted должен быть true/false, правило выпало`);
        return null;
      }
      when.aborted = val;
    }
  }

  if (knownKeys === 0) {
    errors.push(`supervisor.settings.json: правило ${label} — в "when" нет ни одного известного условия, правило выпало`);
    return null;
  }

  let commentTemplate: string | undefined;
  // Принимаем оба написания: на диске ключ snake_case (совместимость с
  // doc-19 §12), а правило, прошедшее через память тика, несёт camelCase —
  // без этого шаблон терялся бы при самонастройке «текущими» правилами.
  const rawTemplate = r.comment_template ?? r.commentTemplate;
  if (rawTemplate !== undefined) {
    if (typeof rawTemplate !== 'string' || rawTemplate.trim() === '') {
      errors.push(`supervisor.settings.json: правило ${label} — comment_template должен быть непустой строкой, правило выпало`);
      return null;
    }
    commentTemplate = rawTemplate;
  }
  if (action === 'comment_and_retry' && commentTemplate === undefined) {
    errors.push(
      `supervisor.settings.json: правило ${label} — action comment_and_retry требует comment_template, правило выпало`,
    );
    return null;
  }

  return commentTemplate === undefined ? { id, when, action } : { id, when, action, commentTemplate };
}

/**
 * Читает правила лечения из `.vibelog/supervisor/settings.json`.
 *
 * Нет файла/битый JSON/невалидный `heal_rules` → дефолтные правила из кода
 * (AC: цикл лечения работает «из коробки»). Частичная валидность сохраняется:
 * валидные правила остаются, битые выпадают с предупреждением.
 */
export function loadHealRules(cwd: string): HealConfig {
  const errors: string[] = [];
  const path = healRulesPath(cwd);
  if (!existsSync(path)) {
    return { rules: DEFAULT_HEAL_RULES.slice(), defaultAction: DEFAULT_HEAL_ACTION, errors };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    errors.push('supervisor/settings.json: файл не читается как JSON — взяты дефолтные правила лечения');
    return { rules: DEFAULT_HEAL_RULES.slice(), defaultAction: DEFAULT_HEAL_ACTION, errors };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('supervisor/settings.json: ожидается объект — взяты дефолтные правила лечения');
    return { rules: DEFAULT_HEAL_RULES.slice(), defaultAction: DEFAULT_HEAL_ACTION, errors };
  }

  const section = raw as Record<string, unknown>;
  const rawRules = section.heal_rules;
  let rules: HealRule[] = DEFAULT_HEAL_RULES.slice();
  if (rawRules === undefined) {
    errors.push('supervisor/settings.json: секция heal_rules отсутствует — взяты дефолтные правила лечения');
  } else if (!Array.isArray(rawRules)) {
    errors.push('supervisor/settings.json: heal_rules должен быть массивом — взяты дефолтные правила лечения');
  } else {
    rules = [];
    rawRules.forEach((value, index) => {
      const rule = validateHealRule(value, index, errors);
      if (rule !== null) rules.push(rule);
    });
  }

  let defaultAction: HealAction = DEFAULT_HEAL_ACTION;
  const rawDefault = section.default_action;
  if (rawDefault !== undefined) {
    if (typeof rawDefault !== 'string' || !HEAL_ACTIONS.includes(rawDefault as HealAction)) {
      errors.push(
        `supervisor/settings.json: default_action "${String(rawDefault)}" вне набора ${HEAL_ACTIONS.join('|')} — взят ${DEFAULT_HEAL_ACTION}`,
      );
    } else defaultAction = rawDefault as HealAction;
  }

  return { rules, defaultAction, errors };
}

/** Каталог супервизора создаётся лениво (проект без него — норма). */
function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

/**
 * Пишет правила лечения атомарно (temp + rename).
 *
 * Атомарность здесь не формальность: файл читает тик, а правит его модель —
 * половина файла, прочитанная в момент записи, дала бы «то пустой массив
 * правил, то битый JSON» и сбросила лечение на дефолты посреди прогона.
 */
export function saveHealRules(cwd: string, rules: HealRule[], defaultAction: HealAction): void {
  const path = healRulesPath(cwd);
  ensureDir(path);
  const body: Record<string, unknown> = {
    heal_rules: rules.map(r =>
      r.commentTemplate === undefined
        ? { id: r.id, when: r.when, action: r.action }
        : { id: r.id, when: r.when, action: r.action, comment_template: r.commentTemplate },
    ),
    default_action: defaultAction,
  };
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

/** Результат применения самонастройки: что применилось, что отклонено, строка лога. */
export interface SelfTuningResult {
  applied: { heal_rules?: HealRule[]; default_action?: HealAction };
  rejected: string[];
  /** Строка для tuning.log либо null, если применять было нечего. */
  tuningLogLine: string | null;
}

/**
 * Применяет самонастройку модели к файлу правил лечения (doc-19 §16).
 *
 * Правила:
 * - принимаются только `heal_rules` и `default_action`; `comment_template`
 *   правится только ВНУТРИ правила (верхнеуровневый ключ отклоняется);
 * - любое упоминание защищённых полей (PROTECTED_SUPERVISOR_KEYS) — отказ с
 *   причиной (AC14: max_parallel_phases/heal_attempts/allow_self_tuning/
 *   parallel_mode модель не правит даже при allow_self_tuning=true);
 * - каждое новое правило проходит ту же валидацию, что и при чтении: битые
 *   выпадают с причиной;
 * - нечего применять → файл НЕ переписывается, `tuningLogLine: null`.
 *
 * @returns applied (что записалось), rejected (причины отказов), строка лога
 */
export function applySelfTuning(
  cwd: string,
  current: HealConfig,
  patch: Record<string, unknown>,
  reason: string,
  now: Date = new Date(),
): SelfTuningResult {
  const rejected: string[] = [];
  const applied: SelfTuningResult['applied'] = {};
  const errors: string[] = [];

  for (const key of Object.keys(patch)) {
    if (PROTECTED_SUPERVISOR_KEYS.includes(key)) {
      rejected.push(`ключ "${key}" защищённый: правится только пользователем`);
    } else if (key !== 'heal_rules' && key !== 'default_action') {
      rejected.push(`ключ "${key}" не поддержан самонастройкой (разрешены heal_rules и default_action)`);
    }
  }

  let nextRules = current.rules;
  if (patch.heal_rules !== undefined) {
    if (!Array.isArray(patch.heal_rules)) {
      rejected.push('heal_rules должен быть массивом правил');
    } else {
      const parsed: HealRule[] = [];
      patch.heal_rules.forEach((value, index) => {
        const rule = validateHealRule(value, index, errors);
        if (rule !== null) parsed.push(rule);
      });
      if (parsed.length > 0) {
        nextRules = parsed;
        applied.heal_rules = parsed;
      } else {
        rejected.push('ни одного валидного правила в heal_rules — изменения не применены');
      }
    }
  }

  let nextAction = current.defaultAction;
  if (patch.default_action !== undefined) {
    if (typeof patch.default_action !== 'string' || !HEAL_ACTIONS.includes(patch.default_action as HealAction)) {
      rejected.push(
        `default_action "${String(patch.default_action)}" вне набора ${HEAL_ACTIONS.join('|')}`,
      );
    } else {
      nextAction = patch.default_action as HealAction;
      applied.default_action = nextAction;
    }
  }

  if (applied.heal_rules === undefined && applied.default_action === undefined) {
    return { applied, rejected: [...rejected, ...errors], tuningLogLine: null };
  }

  const before = JSON.stringify({
    heal_rules: current.rules.map(r => ({ id: r.id, action: r.action })),
    default_action: current.defaultAction,
  });
  const after = JSON.stringify({
    heal_rules: nextRules.map(r => ({ id: r.id, action: r.action })),
    default_action: nextAction,
  });
  saveHealRules(cwd, nextRules, nextAction);

  const line =
    `${now.toISOString()} было=${before} стало=${after} ` +
    `причина=${reason.trim() === '' ? 'модель не объяснила' : reason.trim().replace(/\s+/g, ' ')}`;
  const logPath = tuningLogPath(cwd);
  ensureDir(logPath);
  appendFileSync(logPath, `${line}\n`, 'utf8');

  return { applied, rejected: [...rejected, ...errors], tuningLogLine: line };
}