/**
 * Git-политика экспериментов: поиск кандидатов на `.gitignore` и явная
 * правка `.gitignore` (VL-301, doc-21 §15).
 *
 * Зачем отдельный модуль: `experiment gc` — единственная команда, которая
 * имеет право менять `.gitignore`. Автоматически (при `run`/`report`) файл не
 * правится никогда: это побочный эффект в чужом репозитории, эксперимент не
 * должен менять правила версионирования без явной команды человека.
 *
 * Модуль чистый (файловая система — единственная зависимость), поэтому
 * проверяется тестами без спавна CLI.
 */

import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { experimentRunsDir } from './paths.js';
import { listRunNumbers } from './experiment.js';
import { RESULTS_SIZE_LIMIT_BYTES } from './report.js';

export { RESULTS_SIZE_LIMIT_BYTES };

/** Кандидат на попадание в `.gitignore`: ран с огромным `results.jsonl`. */
export interface GcCandidate {
  /** Номер прогона (`run-<N>`). */
  run: number;
  /** Размер `results.jsonl` в байтах. */
  sizeBytes: number;
  /** Путь `results.jsonl` от корня проекта в posix-виде (для печати). */
  relativePath: string;
  /** Строка для `.gitignore` — каталог рана (все будущие файлы рана тоже вне git). */
  entry: string;
}

/** Результат применения блока к `.gitignore`. */
export interface GitignoreApplyResult {
  ok: boolean;
  /** true — файл реально изменился (запись выполнена). */
  changed: boolean;
  /** Пояснение для пользователя (пишется в вывод команды). */
  reason?: string;
}

/** Начальный маркер блока конкретного эксперимента. */
function blockStart(expId: string): string {
  return `# vibelog experiment ${expId}: results.jsonl > 10 MB (doc-21 §15)`;
}

/** Конечный маркер блока конкретного эксперимента. */
function blockEnd(expId: string): string {
  return `# /vibelog experiment ${expId}`;
}

/**
 * Путь к `.gitignore` проекта.
 *
 * Корень — каталог, содержащий `backlog/`, без подъёма вверх по дереву
 * (`git rev-parse --show-toplevel` не используется): в worktree `backlog/`
 * может быть не в корне, и «поиск вверх» зацепил бы чужой `.gitignore`.
 * Команда печатает этот путь, чтобы человек видел, какой файл правится.
 */
export function gitignorePathFor(backlogDir: string): string {
  return join(dirname(backlogDir), '.gitignore');
}

/**
 * Перечисляет раны эксперимента, чей `results.jsonl` больше порога.
 *
 * Порог строгий (`>`), как в doc-21 §15: «> 10 MB». Отсутствующий
 * `results.jsonl` — не ошибка (ран мог упасть до первой записи), такой ран
 * просто пропускается. Сортировка — по номеру рана: порядок строк в блоке
 * `.gitignore` не должен меняться от прогона к прогону (иначе повторный
 * `--apply` переписывал бы файл без содержательной причины).
 */
export function findGcCandidates(
  backlogDir: string,
  expId: string,
  limitBytes: number = RESULTS_SIZE_LIMIT_BYTES
): GcCandidate[] {
  const runsDir = experimentRunsDir(backlogDir, expId);
  const projectRoot = dirname(backlogDir);
  const candidates: GcCandidate[] = [];
  for (const run of listRunNumbers(runsDir)) {
    const file = join(runsDir, `run-${run}`, 'results.jsonl');
    let size = 0;
    try {
      const st = statSync(file);
      if (!st.isFile()) continue;
      size = st.size;
    } catch {
      // Нет файла — нет кандидата; ран без results.jsonl не ломает команду
      continue;
    }
    if (size <= limitBytes) continue;
    const relativePath = relative(projectRoot, file).split(sep).join('/');
    candidates.push({
      run,
      sizeBytes: size,
      relativePath,
      // Каталог рана, а не сам файл: будущие файлы рана тоже не нужны в git
      entry: relativePath.replace(/results\.jsonl$/, ''),
    });
  }
  return candidates;
}

/**
 * Собирает текст блока `.gitignore` для эксперимента.
 *
 * Маркеры содержат `exp-id`, поэтому блоки разных экспериментов в одном
 * файле не затирают друг друга, а повторный запуск находит свой блок и
 * заменяет его целиком (идемпотентность вместо накопления дублей).
 */
