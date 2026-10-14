import { defineConfig } from 'vitest/config';

/**
 * Конфигурация Vitest (VL-133, пересмотр VL-140).
 *
 * Тесты остаются `*.test.mjs` и импортируют собранное `dist/` — поэтому
 * `pnpm test` = `pnpm build && vitest run` (сборка обязательна до тестов).
 *
 * `fileParallelism: true` (VL-140): причина выключения из VL-133 устранена —
 * тесты больше не полагаются на process.env родителя: spawn'ы получают явные
 * env-объекты (шов setSpawnEnvBaseForTests оркестратора, env-параметр
 * spawnReplacementBot). Мок-серверы слушают эфемерные порты (listen(0)),
 * tmp-каталоги уникальны per-file (mkdtempSync) — параллелизм безопасен.
 *
 * `setupFiles` подключает src/test-setup.mjs — глобальный fetch-guard (VL-132),
 * запрещающий реальную сеть в тестах. В node --test guard подключался через
 * --import; в vitest эквивалент — setupFiles (файл идемпотентен).
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.mjs'],
    // backlog/references/data/ — клоны референсных репозиториев (VL-152, читаются
    // compat-тестами, не гоняются); dist/ — собранный JS (тесты его импортируют,
    // но не тестируют как набор тестов); example-backlog/ и .vibelog/ — служебные каталоги без тестов.
    exclude: ['node_modules/**', 'backlog/references/data/**', 'dist/**', '.vibelog/**', 'example-backlog/**'],
    fileParallelism: true,
    // isolate: false (VL-139): workers переиспользуются между тестовыми файлами
    // вместо спавна нового процесса на каждый файл (52 spawn'а ~159 мс каждый,
    // ожидание −8…10 с по профилю 2026-10-13). Безопасно, опираясь на
    // VL-125 (тесты чистят env после себя) и VL-140 (tmp уникальны per-file,
    // мок-серверы на эфемерных портах, spawn'ы получают явные env-объекты) —
    // состояние между файлами в одном worker не утекает.
    isolate: false,
    setupFiles: ['./src/test-setup.mjs'],
    // В node:test таймаутов по умолчанию не было; в vitest дефолт 5s, а тесты
    // спавнят git/CLI и ждут мок-серверы — поднимаем до разумного максимума.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
