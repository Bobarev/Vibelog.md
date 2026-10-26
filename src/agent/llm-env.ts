/**
 * Общая валидация LLM-окружения агента (VL-189).
 *
 * Раньше проверки VIBELOG_LLM_API_KEY / VIBELOG_LLM_MODEL и тексты ошибок
 * дублировались в двух местах: headless-CLI (src/agent/cli.ts — запуск фаз
 * из бота/браузера) и интерактивный чат (src/agent/interactive.ts).
 * Вынесены сюда, чтобы бот и браузер вели себя одинаково (дедупликация
 * по плану VL-189), а формулировки оставались дословно прежними — их
 * матчат тесты (cli.test.mjs: /VIBELOG_LLM_API_KEY/) и их видит пользователь.
 */

/**
 * Проверяет, что LLM-переменные окружения заданы; при отсутствии печатает
 * понятную ошибку в stderr.
 *
 * @param subject — получатель доступа в тексте ошибки: 'агенту' (headless
 *   запуск фаз) либо 'чату с агентом' (TUI-чат) — сохраняет старые формулировки
 * @returns true, если env валиден (ключ и модель заданы); false — иначе
 *   (вызывающий выставляет process.exitCode = 1 и прекращает запуск)
 */
export function ensureLlmEnv(subject: 'агенту' | 'чату с агентом'): boolean {
  // LLM из env: VIBELOG_LLM_BASE_URL / VIBELOG_LLM_API_KEY / VIBELOG_LLM_MODEL
  if (!process.env.VIBELOG_LLM_API_KEY) {
    console.error(
      `Ошибка: не задан VIBELOG_LLM_API_KEY — ${subject} нужен доступ к LLM (env VIBELOG_LLM_BASE_URL/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL)`
    );
    return false;
  }
  if (!process.env.VIBELOG_LLM_MODEL) {
    console.error('Ошибка: не задана VIBELOG_LLM_MODEL — модель LLM неизвестна');
    return false;
  }
  return true;
}
