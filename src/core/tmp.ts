/**
 * Жёсткий путь для временных файлов проекта (VL-329).
 *
 * Правило: новый код НЕ пишет в корень проекта. Всё временное — логи,
 * дампы, промежуточные артефакты — живёт в `.vibelog/tmp/`, который
 * создаётся при первом обращении и не попадает в git (см.
 * `.vibelog/.gitignore`).
 *
 * Зачем отдельный модуль: раньше отладочные логи появлялись прямо в корне
 * (`vibelog-browser.log`, `vl176-test.log`, …) и засоряли `git status`.
 * Единый хелпер делает место записи очевидным и проверяемым.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Каталог временных файлов проекта (`.vibelog/tmp`). */
export function tmpDir(cwd: string): string {
  return join(cwd, '.vibelog', 'tmp');
}

/**
 * Создаёт `.vibelog/tmp` (mkdir -p) и возвращает путь.
 *
 * Идемпотентно: повторный вызов на существующем каталоге — no-op.
 */
export function ensureTmpDir(cwd: string): string {
  const dir = tmpDir(cwd);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Путь временного файла внутри `.vibelog/tmp` (каталог создаётся).
 *
 * @param cwd — директория проекта
 * @param name — имя файла (без слэшей: подкаталоги не поддерживаются намеренно,
 *   чтобы временные файлы не расползались по дереву)
 */
export function tmpFile(cwd: string, name: string): string {
  return join(ensureTmpDir(cwd), name);
}
