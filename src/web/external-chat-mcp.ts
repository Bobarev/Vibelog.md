/**
 * Кэш внешних MCP-серверов веб-чата (VL-422).
 *
 * Агентские пути (interactive.ts, cli.ts) подключают секцию `mcpServers`
 * .vibelog/settings.json eagerly при старте; веб-процесс — нет: соединение
 * поднимается ТОЛЬКО слэш-командой `/mcp on` (решение пользователя: не
 * лениво по роли, не eager при старте). Список инструментов известен только
 * после handshake — «по первому вызову инструмента» поднять соединение
 * нельзя (MCP chicken-and-egg), поэтому команда печатает человек.
 *
 * Состояние — процессный Map<cwd, состояние> с refcount: браузер и его
 * state живут в процессе сервера, поэтому соединение одно на процесс, а не
 * per-тред. Каждый тред с `/mcp on` держит единицу refcount, `/mcp off`
 * снимает СВОЮ единицу; на нуле клиенты закрываются (close идемпотентен).
 *
 * Ключ Map — cwd проекта: два проекта в одном процессе изолированы. Проект
 * без mcpServers ничего не платит: `connectExternalForChat` отвечает
 * ошибкой ДО спавна процессов серверов.
 *
 * Известное ограничение (осознанное): флаг треда живёт на диске
 * (<threadId>.persona.json), а refcount — в процессе. После перезапуска
 * веб-сервера у тредов остаётся флаг true, но соединения нет; повторный
 * `/mcp on` в таком треде проходит guard по «флаг И состояние в Map» и
 * поднимает соединение заново, а `/mcp off` снимает флаг (release по
 * отсутствующему состоянию — no-op).
 */

import { closeExternalMcpClients, connectExternalMcpServers, loadExternalMcpServers } from '../agent/external-mcp.js';
import type { McpClient } from '../agent/mcp-client.js';
import type { ToolSpec } from '../agent/tools.js';

/** Состояние кэша одного проекта: клиенты, их инструменты и refcount тредов. */
export interface ExternalChatMcpState {
  /** Подключённые клиенты (закрываются единым циклом при refcount 0). */
  clients: McpClient[];
  /** Спецификации инструментов всех клиентов (с префиксами серверов). */
  specs: ToolSpec[];
  /** Сколько тредов держат соединение (каждый `/mcp on` — единица). */
  refcount: number;
}

/** Результат подключения: счётчики либо причина отказа (без спавна). */
export type ExternalChatConnectResult = { connected: number; tools: number } | { error: string };

/** Вид для `/mcp status`: счётчики без утечки клиентов наружу. */
export interface ExternalChatMcpStatus {
  connected: number;
  tools: number;
  refcount: number;
}

/** Процессный кэш: cwd проекта → состояние (изоляция проектов, см. шапку). */
const states = new Map<string, ExternalChatMcpState>();

/**
 * Идущее подключение по cwd: защита от двойного спавна, если два треда
 * одновременно шлют `/mcp on` до записи состояния (команды разных тредов
 * не блокируют друг друга — commandRefusal проверяет только свой тред).
 */
const connecting = new Map<string, Promise<{ connected: number; tools: number }>>();

/**
 * Каталог чтения конфига: тот же резолв, что у `connectExternalMcpServers`
 * (VL-167: в branch-mode настройки читаются из главного репо по
 * VIBELOG_CWD, а спавн идёт в cwd). Гейт «серверы настроены?» обязан
 * смотреть туда же, куда само подключение, — иначе гейт и спавн разойдутся.
 */
function settingsCwd(cwd: string): string {
  return process.env.VIBELOG_CWD ?? cwd;
}

/**
 * Подключить внешние серверы для веб-чата (команда `/mcp on`).
 *
 * Порядок: гейт по конфигу (пусто → ошибка, БЕЗ спавна) → уже подключено
 * (refcount++) → идущее подключение (ждём, потом refcount++) → спавн +
 * handshake через `connectExternalMcpServers` (там fail-safe: битый сервер —
 * warning, остальные подключаются).
 *
 * Состояние записывается даже при пустом результате (все серверы отказали):
 * иначе повторный `/mcp on` стал бы поднимать соединение заново поверх
 * несуществующего, а `/mcp status` честно покажет «серверов 0».
 */
export async function connectExternalForChat(cwd: string): Promise<ExternalChatConnectResult> {
  if (loadExternalMcpServers(settingsCwd(cwd)).length === 0) {
    return { error: 'внешние серверы не настроены' };
  }
  const existing = states.get(cwd);
  if (existing !== undefined) {
    existing.refcount += 1;
    return { connected: existing.clients.length, tools: existing.specs.length };
  }
  const inFlight = connecting.get(cwd);
  if (inFlight !== undefined) {
    const result = await inFlight;
    // Владелец уже записал состояние в map — держим свою единицу refcount
    const st = states.get(cwd);
    if (st !== undefined) st.refcount += 1;
    return result;
  }
  const task = (async (): Promise<{ connected: number; tools: number }> => {
    const { clients, specs } = await connectExternalMcpServers(cwd);
    states.set(cwd, { clients, specs, refcount: 1 });
    return { connected: clients.length, tools: specs.length };
  })();
  connecting.set(cwd, task);
  try {
    return await task;
  } finally {
    connecting.delete(cwd);
  }
}

/**
 * Снять единицу refcount треда (`/mcp off`).
 *
 * На нуле: состояние удаляется ДО закрытия — новый `/mcp on` параллельно
 * поднимет свежее соединение, не дожидаясь close старых клиентов.
 * Вызов без состояния (рестарт, повторный off) — no-op.
 */
export async function releaseExternalForChat(cwd: string): Promise<void> {
  const st = states.get(cwd);
  if (st === undefined) return;
  st.refcount -= 1;
  if (st.refcount > 0) return;
  st.refcount = 0;
  states.delete(cwd);
  await closeExternalMcpClients(st.clients);
}

/**
 * Синхронный доступ к спецификациям для `chatToolDefs` (chat.ts).
 * Пусто, если соединение не поднималось — вызывающий сам решает, показывать
 * ли внешние инструменты (флаг треда `/mcp on`).
 */
export function getExternalSpecs(cwd: string): ToolSpec[] {
  return states.get(cwd)?.specs ?? [];
}

/** Счётчики для `/mcp status`; null — проект не подключён в этом процессе. */
export function externalChatMcpStatus(cwd: string): ExternalChatMcpStatus | null {
  const st = states.get(cwd);
  if (st === undefined) return null;
  return { connected: st.clients.length, tools: st.specs.length, refcount: st.refcount };
}

/**
 * Дренаж всего кэша: остановка веб-сервера (server.on('close') в server.ts)
 * закрывает все внешние клиенты — процессы серверов не переживают доску.
 * Карта чистится синхронно до первого await, поэтому после ВЫЗОВА функции
 * статус уже null, даже пока клиенты ещё закрываются.
 */
export async function shutdownExternalChatMcp(): Promise<void> {
  const all = [...states.values()];
  states.clear();
  connecting.clear();
  await Promise.all(all.map((st) => closeExternalMcpClients(st.clients)));
}
