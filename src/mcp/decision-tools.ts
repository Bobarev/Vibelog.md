/**
 * MCP-инструменты архитектурных решений (decisions / ADR) — VL-412.
 *
 * Пробел, который модуль закрывает: ядро (`src/core/decision.ts`) и CLI
 * (`vibelog decision create|list|view`) существовали, а в MCP не было ни
 * одного упоминания `decision`. Агент в чате и в фазах не мог ни прочитать
 * архитектурные решения проекта, ни зафиксировать новое — при этом в проекте
 * 12 файлов решений с ключевыми договорённостями (стек фронтенда, доставка
 * компонентов, формат реестра). Планируя задачу, агент этих договорённостей
 * не видел и мог предложить уже отвергнутый вариант.
 *
 * Четыре инструмента:
 * - `decision_list` (read) — список с фильтром по статусу + `duplicates`;
 * - `decision_view` (read) — карточка + ADR-тело по id;
 * - `decision_create` (write) — новое решение (id = max+1);
 * - `decision_update` (write) — точечная правка статуса/заголовка/секций.
 *
 * Почему отдельный модуль, а не дополнение `tools.ts`: там 3900+ строк и
 * десятки инструментов backlog-домена; решения — отдельный домен, и его
 * правки не должны раздувать реестр (тот же приём, что у `supervisor.ts` и
 * `workflow-tools.ts`).
 *
 * Контракт ответов: JSON-ack (`ackRead`/`ackOk`/`ackNoop`/`ackError`) —
 * требование VL-306/VL-351; ни один путь не бросает исключений.
 */

import {
  DECISION_STATUSES,
  findDuplicateIds,
  getDecision,
  listDecisions,
  updateDecision,
  writeDecision,
} from '../core/decision.js';
import type { DecisionEntry } from '../core/decision.js';
import { findBacklogDir } from '../core/paths.js';
import { ackError, ackNoop, ackOk, ackRead } from './tool-result.js';
import type { ToolArgs, ToolDefinition } from './tools.js';

/** Известные поля `decision_create` (переданное вне списка → skipped). */
const CREATE_FIELDS: readonly string[] = [
  'title', 'status', 'context', 'decision', 'consequences', 'alternatives', 'idempotencyKey',
];

/** Известные поля `decision_update`. */
const UPDATE_FIELDS: readonly string[] = [
  'id', 'title', 'status', 'context', 'decision', 'consequences', 'alternatives', 'idempotencyKey',
];

