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
 * models/providers (resolveActiveModel вернул конфиг) — валидируются СЕКЦИИ
 * (провайдер существует, api_key_env задан) с новыми понятными текстами.
 * Нет секции models — СТАРОЕ поведение и старые тексты дословно 1:1
 * (fallback-контракт плана VL-209: env-only пользователи не ломаются).
 */

import { loadSettings } from '../core/settings.js';
import { resolveActiveModel, validateModelsConfig } from '../core/models.js';
import type { ApiMode } from './llm.js';

/**
 * Проверяет, что LLM настроен (секции settings.json либо env-переменные);
 * при ошибке печатает понятную ошибку в stderr.
 *
 * @param subject — получатель доступа в тексте ошибки: 'агенту' (headless
 *   запуск фаз) либо 'чату с агентом' (TUI-чат) — сохраняет старые формулировки
 * @param cwd — директория проекта для чтения settings.json (models/providers);
 *   в branch-mode вызывающий передаёт VIBELOG_CWD ?? cwd; необязателен —
 *   без него проверяется только env (старое поведение)
 * @returns true, если LLM настроен (ключ и модель заданы); false — иначе
 *   (вызывающий выставляет process.exitCode = 1 и прекращает запуск)
 */
export function ensureLlmEnv(subject: 'агенту' | 'чату с агентом', cwd?: string): boolean {
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
          `Ошибка: не задан API-ключ провайдера "${active.providerId}" — ${subject} нужен доступ к LLM (env ${active.apiKeyEnv ?? 'VIBELOG_LLM_API_KEY'}/.env/settings.json env-секция)`
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
