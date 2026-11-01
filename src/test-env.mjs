/**
 * Хелпер тестового окружения для процессов, которые тест спавнит (CLI/MCP).
 *
 * Причина (VL-286, уроки lesson-88/lesson-113/lesson-120): тест, запущенный
 * внутри агентской фазы, наследует переменные окружения оркестратора —
 * `VIBELOG_CWD` (главный репозиторий вместо mkdtemp-каталога теста),
 * `VIBELOG_PHASE_*` / `VIBELOG_RUN_*` (фаза/ран родителя подменяет фазу из
 * меты сессии) и `VIBELOG_SESSION_ID` (fallback учёта токенов уходит в
 * реальный jsonl вместо фикстуры). Из-за этого прогон падал не по вине кода,
 * и приходилось вручную снимать переменные префиксом `env -u …`.
 *
 * Решение: один хелпер, который собирает env дочернего процесса и вычищает
 * унаследованный фазовый env. Чистая функция — глобальный `process.env` не
 * мутирует, поэтому безопасна при `fileParallelism: true` + `isolate: false`
 * (VL-140): состояние между тест-файлами в одном воркере не утекает.
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
 * Снимает унаследованный фазовый env из объекта env (мутирует и возвращает его).
 *
 * Нужен там, где env собирается не через testSpawnEnv (своя база вроде
 * gitEnv или подготовленный объект): `stripVibelogEnv({ ...gitEnv })`.
 *
 * @param {Record<string, string | undefined>} env — объект env дочернего процесса
 * @returns {Record<string, string | undefined>} — тот же объект после очистки
 */
export function stripVibelogEnv(env) {
  for (const key of Object.keys(env)) {
    if (STRIP_EXACT.includes(key)) {
      delete env[key];
      continue;
    }
    if (STRIP_PREFIX.some((prefix) => key.startsWith(prefix))) delete env[key];
  }
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
 * @param {Record<string, string | undefined>} [extra] — переопределения поверх очищенного env
 * @returns {Record<string, string | undefined>} — готовый env для spawn/spawnSync
 */
export function testSpawnEnv(extra = {}) {
  const env = { ...process.env, VIBELOG_SKIP_UPDATE_CHECK: 'true' };
  stripVibelogEnv(env);
  return { ...env, ...extra };
}
