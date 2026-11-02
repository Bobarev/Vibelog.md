/**
 * Классификация MCP-инструментов read/write по природе операции (VL-219, VL-306).
 *
 * Модуль вынесен из `src/web/tool-policy.ts` в core, потому что классификатор
 * нужен ДВУМ слоям: веб-чату (approval-gate: write требует Allow/Deny) и
 * агентскому циклу (`src/agent/loop.ts`, VL-306: страховка `appliedSignatures`
 * для write-инструментов, чей ответ пришёл не-JSON). Импортировать веб-слой
 * из агентского цикла нельзя — `src/web/tool-policy.ts` тянет `listTools()`
 * из `src/mcp/tools.ts` и файловые хелперы агента; копия логики разъехалась бы
 * (lesson-37: общий модуль вместо копий). `src/web/tool-policy.ts` реэкспортирует
 * `isWriteOperation` — публичный API веб-слоя не изменился.
 *
 * Классификация — по СЕМАНТИКЕ ИМЕНИ, а не по жёсткому списку: write = есть
 * побочный эффект (изменяет файловую систему/данные backlog/settings).
 * Неизвестное имя → write (fail-safe: подтверждение лучше молчаливой записи).
 */

/**
 * Маркеры write-операции в имени инструмента (природа операции: есть
 * побочный эффект). Проверяются по токенам имени (split по не-буквам),
 * поэтому `backlog_manage_ac` матчит `manage`, `reference_link` — `link`.
 */
const WRITE_MARKERS = [
  'create', 'update', 'add', 'remove', 'rename', 'archive',
  'manage', 'finish', 'supersede', 'link', 'sync', 'cache',
  'write', 'edit', 'delete', 'set', 'put', 'run', 'spawn',
  'promote', 'reject', 'complete', 'append', 'mkdir',
  // VL-268: запуск фаз/очереди/прогона — побочный эффект по природе
  'trigger', 'start', 'stop', 'queue',
] as const;

/**
 * Маркеры read-операции в имени инструмента. Проверяются ПОСЛЕ write —
 * если в имени оба (теоретически), write приоритетнее (безопаснее).
 */
const READ_MARKERS = [
  'list', 'view', 'search', 'get', 'read', 'ready', 'glob', 'grep', 'help', 'map',
  // VL-268: состояние запуска фазы — чистый read
  'status',
  // VL-279: lesson_audit — по умолчанию read-only (записи только при явных
  // verified/needsReview); природа по умолчанию — чтение отчёта
  'audit',
  // VL-280: lesson_classify — тоже отчёт по умолчанию (kind пишется только
  // при apply/confirmIds, задачи — только по createClusters)
  'classify',
] as const;

/** Токенизует имя инструмента: lowercase + split по не-буквенно-цифровым. */
function tokenize(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Классифицирует операцию: true — write (нужно подтверждение Allow/Deny),
 * false — read (исполняется сразу). Побочный эффект — свойство операции,
 * не аргументов. Фолбэк для неизвестных имён — write (fail-safe: защита от
 * молчаливой записи; новые MCP-инструменты подключаются без правки
 * инструкции чата — их классификация выводится из имени).
 *
 * @param name — имя инструмента (MCP-реестр или локальный файловый)
 */
export function isWriteOperation(name: string): boolean {
  const tokens = tokenize(name);
  // Локальные файловые инструменты агента — явная ветка (ясность + не
  // зависит от порядка маркеров)
  if (tokens.includes('write') || tokens.includes('edit') || tokens.includes('run')) return true;
  if (tokens.includes('read') || tokens.includes('grep') || tokens.includes('glob')) return false;
  if (tokens.some(t => WRITE_MARKERS.includes(t as (typeof WRITE_MARKERS)[number]))) return true;
  if (tokens.some(t => READ_MARKERS.includes(t as (typeof READ_MARKERS)[number]))) return false;
  // Неизвестное имя → write (fail-safe)
  return true;
}
