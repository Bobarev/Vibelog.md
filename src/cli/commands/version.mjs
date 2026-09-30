/**
 * Команда `vibelog --version` / `-v` — информация о версии.
 *
 * Совместимо с оригиналом Backlog.md: `-v` / `--version` выводит
 * только номер версии (как commander `.version()`).
 *
 * Расширение: `--version --json` — пути и версия Node.js.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Читает имя и версию из package.json проекта.
 *
 * Путь вычисляется относительно bin/vibelog.mjs (через src/ → ..),
 * чтобы версия не зависела от process.cwd().
 *
 * @returns {{ name: string, version: string }}
 */
function readPackageInfo() {
  try {
    const pkgPath = join(__dirname, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return { name: pkg.name || 'vibelog.md', version: pkg.version || '0.0.0' };
  } catch {
    return { name: 'vibelog.md', version: '0.0.0' };
  }
}

/**
 * Определяет, откуда запущен бинарник (через which).
 *
 * @returns {string|null} — путь из PATH или null
 */
function findBinPath() {
  try {
    const out = execSync('which vibelog 2>/dev/null', { encoding: 'utf-8', timeout: 2000 });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Резолвит реальный путь к запущенному скрипту.
 *
 * @returns {string} — абсолютный путь
 */
function findSrcPath() {
  try {
    return realpathSync(process.argv[1]);
  } catch {
    return process.argv[1] || '';
  }
}

/**
 * Выполняет команду версии.
 *
 * @param {string[]} args — аргументы (флаги)
 * @param {Record<string, unknown>} flags — флаги
 */
export function runVersion(args, flags) {
  const { name, version } = readPackageInfo();
  const src = findSrcPath();
  const bin = findBinPath() || src;
  const node = process.version;

  // Краткий режим: -v → только номер версии
  if (flags.v && !flags.json && !flags.version) {
    console.log(version);
    return;
  }

  // JSON-режим
  if (flags.json) {
    const result = {
      name,
      version,
      bin,
      src,
      node,
      engines: { node: '>=20' },
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Полный режим: --version
  console.log(`${name} ${version}`);
  console.log(`  bin:  ${bin}`);
  console.log(`  src:  ${src}`);
  console.log(`  node: ${node}`);
}
