/**
 * Хранение сессий vibelog-agent (VL-95).
 *
 * Транскрипт диалога (LoopResult.messages) сохраняется JSONL в
 * `.vibelog/agent-sessions/<sessionId>.jsonl` — по строке на сообщение.
 * Формат session_id — прежний `agent-<Date.now()>`: его матчит
 * extractSessionRef бота (commands.ts) и рендерится с префиксом `vb:` —
 * менять нельзя, иначе бот определит сессию как qwen-сессию и спавнит
 * не тот агент. Каталог `.vibelog/` покрыт .gitignore.
 */

import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isValidToolCall, type ApiMode, type ChatMessage } from './llm.js';
import { analyzeToolRepeats, type RepeatStats } from './repeat-tracker.js';
import type { TokenUsage } from '../core/analytics.js';

/** Каталог хранения сессий агента: `<cwd>/.vibelog/agent-sessions`. */
export function agentSessionsDir(cwd: string): string {
  return join(cwd, '.vibelog', 'agent-sessions');
}

/** Идентификатор новой сессии: `agent-<мс epoch>` (формат бота VL-95). */
export function createSessionId(): string {
  return `agent-${Date.now()}`;
}

/**
 * Сохраняет транскрипт сессии (полная перезапись файла).
 *
 * @throws Error при ошибке mkdir/записи — вызывающий решает, фатальна ли она
 */
export async function saveSession(dir: string, sessionId: string, messages: ChatMessage[]): Promise<void> {
  assertSafeSessionId(sessionId);
  await mkdir(dir, { recursive: true });
  // JSONL: по строке на сообщение — чтение/запись линейные
  const body = messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
  await writeFile(join(dir, `${sessionId}.jsonl`), body, 'utf-8');
}

/**
 * Дописывает одно сообщение в конец JSONL-файла сессии (VL-103).
 *
 * Инкрементальная запись: каждое сообщение цикла уходит в файл сразу, а не
 * по завершении фазы — при обрыве процесса (SIGKILL/таймаут оркестратора)
 * транскрипт сохранён до последнего дописанного сообщения. Финальный
 * saveSession остаётся нормализацией: полная перезапись идемпотентна и
 * подчищает любые расхождения append'ов.
 *
 * @throws Error при невалидном sessionId (path traversal) либо ошибке записи
 */
export async function appendSessionMessage(
  dir: string,
  sessionId: string,
  message: ChatMessage,
): Promise<void> {
  assertSafeSessionId(sessionId);
  // mkdir recursive: файл сессии может создаваться до первого saveSession
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, `${sessionId}.jsonl`), JSON.stringify(message) + '\n', 'utf-8');
}

/**
 * Загружает транскрипт сессии по идентификатору.
 *
 * @throws Error «Сессия <id> не найдена: <path>» либо «битая строка N»
 */
export async function loadSession(dir: string, sessionId: string): Promise<ChatMessage[]> {
  assertSafeSessionId(sessionId);
  const path = join(dir, `${sessionId}.jsonl`);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    throw new Error(`Сессия ${sessionId} не найдена: ${path}`);
  }
  const messages: ChatMessage[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue; // хвостовой перевод строки — не сообщение
    try {
      messages.push(JSON.parse(line));
    } catch {
      throw new Error(`Сессия ${sessionId}: битая строка ${i + 1} в ${path}`);
    }
  }
  return messages;
}

/**
 * Последняя сессия каталога — *.jsonl с максимальным mtime.
 *
 * @returns sessionId либо null, если сессий нет (нет каталога — тоже null)
 */
export async function latestSession(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null; // каталога ещё нет — сессий не было
  }
  const jsonl = entries.filter((e) => e.endsWith('.jsonl'));
  if (jsonl.length === 0) return null;
  let latest: { id: string; mtime: number } | null = null;
  for (const entry of jsonl) {
    const mtime = (await stat(join(dir, entry))).mtimeMs;
    if (!latest || mtime > latest.mtime) {
      latest = { id: entry.slice(0, -'.jsonl'.length), mtime };
    }
  }
  return latest?.id ?? null;
}

