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

/**
 * Конфигурационные ключи лимитов interbot (snake_case — как в comms.yaml).
 *
 * Все поля опциональны: отсутствие = дефолт кода (DEFAULT_LIMITS /
 * DEFAULT_GATE_TIMEOUT_SEC). Секция interbot_limits (глобальная) и поле
 * limits канала (per-channel override, doc-32 §2) используют одни и те же
 * ключи — мерж DEFAULT ← глобальная ← канал выполняет resolveInterbotLimits.
 */
export interface InterbotLimitsConfig {
  /** Окно dedup, секунды (дедупликация сообщений). */
  dedup_ttl_sec?: number;
  /** Сообщений от одного чужого бота в минуту. */
  bot_rate_per_min?: number;
  /** Сообщений от одного человека в минуту. */
  human_rate_per_min?: number;
  /** Глобальный лимит входящих LLM-ранов в час. */
  global_runs_per_hour?: number;
  /** Максимальная глубина reply-цепочки (включительно). */
  max_depth?: number;
  /** Таймаут гейта «есть ли что отвечать», секунды. */
  gate_timeout_sec?: number;
}

/**
 * Разрешённые (смерженные) лимиты loop-защиты interbot (doc-32 §5).
 *
 * Тип и DEFAULT_LIMITS живут в core (lesson-208: константы настройки в
 * src/core — чтобы CLI-мастер и веб-API не разъезжались в дефолтах);
 * src/bot/interbot.ts реэкспортирует их для прежних импортов.
 */
export interface InterbotLimits {
  /** Окно dedup, мс. */
  dedupTtlMs: number;
  /** Сообщений от одного чужого бота в минуту. */
  botRatePerMin: number;
  /** Сообщений от одного ЧЕЛОВЕКА в минуту (VL-433). */
  humanRatePerMin: number;
  /** Глобальный лимит входящих LLM-ранов в час. */
  globalRunsPerHour: number;
  /** Максимальная глубина reply-цепочки (включительно). */
  maxDepth: number;
}

/** Дефолтные лимиты v1 (перенесены из src/bot/interbot.ts, VL-438). */
export const DEFAULT_LIMITS: InterbotLimits = {
  dedupTtlMs: 10 * 60 * 1000,
  botRatePerMin: 10,
  humanRatePerMin: 5,
  globalRunsPerHour: 20,
  maxDepth: 2,
};

/** Дефолтный таймаут гейта, секунды (VL-437: 8000 мс выровнены по живцу). */
export const DEFAULT_GATE_TIMEOUT_SEC = 8;

/** Канал interbot-связи (doc-32 §2). */
export interface CommsChannel {
  id: string;
  label?: string;
  transport: string;
  group_id: number;
  addressing: ChannelAddressing;
  approval: ChannelApproval;
  admin_chat?: number;
  /** Per-channel override лимитов (doc-32 §2) поверх глобальной секции. */
  limits?: InterbotLimitsConfig;
}

/** Полная конфигурация comms.yaml. */
export interface CommsConfig {
  bot_token?: string;
  proxy?: string;
  chats: number[];
  channels: CommsChannel[];
  default_channel?: string;
  sync_timeout_sec: number;
  /** Глобальная секция interbot_limits (VL-438): лимиты + таймаут гейта. */
  interbot_limits?: InterbotLimitsConfig;
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
  const limits = readLimitsConfig(src.limits, `limits канала «${id}»`, warnings);
  return {
    id,
    ...(typeof src.label === 'string' ? { label: src.label } : {}),
    transport: typeof src.transport === 'string' ? src.transport : 'telegram',
    group_id: groupId,
    addressing: src.addressing === 'all' ? 'all' : 'mention',
    approval: src.approval === 'admin' ? 'admin' : 'auto',
    ...(readChatId(src.admin_chat) !== undefined ? { admin_chat: readChatId(src.admin_chat) } : {}),
    ...(limits !== undefined ? { limits } : {}),
  };
}

/**
 * Валидация объекта лимитов (interbot_limits секции или limits канала).
 *
 * Только положительные целые по известным ключам; битые значения и
 * неизвестные ключи отбрасываются с предупреждением (дефолт кода
 * перекрывает отброшенное). Пустой результат → undefined (секции нет).
 *
 * @param where — подпись для предупреждений («секция interbot_limits» / …)
 */
