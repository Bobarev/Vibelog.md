/**
 * Конфигурация коммуникации `.vibelog/comms.yaml` (VL-428).
 *
 * Единый файл секретов и каналов interbot-связи (doc-32 §3): токен/прокси
 * бота, привязанные чаты, каналы (Telegram-группы) и глобальные настройки
 * синхронного ожидания. Файл НЕ коммитится: `.vibelog/.gitignore` по
 * умолчанию игнорирует всё (проверено `git check-ignore`).
 *
 * Приоритет чтения секретов (doc-32 §3): shell env → comms.yaml →
 * legacy `.env` (fallback для уже настроенных проектов, с предупреждением).
 *
 * Валидация при чтении: битые поля канала отбрасываются с предупреждением,
 * выбор канала — resolveChannel (default_channel → явный → единственный →
 * ошибка со списком каналов).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml, stringifyYaml } from './yaml.js';
import { parseChatIds, TELEGRAM_CHAT_IDS_KEY } from './env-file.js';

/** Режим адресации канала: mention (дефолт) — только /cmd@Bot и reply на нас. */
export type ChannelAddressing = 'mention' | 'all';
/** Режим согласования: auto — бот отвечает сам; admin — inline-кнопки. */
export type ChannelApproval = 'auto' | 'admin';

/** Канал interbot-связи (doc-32 §2). */
export interface CommsChannel {
  id: string;
  label?: string;
  transport: string;
  group_id: number;
  addressing: ChannelAddressing;
  approval: ChannelApproval;
  admin_chat?: number;
}

/** Полная конфигурация comms.yaml. */
export interface CommsConfig {
  bot_token?: string;
  proxy?: string;
  chats: number[];
  channels: CommsChannel[];
  default_channel?: string;
  sync_timeout_sec: number;
}

/** Декфолтный таймаут синхронного ожидания ответа, секунды (решение B, doc-32 §9). */
export const DEFAULT_SYNC_TIMEOUT_SEC = 120;

/** Путь к comms.yaml проекта. */
export function commsPath(cwd: string): string {
  return join(cwd, '.vibelog', 'comms.yaml');
}

/** Разбирает строку/число в chat_id; невалидно → undefined. */
function readChatId(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(n) && n !== 0 ? n : undefined;
}

/** Валидация одного канала из YAML; невалидный → null (+warn). */
function readChannel(raw: unknown, warnings: string[]): CommsChannel | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const id = typeof src.id === 'string' ? src.id.trim() : '';
  const groupId = readChatId(src.group_id);
  if (id === '' || groupId === undefined) {
    warnings.push(`канал без id/group_id пропущен: ${JSON.stringify(raw).slice(0, 120)}`);
    return null;
  }
  return {
    id,
    ...(typeof src.label === 'string' ? { label: src.label } : {}),
    transport: typeof src.transport === 'string' ? src.transport : 'telegram',
    group_id: groupId,
    addressing: src.addressing === 'all' ? 'all' : 'mention',
    approval: src.approval === 'admin' ? 'admin' : 'auto',
    ...(readChatId(src.admin_chat) !== undefined ? { admin_chat: readChatId(src.admin_chat) } : {}),
  };
}

/**
 * Читает и валидирует comms.yaml; отсутствует → пустая конфигурация.
 *
 * Ошибки парсинга не бросают: файл может быть пуст/битый — печатается
 * предупреждение, возвращаются дефолты (бот не должен падать из-за конфига).
 */
export function readComms(cwd: string, opts: { warn?: (msg: string) => void } = {}): CommsConfig {
  const warn = opts.warn ?? ((m: string) => console.error(`[comms] ${m}`));
  const path = commsPath(cwd);
  const base: CommsConfig = { chats: [], channels: [], sync_timeout_sec: DEFAULT_SYNC_TIMEOUT_SEC };
  if (!existsSync(path)) return base;
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, 'utf-8'));
  } catch (err) {
    warn(`comms.yaml не разобран: ${(err as Error).message}`);
    return base;
  }
  const src = (raw ?? {}) as Record<string, unknown>;
  const warnings: string[] = [];
  // Битые секции (тип не тот, что ожидался): предупреждение вместо молчаливых
  // дефолтов — иначе «сломанный YAML не роняет чтение» = тихая потеря конфига
  if (
    src.secrets !== undefined &&
    (typeof src.secrets !== 'object' || src.secrets === null || Array.isArray(src.secrets))
  ) {
    warnings.push('секция secrets повреждена (ожидается объект) — прочитано пусто');
  }
  if (src.channels !== undefined && !Array.isArray(src.channels)) {
    warnings.push('секция channels повреждена (ожидается список) — прочитано пусто');
  }
  if (src.chats !== undefined && !Array.isArray(src.chats) && typeof src.chats !== 'string') {
    warnings.push('секция chats повреждена (ожидается список или строка) — прочитано пусто');
  }
  // Секция secrets.telegram: {bot_token, proxy}
  const secrets = (src.secrets ?? {}) as Record<string, unknown>;
  const tg = (secrets.telegram ?? {}) as Record<string, unknown>;
  // chats: массив id или строка через запятую
  let chats: number[] = [];
  if (Array.isArray(src.chats)) chats = src.chats.map(readChatId).filter((n): n is number => n !== undefined);
  else if (typeof src.chats === 'string') chats = parseChatIds(src.chats);
  // channels: массив каналов
  const channels: CommsChannel[] = [];
  if (Array.isArray(src.channels)) {
    for (const item of src.channels) {
      const ch = readChannel(item, warnings);
      if (ch) channels.push(ch);
    }
  }
  // Дубли id — первые побеждают, дубль пропускается
  const seen = new Set<string>();
  const uniq = channels.filter((c) => (seen.has(c.id) ? (warnings.push(`дубль канала «${c.id}» пропущен`), false) : (seen.add(c.id), true)));
  const timeoutRaw = src.sync_timeout_sec;
  const sync =
    typeof timeoutRaw === 'number' && Number.isInteger(timeoutRaw) && timeoutRaw > 0
      ? timeoutRaw
      : DEFAULT_SYNC_TIMEOUT_SEC;
  for (const w of warnings) warn(w);
  return {
    ...(typeof tg.bot_token === 'string' && tg.bot_token !== '' ? { bot_token: tg.bot_token } : {}),
    ...(typeof tg.proxy === 'string' && tg.proxy !== '' ? { proxy: tg.proxy } : {}),
    chats,
    channels: uniq,
    ...(typeof src.default_channel === 'string' && src.default_channel !== ''
      ? { default_channel: src.default_channel }
      : {}),
    sync_timeout_sec: sync,
  };
}