/**
 * Метаданные сессии (VL-110): задача-владелец и cwd создания.
 *
 * Пишутся CLI при создании задачной сессии — в режиме `<фаза> <taskId>`
 * (прямой CLI-запуск) и по env оркестратора VIBELOG_PHASE_TASK_ID/NAME
 * (боевой путь спавна готовым промптом, VL-114) — в `<id>.meta.json`
 * рядом с jsonl. По ним оркестратор возобновляет сессию
 * задачи в её worktree (инцидент VL-98: resume из главного cwd патчил
 * главный репозиторий вместо worktree vb/vl-N). Отсутствие меты (/prompt,
 * интерактивные и старые сессии) — не ошибка.
 */
export interface SessionMeta {
  /** ID задачи-владельца (VL-N); undefined у /prompt и интерактивных сессий. */
  taskId?: string;
  /** Фаза сессии (spec/plan/code/close/comment). */
  phase?: string;
  /** Рабочая директория агента при создании сессии (worktree или главный cwd). */
  cwd: string;
  /** ID сессии (дубликат имени файла — самодостаточность меты, VL-198). */
  sessionId?: string;
  /** Начало сессии (ISO 8601), проставляется при создании (VL-198). */
  startedAt?: string;
  /** Окончание последнего рана (ISO), дописывается post-run (VL-198). */
  finishedAt?: string;
  /** Длительность последнего рана (мс), дописывается post-run (VL-198). */
  durationMs?: number;
  /**
   * Кумулятивное использование токенов сессии (VL-198): сумма по всем
   * сообщениям jsonl (при resume включает прошлые раны) — самодостаточно
   * для сверки с провайдером.
   */
  usage?: TokenUsage;
  /**
   * Сколько usage уже перенесено в frontmatter задачи (VL-198).
   * Три писателя (finish_phase/cli/оркестратор) дописывают только дельту
   * от этой отметки — иначе двойной учёт (риск №1 плана VL-198).
   */
  usage_recorded?: TokenUsage;
  /** Модель LLM фактического последнего рана (wire-имя), VL-198. */
  model?: string;
  /**
   * VL-239: МОДЕЛЬ СЕССИИ — фиксируется при создании сессии и дальше не
   * переписывается: resume-ран идёт на ней, а не на текущем models.default
   * (иначе смена default между plan и code незаметно меняла модель на
   * середине задачи). id из models.available на момент создания — подпись;
   * если пользователь его переименовал, резолв падает на пару
   * model_provider + model_name (стабильная идентичность).
   */
  model_id?: string;
  /** VL-239: id провайдера модели сессии (providers[<id>]). */
  model_provider?: string;
  /** VL-239: wire-имя модели сессии (что уходит в поле model запроса). */
  model_name?: string;
  /** VL-239: режим API, с которым сессия начата (chat|responses). */
  api_mode?: ApiMode;
  /** Агент-исполнитель: 'vb' | 'qwen', VL-198. */
  agent?: string;
  /**
   * Байты wire-body последнего LLM-запроса последнего рана (VL-203):
   * диагностика для отличия content-based отказа от размерного.
   */
  last_payload_bytes?: number;
  /** Пик wire-payload по всем ходам последнего рана (VL-203). */
  max_payload_bytes?: number;
  /**
   * Метрика повторов обращений к файлам/паттернам (VL-229, AC1): топ
   * повторяющихся ключей `<инструмент>|<path|pattern>` с числом обращений и
   * доля повторных вызовов от ВСЕХ tool-вызовов сессии (включая прошлые раны
   * resume). Считается CLI-пост-раном по полному транскрипту.
   */
  repeat_stats?: RepeatStats;
  /**
   * VL-251: сигнатуры tool-вызовов `<имя>|JSON(args)`, отклонённых loop
   * detection. При resume такой вызов блокируется БЕЗ исполнения — иначе
   * после «Продолжить» луп повторялся с нуля (инцидент VL-234).
   */
  blocked_signatures?: string[];
  /**
   * VL-253: исход последнего рана сессии. `finish_phase` не доверяет
   * явному `tokenUsage`, если предыдущий ран упал: модель подставляет туда
   * числа из сводки упавшей фазы (VL-250/VL-252), и они попадали бы в
   * frontmatter как «успешный» usage.
   */
  last_run?: { is_error?: boolean; finishedAt?: string };
  /**
   * VL-243: отметка «этот ран уже записан в billing» — {sessionId, finishedAt}
   * записи. CLI ставит её сразу после appendBilling; finish() оркестратора
   * (agent='vb') по ней понимает, что собственная fallback-запись не нужна —
   * иначе ран учитывался бы дважды (паттерн usage_recorded, lesson-58).
   */
  billing_recorded?: { sessionId: string; finishedAt: string };
  /**
   * VL-259: фаза ПОСЛЕДНЕГО рана сессии. Заполняется пост-раном (CLI) и
   * finish() оркестратора. Важно: `phase` выше — это фаза СОЗДАНИЯ сессии
   * (по ней работает findTaskPhaseSessionSync, VL-147/lesson-40), поэтому
   * фаза текущего рана хранится отдельным полем, а не переприсваиванием
   * `phase` (иначе план-сессия «затиралась» бы code-раном, инцидент VL-185).
   */
  lastRunPhase?: string;
  /**
   * VL-259: история ранов сессии — по записи на ran: в какой фазе шёл, когда
   * реально начался/закончился, сколько стоил. Нужна для разбора сессий
   * (раньше в мете была видна только фаза создания, и разбор VL-235 сделал
   * неверный вывод «сгорела фаза Plan»). Кап — RUN_HISTORY_MAX записей.
   */
  runs?: SessionRun[];
  /**
   * VL-254: блок «что сделано / что осталось» при обрыве рана по
   * wall-time/max-requests. Раньше прогресс можно было восстановить только
   * чтением килобайтов JSONL (инцидент VL-235: ветка осталась с M-файлами,
   * транскрипт — единственный источник правды).
   */
  run_progress?: {
    reason: string;
    /** Фаза оборвавшегося рана (code/plan/…). */
    phase?: string;
    finishedAt?: string;
    /** Готовый markdown-блок («Сделано» / «Осталось»). */
    text: string;
    done: string[];
    pending: string[];
    /** Хэш WIP-коммита прогресса (только фаза code); null — коммита нет. */
    commit?: string | null;
  };
}

