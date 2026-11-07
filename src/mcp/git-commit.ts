/**
 * MCP-инструмент `git_commit` — детерминированный коммит явными путями (VL-311).
 *
 * Разбор проблемы (после VL-302): трейлер `Co-authored-by` дописывался ДВУМЯ
 * механизмами — кодом (framework-коммиты через `core/commit-trailer.ts`) и
 * ПОДСТАНОВКОЙ в 9 местах `git commit -m` в шаблонах фаз (`{{commitTrailer}}`:
 * «если не пусто — передай вторым -m»). Второй механизм — инструкция модели, а
 * не гарантия: забыла — трейлера нет, никто не заметит. Тот же класс дефекта,
 * что VL-303/304/306/309/310 (правило в промпте вместо проверки в коде).
 * Ровно так же текстовые запреты («никогда `git add -A`», «только явные пути»)
 * держались на дисциплине модели, а инциденты VL-137/VL-169/VL-172 показывают,
 * что close-фазы реально коммитили чужие файлы и «остаток».
 *
 * Решение: узкий write-инструмент `git_commit { paths, message, amend?, allowForeign? }`,
 * который делает коммит детерминированно:
 *   - только явные пути (`git add -- <paths>`; `-A`, `.` и путь вне проекта —
 *     отказ до любых git-команд);
 *   - сверка с `modified_files` задачи (пути вне списка — отказ с перечислением
 *     и подсказкой `allowForeign`);
 *   - трейлер через `appendCommitTrailer`/`resolveCommitCoauthor` из VL-302
 *     (логика трейлера НЕ дублируется — lesson-37: общий модуль вместо копий);
 *   - JSON-ack по контракту VL-306 (`ackOk`/`ackNoop`/`ackError`) с полями
 *     hash/subject/paths, noop при «нечего коммитить» (совместимо с VL-310).
 *
 * Граница (сознательно не «git-tool вообще»): `status`, `log`, `diff`, `merge`,
 * `worktree remove`, `branch -d` остаются `run_shell_command` — это чтение и
 * редкие операции, обёртка не даёт выигрыша и раздувает реестр MCP.
 *
 * Все git-вызовы — `spawnSync('git', args, { cwd })` без shell: сообщение
 * коммита и пути передаются АРГУМЕНТАМИ, поэтому инъекция через `message`
 * невозможна (по образцу `src/core/git.ts`).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { appendCommitTrailer, resolveCommitCoauthor } from '../core/commit-trailer.js';
import { getTask } from '../core/store.js';
import { taskWorktreeDir } from '../core/worktree.js';
import { resolveInProject } from '../agent/tools.js';
import { ackError, ackErrorDetailed, ackNoop, ackOk } from './tool-result.js';

/** Аргументы `git_commit` (совпадают с inputSchema инструмента, кроме internal). */
export interface GitCommitOptions {
  /** Явные пути коммита (относительно проекта) — обязательный непустой массив. */
  paths: string[];
  /** Сообщение коммита: тема и (опционально) тело. */
  message: string;
  /** true — переписать последний коммит (`--amend`) с сохранением тела. */
  amend?: boolean;
  /** true — разрешить пути вне `modified_files` задачи. */
  allowForeign?: boolean;
  /**
   * ID задачи для сверки с `modified_files`; по умолчанию `VIBELOG_PHASE_TASK_ID`.
   * Внутренний параметр (в схему инструмента не вынесен): прокидывается тестами
   * по паттерну VL-240 — тест не должен зависеть от env живой агентской сессии.
   */
  taskId?: string;
  /**
   * Фаза рана; по умолчанию `VIBELOG_PHASE_NAME`/`VIBELOG_RUN_PHASE`. Нужна,
   * чтобы в close коммит шёл в главный репозиторий, а не в worktree задачи
   * (VL-112, шаблон `phase-close-worktree.md` снимает ветку из главного cwd).
   */
  phase?: string;
  /**
   * Каталог коммита (абсолютный путь внутри проекта). Задаётся явно там, где
   * default-резолв не может выбрать дерево: шаг 2 шаблона `phase-close-worktree.md`
   * коммитит ЧУЖОЙ worktree ({{worktreeDir}}) в фазе close, когда инструмент по
   * умолчанию работал бы в главном репозитории. Вне проекта — отказ.
   */
  cwd?: string;
}

