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

/**
 * Путь к headless-промптам. Вычисляется от расположения модуля
 * (dist/web/phase-prompt.js → ../../templates/qwen-commands/), как webDistDir:
 * команда vibelog browser запускается в репозитории пользователя.
 */
const templatesDir = fileURLToPath(new URL('../../templates/qwen-commands/', import.meta.url));

/**
 * Собирает промпт фазы: шаблон + подстановка {{taskId}}.
 *
 * @param phase — spec | plan | code | close | comment | prompt
 * @param taskId — ID задачи, например VL-28
 * @param extraVars — доп. подстановки {{key}} -> value ({{comment}} для comment, {{prompt}} для prompt)
 * @throws Error при неизвестной фазе или отсутствующем шаблоне
 */
export function renderPrompt(
  phase: string,
  taskId: string,
  extraVars?: Record<string, string>
): string {
  if (!PHASES.includes(phase as Phase)) {
    throw new Error(`Неизвестная фаза: ${phase} (ожидается spec|plan|code|close|comment|prompt)`);
  }
  const templatePath = join(templatesDir, PHASE_FILES[phase as Phase]);
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
