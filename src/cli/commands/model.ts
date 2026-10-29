/**
 * Команды `vibelog model` и `vibelog provider` (VL-209).
 *
 * Управление реестром моделей/провайдеров из .vibelog/settings.json:
 * - model list — все модели с пометкой default;
 * - model use <id> — переключить default (запись в settings.json);
 * - model current — активная модель (или env-fallback VIBELOG_LLM_MODEL);
 * - provider list — провайдеры: base_url, api_key_env + статус ключа
 *   (только «задан/не задан» — значения ключей НЕ выводятся, секреты).
 *
 * Вывод — паттерн src/cli/commands/config.ts (printError/printSuccess).
 */

import { printSuccess, printError, printInfo } from '../ui.js';
import { loadSettings, saveSettingsPatch } from '../../core/settings.js';
import { loadModels, loadProviders, resolveActiveModel } from '../../core/models.js';
import type { FlagValues } from '../args.js';

/**
 * Выполняет команду model: list | use <id> | current.
 */
export async function runModel(
  subcommand: string,
  positional: string[],
  _flags: FlagValues,
  cwd: string
): Promise<void> {
  switch (subcommand) {
    case 'list':
      return modelList(cwd);
    case 'use':
      return modelUse(positional, cwd);
    case 'current':
      return modelCurrent(cwd);
    default:
      printError(`Неизвестная подкоманда: ${subcommand || '(нет)'}`);
      printInfo('Доступные: list, use <id>, current');
  }
}

/**
 * Выполняет команду provider: list.
 */
export async function runProvider(
  subcommand: string,
  _positional: string[],
  _flags: FlagValues,
  cwd: string
): Promise<void> {
  switch (subcommand) {
    case 'list':
      return providerList(cwd);
    default:
      printError(`Неизвестная подкоманда: ${subcommand || '(нет)'}`);
      printInfo('Доступные: list');
  }
}

/** model list: маркер * у default, id, label, provider, api_mode. */
function modelList(cwd: string): void {
  const models = loadModels(cwd);
  const ids = Object.keys(models.available);
  if (ids.length === 0) {
    printInfo('Модели не настроены: секция models отсутствует в .vibelog/settings.json');
    printInfo('Используется env VIBELOG_LLM_MODEL (fallback)');
    return;
  }
  console.log('');
  for (const id of ids) {
    const m = models.available[id];
    const marker = id === models.default ? '* ' : '  ';
    const label = m.label ? ` — ${m.label}` : '';
    console.log(`${marker}${id}${label} (provider: ${m.provider}, api_mode: ${m.api_mode ?? 'chat'})`);
  }
  console.log('');
  printInfo(`* — активная модель (models.default)`);
}

/** model use <id>: валидация id → запись models.default в settings.json. */
function modelUse(positional: string[], cwd: string): void {
  const id = positional[0];
  if (!id) {
    printError('Использование: vibelog model use <id>');
    return;
  }
  const settings = loadSettings(cwd);
  const models = loadModels(cwd);
  if (!models.available[id]) {
    printError(`Неизвестная модель: ${id}`);
    printInfo(`Доступные: ${Object.keys(models.available).join(', ') || '(нет)'}`);
    return;
  }
  // Read-modify-write через saveSettingsPatch: сохраняем providers/available,
  // env-секцию и прочие ключи — меняем только models.default
  const currentModels = (settings.models ?? {}) as Record<string, unknown>;
  saveSettingsPatch(cwd, { models: { ...currentModels, default: id } });
  printSuccess(`Активная модель: ${models.available[id].label ?? id} (${id})`);
}

/** model current: активная модель либо env-fallback. */
function modelCurrent(cwd: string): void {
  const active = resolveActiveModel(cwd);
  if (active !== null) {
    console.log(`${active.id} — ${active.label} (api_mode: ${active.apiMode}, provider: ${active.providerId})`);
    return;
  }
  const envModel = process.env.VIBELOG_LLM_MODEL;
  if (envModel) {
    printInfo(`Модель из VIBELOG_LLM_MODEL: ${envModel} (секция models не настроена)`);
    return;
  }
  printError('Модель не задана: ни models.default в settings.json, ни env VIBELOG_LLM_MODEL');
}

/** provider list: id, base_url, api_key_env + статус ключа (без значений). */
function providerList(cwd: string): void {
  const providers = loadProviders(cwd);
  const ids = Object.keys(providers);
  if (ids.length === 0) {
    printInfo('Провайдеры не настроены: секция providers отсутствует в .vibelog/settings.json');
    return;
  }
  console.log('');
  for (const id of ids) {
    const p = providers[id];
    // Статус ключа — только факт: значения env/api_key в вывод не попадают
    const keySet = (p.api_key_env && process.env[p.api_key_env]) || p.api_key;
    const keyStatus = keySet ? 'задан' : 'НЕ ЗАДАН';
    const keySrc = p.api_key_env ? `env ${p.api_key_env}` : p.api_key ? 'api_key (прямой)' : 'нет источника';
    console.log(`  ${id}: ${p.base_url} (${keySrc}, ключ: ${keyStatus})`);
  }
}
