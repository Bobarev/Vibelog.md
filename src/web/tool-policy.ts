/**
 * Политика инструментов веб-чата (VL-219).
 *
 * Три ответственности:
 * 1. `isWriteOperation(name)` — классификация операции read/write ПО ПРИРОДЕ
 *    операции, а не по жёсткому списку имён: write = есть побочный эффект
 *    (изменяет файловую систему/данные backlog/settings). Семантика имени —
 *    маркер природы; неизвестное имя → write (fail-safe: подтверждение лучше
 *    молчаливой записи; чисто-чтальный будущий инструмент получает read,
 *    если его имя начинается с read-глагола — без правки инструкции чата).
 * 2. `chatToolDefs()` — инструменты модели: ВСЕ из MCP-реестра listTools()
 *    (минус CHAT_DISALLOWED_TOOLS — технический запрет destructive-операций,
 *    вариант (c) плана VL-219) + локальные read_file/write_file.
 * 3. `loadChatSystemTemplate(cwd)` — статическая часть системного промпта
 *    чата: переопределение проектом .vibelog/prompts/chat-system.md →
 *    встроенный templates/prompts/chat-system.md, иначе fail-closed throw
 *    (зеркало loadPhaseTemplate VL-188). Динамический контекст globalSearch
 *    остаётся в buildSystemPrompt (src/web/chat.ts), поверх шаблона.
 *
 * Handler'ы read_file/write_file переиспользуют resolveInProject из
 * src/agent/tools.ts (границы проекта) и truncateToolOutput (единая точка
 * капа вывода, lesson-30). read_file исполняется без подтверждения
 * (isWriteOperation('read_file') === false); write_file — только через
 * approval-gate (isWriteOperation('write_file') === true).
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDef } from '../agent/llm.js';
import { resolveInProject, truncateToolOutput } from '../agent/tools.js';
import { listTools } from '../mcp/tools.js';

/** Локальный инструмент чата: ToolDef + handler (ToolDef из llm.ts без handler — wire-описание). */
export interface ChatLocalTool extends ToolDef {
  handler: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * Запрещённые в чате инструменты (VL-219, вариант (c) гибрид):
 * - backlog_finish_phase — атомарно меняет статус + токены, побочный эффект
 *   фазового workflow не откатится решением в чате (фазы запускает
 *   оркестратор, не чат);
 * - reference_sync — сетевые запросы и клонирование, выход за пределы
 *   проекта (нарушение границы доступа);
 * - milestone_remove — необратимая переназначка/очистка задач вехи.
 * Модель этих имён не видит вообще (технический фильтр надёжнее инструкции).
 * Остальные destructive-операции обратимы и уже покрыты approval.
 */
export const CHAT_DISALLOWED_TOOLS: readonly string[] = [
  'backlog_finish_phase',
  'reference_sync',
  'milestone_remove',
];

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
] as const;

/**
 * Маркеры read-операции в имени инструмента. Проверяются ПОСЛЕ write —
 * если в имени оба (теоретически), write приоритетнее (безопаснее).
 */
const READ_MARKERS = [
  'list', 'view', 'search', 'get', 'read', 'ready', 'glob', 'grep', 'help',
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

/**
 * Инструмент read_file чата: чтение файла проекта БЕЗ подтверждения
 * (isWriteOperation('read_file') === false). Путь + опциональный диапазон
 * строк (offset 0-based, limit). Границы проекта — resolveInProject;
 * вывод — truncateToolOutput (единая точка капа, lesson-30).
 */
export function makeReadFileTool(cwd: string): ChatLocalTool {
  return {
    name: 'read_file',
    description:
      'Читает текстовый файл проекта БЕЗ подтверждения пользователя. ' +
      'offset — 0-based номер строки начала, limit — максимум строк. ' +
      'Доступ только в пределах директории проекта.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Путь к файлу относительно корня проекта' },
        offset: { type: 'number', description: '0-based номер строки начала' },
        limit: { type: 'number', description: 'Максимум возвращаемых строк' },
      },
      required: ['path'],
    },
    handler: async (args: Record<string, unknown>): Promise<string> => {
      const target = resolveInProject(cwd, args.path as string);
      if (!target.ok) return target.error;
      let content: string;
      try {
        if (!existsSync(target.path)) return `Файл не найден: ${target.path}`;
        if (statSync(target.path).isDirectory()) return `Это директория, не файл: ${target.path}`;
        content = readFileSync(target.path, 'utf8');
      } catch (err) {
        return `Не удалось прочитать файл: ${err instanceof Error ? err.message : String(err)}`;
      }
      const lines = content.split('\n');
      const offset =
        typeof args.offset === 'number' && args.offset >= 0 ? Math.floor(args.offset) : 0;
      const limit =
        typeof args.limit === 'number' && args.limit > 0
          ? Math.floor(args.limit)
          : lines.length;
      return truncateToolOutput(lines.slice(offset, offset + limit).join('\n'));
    },
  };
}

