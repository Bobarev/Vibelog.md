#!/usr/bin/env node
/**
 * Построчный просмотр JSONL-сессий агента (VL-250, обходной путь).
 *
 * Зачем: в jsonl-транскрипте агента каждая запись — одна длинная строка
 * (system-промпт ~8 КБ, сообщения, tool-результаты), поэтому читать такие
 * файлы «по диапазону символов» бесполезно. read_file после VL-250 умеет
 * диапазоны строк, но для разбора сессии удобнее записи целиком: превью всех
 * записей, фильтр по подстроке и печать одной записи полностью.
 *
 * Использование (только node:fs/node:readline, без внешних рантаймов):
 *   node scripts/agent-session.mjs <файл|agent-id> [--grep <подстрока>] [--full <N>] [--preview <N>]
 *   node scripts/agent-session.mjs agent-1793319087159 --grep ошибка
 *   node scripts/agent-session.mjs agent-1793319087159 --full 3
 *
 * <файл|agent-id>: путь к .jsonl (относительно cwd) либо голый id сессии —
 * тогда файл берётся из .vibelog/agent-sessions/<id>.jsonl.
 */

import { createReadStream, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createInterface } from 'node:readline';

const DEFAULT_PREVIEW = 300;

/** Разбор argv: позиционный путь/id + флаги --grep/--full/--preview. */
function parseArgs(argv) {
  const out = { target: '', grep: null, full: 0, preview: DEFAULT_PREVIEW };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--grep') out.grep = argv[++i] ?? null;
    else if (a === '--full') out.full = Number(argv[++i] ?? 0) || 0;
    else if (a === '--preview') out.preview = Number(argv[++i] ?? DEFAULT_PREVIEW) || DEFAULT_PREVIEW;
    else if (!out.target) out.target = a;
  }
  return out;
}

/** Резолвит цель в путь к jsonl-файлу (id → .vibelog/agent-sessions/<id>.jsonl). */
function resolveFile(target) {
  if (!target) return null;
  const candidate = isAbsolute(target) ? target : target;
  if (candidate.endsWith('.jsonl')) return candidate;
  return join('.vibelog', 'agent-sessions', `${target}.jsonl`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = resolveFile(args.target);
  if (!file) {
    console.error('Укажи файл .jsonl или id сессии: node scripts/agent-session.mjs <agent-id>');
    process.exit(1);
  }
  if (!existsSync(file)) {
    console.error(`Файл не найден: ${file}`);
    console.error('Для голого id ожидается .vibelog/agent-sessions/<id>.jsonl в корне проекта.');
    process.exit(1);
  }

  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let index = 0;
  let matched = 0;
  for await (const line of rl) {
    index += 1;
    // Пустые строки пропускаем в нумерации записей только визуально.
    if (line.trim() === '') continue;
    if (args.grep && !line.includes(args.grep)) continue;
    matched += 1;
    if (args.full > 0) {
      // --full N: печатаем запись номер N целиком (без обрезки).
      if (index === args.full) {
        process.stdout.write(`--- запись ${index} (${line.length} символов) ---\n${line}\n`);
      }
      continue;
    }
    const preview = line.length > args.preview ? `${line.slice(0, args.preview)}…` : line;
    process.stdout.write(`#${index} (${line.length} символов) ${preview}\n`);
  }

  if (args.full > 0) {
    process.stdout.write(`Всего записей: ${index}\n`);
  } else {
    process.stdout.write(`Всего записей: ${index}, показано: ${matched}${args.grep ? ` (grep="${args.grep}")` : ''}\n`);
  }
}

main().catch((err) => {
  console.error(`Ошибка разбора сессии: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
