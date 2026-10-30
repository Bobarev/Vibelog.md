/**
 * Host-биндинг веб-сервера (VL-266): какой адрес слушать и какие URL печатать.
 *
 * По умолчанию сервер слушает только loopback (127.0.0.1) — доска открыта
 * лишь на этой машине. Для доступа из локальной сети пользователь передаёт
 * `--host 0.0.0.0` (либо настройку `web_host` в `.vibelog/settings.json`).
 *
 * Модуль намеренно содержит только чистые функции: разбор адресов
 * (os.networkInterfaces) и сборка URL/строк вывода. Так их можно покрыть
 * тестами без поднятия сети, а `server.ts` остаётся тонкой обвязкой.
 */

import { networkInterfaces } from 'node:os';

/** Хост по умолчанию: только loopback (безопасный дефолт, AC1). */
export const DEFAULT_WEB_HOST = '127.0.0.1';

/**
 * «Слушать все интерфейсы»? 0.0.0.0 — IPv4 wildcard, :: — IPv6/dual-stack,
 * пустая строка — то же самое по семантике node:net.
 */
export function isWildcardHost(host: string): boolean {
  const h = host.trim();
  return h === '0.0.0.0' || h === '::' || h === '';
}

/**
 * IPv4-адреса машины в локальной сети (не internal, без дублей).
 *
 * Зачем только IPv4: 0.0.0.0 — IPv4-wildcard, и пользователю в консоли нужен
 * адрес, который набирается с телефона/ноутбука без скобок. Несколько
 * адресов (Wi-Fi + VPN + docker bridge) печатаем все — пусть пользователь
 * выберет подходящий; дедуп защищает от повторов одного адреса на разных
 * интерфейсах.
 */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      // family в старых Node — строка 'IPv4', в новых — число 4 (Node 18+)
      const isV4 = info.family === 'IPv4' || (info.family as unknown) === 4;
      if (!isV4 || info.internal) continue;
      if (!out.includes(info.address)) out.push(info.address);
    }
  }
  return out;
}

/** Оборачивает IPv6-литерал в скобки — иначе URL `http://fe80::1:3030` невалиден. */
function hostForUrl(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

/**
 * URL, которые имеет смысл показать после старта.
 *
 * - wildcard-хост: `local` — loopback (по нему открывается браузер на этой
 *   машине; `open http://0.0.0.0:…` не работает), `lan` — адреса машины;
 * - конкретный адрес: `local` — сам адрес, `lan` пуст (пользователь явно
 *   выбрал интерфейс — печатать чужие адреса было бы шумом).
 *
 * @param addresses — адреса для LAN-строк (обычно результат lanAddresses());
 *   передаётся параметром, чтобы тесты не зависели от сети машины
 */
export function startupUrls(
  host: string,
  port: number,
  addresses: string[],
): { local: string; lan: string[] } {
  if (!isWildcardHost(host)) {
    return { local: `http://${hostForUrl(host)}:${port}`, lan: [] };
  }
  return {
    local: `http://${DEFAULT_WEB_HOST}:${port}`,
    lan: addresses.map(ip => `http://${hostForUrl(ip)}:${port}`),
  };
}

/**
 * Строки вывода при старте сервера.
 *
 * ВАЖНО: первая строка — строго `Веб-интерфейс Vibelog.md: <local>`.
 * Фаза `/web start` бота (VL-161) парсит её регуляркой
 * `/Веб-интерфейс Vibelog\.md:\s*(\S+)/` и присылает URL в чат; смена
 * формата сломала бы команду. LAN-адреса идут отдельными строками с другим
 * префиксом — парсер их не зацепит.
 */
export function startupLines(host: string, port: number, addresses: string[]): string[] {
  const { local, lan } = startupUrls(host, port, addresses);
  const lines = [`Веб-интерфейс Vibelog.md: ${local}`];
  for (const url of lan) lines.push(`Доступ из локальной сети: ${url}`);
  return lines;
}

/**
 * Приоритетный резолв хоста: флаг `--host` → настройка `web_host` → дефолт.
 *
 * Битые значения настройки (не строка, пустая строка) игнорируются: файл
 * `.vibelog/settings.json` правит пользователь руками, и опечатка не должна
 * ронять запуск доски (тот же принцип, что у loadSettings → {}).
 */
export function resolveWebHost(
  flags: Record<string, unknown>,
  settings: Record<string, unknown>,
): string {
  const fromFlag = flags.host;
  if (typeof fromFlag === 'string' && fromFlag.trim() !== '') return fromFlag.trim();
  // array — повтор флага (--host a --host b): берём первый, как getFlag
  if (Array.isArray(fromFlag) && typeof fromFlag[0] === 'string' && fromFlag[0].trim() !== '') {
    return fromFlag[0].trim();
  }
  const fromSettings = settings.web_host;
  if (typeof fromSettings === 'string' && fromSettings.trim() !== '') return fromSettings.trim();
  return DEFAULT_WEB_HOST;
}
