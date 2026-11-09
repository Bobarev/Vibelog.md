/**
 * Маркеры окружения для дочернего запуска CLI из `vb create` (VL-389).
 *
 * Зачем отдельный модуль: маркер передаёт `src/core/create.ts` (в env
 * `scripts.postCreate`), а читает `src/cli/commands/init.ts`. Строковый
 * литерал в двух местах разъехался бы при первой же правке, а «тихо
 * перестало подавляться предупреждение» — дефект, который замечают глазами
 * через полгода.
 *
 * `postCreate` — шаг **внутри** более крупной операции (`vb create`), но
 * `init` об этом не знает и ведёт себя как самостоятельная команда:
 * предупреждает, что проект не в git (а `vb create` создаст репозиторий
 * через два шага) и печатает финальную подсказку «Дальше: …», за которой
 * сразу идёт итоговый блок `vb create`. Маркер сообщает `init`, что он
 * вызван из `create`, и несёт смысл «git будет / git не будет»: при
 * `--no-git` пользователь действительно остаётся без репозитория, и
 * предупреждение там правдиво — подавлять его нельзя.
 */

/**
 * Имя переменной окружения-маркера.
 *
 * Специфично для `vb create` намеренно: значение наследуют все дочерние
 * процессы `postCreate`, и общее имя («VIBELOG_INIT_CHILD») расширило бы
 * область действия флага на код, который к созданию проекта не относится.
 * Переменная внутренняя и недокументированная: выставивший её вручную
 * пользователь сам отвечает за отсутствие предупреждения.
 */
export const CREATE_MARKER_ENV = 'VIBELOG_CREATE';

/** `vb create` выполнит `git init` после `postCreate` — предупреждение о git не нужно. */
export const CREATE_MARKER_GIT = '1';

/** `vb create` запущен с `--no-git`: репозитория не будет, предупреждение правдиво. */
export const CREATE_MARKER_NO_GIT = 'no-git';

/**
 * Значение маркера для запуска `postCreate`.
 *
 * Одна форма на оба случая: `'1'` — git будет инициализирован, `'no-git'` —
 * не будет. Значение, а не отдельная переменная, чтобы не появилось двух
 * независимых флагов, которые могут противоречить друг другу.
 */
export function createMarkerValue(noGit: boolean): string {
  return noGit ? CREATE_MARKER_NO_GIT : CREATE_MARKER_GIT;
}

/** Что означает маркер окружения для текущего процесса `init`. */
export interface CreateContext {
  /** `init` вызван из `postCreate` внутри `vb create`. */
  fromCreate: boolean;
  /** `vb create` сам создаст git-репозиторий после `postCreate`. */
  gitWillBeInitialized: boolean;
}

/**
 * Читает маркер окружения (по умолчанию — `process.env`).
 *
 * `env` параметром — ради тестов: подменять `process.env` целиком в
 * in-process тестах дороже, чем передать объект (VL-374, lesson-254).
 */
export function readCreateContext(env: NodeJS.ProcessEnv = process.env): CreateContext {
  const raw = env[CREATE_MARKER_ENV];
  const fromCreate = raw !== undefined;
  return {
    fromCreate,
    gitWillBeInitialized: fromCreate && raw === CREATE_MARKER_GIT,
  };
}
