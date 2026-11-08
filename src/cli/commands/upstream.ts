/**
 * Команда `vibelog upstream` (VL-363, VL-375) — репорт бага в другой проект
 * Vibelog и приём входящих отчётов.
 *
 * Зачем CLI, если есть MCP-инструмент `upstream_report_bug`: в дочернем
 * проекте глобальный пакет `vibelog` может быть старой версии (MCP-инструмента
 * ещё нет), а CLI-фолбэк работает сразу после обновления. Кроме того, git-клон
 * инбокса живёт ВНУТРИ проекта-источника, а агент ограничен корнем проекта —
 * push делает именно CLI (процесс пользователя/оркестратора).
 *
 * Подкоманды:
 * - `report` — отчёт (mode `git` → файл в инбоксе, mode `api` → issue GitVerse);
 * - `pull`   — входящие отчёты для своего префикса;
 * - `ack <report_id> --as VL-N` — подтверждение получения.
 *
 * Коды выхода (AC5): 0 — успех, 1 — использование, 2 — конфиг не настроен,
 * 3 — сеть/git/данные, 4 — нет токена.
 */

import { readFileSync } from 'node:fs';

import { getFlag, getFlagArray, hasFlag } from '../args.js';
import type { FlagValues } from '../args.js';
import { colorize, colors } from '../ui.js';
import { loadConfig } from '../../core/config.js';
import {
  GitverseError,
  isUpstreamConfigured,
  reportBug,
  resolveUpstreamConfig,
} from '../../core/gitverse-issues.js';
import {
  UpstreamGitError,
  ackReport,
  ensureInboxClone,
  listIncoming,
  sourceProjectName,
} from '../../core/upstream-git.js';
import { readPackageInfo } from './version.js';

/** Известные флаги по подкомандам: неизвестный — ошибка использования (код 1). */
const KNOWN_FLAGS: Record<string, Set<string>> = {
  report: new Set([
    'title', 'body', 'body-file', 'severity', 'area', 'source-task', 'target',
    'label', 'json', 'help', 'h',
  ]),
  pull: new Set(['json', 'no-fetch', 'help', 'h']),
  ack: new Set(['as', 'json', 'no-fetch', 'help', 'h']),
};

/** Код выхода «ошибка использования». */
const USAGE_EXIT = 1;

