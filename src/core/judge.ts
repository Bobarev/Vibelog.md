/**
 * LLM-judge для экспериментов (VL-298, doc-21 §4, §11) — MVP-опция.
 *
 * Judge ставит `score` строкам `results.jsonl`, которые пришли без оценки
 * (manual runner без метрики, внешний раннер). Базовая механика эксперимента
 * работает и без него: `score: null` — законное значение, поэтому judge не
 * блокирует MVP-сценарий (doc-21 §4).
 *
 * Ключевые решения:
 * - **Схему judge не переделываем**: секция frontmatter парсится в
 *   `core/experiment.ts` (`JudgeConfig`, VL-294). Здесь только валидация
 *   значений и использование — иначе два парсера разошлись бы в дефолтах
 *   `score_min`/`score_max`, и файл, записанный одним, читался бы другим иначе.
 * - **HTTP-слой не дублируется**: клиент берётся из `createLlmClient`
 *   (`src/agent/llm.ts`) — ретраи, api_mode (chat/responses), заголовки уже
 *   отлажены. В тестах вместо сети передаётся мок-`LlmClient`.
 * - **Стоимость судьи отдельно от стоимости варианта** (doc-21 §11):
 *   `judge_usage` / `cost_judge` в `meta.json`. Примешивать их к `cost` строки
 *   нельзя: вариант стал бы «дороже» из-за оценки, а не из-за работы.
 * - **Ошибка одной строки не роняет прогон**: строка остаётся со `score: null`,
 *   причина уходит в `error`/`error_kind: 'judge'` — это ровно то состояние,
 *   которое штатно переживает `report` (dropped).
 */

import { calculateCost } from './analytics.js';
import { resolveActiveModel, resolveModelById } from './models.js';
import type { ActiveModel } from './models.js';
import type { ApiMode, ChatMessage, LlmClient } from '../agent/llm.js';
import type { JudgeConfig } from './experiment.js';
import type { DatasetRow } from './dataset.js';
import type { ResultRow, ResultUsage } from './results.js';

/** Проблема конфигурации judge (не исключение — список для пользователя). */
export interface JudgeConfigProblem {
  /** Поле секции judge: scale | score_min | score_max | model | prompt. */
  field: string;
  /** Сообщение на русском для пользователя. */
  message: string;
}

/**
 * Валидирует секцию `judge` из frontmatter.
 *
 * Парсер VL-294 уже нормализовал значения (scale ∈ numeric|pass_fail,
 * числа приведены), поэтому здесь проверяется только то, что нормализация
 * пропускает сознательно: конечность чисел и порядок границ шкалы.
 *
 * @returns [] — конфигурация пригодна к работе; иначе понятные проблемы
 */
export function validateJudgeConfig(judge?: JudgeConfig): JudgeConfigProblem[] {
  if (!judge) {
    return [{ field: 'judge', message: 'секция judge отсутствует в карточке эксперимента' }];
  }
  const problems: JudgeConfigProblem[] = [];
  if (judge.scale !== 'numeric' && judge.scale !== 'pass_fail') {
    problems.push({
      field: 'scale',
      message: `judge.scale="${String(judge.scale)}" — допустимо numeric или pass_fail`,
    });
  }
  const min = Number(judge.score_min);
  const max = Number(judge.score_max);
  if (!Number.isFinite(min)) {
    problems.push({ field: 'score_min', message: `judge.score_min="${String(judge.score_min)}" — ожидается число` });
  }
  if (!Number.isFinite(max)) {
    problems.push({ field: 'score_max', message: `judge.score_max="${String(judge.score_max)}" — ожидается число` });
  }
  if (Number.isFinite(min) && Number.isFinite(max) && min >= max) {
    problems.push({
      field: 'score_min',
      message: `judge.score_min (${min}) должен быть меньше judge.score_max (${max})`,
    });
  }
  if (judge.scale === 'pass_fail' && Number.isFinite(min) && Number.isFinite(max)) {
    // pass_fail — это 1/0 числом (doc-21 §13, решение 3): иначе median/win_rate
    // потребовали бы отдельной ветки для булевых значений.
    if (min !== 0 || max !== 1) {
      problems.push({
        field: 'score_min',
        message: `для scale=pass_fail шкала фиксирована 0..1, получено ${min}..${max}`,
      });
    }
  }
  if (!judge.enabled) {
    problems.push({ field: 'enabled', message: 'judge.enabled=false — оценка судьёй выключена' });
  }
  return problems;
}

