#!/usr/bin/env node
/**
 * Точка входа CLI Vibelog.md.
 *
 * Задача: принять аргументы командной строки и передать их роутеру.
 * Роутер сам разберётся, какую команду выполнять.
 *
 * Ошибки ловим здесь, чтобы показать пользователю понятное сообщение
 * (а не стектрейс Node.js), и выйти с ненулевым кодом.
 */
import { route } from '../src/cli/router.mjs';

route(process.argv.slice(2)).catch(err => {
  console.error(`Ошибка: ${err.message}`);
  process.exit(1);
});
