/**
 * Глобальный guard от реальной сети в тестах (VL-132).
 *
 * Подключается через `setupFiles` в vitest.config.mts (VL-133):
 *   test: { setupFiles: ['./src/test-setup.mjs'] }
 * В vitest каждый тест-файл выполняется в изолированном воркере, где
 * setup-файл запускается до тестов — guard активен в каждом тест-файле
 * без правок самих файлов. (Раньше — через --import в node --test.)
 *
 * Что делает: заменяет globalThis.fetch на обёртку, которая падает
 * с ошибкой при попытке fetch к не-loopback хосту. Любой реальный
 * сетевой вызов в тестах становится fail-fast вместо тихого обхода.
 * Loopback (127.0.0.1, ::1, localhost) разрешён — на нём работают
 * мок-LLM (src/agent/cli.test.mjs) и веб-тесты (src/web/static.test.mjs).
 *
 * Прямые вызовы child_process (npm view в update-check, spawn CLI)
 * guard не ловит — они прикрываются env-гардом VIBELOG_SKIP_UPDATE_CHECK
 * в хелперах тестов (см. аудит в VL-132).
 *
 * Идемпотентна: повторный import (или двойной --import) не портит
 * обёртку — оригинальный fetch сохраняется ровно один раз.
 */

/** Маркер уже установленного guard'а (для идемпотентности). */
const GUARD_MARK = Symbol.for('vibelog.test.noNetworkGuard');

/** Хосты, на которым fetch в тестах разрешён (локальные мок-серверы). */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);

const originalFetch = globalThis.fetch;

// Guard уже стоит (повторный --import / import в тесте) — не патчим заново,
// иначе вложенные обёртки будут перепроверять URL дважды и путать стек
if (originalFetch && !originalFetch[GUARD_MARK]) {
  /** Обёртка fetch с fail-fast на не-loopback адреса (async — throw = rejection). */
  const guardedFetch = async function guardedFetch(input, init) {
    // URL может прийти строкой, URL-объектом или Request — приводим к строке
    const raw =
      typeof input === 'string'
        ? input
        : input && typeof input === 'object' && 'url' in input
          ? String(input.url)
          : String(input);
    let host = null;
    try {
      // Некорректный URL отдаём оригинальному fetch — он сам бросит TypeError
      host = new URL(raw).hostname;
    } catch {
      host = null;
    }
    // host === null — не URL (например, относительная строка): пропускаем
    // дальше, оригинальный fetch корректно откажет без сети
    if (host !== null && !LOOPBACK_HOSTS.has(host)) {
      throw new Error(
        `[VL-132] тест пытается сделать fetch к не-loopback хосту "${host}" — реальная сеть в тестах запрещена`,
      );
    }
    return originalFetch(input, init);
  };
  guardedFetch[GUARD_MARK] = true;
  globalThis.fetch = guardedFetch;
}
