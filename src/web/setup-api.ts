/**
 * REST API wizard-а настройки проекта (VL-210) — web-страница `#/setup`.
 *
 * Эндпоинты:
 * - GET  /api/setup            — состояние проекта (режим, дефолты, агенты,
 *   провайдеры/модели, факт наличия секретов) БЕЗ значений секретов;
 * - POST /api/setup            — применить ответы формы (то же ядро, что у
 *   консольного wizard-а: core/setup.ts applySetup);
 * - POST /api/setup/ping       — ping LLM (async, живёт в server.ts);
 * - POST /api/setup/check-bot  — getMe Telegram (async, живёт в server.ts).
 *
 * Секреты наружу не отдаются: только `keySet: boolean` (паттерн
 * GET /api/models, VL-209) — иначе токены утекли бы в браузер.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { applySetup, readSetupState, SetupError } from '../core/setup.js';
import type { AgentId, SetupAnswers, SetupMode } from '../core/setup.js';
import type { SecretsLocation } from '../core/setup-secrets.js';
import { SECRETS_LOCATIONS } from '../core/setup-secrets.js';
import { loadGateways, resolveActiveModel, resolveModelById } from '../core/models.js';
import { pingLlm, checkTelegramToken } from '../core/setup-check.js';
import type { ApiResponse } from './api.js';

/**
 * Допустимые локации секретов (валидация тела POST /api/setup).
 * VL-324: список живёт в core/setup-secrets.ts — добавилась локация `system`
 * (ничего не писать), и дублировать перечень в веб-слое нельзя.
 */
const LOCATIONS: SecretsLocation[] = SECRETS_LOCATIONS;

/** Допустимые агенты. */
const AGENT_IDS: AgentId[] = ['vb', 'qwen', 'opencode', 'claude'];

/** Приводит значение к массиву строк (терпимо к одиночной строке). */
function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((x): x is string => typeof x === 'string');
  if (typeof value === 'string' && value !== '') return [value];
  return [];
}

/** Приводит значение к массиву чисел (chat_id). */
function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
}

/**
 * Разбирает тело POST /api/setup в SetupAnswers с валидацией.
 *
 * @returns { answers } либо { error } с понятным текстом (400)
 */
