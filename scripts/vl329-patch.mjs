// VL-329: пакетная правка (многоякорная) — секреты только .env, chats → .env.
import { readFileSync, writeFileSync } from 'node:fs';

const edits = [];
const add = (file, old, neu) => edits.push({ file, old, neu });

// --- src/core/setup.ts: where ---
add(
  'src/core/setup.ts',
  `    const where = answers.secretsLocation === 'settings'
      ? '.vibelog/settings.json env'
      : answers.secretsLocation === 'both'
        ? '.env + settings.json env'
        : '.env';`,
  `    // VL-329: единственное место записи секретов — .env
    const where = '.env';`,
);

// --- src/bot/settings.ts ---
add(
  'src/bot/settings.ts',
  `import {
  loadSettings,
  readSettingsEnv,
  saveSettingsPatch,
  settingsPath,
} from '../core/settings.js';`,
  `import { loadSettings, saveSettingsPatch, settingsPath } from '../core/settings.js';
import { readBotChats } from './env.js';`,
);
add(
  'src/bot/settings.ts',
  `/** Настройки бота: привязанные чаты и опции фаз (секреты — в env-секции settings.json). */
export interface BotSettings {
  /** Привязанные chat_id (команда /start в чате). */
  chats: number[];`,
  `/**
 * Настройки бота: опции фаз (VL-329).
 *
 * Секретов и личных привязок здесь больше нет: settings.json коммитится в git,
 * поэтому токен/прокси живут в \`.env\`, а привязанные chat_id — в
 * \`TELEGRAM_CHAT_IDS\` того же \`.env\` (см. readBotChats в bot/env.ts).
 */
export interface BotSettings {`,
);
add(
  'src/bot/settings.ts',
  `  const raw = loadSettings(cwd);
  const chats = Array.isArray(raw.chats) ? raw.chats : [];`,
  `  const raw = loadSettings(cwd);`,
);
add(
  'src/bot/settings.ts',
  `  return {
    chats: chats.map(Number).filter((n) => Number.isFinite(n)),
    ...(defaultAgent ? { default_agent: defaultAgent } : {}),`,
  `  return {
    ...(defaultAgent ? { default_agent: defaultAgent } : {}),`,
);
add(
  'src/bot/settings.ts',
  `  const patch: Record<string, unknown> = {
    chats: settings.chats,
    default_agent: settings.default_agent,`,
  `  const patch: Record<string, unknown> = {
    default_agent: settings.default_agent,`,
);
add(
  'src/bot/settings.ts',
  `/**
 * Разрешает токен бота: env TELEGRAM_BOT_TOKEN → env-секция settings.json.
 *
 * @returns токен или null, если нигде не задан
 */
export function resolveToken(cwd: string): string | null {
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  if (envToken) return envToken;
  return readSettingsEnv(cwd).TELEGRAM_BOT_TOKEN ?? null;
}`,
  `/**
 * Разрешает токен бота: только окружение (VL-329).
 *
 * Источник — \`TELEGRAM_BOT_TOKEN\` из реального env или \`.env\` (его грузит
 * loadProjectEnv). Секция \`env\` settings.json больше не читается.
 *
 * @returns токен или null, если не задан
 */
export function resolveToken(cwd: string): string | null {
  void cwd;
  return process.env.TELEGRAM_BOT_TOKEN ?? null;
}`,
);
add(
  'src/bot/settings.ts',
  `/**
 * Разрешает прокси для Telegram API: env TELEGRAM_PROXY → env-секция
 * settings.json.`,
  `/**
 * Разрешает прокси для Telegram API: только окружение (VL-329) —
 * \`TELEGRAM_PROXY\` из реального env или \`.env\`.`,
);
add(
  'src/bot/settings.ts',
  `export function resolveProxy(cwd: string): string | null {
  const envProxy = process.env.TELEGRAM_PROXY;
  if (envProxy) return envProxy;
  return readSettingsEnv(cwd).TELEGRAM_PROXY ?? null;
}`,
  `export function resolveProxy(cwd: string): string | null {
  void cwd;
  return process.env.TELEGRAM_PROXY ?? null;
}`,
);
add(
  'src/bot/settings.ts',
  ` * Хранятся в едином .vibelog/settings.json (VL-143, gitignored) — отдельно
 * от backlog/config.yml: (1) секреты в env-секции не должны коммититься
 * в git, (2) config.yml остаётся совместимым с Backlog.md: оригинал читает
 * конфиг switch-ом по известным ключам и вычищает неизвестные поля при
 * записи (saveConfig) — хранить токен там нельзя.
 *
 * Файл читается/пишется через общий core-модуль settings.js: там же живут
 * ленивая миграция legacy bot.yml/settings.yml и env-секция секретов.`,
  ` * Хранятся в едином .vibelog/settings.json (VL-143) — отдельно от
 * backlog/config.yml: config.yml остаётся совместимым с Backlog.md (оригинал
 * читает конфиг switch-ом по известным ключам и вычищает неизвестные поля при
 * записи, saveConfig).
 *
 * VL-329: settings.json КОММИТИТСЯ в git (собственная политика
 * \`.vibelog/.gitignore\`), поэтому секретов и личных привязок в нём нет:
 * токен/прокси и \`TELEGRAM_CHAT_IDS\` живут в \`.env\` (см. bot/env.ts).
 *
 * Файл читается/пишется через общий core-модуль settings.js: там же живёт
 * ленивая миграция legacy bot.yml/settings.yml.`,
);

