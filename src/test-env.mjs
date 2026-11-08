/**
 * Хелперы тестового окружения: изоляция от env агентской сессии.
 *
 * Причина (VL-286, VL-374, уроки lesson-88/lesson-113/lesson-120/lesson-254):
 * тест, запущенный внутри агентской фазы, наследует переменные окружения
 * оркестратора — `VIBELOG_CWD` (главный репозиторий вместо mkdtemp-каталога
 * теста), `VIBELOG_PHASE_*` / `VIBELOG_RUN_*` (фаза/ран родителя подменяет
 * фазу из меты сессии) и `VIBELOG_SESSION_ID` (fallback учёта токенов уходит
 * в реальный jsonl вместо фикстуры). Из-за этого прогон падал не по вине кода,
 * и приходилось вручную снимать переменные префиксом `env -u …`.
 *
 * Три формы изоляции — выбираются по способу вызова тестируемого кода:
 * 1. `testSpawnEnv(extra?)` — ЧИСТАЯ: собирает и возвращает объект env для
 *    спавна дочернего процесса, `process.env` НЕ мутирует. Для CLI/MCP-спавнов.
 * 2. `stripVibelogEnv(env)` — мутирует ПЕРЕДАННЫЙ объект: для тестов, которые
 *    собирают env сами (своя база вроде gitEnv).
 * 3. `clearPhaseEnv()` / `withCleanPhaseEnv(fn)` — мутируют `process.env` и
 *    восстанавливают его: для IN-PROCESS вызовов (`handleToolCall`), где
 *    дочернего процесса нет и env иначе не подменить (VL-374, lesson-254).
 *
 * Почему отдельный модуль, а не `src/test-setup.mjs`: setup-файл
 * подключается через `setupFiles` и ставит guard'ы (fetch/spawn) как
 * side-effect; тест-файлу, которому нужен только env-хелпер, тянуть этот
 * импорт незачем. `.mjs` вне tsc-сборки (`allowJs: false`) — `pnpm build`
 * не затрагивается, vitest резолвит импорт напрямую.
 */

/**
 * Ключи, которые снимаются целиком (точное совпадение).
 * VIBELOG_CWD — глобальный «главный репозиторий» для фоновых фаз (VL-107/167),
 * VIBELOG_SESSION_ID — сессия агента для fallback-учёта токенов (VL-198).
 */
const STRIP_EXACT = ['VIBELOG_CWD', 'VIBELOG_SESSION_ID'];

/**
 * Префиксы, снимаемые целиком: фазовый env оркестратора (VL-114/243/259).
 * Именно префиксы, а не перечисление имён: новые `VIBELOG_PHASE_*` /
 * `VIBELOG_RUN_*` не потребуют правок в каждом тест-файле.
 */
const STRIP_PREFIX = ['VIBELOG_PHASE_', 'VIBELOG_RUN_'];

/**
 * Перечисляет ключи env, относящиеся к агентской сессии (фазовый env).
 *
 * Единый предикат для всех трёх форм изоляции: иначе список ключей пришлось
 * бы дублировать в `stripVibelogEnv` и `clearPhaseEnv` и они разъехались бы.
 *
 * @param {Record<string, string | undefined>} env — объект env (обычно process.env)
 * @returns {string[]} — имена ключей, подлежащих снятию
 */
function phaseEnvKeys(env) {
  return Object.keys(env).filter(
    (key) => STRIP_EXACT.includes(key) || STRIP_PREFIX.some((prefix) => key.startsWith(prefix)),
  );
}

/**
 * Снимает унаследованный фазовый env из объекта env (мутирует и возвращает его).
 *
 * Нужен там, где env собирается не через testSpawnEnv (своя база вроде
 * gitEnv или подготовленный объект): `stripVibelogEnv({ ...gitEnv })`.
 *
 * @param {Record<string, string | undefined>} env — объект env дочернего процесса
 * @returns {Record<string, string | undefined>} — тот же объект после очистки
 */
export function stripVibelogEnv(env) {
  for (const key of phaseEnvKeys(env)) delete env[key];
  return env;
}

/**
 * Собирает env для дочернего CLI/MCP-процесса теста: база `process.env` +
 * `VIBELOG_SKIP_UPDATE_CHECK` (VL-132 — иначе каждый spawn CLI уходил бы
 * `npm view` в реальный registry), минус унаследованный фазовый env.
 *
 * `extra` накладывается ПОСЛЕ очистки: тестам, которым переменные нужны
 * осознанно (кейсы «фаза из меты», явный VIBELOG_SESSION_ID в
 * `callMcpWithEnv`), достаточно передать их параметром — ручные
 * `if (!('X' in extraEnv)) delete …` больше не нужны.
 *
 * Контракт: функция ЧИСТАЯ — `process.env` не мутирует (в отличие от
 * `clearPhaseEnv`, VL-374).
 *
 * @param {Record<string, string | undefined>} [extra] — переопределения поверх очищенного env
 * @returns {Record<string, string | undefined>} — готовый env для spawn/spawnSync
 */
export function testSpawnEnv(extra = {}) {
  const env = { ...process.env, VIBELOG_SKIP_UPDATE_CHECK: 'true' };
  stripVibelogEnv(env);
  return { ...env, ...extra };
}

/**
 * Снимает унаследованный фазовый env из `process.env` и возвращает функцию
 * восстановления (VL-374, lesson-254).
 *
 * Зачем отдельная форма: `testSpawnEnv` собирает объект для дочернего
 * процесса, а in-process вызовы (`handleToolCall` в тестах MCP) работают с
 * `process.env` текущего процесса — подменить его можно только мутацией.
 * Поэтому контракт ОБРАТНЫЙ: здесь `process.env` мутируется, а возвращённая
 * функция возвращает снятые значения на место (включая `undefined` —
 * «ключа не было»).
 *
 * Применять на уровне ФАЙЛА (`beforeAll`/`afterAll`), а не внутри отдельного
 * `describe`: частичная изоляция маскирует дыру у соседних блоков — именно
 * так возник дефект VL-370.
 *
 * @returns {() => void} — восстановление снятых значений
 */
export function clearPhaseEnv() {
  const saved = {};
  for (const key of phaseEnvKeys(process.env)) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

/**
 * Выполняет `fn` с очищенным фазовым env и восстанавливает env после него
 * (в том числе при исключении) — для точечного кейса внутри одного `it`.
 *
 * ВАЖНО про порядок: env снимается ДО вызова `fn`, поэтому значение,
 * выставленное ВНУТРИ `fn`, действует. Если тесту нужна конкретная фаза —
 * выставлять её до обёртки (или без обёртки), а не внутри.
 *
 * @template T
 * @param {() => T | Promise<T>} fn — тело теста
 * @returns {Promise<T>} — результат `fn`
 */
export async function withCleanPhaseEnv(fn) {
  const restore = clearPhaseEnv();
  try {
    return await fn();
  } finally {
    restore();
  }
}
