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
import { maybeNotifyUpdate, shouldNotifyAtStartup } from '../dist/cli/update-check.js';

const argv = process.argv.slice(2);
// VL-206: bot/browser — долгоживущие, route() для них не завершается до
// остановки сервиса → проверка обновления выполняется при запуске ДО route
// (уведомление в stderr раньше любого вывода сервиса, задержка ≤3 с раз в сутки)
const notifyFirst = shouldNotifyAtStartup(argv);

const flow = notifyFirst
  ? maybeNotifyUpdate(argv).then(() => route(argv))
  : route(argv);

flow
  .catch(err => {
    console.error(`Ошибка: ${err.message}`);
    process.exit(1);
  })
  // VL-101/VL-206: после выполнения команды — тихая проверка обновления
  // (уведомление в stderr, не чаще раза в сутки); для bot/browser проверка
  // уже была при запуске — пост-route вызов пропускаем
  .then(() => (notifyFirst ? undefined : maybeNotifyUpdate(argv)));