// --- src/bot/handlers.ts ---
add(
  'src/bot/handlers.ts',
  `import { loadBotSettings, resolveDefaultAgent, saveBotSettings } from './settings.js';`,
  `import { loadBotSettings, resolveDefaultAgent, saveBotSettings } from './settings.js';
import { readBotChats, saveBotChats } from './env.js';`,
);
add(
  'src/bot/handlers.ts',
  `    if (chatId !== undefined && loadBotSettings(deps.cwd).chats.includes(chatId)) return true;`,
  `    if (chatId !== undefined && readBotChats().includes(chatId)) return true;`,
);
add(
  'src/bot/handlers.ts',
  `    if (loadBotSettings(deps.cwd).chats.includes(chatId)) {`,
  `    if (readBotChats().includes(chatId)) {`,
);
add(
  'src/bot/handlers.ts',
  `    if (ctx.message.text.trim() === deps.getPin()) {
      const settings = loadBotSettings(deps.cwd);
      if (!settings.chats.includes(chatId)) settings.chats.push(chatId);
      saveBotSettings(deps.cwd, settings);
      awaitingPin.delete(chatId);
      await sendMd(ctx, \`Чат привязан ✅ Команды: \${commandsHelp()}\`);`,
  `    if (ctx.message.text.trim() === deps.getPin()) {
      // VL-329: chat_id — личная привязка, её место в .env рядом с токеном
      // (settings.json коммитится в git). upsert сохраняет прочие строки
      // и комментарии .env, ключ не дублируется.
      const chats = readBotChats();
      if (!chats.includes(chatId)) {
        try {
          saveBotChats(deps.cwd, [...chats, chatId]);
        } catch (err) {
          // .env с секретами: не глотаем ошибку записи молча
          await sendMd(ctx, \`Не удалось сохранить привязку в .env: \${(err as Error).message}\`);
          return;
        }
      }
      awaitingPin.delete(chatId);
      await sendMd(ctx, \`Чат привязан ✅ (id добавлен в .env) Команды: \${commandsHelp()}\`);`,
);

// --- src/cli/commands/init-wizard.ts ---
add(
  'src/cli/commands/init-wizard.ts',
  `/** Валидирует локацию секретов из флага. */
function parseSecretsLocation(raw: string): SecretsLocation | null {
  if (raw === 'system' || raw === 'env' || raw === 'settings' || raw === 'both') return raw;
  return null;
}`,
  `/**
 * Валидирует локацию секретов из флага (VL-329).
 *
 * \`settings\`/\`both\` больше не поддерживаются: секция \`env\` в settings.json
 * удалена (файл коммитится в git). Флаг с таким значением отвергается с
 * понятной ошибкой, а не молча пишет секреты не туда.
 */
function parseSecretsLocation(raw: string): SecretsLocation | null {
  if (raw === 'system' || raw === 'env') return raw;
  if (raw === 'settings' || raw === 'both') {
    throw new Error(
      \`--secrets-location \${raw} больше не поддерживается: секреты пишутся только в .env (env) или не пишутся вовсе (system)\`,
    );
  }
  return null;
}`,
);
add(
  'src/cli/commands/init-wizard.ts',
  `      const chatsRaw = await session.askText('chat_id через запятую (опционально)', '');`,
  `      // VL-329: chat_id сохраняются в .env (TELEGRAM_CHAT_IDS), не в settings.json
      const chatsRaw = await session.askText(
        'chat_id через запятую (опционально, сохранятся в .env)',
        '',
      );`,
);
add(
  'src/cli/commands/init-wizard.ts',
  ` * Ровно два варианта: \`env\` (приоритет env → .env, ничего не пишем) и
 * \`.env\` (файл в корне проекта). Пункты «.vibelog/settings.json (секция env)»
 * и «оба места» убраны из wizard-а: значения \`SecretsLocation\` для них
 * сохранены ради старых проектов и флага \`--secrets-location\`.`,
  ` * Ровно два варианта: \`env\` (приоритет env → .env, ничего не пишем) и
 * \`.env\` (файл в корне проекта). VL-329: значения \`settings\`/\`both\` удалены
 * из \`SecretsLocation\` целиком — секция \`env\` в settings.json больше не
 * поддерживается (файл коммитится в git).`,
);