/** Запрещённые элементы `paths`: всё, что превращает выборочный add в массовый. */
const FORBIDDEN_PATH_ENTRIES = ['.', './', '-A', '-a', '--all', '--', '*', '*/'];

/**
 * Итог git-вызова: код возврата + потоки (без исключений — инструмент
 * обязан отвечать JSON-ack, а не бросать наружу).
 */
interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Синхронный git в каталоге проекта: без shell, с таймаутом.
 *
 * VL-360: `-c core.quotepath=false` передаётся ВСЕМ вызовам инструмента.
 * Без него git экранирует не-ASCII пути octal-последовательностями
 * (`"backlog/lessons/lesson-1-\320\232..."`), и сравнение вывода
 * `git diff --cached --name-only` с путями из `paths` ломается — кириллица
 * в именах задач/уроков/референсов делала коммит невозможным (урок VL-88;
 * тот же флаг стоит в `core/git.ts` и `core/status.ts`).
 */
function git(cwd: string, args: string[]): GitResult {
  const res = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return {
    ok: !res.error && res.status === 0,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  };
}

/** Текст ошибки git для ответа модели (stderr, иначе общее сообщение). */
function gitError(res: GitResult, fallback: string): string {
  return res.stderr || res.stdout || fallback;
}

/**
 * Каталог, в котором выполняется коммит.
 *
 * MCP-сервер агента получает cwd главного репозитория в обоих режимах
 * (см. `cli/commands/mcp.ts` и `mcp-client.ts`: `VIBELOG_CWD` задаётся лишь
 * как явный override для внешних процессов), поэтому worktree задачи
 * находится по уже проверенному `cwd`. Комбинированное условие «worktree
 * существует И это не close» повторяет правило `ensureTaskWorktree` из
 * шаблона close-worktree (VL-112): merge ветки и docs(task)-коммиты делаются
 * из главного cwd — в close инструмент остаётся там же.
 *
 * @param cwd — база: VIBELOG_CWD (главный репо), если задан, иначе cwd вызова
 * @param taskId — ID задачи (для поиска worktree)
 * @param phase — фаза рана (в close worktree не используется)
 */
export function resolveCommitCwd(cwd: string, taskId: string, phase = ''): string {
  const projectCwd = process.env.VIBELOG_CWD ? resolve(process.env.VIBELOG_CWD) : cwd;
  if (!process.env.VIBELOG_CWD || taskId === '') return projectCwd;
  if (phase === 'close') return projectCwd;
  const worktree = taskWorktreeDir(projectCwd, taskId);
  return existsSync(worktree) ? worktree : projectCwd;
}

/**
 * Проверяет один элемент `paths`: непустая строка, не массовый add.
 *
 * @returns текст ошибки либо null (значение допустимо)
 */
function pathEntryError(entry: unknown): string | null {
  if (typeof entry !== 'string' || entry.trim() === '') {
    return 'paths: каждый путь — непустая строка';
  }
  if (FORBIDDEN_PATH_ENTRIES.includes(entry.trim())) {
    return `paths: "${entry.trim()}" запрещён — коммит только по явным файлам (git add -A, "." и маски не поддерживаются)`;
  }
  if (entry.trim().startsWith('-')) {
    return `paths: "${entry.trim()}" похож на флаг git, а не на путь — передай явные файлы`;
  }
  return null;
}

