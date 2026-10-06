/**
 * Проверка обновлений Vibelog.md (VL-101).
 *
 * Механизм по мотивам автообновления Qwen Code
 * (refs/qwen-code/packages/cli/src/ui/utils/updateCheck.ts):
 * `npm view <pkg> version --json` → сравнение с текущей версией.
 *
 * Отличия от оригинала (по уточнению Spec и плану):
 * - только уведомление о новой версии, без автоустановки;
 * - без зависимости semver (zero-runtime-deps) — своё мини-сравнение версий;
 * - проверка не чаще раза в 24 часа: единый TTL кэша и для успеха, и для ошибки;
 * - жёсткий предел задержки CLI — 3 с (Promise.race), сам npm view ограничен 5 с;
 * - уведомление только в stderr — контракт `-v` / `--json` не ломается
 *   (printWarning из ui.ts пишет в console.log, поэтому используется console.error);
 * - ошибки сети молча глотаются: офлайн-пользователь работает как раньше.
 */

import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { colorize, colors } from './ui.js';
import { readPackageInfo } from './commands/version.js';

/** TTL кэша: 24 часа — и для успешной проверки, и для ошибки. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Жёсткий предел задержки CLI на проверку обновления (Promise.race). */
const FETCH_RACE_MS = 3000;

/** Timeout для дочернего процесса npm view (как в Qwen Code). */
const NPM_TIMEOUT_MS = 5000;

/** Команды, при которых проверка пропускается: долгоживущие / JSON-RPC по stdout. */
const SKIP_COMMANDS = ['mcp', 'browser', 'bot', 'qwen-debug'];

/** Значения env-гарда, означающие «отключить проверку обновлений». */
const SKIP_ENV_VALUES = ['true', '1', 'yes'];

/** Опции вызова npm — прокидываются в exec и в exec-мок тестов. */
export interface ExecOpts {
  timeout?: number;
  encoding?: string;
  windowsHide?: boolean;
  signal?: AbortSignal;
}

/** Запись кэша проверки обновлений (файл в tmpdir). */
export interface UpdateCacheEntry {
  /** Момент последней проверки (мс). */
  checkedAt: number;
  /** Последняя известная версия из registry (при успехе). */
  latest?: string;
  /** Текущая версия пакета на момент проверки. */
  current?: string;
  /** Флаг ошибки: проверка не удалась, следующая попытка — через сутки. */
  error?: boolean;
}

/** Инжектируемые зависимости — для тестов без сети и без реального времени. */
export interface UpdateCheckDeps {
  /** Мок child_process.execFile. */
  exec?: (file: string, args: string[], opts: ExecOpts) => Promise<{ stdout: string; stderr: string }>;
  /** Мок Date.now. */
  now?: () => number;
  /** Путь к файлу кэша (по умолчанию — <tmpdir>/vibelog-update-check.json). */
  cachePath?: string;
  /** Мок чтения package.json (имя и текущая версия). */
  readPackageInfo?: () => { name: string; version: string };
  /** AbortSignal: по таймауту гонки убивает дочерний процесс npm. */
  signal?: AbortSignal;
}

/** Путь к файлу кэша по умолчанию. */
export function defaultCachePath(): string {
  return join(tmpdir(), 'vibelog-update-check.json');
}

/**
 * Мини-semver: сравнивает `major.minor.patch[-prerelease]`.
 *
 * @returns >0 если a новее b, <0 если a старше b, 0 — если равны
 *   или входные данные некорректны («не новее» — проверку не роняем)
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): { core: number[]; pre: string | null } | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v.trim());
    if (!m) return null;
    return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
  };
  const pa = parse(a);
  const pb = parse(b);
  // Кривой ввод → 0: не новее и не старше, сравнение не роняем
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] > pb.core[i] ? 1 : -1;
  }
  // Ядро одинаково: prerelease-сборка всегда старше релиза (правило semver)
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  // Обе сборки — посимвольное сравнение достаточно для уведомления о версии
  return pa.pre === pb.pre ? 0 : pa.pre > pb.pre ? 1 : -1;
}

/** Дефолтная реализация exec поверх child_process.execFile. */
function defaultExec(
  file: string,
  args: string[],
  opts: ExecOpts,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: opts.timeout ?? NPM_TIMEOUT_MS,
        encoding: 'utf8',
        windowsHide: true,
        signal: opts.signal,
      },
      (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/**
 * Запрашивает последнюю версию пакета: `npm view <name> version --json`.
 *
 * Принимает оба формата вывода npm: голую JSON-строку (npm ≤11) и массив
 * с одним элементом (npm 12+). Любые ошибки (нет npm, сеть, кривой JSON)
 * → null, молча — проверка обновления не должна ломать CLI.
 */
export async function fetchLatestVersion(deps: UpdateCheckDeps = {}): Promise<string | null> {
  const pkg = (deps.readPackageInfo ?? readPackageInfo)();
  const exec = deps.exec ?? defaultExec;
  let stdout: string;
  try {
    ({ stdout } = await exec('npm', ['view', pkg.name, 'version', '--json'], {
      timeout: NPM_TIMEOUT_MS,
      encoding: 'utf8',
      windowsHide: true,
      signal: deps.signal,
    }));
  } catch {
    // Ошибка exec (нет npm в PATH, таймаут, сеть) — молча, без уведомления
    return null;
  }
  const out = String(stdout ?? '').trim();
  // Пустой stdout — registry не вернул версию (например, приватное зеркало)
  if (out === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    return null; // кривой JSON
  }
  if (typeof parsed === 'string') return parsed; // npm ≤11
  if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === 'string') {
    return parsed[0]; // npm 12+
  }
  return null; // неожиданная структура
}

