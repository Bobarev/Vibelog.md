/**
 * Состояние прогона супервизора (VL-270, doc-19 §9, §10).
 *
 * Два файла в `.vibelog/supervisor/`:
 * - `state.json` — машинное состояние: что идёт, чем закончилось, сколько
 *   лечебных попыток, какое правило срабатывало. Пишется ПОСЛЕ каждого тика;
 * - `heartbeat.md` — человекочитаемый срез, он же инжектится в промпт тика.
 *
 * Ключевое требование doc-19 §5: «никакого состояния в памяти». Тик живёт в
 * процессе `vibelog browser`, а `activeRuns` оркестратора теряется при рестарте
 * (`src/web/orchestrator.ts` — known limitation). Поэтому источником истины
 * о том, что запущено, служат `state.json` + живость процесса фазы по
 * `pid` + `phaseRunId`: перезапуск браузера не должен превращать упавшую фазу
 * в «вечно идущую».
 *
 * Запись `state.json` атомарна (temp + rename): тик может упасть/быть убит в
 * любой момент, а половина JSON-файла лишила бы следующий тик всей картины.
 *
 * Модуль намеренно не зависит от оркестратора (иначе core → web): сбор
 * диагностики фазы живёт в `src/web/supervisor-tick.ts`, а сюда передаётся
 * готовый снимок `TaskObservation`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SUPERVISOR_DATA_DIR } from './supervisor-config.js';
import type { ParallelMode } from './supervisor-config.js';

/** Путь к машинному состоянию прогона. */
export function statePath(cwd: string): string {
  return join(cwd, SUPERVISOR_DATA_DIR, 'state.json');
}

/** Путь к человекочитаемому heartbeat. */
export function heartbeatPath(cwd: string): string {
  return join(cwd, SUPERVISOR_DATA_DIR, 'heartbeat.md');
}

/** Состояние одной задачи в прогоне. */
export interface SupervisorTaskState {
  /** Фаза, которая идёт (или последняя завершившаяся). */
  phase: string;
  /** running — процесс жив; failed — упала и ждёт лечения; done — фаза отработала; pending — ждёт запуска. */
  status: 'running' | 'failed' | 'done' | 'pending';
  /** Собственный идентификатор запуска фазы (оркестратор своего не отдаёт). */
  phaseRunId?: string;
  /** PID процесса фазы (живость проверяется через process.kill(pid, 0)). */
  pid?: number;
  /** Момент старта фазы (ISO) — отличает «давно висит» от «только началась». */
  startedAt?: string;
  /** Сколько раз задачу запускали (включая лечение). */
  attempt: number;
  /** Сколько лечебных попыток израсходовано (потолок — heal_attempts). */
  healAttempts: number;
  /** Идентификатор группы параллельного запуска. */
  groupId?: string;
  /** Последняя известная причина падения (fail_reason/logTail-срез). */
  lastError?: string;
  /** Метрика повторов последней сессии (для правил repeat_share_min/repeat_calls_min). */
  lastRepeatStats?: {
    tool_calls_total: number;
    repeat_calls: number;
    repeat_share: number;
    top: { key: string; count: number }[];
  };
  /** Цепочка сработавших правил лечения (нужна авто-багу — AC11). */
  ruleChain?: string[];
  /** Статус задачи в момент старта фазы: по нему видно, был ли прогресс. */
  statusAtStart?: string;
  /** Задача остановлена супервизором (stop или авто-баг) — больше не запускается. */
  frozen?: boolean;
  /** Следующая фаза по workflow (заполняет тик, когда фаза завершена). */
  nextPhase?: string;
}

/** Последнее решение прогона (его же показывает heartbeat). */
export interface SupervisorLastDecision {
  tick: number;
  action:
    | 'run'
    | 'heal'
    | 'bug'
    | 'stop'
    | 'wait'
    | 'fallback'
    | 'unchanged'
    | 'no-grant';
  ruleId?: string;
  taskId?: string;
  reason: string;
}

/** Машинное состояние прогона целиком. */
export interface SupervisorTickState {
  runId: string;
  mode: ParallelMode;
  /** Время старта прогона (ISO). */
  startedAt: string;
  /** Время последнего обновления (ISO). */
  updatedAt: string;
  /** Номер тика (монотонно растёт). */
  tick: number;
  lastDecision: SupervisorLastDecision;
  tasks: Record<string, SupervisorTaskState>;
  /** Сколько самонастроек применено за прогон. */
  tuning: { applied: number; last?: string };
  /** Хеш снимка состояния: по нему wake gate решает, звать ли модель. */
  snapshotHash?: string;
  /** Время следующего пробуждения (ISO) — диагностика «тик жив». */
  wakeAt?: string;
}