/**
 * Пути из `modified_files` задачи, которых нет среди коммитируемых.
 *
 * Сверка мягкая: пустой `modified_files` (поле заполняет не каждая фаза) —
 * проверка пропускается целиком, а не отказывает «всё чужое». Директория в
 * списке (`src/mcp`) покрывает файлы под ней.
 *
 * @param cwd — главный репозиторий (там лежит файл задачи)
 * @param taskId — ID задачи; пусто — сверка не выполняется
 * @param relPaths — коммитируемые пути относительно корня проекта
 * @returns список «чужих» путей (пусто — все принадлежат задаче)
 */
export function foreignPaths(cwd: string, taskId: string, relPaths: string[]): string[] {
  if (taskId === '') return [];
  let owned: string[] = [];
  try {
    const task = getTask(cwd, taskId);
    owned = task?.modified_files ?? [];
  } catch {
    // Задача не читается (нет backlog в этом cwd) — сверку пропускаем:
    // инструмент не должен отказывать из-за недоступного файла задачи.
    return [];
  }
  if (owned.length === 0) return [];
  const norm = owned.map(p => p.replaceAll('\\', '/').replace(/\/+$/, '')).filter(Boolean);
  return relPaths.filter(
    p => !norm.some(entry => p === entry || p.startsWith(`${entry}/`)),
  );
}

/**
 * Предупреждения о гонке: файл из worktree ДРУГОЙ задачи (VL-311, п.3 поведения).
 *
 * Признак гонки — комбинация двух условий: файл изменён позже старта рана
 * (`mtime > VIBELOG_RUN_STARTED_AT`) И лежит в worktree другой задачи. Одного
 * mtime недостаточно: правки самого рана тоже новее его старта, предупреждение
 * на каждый файл было бы шумом. Guard НЕ блокирует коммит: mtime не доказывает
 * авторство (файл мог быть просто скопирован).
 *
 * @param entries — абсолютные пути + их mtime
 * @param runStartedAtMs — старт рана (null — env не задан, проверка пропускается)
 * @param taskId — своя задача (её worktree не считается чужим)
 * @returns тексты предупреждений (пусто — гонки не видно)
 */
export function raceWarnings(
  entries: Array<{ path: string; mtimeMs: number }>,
  runStartedAtMs: number | null,
  taskId: string,
): string[] {
  if (runStartedAtMs === null || Number.isNaN(runStartedAtMs)) return [];
  const own = taskId.toLowerCase();
  const warnings: string[] = [];
  for (const entry of entries) {
    if (!(entry.mtimeMs > runStartedAtMs)) continue;
    if (!isInOtherWorktree(entry.path, own)) continue;
    warnings.push(
      `файл ${entry.path} изменён позже старта рана и лежит в worktree другой задачи — проверь, что это осознанно (guard не блокирует коммит)`,
    );
  }
  return warnings;
}

/** Лежит ли путь в `.vibelog/worktrees/<id>/`, где id — не своя задача. */
function isInOtherWorktree(absPath: string, ownTaskId: string): boolean {
  const segments = absPath.split(sep);
  for (let i = 0; i < segments.length - 2; i += 1) {
    if (segments[i] !== '.vibelog' || segments[i + 1] !== 'worktrees') continue;
    const id = segments[i + 2] ?? '';
    return id !== '' && id.toLowerCase() !== ownTaskId;
  }
  return false;
}

/**
 * Собирает сообщение коммита при `--amend`: сохраняет тело исходного коммита.
 *
 * Урок lesson-177: для amend берётся ПОЛНОЕ сообщение (`git log -1 --pretty=%B`),
 * а не `--no-edit` — иначе трейлер в amend не попадает и тело теряется.
 * Переданный `message` заменяет тему; тело исходного коммита сохраняется
 * (если переданное сообщение его уже не содержит). Трейлер идемпотентен:
 * повторный amend дубля не создаёт.
 *
 * @param originalFull — полное сообщение HEAD до amend
 * @param requested — запрошенное сообщение (пусто — сохранить исходное целиком)
 * @param enabled — включён ли трейлер (`resolveCommitCoauthor`)
 */
