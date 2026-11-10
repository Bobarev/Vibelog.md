/**
 * MCP-инструменты конструктора workflow (VL-398).
 *
 * Два инструмента, дающих агенту работать с конфигурацией workflow без shell
 * и без `write_file` в `.vibelog/settings.json`:
 * - `workflow_get` (read) — эффективная схема + находки валидации одним
 *   вызовом: агент в новом проекте видит и «что сейчас работает», и «что не
 *   так», не читая исходники Vibelog (их в новом проекте нет);
 * - `workflow_apply` (write) — запись секций workflows/task_workflows/
 *   completeness с валидацией ДО записи; подтверждение даёт общий
 *   approval-gate по `TOOL_KINDS` (src/core/tool-kinds.ts).
 *
 * Почему отдельный модуль, а не дополнение `tools.ts`: там 3800+ строк и
 * десятки инструментов backlog-домена; конструктор — отдельный домен, и его
 * правки не должны раздувать реестр (тот же приём, что у `supervisor.ts`).
 *
 * Контракт ответов: JSON-ack (`ackRead`/`ackOk`/`ackNoop`/`ackError`) —
 * требование VL-306/VL-351; ни один путь не бросает исключений.
 */

import {
  applyWorkflowConfig,
  describeWorkflow,
  validateWorkflowConfig,
} from '../core/workflow-config.js';
import { ackError, ackNoop, ackOk, ackRead } from './tool-result.js';
import type { ToolArgs, ToolDefinition } from './tools.js';

/** Определения инструментов конструктора workflow. */
export const WORKFLOW_TOOL_DEFS: ToolDefinition[] = [
  {
    name: 'workflow_get',
    description:
      'Эффективный workflow проекта: имя, источник (дефолт в коде или settings.json), ' +
      'переходы «статус → фаза → статус», task_workflows, правила неполноты (completeness), ' +
      'статусы backlog/config.yml и находки валидации (статусы вне конфига, недостижимые статусы, ' +
      'фазы без шаблона, висячие ссылки task_workflows, ошибки completeness). ' +
      'Чтение — без подтверждения. Используй перед обсуждением кастомного workflow с пользователем.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'workflow_apply',
    description:
      'Записать конфигурацию workflow в .vibelog/settings.json: ключи workflows (имя → ' +
      '{initial_status, transitions:[{status, phase, produces_status}]}), task_workflows ' +
      '(тип задачи → имя workflow), completeness (workflow → фаза → сущность → поля). ' +
      'Валидация выполняется ДО записи: при ошибке (неизвестная фаза, нет шаблона) файл не меняется. ' +
      'Повтор того же патча — noop. syncStatuses дополняет statuses в backlog/config.yml ' +
      'статусами из переходов; dryRun показывает, что было бы записано.',
    inputSchema: {
      type: 'object',
      properties: {
        patch: {
          type: 'object',
          description: 'Фрагмент конфигурации: workflows / task_workflows / completeness',
        },
        dryRun: { type: 'boolean', description: 'Показать, что было бы записано, не меняя файл' },
        syncStatuses: {
          type: 'boolean',
          description: 'Дописать недостающие статусы в statuses backlog/config.yml',
        },
        idempotencyKey: {
          type: 'string',
          description: 'Ключ идемпотентности: повтор с тем же ключом не применяет изменение второй раз',
        },
      },
      required: ['patch'],
    },
  },
];

/**
 * Обрабатывает вызов инструмента конструктора workflow.
 *
 * @param name — workflow_get | workflow_apply
 * @param args — аргументы инструмента
 * @param cwd — корень проекта
 * @returns JSON-ack строкой
 */
export async function handleWorkflowTool(name: string, args: ToolArgs, cwd: string): Promise<string> {
  if (name === 'workflow_get') {
    try {
      const description = describeWorkflow(cwd);
      const findings = validateWorkflowConfig(cwd);
      return ackRead('Workflow проекта прочитан', {
        workflow: description,
        findings,
        ok: findings.every((f) => f.severity !== 'error'),
      });
    } catch (err) {
      return ackError(`Не удалось прочитать workflow: ${(err as Error).message}`);
    }
  }

  if (name === 'workflow_apply') {
    const patch = args.patch;
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      return ackError('patch: ожидается объект с ключами workflows / task_workflows / completeness');
    }
    try {
      const result = applyWorkflowConfig(cwd, patch as Record<string, unknown>, {
        dryRun: args.dryRun === true,
        syncStatuses: args.syncStatuses === true,
      });
      if (!result.ok) {
        return ackError(`Workflow не применён: ${(result.errors ?? []).join('; ')}`);
      }
      if (result.noop) {
        return ackNoop('Изменений нет: конфигурация уже совпадает с переданной', {
          applied: result.applied ?? {},
        });
      }
      const message = result.dryRun
        ? '--dry-run: файл не изменён, показано, что было бы записано'
        : 'Workflow записан в .vibelog/settings.json';
      return ackOk(message, {
        ...(result.applied ?? {}),
        ...(result.dryRun ? { dryRun: true } : {}),
        ...(result.statusesAdded ? { statusesAdded: result.statusesAdded } : {}),
        ...(result.warnings ? { warnings: result.warnings } : {}),
        ...(result.skipped ? { skipped: result.skipped } : {}),
      });
    } catch (err) {
      return ackError(`Workflow не применён: ${(err as Error).message}`);
    }
  }

  return ackError(`Неизвестный инструмент конструктора workflow: ${name}`);
}
