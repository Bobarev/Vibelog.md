/**
 * Сборка промптов фаз (VL-85): общий модуль оркестратора и CLI vibelog-agent.
 *
 * Логика вынесена из src/web/orchestrator.ts без изменений: шаблоны
 * templates/qwen-commands/phase-*.md + подстановка {{taskId}}/{{key}}.
 * Вынесено, чтобы CLI агента переиспользовал сборку промпта, не таща
 * за собой оркестратор (spawn, поллинг, activeRuns). Путь к шаблонам
 * вычисляется от расположения модуля: dist/web/phase-prompt.js →
 * ../../templates/qwen-commands/ (та же глубина, что была у orchestrator.js).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Допустимые фазы. */
export const PHASES = ['spec', 'plan', 'code', 'close', 'comment', 'prompt'] as const;
export type Phase = (typeof PHASES)[number];

/** Шаблон промпта для каждой фазы. */
const PHASE_FILES: Record<Phase, string> = {
  spec: 'phase-1.md',
  plan: 'phase-2.md',
  code: 'phase-3.md',
  close: 'phase-close.md',
  comment: 'phase-comment.md',
  prompt: 'prompt.md',
};

/** Отдельный шаблон close-фазы для задач, работающих в worktree (VL-112). */
const CLOSE_WORKTREE_FILE = 'phase-close-worktree.md';

/**
 * Путь к headless-промптам. Вычисляется от расположения модуля
 * (dist/web/phase-prompt.js → ../../templates/qwen-commands/), как webDistDir:
 * команда vibelog browser запускается в репозитории пользователя.
 */
const templatesDir = fileURLToPath(new URL('../../templates/qwen-commands/', import.meta.url));

/** Опции сборки промпта (VL-112). */
export interface RenderPromptOptions {
  /** Фаза close задачи, работающей в worktree: отдельный шаблон с merge-шагом ветки. */
  closeWorktree?: boolean;
}

/**
 * Собирает промпт фазы: шаблон + подстановка {{taskId}}.
 *
 * @param phase — spec | plan | code | close | comment | prompt
 * @param taskId — ID задачи, например VL-28
 * @param extraVars — доп. подстановки {{key}} -> value ({{comment}} для comment, {{prompt}} для prompt)
 * @param opts — опции (VL-112: closeWorktree — close задачи с worktree → отдельный шаблон)
 * @throws Error при неизвестной фазе или отсутствующем шаблоне
 */
export function renderPrompt(
  phase: string,
  taskId: string,
  extraVars?: Record<string, string>,
  opts?: RenderPromptOptions
): string {
  if (!PHASES.includes(phase as Phase)) {
    throw new Error(`Неизвестная фаза: ${phase} (ожидается spec|plan|code|close|comment|prompt)`);
  }
  // VL-112: close задачи с worktree сливает ветку из главного репо — отдельный шаблон
  const fileName = phase === 'close' && opts?.closeWorktree ? CLOSE_WORKTREE_FILE : PHASE_FILES[phase as Phase];
  const templatePath = join(templatesDir, fileName);
  let template: string;
  try {
    template = readFileSync(templatePath, 'utf-8');
  } catch {
    throw new Error(`Шаблон промпта не найден: ${templatePath}`);
  }
  let prompt = template.replaceAll('{{taskId}}', taskId);
  if (extraVars) {
    for (const [key, value] of Object.entries(extraVars)) {
      prompt = prompt.replaceAll('{{' + key + '}}', value);
    }
  }
  return prompt;
}
