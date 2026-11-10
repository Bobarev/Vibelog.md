/**
 * Мост «Telegram-бот ↔ веб-чат» — команда /chat (VL-408).
 *
 * Задача: из бота продолжить диалог, начатый в веб-интерфейсе. `/chat <id>`
 * запоминает тред для чата Telegram, дальше обычные (не слэш) сообщения
 * уходят в этот тред, а ответ персоны возвращается в бот.
 *
 * Почему in-process, без HTTP: бот и веб-чат живут в одном репозитории и
 * одном dist. Импорт `startChatRun`/`subscribeChatRun` напрямую снимает
 * вопросы «какой порт, запущен ли веб-сервер» — пересылка работает, даже
 * если `/web start` не делали. Плата — реестр прогонов у каждого процесса
 * свой (см. `readTurnState` ниже).
 *
 * Состояние режима — module-state (паттерн `webChild` в `web.ts` и
 * `awaitingPin`/`awaitingComment` в `handlers.ts`): рестарт бота режим
 * теряет, пользователь повторяет `/chat`. Хранить это в файле смысла нет —
 * режим живёт ровно столько, сколько живёт процесс, который его обслуживает.
 */

import type { ChatMessage } from '../agent/llm.js';
import {
  getChatThread,
  startChatRun,
  type ChatDeps,
  type ChatEvent,
  type ChatRequestBody,
} from '../web/chat.js';
import {
  cancelChatRun,
  readTurnState,
  STALE_RUN_IDLE_MS,
  subscribeChatRun,
} from '../web/chat-runs.js';

/** chatId Telegram → id треда веб-чата, в который пересылаем сообщения. */
const bridges = new Map<number, string>();

/** Включить режим пересылки для чата (повторный /chat перезаписывает тред). */
export function setChatBridge(chatId: number, threadId: string): void {
  bridges.set(chatId, threadId);
}

/** Тред, в который пересылает чат, либо null (режим не активен). */
export function getChatBridge(chatId: number): string | null {
  return bridges.get(chatId) ?? null;
}

/**
 * Выключить режим пересылки.
 *
 * @returns true, если режим был активен (для текста «Режим завершён»)
 */
export function clearChatBridge(chatId: number): boolean {
  return bridges.delete(chatId);
}

/** Сброс всех режимов — для тестов (реестр не переживает процесс). */
export function clearAllChatBridges(): void {
  bridges.clear();
}

/**
 * Последний непустой ответ персоны из истории треда.
 *
 * Пустые assistant-сообщения (модель вернула только tool_calls) пропускаем:
 * пользователю нужен текст, а не «ничего». Нет ответов — пустая строка,
 * вызывающий сам решает, что показать.
 */
export function lastAssistantText(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role !== 'assistant') continue;
    const text = (m.content ?? '').trim();
    if (text) return text;
  }
  return '';
}

/**
 * Исход пересылки: ответ персоны, ошибка, «продолжайте в вебе» либо пауза
 * хода, которую бот умеет разрешить сам (VL-414).
 *
 * `approval`/`question` несут `threadId`: обработчик бота сохраняет паузу в
 * module-state и по нажатию кнопки возобновляет ход (`answerChatApproval` /
 * `answerChatQuestion`).
 */
export type ForwardResult =
  | { text: string }
  | { error: string }
  | { needsWeb: string }
  | { approval: ApprovalPause }
  | { question: QuestionPause };

/** Событие approval из веб-чата + тред, в котором висит пауза. */
export type ApprovalPause = Extract<ChatEvent, { type: 'approval' }> & { threadId: string };

/** Событие question из веб-чата + тред, в котором висит пауза. */
export type QuestionPause = Extract<ChatEvent, { type: 'question' }> & { threadId: string };

/**
 * Текст подсказки, когда ход встал на паузу, которую бот решить не может.
 *
 * VL-414: approval и question бот теперь решает сам (кнопки), поэтому подсказка
 * осталась только для сценариев вне возможностей бота — сейчас это
 * `pricing(kind:'ask')` (карточка дрейфа цены с выбором вендора).
 */
const NEEDS_WEB_TEXT =
  'Ход в веб-чате ждёт решения по цене модели — продолжите в веб-интерфейсе. ' +
  'Режим пересылки остаётся включённым.';

/**
 * Отправить сообщение в тред веб-чата и дождаться ответа персоны.
 *
 * Возвращает только текст ответа: вызовы инструментов, reasoning и служебные
 * события (usage/memory/subagent) в бот не транслируются — так требует
 * постановка задачи (нужен ответ персоны, а не телеметрия хода).
 *
 * VL-414: пауза на approval/вопросе больше НЕ гасит прогон — она возвращается
 * наружу (`{approval}`/`{question}`), бот показывает кнопки и возобновляет ход
 * через `answerChatApproval`/`answerChatQuestion`. Прогон при этом завершается
 * штатно (`produce` возвращает управление, `driveChat` ставит `done`), поэтому
 * в реестре он не висит и следующий ход стартует свободно.
 *
 * @param cwd — рабочая директория проекта (backlog/, .vibelog/)
 * @param threadId — тред веб-чата
 * @param text — сообщение пользователя из Telegram
 * @param deps — подменный LLM для тестов (в проде не передаётся)
 */
