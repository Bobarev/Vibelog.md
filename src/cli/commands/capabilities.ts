/**
 * Команда `vibelog capabilities` — справочник возможностей Vibelog (VL-394).
 *
 * Тонкая обёртка над `buildCapabilities`/`renderCapabilitiesMarkdown`
 * (src/core/capabilities.ts): вся сборка данных живёт в ядре, здесь только
 * форма вывода. Так же устроен `vibelog map` (VL-235) — команда и MCP-обёртка
 * делят одну генерацию, дублирования логики нет.
 *
 * Формы вывода:
 * - без флагов — компактный markdown (обзор для человека, ~8 КБ);
 * - `--json` — `{schemaVersion, kind:'capabilities', data}` (машиночитаемая
 *   форма для агента, полностью, без обрезки описаний).
 */

import { printInfo } from '../ui.js';
import type { FlagValues } from '../args.js';
import { buildCapabilities, renderCapabilitiesMarkdown } from '../../core/capabilities.js';

/**
 * Выполняет команду capabilities.
 *
 * @param _args — позиционные аргументы (у команды их нет; принимаем для
 *   единой сигнатуры обработчиков роутера)
 * @param flags — флаги (--json)
 * @param cwd — корень проекта (settings.json и переопределения шаблонов фаз)
 */
export async function runCapabilities(
  _args: string[],
  flags: FlagValues,
  cwd: string
): Promise<void> {
  const data = buildCapabilities(cwd);

  if (flags.json) {
    // Форма по образцу vibelog map (VL-235): schemaVersion + kind + data —
    // агент различает ответы по kind, не заглядывая в содержимое.
    console.log(JSON.stringify({
      schemaVersion: data.schemaVersion,
      kind: data.kind,
      data,
    }, null, 2));
    return;
  }

  console.log(renderCapabilitiesMarkdown(data));
  printInfo('Полная машиночитаемая форма (без обрезки описаний): vibelog capabilities --json');
}
