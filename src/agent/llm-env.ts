/**
 * Общая валидация LLM-окружения агента (VL-189, расширено VL-209).
 *
 * Раньше проверки VIBELOG_LLM_API_KEY / VIBELOG_LLM_MODEL и тексты ошибок
 * дублировались в двух местах: headless-CLI (src/agent/cli.ts — запуск фаз
 * из бота/браузера) и интерактивный чат (src/agent/interactive.ts).
 * Вынесены сюда, чтобы бот и браузер вели себя одинаково (дедупликация
 * по плану VL-189), а формулировки оставались дословно прежними — их
 * матчат тесты (cli.test.mjs: /VIBELOG_LLM_API_KEY/) и их видит пользователь.
 *
 * VL-209: два режима проверки. Если в settings.json настроен реестр
 * models/gateways (resolveActiveModel вернул конфиг) — валидируются СЕКЦИИ
 * (провайдер существует, api_key_env задан) с новыми понятными текстами.
 * Нет секции models — СТАРОЕ поведение и старые тексты дословно 1:1
 * (fallback-контракт плана VL-209: env-only пользователи не ломаются).
 */

import { loadSettings } from '../core/settings.js';
import { findModelByGatewayName, resolveActiveModel, resolveModelById, validateModelsConfig } from '../core/models.js';
import type { ActiveModel } from '../core/models.js';
import type { ApiMode } from './llm.js';
import type { SessionMeta } from './session.js';

/**
 * Источник модели рана (VL-239) — для лога и диагностики.
 * - session — зафиксирована в мете сессии при создании (приоритет при resume);
 * - settings — активная модель из models.default;
 * - env — legacy VIBELOG_LLM_MODEL (секции models нет);
 * - explicit — явный флаг --model <id>.
 */
export type RunModelSource = 'session' | 'settings' | 'env' | 'explicit';

/** Итог резолва модели рана (VL-239): всё, что нужно createLlmClient. */
export interface ResolvedRunModel {
  /** id модели в models.available (у env-пути — само wire-имя). */
  id: string;
  /** Подпись для лога (label из available, у env — wire-имя). */
  label: string;
  /** Wire-имя модели (поле model запроса). */
  model: string;
  /** id шлюза (только models-путь; VL-315 — раньше providerId). */
  gatewayId?: string;
  /** Апстрим внутри шлюза (VL-315); undefined — шлюз выбирает сам. */
  vendor?: string;
  /** base_url провайдера (только models-путь); undefined — взять из env. */
  baseUrl?: string;
  /** API-ключ (только models-путь); undefined — взять из env. */
  apiKey?: string;
  /** Имя env-переменной ключа (тексты ошибок). */
  apiKeyEnv?: string;
  /** Режим API, с которым пойдёт ран. */
  apiMode: ApiMode;
  /** Откуда взята модель. */
  source: RunModelSource;
  /** Предупреждение для stderr (расхождение/fail-open), если есть. */
  warning?: string;
  /** Полный резолв из реестра — для валидации окружения (ensureLlmEnv). */
  active?: ActiveModel;
}

/** Собирает ResolvedRunModel из полного ActiveModel реестра. */
function fromActive(
  active: ActiveModel,
  source: RunModelSource,
  apiMode: ApiMode,
  warning?: string,
): ResolvedRunModel {
  return {
    id: active.id,
    label: active.label,
    model: active.model,
    gatewayId: active.gatewayId,
    ...(active.vendor !== undefined ? { vendor: active.vendor } : {}),
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    apiKeyEnv: active.apiKeyEnv,
    apiMode,
    source,
    ...(warning ? { warning } : {}),
    active: { ...active, apiMode },
  };
}

/** Строка «label (id)» для предупреждений и лога. */
function modelTitle(m: { label: string; id: string }): string {
  return `${m.label} (${m.id})`;
}

/**
 * Резолвит модель ЭТОГО рана (VL-239) — фиксация модели на сессии.
 *
 * Приоритет: `--model <id>` (explicit) → `--model-follow-settings` (settings) →
 * модель из меты сессии (session) → активная модель (settings) → env-фallback.
 *
 * Почему так: смена models.default между фазами (VL-209) при включённом
 * code_same_session незаметно меняла модель на середине задачи — история
 * продолжалась «чужой» моделью, кэш промптов провайдера не переиспользовался,
 * а billing (тариф по фактической модели) искажал картину.
 *
 * Fail-open (AC4): мета без model-полей, удалённая модель/провайдер, битая
 * мета — не роняют фазу: применяется активная/env-модель с предупреждением.
 * Явный `--model` — исключение: неизвестный id это ошибка пользователя.
 *
 * @param cwd — директория settings.json (VIBELOG_CWD ?? cwd в branch-mode)
 * @param meta — мета сессии (null для новой сессии/сессий без меты)
 * @param opts.modelId — значение флага --model (id из models.available)
 * @param opts.followSettings — флаг --model-follow-settings: игнорировать мету
 * @throws Error при `opts.modelId`, отсутствующем в models.available
 */