/**
 * Атомарная запись comms.yaml (lesson-214: temp + rename, mode 0600).
 * Секреты: файл содержит токен — права 0600, каталог создаётся лениво.
 */
export function writeComms(cwd: string, config: CommsConfig): void {
  const path = commsPath(cwd);
  const obj: Record<string, unknown> = {
    secrets: {
      telegram: {
        ...(config.bot_token ? { bot_token: config.bot_token } : {}),
        ...(config.proxy ? { proxy: config.proxy } : {}),
      },
    },
    ...(config.chats.length > 0 ? { chats: config.chats } : {}),
    ...(config.default_channel ? { default_channel: config.default_channel } : {}),
    sync_timeout_sec: config.sync_timeout_sec,
    ...(config.channels.length > 0
      ? {
          channels: config.channels.map((c) => ({
            id: c.id,
            ...(c.label ? { label: c.label } : {}),
            transport: c.transport,
            group_id: c.group_id,
            addressing: c.addressing,
            approval: c.approval,
            ...(c.admin_chat !== undefined ? { admin_chat: c.admin_chat } : {}),
          })),
        }
      : {}),
  };
  const header =
    '# .vibelog/comms.yaml — СЕКРЕТЫ + коммуникации (VL-428). НЕ коммитить!\n' +
    '# Приоритет чтения: shell env → comms.yaml → legacy .env\n';
  const tmp = `${path}.vibelog-tmp`;
  try {
    // Каталог .vibelog создаётся лениво (комментарий выше): writeComms
    // может вызываться в проекте, где каталога ещё нет
    mkdirSync(join(cwd, '.vibelog'), { recursive: true });
    writeFileSync(tmp, header + stringifyYaml(obj) + '\n', { encoding: 'utf-8', mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // temp может не существовать
    }
    throw new Error(`не удалось записать comms.yaml: ${(err as Error).message}`);
  }
}

/**
 * Одноразовая миграция TELEGRAM_BOT_TOKEN / TELEGRAM_PROXY /
 * TELEGRAM_CHAT_IDS из `.env` в comms.yaml (VL-428, upsertDotEnv-паттерн
 * VL-329 в зеркальном направлении: перенос, а не дублирование).
 *
 * Миграция идемпотентна: уже перенесённые ключи из `.env` удаляются,
 * отсутствующие в `.env` — не трогаются. Значения comms.yaml при конфликте
 * приоритетнее (.env не затирает comms).
 *
 * @returns список перенесённых ключей (пустой — миграция не потребовалась)
 */
export function migrateEnvToComms(cwd: string): string[] {
  const envPath = join(cwd, '.env');
  if (!existsSync(envPath)) return [];
  const moved: string[] = [];
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  const envValues = new Map<string, string>();
  for (const line of lines) {
    const t = line.trim().replace(/^export\s+/, '');
    const eq = t.indexOf('=');
    if (eq === -1 || t.startsWith('#')) continue;
    const key = t.slice(0, eq).trim();
    if (['TELEGRAM_BOT_TOKEN', 'TELEGRAM_PROXY', TELEGRAM_CHAT_IDS_KEY].includes(key)) {
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      envValues.set(key, v);
    }
  }
  if (envValues.size === 0) return [];
  const config = readComms(cwd, { warn: () => {} });
  let changed = false;
  const tok = envValues.get('TELEGRAM_BOT_TOKEN');
  if (tok && !config.bot_token) {
    config.bot_token = tok;
    moved.push('TELEGRAM_BOT_TOKEN');
    changed = true;
  }
  const proxy = envValues.get('TELEGRAM_PROXY');
  if (proxy && !config.proxy) {
    config.proxy = proxy;
    moved.push('TELEGRAM_PROXY');
    changed = true;
  }
  const chatsRaw = envValues.get(TELEGRAM_CHAT_IDS_KEY);
  if (chatsRaw && config.chats.length === 0) {
    config.chats = parseChatIds(chatsRaw);
    if (config.chats.length > 0) {
      moved.push(TELEGRAM_CHAT_IDS_KEY);
      changed = true;
    }
  }
  if (!changed) return [];
  writeComms(cwd, config);
  // Перенесённые ключи удаляются из .env (секреты не дублируются — риск VL-428)
  const kept = lines.filter((line) => {
    const t = line.trim().replace(/^export\s+/, '');
    const eq = t.indexOf('=');
    if (eq === -1) return true;
    const key = t.slice(0, eq).trim();
    return !moved.includes(key);
  });
  const tmp = `${envPath}.vibelog-tmp`;
  writeFileSync(tmp, kept.join('\n'), { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmp, envPath);
  return moved;
}

/**
 * Резолв секрета коммуникации (doc-32 §3): реальный shell env →
 * comms.yaml → legacy `.env`.
 *
 * Понадобилось отличать «настоящий» shell env от значения, которое
 * loadDotEnv скопировал из `.env` в process.env: они неотличимы в лоб,
 * поэтому сверяемся с файлом — совпадение process.env с записью `.env`
 * означает legacy-загрузку (comms важнее), расхождение — реальный shell
 * (он приоритетнее, оператор может переопределить токен переменной).
 *
 * @param key — 'bot_token' | 'proxy'
 * @returns значение или null
 */
export function resolveCommsSecret(cwd: string, key: 'bot_token' | 'proxy'): string | null {
  const envKey = key === 'bot_token' ? 'TELEGRAM_BOT_TOKEN' : 'TELEGRAM_PROXY';
  const shell = process.env[envKey]?.trim();
  const config = readComms(cwd, { warn: () => {} });
  const fromComms = key === 'bot_token' ? config.bot_token : config.proxy;
  if (shell !== undefined && shell !== '') {
    const legacy = readDotEnvValue(cwd, envKey);
    // Настоящий shell env (нет в .env либо отличается) — приоритет 1
    if (legacy === undefined || legacy !== shell) return shell;
  }
  // 2. comms.yaml
  if (fromComms) return fromComms;
  // 3. legacy .env (значение уже загружено в process.env)
  if (shell) return shell;
  return null;
}

/** Читает значение KEY из `<cwd>/.env` (без загрузки в process.env). */
function readDotEnvValue(cwd: string, key: string): string | undefined {
  const path = join(cwd, '.env');
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const t = line.trim().replace(/^export\s+/, '');
    const eq = t.indexOf('=');
    if (eq === -1 || t.startsWith('#')) continue;
    if (t.slice(0, eq).trim() !== key) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return undefined;
}

/**
 * Выбор канала (AC4, решение C: default_channel + явный override).
 *
 * Приоритет: явный id → default_channel → единственный канал → ошибка.
 * «Несколько каналов без default и без явного» — ошибка со списком.
 *
 * @returns канал либо {error} с перечнем доступных каналов
 */
export function resolveChannel(
  cwd: string,
  explicitId?: string,
): { channel: CommsChannel } | { error: string } {
  const config = readComms(cwd, { warn: () => {} });
  const list = config.channels;
  const available = list.map((c) => c.id).join(', ') || '(нет)';
  if (explicitId && explicitId.trim() !== '') {
    const found = list.find((c) => c.id === explicitId.trim());
    if (!found) return { error: `Канал «${explicitId}» не найден. Доступные: ${available}` };
    return { channel: found };
  }
  if (config.default_channel) {
    const found = list.find((c) => c.id === config.default_channel);
    if (!found)
      return {
        error: `default_channel «${config.default_channel}» не найден в каналах. Доступные: ${available}`,
      };
    return { channel: found };
  }
  if (list.length === 1) return { channel: list[0] };
  if (list.length === 0) return { error: 'Каналы не настроены: добавьте секцию channels в .vibelog/comms.yaml' };
  return {
    error: `Несколько каналов без default_channel и без явного выбора: ${available}. Задайте default_channel или укажите канал явно.`,
  };
}

/** Глобальный таймаут синхронного ожидания ответа, секунды. */
export function syncTimeoutSec(cwd: string): number {
  return readComms(cwd, { warn: () => {} }).sync_timeout_sec;
}

/**
 * Есть ли хотя бы один канал (AC: видимость interbot_ask).
 *
 * Тот же паттерн, что isUpstreamConfigured для UPSTREAM_TOOLS: инструмент,
 * который всё равно не сработает (каналов нет), клиент не должен видеть
 * ни в tools/list MCP-сервера, ни в веб-чате.
 */
export function isCommsConfigured(cwd: string): boolean {
  return readComms(cwd, { warn: () => {} }).channels.length > 0;
}
