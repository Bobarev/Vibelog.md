/**
 * Команда `vibelog upstream report` (VL-363) — репорт бага в upstream-проект
 * через GitVerse Issues.
 *
 * Зачем CLI, если есть MCP-инструмент `upstream_report_bug`: в дочернем
 * проекте глобальный пакет `vibelog` может быть старой версии (MCP-инструмента
 * ещё нет), а CLI-фолбэк работает сразу после обновления. Оба пути идут ОДНИМ
 * кодом ядра (`reportBug`), поэтому формат тела issue и ack не расходятся.
 *
 * Коды выхода (AC8): 0 — успех, 1 — использование, 2 — конфиг не настроен,
 * 3 — сеть/данные, 4 — нет токена.
 */

import { readFileSync } from 'node:fs';

import { getFlag, getFlagArray, hasFlag } from '../args.js';
import type { FlagValues } from '../args.js';
import { colorize, colors } from '../ui.js';
import { loadConfig } from '../../core/config.js';
import { GitverseError, reportBug } from '../../core/gitverse-issues.js';
import { readPackageInfo } from './version.js';

/** Известные флаги: неизвестный — ошибка использования (код 1). */
const KNOWN_FLAGS = new Set([
  'title', 'body', 'body-file', 'severity', 'area', 'source-task', 'label', 'json', 'help', 'h',
]);

/** Код выхода «ошибка использования». */
const USAGE_EXIT = 1;

/** Печатает ошибку и выставляет код выхода. */
function fail(err: unknown): void {
  if (err instanceof GitverseError) {
    console.error(colorize(`Ошибка: ${err.message}`, colors.red));
    process.exitCode = err.code;
    return;
  }
  console.error(colorize(`Ошибка: ${err instanceof Error ? err.message : String(err)}`, colors.red));
  process.exitCode = 3;
}

/** Имя проекта из backlog/config.yml (для секции «Источник»); пусто — нет конфига. */
function projectName(cwd: string): string | undefined {
  try {
    const name = loadConfig(cwd).project_name;
    return typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Выполняет команду `vibelog upstream report`.
 *
 * @param positional — позиционные аргументы (не используются)
 * @param flags — флаги команды
 * @param cwd — текущая рабочая директория
 */
export async function runUpstream(
  positional: string[],
  flags: FlagValues,
  cwd: string,
): Promise<void> {
  void positional;

  for (const key of Object.keys(flags)) {
    if (!KNOWN_FLAGS.has(key)) {
      console.error(
        colorize(
          `Ошибка: неизвестный флаг «--${key}»; поддерживаются: --title, --body, --body-file, ` +
            '--severity, --area, --source-task, --label, --json',
          colors.red,
        ),
      );
      process.exitCode = USAGE_EXIT;
      return;
    }
  }

  const title = getFlag(flags, 'title', '').trim();
  if (title === '') {
    console.error(
      colorize(
        'Ошибка: не указан заголовок — используйте «vibelog upstream report --title "<текст>"»',
        colors.red,
      ),
    );
    process.exitCode = USAGE_EXIT;
    return;
  }

  // Тело: --body приоритетнее --body-file; файл читается как есть.
  let body = getFlag(flags, 'body', '');
  const bodyFile = getFlag(flags, 'body-file', '');
  if (body === '' && bodyFile !== '') {
    try {
      body = readFileSync(bodyFile, 'utf-8');
    } catch (err) {
      console.error(
        colorize(`Ошибка: не удалось прочитать --body-file «${bodyFile}»: ${(err as Error).message}`, colors.red),
      );
      process.exitCode = USAGE_EXIT;
      return;
    }
  }

  const severity = getFlag(flags, 'severity', '');
  const area = getFlag(flags, 'area', '');
  const sourceTask = getFlag(flags, 'source-task', '');
  const labels = getFlagArray(flags, 'label');
  const project = projectName(cwd);

  try {
    const result = await reportBug(cwd, {
      title,
      ...(body !== '' ? { body } : {}),
      ...(severity !== '' ? { severity } : {}),
      ...(area !== '' ? { area } : {}),
      ...(sourceTask !== '' ? { sourceTask } : {}),
      ...(labels.length > 0 ? { labels } : {}),
      ...(project !== undefined ? { project } : {}),
      version: readPackageInfo().version,
    });

    if (hasFlag(flags, 'json')) {
      // ack как есть — тот же контракт, что у MCP-инструмента (VL-306)
      console.log(
        JSON.stringify(
          {
            ok: true,
            applied: { number: result.number, url: result.url, labels: result.labels },
            message: `Issue #${result.number} создан: ${title}`,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(colorize(`Issue #${result.number} создан`, colors.green));
    if (result.url !== '') console.log(`  ${result.url}`);
    console.log(`  метки: ${result.labels.join(', ')}`);
    if (result.createdLabels.length > 0) {
      console.log(`  созданы метки: ${result.createdLabels.join(', ')}`);
    }
  } catch (err) {
    fail(err);
  }
}
