/**
 * Субагенты-персоны в веб-чате (VL-409): инструмент `ask_persona`.
 *
 * Что делает: основная роль треда («Помощник») зовёт другую роль проекта
 * («Психолог», «Бизнес-наставник») и получает её ответ как результат
 * инструмента. Сервер делает ОТДЕЛЬНЫЙ запрос к модели с промптом, памятью и
 * уроками консультанта — история треда целиком ему не передаётся (только
 * вопрос и необязательный контекст). Помощник продолжает разговор, зная
 * мнение консультанта.
 *
 * Почему инструмент, а не переключение роли в треде: роль фиксируется за
 * тредом (VL-283), а смена роли посреди разговора смешала бы историю и память.
 * Отдельный тред заставил бы пользователя пересказывать контекст.
 *
 * Жёсткие ограничения (согласованы с пользователем):
 * - **глубина 1**: консультант НЕ получает `ask_persona` — иначе лавина
 *   вложенных запросов и непредсказуемая стоимость. Проверяется тестом, а не
 *   только кодом;
 * - **консультант не пишет в память**: `memory_remember` ему не выдаётся;
 * - **консультант не меняет проект**: write-инструменты отсекаются даже если
 *   роль объявила их в `allow_tools` — карточку Allow/Deny внутри вложенного
 *   запроса показать некому, а молчаливая запись запрещена правилом доступа;
 * - **таймаут обязателен**: зависший провайдер иначе повесил бы весь ход.
 *
 * Только веб-чат: инструмент добавляется в `chatToolDefs()` (как `ask_user`
 * VL-330 и `memory_remember` VL-402), в MCP-реестре `listTools()` его нет —
 * headless-фазы и TUI его не видят по построению.
 */

import type { ChatMessage, LlmClient, LlmUsage, ToolDef } from '../agent/llm.js';
import { truncateToolOutput } from '../agent/tools.js';
import { formatLessonLine, readChatLessonSettings, readLessonSettings, selectLessonsForText } from '../core/lesson.js';
import { handleToolCall } from '../mcp/tools.js';
import { isWriteOperation } from '../core/tool-classify.js';
import {
  ASK_PERSONA_TOOL,
  DEFAULT_CONSULTANT_TOOLS,
  type SubagentSettings,
} from '../core/subagents.js';
import { MEMORY_REMEMBER_TOOL } from './chat-memory.js';
import { chatToolDefs, askPersonaToolDef, type ChatLocalTool } from './tool-policy.js';
import { loadPersonaMemory, loadPersonas, loadPersonaPrompt, resolvePersona, type PersonaConfig } from './personas.js';

export { ASK_PERSONA_TOOL };

/**
 * Порог релевантности уроков в промпте консультанта.
 *
 * Дублирует `CHAT_LESSON_MIN_SCORE` из `chat.ts` намеренно: обратный импорт
 * (`chat.ts` → этот модуль) дал бы цикл. Значение то же — одно общее слово
 * («файл», «тест») не должно вытаскивать нерелевантный урок.
 */
const CONSULTANT_LESSON_MIN_SCORE = 3;

/** Сколько итераций разрешено консультанту (прочитать файл и ответить). */
const CONSULTANT_MAX_ITERATIONS = 3;

/** Токены консультации для события в ленте. */
export interface SubagentTokens {
  input: number;
  output: number;
  total: number;
}

/** Событие `subagent` в ленте чата (публикуется после успешной консультации). */
export interface SubagentEvent {
  personaId: string;
  personaLabel: string;
  question: string;
  answer: string;
  tokens: SubagentTokens;
}

/** Зависимости инструмента консультации. */
export interface AskPersonaDeps {
  /** Каталог проекта. */
  cwd: string;
  /** Роль ТРЕДА (основная): себя консультировать нельзя. */
  persona: PersonaConfig;
  /** Настройки секции `subagents`. */
  settings: SubagentSettings;
  /** LLM-клиент (в тестах — подменный). */
  llm: Pick<LlmClient, 'streamChat'>;
  /** Счётчик консультаций за ход (мутабельный: живёт в пределах хода). */
  counter: { calls: number };
  /** Учёт токенов консультации (billing треда с пометкой роли). */
  onUsage?: (personaId: string, usage: LlmUsage) => void;
  /** Публикация события в ленту (после успешного ответа). */
  onEvent?: (event: SubagentEvent) => void;
}

/** Непустая строка после trim (иначе undefined). */
function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Системный промпт консультанта: его промпт + его память + уроки по вопросу.
 *
 * Блока `## Текущая роль` здесь нет: консультант знает, кто он, из своего
 * промпта. Общие правила чата (`loadChatSystemTemplate`) тоже не подставляются
 * — консультант не ведёт диалог с пользователем, он отвечает на один вопрос.
 */
function buildConsultantPrompt(cwd: string, consultant: PersonaConfig, question: string): string {
  const parts: string[] = [loadPersonaPrompt(cwd, consultant)];
  const memory = loadPersonaMemory(cwd, consultant);
  if (memory.text) parts.push(`## Память персоны\n\n${memory.text}`);
  const chatLessons = readChatLessonSettings(cwd);
  if (chatLessons.enabled) {
    const promptLimit = readLessonSettings(cwd).promptLimit;
    const lessons = selectLessonsForText(cwd, question, {
      limit: Math.min(chatLessons.limit, promptLimit),
      minScore: CONSULTANT_LESSON_MIN_SCORE,
    });
    if (lessons.length) {
      parts.push(`## Уроки проекта\n\n${lessons.map(formatLessonLine).join('\n')}`);
    }
  }
  return parts.join('\n\n');
}

