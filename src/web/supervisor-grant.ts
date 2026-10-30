/**
 * Grant-механизм доверия на прогон супервизора (VL-268, doc-19 §15).
 *
 * Прогон — это один ночной запуск роли «супервизор» по заранее согласованному
 * набору задач. Пользователь подтверждает карточку ОДИН раз, а дальше модель
 * работает без паузы Allow/Deny — но только внутри трёх границ grant-а:
 *
 * 1. `taskIds` — задачи, которые разрешено трогать. Задача вне набора не
 *    запускается: модель получает отказ с предложением расширить прогон
 *    (расширение = новая карточка = новое подтверждение).
 * 2. `allowedTools` — инструменты, развязанные в рамках прогона. Инструмент
 *    вне списка идёт обычным путём Allow/Deny (никакой потери защиты).
 * 3. `expiresAt` — срок. Истёкший grant не даёт СТАРТОВАТЬ новые фазы;
 *    текущая уже запущенная фаза доводится оркестратором как обычно.
 *
 * Инвариант (AC9): `write_file`, `edit` и любые другие файловые write-операции
 * модели в grant НЕ попадают НИКОГДА — список разрешаемых инструментов задан
 * константой `GRANTABLE_TOOLS` и не расширяется пользовательским вводом.
 * Фильтр применяется и при записи draft'а из карточки (`sanitizeTools`), и при
 * самой проверке (`checkSupervisorGrant`).
 *
 * Проверка выполняется ПЕРЕД КАЖДЫМ вызовом инструмента (в веб-чате — в трёх
 * точках approval-гейта: цикл, resume, advanceToNextApproval), а не один раз
 * при старте хода: отзыв (stop / завершение прогона) должен действовать
 * немедленно, даже если ход модели уже идёт.
 *
 * Модуль fs-only (по образцу core/auto-queue.ts и allow-list треда в chat.ts):
 * не импортирует чат/оркестратор — проверяется юнит-тестами без сервера.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Каталог данных супервизора в проекте (gitignored вместе с .vibelog/). */
export const SUPERVISOR_DIR = join('.vibelog', 'supervisor');

/** Срок действия grant-а по умолчанию (часы) — ночь прогона с запасом. */
export const DEFAULT_GRANT_TTL_HOURS = 8;

/**
 * Верхняя граница TTL: grant на «полгода» не имеет смысла (это не постоянное
 * разрешение, а доверие на прогон) и обнулял бы смысл срока.
 */
export const MAX_GRANT_TTL_HOURS = 24 * 14;

/**
 * Инструменты, которые МОЖНО развязать grant'ом (AC9).
 *
 * Зафиксировано в коде, а не в настройках: `write_file`/`edit`/shell-команды
 * модели меняют файлы проекта в обход backlog-данных — их всегда подтверждает
 * человек. Пользовательский ввод (чекбоксы карточки, args `allowedTools`)
 * проходит через `sanitizeTools`, поэтому «пропихнуть» write_file невозможно.
 */
export const GRANTABLE_TOOLS: readonly string[] = [
  'backlog_trigger_phase',
  'backlog_phase_status',
  'backlog_auto_queue',
  'backlog_supervisor',
  'backlog_create_task',
];

/** Задачи-адресные инструменты: args.id/args.ids сверяются с grant.taskIds. */
const TASK_SCOPED_TOOLS: readonly string[] = [
  'backlog_trigger_phase',
  'backlog_phase_status',
  'backlog_auto_queue',
  'backlog_supervisor',
];

/** Файл grant-а прогона. */
export interface SupervisorGrant {
  /** Идентификатор прогона (`run-2026-10-31T22-00-00`). */
  runId: string;
  /** Задачи прогона (канонические ID, как в backlog). */
  taskIds: string[];
  /** Развязанные инструменты (подмножество GRANTABLE_TOOLS). */
  allowedTools: string[];
  /** Момент выдачи (ISO 8601). */
  grantedAt: string;
  /** Момент истечения (ISO 8601): после него новые фазы не стартуют. */
  expiresAt: string;
  /** Момент отзыва (ISO 8601): stop или завершение прогона. */
  revokedAt?: string;
  /** Причина отзыва (для диагностики и текста статуса). */
  revokeReason?: string;
}

/** Правки карточки подтверждения (до решения Allow/Deny). */
export interface SupervisorGrantDraft {
  runId: string;
  taskIds: string[];
  allowedTools: string[];
  expiresAt: string;
}

/** Каталог grant'ов прогонов. */
export function grantsDir(cwd: string): string {
  return join(cwd, SUPERVISOR_DIR, 'grants');
}

/** Путь к файлу grant-а прогона. */
export function grantPath(cwd: string, runId: string): string {
  return join(grantsDir(cwd), `${runId}.json`);
}