/** Сколько записей истории ранов хранить в мете (VL-259): не пухнем за тысячи resume. */
export const RUN_HISTORY_MAX = 50;

/** Одна запись истории ранов сессии (VL-259). */
export interface SessionRun {
  /** ID сессии (дубликат — запись самодостаточна). */
  sessionId: string;
  /** Фаза ЭТОГО рана (spec/plan/code/close/…); undefined, если неизвестна. */
  phase?: string;
  /** Фаза сессии, если отличается от фазы рана (resume-ран). */
  sessionPhase?: string;
  /** Фактическое начало рана (ISO). */
  startedAt: string;
  /** Окончание рана (ISO). */
  finishedAt: string;
  /** Длительность рана (мс). */
  durationMs?: number;
  /** Кумулятивное использование токенов сессии на конец рана. */
  usage?: TokenUsage;
  /** Агент-исполнитель: 'vb' | 'qwen'. */
  agent?: string;
  /** Кто оставил запись в billing: штатный пост-ран ('run') или fallback оркестратора. */
  billing?: 'run' | 'fallback';
}

/**
 * Сохраняет метаданные сессии (<id>.meta.json).
 *
 * Полная запись — для СОЗДАНИЯ сессии; дописывание полей пост-фактум —
 * только через updateSessionMeta (merge), иначе затрутся taskId/phase
 * resume-рана (lesson-40, инцидент VL-185).
 *
 * @throws Error при невалидном sessionId (path traversal) либо ошибке записи
 */
export async function saveSessionMeta(dir: string, sessionId: string, meta: SessionMeta): Promise<void> {
  assertSafeSessionId(sessionId);
  await mkdir(dir, { recursive: true });
  // sessionId/startedAt — при создании (VL-198); готовая мета (оркестратор
  // перезаписывает идемпотентно) не теряет их: значения идентичны
  const enriched: SessionMeta = {
    sessionId,
    ...(meta.startedAt ? {} : { startedAt: new Date().toISOString() }),
    ...meta,
  };
  await writeFile(join(dir, `${sessionId}.meta.json`), JSON.stringify(enriched), 'utf-8');
}