/** Читает кэш; отсутствие/повреждение файла — не ошибка (tmpdir чистят). */
function readCache(path: string): UpdateCacheEntry | null {
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8')) as UpdateCacheEntry;
    return typeof data.checkedAt === 'number' ? data : null;
  } catch {
    return null;
  }
}

/** Пишет кэш; сбой записи не критичен — пересоздаём при следующем запуске. */
function writeCache(path: string, entry: UpdateCacheEntry): void {
  try {
    writeFileSync(path, JSON.stringify(entry), 'utf-8');
  } catch {
    // Кэш — оптимизация; его отсутствие не влияет на работу CLI
  }
}

/**
 * Нужно ли пропустить проверку обновлений.
 *
 * Пропускаем: env-гард VIBELOG_SKIP_UPDATE_CHECK=true|1|yes,
 * долгоживущие/JSON-RPC-команды (mcp печатает JSON-RPC по stdout),
 * флаги -v/--version — контракт Backlog.md: `-v` выводит только номер версии.
 */
export function shouldSkip(argv: string[] = [], env: NodeJS.ProcessEnv = process.env): boolean {
  const guard = String(env.VIBELOG_SKIP_UPDATE_CHECK ?? '').toLowerCase();
  if (SKIP_ENV_VALUES.includes(guard)) return true;
  const cmd = argv.find((a) => !a.startsWith('-'));
  if (cmd && SKIP_COMMANDS.includes(cmd)) return true;
  if (argv.includes('-v') || argv.includes('--version')) return true;
  return false;
}

/**
 * Публичная точка входа: проверить registry и уведомить о новой версии.
 *
 * Уведомление — только в stderr и только если версия действительно новее.
 * Проверка не чаще раза в 24 часа (единый TTL кэша для успеха и ошибки);
 * ошибки молча глотаются, CLI продолжает работать как раньше.
 */
export async function maybeNotifyUpdate(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  deps: UpdateCheckDeps = {},
): Promise<void> {
  try {
    if (shouldSkip(argv, env)) return;

    const now = deps.now ?? Date.now;
    const cachePath = deps.cachePath ?? defaultCachePath();

    // Свежий кэш (< 24 ч, успех или ошибка) → тихий выход:
    // ни сетевого npm view, ни уведомления — «раз в 24 часа» для обоих
    const cached = readCache(cachePath);
    if (cached && now() - cached.checkedAt < CACHE_TTL_MS) return;

    const checkedAt = now();
    const pkg = (deps.readPackageInfo ?? readPackageInfo)();

    // Гонка с таймером: CLI не ждёт registry дольше 3 с; abort убивает npm child,
    // чтобы процесс не «висел» после ответа пользователя
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let latest: string | null;
    try {
      latest = await Promise.race([
        fetchLatestVersion({ ...deps, signal: ac.signal }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            ac.abort();
            resolve(null);
          }, FETCH_RACE_MS);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    if (latest === null) {
      // Ошибка/таймаут — молча; следующая попытка не раньше чем через 24 ч
      writeCache(cachePath, { checkedAt, error: true });
      return;
    }

    if (compareVersions(latest, pkg.version) > 0) {
      // Только stderr: stdout не трогаем — контракт -v / --json сохраняется
      console.error(
        `${colorize('⚠', colors.yellow)} Доступна новая версия для обновления: npm install -g ${pkg.name} (текущая: ${pkg.version} → новая: ${latest})`,
      );
    }
    writeCache(cachePath, { checkedAt, latest, current: pkg.version });
  } catch {
    // Обновление никогда не должно ломать CLI — любые сбои молча глотаем
  }
}
