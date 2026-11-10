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
 *    вариант (c) плана VL-219) + локальные read_file/write_file/edit/search_files.
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
import { resolveInProject, truncateToolOutput, formatDirListing, formatFileSlice, parseReadPath, formatMissingPathHint, makeEdit } from '../agent/tools.js';
import { searchProjectFiles } from '../agent/search-files.js';
import { listTools } from '../mcp/tools.js';
import { isUpstreamConfigured } from '../core/gitverse-issues.js';
import { UPSTREAM_TOOLS } from '../mcp/server.js';
import { ASK_USER_TOOL, MAX_OPTIONS, MIN_OPTIONS } from './chat-question.js';
import { makeMemoryRememberTool } from './chat-memory.js';
import type { PersonaConfig } from './personas.js';

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

// VL-306: классификатор вынесен в core (`src/core/tool-classify.ts`) — он нужен
// и веб-чату (approval-gate), и агентскому циклу (страховка appliedSignatures).
// Реэкспорт сохраняет публичный API этого модуля: импортёры и тесты не меняются.
export { isWriteOperation, isInteractiveTool } from '../core/tool-classify.js';

/**
 * Инструмент read_file чата: чтение файла проекта БЕЗ подтверждения
 * (isWriteOperation('read_file') === false). Путь + опциональный диапазон
 * строк (offset 0-based, limit) либо диапазон прямо в path (VL-252,
 * parseReadPath — общий хелпер с агентом, lesson-37). Границы проекта —
 * resolveInProject; вывод — formatFileSlice/truncateToolOutput (единая точка
 * капа, lesson-30).
 */