/** Определения инструментов решений. */
export const DECISION_TOOL_DEFS: ToolDefinition[] = [
  {
    name: 'decision_list',
    description:
      'Список архитектурных решений (ADR) проекта из backlog/decisions/. ' +
      'Возвращает {decisions: [{id, title, date, status}], duplicates?}. ' +
      'duplicates — id, встречающиеся больше одного раза (конфликт файлов). ' +
      'Чтение — без подтверждения. Используй перед планированием, чтобы не предложить уже отвергнутое.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: `Фильтр по статусу (${DECISION_STATUSES.join('|')}), case-insensitive`,
        },
      },
    },
  },
  {
    name: 'decision_view',
    description:
      'Архитектурное решение по id: карточка (id/title/date/status) и ADR-тело ' +
      '(## Context / ## Decision / ## Consequences / ## Alternatives). ' +
      'При дубле id возвращает первый файл и признак ambiguous: true. ' +
      'Неизвестный id — ошибка со списком доступных.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID решения, например decision-6' },
      },
      required: ['id'],
    },
  },
  {
    name: 'decision_create',
    description:
      'Зафиксировать новое архитектурное решение (ADR). id назначается автоматически (max+1). ' +
      'Возвращает JSON-ack с applied: {id, title, status}. ' +
      'Пустой title или недопустимый статус — ошибка, файл не создаётся.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Заголовок решения (обязателен)' },
        status: {
          type: 'string',
          description: `Статус (${DECISION_STATUSES.join('|')}), по умолчанию proposed`,
        },
        context: { type: 'string', description: 'Секция ## Context — почему решение понадобилось' },
        decision: { type: 'string', description: 'Секция ## Decision — что решили' },
        consequences: { type: 'string', description: 'Секция ## Consequences — последствия' },
        alternatives: { type: 'string', description: 'Секция ## Alternatives — рассмотренные варианты' },
        idempotencyKey: {
          type: 'string',
          description: 'Ключ идемпотентности: повтор с тем же ключом не создаёт второе решение',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'decision_update',
    description:
      'Точечная правка решения: статус, заголовок (переименовывает файл) и/или ADR-секции. ' +
      'Тело НЕ перезаписывается целиком: заменяется только переданная секция ' +
      '(## Context / ## Decision / ## Consequences / ## Alternatives), отсутствующая добавляется. ' +
      'Возвращает applied — только фактически изменённые поля; ничего не изменилось — noop. ' +
      'Недопустимый статус или неизвестный id — ошибка, файл не меняется.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID решения, например decision-12' },
        status: {
          type: 'string',
          description: `Новый статус (${DECISION_STATUSES.join('|')})`,
        },
        title: { type: 'string', description: 'Новый заголовок (файл переименовывается)' },
        context: { type: 'string', description: 'Новое тело секции ## Context' },
        decision: { type: 'string', description: 'Новое тело секции ## Decision' },
        consequences: { type: 'string', description: 'Новое тело секции ## Consequences' },
        alternatives: { type: 'string', description: 'Новое тело секции ## Alternatives' },
        idempotencyKey: {
          type: 'string',
          description: 'Ключ идемпотентности: повтор с тем же ключом не применяет изменение второй раз',
        },
      },
      required: ['id'],
    },
  },
];

/** Переданные ключи вне известного набора — в `skipped` (VL-262). */
function unknownFields(args: ToolArgs, known: readonly string[]): Array<{ field: string; reason: string }> {
  return Object.keys(args)
    .filter(key => !known.includes(key))
    .map(field => ({ field, reason: 'неизвестное поле инструмента: не записано' }));
}

/** Резолвит backlog-каталог или возвращает текст ошибки. */
function requireBacklog(cwd: string): { dir: string } | { error: string } {
  const dir = findBacklogDir(cwd);
  if (!dir) return { error: 'Backlog не найден. Выполните: vibelog init' };
  return { dir };
}

/** Слим-карточка решения для списка. */
function slim(entry: DecisionEntry): Record<string, unknown> {
  return {
    id: entry.decision.id,
    title: entry.decision.title,
    date: entry.decision.date,
    status: entry.decision.status,
  };
}

/**
 * Обрабатывает вызов инструмента решений.
 *
 * @param name — decision_list | decision_view | decision_create | decision_update
 * @param args — аргументы инструмента
 * @param cwd — корень проекта
 * @returns JSON-ack строкой
 */
