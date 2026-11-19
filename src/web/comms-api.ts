/**
 * REST API страницы «Каналы» (VL-438): CRUD interbot-каналов, глобальные
 * параметры (таймауты/лимиты) и промпты веб-интерфейсом.
 *
 * По аналогии с personas-api.ts (VL-403), но хранилище — comms.yaml:
 *
 * - `GET/POST    /api/comms/channels`     — список/создание каналов;
 * - `GET/PUT/DELETE /api/comms/channels/:id` — чтение/правка/удаление;
 * - `GET/PUT     /api/comms/settings`     — sync_timeout_sec,
 *   default_channel, секция interbot_limits (лимиты + gate_timeout_sec);
 * - `GET/PUT     /api/comms/prompts`      — тексты шаблонов
 *   .vibelog/prompts/interbot/{incoming,gate}.md (PUT — запись проектного
 *   файла, DELETE ?name= — сброс на дефолт пакета).
 *
 * Ключевые решения (план VL-438):
 *
 * 1. **Запись — read-modify-write сырого YAML** (`patchCommsRaw`), а НЕ
 *    writeComms: writeComms сериализует только известные поля CommsConfig
 *    и потерял бы чужие top-level секции файла. patchCommsRaw мутирует
 *    только целевые ключи — secrets/chats/чужие секции нетронуты;
 *    атомарная запись (temp + rename, 0600) исключает порчу при живом боте
 *    (файл читается на каждое сообщение — читатель видит либо старый, либо
 *    новый файл).
 *
 * 2. **Секреты НИКОГДА не в ответах**: bot_token/proxy — только булевым
 *    признаком `secrets: {bot_token, proxy}` («настроен»). Значения не
 *    отдаются и не принимаются (PUT settings молча игнорирует такие ключи).
 *
 * 3. **Валидация ДО записи**: любая ошибка → 400 и ни одного изменения на
 *    диске; валидируется вся партия (канал целиком) до patchCommsRaw.
 *
 * 4. **default_channel guard**: PUT settings с несуществующим каналом → 400;
 *    DELETE канала, являющегося default_channel, → 409 (фронт показывает
 *    предупреждение и требует ?force=1 уже с осознанным решением пользователя).
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  commsPath,
  gateTimeoutMs,
  patchCommsRaw,
  readComms,
  resolveInterbotLimits,
} from '../core/comms.js';
import type { CommsChannel, InterbotLimitsConfig } from '../core/comms.js';
import {
  hasProjectInterbotPrompt,
  interbotPromptRelPath,
  loadInterbotPrompt,
} from '../core/interbot-prompts.js';
import type { InterbotPromptName } from '../core/interbot-prompts.js';
import type { ApiResponse } from './api.js';

/**
 * Допустимый id канала: строчная латиница/цифры/дефис, как у персон —
 * заодно защита от path traversal (id не попадает в пути файлов, но
 * держим единый слоган для UI и валидации).
 */
const CHANNEL_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Ключи limits/interbot_limits ( snake_case, как в comms.yaml). */
const LIMIT_KEYS = [
  'dedup_ttl_sec',
  'bot_rate_per_min',
  'human_rate_per_min',
  'global_runs_per_hour',
  'max_depth',
  'gate_timeout_sec',
] as const;

/** Секреты как признаки «настроен» — значений в ответах нет (AC5). */
function secretsFlags(cwd: string): { bot_token: boolean; proxy: boolean } {
  const cfg = readComms(cwd, { warn: () => {} });
  return { bot_token: Boolean(cfg.bot_token), proxy: Boolean(cfg.proxy) };
}

/** Сводка канала для API (без секретов — их у канала и нет). */
function channelJson(c: CommsChannel): Record<string, unknown> {
  return {
    id: c.id,
    label: c.label ?? '',
    transport: c.transport,
    group_id: c.group_id,
    addressing: c.addressing,
    approval: c.approval,
    admin_chat: c.admin_chat ?? null,
    ...(c.limits ? { limits: c.limits } : {}),
  };
}