export function makeReadFileTool(cwd: string): ChatLocalTool {
  return {
    name: 'read_file',
    description:
      'Читает текстовый файл проекта БЕЗ подтверждения пользователя. ' +
      'offset — 0-based номер строки начала, limit — максимум строк. ' +
      'Диапазон можно задать прямо в path: "файл:171-340" — строки 171–340 (1-based, включительно), ' +
      '"файл:171" — с 171-й до конца; диапазон в path приоритетнее offset/limit. ' +
      'Маркер обрезки в конце ответа содержит готовый path="…:НАЧАЛО-КОНЕЦ" — скопируй его ' +
      'в следующий вызов, чтобы прочитать продолжение. ' +
      'Если path — каталог, возвращает отсортированный листинг (каталоги с "/", лимит 200 записей). ' +
      'Файлы с очень длинными строками (JSONL) читаются по диапазонам: offset/limit применяются ' +
      'до обрезки лимита 8 КБ, слишком длинная строка усекается с подсказкой следующего offset. ' +
      'Доступ только в пределах директории проекта.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Путь к файлу относительно корня проекта; ' +
            'допустим суффикс диапазона строк ":НАЧАЛО-КОНЕЦ" или ":НАЧАЛО" (1-based, включительно)',
        },
        offset: { type: 'number', description: '0-based номер строки начала' },
        limit: { type: 'number', description: 'Максимум возвращаемых строк' },
      },
      required: ['path'],
    },
    handler: async (args: Record<string, unknown>): Promise<string> => {
      const rawPath = args.path;
      // resolveInProject с allowRoot: '.' — листинг корня проекта, а не отказ
      // «должен указывать на файл» (VL-233); пустой путь отклоняется явно.
      if (typeof rawPath !== 'string' || rawPath === '') return 'Путь не задан';
      // Диапазон в path (VL-252) переопределяет необязательные offset/limit.
      const parsed = parseReadPath(cwd, rawPath);
      if (!parsed.ok) return parsed.error;
      const target = resolveInProject(cwd, parsed.path, { allowRoot: true });
      if (!target.ok) return target.error;
      try {
        if (statSync(target.path).isDirectory()) {
          const listing = formatDirListing(cwd, target.path);
          return truncateToolOutput(listing.ok ? listing.text : listing.error);
        }
      } catch (err) {
        // VL-257: отсутствующий путь приходит сюда (statSync бросает ENOENT) —
        // отдаём подсказку с листингом и похожими путями, ту же, что у агента.
        if (!existsSync(target.path)) {
          const hint = formatMissingPathHint(cwd, parsed.path);
          return truncateToolOutput(
            hint === null ? `Файл не найден: ${target.path}` : `Файл не найден: ${target.path}\n\n${hint}`,
          );
        }
        return `Не удалось прочитать файл: ${err instanceof Error ? err.message : String(err)}`;
      }
      let content: string;
      try {
        content = readFileSync(target.path, 'utf8');
      } catch (err) {
        return `Не удалось прочитать файл: ${err instanceof Error ? err.message : String(err)}`;
      }
      // formatFileSlice: offset/limit применяются до обрезки бюджета (VL-250);
      // path в маркере — относительный, чтобы копировался в следующий вызов.
      return formatFileSlice(
        content,
        parsed.offset ?? args.offset,
        parsed.limit ?? args.limit,
        relative(cwd, target.path),
      );
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
 * Инструмент edit чата (VL-366): точечная правка файла С обязательным
 * подтверждением (isWriteOperation('edit') === true → approval-gate).
 *
 * Схема и handler берутся из агентского `makeEdit` (src/agent/tools.ts), а не
 * описываются заново: два независимых описания разъехались бы при следующей
 * правке агентского инструмента (та же причина, по которой классификатор
 * вынесен в core — lesson-37). Переопределяется только description: модели
 * чата нужно правило выбора edit vs write_file.
 */
export function makeEditTool(cwd: string): ChatLocalTool {
  const spec = makeEdit(cwd);
  return {
    name: spec.name,
    description:
      'Точечная правка файла: заменяет old_string на new_string. ' +
      'ВЫПОЛНЯЕТСЯ ТОЛЬКО С ПОДТВЕРЖДЕНИЯ (Allow/Deny). ' +
      'Без replace_all old_string обязан встречаться ровно один раз — иначе отказ ' +
      '(защита от двусмысленных правок). Предпочитай edit вместо write_file для правок ' +
      'в существующих файлах: write_file перезаписывает файл целиком. ' +
      'replace_all: true на короткой строке может переписать весь файл — используй осознанно. ' +
      'Доступ только в пределах директории проекта.',
    inputSchema: spec.inputSchema,
    handler: spec.handler,
  };
}

/**
 * Инструмент search_files чата (VL-234): поиск по исходникам БЕЗ подтверждения
 * (isWriteOperation('search_files') === false). Общий handler с агентом —
 * searchProjectFiles; границы проекта, пропуск node_modules/.git/dist,
 * бинарников и файлов >1 МБ, кап вывода внутри.
 */
export function makeSearchFilesTool(cwd: string): ChatLocalTool {
  return {
    name: 'search_files',
    description:
      'Поиск по содержимому файлов проекта БЕЗ подтверждения пользователя. ' +
      'Основной инструмент для вопросов «где используется X» и «где определён Y» — ' +
      'один вызов вместо серии read_file с offset/limit (ниже расход контекста). ' +
      'pattern — подстрока (literal) или регулярка при regex: true; glob — фильтр путей ' +
      '("src/**/*.ts"); context — строк до/после (0-5); limit — максимум совпадений (дефолт 100); ' +
      'caseSensitive (дефолт true). Выдача сгруппирована по файлу: "N: текст" — совпадение, ' +
      '"N- текст" — контекст. node_modules/.git/dist, бинарники и файлы >1 МБ пропускаются. ' +
      'Доступ только в пределах директории проекта.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Подстрока (literal) или регулярка при regex: true' },
        glob: { type: 'string', description: 'Фильтр путей, например "src/**/*.ts"' },
        path: { type: 'string', description: 'Директория или файл для поиска (дефолт — весь проект)' },
        context: { type: 'number', description: 'Строк контекста до/после совпадения (0-5)' },
        limit: { type: 'number', description: 'Максимум совпадений (дефолт 100)' },
        regex: { type: 'boolean', description: 'pattern как регулярка (дефолт false — literal)' },
        caseSensitive: { type: 'boolean', description: 'Учитывать регистр (дефолт true)' },
      },
      required: ['pattern'],
    },
    // VL-354: searchProjectFiles сам обрезает вывод и дописывает маркер потерь —
    // повторный truncateToolOutput срезал бы этот маркер (вывод уже на границе бюджета).
    handler: async (args: Record<string, unknown>): Promise<string> => searchProjectFiles(cwd, args),
  };
}