export function buildAmendMessage(originalFull: string, requested: string, enabled: boolean): string {
  const originalBody = originalFull.split('\n').slice(1).join('\n').trim();
  const req = requested.trim();
  let message: string;
  if (req === '') message = originalFull;
  else if (originalBody !== '' && !req.includes(originalBody)) message = `${req}\n\n${originalBody}`;
  else message = req;
  return appendCommitTrailer(message, enabled);
}

/**
 * Раскрывает C-style экранирование пути из вывода git (VL-360).
 *
 * git печатает не-ASCII и «специальные» пути в кавычках с octal-escape
 * (`"backlog/lessons/lesson-1-\320\232..."`), если `core.quotepath` включён
 * (глобальный конфиг пользователя, `-c` в env, чужой репозиторий). Сравнивать
 * такие строки с путями из `paths` нельзя — кириллица никогда не совпадёт.
 * Инструмент уже вызывает git с `-c core.quotepath=false`, но полагаться
 * только на это нельзя: настройку можно перебить снаружи, а цена ошибки —
 * заблокированный коммит (инцидент VL-360). Функция чистая → тестируется
 * без git.
 *
 * Раскрываются: `\ooo` (1–3 восьмеричные цифры → байт, затем UTF-8-декод
 * всей последовательности байтов), `\n \t \r \a \b \f \v \\ \"`.
 * Строка без кавычек возвращается как есть (идемпотентность).
 *
 * @param raw — строка из `git diff --cached --name-only` / `git log`
 * @returns читаемый путь (UTF-8)
 */
