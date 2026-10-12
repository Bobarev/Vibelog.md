import { defineConfig } from 'vitest/config';

/**
 * Конфигурация Vitest (VL-133).
 *
 * Тесты остаются `*.test.mjs` и импортируют собранное `dist/` — поэтому
 * `pnpm test` = `pnpm build && vitest run` (сборка обязательна до тестов).
 *
 * `fileParallelism: false`: тесты используют spawn git/CLI, tmp-каталоги
 * и мок-серверы на фиксированных портах — параллелизация по файлам в первый
 * заход выключается ради стабильности (можно включить отдельной задачей).
 *
 * `setupFiles` подключает src/test-setup.mjs — глобальный fetch-guard (VL-132),
 * запрещающий реальную сеть в тестах. В node --test guard подключался через
 * --import; в vitest эквивалент — setupFiles (файл идемпотентен).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.mjs'],
    // refs/ — исходники оригинала Backlog.md (читаются compat-тестами, не гоняются);
    // dist/ — собранный JS (тесты его импортируют, но не тестируют как набор тестов);
    // example-backlog/ и .vibelog/ — служебные каталоги без тестов.
    exclude: ['node_modules/**', 'refs/**', 'dist/**', '.vibelog/**', 'example-backlog/**'],
    fileParallelism: false,
    setupFiles: ['./src/test-setup.mjs'],
    // В node:test таймаутов по умолчанию не было; в vitest дефолт 5s, а тесты
    // спавнят git/CLI и ждут мок-серверы — поднимаем до разумного максимума.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
