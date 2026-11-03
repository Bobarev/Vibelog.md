// VL-329: parseChatIds живёт в core/env-file.ts (ядро не должно зависеть от bot/).
import { readFileSync, writeFileSync } from 'node:fs';

const edits = [];
const add = (file, old, neu) => edits.push({ file, old, neu });

// core/env-file.ts: parseChatIds + константа ключа
add(
  'src/core/env-file.ts',
  `/** Значение для .env: спецсимволы и пробелы → двойные кавычки. */`,
  `/** Ключ .env с привязанными chat_id бота (VL-329). */
export const TELEGRAM_CHAT_IDS_KEY = 'TELEGRAM_CHAT_IDS';

/**
 * Разбирает список chat_id из значения \`TELEGRAM_CHAT_IDS\` (VL-329).
 *
 * Формат: id через запятую, пробелы вокруг допускаются. Мусор (нечисло,
 * 0, отрицательное, дробное) отбрасывается; дубли схлопываются — иначе бот
 * дважды обработал бы одно сообщение.
 *
 * @param raw — строка из .env/окружения (может быть undefined)
 * @returns уникальные id в порядке появления
 */
export function parseChatIds(raw: string | undefined): number[] {
  if (raw === undefined || raw.trim() === '') return [];
  const out: number[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n === 0) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Значение для .env: спецсимволы и пробелы → двойные кавычки. */`,
);

// bot/env.ts: убрать локальную реализацию, реэкспортировать из ядра
add(
  'src/bot/env.ts',
  `import { upsertDotEnv } from '../core/env-file.js';

// Re-export по плану VL-143: набор файловых ключей удобно брать из env.js
export { fileLoadedEnvKeys };

/** Ключ .env с привязанными chat_id (VL-329). */
export const TELEGRAM_CHAT_IDS_KEY = 'TELEGRAM_CHAT_IDS';`,
  `import { upsertDotEnv, parseChatIds, TELEGRAM_CHAT_IDS_KEY } from '../core/env-file.js';

// Re-export по плану VL-143: набор файловых ключей удобно брать из env.js
export { fileLoadedEnvKeys };
// VL-329: парсер списка chat_id и имя ключа живут в core/env-file.ts —
// их использует и ядро wizard-а (core/setup.ts), которому нельзя зависеть от bot/
export { parseChatIds, TELEGRAM_CHAT_IDS_KEY };`,
);
add(
  'src/bot/env.ts',
  `/**
 * Разбирает список chat_id из значения \`TELEGRAM_CHAT_IDS\` (VL-329).
 *
 * Формат: id через запятую, пробелы вокруг допускаются. Мусор (нечисло,
 * 0, отрицательное) отбрасывается; дубли схлопываются — иначе бот дважды
 * обработал бы одно сообщение.
 *
 * @param raw — строка из .env/окружения (может быть undefined)
 * @returns уникальные id в порядке появления
 */
export function parseChatIds(raw: string | undefined): number[] {
  if (raw === undefined || raw.trim() === '') return [];
  const out: number[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n === 0) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/**`,
  `/**`,
);

// core/setup.ts: импорт из ядра, не из bot/
add(
  'src/core/setup.ts',
  `import { parseChatIds } from '../bot/env.js';`,
  `import { parseChatIds } from './env-file.js';`,
);

let failed = 0;
for (const e of edits) {
  const src = readFileSync(e.file, 'utf-8');
  if (!src.includes(e.old)) {
    console.error(`ЯКОРЬ НЕ НАЙДЕН: ${e.file} :: ${e.old.slice(0, 70).replace(/\n/g, '\\n')}`);
    failed++;
    continue;
  }
  writeFileSync(e.file, src.replace(e.old, e.neu), 'utf-8');
}
console.log(`применено: ${edits.length - failed} из ${edits.length}`);
if (failed > 0) process.exitCode = 1;