export function parseSetupBody(
  body: Record<string, unknown> | null,
  cwd: string,
): { answers: SetupAnswers } | { error: string } {
  if (body === null || typeof body !== 'object') {
    return { error: 'Ожидается JSON-объект с ответами wizard-а' };
  }

  const modeRaw = body.mode;
  const mode: SetupMode = modeRaw === 'fresh' || modeRaw === 'upgrade'
    ? modeRaw
    : readSetupState(cwd).mode;

  const projectName = typeof body.projectName === 'string' ? body.projectName.trim() : '';
  if (projectName === '') return { error: 'projectName: имя проекта не может быть пустым' };

  const prefix = typeof body.prefix === 'string' ? body.prefix.trim() : '';
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,9}$/.test(prefix)) {
    return { error: 'prefix: латинская буква, затем буквы/цифры/_/-, не длиннее 10 символов' };
  }

  const agentsRaw = asStringArray(body.agents);
  const agents: AgentId[] = [];
  for (const id of agentsRaw) {
    if (!(AGENT_IDS as string[]).includes(id)) {
      return { error: `agents: неизвестный агент "${id}". Допустимые: ${AGENT_IDS.join(', ')}` };
    }
    if (!agents.includes(id as AgentId)) agents.push(id as AgentId);
  }

  const defaultAgentRaw = typeof body.defaultAgent === 'string' ? body.defaultAgent : '';
  if (defaultAgentRaw !== '' && !(agents as string[]).includes(defaultAgentRaw)) {
    return { error: `defaultAgent: "${defaultAgentRaw}" не входит в выбранные агенты` };
  }

  const secretsRaw = typeof body.secretsLocation === 'string' ? body.secretsLocation : 'env';
  if (!(LOCATIONS as string[]).includes(secretsRaw)) {
    return { error: `secretsLocation: ожидается ${LOCATIONS.join('|')}` };
  }

  // Бот: объект { token?, chats?, proxy? } либо отсутствует
  let bot: SetupAnswers['bot'];
  if (body.bot !== null && typeof body.bot === 'object' && !Array.isArray(body.bot)) {
    const raw = body.bot as Record<string, unknown>;
    const token = typeof raw.token === 'string' && raw.token !== '' ? raw.token : undefined;
    const proxy = typeof raw.proxy === 'string' && raw.proxy !== '' ? raw.proxy : undefined;
    const chats = asNumberArray(raw.chats);
    if (token !== undefined || proxy !== undefined || chats.length > 0) {
      bot = { token, chats, ...(proxy !== undefined ? { proxy } : {}) };
    }
  }

  // Шлюз (VL-315; раньше provider): id обязателен, base_url обязателен для нового
  let gateway: SetupAnswers['gateway'];
  if (body.gateway !== null && typeof body.gateway === 'object' && !Array.isArray(body.gateway)) {
    const raw = body.gateway as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (id === '') return { error: 'gateway.id: не задан идентификатор шлюза' };
    const known = loadGateways(cwd)[id];
    const baseUrl = typeof raw.base_url === 'string' && raw.base_url !== ''
      ? raw.base_url
      : known?.base_url ?? '';
    if (baseUrl === '') {
      return { error: `Шлюз ${id} не найден. Добавьте секцию gateways.${id} в .vibelog/settings.json` };
    }
    const apiKeyEnv = typeof raw.api_key_env === 'string' && raw.api_key_env !== ''
      ? raw.api_key_env
      : known?.api_key_env;
    const apiKey = typeof raw.apiKey === 'string' && raw.apiKey !== '' ? raw.apiKey : undefined;
    gateway = { id, base_url: baseUrl, api_key_env: apiKeyEnv, apiKey };
  }

  // Модель: id + gateway (+ vendor) + wire-имя
  let model: SetupAnswers['model'];
  if (body.model !== null && typeof body.model === 'object' && !Array.isArray(body.model)) {
    const raw = body.model as Record<string, unknown>;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (id === '') return { error: 'model.id: не задан идентификатор модели' };
    const existing = readSetupState(cwd).models.available[id];
    const gatewayId = typeof raw.gateway === 'string' && raw.gateway !== ''
      ? raw.gateway
      : gateway?.id ?? existing?.gateway ?? '';
    if (gatewayId === '') {
      return { error: `Модель ${id}: не указан шлюз (gateway)` };
    }
    const vendorRaw = typeof raw.vendor === 'string' ? raw.vendor.trim() : '';
    const apiModeRaw = typeof raw.api_mode === 'string' ? raw.api_mode : '';
    if (apiModeRaw !== '' && apiModeRaw !== 'chat' && apiModeRaw !== 'responses') {
      return { error: 'model.api_mode: ожидается chat|responses' };
    }
    model = {
      id,
      label: typeof raw.label === 'string' && raw.label !== '' ? raw.label : existing?.label,
      gateway: gatewayId,
      ...(vendorRaw !== '' ? { vendor: vendorRaw } : existing?.vendor ? { vendor: existing.vendor } : {}),
      model: typeof raw.model === 'string' && raw.model !== '' ? raw.model : existing?.model ?? id,
      api_mode: apiModeRaw === 'responses' ? 'responses' : apiModeRaw === 'chat' ? 'chat' : existing?.api_mode,
    };
  }

  return {
    answers: {
      mode,
      projectName,
      prefix,
      agents,
      defaultAgent: defaultAgentRaw !== '' ? (defaultAgentRaw as AgentId) : undefined,
      secretsLocation: secretsRaw as SecretsLocation,
      secretsOverwrite: body.secretsOverwrite === true,
      bot,
      gateway,
      model,
      mcp: body.mcp !== false,
      force: body.force === true,
    },
  };
}