/**
 * Валидация объекта limits (интерфейс/переопределение канала).
 *
 * @returns пустой объект-патч либо {error}; лишние ключи — 400 (в отличие
 *   от чтения, где незнакомый ключ лишь предупреждение: в UI пользователь
 *   вводит осознанно, опечатка не должна молча теряться)
 */
function validateLimits(
  raw: unknown,
  where: string,
): { limits: InterbotLimitsConfig } | { error: string } {
  if (raw === null || raw === undefined) return { limits: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: `${where}: ожидается объект лимитов` };
  }
  const src = raw as Record<string, unknown>;
  const out: InterbotLimitsConfig = {};
  for (const [key, value] of Object.entries(src)) {
    if (value === null || value === undefined) continue; // пустое поле UI — «не задано»
    if (!(LIMIT_KEYS as readonly string[]).includes(key)) {
      return { error: `${where}: неизвестный ключ «${key}»` };
    }
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
      return { error: `${where}.${key}: ожидается положительное целое` };
    }
    out[key as (typeof LIMIT_KEYS)[number]] = n;
  }
  return { limits: out };
}

/** Разбор целого числа из тела (number | 'строка'); null — пусто. */
function parseIntField(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) return undefined; // битый тип
  return n;
}

/**
 * Валидация канала (POST — полный, PUT — патч) ДО записи.
 *
 * @param existing — текущий канал для PUT (undefined для POST)
 * @returns канал-запись для YAML либо {error} → 400, файл не меняется
 */
function validateChannel(
  body: Record<string, unknown> | null,
  existing: CommsChannel | undefined,
): { channel: Record<string, unknown> } | { error: string } {
  const raw = body ?? {};
  const isCreate = existing === undefined;

  const id = typeof raw.id === 'string' ? raw.id.trim() : (existing?.id ?? '');
  if (id === '') return { error: 'id: обязательное поле' };
  if (!CHANNEL_ID_RE.test(id)) {
    return { error: 'id: допустимы строчная латиница, цифры и дефис (например, lb-link)' };
  }
  if (isCreate && id !== (raw.id !== undefined ? String(raw.id).trim() : '')) {
    return { error: 'id: недопустимые символы' };
  }

  let groupId: number | null | undefined;
  if (raw.group_id !== undefined || isCreate) {
    groupId = parseIntField(raw.group_id);
    if (groupId === undefined) return { error: 'group_id: ожидается целое число' };
    if (groupId === null) return { error: 'group_id: обязательное поле' };
    if (groupId === 0) return { error: 'group_id: не может быть 0' };
  } else {
    groupId = existing!.group_id;
  }

  let label = existing?.label ?? '';
  if (raw.label !== undefined) {
    if (typeof raw.label !== 'string') return { error: 'label: ожидается строка' };
    label = raw.label.trim();
  }

  let addressing = existing?.addressing ?? 'mention';
  if (raw.addressing !== undefined) {
    if (raw.addressing !== 'mention' && raw.addressing !== 'all') {
      return { error: 'addressing: допустимы mention | all' };
    }
    addressing = raw.addressing;
  }

  let approval = existing?.approval ?? 'auto';
  if (raw.approval !== undefined) {
    if (raw.approval !== 'auto' && raw.approval !== 'admin') {
      return { error: 'approval: допустимы auto | admin' };
    }
    approval = raw.approval;
  }

  let adminChat: number | null | undefined;
  if (raw.admin_chat !== undefined) {
    adminChat = parseIntField(raw.admin_chat);
    if (adminChat === undefined) return { error: 'admin_chat: ожидается целое число' };
    // null/'' — сброс (поле больше не задано)
  } else {
    adminChat = existing?.admin_chat ?? null;
  }

  let limits: InterbotLimitsConfig | undefined;
  if (raw.limits !== undefined) {
    if (raw.limits === null) {
      limits = undefined; // явный сброс переопределения
    } else {
      const validated = validateLimits(raw.limits, 'limits');
      if ('error' in validated) return { error: validated.error };
      limits = Object.keys(validated.limits).length > 0 ? validated.limits : undefined;
    }
  } else {
    limits = existing?.limits;
  }

  const transport = isCreate ? 'telegram' : existing!.transport;

  return {
    channel: {
      id,
      ...(label !== '' ? { label } : {}),
      transport,
      group_id: groupId,
      addressing,
      approval,
      ...(adminChat !== null && adminChat !== undefined ? { admin_chat: adminChat } : {}),
      ...(limits ? { limits } : {}),
    },
  };
}