export function handleDecisionTool(name: string, args: ToolArgs, cwd: string): string {
  const backlog = requireBacklog(cwd);
  if ('error' in backlog) return ackError(backlog.error);
  const backlogDir = backlog.dir;

  if (name === 'decision_list') {
    try {
      const status = typeof args.status === 'string' ? args.status.trim() : '';
      const entries = listDecisions(backlogDir, status ? { status } : {});
      const duplicates = findDuplicateIds(listDecisions(backlogDir));
      const applied: Record<string, unknown> = { decisions: entries.map(slim) };
      if (duplicates.length > 0) applied.duplicates = duplicates;
      const message = entries.length === 0
        ? (status ? `Решений со статусом "${status}" нет.` : 'Решений нет.')
        : `Решений: ${entries.length}${status ? ` (статус: ${status})` : ''}`;
      return ackRead(message, applied);
    } catch (err) {
      return ackError(`Не удалось прочитать решения: ${(err as Error).message}`);
    }
  }

  if (name === 'decision_view') {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) return ackError('id: укажите ID решения, например decision-6');
    try {
      const entry = getDecision(backlogDir, id);
      if (!entry) {
        const available = listDecisions(backlogDir).map(e => e.decision.id);
        return ackError(
          `Решение ${id} не найдено. Доступные: ${available.length ? available.join(', ') : '(нет решений)'}`
        );
      }
      const applied: Record<string, unknown> = {
        decision: slim(entry),
        body: entry.body,
        path: entry.path,
      };
      if (entry.ambiguous) applied.ambiguous = true;
      const message = entry.ambiguous
        ? `Решение ${entry.decision.id} прочитано, но id встречается в нескольких файлах (ambiguous) — проверь актуальность`
        : `Решение ${entry.decision.id}: ${entry.decision.title}`;
      return ackRead(message, applied);
    } catch (err) {
      return ackError(`Не удалось прочитать решение: ${(err as Error).message}`);
    }
  }

  if (name === 'decision_create') {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) return ackError('title: заголовок решения обязателен и не может быть пустым');
    const status = typeof args.status === 'string' ? args.status.trim() : '';
    if (status && !DECISION_STATUSES.includes(status)) {
      return ackError(
        `Недопустимый статус: "${status}". Допустимые: ${DECISION_STATUSES.join(', ')}`
      );
    }
    try {
      const decision = writeDecision(backlogDir, {
        title,
        status: status || undefined,
        context: typeof args.context === 'string' ? args.context : undefined,
        decision: typeof args.decision === 'string' ? args.decision : undefined,
        consequences: typeof args.consequences === 'string' ? args.consequences : undefined,
        alternatives: typeof args.alternatives === 'string' ? args.alternatives : undefined,
      });
      return ackOk(
        `Решение ${decision.id} создано: ${decision.title} (статус: ${decision.status})`,
        { id: decision.id, title: decision.title, status: decision.status },
        unknownFields(args, CREATE_FIELDS),
      );
    } catch (err) {
      return ackError(`Решение не создано: ${(err as Error).message}`);
    }
  }

  if (name === 'decision_update') {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) return ackError('id: укажите ID решения, например decision-12');
    const status = typeof args.status === 'string' ? args.status.trim() : undefined;
    if (status !== undefined && !DECISION_STATUSES.includes(status)) {
      return ackError(
        `Недопустимый статус: "${status}". Допустимые: ${DECISION_STATUSES.join(', ')}`
      );
    }
    const title = typeof args.title === 'string' ? args.title : undefined;
    if (title !== undefined && !title.trim()) {
      return ackError('title: заголовок решения не может быть пустым');
    }
    try {
      const result = updateDecision(backlogDir, id, {
        ...(title !== undefined ? { title } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(typeof args.context === 'string' ? { context: args.context } : {}),
        ...(typeof args.decision === 'string' ? { decision: args.decision } : {}),
        ...(typeof args.consequences === 'string' ? { consequences: args.consequences } : {}),
        ...(typeof args.alternatives === 'string' ? { alternatives: args.alternatives } : {}),
      });
      if (!result) {
        const available = listDecisions(backlogDir).map(e => e.decision.id);
        return ackError(
          `Решение ${id} не найдено. Доступные: ${available.length ? available.join(', ') : '(нет решений)'}`
        );
      }
      const skipped = unknownFields(args, UPDATE_FIELDS);
      if (result.changed.length === 0) {
        return ackNoop(
          `Изменений нет: решение ${result.decision.id} уже имеет переданные значения`,
          { id: result.decision.id, ...slim({ decision: result.decision, body: result.body, path: result.path }) },
        );
      }
      const applied: Record<string, unknown> = { id: result.decision.id };
      for (const field of result.changed) {
        if (field === 'title') applied.title = result.decision.title;
        else if (field === 'status') applied.status = result.decision.status;
        else applied[field] = true;
      }
      return ackOk(
        `Решение ${result.decision.id} обновлено: ${result.changed.join(', ')}`,
        applied,
        skipped,
      );
    } catch (err) {
      return ackError(`Решение не обновлено: ${(err as Error).message}`);
    }
  }

  return ackError(`Неизвестный инструмент решений: ${name}`);
}