export function unquoteGitPath(raw: string): string {
  const text = raw.trim();
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return text;
  const body = text.slice(1, -1);
  const bytes: number[] = [];
  const simple: Record<string, number> = {
    a: 0x07, b: 0x08, f: 0x0c, n: 0x0a, r: 0x0d, t: 0x09, v: 0x0b,
    '\\': 0x5c, '"': 0x22,
  };
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (ch !== '\\') {
      // Обычный символ: кодируем в UTF-8, чтобы смешать с раскрытыми байтами.
      bytes.push(...Buffer.from(ch, 'utf8'));
      continue;
    }
    const next = body[i + 1] ?? '';
    if (/[0-7]/.test(next)) {
      // До трёх восьмеричных цифр — один байт.
      let oct = '';
      let j = i + 1;
      while (j < body.length && oct.length < 3 && /[0-7]/.test(body[j] as string)) {
        oct += body[j] as string;
        j += 1;
      }
      bytes.push(Number.parseInt(oct, 8) & 0xff);
      i = j - 1;
      continue;
    }
    const mapped = simple[next];
    if (mapped !== undefined) {
      bytes.push(mapped);
      i += 1;
      continue;
    }
    // Неизвестная escape-последовательность — оставляем как есть.
    bytes.push(...Buffer.from(`\\${next}`, 'utf8'));
    i += 1;
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Нормализует путь для сравнения: unquote + прямые слэши + без ведущего `./`.
 *
 * @param raw — путь из git или из `paths`
 */
export function normalizeGitPath(raw: string): string {
  return unquoteGitPath(raw)
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

/** Пути из индекса, которых нет среди коммитируемых (посторонние staged-файлы). */
function stagingOutsiders(stagedAll: string[], relPaths: string[]): string[] {
  const ours = new Set(relPaths.map(normalizeGitPath));
  return stagedAll
    .map(normalizeGitPath)
    .filter(p => p !== '' && !ours.has(p));
}

/**
 * Выполняет коммит и возвращает JSON-ack (контракт VL-306/VL-310).
 *
 * @param cwd — cwd вызова MCP (в branch-mode — главный репозиторий)
 * @param opts — paths/message/amend/allowForeign (+ internal taskId)
 * @returns JSON: `ackOk` с hash/subject/paths, `ackNoop` при «нечего коммитить»
 *   либо `ackError` (отказ валидации/сверки/git-ошибка)
 */
export function commitFiles(cwd: string, opts: GitCommitOptions): string {
  const message = typeof opts.message === 'string' ? opts.message.trim() : '';
  if (message === '') {
    return ackError('git_commit: не передан message — укажи тему коммита (тело — отдельным абзацем после пустой строки).');
  }
  const rawPaths = Array.isArray(opts.paths) ? opts.paths : [];
  if (rawPaths.length === 0) {
    return ackError('git_commit: paths обязателен и не может быть пустым — перечисли явные файлы задачи, например ["src/mcp/tools.ts"].');
  }
  for (const entry of rawPaths) {
    const err = pathEntryError(entry);
    if (err) return ackError(`git_commit: ${err}`);
  }

  const taskId = (opts.taskId ?? process.env.VIBELOG_PHASE_TASK_ID ?? '').trim();
  const phase = (opts.phase ?? process.env.VIBELOG_PHASE_NAME ?? process.env.VIBELOG_RUN_PHASE ?? '').trim();
  const projectCwd = process.env.VIBELOG_CWD ? resolve(process.env.VIBELOG_CWD) : cwd;
  // Явный cwd (шаг 2 шаблона close-worktree: чужой worktree, созданный из
  // главного репо) резолвится ВНУТРИ проекта — выход наружу отклоняется.
  const explicit = typeof opts.cwd === 'string' && opts.cwd.trim() !== '' ? opts.cwd.trim() : '';
  let commitCwd = resolveCommitCwd(cwd, taskId, phase);
  if (explicit !== '') {
    const resolvedDir = resolveInProject(projectCwd, explicit, { allowRoot: true });
    if (!resolvedDir.ok) return ackError(`git_commit: cwd — ${resolvedDir.error}`);
    if (!existsSync(resolvedDir.path)) return ackError(`git_commit: cwd не найден: ${explicit}`);
    commitCwd = resolvedDir.path;
  }
  const pathsBase = commitCwd;

  // 1. Резолв путей внутри проекта коммита (выход за пределы — отказ).
  const absPaths: string[] = [];
  const relPaths: string[] = [];
  for (const entry of rawPaths) {
    const resolved = resolveInProject(pathsBase, entry.trim());
    if (!resolved.ok) return ackError(`git_commit: ${resolved.error}`);
    const rel = relative(pathsBase, resolved.path).split(sep).join('/');
    if (rel === '' || isAbsolute(rel)) {
      return ackError(`git_commit: "${entry}" не указывает на файл внутри проекта`);
    }
    absPaths.push(resolved.path);
    relPaths.push(rel);
  }

  // 2. Сверка с задачей: чужие пути — отказ с перечислением (инциденты
  // VL-137/VL-169/VL-172: close коммитил чужую работу).
  if (opts.allowForeign !== true) {
    const foreign = foreignPaths(projectCwd, taskId, relPaths);
    if (foreign.length > 0) {
      // VL-353: отказ несёт ГОТОВОЕ исправление (`retryWith`), а не только
      // текст. Директива loop detection подставит его в вызов целиком —
      // слабая модель не делает шаг «прочитать текст → вывести аргумент»
      // (инцидент agent-1794050949211: 6 дословных повторов → fail).
      return ackErrorDetailed(
        `git_commit: эти файлы не принадлежат задаче ${taskId}: ${foreign.join(', ')}. `
        + 'Коммить только файлы задачи; если это осознанно — передай allowForeign: true.',
        {
          retryWith: { allowForeign: true },
          hint: 'Добавь в вызов `allowForeign: true` — без него git_commit отклоняет чужие пути ВСЕГДА.',
        },
      );
    }
  }

  // 3. Только явные пути: `git add -- <paths>` (никогда -A и никогда ".").
  const add = git(commitCwd, ['add', '--', ...relPaths]);
  if (!add.ok) {
    return ackError(`git_commit: git add не выполнена: ${gitError(add, 'неизвестная ошибка git')}`);
  }

  // 4. Что реально оказалось в индексе по НАШИМ путям. VL-360: коммит идёт
  // через `git commit --only -- <paths>`, поэтому staged-файлы вне `paths`
  // физически не попадают в коммит и блокировать его не должны — раньше
  // отказ «в индексе посторонние файлы» запирал инструмент в состоянии, из
  // которого не было выхода (повтор с теми же путями давал ту же ошибку).
  // Теперь это предупреждение в `applied.warnings`.
  const stagedOurs = git(commitCwd, ['diff', '--cached', '--name-only', '--', ...relPaths]).stdout
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
  const stagedAll = git(commitCwd, ['diff', '--cached', '--name-only']).stdout
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
  const outsiders = stagingOutsiders(stagedAll, relPaths);
  const amend = opts.amend === true;
  if (stagedOurs.length === 0 && !amend) {
    return ackNoop(
      `Изменений нет: по путям ${relPaths.join(', ')} коммитить нечего — коммит не создан, переходи к следующему шагу.`,
      { paths: relPaths },
    );
  }

  // 5. Сборка сообщения: трейлер дописывает общий модуль VL-302, для amend —
  // полное сообщение HEAD (%B), чтобы тело не потерялось (lesson-177).
  const coauthor = resolveCommitCoauthor(projectCwd);
  let commitMessage: string;
  if (amend) {
    const head = git(commitCwd, ['log', '-1', '--pretty=%B']);
    if (!head.ok || head.stdout === '') {
      return ackError('git_commit: amend нечего переписывать — в репозитории нет коммита HEAD.');
    }
    commitMessage = buildAmendMessage(head.stdout, message, coauthor);
  } else {
    commitMessage = appendCommitTrailer(message, coauthor);
  }

  // VL-360: `--only -- <paths>` — коммит содержит РОВНО переданные пути,
  // даже если в индексе лежит чужая работа (staged-файлы вне paths остаются
  // в индексе и попадают в warnings). Без `--only` `git commit -m` забрал бы
  // весь индекс.
  const commitArgs = amend
    ? ['commit', '--amend', '--no-verify', '--only', '-m', commitMessage, '--', ...relPaths]
    : ['commit', '--no-verify', '--only', '-m', commitMessage, '--', ...relPaths];
  const commit = git(commitCwd, commitArgs);
  if (!commit.ok) {
    return ackError(`git_commit: git commit не выполнен: ${gitError(commit, 'неизвестная ошибка git')}`);
  }

  // 6. Реквизиты результата: полный hash + тема (по ним отчитывается модель).
  const head = git(commitCwd, ['log', '-1', '--pretty=%H%n%s']);
  const [hash = '', subject = ''] = head.stdout.split('\n');

  // 7. Guard от гонки — предупреждение, не блокировка (см. raceWarnings).
  const runStartedRaw = process.env.VIBELOG_RUN_STARTED_AT ?? '';
  const runStartedAtMs = runStartedRaw === '' ? null : Date.parse(runStartedRaw);
  // Файл мог исчезнуть между add и stat (удаление) — предупреждать не о чем.
  const entries = absPaths
    .map(p => (statMtime(p) === null ? null : { path: p, mtimeMs: statMtime(p) as number }))
    .filter((e): e is { path: string; mtimeMs: number } => e !== null);
  const warnings = raceWarnings(entries, runStartedAtMs, taskId);
  if (outsiders.length > 0) {
    warnings.push(
      `в индексе остались staged-файлы вне paths: ${outsiders.join(', ')} — они НЕ вошли в коммит (git commit --only) и остались в индексе`,
    );
  }

  const applied: Record<string, unknown> = { hash, subject, paths: relPaths };
  if (amend) applied.amended = true;
  if (warnings.length > 0) applied.warnings = warnings;
  return ackOk(`Коммит ${hash.slice(0, 7)} создан: ${subject}`, applied);
}

/** mtime файла в мс; null — файл не читается (не роняем ответ). */
function statMtime(absPath: string): number | null {
  try {
    return statSync(absPath).mtimeMs;
  } catch {
    return null;
  }
}