/**
 * Инструмент `ask_user` (VL-330): блокирующий вопрос с готовыми вариантами.
 *
 * Сервер его НЕ исполняет: вызов = пауза хода (как approval-gate), ответ
 * приходит из UI и подставляется синтетическим tool-результатом. Поэтому у
 * ToolDef нет handler'а — если вызов всё же дойдёт до `executeTool` (ошибка
 * маршрутизации), MCP-реестр ответит «неизвестный инструмент», а не соврёт
 * модели выдуманным ответом.
 *
 * В список инструментов попадает ТОЛЬКО через `chatToolDefs()` (интерактивный
 * веб-чат). Агентская петля (`src/agent/loop.ts`) берёт `listTools()` из
 * MCP-реестра, где этого имени нет, — в headless-фазах и TUI вопрос
 * недоступен по построению (AC10).
 */
export function makeAskUserTool(): ToolDef {
  return {
    name: ASK_USER_TOOL,
    description:
      'Задаёт пользователю блокирующий вопрос с готовыми вариантами ответа. ' +
      'Используй вместо вопроса текстом, когда ответ — выбор из известного набора ' +
      '(да/нет, один из подходов, какой файл/задача). Вызов приостанавливает ход: ' +
      'пользователь выбирает вариант или вводит свой текст, ответ приходит ' +
      'результатом инструмента. Не спрашивай о том, что можно прочитать в проекте, ' +
      'и не задавай больше 1–2 вопросов подряд без промежуточного прогресса. ' +
      'Вариант «другое» добавлять не нужно — свободный ввод даёт сам интерфейс ' +
      '(если allow_custom не false).',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Текст вопроса пользователю' },
        options: {
          type: 'array',
          description: `Варианты ответа, от ${MIN_OPTIONS} до ${MAX_OPTIONS}`,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Идентификатор варианта (уникальный в вопросе)' },
              label: { type: 'string', description: 'Короткая подпись кнопки' },
              description: { type: 'string', description: 'Пояснение под подписью (необязательно)' },
            },
            required: ['id', 'label'],
          },
        },
        allow_custom: {
          type: 'boolean',
          description: 'Разрешить свободный ответ текстом (по умолчанию true)',
        },
      },
      required: ['question', 'options'],
    },
  };
}

/**
 * Инструменты модели чата: все MCP-инструменты (кроме
 * CHAT_DISALLOWED_TOOLS) + локальные read_file/write_file/edit/search_files +
 * интерактивный ask_user (VL-330) + memory_remember (VL-402). Схемы совпадают
 * с реестром listTools() — дублирования нет (Р2 плана VL-219).
 *
 * @param cwd — каталог проекта
 * @param persona — роль ТРЕДА: нужна инструменту `memory_remember`, чтобы
 *   писать в память именно этой роли (AC6 VL-402: модель не выбирает, в чью
 *   память писать). Без роли инструмент не добавляется — так его нет в
 *   headless-путях и в тестах, где роль не нужна.
 */
export function chatToolDefs(cwd: string, persona?: PersonaConfig | null): (ToolDef | ChatLocalTool)[] {
  const defs: (ToolDef | ChatLocalTool)[] = listTools()
    .filter(t => !CHAT_DISALLOWED_TOOLS.includes(t.name))
    // VL-375/VL-391: ненастроенный upstream в чате так же бессмысленен,
    // как и в MCP-сервере — тот же предикат и тот же список, что в handleToolsList.
    .filter(t => !UPSTREAM_TOOLS.includes(t.name) || isUpstreamConfigured(cwd))
    .map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  defs.push(makeReadFileTool(cwd), makeWriteFileTool(cwd), makeEditTool(cwd), makeSearchFilesTool(cwd));
  // VL-330: интерактивный вопрос — только в веб-чате (в headless его нет)
  defs.push(makeAskUserTool());
  // VL-402: запись памяти персоны — тоже только в веб-чате (в MCP-реестре
  // имени нет, поэтому агентская петля его не видит)
  if (persona) defs.push(makeMemoryRememberTool(cwd, persona));
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