function readLimitsConfig(
  raw: unknown,
  where: string,
  warnings: string[],
): InterbotLimitsConfig | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push(`${where}: ожидался объект — прочитано пусто`);
    return undefined;
  }
  const src = raw as Record<string, unknown>;
  const keys = [
    'dedup_ttl_sec',
    'bot_rate_per_min',
    'human_rate_per_min',
    'global_runs_per_hour',
    'max_depth',
    'gate_timeout_sec',
  ] as const;
  const out: InterbotLimitsConfig = {};
  for (const key of keys) {
    const v = src[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      warnings.push(`${where}.${key}: ожидалось положительное целое — значение отброшено`);
      continue;
    }
    out[key] = v;
  }
  for (const key of Object.keys(src)) {
    if (!(keys as readonly string[]).includes(key)) {
      warnings.push(`${where}: неизвестный ключ «${key}» проигнорирован`);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
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
  // Секция interbot_limits (VL-438): глобальные лимиты + таймаут гейта
  const interbotLimits = readLimitsConfig(src.interbot_limits, 'секция interbot_limits', warnings);
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
    ...(interbotLimits !== undefined ? { interbot_limits: interbotLimits } : {}),
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
    ...(config.interbot_limits ? { interbot_limits: config.interbot_limits } : {}),
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
            ...(c.limits ? { limits: c.limits } : {}),
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
 * Мерж лимитов interbot: DEFAULT_LIMITS ← секция interbot_limits ← limits канала (VL-438).
 *
 * Каждый вызов читает comms.yaml — конфиг применяется горячо (readComms и так
 * читается на каждое сообщение бота, горячее применение бесплатно).
 *
 * @param channel — канал входящего сообщения; его limits перекрывают глобальные
 */
export function resolveInterbotLimits(cwd: string, channel?: CommsChannel): InterbotLimits {
  const cfg = readComms(cwd, { warn: () => {} });
  return mergeInterbotLimits(cfg.interbot_limits, channel?.limits);
}

/**
 * Чистый мерж без чтения файлов (юнит-тесты и уже прочитанный cfg).
 *
 * dedup_ttl_sec (сек, конфиг) → dedupTtlMs (мс, рантайм).
 */
export function mergeInterbotLimits(
  global?: InterbotLimitsConfig,
  channelLimits?: InterbotLimitsConfig,
): InterbotLimits {
  const g = global ?? {};
  const c = channelLimits ?? {};
  const pick = <K extends keyof InterbotLimitsConfig>(key: K): number | undefined =>
    c[key] ?? g[key];
  return {
    dedupTtlMs: (pick('dedup_ttl_sec') ?? DEFAULT_LIMITS.dedupTtlMs / 1000) * 1000,
    botRatePerMin: pick('bot_rate_per_min') ?? DEFAULT_LIMITS.botRatePerMin,
    humanRatePerMin: pick('human_rate_per_min') ?? DEFAULT_LIMITS.humanRatePerMin,
    globalRunsPerHour: pick('global_runs_per_hour') ?? DEFAULT_LIMITS.globalRunsPerHour,
    maxDepth: pick('max_depth') ?? DEFAULT_LIMITS.maxDepth,
  };
}

/**
 * Таймаут гейта в мс: канал ← глобальная секция ← DEFAULT_GATE_TIMEOUT_SEC.
 *
 * Канал передаётся уже разрешённым (handlers знает его до вызова гейта);
 * без канала — глобальный конфиг.
 */
export function gateTimeoutMs(cfg: Pick<CommsConfig, 'interbot_limits'>, channel?: CommsChannel): number {
  const sec = channel?.limits?.gate_timeout_sec ?? cfg.interbot_limits?.gate_timeout_sec;
  return (sec ?? DEFAULT_GATE_TIMEOUT_SEC) * 1000;
}

/**
 * Read-modify-write сырого comms.yaml (VL-438): мутирует ТОЛЬКО целевые ключи,
 * чужие top-level секции и secrets остаются как были.
 *
 * writeComms для веб-API не годится: он сериализует только известные поля
 * CommsConfig и потерял бы чужие секции файла. Здесь файл читается как
 * сырой YAML-объект, mutate правит нужные ветки, результат пишется
 * атомарно (temp + rename, mode 0600 — паттерн writeComms/lesson-214).
 *
 * @param mutate — получает сырой объект файла; исключения летят наверх
 *   (ни один байт не записан)
 */
export function patchCommsRaw(cwd: string, mutate: (raw: Record<string, unknown>) => void): void {
  const path = commsPath(cwd);
  let raw: Record<string, unknown> = {};
  if (existsSync(path)) {
    const text = readFileSync(path, 'utf-8');
    if (text.trim() !== '') {
      // Битый YAML не мутируем: перезапись уничтожила бы файл целиком
      try {
        raw = parseYaml(text) ?? {};
      } catch (err) {
        throw new Error(`comms.yaml не разобран — запись отменена: ${(err as Error).message}`);
      }
    }
  }
  mutate(raw);
  const header =
    '# .vibelog/comms.yaml — СЕКРЕТЫ + коммуникации (VL-428). НЕ коммитить!\n' +
    '# Приоритет чтения: shell env → comms.yaml → legacy .env\n';
  const tmp = `${path}.vibelog-tmp`;
  try {
    mkdirSync(join(cwd, '.vibelog'), { recursive: true });
    writeFileSync(tmp, header + stringifyYaml(raw) + '\n', { encoding: 'utf-8', mode: 0o600 });
    renameSync(tmp, path);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // temp мог не создаться
    }
    throw new Error(`не удалось записать comms.yaml: ${(err as Error).message}`);
  }
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
