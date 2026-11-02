/**
 * Резолв промптов вариантов эксперимента (VL-296, doc-21 §4, §6).
 *
 * `variant.prompt` — строка в одном из двух форматов:
 * - `<name>` — файл в `prompts/`: частный `exp-<id>/prompts/<name>.md` →
 *   общий `prompts/<name>.md` (правило «частный перекрывает общий» — общий
 *   хелпер `resolveShadowing` из dataset.ts, чтобы правило жило в одном месте);
 * - `builtin:<phase>` — **встроенный промпт фазы**: файловая система для
 *   такого значения не опрашивается. Главный AI-сценарий — сравнить *текущий
 *   шаблон* фазы с его вариантом; копия шаблона в `prompts/` сравнивала бы две
 *   копии и не отслеживала дрейф шаблона.
 *
 * Почему `builtin:` не ищется в `prompts/`: имя `builtin:spec` в файловой
 * системе выглядело бы как обычный файл, и опечатка в имени фазы давала бы
 * «промпт не найден» вместо «неизвестная фаза» — разные диагнозы, разное лечение.
 *
 * Затенение общего файла частным печатается warning-ом в stderr: молчаливый
 * резолв — источник ложных выводов эксперимента (§6).
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { resolveShadowing } from './dataset.js';
import { experimentsDir, experimentsPromptsDir } from './paths.js';
import { loadPhaseTemplate, PHASES } from '../web/phase-prompt.js';
import type { ResolutionInfo } from './dataset.js';

/** Происхождение текста промпта. */
export type PromptResolutionKind = 'private' | 'shared' | 'builtin' | 'explicit';

/** Результат резолва промпта варианта. */
export interface ResolvedPrompt {
  /** Исходное значение `variant.prompt` (как записано в карточке). */
  name: string;
  /** Откуда взят текст. */
  kind: PromptResolutionKind;
  /** Текст промпта (для builtin — содержимое шаблона фазы). */
  text: string;
  /** Имя фазы для `builtin:<phase>`. */
  phase?: string;
  /** Абсолютный путь файла (для файловых видов). */
  absolutePath?: string;
  /** Путь относительно backlog-а — то, что попадает в `meta.json`. */
  relativePath?: string;
  /** Структура резолва для meta.json (doc-21 §6). */
  resolution: ResolutionInfo;
  /** Тексты предупреждений (уже напечатаны в stderr, если не silent). */
  warnings: string[];
}

/** Опции резолва промпта. */
export interface ResolvePromptOptions {
  /** Escape hatch `--variant-a-prompt-path` / `--variant-b-prompt-path`. */
  explicitPath?: string;
  /** Не печатать warning в stderr (тесты, пакетный вывод). */
  silent?: boolean;
  /** Корень проекта для переопределения шаблонов фаз (по умолчанию — родитель backlog-а). */
  cwd?: string;
}

/** Префикс значения «встроенный промпт фазы». */
export const BUILTIN_PREFIX = 'builtin:';

/**
 * Проверяет, является ли значение встроенным промптом фазы.
 *
 * @param value — `variant.prompt` из карточки
 */
export function isBuiltinPrompt(value: string): boolean {
  return String(value || '').trim().startsWith(BUILTIN_PREFIX);
}

/** Путь относительно backlog-а (или абсолютный, если файл вне backlog-а). */
function toRelative(backlogDir: string, absolutePath: string): string {
  const rel = relative(backlogDir, absolutePath);
  return (rel.startsWith('..') ? absolutePath : rel).split('\\').join('/');
}

/** Печатает предупреждения в stderr — единственный канал, который видит CI/агент. */
function emitWarnings(warnings: string[], silent?: boolean): void {
  if (silent) return;
  for (const w of warnings) console.error(`Предупреждение: ${w}`);
}

/**
 * Резолвит промпт варианта эксперимента.
 *
 * @param backlogDir — корень backlog-а
 * @param expId — id эксперимента (`exp-N`)
 * @param name — `variant.prompt`: имя файла или `builtin:<phase>`
 * @param opts — escape hatch, silent, cwd
 * @throws если файл не найден (с перечнем путей) или фаза неизвестна
 */