/** Снимок наблюдения за задачей (собирается в web-слое, здесь только хранится). */
export interface TaskObservation {
  running: boolean;
  /** Фаза идущего/последнего запуска (из оркестратора). */
  phase?: string;
  pid?: number;
  exitCode?: number;
  /** Хвост лога фазы (для авто-бага и промпта тика). */
  logTail?: string;
  /** Текстовый разбор результата (parseQwenResult) — там же причина падения. */
  result?: string;
  /** Причина падения последнего рана (мета сессии). */
  lastRunError?: string;
  /** Статус задачи сейчас (по нему определяется прогресс). */
  status: string;
  /** Текущая фаза задачи по workflow (что запускать дальше). */
  nextPhase?: string;
  sessionId?: string | null;
  repeatStats?: SupervisorTaskState['lastRepeatStats'];
  finishedAt?: string;
}

/** Каталог супервизора создаётся лениво. */
function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

/** Читает состояние прогона; нет файла/битый JSON → null (тик начнёт заново). */
export function loadState(cwd: string): SupervisorTickState | null {
  const path = statePath(cwd);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = raw as Partial<SupervisorTickState>;
  if (typeof s.runId !== 'string' || s.runId === '') return null;
  const tasks: Record<string, SupervisorTaskState> = {};
  if (s.tasks !== null && typeof s.tasks === 'object' && !Array.isArray(s.tasks)) {
    for (const [id, value] of Object.entries(s.tasks as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
      const t = value as Partial<SupervisorTaskState>;
      if (typeof t.phase !== 'string' || typeof t.status !== 'string') continue;
      tasks[id] = {
        phase: t.phase,
        status: t.status as SupervisorTaskState['status'],
        ...(typeof t.phaseRunId === 'string' ? { phaseRunId: t.phaseRunId } : {}),
        ...(typeof t.pid === 'number' ? { pid: t.pid } : {}),
        ...(typeof t.startedAt === 'string' ? { startedAt: t.startedAt } : {}),
        attempt: typeof t.attempt === 'number' ? t.attempt : 0,
        healAttempts: typeof t.healAttempts === 'number' ? t.healAttempts : 0,
        ...(typeof t.groupId === 'string' ? { groupId: t.groupId } : {}),
        ...(typeof t.lastError === 'string' ? { lastError: t.lastError } : {}),
        ...(t.lastRepeatStats !== undefined && t.lastRepeatStats !== null
          ? { lastRepeatStats: t.lastRepeatStats }
          : {}),
        ...(Array.isArray(t.ruleChain) ? { ruleChain: t.ruleChain.filter((x): x is string => typeof x === 'string') } : {}),
        ...(typeof t.statusAtStart === 'string' ? { statusAtStart: t.statusAtStart } : {}),
        ...(t.frozen === true ? { frozen: true } : {}),
        ...(typeof t.nextPhase === 'string' ? { nextPhase: t.nextPhase } : {}),
      };
    }
  }
  const decision = s.lastDecision;
  const lastDecision: SupervisorLastDecision =
    decision !== null && typeof decision === 'object' && !Array.isArray(decision)
      ? {
          tick: typeof decision.tick === 'number' ? decision.tick : 0,
          action: (decision.action ?? 'wait') as SupervisorLastDecision['action'],
          ...(typeof decision.ruleId === 'string' ? { ruleId: decision.ruleId } : {}),
          ...(typeof decision.taskId === 'string' ? { taskId: decision.taskId } : {}),
          reason: typeof decision.reason === 'string' ? decision.reason : '',
        }
      : { tick: 0, action: 'wait', reason: 'состояние прочитано без решения' };
  return {
    runId: s.runId,
    mode: s.mode === 'aggressive' ? 'aggressive' : 'conservative',
    startedAt: typeof s.startedAt === 'string' ? s.startedAt : new Date().toISOString(),
    updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : new Date().toISOString(),
    tick: typeof s.tick === 'number' ? s.tick : 0,
    lastDecision,
    tasks,
    tuning: s.tuning !== null && typeof s.tuning === 'object' && !Array.isArray(s.tuning)
      ? {
          applied: typeof (s.tuning as { applied?: unknown }).applied === 'number'
            ? ((s.tuning as { applied: number }).applied)
            : 0,
          ...(typeof (s.tuning as { last?: unknown }).last === 'string'
            ? { last: (s.tuning as { last: string }).last }
            : {}),
        }
      : { applied: 0 },
    ...(typeof s.snapshotHash === 'string' ? { snapshotHash: s.snapshotHash } : {}),
    ...(typeof s.wakeAt === 'string' ? { wakeAt: s.wakeAt } : {}),
  };
}

/**
 * Пишет состояние прогона АТОМАРНО: сначала `<path>.tmp` в том же каталоге,
 * затем rename. Rename в пределах одной ФС атомарен, поэтому читатель видит
 * либо старый целый файл, либо новый целый — но никогда половину.
 */
export function saveState(cwd: string, state: SupervisorTickState): void {
  const path = statePath(cwd);
  ensureDir(path);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

/** Read-modify-write состояния одним вызовом (без промежуточной записи). */
export function updateState(
  cwd: string,
  mutator: (state: SupervisorTickState | null) => SupervisorTickState | null,
): SupervisorTickState | null {
  const next = mutator(loadState(cwd));
  if (next !== null) saveState(cwd, next);
  return next;
}

/**
 * Жив ли процесс с таким pid.
 *
 * `process.kill(pid, 0)` — единственный кроссплатформенный способ «спросить»
 * ОС о существовании процесса без его завершения: ESRCH — процесса нет;
 * EPERM — процесс есть, но не наш (считаем живым: чужой процесс фазы не
 * убивает, а «мёртвым» его объявлять нельзя).
 */
export function isPidAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

/**
 * Фаза задачи считается идущей, только если сошлось всё: статус `running`,
 * известен `phaseRunId` текущего запуска и процесс жив. Совпадение phaseRunId
 * отсекает переиспользованный ОС pid (AC5).
 */
export function phaseAlive(state: SupervisorTickState, taskId: string): boolean {
  const t = state.tasks[taskId];
  if (!t || t.status !== 'running') return false;
  if (typeof t.phaseRunId !== 'string' || t.phaseRunId === '') return false;
  return isPidAlive(t.pid);
}

/** FNV-1a (32 бита) — дешёвый стабильный хеш без crypto (как в repeat-tracker). */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Ключ снимка состояния для wake gate (doc-19 §5, шаг 3).
 *
 * Собирается из ТОГО, что реально может изменить решение: статусы и ошибки
 * задач, факт живости фаз, число задач с доступной следующей фазой, активность
 * grant. Специально НЕ входят: текущее время, номер тика, содержание решения —
 * иначе каждый тик выглядел бы «изменившимся» и модель вызывалась бы зря (AC2).
 */
export function snapshotKey(
  state: SupervisorTickState,
  observations: Record<string, TaskObservation>,
  grantKey: string,
): string {
  const parts: string[] = [`grant:${grantKey}`];
  for (const id of Object.keys(state.tasks).sort()) {
    const t = state.tasks[id];
    const obs = observations[id];
    parts.push(
      [
        id,
        t.status,
        t.phase,
        t.frozen === true ? 'frozen' : '',
        String(t.attempt),
        String(t.healAttempts),
        t.lastError ?? '',
        phaseAlive(state, id) ? 'alive' : 'dead',
        obs ? `${obs.status}/${obs.nextPhase ?? ''}/${obs.running ? 'run' : 'idle'}` : 'gone',
        obs?.repeatStats ? `${obs.repeatStats.repeat_calls}/${obs.repeatStats.tool_calls_total}` : '',
      ].join('|'),
    );
  }
  return fnv1a(parts.join('\n'));
}

/** Обрезает хвост лога до N строк (в heartbeat и авто-баг идёт фрагмент, не весь лог). */
export function tailLines(text: string | undefined, limit: number): string {
  if (text === undefined || text === '') return '';
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim() !== '');
  return lines.slice(-limit).join('\n');
}

/** Дополнительные данные для heartbeat (собирает тик). */
export interface HeartbeatExtra {
  /** Активен ли grant и когда истекает. */
  grant?: { runId: string; expiresAt: string; active: boolean };
  /** Идёт ли прогон (по гранту) либо остановлен. */
  running?: boolean;
  /** Обоснование групп в режиме conservative (AC12) — пишется в heartbeat. */
  groupsRationale?: string[];
  /** Предупреждения валидации heal_rules (битые правила выпали — AC8). */
  ruleErrors?: string[];
  /** Наблюдения по задачам: фрагменты логов и повторов. */
  observations?: Record<string, TaskObservation>;
}

/**
 * Пишет `heartbeat.md` — человеческий срез, он же инжектится в промпт тика.
 *
 * Формат сознательно табличный и короткий: heartbeat читает и человек в
 * терминале, и модель (бюджет промпта ограничен). Сырые логи не вставляются
 * целиком — только хвост по 8 строк на задачу (AC3).
 */
export function writeHeartbeat(
  cwd: string,
  state: SupervisorTickState,
  extra: HeartbeatExtra = {},
): string {
  const lines: string[] = [];
  const running = extra.running ?? false;
  const grantLine = extra.grant
    ? `${extra.grant.runId} (до ${extra.grant.expiresAt}${extra.grant.active ? '' : ', НЕ активен'})`
    : 'нет';
  lines.push(`# Heartbeat прогона ${state.runId}`);
  lines.push('');
  lines.push(`- Прогон: ${running ? 'идёт' : 'остановлен'}`);
  lines.push(`- Режим группировки: ${state.mode}`);
  lines.push(`- Тик: ${state.tick}, обновлён: ${state.updatedAt}`);
  lines.push(`- Grant: ${grantLine}`);
  lines.push(`- Настройки: ремонтаж групп и лимиты — в .vibelog/settings.json`);
  lines.push('');

  lines.push('## Задачи');
  lines.push('');
  lines.push('| Задача | Фаза | Статус | Попытки | Лечение | Группа | Ошибка |');
  lines.push('|---|---|---|---|---|---|---|');
  const ids = Object.keys(state.tasks).sort();
  if (ids.length === 0) {
    lines.push('| — | — | — | — | — | — | задач в состоянии нет |');
  }
  for (const id of ids) {
    const t = state.tasks[id];
    const status = t.frozen === true ? `${t.status} (остановлена)` : t.status;
    lines.push(
      `| ${id} | ${t.phase} | ${status} | ${t.attempt} | ${t.healAttempts} | ${t.groupId ?? '—'} | ` +
        `${(t.lastError ?? '—').replace(/\n/g, ' ').slice(0, 300)} |`,
    );
  }
  lines.push('');

  const decision = state.lastDecision;
  lines.push('## Прошлое решение');
  lines.push('');
  lines.push(
    `- Тик ${decision.tick}: ${decision.action}` +
      (decision.ruleId ? ` (правило ${decision.ruleId})` : '') +
      (decision.taskId ? ` по ${decision.taskId}` : ''),
  );
  lines.push(`- Причина: ${decision.reason || '—'}`);
  if (decision.ruleId) lines.push('- Цепочка правил: см. ruleChain задач ниже');
  lines.push('');

  if (extra.groupsRationale !== undefined && extra.groupsRationale.length > 0) {
    lines.push('## Обоснование групп (conservative)');
    lines.push('');
    for (const row of extra.groupsRationale) lines.push(`- ${row}`);
    lines.push('');
  }

  if (extra.ruleErrors !== undefined && extra.ruleErrors.length > 0) {
    lines.push('## Предупреждения правил лечения');
    lines.push('');
    for (const row of extra.ruleErrors) lines.push(`- ${row}`);
    lines.push('');
  }

  const observations = extra.observations ?? {};
  const withLogs = ids.filter(id => {
    const obs = observations[id];
    return obs !== undefined && (tailLines(obs.logTail, 8) !== '' || obs.lastRunError !== undefined);
  });
  if (withLogs.length > 0) {
    lines.push('## Последние ошибки (фрагменты, не полные логи)');
    lines.push('');
    for (const id of withLogs) {
      const obs = observations[id];
      const t = state.tasks[id];
      lines.push(`### ${id} — ${t?.phase ?? obs.phase ?? '?'}`);
      if (t?.ruleChain && t.ruleChain.length > 0) lines.push(`- Цепочка правил: ${t.ruleChain.join(' → ')}`);
      if (obs.lastRunError) lines.push(`- fail_reason: ${obs.lastRunError}`);
      if (obs.repeatStats) {
        lines.push(
          `- Повторы: ${obs.repeatStats.repeat_calls}/${obs.repeatStats.tool_calls_total} (доля ${obs.repeatStats.repeat_share})`,
        );
      }
      const tail = tailLines(obs.logTail, 8);
      if (tail !== '') lines.push('```', tail, '```');
      lines.push('');
    }
  }

  if (state.tuning.applied > 0) {
    lines.push('## Самонастройка');
    lines.push('');
    lines.push(`- Применено за прогон: ${state.tuning.applied}`);
    if (state.tuning.last) lines.push(`- Последнее: ${state.tuning.last}`);
    lines.push('');
  }

  const text = `${lines.join('\n').trimEnd()}\n`;
  const path = heartbeatPath(cwd);
  ensureDir(path);
  writeFileSync(path, text, 'utf8');
  return text;
}