/**
 * Операции git для `vb init` (VL-348): проверка репозитория, `git init`,
 * первый коммит и remote.
 *
 * Почему отдельный модуль, а не переиспользование `finishGit` из `create.ts`:
 * `vb create` создаёт проект в СВЕЖЕМ каталоге и всегда делает init+коммит, а
 * `vb init` работает в произвольном каталоге — там репозиторий может уже
 * существовать (тогда шаг пропускается), а коммит делается только по явному
 * согласию пользователя. Общий код здесь — только примитивы git.
 *
 * Совместимость с Catalina (git 2.24): `git init -b main` появился в git 2.28,
 * поэтому ветка выставляется через `git symbolic-ref HEAD refs/heads/main` с
 * фолбэком на дефолт git — как в `create.ts` при sparse-checkout.
 *
 * Отсутствие git в PATH — не исключение, а `{ ok: false, reason: 'no-git' }`:
 * проект уже создан и рабочий, пользователь инициализирует репозиторий сам.
 */

import { spawnSync } from 'node:child_process';
import { commitMessageArgs } from './commit-trailer.js';

/** Результат операции git: причина отказа вместо исключения. */
export interface GitOpResult {
  ok: boolean;
  /** Машиночитаемая причина отказа (для ветвления в вызывающем коде). */
  reason?: 'no-git' | 'failed' | 'exists' | 'invalid-url';
  /** Текст для пользователя (stderr git или пояснение). */
  message?: string;
}

/** Раннер git (инъекция в тестах: PATH без git, фикстуры). */
export type GitRunner = (args: string[], cwd: string) => {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
};

/** Раннер по умолчанию: настоящий процесс без shell. */
const defaultRunner: GitRunner = (args, cwd) => {
  const res = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    ...(res.error ? { error: res.error } : {}),
  };
};

/** Последние строки stderr — для сообщения об ошибке git. */
function tail(text: string | undefined, lines = 3): string {
  const value = (text ?? '').trim();
  if (value === '') return 'без вывода';
  return value.split('\n').slice(-lines).join(' | ');
}

/**
 * Находится ли каталог внутри git-репозитория.
 *
 * `rev-parse --is-inside-work-tree` отвечает `true` и для подкаталога чужого
 * репозитория — именно это и нужно: вложенный репозиторий не создаём.
 *
 * @param cwd — каталог проекта
 * @param runner — раннер git (по умолчанию настоящий)
 */
export function isInsideGitRepo(cwd: string, runner: GitRunner = defaultRunner): boolean {
  const res = runner(['rev-parse', '--is-inside-work-tree'], cwd);
  return !res.error && res.status === 0 && String(res.stdout ?? '').trim() === 'true';
}

/**
 * Инициализирует git-репозиторий в каталоге.
 *
 * Идемпотентен: если каталог уже внутри репозитория — `{ ok: true, reason:
 * 'exists' }` и ничего не делается (двойного `git init` не бывает, AC13).
 * Ветка — `main` через `symbolic-ref` (git < 2.28 не знает `init -b`);
 * не удалось — остаётся дефолт git, это не ошибка.
 *
 * @param cwd — каталог проекта
 * @param runner — раннер git
 */
export function gitInit(cwd: string, runner: GitRunner = defaultRunner): GitOpResult {
  if (isInsideGitRepo(cwd, runner)) return { ok: true, reason: 'exists' };

  const init = runner(['init'], cwd);
  if (init.error) return { ok: false, reason: 'no-git', message: init.error.message };
  if (init.status !== 0) {
    return { ok: false, reason: 'failed', message: tail(init.stderr) };
  }

  // Ветка main: symbolic-ref работает во всех версиях git, но в репозитории
  // без коммитов HEAD ещё не существует — команда создаёт его. Ошибку
  // игнорируем: дефолтная ветка git тоже рабочий вариант.
  runner(['symbolic-ref', 'HEAD', 'refs/heads/main'], cwd);
  return { ok: true };
}

/**
 * Делает первый коммит: `git add -A` + `git commit` с трейлером (VL-302).
 *
 * Трейлер добавляется через `commitMessageArgs`, а не инструментом
 * `git_commit`: тот живёт в MCP-слое и требует задачи, а здесь коммит
 * создаётся в чужом проекте без backlog-задачи.
 *
 * @param cwd — каталог проекта
 * @param message — сообщение коммита
 * @param runner — раннер git
 */
export function initialCommit(
  cwd: string,
  message = 'Initial commit',
  runner: GitRunner = defaultRunner,
): GitOpResult {
  const add = runner(['add', '-A'], cwd);
  if (add.error) return { ok: false, reason: 'no-git', message: add.error.message };
  if (add.status !== 0) return { ok: false, reason: 'failed', message: tail(add.stderr) };

  const commit = runner(['commit', ...commitMessageArgs(cwd, message)], cwd);
  if (commit.error) return { ok: false, reason: 'no-git', message: commit.error.message };
  if (commit.status !== 0) return { ok: false, reason: 'failed', message: tail(commit.stderr) };
  return { ok: true };
}

/**
 * Признак валидного адреса remote: http(s), ssh:// или scp-подобный git@host:path.
 *
 * Валидация мягкая (формат, а не доступность): невалидный URL — предупреждение,
 * проект остаётся созданным.
 */
export function isValidRemoteUrl(url: string): boolean {
  const value = url.trim();
  if (value === '') return false;
  if (/^https?:\/\/[^\s]+$/i.test(value)) return true;
  if (/^ssh:\/\/[^\s]+$/i.test(value)) return true;
  // scp-подобный: git@host:path (двоеточие обязательно, путь непустой)
  if (/^[^\s@]+@[^\s@]+:[^\s]+$/.test(value)) return true;
  return false;
}

/**
 * Добавляет remote `origin`.
 *
 * Существующий `origin` не перезаписывается без `force` (AC7): молчаливая
 * замена чужого адреса — потеря настройки, которую пользователь не просил
 * менять.
 *
 * @param cwd — каталог проекта
 * @param url — адрес remote
 * @param options.force — заменить существующий origin
 * @param runner — раннер git
 */
export function addRemote(
  cwd: string,
  url: string,
  options: { force?: boolean } = {},
  runner: GitRunner = defaultRunner,
): GitOpResult {
  if (!isValidRemoteUrl(url)) {
    return { ok: false, reason: 'invalid-url', message: `невалидный адрес remote: «${url}»` };
  }
  const list = runner(['remote'], cwd);
  if (list.error) return { ok: false, reason: 'no-git', message: list.error.message };
  const remotes = String(list.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');

  if (remotes.includes('origin')) {
    if (options.force !== true) {
      return { ok: false, reason: 'exists', message: 'remote origin уже настроен' };
    }
    const remove = runner(['remote', 'remove', 'origin'], cwd);
    if (remove.status !== 0) {
      return { ok: false, reason: 'failed', message: tail(remove.stderr) };
    }
  }

  const add = runner(['remote', 'add', 'origin', url.trim()], cwd);
  if (add.error) return { ok: false, reason: 'no-git', message: add.error.message };
  if (add.status !== 0) return { ok: false, reason: 'failed', message: tail(add.stderr) };
  return { ok: true };
}