/**
 * Обрабатывает синхронные эндпоинты wizard-а (GET/POST /api/setup).
 *
 * @returns ApiResponse либо null, если URL не относится к wizard-у
 *   (тогда api.ts продолжает обычную маршрутизацию)
 */
export function handleSetupApi(
  method: string,
  url: string,
  body: Record<string, unknown> | null,
  cwd: string,
): ApiResponse | null {
  if (url !== '/api/setup') return null;

  if (method === 'GET') {
    const state = readSetupState(cwd);
    const gateways = loadGateways(cwd);
    return {
      status: 200,
      body: {
        mode: state.mode,
        projectName: state.projectName,
        prefix: state.prefix,
        configError: state.configError ?? null,
        agents: state.agents,
        defaultAgent: state.defaultAgent ?? null,
        secrets: {
          envFile: state.secrets.envFile,
          envKeys: state.secrets.envKeys,
          settingsEnvKeys: state.secrets.settingsEnvKeys,
        },
        bot: state.bot,
        // Провайдеры — БЕЗ значений ключей: только факт наличия (паттерн /api/models)
        gateways: Object.entries(gateways).map(([id, p]) => ({
          id,
          base_url: p.base_url,
          api_key_env: p.api_key_env ?? null,
          keySet: Boolean((p.api_key_env && process.env[p.api_key_env]) || p.api_key),
        })),
        models: {
          default: state.models.default ?? null,
          available: Object.entries(state.models.available).map(([id, m]) => ({
            id,
            label: m.label ?? id,
            gateway: m.gateway,
            ...(m.vendor ? { vendor: m.vendor } : {}),
            model: m.model,
            api_mode: m.api_mode ?? 'chat',
          })),
        },
        mcp: state.mcp,
        // Наличие .env — для подсказки «файл будет создан»
        envFileExists: existsSync(join(cwd, '.env')),
      },
    };
  }

  if (method === 'POST') {
    const parsed = parseSetupBody(body, cwd);
    if ('error' in parsed) return { status: 400, body: { error: parsed.error } };
    try {
      const result = applySetup(cwd, parsed.answers);
      return { status: 200, body: { ok: true, ...result } };
    } catch (err) {
      if (err instanceof SetupError) return { status: 400, body: { error: err.message } };
      return { status: 500, body: { error: (err as Error)?.message ?? String(err) } };
    }
  }

  return { status: 405, body: { error: `Метод ${method} не поддерживается для /api/setup` } };
}

/**
 * Ping LLM для кнопки «Проверить» (async — вызывается из server.ts).
 *
 * @param body — { model?: string } — id модели из available; без него берётся
 *   активная модель (models.default)
 */
export async function handleSetupPing(
  body: Record<string, unknown> | null,
  cwd: string,
): Promise<ApiResponse> {
  const modelId = typeof body?.model === 'string' && body.model !== '' ? body.model : '';
  const active = modelId !== '' ? resolveModelById(cwd, modelId) : resolveActiveModel(cwd);
  if (active === null) {
    return {
      status: 400,
      body: {
        error: modelId !== ''
          ? `Модель ${modelId} не найдена в models.available`
          : 'Модель не настроена: нет models.default в .vibelog/settings.json',
      },
    };
  }
  const result = await pingLlm(active);
  return { status: 200, body: result };
}

/**
 * Проверка токена Telegram для кнопки «Проверить» (async).
 *
 * @param body — { token?: string }; без токена берётся TELEGRAM_BOT_TOKEN
 *   из окружения (уже загруженного loadProjectEnv)
 */
export async function handleSetupCheckBot(
  body: Record<string, unknown> | null,
  cwd: string,
): Promise<ApiResponse> {
  void cwd;
  const token = typeof body?.token === 'string' && body.token !== ''
    ? body.token
    : process.env.TELEGRAM_BOT_TOKEN ?? '';
  const result = await checkTelegramToken(token);
  return { status: 200, body: result };
}