export function resolvePrompt(
  backlogDir: string,
  expId: string,
  name: string,
  opts: ResolvePromptOptions = {}
): ResolvedPrompt {
  const value = String(name || '').trim();
  if (!value) {
    throw new Error('У варианта не задан prompt: укажите имя файла в prompts/ или builtin:<phase>');
  }
  const warnings: string[] = [];

  // ── builtin:<phase>: файловая система не опрашивается ──
  if (isBuiltinPrompt(value)) {
    const phase = value.slice(BUILTIN_PREFIX.length).trim();
    if (!phase) {
      throw new Error('Пустое имя фазы в builtin:: укажите builtin:spec, builtin:plan и т.п.');
    }
    if (!(PHASES as readonly string[]).includes(phase)) {
      throw new Error(`Неизвестная фаза в builtin:${phase}. Доступные фазы: ${PHASES.join(', ')}`);
    }
    const cwd = opts.cwd ?? join(backlogDir, '..');
    const text = loadPhaseTemplate(phase, { cwd });
    return {
      name: value,
      kind: 'builtin',
      phase,
      text,
      resolution: { chosen: 'builtin', path: `templates/phases/phase-${phase}.md` },
      warnings,
    };
  }

  // ── Escape hatch: явный путь перебивает резолв полностью ──
  if (opts.explicitPath) {
    const absolutePath = isAbsolute(opts.explicitPath)
      ? opts.explicitPath
      : join(process.cwd(), opts.explicitPath);
    if (!existsSync(absolutePath)) {
      throw new Error(`Файл промпта не найден: ${opts.explicitPath}`);
    }
    const rel = toRelative(backlogDir, absolutePath);
    const sharedPath = join(experimentsPromptsDir(backlogDir), `${value.replace(/\.md$/, '')}.md`);
    if (existsSync(sharedPath)) {
      warnings.push(
        `явный путь промпта перебивает резолв: общий промпт ${toRelative(backlogDir, sharedPath)} не используется`
      );
    }
    emitWarnings(warnings, opts.silent);
    return {
      name: value,
      kind: 'explicit',
      text: readFileSync(absolutePath, 'utf-8'),
      absolutePath,
      relativePath: rel,
      resolution: { chosen: 'explicit', path: rel },
      warnings,
    };
  }

  // ── Файловый резолв: частный → общий ──
  const found = resolveShadowing(backlogDir, expId, 'prompt', value);
  if (!found) {
    const checked = [
      toRelative(backlogDir, join(backlogDir, 'experiments', expId, 'prompts', `${value}.md`)),
      toRelative(backlogDir, join(experimentsPromptsDir(backlogDir), `${value}.md`)),
    ];
    throw new Error(`Промпт "${value}" не найден. Проверены пути: ${checked.join(', ')}`);
  }
  if (found.shadowed) {
    warnings.push(
      `частный промпт ${found.relativePath} затеняет общий ${found.shadowed} — правки общего файла на этот эксперимент не действуют`
    );
  }
  emitWarnings(warnings, opts.silent);
  return {
    name: value,
    kind: found.chosen,
    text: readFileSync(found.absolutePath, 'utf-8'),
    absolutePath: found.absolutePath,
    relativePath: found.relativePath,
    resolution: {
      chosen: found.chosen,
      path: found.relativePath,
      ...(found.shadowed ? { shadowed: found.shadowed } : {}),
    },
    warnings,
  };
}

/**
 * Резолвит промпты сразу всех вариантов эксперимента.
 *
 * @returns map «ключ варианта → резолв или текст ошибки»
 */
export function resolveVariantPrompts(
  backlogDir: string,
  expId: string,
  variants: Record<string, { prompt: string }>,
  opts: { paths?: Record<string, string>; silent?: boolean; cwd?: string } = {}
): Record<string, { resolved?: ResolvedPrompt; error?: string }> {
  const out: Record<string, { resolved?: ResolvedPrompt; error?: string }> = {};
  for (const [key, cfg] of Object.entries(variants)) {
    try {
      out[key] = {
        resolved: resolvePrompt(backlogDir, expId, cfg.prompt, {
          explicitPath: opts.paths?.[key],
          silent: opts.silent,
          cwd: opts.cwd,
        }),
      };
    } catch (err) {
      out[key] = { error: (err as Error).message };
    }
  }
  return out;
}