/**
 * Инструмент write_file чата: запись файла проекта С обязательным
 * подтверждением (isWriteOperation('write_file') === true → approval-gate
 * в chat.ts: диалог приостанавливается, Allow/Deny). mkdir -p родительской
 * директории, utf-8. Границы проекта — resolveInProject.
 */
export function makeWriteFileTool(cwd: string): ChatLocalTool {
  return {
    name: 'write_file',
    description:
      'Создаёт или перезаписывает файл внутри проекта (родительские директории создаются). ' +
      'ВЫПОЛНЯЕТСЯ ТОЛЬКО С ПОДТВЕРЖДЕНИЯ ПОЛЬЗОВАТЕЛЯ (Allow/Deny): вызов приостанавливает диалог. ' +
      'Доступ только в пределах директории проекта. ' +
      'Задачи/lessons/references/documents — через MCP-инструменты, не через write_file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Путь к файлу относительно корня проекта' },
        content: { type: 'string', description: 'Содержимое файла' },
      },
      required: ['path', 'content'],
    },
    handler: async (args: Record<string, unknown>): Promise<string> => {
      const target = resolveInProject(cwd, args.path as string);
      if (!target.ok) return target.error;
      try {
        mkdirSync(dirname(target.path), { recursive: true });
        writeFileSync(target.path, args.content as string, 'utf8');
        return `Файл записан: ${relative(cwd, target.path)} (${Buffer.byteLength(args.content as string, 'utf8')} байт)`;
      } catch (err) {
        return `Не удалось записать файл: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/**
 * Инструменты модели чата: все MCP-инструменты (кроме
 * CHAT_DISALLOWED_TOOLS) + локальные read_file/write_file. Схемы
 * совпадают с реестром listTools() — дублирования нет (Р2 плана VL-219).
 */
export function chatToolDefs(cwd: string): (ToolDef | ChatLocalTool)[] {
  const defs: (ToolDef | ChatLocalTool)[] = listTools()
    .filter(t => !CHAT_DISALLOWED_TOOLS.includes(t.name))
    .map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  defs.push(makeReadFileTool(cwd), makeWriteFileTool(cwd));
  return defs;
}

/** Путь к встроенному шаблону (dist/web/tool-policy.js → ../../templates/prompts/). */
const bundledTemplatePath = fileURLToPath(
  new URL('../../templates/prompts/chat-system.md', import.meta.url),
);

/** Переопределение проектом (VL-188-схема), относительно cwd. */
export const PROJECT_CHAT_SYSTEM_PATH = join('.vibelog', 'prompts', 'chat-system.md');

/**
 * Читает статическую часть системного промпта чата с переопределением
 * проектом: сначала <cwd>/.vibelog/prompts/chat-system.md, затем
 * templates/prompts/chat-system.md; оба отсутствуют — fail-closed throw
 * (зеркало loadPhaseTemplate/loadAgentPrompt).
 *
 * @param cwd — рабочая директория проекта (переопределение)
 * @throws Error при отсутствии шаблона в обоих каталогах (ошибка установки)
 */
export function loadChatSystemTemplate(cwd: string): string {
  try {
    return readFileSync(join(cwd, PROJECT_CHAT_SYSTEM_PATH), 'utf8').trimEnd();
  } catch {
    // Нет переопределения — падаем на встроенный шаблон
  }
  try {
    return readFileSync(bundledTemplatePath, 'utf8').trimEnd();
  } catch {
    throw new Error(
      `Шаблон chat-system.md не найден: ${PROJECT_CHAT_SYSTEM_PATH} (проект) и ${bundledTemplatePath} (пакет)`,
    );
  }
}