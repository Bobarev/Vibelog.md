/**
 * Настройка MCP-сервера Vibelog в конфигах внешних агентов (VL-210).
 *
 * Вынесено из `vibelog init` (VL-6), чтобы ту же логику использовали
 * консольный wizard и web `/setup`: раньше функция жила приватно в
 * src/cli/commands/init.ts, и второй вызывающий неизбежно скопировал бы
 * merge-семантику (потеря чужих ключей settings.json — регрессия VL-6).
 *
 * Merge, а не replace: чужие ключи (ui, $version, другие mcpServers)
 * сохраняются. Битый JSON не роняет вызывающего — попадает в skipped.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Агенты, для которых поддерживается MCP-конфиг. */
export type McpTarget = 'qwen' | 'opencode';

/** Каталог конфига агента в корне проекта. */
const TARGET_DIRS: Record<McpTarget, string> = {
  qwen: '.qwen',
  opencode: '.opencode',
};

/** Секция mcpServers.vibelog, которую пишет wizard. */
const VIBELOG_MCP_ENTRY = {
  command: 'vibelog',
  args: ['mcp', 'start'],
  trust: true,
};

/** Результат настройки: что записано, что пропущено и почему. */
export interface McpSetupResult {
  written: string[];
  skipped: string[];
  warnings: string[];
}

/**
 * Проверяет, настроен ли уже vibelog MCP в конфиге агента.
 *
 * @param cwd — директория проекта
 * @param target — qwen | opencode
 * @returns true, если mcpServers.vibelog присутствует
 */
export function hasVibelogMcp(cwd: string, target: McpTarget): boolean {
  const path = join(cwd, TARGET_DIRS[target], 'settings.json');
  if (!existsSync(path)) return false;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const servers = parsed?.mcpServers;
    if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) return false;
    return (servers as Record<string, unknown>).vibelog !== undefined;
  } catch {
    return false;
  }
}

/**
 * Записывает mcpServers.vibelog в конфиги указанных агентов.
 *
 * @param cwd — директория проекта
 * @param targets — агенты, чьи конфиги обновляем (пустой список → ничего)
 * @param opts.force — перезаписать существующую секцию vibelog
 * @returns written/skipped/warnings (пути и причины, без секретов)
 */
export function setupMcp(
  cwd: string,
  targets: McpTarget[],
  opts: { force?: boolean } = {},
): McpSetupResult {
  const result: McpSetupResult = { written: [], skipped: [], warnings: [] };

  for (const target of targets) {
    const dir = join(cwd, TARGET_DIRS[target]);
    const settingsPath = join(dir, 'settings.json');
    const relPath = `${TARGET_DIRS[target]}/settings.json`;

    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try {
        const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          settings = parsed as Record<string, unknown>;
        }
      } catch {
        // Битый JSON не роняем: сообщаем и идём дальше (поведение VL-6)
        result.warnings.push(`Не удалось разобрать ${relPath} (некорректный JSON). MCP-секция не добавлена.`);
        result.skipped.push(relPath);
        continue;
      }
    }

    if (!settings.mcpServers || typeof settings.mcpServers !== 'object' || Array.isArray(settings.mcpServers)) {
      settings.mcpServers = {};
    }
    const servers = settings.mcpServers as Record<string, unknown>;
    if (servers.vibelog !== undefined && !opts.force) {
      result.skipped.push(`${relPath} (mcpServers.vibelog уже настроен)`);
      continue;
    }
    servers.vibelog = { ...VIBELOG_MCP_ENTRY };

    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');
    result.written.push(relPath);
  }

  return result;
}
