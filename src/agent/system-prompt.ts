/**
 * Системный промпт vibelog-agent (VL-96, Цель 1).
 *
 * Собирает system-сообщение диалога: (а) встроенная базовая часть — роль
 * агента, язык, границы рабочего каталога; (б) содержимое AGENTS.md проекта
 * из cwd, если файл есть. Минимальный вариант qwen-code (решение плана VL-96):
 * AGENTS.md читается только из корня рабочего каталога, без иерархии вверх
 * по дереву — cwd агента всегда корень проекта Vibelog.
 *
 * Лимит вставки AGENTS.md — чтобы огромный файл не съедал контекст каждой
 * итерации loop; ошибка чтения (EACCES, EISDIR и т.п.) не роняет фазу:
 * предупреждение в stderr, промпт собирается без AGENTS.md.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Максимум символов AGENTS.md во вставке (обрезка с пометкой). */
export const AGENTS_MD_MAX_CHARS = 8000;

/** Результат сборки системного промпта. */
export interface SystemPromptResult {
  /** Полный текст system-сообщения. */
  content: string;
  /** Удалось ли подключить AGENTS.md проекта (для лога CLI). */
  hasAgentsMd: boolean;
}

/** Встроенная базовая часть — стабильный префикс запроса каждой итерации. */
const BASE_PROMPT = `Ты — Vibelog-agent, LLM-агент проекта Vibelog.md. Выполняешь задачи через инструменты (файлы, shell) и MCP-инструменты Vibelog.

Правила:
- Отвечай на русском языке.
- Работай только внутри рабочего каталога проекта (cwd); не выходи за его пределы.
- Применяй правки аккуратно: после изменений запускай проверки (pnpm build, pnpm test), если задача этого требует.
- Не выполняй push и другие необратимые действия, если пользователь прямо не просил.
- Контекст проекта — в AGENTS.md ниже (если подключён).`;

/**
 * Собирает системный промпт: базовая часть + AGENTS.md проекта из cwd.
 * Отсутствие AGENTS.md — норма (только базовая часть); ошибка чтения —
 * предупреждение в stderr, фаза продолжается без AGENTS.md.
 */
export function buildSystemPrompt(cwd: string): SystemPromptResult {
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
  const content = hasAgentsMd ? `${BASE_PROMPT}\n\n# AGENTS.md проекта\n\n${agentsMd}` : BASE_PROMPT;
  return { content, hasAgentsMd };
}