/** Путь к файлу правок карточки (draft). */
export function grantDraftPath(cwd: string, runId: string): string {
  return join(grantsDir(cwd), `${runId}.draft.json`);
}

/** runId попадает в имя файла — защита от path-traversal. */
const RUN_ID_RE = /^[a-zA-Z0-9_.:-]{1,80}$/;

/** Проверка допустимого runId (используется всеми публичными функциями). */
export function isValidRunId(runId: unknown): runId is string {
  return typeof runId === 'string' && RUN_ID_RE.test(runId);
}

/**
 * Идентификатор прогона из момента времени: `run-2026-10-31T22-00-00`.
 *
 * Двоеточия и миллисекунды заменены дефисами — runId попадает в имя файла и в
 * текст для пользователя, двоеточие там неудобно (и ломает Windows-пути).
 */
export function makeRunId(date: Date = new Date()): string {
  const iso = date.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-');
  return `run-${iso}`;
}

/**
 * Вычисляет срок действия grant-а.
 *
 * Приоритет: явный `expiresAt` (ISO) → `grantedAt + expiresInHours` (дефолт 8).
 * Валидация на границе (lesson-34): мусор не должен давать «вечный» grant —
 * возвращается понятная русская ошибка.
 *
 * @param grantedAt — момент выдачи (ISO), база для TTL
 * @param expiresInHours — TTL в часах (1..MAX_GRANT_TTL_HOURS)
 * @param expiresAt — явный срок (ISO)
 */
export function computeExpiresAt(
  grantedAt: string,
  expiresInHours?: unknown,
  expiresAt?: unknown,
): { expiresAt: string } | { error: string } {
  const base = Date.parse(grantedAt);
  if (Number.isNaN(base)) return { error: `Некорректный момент выдачи grant-а: ${grantedAt}` };
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
    if (typeof expiresAt !== 'string') return { error: 'expiresAt должен быть строкой ISO 8601' };
    const ms = Date.parse(expiresAt);
    if (Number.isNaN(ms)) return { error: `Некорректный expiresAt (ожидается ISO 8601): ${expiresAt}` };
    if (ms <= base) return { error: 'expiresAt должен быть позже момента выдачи grant-а' };
    return { expiresAt: new Date(ms).toISOString() };
  }
  const hours =
    expiresInHours === undefined || expiresInHours === null
      ? DEFAULT_GRANT_TTL_HOURS
      : expiresInHours;
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours <= 0 || hours > MAX_GRANT_TTL_HOURS) {
    return {
      error: `expiresInHours должен быть числом от 0 до ${MAX_GRANT_TTL_HOURS} (часы)`,
    };
  }
  return { expiresAt: new Date(base + hours * 3_600_000).toISOString() };
}

/**
 * Фильтрует список инструментов до разрешённых grant'ом.
 *
 * Молча отбрасывает всё, чего нет в `GRANTABLE_TOOLS` (write_file, edit,
 * run_shell_command, read_file и т.п.) — второй рубеж после схемы/карточки.
 * Возвращает уникальные имена в порядке GRANTABLE_TOOLS (детерминированно).
 */
export function sanitizeTools(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  const requested = new Set(
    tools.filter((t): t is string => typeof t === 'string').map(t => t.trim()),
  );
  return GRANTABLE_TOOLS.filter(t => requested.has(t));
}

/** Записывает grant прогона (создаёт каталог grants/). */
export function writeGrant(cwd: string, grant: SupervisorGrant): void {
  mkdirSync(grantsDir(cwd), { recursive: true });
  writeFileSync(grantPath(cwd, grant.runId), `${JSON.stringify(grant, null, 2)}\n`, 'utf8');
}

/**
 * Читает grant прогона.
 *
 * Битый JSON/невалидная структура → null (паттерн loadThreadAllowList: сбой
 * чтения разрешения не должен превращаться в «разрешено»). Невалидный runId —
 * тоже null (path-traversal отсекается до fs).
 */
export function loadGrant(cwd: string, runId: unknown): SupervisorGrant | null {
  if (!isValidRunId(runId)) return null;
  const path = grantPath(cwd, runId);
  if (!existsSync(path)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const g = raw as Partial<SupervisorGrant>;
    if (typeof g.runId !== 'string' || typeof g.grantedAt !== 'string' || typeof g.expiresAt !== 'string') {
      return null;
    }
    if (!Array.isArray(g.taskIds) || !Array.isArray(g.allowedTools)) return null;
    const grant: SupervisorGrant = {
      runId: g.runId,
      taskIds: g.taskIds.filter((t): t is string => typeof t === 'string'),
      allowedTools: sanitizeTools(g.allowedTools),
      grantedAt: g.grantedAt,
      expiresAt: g.expiresAt,
    };
    if (typeof g.revokedAt === 'string') grant.revokedAt = g.revokedAt;
    if (typeof g.revokeReason === 'string') grant.revokeReason = g.revokeReason;
    return grant;
  } catch {
    return null;
  }
}