/**
 * Инструменты консультанта: `allow_tools` роли (или только-чтение по
 * умолчанию), минус `ask_persona` (глубина 1), минус `memory_remember`
 * (консультант не пишет в память) и минус write-операции (консультация не
 * меняет проект — подтверждать запись внутри вложенного запроса некому).
 */
function consultantTools(cwd: string, consultant: PersonaConfig): (ToolDef | ChatLocalTool)[] {
  const allowed = new Set(consultant.allowTools ?? DEFAULT_CONSULTANT_TOOLS);
  return chatToolDefs(cwd, consultant).filter(def => {
    if (def.name === ASK_PERSONA_TOOL) return false;
    if (def.name === MEMORY_REMEMBER_TOOL) return false;
    if (!allowed.has(def.name)) return false;
    return !isWriteOperation(def.name);
  });
}

/** Текст вопроса консультанту (вопрос + необязательный контекст). */
function consultantUserText(question: string, context?: string): string {
  if (context === undefined) return question;
  return `${question}\n\nКонтекст:\n${context}`;
}

/**
 * Инструмент `ask_persona {persona, question, context?}` — только веб-чат.
 *
 * Отказы возвращаются понятным tool-результатом (`{ok:false, error}`), ход
 * продолжается: модель видит причину и может исправиться.
 */
export function makeAskPersonaTool(deps: AskPersonaDeps): ChatLocalTool {
  const { cwd, persona, settings, llm, counter } = deps;
  return {
    ...askPersonaToolDef(),
    handler: async (args: Record<string, unknown>): Promise<string> => {
      const targetId = nonEmpty(args.persona);
      if (targetId === undefined) {
        return JSON.stringify({ ok: false, error: 'ask_persona: поле persona обязательно и не может быть пустым' });
      }
      const question = nonEmpty(args.question);
      if (question === undefined) {
        return JSON.stringify({ ok: false, error: 'ask_persona: поле question обязательно и не может быть пустым' });
      }
      if (targetId === persona.id) {
        return JSON.stringify({
          ok: false,
          error: `ask_persona: роль "${targetId}" — твоя собственная; консультировать себя бессмысленно`,
        });
      }
      if (counter.calls >= settings.maxCallsPerTurn) {
        return JSON.stringify({
          ok: false,
          error:
            `ask_persona: лимит консультаций на ход исчерпан (${settings.maxCallsPerTurn}). ` +
            'Отвечай по уже полученным мнениям или своими силами.',
          limit: settings.maxCallsPerTurn,
        });
      }

      const consultant = resolvePersona(cwd, targetId);
      if (consultant === null) {
        const available = listPersonaChoices(cwd);
        if (settings.onMissingPersona === 'skip') {
          // Нейтральный результат: модель продолжает сама, в ленте нет ошибки
          return JSON.stringify({
            ok: false,
            skipped: true,
            message: `Роль "${targetId}" не найдена — отвечай сам.`,
          });
        }
        return JSON.stringify({
          ok: false,
          error: `Роль "${targetId}" не найдена. Доступные роли: ${available}`,
        });
      }

      counter.calls++;
      const context = nonEmpty(args.context);
      const systemPrompt = buildConsultantPrompt(cwd, consultant, question);
      const tools = consultantTools(cwd, consultant);
      const localHandlers = new Map<string, ChatLocalTool>(
        tools.filter((t): t is ChatLocalTool => 'handler' in t).map(t => [t.name, t]),
      );

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: consultantUserText(question, context) },
      ];

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
      const tokens: SubagentTokens = { input: 0, output: 0, total: 0 };
      let answer = '';
      try {
        for (let iteration = 0; iteration < CONSULTANT_MAX_ITERATIONS; iteration++) {
          const resp = await llm.streamChat(messages, tools, {
            signal: controller.signal,
            maxTokens: settings.maxTokens,
          });
          if (resp.usage) {
            tokens.input += resp.usage.input_tokens;
            tokens.output += resp.usage.output_tokens;
            tokens.total += resp.usage.total_tokens;
            deps.onUsage?.(consultant.id, resp.usage);
          }
          if (resp.toolCalls.length === 0) {
            answer = (resp.text ?? '').trim();
            break;
          }
          messages.push({ role: 'assistant', content: resp.text || null, tool_calls: resp.toolCalls });
          for (const tc of resp.toolCalls) {
            let out: string;
            try {
              const local = localHandlers.get(tc.name);
              out = local
                ? await local.handler(tc.arguments)
                : await handleToolCall(tc.name, tc.arguments, cwd);
            } catch (err) {
              out = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
            }
            messages.push({ role: 'tool', tool_call_id: tc.id, content: truncateToolOutput(out) });
          }
        }
      } catch (err) {
        if (controller.signal.aborted) {
          // Таймаут — не исключение наружу: ход продолжается (AC9)
          return JSON.stringify({
            ok: false,
            error: `Консультант «${consultant.label}» не ответил за ${settings.timeoutMs} мс — отвечай сам.`,
            timeout: true,
          });
        }
        return JSON.stringify({
          ok: false,
          error: `Консультация не удалась: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        clearTimeout(timer);
      }

      if (answer === '') {
        return JSON.stringify({
          ok: false,
          error: `Консультант «${consultant.label}» не дал ответа — отвечай сам.`,
        });
      }

      deps.onEvent?.({
        personaId: consultant.id,
        personaLabel: consultant.label,
        question,
        answer,
        tokens,
      });

      return JSON.stringify({
        ok: true,
        personaId: consultant.id,
        personaLabel: consultant.label,
        question,
        answer,
        tokens,
      });
    },
  };
}

/** Перечень доступных ролей для текста ошибки: `id (label), …`. */
function listPersonaChoices(cwd: string): string {
  return loadPersonas(cwd)
    .personas.map(p => `${p.id} (${p.label})`)
    .join(', ');
}