/** Опции LLM-вызова судьи (мок в тестах, явный apiMode, cwd настроек). */
export interface JudgeLlmOptions {
  /** Готовый клиент (тесты, повторное использование). Без него создаётся createLlmClient. */
  client?: LlmClient;
  /**
   * Каталог проекта для чтения `models`/`providers` из settings.json.
   * В тестах — mkdtemp (иначе подхватится локальный models.default, lesson-78/84).
   */
  cwd?: string;
  /**
   * Режим API явно: без него `createLlmClient` резолвит активную модель и
   * уезжает на `/responses` при `api_mode: responses` в локальном settings.json
   * (lesson-78/84/145). По умолчанию 'chat' — детерминированно в тестах.
   */
  apiMode?: ApiMode;
  /** Максимум повторов (пробрасывается в клиент; в тестах 0-1). */
  maxRetries?: number;
  /** Базовая пауза повторов, мс (в тестах 1). */
  retryDelayMs?: number;
}

/** Итог работы судьи по строкам. */
export interface JudgeRunResult {
  /** Строки результатов с заполненным `score` (или прежним, если judge не смог). */
  rows: ResultRow[];
  /** Сколько строк получило оценку. */
  scored: number;
  /** Сколько строк осталось без оценки (нет output, ошибка судьи, мусор в ответе). */
  skipped: number;
  /** Суммарный usage судейских вызовов (doc-21 §11: отдельно от варианта). */
  usage: ResultUsage;
  /** Стоимость судьи; `null` — тарифа модели судьи нет (не 0). */
  cost: number | null;
  /** Тариф модели судьи отсутствовал — попадает в meta как judge_pricing_missing. */
  pricingMissing: boolean;
  /** Модель судьи (id из models.available) либо null (env-fallback). */
  model: string | null;
}

/** Пара «строка датасета + результат варианта» — вход судьи. */
export interface JudgePair {
  /** Строка датасета: источник `expected_ac`/`input`. */
  dataset?: DatasetRow;
  /** Результат варианта: `output` оценивается, `score` перезаписывается. */
  result: ResultRow;
}

/** Приводит внутренний usage клиента к формату results/meta (§7, §11). */
function toResultUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  total_tokens: number;
}): ResultUsage {
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cache: usage.cache_read_input_tokens,
    total: usage.total_tokens,
    requests: 1,
  };
}

/** Складывает usage (undefined-поля считаются нулями). */
function addResultUsage(target: ResultUsage, add: ResultUsage): ResultUsage {
  return {
    input: (target.input ?? 0) + (add.input ?? 0),
    output: (target.output ?? 0) + (add.output ?? 0),
    cache: (target.cache ?? 0) + (add.cache ?? 0),
    total: (target.total ?? 0) + (add.total ?? 0),
    requests: (target.requests ?? 0) + (add.requests ?? 0),
  };
}

/** Ноль-usage судьи (нет ни одного вызова). */
function emptyUsage(): ResultUsage {
  return { input: 0, output: 0, cache: 0, total: 0, requests: 0 };
}

/**
 * Строит текст промпта судьи.
 *
 * `expected_ac` — единственный канон ожидаемого результата (doc-21 §5);
 * синоним `expected` читается парсером датасета заранее, поэтому здесь он
 * не обрабатывается. Отсутствие `expected_ac` и `input` — не ошибка: судья
 * оценивает только `output` (например, оценка качества текста без эталона).
 *
 * Шкала описывается явно и в двух формах: «7/10» и «0.7» понимаются
 * разными людьми, а судья — тоже модель; без указания формата ответы
 * приходят в обоих видах (это нормально, `parseJudgeScore` терпим).
 *
 * @returns текст user-сообщения судьи
 */
export function buildJudgePrompt(row: DatasetRow | undefined, result: ResultRow, judge: JudgeConfig): string {
  const parts: string[] = [];
  parts.push('Ты — строгий судья эксперимента. Оцени, насколько результат варианта соответствует ожидаемому.');
  parts.push('');
  parts.push(`ID задачи: ${result.task_id}`);
  parts.push(`Вариант: ${result.variant}`);

  const expected = (row?.expected_ac ?? '').trim();
  if (expected) {
    parts.push('');
    parts.push('Ожидаемый результат (критерий приёмки):');
    parts.push(expected);
  }
  const input = (row?.input ?? '').trim();
  if (input) {
    parts.push('');
    parts.push('Вход задачи:');
    parts.push(input.length > 4000 ? `${input.slice(0, 4000)}…` : input);
  }

  const output = (result.output ?? '').trim();
  parts.push('');
  parts.push('Результат варианта:');
  parts.push(output.length > 8000 ? `${output.slice(0, 8000)}…` : (output || '(пусто)'));

  parts.push('');
  if (judge.scale === 'pass_fail') {
    parts.push('Оцени результат по шкале pass_fail: 1 — соответствует ожидаемому, 0 — не соответствует.');
    parts.push('Ответь одной строкой: PASS или FAIL.');
  } else {
    parts.push(`Оцени результат числом от ${judge.score_min} до ${judge.score_max} (${judge.score_min} — совсем не соответствует, ${judge.score_max} — полностью соответствует).`);
    parts.push(`Ответь одной строкой в формате ${judge.score_max}/${judge.score_max} и кратким обоснованием.`);
  }
  return parts.join('\n');
}

