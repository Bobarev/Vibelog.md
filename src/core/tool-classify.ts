/**
 * Классификация инструментов read/write по ОБЪЯВЛЕННОМУ виду (VL-219, VL-306, VL-357).
 *
 * Модуль вынесен из `src/web/tool-policy.ts` в core, потому что классификатор
 * нужен ДВУМ слоям: веб-чату (approval-gate: write требует Allow/Deny) и
 * агентскому циклу (`src/agent/loop.ts`). Импортировать веб-слой из
 * агентского цикла нельзя — `src/web/tool-policy.ts` тянет `listTools()`
 * из `src/mcp/tools.ts` и файловые хелперы агента; копия логики разъехалась бы
 * (lesson-37: общий модуль вместо копий). `src/web/tool-policy.ts` реэкспортирует
 * `isWriteOperation` — публичный API веб-слоя не изменился.
 *
 * VL-357: классификация — по ДЕКЛАРАЦИИ (`src/core/tool-kinds.ts`), а не по
 * токенам имени. Маркеры (`manage` → write) ошибались по построению: чтение
 * внутри write-инструмента (`backlog_manage_dod {action:'list'}`) считалось
 * записью, веб-чат требовал на него Allow/Deny, а цикл агента помечал повтор
 * «уже применённой записью» (VL-351). Новый инструмент обязан объявить вид;
 * `tool-classify.test.mjs` сверяет таблицу с реестром и падает, если строки нет.
 */

import { toolKindOf } from './tool-kinds.js';

/**
 * Вид операции, объявленный инструментом (VL-357).
 *
 * - `read` — без побочных эффектов;
 * - `write` — изменяет состояние;
 * - `mixed` — зависит от аргументов: часть действий читает, часть пишет
 *   (`backlog_manage_*`); без аргументов трактуется как write (fail-safe).
 */
export type ToolKind = 'read' | 'write' | 'mixed';

/**
 * Действия `mixed`-инструментов, которые НИЧЕГО не пишут (VL-357).
 *
 * Ключ — имя инструмента, значение — действия-чтения. Список общий для всех
 * `manage_*`: `action: 'list'` — снимок чеклиста, эффекта нет.
 */
const MIXED_READ_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  backlog_manage_ac: ['list'],
  backlog_manage_dod: ['list'],
};

/**
 * Интерактивные инструменты (VL-330): вызов НЕ исполняется сервером, а ставит
 * ход на паузу до ответа пользователя (веб-чат: карточка вопроса).
 *
 * Отдельная категория, а не read/write: `ask_user` не имеет побочного эффекта
 * (значит, не write — иначе карточка вопроса попала бы под Allow/Deny и
 * allow-list «Always allow», что бессмысленно: вопрос нельзя разрешить
 * заранее), но и не read (сервер ничего не читает — он ждёт человека).
 */
const INTERACTIVE_TOOLS: ReadonlySet<string> = new Set(['ask_user']);

/**
 * Вид локальных файловых инструментов агента (VL-357, VL-359).
 *
 * Они не входят в MCP-реестр (`listTools()`), поэтому не могут объявить вид
 * там же и описаны отдельной таблицей. До VL-357 это делали маркеры имени
 * (`read`/`write`/`edit`/`run`) — маркеры удалены, потому что ошибались на
 * любом новом имени с посторонним токеном.
 *
 * VL-359: таблица — ФОЛБЭК, а не единственный источник. Настоящее объявление
 * живёт рядом с инструментом (`ToolSpec.kind` в `src/agent/tools.ts`), и
 * реестр регистрирует его через `registerLocalToolKinds`. Таблица остаётся
 * для путей, где реестр не собран (тесты классификатора, веб-слой до первого
 * `listLocalTools`), и тест паритета (`tool-classify.test.mjs`) сверяет её с
 * `ToolSpec.kind` — расхождение валит сборку.
 */
export const LOCAL_TOOL_KINDS: Readonly<Record<string, ToolKind>> = {
  read_file: 'read',
  write_file: 'write',
  edit: 'write',
  run_shell_command: 'write',
  grep_search: 'read',
  glob: 'read',
  search_files: 'read',
  agent_session_outline: 'read',
};

