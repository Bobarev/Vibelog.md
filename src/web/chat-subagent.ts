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
 * - **консультант не пишет в память сам**: `memory_remember`/`memory_forget`
 *   ему не выдаются (VL-409/419). Его наблюдения о пользователе сервер
 *   записывает в ЕГО память из служебных строк `ЗАПОМНИТЬ:` в конце ответа —
 *   целевую роль при этом определяет сервер по `consultant.prompt`, а не
 *   модель (инвариант AC6 VL-402);
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
import { appendMemoryEntry } from '../core/persona-memory.js';
import { handleToolCall } from '../mcp/tools.js';
import { isWriteOperation } from '../core/tool-classify.js';
import {
  ASK_PERSONA_TOOL,
  DEFAULT_CONSULTANT_TOOLS,
  type SubagentSettings,
} from '../core/subagents.js';
import { MEMORY_FORGET_TOOL, MEMORY_REMEMBER_TOOL } from './chat-memory.js';
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

/** Сколько итераций разрешено консультанту по умолчанию (VL-415: настраивается). */
const CONSULTANT_MAX_ITERATIONS_FALLBACK = 5;

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
  /** VL-415: ответ обрезан по `subagents.max_answer_chars`. */
  truncated?: boolean;
  /** VL-415: сколько символов ответа показано (при обрезке). */
  answerChars?: number;
  /** VL-415: консультант исчерпал итерации — ответ частичный. */
  partial?: boolean;
  /** VL-415: инструменты, которые консультант успел вызвать. */
  usedTools?: string[];
  /** VL-419: записи, которые сервер добавил в память КОНСУЛЬТАНТА. */
  memory?: Array<{ index: number; text: string; date: string }>;
  /** VL-419: отказы appendMemoryEntry (дубль/лимит) — консультация успешна. */
  memorySkipped?: Array<{ text: string; reason: string }>;
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
  // VL-415: подсказка экономить итерации. Консультант, увлечённо читающий
  // материалы проекта, упирался в лимит итераций и не доходил до ответа.
  // Снижаем вероятность этого, не увеличивая лимит ещё больше.
  parts.push(
    '## Как отвечать\n\n' +
      'Отвечай по существу; если нужны материалы проекта — прочитай не более 2 файлов и ответь. ' +
      'Не изучай проект «на всякий случай»: пользователь ждёт мнение, а не отчёт о чтении.',
  );
  const memory = loadPersonaMemory(cwd, consultant);
  if (memory.text) parts.push(`## Память персоны\n\n${memory.text}`);
  // VL-419: канал записи консультанта. Ему не выдают memory_remember (VL-409:
  // консультация не должна молча писать), но наблюдения о человеке — как раз
  // его экспертиза. Сервер извлекает строки и пишет в память КОНСУЛЬТАНТА:
  // файл выбирает сервер по consultant.prompt, модель знает только формат.
  parts.push(
    '## Память\n\n' +
      'Если по ходу ответа ты узнал о пользователе устойчивое и важное (то, что пригодится в следующий раз), перечисли это в САМОМ КОНЦЕ ответа отдельными строками:\n' +
      'ЗАПОМНИТЬ: <правило одной фразой в императиве>\n' +
      'Строки служебные — пользователь их не увидит, они попадут в твою память.\n' +
      'Не более 2 строк за консультацию. Если запоминать нечего — строк нет.',
  );
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
 * умолчанию), минус `ask_persona` (глубина 1), минус инструменты памяти
 * (`memory_remember`/`memory_forget` — консультант не пишет и не чистит
 * память инструментами; его канал — служебные строки VL-419) и минус
 * write-операции (консультация не меняет проект — подтверждать запись внутри
 * вложенного запроса некому).
 */
