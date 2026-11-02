/**
 * Авто-отчёт фазы (VL-253, вынесен из tools.ts в VL-304).
 *
 * Проблема, которую модуль решает: `description` схемы не влияет на генерацию
 * аргументов tool-calling — если поля нет в `required`, модель может не
 * прислать его никогда (инцидент VL-250/VL-252: 10+ вызовов без comment →
 * луп). Фаза не должна падать из-за дисциплины модели в необязательном по
 * факту поле.
 *
 * VL-304: тот же формат нужен ВНЕ `backlog_finish_phase` — если модель до
 * него не дошла (ран завершился повтором применённого вызова), отчёт
 * собирает пост-ран CLI (`src/agent/auto-report.ts`). Один модуль — один
 * формат, иначе MCP-путь и CLI-путь разъезжаются.
 */

import type { Task } from '../core/task.js';

/** Контекст сводки: уже вычисленные части отчёта. */
export interface AutoReportContext {
  /** Итоговый статус задачи (или запрошенный вызовом). */
  status: string;
  acChecked: number;
  acTotal: number;
  dodChecked: number;
  dodTotal: number;
  /** Изменённые файлы (modified_files задачи или аргумент вызова). */
  files: string[];
  /**
   * VL-304: неотмеченные пункты AC/DoD — по номерам и текстам. Автоматически
   * НЕ отмечаются (это было бы ложным заявлением о выполненной работе, дух
   * lesson-140/VL-248), но и «висеть молча» не должны: следующий ран или
   * человек видит точный список.
   */
  uncheckedAc?: string[];
  uncheckedDod?: string[];
}

/** Кап перечисляемых пунктов: отчёт не должен раздувать файл задачи. */
const UNCHECKED_LIMIT = 10;

/**
 * Собирает текст авто-отчёта фазы.
 *
 * @param task — задача до применения правок (источник плана/резюме/файлов)
 * @param ctx — уже вычисленные части сводки (статус, счётчики, файлы)
 */
export function buildAutoReport(task: Task, ctx: AutoReportContext): string {
  const oneLine = (s: string, limit: number): string => {
    const flat = String(s).replace(/\s+/g, ' ').trim();
    return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
  };
  const planFragment = task.implementationPlan
    ? `Фрагмент плана: ${oneLine(task.implementationPlan, 300)}`
    : task.finalSummary
      ? `Фрагмент резюме: ${oneLine(task.finalSummary, 300)}`
      : 'Фрагмент плана/резюме: план и резюме отсутствуют.';
  const files = ctx.files.length > 0
    ? `Файлы (${ctx.files.length}): ${ctx.files.slice(0, 10).join(', ')}${ctx.files.length > 10 ? ', …' : ''}`
    : 'Файлы: не менялись';
  const uncheckedLine = (label: string, items: string[] | undefined): string | null => {
    if (!items || items.length === 0) return null;
    const shown = items.slice(0, UNCHECKED_LIMIT).join('; ');
    const tail = items.length > UNCHECKED_LIMIT ? `; … ещё ${items.length - UNCHECKED_LIMIT}` : '';
    return `${label} не отмечены (${items.length}): ${shown}${tail}`;
  };
  const unchecked = [
    uncheckedLine('AC', ctx.uncheckedAc),
    uncheckedLine('DoD', ctx.uncheckedDod),
  ].filter((line): line is string => line !== null);
  return [
    'Фаза: авто-отчёт (comment не передан моделью)',
    `Статус: ${ctx.status}`,
    `AC отмечено: ${ctx.acChecked} из ${ctx.acTotal}`,
    `DoD отмечено: ${ctx.dodChecked} из ${ctx.dodTotal}`,
    ...unchecked,
    files,
    planFragment,
    'Отчёт собран сервером автоматически (VL-253): модель не передала comment.',
  ].join('\n');
}

/**
 * Строки неотмеченных пунктов чеклиста для `AutoReportContext`.
 *
 * Формат «N. текст» — номер пункта нужен, чтобы следующий ран мог отметить
 * его через `backlog_manage_ac`/`backlog_manage_dod` по индексу.
 *
 * @param items — пункты чеклиста задачи (в старых задачах — просто строки)
 */
export function uncheckedItems(items: Array<string | { text: string; checked?: boolean }> | undefined): string[] {
  if (!items) return [];
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (typeof item === 'string' ? true : item.checked !== true))
    .map(({ item, index }) => {
      const text = typeof item === 'string' ? item : item.text;
      return `${index + 1}. ${String(text).replace(/\s+/g, ' ').trim()}`;
    });
}