/**
 * Резолвер вида локальных инструментов, зарегистрированный реестром (VL-359).
 *
 * Зачем колбэк, а не импорт: `src/core/tool-classify.ts` не может тянуть
 * `src/agent/tools.ts` (там fs, llm, оркестратор — core не должен зависеть от
 * агентского слоя, это записано в шапке модуля). Реестр сам сообщает
 * классификатору свой набор видов при сборке.
 *
 * Состояние модуля: последний вызов `registerLocalToolKinds` перезаписывает
 * предыдущий. Это безопасно, потому что набор инструментов у всех вызовов
 * `listLocalTools` одинаковый (различается только cwd, а вид от cwd не
 * зависит) — резолвер идемпотентен по набору.
 */
let localKindResolver: ((name: string) => ToolKind | undefined) | null = null;

/**
 * Регистрирует резолвер вида локальных инструментов (VL-359).
 *
 * Вызывается реестром (`listLocalTools` в `src/agent/tools.ts`) при сборке:
 * вид объявлен рядом с инструментом (`ToolSpec.kind`), а классификатор
 * получает его отсюда. Без регистрации действует фолбэк `LOCAL_TOOL_KINDS`.
 *
 * @param fn — функция «имя → объявленный вид» (undefined — имя не из реестра)
 */
export function registerLocalToolKinds(fn: (name: string) => ToolKind | undefined): void {
  localKindResolver = fn;
}

/**
 * Интерактивный ли инструмент: вызов = пауза хода, а не исполнение.
 *
 * @param name — имя инструмента (MCP-реестр или локальный файловый)
 */
export function isInteractiveTool(name: string): boolean {
  return INTERACTIVE_TOOLS.has(name);
}

/**
 * Объявленный вид инструмента.
 *
 * VL-359: три источника в порядке приоритета — реестр MCP (`TOOL_KINDS`),
 * резолвер локального реестра (`ToolSpec.kind`, регистрируется из
 * `src/agent/tools.ts`) и фолбэк-таблица `LOCAL_TOOL_KINDS`. До VL-359 поле
 * `ToolSpec.kind` заполнялось, но не читалось: одни и те же 8 инструментов
 * были объявлены дважды, и новый локальный инструмент с `kind: 'read'` без
 * строки в таблице молча классифицировался как write.
 *
 * @param name — имя инструмента (MCP-реестр или локальный файловый)
 * @returns вид либо `undefined` — имя не объявлено (внешний MCP-сервер,
 *   новое имя до декларации)
 */
export function declaredToolKind(name: string): ToolKind | undefined {
  return toolKindOf(name) ?? localKindResolver?.(name) ?? LOCAL_TOOL_KINDS[name];
}

/**
 * Классифицирует операцию: true — write (нужно подтверждение Allow/Deny),
 * false — read (исполняется сразу).
 *
 * VL-357: вид читается из декларации (`TOOL_KINDS`/`LOCAL_TOOL_KINDS`), а не
 * выводится из токенов имени. `mixed` разрешается по аргументам: действие из
 * `MIXED_READ_ACTIONS` — read, любое другое — write. Без аргументов
 * `mixed`-инструмент считается write (fail-safe: подтверждение лучше
 * молчаливой записи). Неизвестное имя → write (тот же fail-safe).
 *
 * @param name — имя инструмента (MCP-реестр или локальный файловый)
 * @param args — аргументы вызова (нужны только `mixed`-инструментам)
 */
export function isWriteOperation(name: string, args?: Record<string, unknown>): boolean {
  // VL-330: интерактивный инструмент (ask_user) — не write: пауза хода, а не
  // побочный эффект. Проверяется ДО декларации и до fail-safe.
  if (isInteractiveTool(name)) return false;
  const kind = declaredToolKind(name);
  if (kind === 'read') return false;
  if (kind === 'write') return true;
  if (kind === 'mixed') {
    const action = args?.action;
    if (typeof action !== 'string') return true; // без аргументов — write
    const readActions = MIXED_READ_ACTIONS[name] ?? [];
    return !readActions.includes(action);
  }
  // Неизвестное имя → write (fail-safe)
  return true;
}