function consultantTools(cwd: string, consultant: PersonaConfig): (ToolDef | ChatLocalTool)[] {
  const allowed = new Set(consultant.allowTools ?? DEFAULT_CONSULTANT_TOOLS);
  return chatToolDefs(cwd, consultant).filter(def => {
    if (def.name === ASK_PERSONA_TOOL) return false;
    if (def.name === MEMORY_REMEMBER_TOOL || def.name === MEMORY_FORGET_TOOL) return false;
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
 * Извлекает служебные строки `ЗАПОМНИТЬ:` из ответа консультанта (VL-419).
 *
 * Строки пишет модель по блоку «## Память» системного промпта. Префикс
 * фиксированный и регистрозависимый: «запомнить:» — обычный текст ответа,
 * а не канал записи (case-insensitive для кириллицы не нужен).
 *
 * Возвращает текст БЕЗ служебных строк (пустые строки, оставшиеся на месте
 * извлечённых, схлопываются; хвост обрезается) и массив записей — не более 2
 * (лимит из промпта; лишние отбрасываются, модель могла его нарушить).
 * Fail-safe: формат не выполнен — исходный текст возвращается байт-в-байт,
 * записи пустые; это не ошибка консультации.
 *
 * @param answer — полный ответ консультанта ДО обрезки по max_answer_chars
 */
export function extractMemoryLines(answer: string): { text: string; entries: string[] } {
  const entries: string[] = [];
  const kept: string[] = [];
  let removed = 0;
  for (const line of answer.split('\n')) {
    const match = /^ЗАПОМНИТЬ:\s*(.*)$/.exec(line);
    if (match === null) {
      kept.push(line);
      continue;
    }
    removed++;
    const value = match[1]!.trim();
    if (value !== '' && entries.length < 2) entries.push(value);
  }
  // Служебных строк нет — текст не трогаем (контракт точного ответа VL-415)
  if (removed === 0) return { text: answer, entries };
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '');
  return { text, entries };
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
      const maxIterations =
        settings.maxIterations > 0 ? settings.maxIterations : CONSULTANT_MAX_ITERATIONS_FALLBACK;
      let answer = '';
      /**
       * VL-415: последний непустой текст модели. Модель часто пишет «сейчас
       * посмотрю файлы…» вместе с tool_calls — этот текст раньше терялся.
       * Используется ТОЛЬКО как fallback, когда финального ответа нет.
       */
      let lastText = '';
      /** VL-415: инструменты, которые консультант успел вызвать (для частичного результата). */
      const usedTools: string[] = [];
      try {
        for (let iteration = 0; iteration < maxIterations; iteration++) {
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
          const text = (resp.text ?? '').trim();
          if (text !== '') lastText = text;
          if (resp.toolCalls.length === 0) {
            // Текст без вызовов — финальный ответ; пустой текст — берём
            // последний осмысленный (VL-415: не терять ответ).
            answer = text || lastText;
            break;
          }
          messages.push({ role: 'assistant', content: resp.text || null, tool_calls: resp.toolCalls });
          for (const tc of resp.toolCalls) {
            usedTools.push(tc.name);
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

      // VL-415: итерации исчерпаны, но текст в последнем ответе был — отдаём
      // его как ответ, а не «не дал ответа».
      if (answer === '' && lastText !== '') answer = lastText;

      if (answer === '') {
        // Два разных исхода (VL-415): исчерпаны итерации (partial) и модель
        // вернула пустоту без вызовов (empty). Тексты разные — модель должна
        // понимать, повторять вопрос или отвечать самой.
        if (usedTools.length > 0) {
          const list = [...new Set(usedTools)].join(', ');
          return JSON.stringify({
            ok: false,
            partial: true,
            error:
              `Консультант «${consultant.label}» исчерпал лимит итераций (${maxIterations}) и не успел ответить. ` +
              `Вызванные инструменты: ${list}. Отвечай сам или повтори вопрос проще.`,
            iterations: maxIterations,
            usedTools,
          });
        }
        return JSON.stringify({
          ok: false,
          empty: true,
          error: `Консультант «${consultant.label}» вернул пустой ответ — отвечай сам.`,
        });
      }

      // VL-419: служебные строки ЗАПОМНИТЬ: — в память КОНСУЛЬТАНТА (файл
      // берётся из consultant.prompt: целевую роль определяет сервер, а не
      // модель — инвариант AC6 VL-402). Отказ записи (дубль/лимит) не валит
      // консультацию — попадает в memorySkipped с причиной.
      const extracted = extractMemoryLines(answer);
      const memory: Array<{ index: number; text: string; date: string }> = [];
      const memorySkipped: Array<{ text: string; reason: string }> = [];
      for (const entryText of extracted.entries) {
        const written = appendMemoryEntry(cwd, consultant.prompt, entryText);
        if (written.ok) {
          memory.push({ index: written.entry.index, text: written.entry.text, date: written.entry.date });
        } else {
          memorySkipped.push({ text: entryText, reason: written.reason });
        }
      }

      // VL-415: свой лимит длины ответа вместо общего капа tool-вывода —
      // применяется к тексту уже без служебных строк (AC6 VL-419)
      const limited = limitAnswer(extracted.text, settings.maxAnswerChars);

      deps.onEvent?.({
        personaId: consultant.id,
        personaLabel: consultant.label,
        question,
        answer: limited.answer,
        tokens,
        ...(limited.truncated ? { truncated: true, answerChars: limited.answerChars } : {}),
        ...(memory.length > 0 ? { memory } : {}),
        ...(memorySkipped.length > 0 ? { memorySkipped } : {}),
      });

      return JSON.stringify({
        ok: true,
        personaId: consultant.id,
        personaLabel: consultant.label,
        question,
        answer: limited.answer,
        tokens,
        truncated: limited.truncated,
        answerChars: limited.answerChars,
        ...(memory.length > 0 ? { memory } : {}),
        ...(memorySkipped.length > 0 ? { memorySkipped } : {}),
      });
    },
  };
}

/**
 * Обрезка ответа консультанта по `subagents.max_answer_chars` (VL-415).
 *
 * Режем по границе строки, иначе по слову — обрезка посередине слова
 * выглядит как баг. Пометка адресована и модели, и пользователю: она
 * объясняет, что ответ не «сломался», и называет настройку.
 *
 * @returns `answer` — текст с пометкой, `truncated` — была ли обрезка,
 *          `answerChars` — длина ПОЛНОГО ответа до обрезки
 */
function limitAnswer(
  answer: string,
  maxChars: number,
): { answer: string; truncated: boolean; answerChars: number } {
  if (answer.length <= maxChars) return { answer, truncated: false, answerChars: answer.length };
  const head = answer.slice(0, maxChars);
  const newline = head.lastIndexOf('\n');
  const space = head.lastIndexOf(' ');
  // Границу ищем только во второй половине лимита: иначе от ответа останется
  // огрызок, если перевод строки был в самом начале.
  const cut = newline > maxChars / 2 ? newline : space > maxChars / 2 ? space : head.length;
  const shown = head.slice(0, cut).trimEnd();
  const note =
    `\n\n[ответ консультанта обрезан: показано ${shown.length} из ${answer.length} символов — ` +
    'увеличьте subagents.max_answer_chars]';
  return { answer: shown + note, truncated: true, answerChars: answer.length };
}

/** Перечень доступных ролей для текста ошибки: `id (label), …`. */
function listPersonaChoices(cwd: string): string {
  return loadPersonas(cwd)
    .personas.map(p => `${p.id} (${p.label})`)
    .join(', ');
}
