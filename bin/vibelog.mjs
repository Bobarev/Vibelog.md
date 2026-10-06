#!/usr/bin/env node
/**
 * Точка входа CLI Vibelog.md.
 *
 * Задача: принять аргументы командной строки и передать их роутеру.
 * Роутер сам разберётся, какую команду выполнять.
 *
 * Ошибки ловим здесь, чтобы показать пользователю понятное сообщение
 * (а не стектрейс Node.js), и выйти с ненулевым кодом.
 *
 * Импорт идёт из dist/ — перед использованием нужна сборка `pnpm build`.
 */
// Фильтр DEP0040 (punycode через grammy/node-fetch) — ПЕРЕД импортом dist:
// ESM-импорты выполняются до тела модуля, фильтр должен встать раньше графа.
import './warn-filter.mjs';
import { route } from '../dist/cli/router.js';
import { maybeNotifyUpdate } from '../dist/cli/update-check.js';

route(process.argv.slice(2))
  .catch(err => {
    console.error(`Ошибка: ${err.message}`);
    process.exit(1);
  })
  // VL-101: после выполнения команды — тихая проверка обновления
  // (уведомление в stderr, не чаще раза в сутки; см. src/cli/update-check.ts)
  .then(() => maybeNotifyUpdate(process.argv.slice(2)));