export async function forwardChatMessage(
  cwd: string,
  threadId: string,
  text: string,
  deps: ChatDeps = {},
): Promise<ForwardResult> {
  return await runAndCollect(cwd, threadId, { threadId, message: text }, deps);
}

/**
 * Разрешить/отклонить ожидающий approval и дождаться продолжения хода.
 *
 * @param always — «Always allow» (VL-264): инструмент попадает в allow-list
 *   треда, последующие вызовы идут без паузы
 */
export async function answerChatApproval(
  cwd: string,
  threadId: string,
  toolCallId: string,
  approved: boolean,
  always = false,
  deps: ChatDeps = {},
): Promise<ForwardResult> {
  return await runAndCollect(
    cwd,
    threadId,
    { threadId, approval: { toolCallId, approved, always } },
    deps,
  );
}

/**
 * Ответить на ожидающий вопрос `ask_user` и дождаться продолжения хода.
 *
 * @param answer — ровно одно из `optionId`/`custom` (валидирует сервер)
 */
export async function answerChatQuestion(
  cwd: string,
  threadId: string,
  toolCallId: string,
  answer: { optionId?: string; custom?: string },
  deps: ChatDeps = {},
): Promise<ForwardResult> {
  return await runAndCollect(cwd, threadId, { threadId, answer: { toolCallId, ...answer } }, deps);
}

/**
 * Общий драйвер: старт хода (новый или resume) и сбор событий до исхода.
 *
 * Вынесен из `forwardChatMessage` (VL-414), чтобы три точки входа — новое
 * сообщение, решение по approval, ответ на вопрос — не расходились в
 * поведении (lesson-37: общая логика — один хелпер).
 */
async function runAndCollect(
  cwd: string,
  threadId: string,
  body: ChatRequestBody,
  deps: ChatDeps,
): Promise<ForwardResult> {
  // Тред должен существовать: иначе startChatRun создаст новый файл истории
  // с чужим id и пользователь будет «продолжать» пустой чат.
  if (getChatThread(cwd, threadId) === null) {
    return { error: `Чат ${threadId} не найден` };
  }
  // Защита от двух параллельных ходов в одном треде: реестр прогонов живёт в
  // памяти процесса, поэтому веб-сервер и бот друг о друге не знают. Sidecar
  // `<threadId>.turn.json` — единственный общий признак «ход идёт».
  const state = readTurnState(cwd, threadId);
  if (state?.status === 'running') {
    const lastAt = Date.parse(state.lastEventAt ?? state.startedAt);
    if (Number.isFinite(lastAt) && Date.now() - lastAt < STALE_RUN_IDLE_MS) {
      return { error: 'В этом чате уже идёт ход — дождитесь ответа' };
    }
  }

  const started = startChatRun(body, cwd, deps);
  if ('error' in started) return { error: started.error };
  const run = started.run;

  return await new Promise<ForwardResult>((resolve) => {
    let answer = '';
    let settled = false;
    // subscribeChatRun дренирует буфер СИНХРОННО, поэтому колбэк может
    // сработать до присваивания unsubscribe — держим его в let и вызываем
    // через опциональную цепочку (иначе TDZ-ошибка на первом же событии).
    let unsubscribe: (() => void) | null = null;
    const finish = (result: ForwardResult): void => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      resolve(result);
    };
    unsubscribe = subscribeChatRun(run, 0, (ev) => {
      switch (ev.type) {
        case 'text':
          answer += ev.delta;
          break;
        case 'done':
          finish({ text: answer.trim() });
          break;
        case 'error':
          finish({ error: ev.message });
          break;
        case 'approval':
          // VL-414: пауза, которую бот решает кнопками Allow/Deny. Прогон не
          // гасим — он завершается сам (produce вернул управление), а решение
          // придёт новым ходом с body.approval.
          finish({ approval: { ...ev, threadId } });
          break;
        case 'question':
          // VL-414: пауза-вопрос — бот показывает кнопки-варианты и ждёт
          // свободный текст; ответ уходит новым ходом с body.answer.
          finish({ question: { ...ev, threadId } });
          break;
        case 'pricing':
          if (ev.kind === 'ask') {
            // Карточка дрейфа цены (VL-317) — выбор вендора бот не умеет:
            // гасим прогон и просим продолжить в вебе (осознанное ограничение).
            cancelChatRun(threadId, 'Ход остановлен: решение по цене доступно только в веб-интерфейсе');
            finish({ needsWeb: NEEDS_WEB_TEXT });
          }
          break;
        default:
          // tool_start/tool_end/usage/memory/subagent/thread/truncated —
          // в бот не транслируются (только ответ персоны)
          break;
      }
    });
    // Прогон мог завершиться ДО подписки (джойн к только что закончившемуся
    // ходу): subscribeChatRun дренирует буфер, но `done` уже не придёт.
    if (run.done) finish({ text: answer.trim() });
  });
}
