/**
 * Системный промпт vibelog-agent (VL-96, Цель 1; VL-109 — вынос в md).
 *
 * Собирает system-сообщение диалога: (а) встроенная базовая часть — роль
 * агента, язык, границы рабочего каталога, правила экономии ходов; читается
 * из templates/agent-prompt.md (правки промпта без пересборки кода, шаблоны
 * едут с пакетом — package.json files включает templates); (б) содержимое
 * AGENTS.md проекта из cwd, если файл есть. Минимальный вариант qwen-code
 * (решение плана VL-96): AGENTS.md читается только из корня рабочего
 * каталога, без иерархии вверх по дереву — cwd агента всегда корень проекта.
 *
 * Лимит вставки AGENTS.md — чтобы огромный файл не съедал контекст каждой
 * итерации loop; ошибка чтения (EACCES, EISDIR и т.п.) не роняет фазу:
 * предупреждение в stderr, промпт собирается без AGENTS.md. Отсутствие
 * самого шаблона agent-prompt.md — ошибка установки: throw, как renderPrompt
 * при отсутствии шаблона фазы.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Максимум символов AGENTS.md во вставке (обрезка с пометкой). */
export const AGENTS_MD_MAX_CHARS = 8000;

/**
 * Путь к встроенному шаблону базовой части системного промпта. Вычисляется
 * от расположения модуля (dist/agent/system-prompt.js → ../../templates/),
 * как templatesDir в phase-prompt.ts.
 */
const agentPromptPath = fileURLToPath(new URL('../../templates/agent-prompt.md', import.meta.url));

/** Подкаталог переопределения шаблонов проектом (VL-188), относительно cwd. */
export const PROJECT_AGENT_PROMPT_PATH = join('.vibelog', 'prompts', 'agent-prompt.md');

/**
 * Читает базовую часть системного промпта с переопределением проектом
 * (VL-188): сначала .vibelog/prompts/agent-prompt.md рабочей директории,
 * затем встроенный templates/agent-prompt.md; оба отсутствуют — throw.
 *
 * @param cwd — рабочая директория проекта (переопределение)
 * @throws Error при отсутствии шаблона в обоих каталогах (ошибка установки)
 */
export function loadAgentPrompt(cwd: string): string {
  const projectPath = join(cwd, PROJECT_AGENT_PROMPT_PATH);
  try {
    return readFileSync(projectPath, 'utf-8').trimEnd();
  } catch {
    // Нет переопределения — падаем на встроенный шаблон
  }
  try {
    return readFileSync(agentPromptPath, 'utf-8').trimEnd();
  } catch {
    throw new Error(
      `Шаблон системного промпта не найден: ${PROJECT_AGENT_PROMPT_PATH} (проект) и ${agentPromptPath} (пакет)`,
    );
  }
}

/** Результат сборки системного промпта. */
export interface SystemPromptResult {
  /** Полный текст system-сообщения. */
  content: string;
  /** Удалось ли подключить AGENTS.md проекта (для лога CLI). */
  hasAgentsMd: boolean;
}

/**
 * Собирает системный промпт: базовая часть (templates/agent-prompt.md) +
 * AGENTS.md проекта из cwd. Отсутствие AGENTS.md — норма (только базовая
 * часть); ошибка чтения — предупреждение в stderr, фаза продолжается без
 * AGENTS.md. Отсутствие шаблона agent-prompt.md — throw (ошибка установки).
 */
export function buildSystemPrompt(cwd: string): SystemPromptResult {
  // Базовая часть — стабильный префикс запроса каждой итерации loop;
  // VL-188: переопределение проектом .vibelog/prompts/agent-prompt.md
  const base = loadAgentPrompt(cwd);
  let agentsMd = '';
  let hasAgentsMd = false;
  try {
    const raw = readFileSync(join(cwd, 'AGENTS.md'), 'utf-8');
    hasAgentsMd = true;
    if (raw.length > AGENTS_MD_MAX_CHARS) {
      agentsMd = `${raw.slice(0, AGENTS_MD_MAX_CHARS)}\n\n[AGENTS.md обрезан: показаны первые ${AGENTS_MD_MAX_CHARS} из ${raw.length} символов]`;
    } else {
      agentsMd = raw;
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      // EACCES/EISDIR и прочие — предупреждаем, но не роняем фазу
      console.error(
        `Предупреждение: AGENTS.md не прочитан (${code ?? (err as Error).message}) — системный промпт без него`,
      );
    }
  }
  const content = hasAgentsMd ? `${base}\n\n# AGENTS.md проекта\n\n${agentsMd}` : base;
  return { content, hasAgentsMd };
}