/**
 * Все grant'ы проекта, свежие первыми.
 *
 * Draft-файлы (`<runId>.draft.json`) и прочие файлы каталога игнорируются:
 * учитываются только записи, у которых выполнены требования loadGrant.
 */
export function listGrants(cwd: string): SupervisorGrant[] {
  const dir = grantsDir(cwd);
  if (!existsSync(dir)) return [];
  const out: SupervisorGrant[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json') || name.endsWith('.draft.json')) continue;
    const grant = loadGrant(cwd, name.slice(0, -'.json'.length));
    if (grant) out.push(grant);
  }
  return out.sort((a, b) => (a.grantedAt < b.grantedAt ? 1 : a.grantedAt > b.grantedAt ? -1 : 0));
}

/** Истёк ли срок grant-а на указанный момент. */
export function isGrantExpired(grant: SupervisorGrant, now: Date = new Date()): boolean {
  const ms = Date.parse(grant.expiresAt);
  if (Number.isNaN(ms)) return true; // битый срок = не доверяем
  return ms <= now.getTime();
}

/** Отозван ли grant (stop или завершение прогона). */
export function isGrantRevoked(grant: SupervisorGrant): boolean {
  return typeof grant.revokedAt === 'string' && grant.revokedAt !== '';
}

/** Действует ли grant: не отозван и не истёк. */
export function isGrantActive(grant: SupervisorGrant, now: Date = new Date()): boolean {
  return !isGrantRevoked(grant) && !isGrantExpired(grant, now);
}

/**
 * Активный grant проекта (самый поздний по grantedAt).
 *
 * Отозванные и просроченные не возвращаются: после stop/окончания прогона
 * следующая проверка снова требует подтверждения (AC11).
 */
export function findActiveGrant(cwd: string, now: Date = new Date()): SupervisorGrant | null {
  return listGrants(cwd).find(g => isGrantActive(g, now)) ?? null;
}

/**
 * Отзывает grant прогона (stop и завершение прогона).
 *
 * Файл НЕ удаляется — история прогона остаётся читаемой (когда и почему
 * отозвали), а `findActiveGrant` его больше не видит.
 *
 * @returns обновлённый grant либо null, если файла нет
 */
export function revokeGrant(cwd: string, runId: unknown, reason?: string): SupervisorGrant | null {
  const grant = loadGrant(cwd, runId);
  if (!grant) return null;
  const next: SupervisorGrant = { ...grant, revokedAt: new Date().toISOString() };
  if (reason && reason.trim() !== '') next.revokeReason = reason.trim();
  writeGrant(cwd, next);
  return next;
}