export function buildGitignoreBlock(expId: string, entries: string[]): string {
  const lines = [blockStart(expId)];
  if (entries.length === 0) {
    lines.push('# кандидатов нет');
  } else {
    for (const entry of entries) lines.push(entry);
  }
  lines.push(blockEnd(expId));
  return `${lines.join('\n')}\n`;
}

/** Убирает завершающие пустые строки (файл должен кончаться одним `\n`). */
function trimTrailingBlank(text: string): string {
  return text.replace(/\n+$/, '');
}

/**
 * Заменяет блок эксперимента в тексте `.gitignore` (на месте).
 *
 * Замена именно НА МЕСТЕ, а не «удалить и дописать в конец»: иначе повторный
 * `--apply` переставлял бы блоки разных экспериментов и файл менялся бы без
 * содержательной причины (идемпотентность ломалась бы).
 *
 * @param blockLines — строки нового блока; null — блок нужно удалить
 * @returns новый текст и признак «блок был найден»
 */
function replaceBlock(
  text: string,
  expId: string,
  blockLines: string[] | null
): { text: string; found: boolean } {
  const lines = text ? text.split('\n') : [];
  const startMarker = blockStart(expId);
  const endMarker = blockEnd(expId);
  const start = lines.findIndex(l => l.trim() === startMarker);
  if (start === -1) {
    if (!blockLines) return { text, found: false };
    const base = trimTrailingBlank(text);
    return { text: base ? `${base}\n\n${blockLines.join('\n')}\n` : `${blockLines.join('\n')}\n`, found: false };
  }
  let end = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === endMarker) {
      end = i;
      break;
    }
  }
  // Маркер конца потерян (файл правили руками) — вырезаем до конца файла,
  // иначе строка-сирота останется навсегда
  const cut = end === -1 ? lines.length : end + 1;
  const head = lines.slice(0, start);
  const tail = lines.slice(cut);
  const merged = [...head, ...(blockLines ?? []), ...tail].join('\n');
  // Схлопываем возможные двойные пустые строки на стыке блоков
  const normalized = merged.replace(/\n{3,}/g, '\n\n');
  return { text: normalized ? `${trimTrailingBlank(normalized)}\n` : '', found: true };
}

/**
 * Явно применяет git-политику эксперимента: заменяет свой блок в `.gitignore`.
 *
 * Поведение:
 * - нет кандидатов и нет прежнего блока → файл не трогается (`changed: false`);
 * - нет кандидатов, но блок есть → блок удаляется (устаревшие строки не
 *   должны оставаться навсегда);
 * - кандидаты есть → блок заменяется на месте; повторный вызов с тем же
 *   набором кандидатов даёт `changed: false` и не меняет ни байта.
 *
 * @param gitignorePath — путь к `.gitignore` проекта (см. `gitignorePathFor`)
 * @param expId — id эксперимента (маркер блока)
 * @param entries — строки ранов для `.gitignore`
 */
export function applyGitignoreBlock(
  gitignorePath: string,
  expId: string,
  entries: string[]
): GitignoreApplyResult {
  const current = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf-8') : '';
  const blockLines = entries.length === 0 ? null : buildGitignoreBlock(expId, entries).replace(/\n$/, '').split('\n');
  const result = replaceBlock(current, expId, blockLines);
  if (result.text === current) {
    return {
      ok: true,
      changed: false,
      reason: entries.length === 0 ? 'блок уже отсутствует' : 'блок уже актуален',
    };
  }
  writeAtomic(gitignorePath, result.text);
  return {
    ok: true,
    changed: true,
    reason: entries.length === 0 ? 'устаревший блок удалён (кандидатов больше нет)' : undefined,
  };
}

/** Пишет файл атомарно: temp + rename в том же каталоге (lesson-169). */
function writeAtomic(path: string, content: string): void {
  const tmp = join(dirname(path), `.${process.pid}.${Date.now()}.gitignore.tmp`);
  try {
    writeFileSync(tmp, content, 'utf-8');
    renameSync(tmp, path);
  } catch (err) {
    try {
      if (existsSync(tmp)) rmSync(tmp, { force: true });
    } catch {
      // Уборка temp-файла не должна заслонять исходную ошибку записи
    }
    throw err;
  }
}