/** Секция interbot_limits из тела PUT settings (undefined — не менять). */
function validateInterbotLimits(
  body: Record<string, unknown> | null,
): { limits?: InterbotLimitsConfig | null } | { error: string } {
  const raw = body?.interbot_limits;
  if (raw === undefined) return {};
  if (raw === null) return { limits: null }; // сброс секции → дефолты кода
  const validated = validateLimits(raw, 'interbot_limits');
  if ('error' in validated) return { error: validated.error };
  return { limits: validated.limits };
}

/**
 * Промпт-сводка для API: текст + откуда взят.
 *
 * @param source — 'project' (файл проекта) | 'default' (пакетный шаблон)
 */
function promptJson(cwd: string, name: InterbotPromptName): Record<string, unknown> {
  const project = hasProjectInterbotPrompt(cwd, name);
  return {
    name,
    path: interbotPromptRelPath(name),
    source: project ? 'project' : 'default',
    text: loadInterbotPrompt(name, cwd),
  };
}

/**
 * Обрабатывает /api/comms/* (VL-438).
 *
 * @returns ApiResponse либо null — URL не наш (роутинг продолжается,
 *   паттерн handlePersonasApi/handleSetupApi)
 */
export function handleCommsApi(
  method: string,
  url: string,
  body: Record<string, unknown> | null,
  cwd: string,
  queryString = '',
): ApiResponse | null {
  // ── GET/PUT /api/comms/settings — глобальные параметры ──
  if (url === '/api/comms/settings') {
    if (method === 'GET') {
      const cfg = readComms(cwd, { warn: () => {} });
      return {
        status: 200,
        body: {
          sync_timeout_sec: cfg.sync_timeout_sec,
          default_channel: cfg.default_channel ?? null,
          interbot_limits: cfg.interbot_limits ?? {},
          secrets: secretsFlags(cwd),
          // Эффективные значения (мерж с дефолтами) — для подсказок в UI
          effective: {
            ...resolveInterbotLimits(cwd),
            gate_timeout_ms: gateTimeoutMs(cfg),
          },
          channels: cfg.channels.map((c) => c.id),
          prompt_paths: {
            incoming: interbotPromptRelPath('incoming'),
            gate: interbotPromptRelPath('gate'),
          },
        },
      };
    }
    if (method === 'PUT') {
      const errors: string[] = [];
      const raw = body ?? {};

      // sync_timeout_sec: положительное целое
      let sync: number | undefined;
      if (raw.sync_timeout_sec !== undefined && raw.sync_timeout_sec !== null) {
        const n = parseIntField(raw.sync_timeout_sec);
        if (n === undefined || n === null || n <= 0) {
          errors.push('sync_timeout_sec: ожидается положительное целое число');
        } else {
          sync = n;
        }
      }

      // default_channel: только существующий канал (guard AC5)
      let defaultChannel: string | null | undefined;
      const cfg = readComms(cwd, { warn: () => {} });
      if (raw.default_channel !== undefined) {
        const v = raw.default_channel;
        if (v === null || v === '') {
          defaultChannel = null; // снять default
        } else if (typeof v !== 'string') {
          errors.push('default_channel: ожидается строка (id канала)');
        } else if (!cfg.channels.some((c) => c.id === v)) {
          errors.push(
            `default_channel: канал «${v}» не найден. Доступные: ${
              cfg.channels.map((c) => c.id).join(', ') || '(нет)'
            }`,
          );
        } else {
          defaultChannel = v;
        }
      }

      // interbot_limits
      const limitsResult = validateInterbotLimits(raw);
      if ('error' in limitsResult) errors.push(limitsResult.error);

      if (errors.length > 0) {
        return { status: 400, body: { error: errors.join('; ') } };
      }

      try {
        patchCommsRaw(cwd, (rawFile) => {
          if (sync !== undefined) rawFile.sync_timeout_sec = sync;
          if (defaultChannel !== undefined) {
            if (defaultChannel === null) delete rawFile.default_channel;
            else rawFile.default_channel = defaultChannel;
          }
          if ('limits' in limitsResult) {
            if (limitsResult.limits === null || Object.keys(limitsResult.limits ?? {}).length === 0) {
              delete rawFile.interbot_limits;
            } else {
              rawFile.interbot_limits = limitsResult.limits;
            }
          }
        });
      } catch (err) {
        return { status: 500, body: { error: (err as Error).message } };
      }
      const updated = readComms(cwd, { warn: () => {} });
      return {
        status: 200,
        body: {
          sync_timeout_sec: updated.sync_timeout_sec,
          default_channel: updated.default_channel ?? null,
          interbot_limits: updated.interbot_limits ?? {},
          secrets: secretsFlags(cwd),
          channels: updated.channels.map((c) => c.id),
        },
      };
    }
    return null;
  }

  // ── GET/PUT /api/comms/prompts — шаблоны промптов ──
  if (url === '/api/comms/prompts') {
    if (method === 'GET') {
      return {
        status: 200,
        body: { incoming: promptJson(cwd, 'incoming'), gate: promptJson(cwd, 'gate') },
      };
    }
    if (method === 'PUT') {
      const raw = body ?? {};
      const name = raw.name;
      if (name !== 'incoming' && name !== 'gate') {
        return { status: 400, body: { error: 'name: ожидается incoming | gate' } };
      }
      if (raw.reset === true) {
        // Сброс на дефолт: удаляем проектный файл (пакетный — автоматически)
        try {
          unlinkSync(join(cwd, interbotPromptRelPath(name)));
        } catch {
          // файла не было — сброс и так «дефолт»
        }
        return { status: 200, body: promptJson(cwd, name) };
      }
      if (typeof raw.text !== 'string' || raw.text.trim() === '') {
        return { status: 400, body: { error: 'text: текст промпта не может быть пустым' } };
      }
      const path = join(cwd, interbotPromptRelPath(name as InterbotPromptName));
      try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${raw.text.replace(/\n+$/, '')}\n`, 'utf-8');
      } catch (err) {
        return { status: 500, body: { error: `не удалось записать шаблон: ${(err as Error).message}` } };
      }
      return { status: 200, body: promptJson(cwd, name as InterbotPromptName) };
    }
    return null;
  }

  // ── /api/comms/channels[/:id] — CRUD каналов ──
  const detailMatch = url.match(/^\/api\/comms\/channels\/([^/]+)$/);
  const listUrl = url === '/api/comms/channels';

  if (listUrl && method === 'GET') {
    const cfg = readComms(cwd, { warn: () => {} });
    return {
      status: 200,
      body: {
        channels: cfg.channels.map(channelJson),
        default_channel: cfg.default_channel ?? null,
        secrets: secretsFlags(cwd),
        sync_timeout_sec: cfg.sync_timeout_sec,
        interbot_limits: cfg.interbot_limits ?? {},
        // Диагностика битых полей (как errors у персон)
        warnings: [],
      },
    };
  }

  if (listUrl && method === 'POST') {
    const cfg = readComms(cwd, { warn: () => {} });
    const validated = validateChannel(body, undefined);
    if ('error' in validated) return { status: 400, body: { error: validated.error } };
    const ch = validated.channel;
    if (cfg.channels.some((c) => c.id === ch.id)) {
      return { status: 400, body: { error: `канал «${ch.id}» уже существует` } };
    }
    try {
      patchCommsRaw(cwd, (rawFile) => {
        const list = Array.isArray(rawFile.channels) ? (rawFile.channels as unknown[]) : [];
        list.push(ch);
        rawFile.channels = list;
      });
    } catch (err) {
      return { status: 500, body: { error: (err as Error).message } };
    }
    const created = readComms(cwd, { warn: () => {} }).channels.find((c) => c.id === ch.id);
    return { status: 201, body: { channel: created ? channelJson(created) : ch } };
  }

  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]!);
    const cfg = readComms(cwd, { warn: () => {} });
    const existing = cfg.channels.find((c) => c.id === id);

    if (method === 'GET') {
      if (!existing) return { status: 404, body: { error: `Канал «${id}» не найден` } };
      return {
        status: 200,
        body: {
          channel: channelJson(existing),
          is_default: cfg.default_channel === id,
          secrets: secretsFlags(cwd),
          // Эффективные лимиты с учётом этого канала — для подсказок UI
          effective_limits: resolveInterbotLimits(cwd, existing),
        },
      };
    }

    if (method === 'PUT') {
      if (!existing) return { status: 404, body: { error: `Канал «${id}» не найден` } };
      const raw = body ?? {};
      // id в PUT: либо отсутствует, либо совпадает (переименование — через create+delete)
      if (raw.id !== undefined && typeof raw.id === 'string' && raw.id.trim() !== id) {
        return { status: 400, body: { error: 'id: переименование канала не поддерживается — создайте новый' } };
      }
      const validated = validateChannel(raw, existing);
      if ('error' in validated) return { status: 400, body: { error: validated.error } };
      const ch = validated.channel;
      try {
        patchCommsRaw(cwd, (rawFile) => {
          const list = Array.isArray(rawFile.channels) ? (rawFile.channels as unknown[]) : [];
          const idx = list.findIndex(
            (item) =>
              item !== null &&
              typeof item === 'object' &&
              (item as Record<string, unknown>).id === id,
          );
          if (idx >= 0) list[idx] = ch;
          else list.push(ch); // канал был валидно прочитан — индекс должен найтись
          rawFile.channels = list;
          // Правка default-канала не ломает default_channel (id не меняется)
        });
      } catch (err) {
        return { status: 500, body: { error: (err as Error).message } };
      }
      const updated = readComms(cwd, { warn: () => {} }).channels.find((c) => c.id === id);
      return { status: 200, body: { channel: updated ? channelJson(updated) : ch } };
    }

    if (method === 'DELETE') {
      if (!existing) return { status: 404, body: { error: `Канал «${id}» не найден` } };
      const isDefault = cfg.default_channel === id;
      // AC5: guard default_channel — без force отказ (409) с предупреждением.
      // queryString приходит БЕЗ ведущего '?': 'force=1' или 'a=1&force=1'
      const force = /(?:^|&)force=1(?:&|$)/.test(queryString);
      if (isDefault && !force) {
        return {
          status: 409,
          body: {
            error: `Канал «${id}» является default_channel — удаление сломает /ask и interbot_ask`,
            warning:
              'Сначала смените default_channel в настройках (или повторите удаление с force=1 — default_channel будет сброшен).',
            requires_force: true,
          },
        };
      }
      try {
        patchCommsRaw(cwd, (rawFile) => {
          const list = Array.isArray(rawFile.channels) ? (rawFile.channels as unknown[]) : [];
          rawFile.channels = list.filter(
            (item) =>
              !(
                item !== null &&
                typeof item === 'object' &&
                (item as Record<string, unknown>).id === id
              ),
          );
          if (isDefault && force) delete rawFile.default_channel;
        });
      } catch (err) {
        return { status: 500, body: { error: (err as Error).message } };
      }
      return {
        status: 200,
        body: {
          deleted: id,
          default_channel_cleared: isDefault && force,
          ...(isDefault && force
            ? { warning: 'default_channel сброшен — выберите новый канал по умолчанию' }
            : {}),
        },
      };
    }
    return null;
  }

  if (listUrl) {
    return { status: 405, body: { error: `Метод ${method} не поддерживается` } };
  }
  return null;
}

/** Путь comms.yaml (для подтверждений UI и диагностики). */
export function commsFileRelPath(): string {
  return '.vibelog/comms.yaml';
}

/** Файл comms.yaml существует (для статуса «настроен»). */
export function commsFileExists(cwd: string): boolean {
  return existsSync(commsPath(cwd));
}

/** Сырой comms.yaml как есть — НЕ отдаётся в API (секреты), только для тестов. */
export function readCommsRawForTests(cwd: string): string {
  return readFileSync(commsPath(cwd), 'utf-8');
}