/** Сохраняет правки карточки (чекбоксы инструментов, срок) до решения. */
export function saveGrantDraft(cwd: string, draft: SupervisorGrantDraft): SupervisorGrantDraft {
  const clean: SupervisorGrantDraft = {
    runId: draft.runId,
    taskIds: draft.taskIds,
    allowedTools: sanitizeTools(draft.allowedTools),
    expiresAt: draft.expiresAt,
  };
  mkdirSync(grantsDir(cwd), { recursive: true });
  writeFileSync(grantDraftPath(cwd, clean.runId), `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
  return clean;
}

/** Читает правки карточки; нет файла/мусор → null. */
export function loadGrantDraft(cwd: string, runId: unknown): SupervisorGrantDraft | null {
  if (!isValidRunId(runId)) return null;
  const path = grantDraftPath(cwd, runId);
  if (!existsSync(path)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const d = raw as Partial<SupervisorGrantDraft>;
    if (typeof d.runId !== 'string' || typeof d.expiresAt !== 'string') return null;
    if (!Array.isArray(d.taskIds) || !Array.isArray(d.allowedTools)) return null;
    return {
      runId: d.runId,
      taskIds: d.taskIds.filter((t): t is string => typeof t === 'string'),
      allowedTools: sanitizeTools(d.allowedTools),
      expiresAt: d.expiresAt,
    };
  } catch {
    return null;
  }
}

/** Удаляет правки карточки (после старта прогона или отказа). */
export function clearGrantDraft(cwd: string, runId: unknown): void {
  if (!isValidRunId(runId)) return;
  try {
    unlinkSync(grantDraftPath(cwd, runId));
  } catch {
    // нет файла / сбой удаления draft'а не должен рвать ход
  }
}

/**
 * Самый свежий draft карточки grant (по mtime).
 *
 * Нужен handler'у `backlog_supervisor(start)`: runId карточки генерируется в
 * момент предпросмотра, а handler получает только аргументы вызова — читаем
 * последний записанный пользователем draft (их не бывает больше одного
 * ожидающего подтверждения).
 */
export function latestGrantDraft(cwd: string): SupervisorGrantDraft | null {
  const dir = grantsDir(cwd);
  let names: string[];
  try {
    names = readdirSync(dir).filter(n => n.endsWith('.draft.json'));
  } catch {
    return null;
  }
  let best: { name: string; mtime: number } | null = null;
  for (const name of names) {
    try {
      const mtime = statSync(join(dir, name)).mtimeMs;
      if (!best || mtime > best.mtime) best = { name, mtime };
    } catch {
      // файл исчез между readdir и stat — пропускаем
    }
  }
  if (!best) return null;
  return loadGrantDraft(cwd, best.name.slice(0, -'.draft.json'.length));
}

/** Результат проверки grant-а перед вызовом инструмента. */
export type GrantVerdict =
  | { granted: true; runId: string }
  | { granted: false; needsApproval: true; expired?: boolean; reason: 'no-grant' | 'tool-not-allowed' | 'expired' | 'revoked' }
  | { granted: false; error: string };

/** Канонизация ID задачи для сверки с grant.taskIds (регистр не важен). */
export function canonicalTaskId(id: string): string {
  return id.trim().toUpperCase();
}

/**
 * Извлекает ID задач из аргументов инструмента (`id` или `ids`).
 *
 * `ids` принимается и массивом, и JSON-строкой массива (lesson-35: модель
 * часто присылает строку вместо массива). Возвращает [] — аргумент не задан.
 */
export function taskIdsOfArgs(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  const rawId = args.id;
  if (typeof rawId === 'string' && rawId.trim() !== '') out.push(rawId.trim());
  let rawIds = args.ids;
  if (typeof rawIds === 'string') {
    try {
      rawIds = JSON.parse(rawIds);
    } catch {
      rawIds = [rawIds];
    }
  }
  if (Array.isArray(rawIds)) {
    for (const item of rawIds) {
      if (typeof item === 'string' && item.trim() !== '') out.push(item.trim());
    }
  }
  return out;
}

/**
 * Проверка grant-а ПЕРЕД вызовом инструмента супервизора (AC8).
 *
 * Решения:
 * - grant нет/истёк/отозван → обычный Allow/Deny (`needsApproval`), признак
 *   `expired` — чтобы карточка сказала «срок истёк, подтвердите заново»;
 * - инструмент вне `allowedTools` → обычный Allow/Deny;
 * - адресный инструмент (trigger/status/auto_queue/supervisor) с задачей вне
 *   `taskIds` → ОТКАЗ с текстом «расширь прогон и подтверди заново» (AC8);
 * - `backlog_create_task` сверке taskIds не подлежит: у него нет аргумента
 *   задачи (авто-баг VL-269 создаёт новую задачу — это разрешено grant'ом);
 * - grantable-инструмент, не требующий задачи в аргументах (create_task),
 *   считается покрытым, если он есть в allowedTools.
 *
 * Вызывается на КАЖДЫЙ вызов, а не один раз за ход: отзыв действует немедленно.
 */
export function checkSupervisorGrant(
  cwd: string,
  toolName: string,
  args: Record<string, unknown>,
  now: Date = new Date(),
): GrantVerdict {
  const grant = findActiveGrant(cwd, now);
  if (!grant) {
    // Различаем «нет» и «истёк/отозван» только для текста карточки.
    const last = listGrants(cwd)[0];
    if (last && isGrantRevoked(last)) {
      return { granted: false, needsApproval: true, reason: 'revoked' };
    }
    if (last && isGrantExpired(last, now)) {
      return { granted: false, needsApproval: true, expired: true, reason: 'expired' };
    }
    return { granted: false, needsApproval: true, reason: 'no-grant' };
  }
  if (!grant.allowedTools.includes(toolName)) {
    return { granted: false, needsApproval: true, reason: 'tool-not-allowed' };
  }
  if (TASK_SCOPED_TOOLS.includes(toolName)) {
    const allowed = new Set(grant.taskIds.map(canonicalTaskId));
    const outside = taskIdsOfArgs(args).filter(id => !allowed.has(canonicalTaskId(id)));
    if (outside.length > 0) {
      return {
        granted: false,
        error:
          `Задача ${outside.join(', ')} вне прогона ${grant.runId} (в нём: ${grant.taskIds.join(', ')}). ` +
          `Чтобы включить её, предложи пользователю расширить прогон: backlog_supervisor start с новым ` +
          `набором ids и подтверждение заново.`,
      };
    }
  }
  return { granted: true, runId: grant.runId };
}