/**
 * Точечное обновление меты сессии merge'ем (VL-198).
 *
 * Читает существующую мету и накладывает patch поверх неё: taskId/phase/cwd
 * прошлых ранов сохраняются (lesson-40: resume-ран не затирает фазу —
 * инцидент VL-185), новые поля (usage/finishedAt/…) дописываются. Меты нет —
 * создаёт из patch (cwd обязателен в patch иначе Error). Синхронная форма:
 * вызывается из post-run/cli-путей, где async-цепочки уже завершены.
 *
 * @throws Error при невалидном sessionId либо отсутствии cwd в patch без меты
 */
export function updateSessionMeta(
  dir: string,
  sessionId: string,
  patch: Partial<SessionMeta>,
): SessionMeta {
  assertSafeSessionId(sessionId);
  const path = join(dir, `${sessionId}.meta.json`);
  let existing: SessionMeta | null = null;
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        existing = parsed as SessionMeta;
      }
    } catch {
      existing = null; // битая мета — начинаем с patch, но не роняем вызов
    }
  }
  if (!existing && !patch.cwd) {
    throw new Error(`updateSessionMeta ${sessionId}: нет меты и не передан cwd`);
  }
  const merged: SessionMeta = {
    cwd: patch.cwd ?? existing!.cwd,
    ...(existing ?? {}),
    ...patch,
    sessionId,
  };
  // mkdir: при отсутствии меты (и каталога) файл создаётся с нуля
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(merged), 'utf-8');
  return merged;
}

/**
 * Дописывает запись истории ранов в мету сессии (VL-259).
 *
 * История ранов — аддитивное поле `runs[]`: фаза рана, фактические времена
 * начала/окончания, usage. Пишется пост-раном CLI и finish() оркестратора,
 * чтобы по мете можно было восстановить «сколько было ранов, в какой фазе
 * шёл каждый, когда начался и сколько стоил» (разбор сессий VL-235/VL-254).
 *
 * Мета НЕ перезаписывается: `phase`/`taskId` (фаза создания сессии) и прочие
 * поля сохраняются (lesson-40, инвариант findTaskPhaseSessionSync VL-147);
 * меняются только `runs[]` (с капом RUN_HISTORY_MAX) и `lastRunPhase`.
 *
 * @param dir — каталог сессий (agentSessionsDir)
 * @param sessionId — ID сессии (без префикса vb:)
 * @param run — запись рана; `startedAt`/`finishedAt` обязательны
 * @returns актуальная мета (при ошибке — прочитанная до попытки)
 */
export function appendSessionRun(dir: string, sessionId: string, run: SessionRun): SessionMeta {
  let current: SessionMeta | null = null;
  try {
    current = loadSessionMetaSync(dir, sessionId);
    const merged: SessionMeta = {
      // cwd обязателен для ветки «меты нет» — у рана он берётся из текущей
      // меты, а если её нет, вызывающему нечего восстанавливать: пишем без cwd
      ...(current ?? { cwd: '' }),
      runs: [...(current?.runs ?? []), run].slice(-RUN_HISTORY_MAX),
      ...(run.phase ? { lastRunPhase: run.phase } : {}),
      sessionId,
    };
    // updateSessionMeta читает мету заново и мержит — здесь передаём уже
    // готовые поля, чтобы не гонять двойное чтение в горячем пути
    return updateSessionMeta(dir, sessionId, {
      cwd: merged.cwd,
      runs: merged.runs,
      ...(merged.lastRunPhase ? { lastRunPhase: merged.lastRunPhase } : {}),
    });
  } catch (err) {
    // Учёт истории не должен ронять фазу/пост-ран: предупреждение в stderr
    // (попадает в logTail оркестратора) и возврат того, что прочитали
    console.error(`Предупреждение: история ранов ${sessionId} не записана — ${(err as Error).message}`);
    return current ?? { cwd: '' };
  }
}

/**
 * Синхронное чтение метаданных сессии (VL-110).
 *
 * Синхронная форма нужна оркестратору: startResume — синхронная точка
 * входа, spawnCwd должен определиться до spawn. Любая ошибка (нет файла,
 * битый JSON, небезопасный id) — null: вызывающий продолжает по прежнему
 * пути resume без worktree.
 */
