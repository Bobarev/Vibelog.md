#!/usr/bin/env node
/**
 * Точка входа CLI vibelog-agent (VL-85).
 *
 * Шим на dist/agent/cli.js (паттерн bin/vibelog.mjs): main сам разбирает
 * аргументы и печатает JSON-результат в stdout (контракт оркестратора).
 * Ошибки ловим здесь — понятное сообщение вместо стектрейса, exit 1.
 *
 * Импорт идёт из dist/ — перед использованием нужна сборка `pnpm build`.
 */
import { main } from '../dist/agent/cli.js';

main(process.argv.slice(2)).catch(err => {
  console.error(`Ошибка: ${err.message}`);
  process.exit(1);
});