export function resolveRunModel(
  cwd: string,
  meta: SessionMeta | null,
  opts: { modelId?: string; followSettings?: boolean } = {},
): ResolvedRunModel {
  const active = resolveActiveModel(cwd);

  // 1. Явный флаг --model: пользователь осознанно меняет модель — ошибка, если нет
  if (opts.modelId !== undefined) {
    const explicit = resolveModelById(cwd, opts.modelId);
    if (explicit === null) {
      throw new Error(
        `Неизвестная модель: ${opts.modelId} — отсутствует в models.available settings.json`,
      );
    }
    const warning =
      meta?.model_id !== undefined && meta.model_id !== explicit.id
        ? `Внимание: --model переопределяет модель сессии ${meta.model_id} → ${modelTitle(explicit)}`
        : undefined;
    return fromActive(explicit, 'explicit', explicit.apiMode, warning);
  }

  // 2. --model-follow-settings: осознанно продолжаем на активной модели
  if (opts.followSettings === true) {
    if (active !== null) return fromActive(active, 'settings', active.apiMode);
    return envModel(cwd, meta);
  }

  // 3. Модель из меты сессии
  const hasMetaModel = !!meta && !!(meta.model_id || meta.model_name);
  if (hasMetaModel) {
    if (active !== null) {
      // Реестр models настроен — ищем зафиксированную модель: сначала по id,
      // затем по стабильной паре provider+wire-имя (id могли переименовать)
      let found =
        meta.model_id !== undefined ? resolveModelById(cwd, meta.model_id) : null;
      // VL-315: model_gateway — новое имя, model_provider — deprecated-алиас
      const metaGateway = meta.model_gateway ?? meta.model_provider;
      if (found === null && metaGateway && meta.model_name) {
        found = findModelByGatewayName(cwd, metaGateway, meta.model_name);
      }
      if (found !== null) {
        const apiMode = meta.api_mode ?? found.apiMode;
        const warnings: string[] = [];
        if (found.id !== active.id) {
          warnings.push(
            `Внимание: модель сессии ${modelTitle(found)} ≠ активная в settings ${modelTitle(active)} — ` +
              `продолжаю на модели сессии (переопределения: --model ${active.id} | --model-follow-settings)`,
          );
        }
        if (meta.api_mode !== undefined && meta.api_mode !== found.apiMode) {
          warnings.push(
            `Внимание: api_mode из меты (${meta.api_mode}) ≠ api_mode модели в settings (${found.apiMode}) — применяю из меты`,
          );
        }
        return fromActive(
          found,
          'session',
          apiMode,
          warnings.length > 0 ? warnings.join('\n') : undefined,
        );
      }
      // Мета есть, но модель/провайдер в settings больше не разрешаются — fail-open
      const wanted = meta.model_id ?? `${metaGateway ?? '?'}/${meta.model_name ?? '?'}`;
      return fromActive(
        active,
        'settings',
        active.apiMode,
        `Внимание: модель сессии ${wanted} не найдена в settings.json (удалена из models.available или провайдер убран) — продолжаю на активной ${modelTitle(active)}`,
      );
    }
    // models не настроен (env-only): закрепляем wire-имя из меты, base_url/apiKey — из env
    if (meta.model_name) {
      const apiMode = meta.api_mode ?? loadApiMode(cwd);
      const envModelName = process.env.VIBELOG_LLM_MODEL;
      const warning =
        envModelName !== undefined && envModelName !== meta.model_name
          ? `Внимание: модель сессии ${meta.model_name} ≠ VIBELOG_LLM_MODEL ${envModelName} — продолжаю на модели сессии (переопределение: --model-follow-settings)`
          : undefined;
      return {
        id: meta.model_name,
        label: meta.model_name,
        model: meta.model_name,
        apiMode,
        source: 'session',
        ...(warning ? { warning } : {}),
      };
    }
  }

  // 4. Меты нет / мета без model-полей (старые сессии) — прежнее поведение
  if (active !== null) return fromActive(active, 'settings', active.apiMode);
  return envModel(cwd, meta);
}

/** Env-фолбэк: модель из VIBELOG_LLM_MODEL (секции models нет). */
function envModel(cwd: string, meta: SessionMeta | null): ResolvedRunModel {
  const apiMode = meta?.api_mode ?? loadApiMode(cwd);
  const model = process.env.VIBELOG_LLM_MODEL ?? '';
  return {
    id: model,
    label: model || '(не задана)',
    model,
    apiMode,
    source: 'env',
  };
}

/**
 * Строка лога модели рана для stderr (VL-239, продолжение VL-209):
 * «Модель: <label> (<id>), api_mode: <chat|responses> — <источник>».
 *
 * Базовая часть сохранена дословно (её матчит cli.test.mjs VL-209), суффикс
 * источника показывает, применена ли модель сессии или настройки — иначе по
 * logTail нельзя понять, чья модель реально работала.
 */
export function modelLogLine(resolved: ResolvedRunModel): string {
  const suffix =
    resolved.source === 'session'
      ? ' — из сессии'
      : resolved.source === 'explicit'
        ? ' — явный --model'
        : resolved.source === 'env'
          ? ' — из env'
          : ' — из настроек';
  return `Модель: ${resolved.label} (${resolved.id}), api_mode: ${resolved.apiMode}${suffix}`;
}