export function loadSessionMetaSync(dir: string, sessionId: string): SessionMeta | null {
  try {
    assertSafeSessionId(sessionId);
    const parsed: unknown = JSON.parse(readFileSync(join(dir, `${sessionId}.meta.json`), 'utf-8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as SessionMeta;
  } catch {
    return null;
  }
}

/**
 * Сессия задачи для фазы (VL-147): ищет в *.meta.json совпадение по
 * meta.taskId (регистронезависимо) И meta.phase. Возвращает sessionId с
 * максимальным mtime jsonl-файла сессии (или meta-файла, если jsonl ещё
 * нет/пропал) — «последняя» сессия фазы. Null, если совпадений нет (нет
 * каталога — тоже null, как у latestSession).
 *
 * Sync-форма нужна startPhase (sync-точка входа оркестратора): при запуске
 * code в той же сессии, что plan (VL-147), sessionId уходит в --resume.
 */
export function findTaskPhaseSessionSync(dir: string, taskId: string, phase: string): string | null {
  const wanted = taskId.toUpperCase();
  return pickLatestSessionSync(
    dir,
    (meta) => !!meta?.taskId && meta.taskId.toUpperCase() === wanted && meta.phase === phase,
  );
}

/**
 * Сессия задачи БЕЗ фильтра фазы (VL-261): последняя по mtime jsonl.
 *
 * Нужна команде `vibelog session summary --task VL-N`, когда фаза не задана:
 * разбор идёт по самой свежей сессии задачи. Существующую
 * findTaskPhaseSessionSync не переиспользуем — у неё phase обязателен
 * (контракт resume оркестратора, VL-147), а менять её поведение нельзя.
 *
 * @returns sessionId либо null, если сессий задачи нет
 */
export function findLatestTaskSessionSync(dir: string, taskId: string): string | null {
  const wanted = taskId.toUpperCase();
  return pickLatestSessionSync(dir, (meta) => !!meta?.taskId && meta.taskId.toUpperCase() === wanted);
}

/**
 * Общий селектор «последняя сессия каталога, чья мета проходит предикат».
 *
 * Вынесен из findTaskPhaseSessionSync (VL-261), чтобы mtime-логика (jsonl,
 * фолбэк на мету) не дублировалась в двух функциях: расхождение фолбэков
 * давало бы разные ответы для «последней сессии фазы» и «последней сессии
 * задачи».
 */
function pickLatestSessionSync(
  dir: string,
  predicate: (meta: SessionMeta | null) => boolean,
): string | null {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null; // каталога ещё нет — сессий не было
  }
  let best: { id: string; mtime: number } | null = null;
  for (const entry of entries) {
    if (!entry.endsWith('.meta.json')) continue;
    const sessionId = entry.slice(0, -'.meta.json'.length);
    // loadSessionMetaSync глотает битые меты и path-traversal — мусор пропускаем
    const meta = loadSessionMetaSync(dir, sessionId);
    if (!predicate(meta)) continue;
    // mtime берём у jsonl (транскрипт растёт при каждом append'е сообщений);
    // нет jsonl — mtime меты (сессия может быть только что создана)
    let mtime: number;
    try {
      mtime = statSync(join(dir, `${sessionId}.jsonl`)).mtimeMs;
    } catch {
      try {
        mtime = statSync(join(dir, entry)).mtimeMs;
      } catch {
        continue; // файл меты исчез между readdir и stat — пропуск
      }
    }
    if (!best || mtime > best.mtime) {
      best = { id: sessionId, mtime };
    }
  }
  return best?.id ?? null;
}

/**
 * Диагностическая сводка метсессий задачи (VL-187): «sessionId:phase, …» для
 * всех *.meta.json с meta.taskId (регистронезависимо). Пустая строка, если
 * каталога нет/мет нет. Используется в fallback-логе startPhase, чтобы причина
 * «план-сессия не найдена» читалась из лога оркестратора.
 */
export function listTaskSessionMetas(dir: string, taskId: string): string {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return '';
  }
  const wanted = taskId.toUpperCase();
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.meta.json')) continue;
    const sessionId = entry.slice(0, -'.meta.json'.length);
    const meta = loadSessionMetaSync(dir, sessionId);
    if (!meta?.taskId || meta.taskId.toUpperCase() !== wanted) continue;
    out.push(`${sessionId}:${meta.phase ?? '?'}`);
  }
  return out.join(', ');
}