/** Сообщения для клиента: системная инструкция + промпт строки. */
export function buildJudgeMessages(
  row: DatasetRow | undefined,
  result: ResultRow,
  judge: JudgeConfig,
): ChatMessage[] {
  return [
    { role: 'system', content: 'Ты оцениваешь результаты эксперимента. Отвечай кратко и по формату.' },
    { role: 'user', content: buildJudgePrompt(row, result, judge) },
  ];
}

/** Число из первого подходящего числового фрагмента текста. */
function firstNumber(text: string): number | null {
  // «0.7» и «,7» — десятичная запятая встречается в русских ответах
  const m = /-?\d+(?:[.,]\d+)?/.exec(text);
  if (!m) return null;
  const value = Number(m[0].replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

/** Дробь вида «7/10» → пара чисел. */
function fraction(text: string): { num: number; den: number } | null {
  const m = /(-?\d+(?:[.,]\d+)?)\s*\/\s*(-?\d+(?:[.,]\d+)?)/.exec(text);
  if (!m) return null;
  const num = Number(m[1].replace(',', '.'));
  const den = Number(m[2].replace(',', '.'));
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return { num, den };
}

/**
 * Разбирает ответ судьи в число.
 *
 * Поддерживаемые формы (проверяются в этом порядке — от точных к общим):
 * - `pass_fail`: PASS/FAIL, passed/failed, true/false, yes/no, да/нет, 1/0 → 1 или 0;
 * - `numeric` + дробь `7/10`: знаменатель совпал с `score_max` → числитель;
 *   шкала 0..1 → отношение (0.7); иначе — числитель;
 * - `numeric` + процент `85%` при шкале 0..1 → 0.85;
 * - `numeric` + первое число в тексте.
 *
 * Значение вне `[score_min, score_max]` → `null`: судья ответил не по шкале,
 * и «притянуть» ответ обрезкой означало бы записать 10 вместо «не понял».
 *
 * @returns число в шкале judge либо null (мусор/пусто/вне шкалы)
 */
export function parseJudgeScore(text: string, judge: JudgeConfig): number | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (judge.scale === 'pass_fail') {
    const min = Number.isFinite(judge.score_min) ? judge.score_min : 0;
    const max = Number.isFinite(judge.score_max) ? judge.score_max : 1;
    const toScore = (pass: boolean): number => (pass ? max : min);
    /**
     * Поиск слова с границами по БУКВАМ юникода.
     *
     * `\b` здесь не работает: он ASCII-ориентирован, и кириллица считается
     * не-словом — `\bда\b` не совпало бы ни с «да», ни с «нет» (найдено
     * тестом). Property-escape `\p{L}` даёт настоящие границы слова.
     */
    const hasWord = (word: string): boolean =>
      new RegExp(`(?<!\\p{L})${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`, 'u').test(lower);
    // Порядок важен: отрицание проверяется первым — «не соответствует»
    // содержит «соответствует», «failed» не должно трактоваться как «pass»
    if (hasWord('не соответствует') || hasWord('fail') || hasWord('failed')
      || hasWord('false') || hasWord('no') || hasWord('нет')) {
      return toScore(false);
    }
    if (hasWord('pass') || hasWord('passed') || hasWord('true') || hasWord('yes')
      || hasWord('да') || hasWord('соответствует')) {
      return toScore(true);
    }
    const num = fraction(lower) ?? (firstNumber(lower) !== null ? { num: firstNumber(lower) as number, den: 1 } : null);
    if (num) return num.num === 0 ? toScore(false) : toScore(true);
    return null;
  }

  const min = Number.isFinite(judge.score_min) ? judge.score_min : 1;
  const max = Number.isFinite(judge.score_max) ? judge.score_max : 10;
  const inScale = (value: number): number | null => (value >= min && value <= max ? value : null);

  const frac = fraction(raw);
  if (frac) {
    // «7/10» при шкале 1..10 — это 7, а не 0.7: знаменатель = score_max
    if (frac.den === max) {
      const direct = inScale(frac.num);
      if (direct !== null) return direct;
    }
    // Шкала 0..1 — дробь читается как отношение
    if (min === 0 && max === 1) {
      const ratio = frac.num / frac.den;
      const scaled = inScale(ratio);
      if (scaled !== null) return scaled;
    }
    return inScale(frac.num);
  }

  // Процент при шкале 0..1: «85%» → 0.85
  const pct = /(-?\d+(?:[.,]\d+)?)\s*%/.exec(raw);
  if (pct && min === 0 && max === 1) {
    const value = Number(pct[1].replace(',', '.'));
    if (Number.isFinite(value)) {
      const scaled = inScale(value / 100);
      if (scaled !== null) return scaled;
    }
  }

  const num = firstNumber(raw);
  return num === null ? null : inScale(num);
}

/**
 * Резолвит модель судьи: `judge.model` → `models.available`, иначе models.default.
 *
 * @returns ActiveModel либо null — env-fallback (клиент соберётся по env)
 */
function resolveJudgeModel(cwd: string, judge: JudgeConfig): ActiveModel | null {
  if (judge.model) {
    const explicit = resolveModelById(cwd, judge.model);
    if (explicit) return explicit;
    // Явно указанная, но неизвестная модель — ошибка, а не тихий откат на default:
    // иначе judge молча считал бы другой моделью, и сравнение прогонов врало бы.
    throw new Error(
      `Модель судьи "${judge.model}" не найдена в models.available (${cwd})`
    );
  }
  return resolveActiveModel(cwd);
}

/**
 * Оценивает строки результатов судьёй.
 *
 * Одна строка — один вызов модели: батчинг нескольких строк в один промпт
 * сломал бы соответствие «ответ ↔ строка» на любом отклонении формата, а
 * экономия здесь не оправдывает риска перепутать оценки.
 *
 * @param pairs — строки датасета + результаты вариантов
 * @param judge — секция judge из карточки эксперимента
 * @param opts — клиент/модель/режим API/cwd
 * @throws если конфигурация judge непригодна либо модель судьи неизвестна
 */
export async function scoreRows(
  pairs: JudgePair[],
  judge: JudgeConfig,
  opts: JudgeLlmOptions = {},
): Promise<JudgeRunResult> {
  const problems = validateJudgeConfig(judge);
  const blocking = problems.filter(p => p.field !== 'enabled');
  if (blocking.length > 0) {
    throw new Error(`Конфигурация judge непригодна: ${blocking.map(p => p.message).join('; ')}`);
  }
  const cwd = opts.cwd ?? process.cwd();
  // Модель судьи резолвится всегда: нужны `pricing` (стоимость судьи, §11) и
  // `model` в meta. Явно переданный клиент делает ошибку «модель не найдена»
  // нефатальной — вызывающий уже сам решил, каким клиентом считать.
  let active: ActiveModel | null = null;
  if (opts.client) {
    try {
      active = resolveJudgeModel(cwd, judge);
    } catch {
      active = null;
    }
  } else {
    active = resolveJudgeModel(cwd, judge);
  }

  let client = opts.client;
  if (!client) {
    // Импорт ленивый только по смыслу: llm.ts тянет node-fetch-обвязку, но
    // статический импорт безопасен — модуль уже в дереве зависимостей CLI.
    const { createLlmClient } = await import('../agent/llm.js');
    client = createLlmClient({
      ...(active ? { baseUrl: active.baseUrl, apiKey: active.apiKey, model: active.model } : {}),
      // apiMode явно: дефолт 'chat' фиксирован, иначе локальный settings.json
      // с api_mode: responses увёл бы судью на /responses (lesson-78/84/145)
      apiMode: opts.apiMode ?? active?.apiMode ?? 'chat',
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
      ...(opts.retryDelayMs !== undefined ? { retryDelayMs: opts.retryDelayMs } : {}),
      cwd,
    });
  }

  const pricing = active?.pricing;
  const rows: ResultRow[] = [];
  let usage = emptyUsage();
  let scored = 0;
  let skipped = 0;

  for (const pair of pairs) {
    const result = pair.result;
    const output = (result.output ?? '').trim();
    if (!output) {
      // Нет текста — оценивать нечего; score остаётся прежним (обычно null)
      skipped += 1;
      rows.push(result);
      continue;
    }
    const messages = buildJudgeMessages(pair.dataset, result, judge);
    try {
      const response = await client.streamChat(messages, undefined, {});
      usage = addResultUsage(usage, toResultUsage(response.usage));
      const score = parseJudgeScore(response.text, judge);
      if (score === null) {
        skipped += 1;
        rows.push({
          ...result,
          score: result.score ?? null,
          error: `judge: не удалось разобрать оценку из ответа «${response.text.slice(0, 120)}»`,
          error_kind: 'judge',
        });
        continue;
      }
      scored += 1;
      rows.push({ ...result, score });
    } catch (err) {
      // Сбой одного вызова не роняет прогон: строка помечается ошибкой judge
      skipped += 1;
      rows.push({
        ...result,
        score: result.score ?? null,
        error: `judge: ${(err as Error).message}`,
        error_kind: 'judge',
      });
    }
  }

  const pricingMissing = !pricing;
  const cost = pricing ? calculateCost(usage, pricing).total : null;

  return {
    rows,
    scored,
    skipped,
    usage,
    cost,
    pricingMissing,
    model: active ? active.id : (judge.model ?? null),
  };
}