/** Печатает ошибку и выставляет код выхода (оба класса ошибок — одинаково). */
function fail(err: unknown): void {
  if (err instanceof GitverseError || err instanceof UpstreamGitError) {
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

/** Проверяет флаги подкоманды; возвращает false, если флаг неизвестен. */
function checkFlags(sub: string, allowed: Set<string>, flags: FlagValues): boolean {
  const known = KNOWN_FLAGS[sub] ?? new Set<string>();
  void allowed;
  for (const key of Object.keys(flags)) {
    if (!known.has(key)) {
      console.error(
        colorize(
          `Ошибка: неизвестный флаг «--${key}» для «upstream ${sub}»; поддерживаются: ` +
            [...known].filter((k) => k !== 'help' && k !== 'h').map((k) => `--${k}`).join(', '),
          colors.red,
        ),
      );
      process.exitCode = USAGE_EXIT;
      return false;
    }
  }
  return true;
}

/** `vibelog upstream report` — отчёт в git-инбокс или issue GitVerse. */
async function runReport(flags: FlagValues, cwd: string): Promise<void> {
  if (!checkFlags('report', KNOWN_FLAGS.report, flags)) return;

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
  const target = getFlag(flags, 'target', '');
  const labels = getFlagArray(flags, 'label');
  const project = projectName(cwd);
  const json = hasFlag(flags, 'json');

  try {
    const result = await reportBug(cwd, {
      title,
      ...(body !== '' ? { body } : {}),
      ...(severity !== '' ? { severity } : {}),
      ...(area !== '' ? { area } : {}),
      ...(sourceTask !== '' ? { sourceTask } : {}),
      ...(target !== '' ? { target } : {}),
      ...(labels.length > 0 ? { labels } : {}),
      ...(project !== undefined ? { project } : {}),
      version: readPackageInfo().version,
    });

    if (result.mode === 'git') {
      if (json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              applied: {
                report_id: result.reportId,
                path: result.path,
                target: result.target,
                created: result.created,
              },
              message: result.created
                ? `Отчёт записан в инбокс: ${result.path}`
                : `Отчёт уже был в инбоксе: ${result.path}`,
            },
            null,
            2,
          ),
        );
        return;
      }
      console.log(
        colorize(
          result.created ? 'Отчёт записан в инбокс' : 'Отчёт уже был в инбоксе (идемпотентно)',
          colors.green,
        ),
      );
      console.log(`  файл: ${result.path}`);
      console.log(`  report_id: ${result.reportId}`);
      console.log(`  получатель: ${result.target}`);
      return;
    }

    if (json) {
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

/** Свой префикс получателя: `upstream.prefix` либо `task_prefix` проекта. */
function ownPrefix(cwd: string): string {
  try {
    const prefix = loadConfig(cwd).task_prefix;
    if (typeof prefix === 'string' && prefix.trim() !== '') return prefix.trim().toLowerCase();
  } catch {
    // нет backlog/config.yml — дефолт
  }
  return 'vl';
}

/** `vibelog upstream pull` — входящие отчёты для своего префикса. */
function runPull(flags: FlagValues, cwd: string): void {
  if (!checkFlags('pull', KNOWN_FLAGS.pull, flags)) return;
  if (!isUpstreamConfigured(cwd)) {
    console.error(
      colorize(
        'Ошибка: upstream не настроен — добавь секцию upstream в .vibelog/settings.json ' +
          '({"mode": "git", "inbox": "git@gitverse.ru:owner/inbox.git", "prefix": "vl"})',
        colors.red,
      ),
    );
    process.exitCode = 2;
    return;
  }

  const json = hasFlag(flags, 'json');
  try {
    const cfg = resolveUpstreamConfig(cwd);
    if (cfg.mode !== 'git') {
      console.error(
        colorize('Ошибка: upstream.pull доступен только для mode: "git" (в режиме api задачи берутся из GitVerse)', colors.red),
      );
      process.exitCode = 2;
      return;
    }
    // Обновление клона: без сети можно читать локальное состояние (--no-fetch)
    if (!hasFlag(flags, 'no-fetch')) ensureInboxClone(cwd, cfg);
    const incoming = listIncoming(cwd, cfg.prefix);

    if (json) {
      console.log(JSON.stringify({ ok: true, applied: { count: incoming.length, reports: incoming } }, null, 2));
      return;
    }
    if (incoming.length === 0) {
      console.log(colorize(`Входящих отчётов для «${cfg.prefix}» нет`, colors.dim));
      return;
    }
    console.log(colorize(`Входящих отчётов: ${incoming.length}`, colors.green));
    for (const report of incoming) {
      console.log(`  ${report.created}  ${report.report_id.slice(0, 8)}  ${report.source_task} — ${report.title}`);
      if (report.severity !== '' || report.area !== '') {
        console.log(`      severity: ${report.severity || '—'}  area: ${report.area || '—'}`);
      }
    }
    console.log(colorize('Подтвердить: vibelog upstream ack <report_id> --as <ID задачи>', colors.dim));
  } catch (err) {
    fail(err);
  }
}

/** `vibelog upstream ack <report_id> --as VL-N` — подтверждение получения. */
function runAck(positional: string[], flags: FlagValues, cwd: string): void {
  if (!checkFlags('ack', KNOWN_FLAGS.ack, flags)) return;
  const id = (positional[0] ?? '').trim();
  const acceptedAs = getFlag(flags, 'as', '').trim();
  if (id === '') {
    console.error(
      colorize('Ошибка: не указан report_id — «vibelog upstream ack <report_id> --as <ID задачи>»', colors.red),
    );
    process.exitCode = USAGE_EXIT;
    return;
  }
  if (acceptedAs === '') {
    console.error(colorize('Ошибка: не указан --as — ID задачи-получателя, например --as VL-367', colors.red));
    process.exitCode = USAGE_EXIT;
    return;
  }

  const json = hasFlag(flags, 'json');
  try {
    const cfg = resolveUpstreamConfig(cwd);
    if (cfg.mode !== 'git') {
      console.error(
        colorize('Ошибка: upstream.ack доступен только для mode: "git" (в режиме api закрытие идёт через GitVerse)', colors.red),
      );
      process.exitCode = 2;
      return;
    }
    // ack правит уже склонированный файл; свежий pull нужен, чтобы не плодить конфликты
    if (!hasFlag(flags, 'no-fetch')) ensureInboxClone(cwd, cfg);
    const result = ackReport(cwd, id, acceptedAs);
    if (json) {
      console.log(
        JSON.stringify(
          { ok: true, applied: { report_id: id, path: result.path, status: result.report.status, accepted_as: result.report.accepted_as } },
          null,
          2,
        ),
      );
      return;
    }
    console.log(colorize('Отчёт подтверждён', colors.green));
    console.log(`  файл: ${result.path}`);
    console.log(`  задача-получатель: ${result.report.accepted_as}`);
  } catch (err) {
    fail(err);
  }
}

/**
 * Выполняет команду `vibelog upstream`.
 *
 * @param positional — подкоманда и её позиционные аргументы
 * @param flags — флаги команды
 * @param cwd — текущая рабочая директория
 */
export async function runUpstream(
  positional: string[],
  flags: FlagValues,
  cwd: string,
): Promise<void> {
  const sub = (positional[0] ?? '').trim();
  const rest = positional.slice(1);

  if (sub === '' || sub === 'help') {
    console.error(
      colorize(
        'Ошибка: не указана подкоманда — vibelog upstream report|pull|ack (см. vibelog upstream --help)',
        colors.red,
      ),
    );
    process.exitCode = USAGE_EXIT;
    return;
  }

  // Имя проекта-источника нужно и для сообщений — читаем один раз (может быть пусто)
  void sourceProjectName(cwd, ownPrefix(cwd));

  if (sub === 'report') return runReport(flags, cwd);
  if (sub === 'pull') return runPull(flags, cwd);
  if (sub === 'ack') return runAck(rest, flags, cwd);

  console.error(
    colorize(
      `Ошибка: неизвестная подкоманда «upstream ${sub}»; поддерживаются: report, pull, ack`,
      colors.red,
    ),
  );
  process.exitCode = USAGE_EXIT;
}