// --- src/cli/router.ts ---
add(
  'src/cli/router.ts',
  `  --secrets-location system|env|settings|both  — где хранить ключи
                        (system — не писать, завести переменные самому; env — .env)`,
  `  --secrets-location system|env  — где хранить ключи
                        (system — не писать, завести переменные самому; env — .env)`,
);
add(
  'src/cli/router.ts',
  `  --bot, --bot-token <t>, --bot-chats <ids>, --bot-proxy <url>  — Telegram-бот`,
  `  --bot, --bot-token <t>, --bot-chats <ids>, --bot-proxy <url>  — Telegram-бот
                        (привязка чатов пишется в .env: TELEGRAM_CHAT_IDS)`,
);
add(
  'src/cli/router.ts',
  `Запускает Telegram-бота (long polling). Токен: TELEGRAM_BOT_TOKEN в .env
или в секции env .vibelog/settings.json. При старте в консоль печатается пин-код —
введите его в Telegram после /start для привязки чата.`,
  `Запускает Telegram-бота (long polling). Токен: TELEGRAM_BOT_TOKEN в .env
(единственный источник секретов). При старте в консоль печатается пин-код —
введите его в Telegram после /start: chat_id допишется в .env (TELEGRAM_CHAT_IDS).`,
);

// --- src/cli/commands/bot.ts ---
add(
  'src/cli/commands/bot.ts',
  `      'Токен Telegram-бота не найден. Задайте TELEGRAM_BOT_TOKEN в .env или в секции env .vibelog/settings.json'`,
  `      'Токен Telegram-бота не найден. Задайте TELEGRAM_BOT_TOKEN в .env (единственный источник секретов)'`,
);

// --- src/web/api.ts ---
add(
  'src/web/api.ts',
  `    // loadBotSettings отдаёт ТОЛЬКО валидированные несекретные поля; env-секция
    // (TELEGRAM_BOT_TOKEN и др.) сюда не попадает — секреты не должны утекать
    // в браузер даже на localhost.`,
  `    // loadBotSettings отдаёт ТОЛЬКО валидированные несекретные поля; секреты
    // (TELEGRAM_BOT_TOKEN и др.) живут в .env и сюда не попадают — они не
    // должны утекать в браузер даже на localhost (VL-329).`,
);
add(
  'src/web/api.ts',
  `    // saveBotSettings (read-modify-write) сохраняет env-секцию и chats (VL-143).`,
  `    // saveBotSettings (read-modify-write) сохраняет прочие ключи settings.json
    // (VL-143); секретов и chats в файле больше нет (VL-329).`,
);