/**
 * Проверяет, что LLM настроен (секции settings.json либо env-переменные);
 * при ошибке печатает понятную ошибку в stderr.
 *
 * @param subject — получатель доступа в тексте ошибки: 'агенту' (headless
 *   запуск фаз) либо 'чату с агентом' (TUI-чат) — сохраняет старые формулировки
 * @param cwd — директория проекта для чтения settings.json (models/gateways);
 *   в branch-mode вызывающий передаёт VIBELOG_CWD ?? cwd; необязателен —
 *   без него проверяется только env (старое поведение)
 * @param opts.active — VL-239: проверять КОНКРЕТНУЮ модель (модель сессии,
 *   возможно не default). Без него — прежняя валидация models.default
 * @returns true, если LLM настроен (ключ и модель заданы); false — иначе
 *   (вызывающий выставляет process.exitCode = 1 и прекращает запуск)
 */
export function ensureLlmEnv(
  subject: 'агенту' | 'чату с агентом',
  cwd?: string,
  opts?: { active?: ActiveModel },
): boolean {
  // --- VL-239: модель рана задана явно (сессия/флаг) — валидируем её -------
  // Провайдер у ActiveModel уже существует (resolve* вернули бы null иначе),
  // поэтому проверяется только ключ — но текст ошибки тот же, что у VL-209.
  if (opts?.active !== undefined) {
    if (!opts.active.apiKey) {
      console.error(
        `Ошибка: не задан API-ключ шлюза "${opts.active.gatewayId}" — ${subject} нужен доступ к LLM (env ${opts.active.apiKeyEnv ?? 'VIBELOG_LLM_API_KEY'}/.env/settings.json env-секция)`,
      );
      return false;
    }
    return true;
  }

  // --- VL-209: models-путь — валидация секций settings.json ---------------
  if (cwd !== undefined) {
    const active = resolveActiveModel(cwd);
    if (active !== null) {
      const errors = validateModelsConfig(cwd);
      for (const err of errors) console.error(`Ошибка: ${err}`);
      if (errors.length > 0) return false;
      // Ключ: validateModelsConfig уже проверил api_key_env (включая
      // provider.api_key fallback) — здесь только пустой итог на случай,
      // если провайдер вообще без api_key_env и без api_key
      if (!active.apiKey) {
        console.error(
          `Ошибка: не задан API-ключ шлюза "${active.gatewayId}" — ${subject} нужен доступ к LLM (env ${active.apiKeyEnv ?? 'VIBELOG_LLM_API_KEY'}/.env/settings.json env-секция)`
        );
        return false;
      }
      return true;
    }
    // models не настроен → СТАРОЕ поведение ниже (env VIBELOG_LLM_*)
  }

  // --- Fallback (VL-189): LLM из env VIBELOG_LLM_BASE_URL/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL
  if (!process.env.VIBELOG_LLM_API_KEY) {
    console.error(
      `Ошибка: не задан VIBELOG_LLM_API_KEY — ${subject} нужен доступ к LLM (env VIBELOG_LLM_BASE_URL/VIBELOG_LLM_API_KEY/VIBELOG_LLM_MODEL)`
    );
    return false;
  }
  if (!process.env.VIBELOG_LLM_MODEL) {
    console.error('Ошибка: не задана VIBELOG_LLM_MODEL — модель LLM неизвестна');
    return false;
  }
  return true;
}

/**
 * Читает режим LLM API (VL-205 → VL-209).
 *
 * Приоритет: активная модель из settings.json models (api_mode модели) →
 * legacy-ключ `api_mode` топ-уровня settings.json → "chat" (текущее
 * поведение). Битое/отсутствующее значение → "chat": конфиг пользователя
 * не должен ронять агента (паттерн loadSettings). Общая точка для
 * headless-CLI, TUI-чата и веб-чата (lesson-37 — дедупликация слоёв).
 *
 * @param cwd — директория проекта (в branch-mode вызывающий передаёт
 *   VIBELOG_CWD ?? cwd — settings.json живёт в главном репо, не в worktree)
 */
export function loadApiMode(cwd: string): ApiMode {
  const active = resolveActiveModel(cwd);
  if (active !== null) return active.apiMode;
  return loadSettings(cwd).api_mode === 'responses' ? 'responses' : 'chat';
}

/**
 * Формирует строку лога активной модели для stderr при старте фазы (VL-209):
 * «Модель: <label> (<id>), api_mode: <chat|responses>» — попадает в logTail
 * оркестратора. Без models — env-фолбэк с той же формой.
 *
 * @param cwd — директория проекта settings.json (VIBELOG_CWD ?? cwd)
 */
export function activeModelLogLine(cwd: string): string {
  const active = resolveActiveModel(cwd);
  if (active !== null) {
    return `Модель: ${active.label} (${active.id}), api_mode: ${active.apiMode}`;
  }
  const apiMode = loadApiMode(cwd);
  const model = process.env.VIBELOG_LLM_MODEL ?? '(не задана)';
  return `Модель: ${model} (${model}), api_mode: ${apiMode}`;
}