/**
 * sessionId приходит извне (--resume из CLI, ref бота) — без проверки
 * `..` в имени вышел бы за пределы каталога сессий (path traversal).
 */
function assertSafeSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) {
    throw new Error(`Недопустимый идентификатор сессии: ${sessionId}`);
  }
}

/**
 * Суммирует usage по assistant-сообщениям транскрипта (VL-198).
 *
 * Каждый ответ модели в JSONL несёт `usage` (loop дописывает при push —
 * VL-198); requests — число assistant-сообщений с usage (≈ число запросов
 * к API). Старые jsonl без usage → нули, НЕ ошибка: вызывающий сверяет
 * дельту и пропускает пустую запись.
 */
export function sumUsageFromMessages(messages: ChatMessage[]): TokenUsage & { requests: number } {
  const sum: TokenUsage & { requests: number } = {
    input: 0,
    output: 0,
    cache: 0,
    total: 0,
    requests: 0,
    reasoning: 0,
  };
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.usage) continue;
    sum.input += m.usage.input_tokens;
    sum.output += m.usage.output_tokens;
    sum.cache += m.usage.cache_read_input_tokens;
    sum.total += m.usage.total_tokens;
    sum.reasoning = (sum.reasoning ?? 0) + (m.usage.reasoning_tokens ?? 0);
    sum.requests += 1;
  }
  // reasoning не нужен нулём в агрегатах без reasoning-моделей — убираем
  if (sum.reasoning === 0) delete sum.reasoning;
  return sum;
}

/**
 * Считает валидные tool-calls по сообщениям транскрипта (VL-223).
 *
 * Источник кумулятивного per-session лимита при resume: база считается по
 * уже загруженной истории (resumedMessages), повторное чтение jsonl не нужно.
 * Семантика совпадает с toolCallsTotal в loop: фантомы (пустые name/id,
 * VL-215) не едят бюджет — фильтр isValidToolCall общий.
 */
export function countToolCallsInMessages(messages: ChatMessage[]): number {
  let count = 0;
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.tool_calls) continue;
    for (const tc of m.tool_calls) {
      if (isValidToolCall(tc)) count++;
    }
  }
  return count;
}

/**
 * Синхронная сумма usage по jsonl-файлу сессии (VL-198, fallback finish_phase).
 *
 * toolFinishPhase синхронен — async loadSession не подходит. Битые строки
 * пропускаются (как в loadSessionDiff-паттерне резюме): fallback не должен
 * ронять завершение фазы. Нет файла/каталога → null (вызывающий решает).
 */
export function sumUsageFromJsonlSync(dir: string, sessionId: string): (TokenUsage & { requests: number }) | null {
  assertSafeSessionId(sessionId);
  const path = join(dir, `${sessionId}.jsonl`);
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  const messages: ChatMessage[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line) as ChatMessage);
    } catch {
      // битая строка — пропуск: остальные сообщения учтены
    }
  }
  return sumUsageFromMessages(messages);
}

/**
 * Синхронная метрика повторов по jsonl-файлу сессии (VL-229, AC1/AC3).
 *
 * Нужна `/analyze` (startAnalyze синхронен) и любому потребителю меты без
 * загрузки async-истории. Контракты те же, что у sumUsageFromJsonlSync:
 * битые строки пропускаются (старые/оборванные транскрипты не должны ронять
 * разбор), нет файла/каталога → null (вызывающий подставляет «нет данных»).
 *
 * @returns метрика повторов либо null, если транскрипта нет/не читается
 */
export function analyzeToolRepeatsFromJsonlSync(dir: string, sessionId: string): RepeatStats | null {
  assertSafeSessionId(sessionId);
  const path = join(dir, `${sessionId}.jsonl`);
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
  const messages: ChatMessage[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      messages.push(JSON.parse(line) as ChatMessage);
    } catch {
      // битая строка — пропуск: метрика по остальным сообщениям
    }
  }
  return analyzeToolRepeats(messages);
}
