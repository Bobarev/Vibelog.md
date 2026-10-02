/**
 * Автор комментариев из git config (VL-35).
 *
 * Однопользовательская система Vibelog: привязанный Telegram-чат и CLI
 * принадлежат одному пользователю — автор комментариев берётся из
 * git config user.name проекта (решение Pavel 2026-10-02).
 */

import { spawnSync } from 'node:child_process';

/**
 * Возвращает user.name из git config проекта.
 *
 * Читает локальный конфиг репозитория (приоритет) с каскадом на
 * глобальный — как обычный `git config user.name`. Если git недоступен
 * или имя не задан — '@agent' (дефолт CLI).
 *
 * @param cwd — директория проекта (git-репозиторий)
 * @param env — окружение для запуска git (в тестах — изоляция от глобального конфига)
 */
export function getGitUserName(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  try {
    const res = spawnSync('git', ['config', 'user.name'], { cwd, encoding: 'utf-8', env });
    const name = (res.stdout || '').trim();
    return name || '@agent';
  } catch {
    return '@agent';
  }
}