// --- src/web/setup-api.ts ---
add(
  'src/web/setup-api.ts',
  `import { loadProjectEnv, fileLoadedEnvKeys } from '../bot/env.js';
import { readSettingsEnv } from '../core/settings.js';`,
  `import { loadProjectEnv, fileLoadedEnvKeys } from '../bot/env.js';`,
);
add(
  'src/web/setup-api.ts',
  ` * VL-328 (AC5): валидируем по ПОЛНОМУ перечню — \`settings\`/\`both\` остаются
 * принимаемыми ради старых проектов, но в UI предлагаются только
 * \`PROPOSED_SECRETS_LOCATIONS\`.
 */`,
  ` * VL-329: \`settings\`/\`both\` удалены — перечень принимаемых и предлагаемых
 * локаций совпадает (секция \`env\` settings.json больше не поддерживается).
 */`,
);
add(
  'src/web/setup-api.ts',
  ` * Почему не просто \`loadProjectEnv\`: \`loadDotEnv\`/\`applySettingsEnv\` пишут лишь
 * ПУСТЫЕ ключи (dotenv-семантика, VL-143). Значение, загруженное из прошлого
 * \`.env\` при старте сервера, уже висит в \`process.env\`, поэтому обновлённый
 * ключ не применился бы — ping LLM ушёл бы со старым (или пустым) секретом и
 * вернул ложный 401. Поэтому снимаем ключи, которые пришли ИЗ ФАЙЛОВ
 * (\`fileLoadedEnvKeys\`) и присутствуют в текущих \`.env\`/секции env, и грузим
 * заново. Переменные реального shell-окружения не трогаем — их приоритет
 * главнее файла (VL-143).`,
  ` * Почему не просто \`loadProjectEnv\`: \`loadDotEnv\` пишет лишь ПУСТЫЕ ключи
 * (dotenv-семантика, VL-143). Значение, загруженное из прошлого \`.env\` при
 * старте сервера, уже висит в \`process.env\`, поэтому обновлённый ключ не
 * применился бы — ping LLM ушёл бы со старым (или пустым) секретом и вернул
 * ложный 401. Поэтому снимаем ключи, которые пришли ИЗ ФАЙЛА
 * (\`fileLoadedEnvKeys\`) и присутствуют в текущем \`.env\`, и грузим заново.
 * Переменные реального shell-окружения не трогаем — их приоритет главнее
 * файла (VL-143). VL-329: секции \`env\` settings.json больше нет.`,
);
add(
  'src/web/setup-api.ts',
  `  const fresh = { ...readEnvFile(cwd), ...readSettingsEnv(cwd) };`,
  `  const fresh = readEnvFile(cwd);`,
);
add(
  'src/web/setup-api.ts',
  `        secrets: {
          envFile: state.secrets.envFile,
          envKeys: state.secrets.envKeys,
          settingsEnvKeys: state.secrets.settingsEnvKeys,
        },`,
  `        secrets: {
          envFile: state.secrets.envFile,
          envKeys: state.secrets.envKeys,
        },`,
);
add(
  'src/web/setup-api.ts',
  `          // VL-328 (AC6): только ФАКТ наличия прокси — значение секрета наружу
          // не отдаём (тот же принцип, что keySet у шлюзов). Читаем оба
          // возможных места: env процесса и секцию env settings.json.
          proxySet: Boolean(process.env.TELEGRAM_PROXY || readSettingsEnv(cwd).TELEGRAM_PROXY),`,
  `          // VL-328 (AC6): только ФАКТ наличия прокси — значение секрета наружу
          // не отдаём (тот же принцип, что keySet у шлюзов). VL-329: источник
          // один — окружение (реальный env или .env).
          proxySet: Boolean(process.env.TELEGRAM_PROXY),`,
);
add(
  'src/web/setup-api.ts',
  `        // VL-328 (AC5): только предлагаемые локации; settings/both остаются
        // принимаемыми в POST ради старых проектов`,
  `        // VL-328 (AC5) / VL-329: перечень локаций из ядра (settings/both удалены)`,
);
add(
  'src/web/setup-api.ts',
  `  // VL-328 (AC8): прокси из окружения/секции env settings.json (VL-327) —
  // без него getMe уходит напрямую и на заблокированном api.telegram.org
  // возвращает ложный timeout вместо результата проверки.`,
  `  // VL-328 (AC8): прокси из окружения (.env, VL-329) — без него getMe уходит
  // напрямую и на заблокированном api.telegram.org возвращает ложный timeout
  // вместо результата проверки.`,
);

// --- web/src/components/setup/api.ts ---
add(
  'web/src/components/setup/api.ts',
  `  secrets: { envFile: boolean; envKeys: string[]; settingsEnvKeys: string[] };`,
  `  secrets: { envFile: boolean; envKeys: string[] };`,
);
add(
  'web/src/components/setup/api.ts',
  `  /** VL-328: UI предлагает system|env, но API принимает и legacy-значения. */
  secretsLocation: "system" | "env" | "settings" | "both";`,
  `  /** VL-329: секреты пишутся только в .env (env) или не пишутся (system). */
  secretsLocation: "system" | "env";`,
);
add(
  'web/src/components/setup/api.ts',
  `  /** VL-328: предлагаемые локации секретов (без settings/both). */`,
  `  /** VL-328/329: предлагаемые локации секретов (system|env). */`,
);

// --- web/src/components/setup/setup-page.tsx ---
add(
  'web/src/components/setup/setup-page.tsx',
  `/** Локации секретов, которые API принимает (UI предлагает только первые две). */
type SecretsLocation = "system" | "env" | "settings" | "both"`,
  `/** Локации секретов (VL-329: секция env settings.json удалена). */
type SecretsLocation = "system" | "env"`,
);

let failed = 0;
for (const e of edits) {
  let src;
  try {
    src = readFileSync(e.file, 'utf-8');
  } catch (err) {
    console.error(`НЕТ ФАЙЛА: ${e.file}`);
    failed++;
    continue;
  }
  if (!src.includes(e.old)) {
    console.error(`ЯКОРЬ НЕ НАЙДЕН: ${e.file} :: ${e.old.slice(0, 70).replace(/\n/g, '\\n')}`);
    failed++;
    continue;
  }
  writeFileSync(e.file, src.replace(e.old, e.neu), 'utf-8');
}
console.log(`применено: ${edits.length - failed} из ${edits.length}`);
if (failed > 0) process.exitCode = 1;
