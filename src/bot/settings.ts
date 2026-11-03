/**
 * Настройки Telegram-бота (VL-34).
 *
 * Хранятся в едином .vibelog/settings.json (VL-143, gitignored) — отдельно
 * от backlog/config.yml: (1) секреты в env-секции не должны коммититься
 * в git, (2) config.yml остаётся совместимым с Backlog.md: оригинал читает
 * конфиг switch-ом по известным ключам и вычищает неизвестные поля при
 * записи (saveConfig) — хранить токен там нельзя.
 *
 * Файл читается/пишется через общий core-модуль settings.js: там же живут
 * ленивая миграция legacy bot.yml/settings.yml и env-секция секретов.
 */

import type { AgentName } from './commands.js';
import {
  loadSettings,
  readSettingsEnv,
  saveSettingsPatch,
  settingsPath,
} from '../core/settings.js';

/** Настройки бота: привязанные чаты и опции фаз (секреты — в env-секции settings.json). */
export interface BotSettings {
  /** Привязанные chat_id (команда /start в чате). */
  chats: number[];
  /** Маппинг «тип задачи → стиль кнопки» rich-вывода /tasks (VL-82). */
  task_type_styles?: Record<string, string>;
  /** Агент по умолчанию для команд фаз и кнопок действий (VL-94, /set). */
  default_agent?: AgentName;
  /** Лимит времени фазы в секундах (VL-104, /set max-wall-time). */
  max_wall_time?: number;
  /** Лимит LLM-запросов фазы, ходов модели (VL-104, /set max-requests). */
  max_requests?: number;
  /**
   * VL-306: порог loop detection — сколько одинаковых подряд вызовов считать
   * зацикливанием (/set loop-detection-repeat). Ключ отсутствует — агент берёт
   * дефолт 3. Поле LoopLimits.loopDetectionRepeat существовало с VL-83, но
   * никто его не передавал: порог нельзя было изменить без правки кода.
   */
  loop_detection_repeat?: number;
  /**
   * VL-308: сбрасывать накопленные лимиты loop detection при resume
   * (`/set reset-limits-on-resume`). Дефолт — сброс включён (per-run
   * семантика, как у max-tool-calls и wall-time): `blocked_signatures` из меты
   * сессии не подаются в лимиты нового рана. `false` — прежнее поведение
   * VL-251 (сигнатуры переносятся, защита от лупа после «Продолжить»).
   */
  reset_limits_on_resume?: boolean;
  /**
   * VL-274: idle-таймаут фазы в секундах (/set idle-timeout). `0` — watchdog
   * выключен, ключ отсутствует — агент берёт дефолт 600 с. В отличие от
   * прочих числовых настроек 0 здесь НЕ сброс, а явное выключение.
   */
  idle_timeout_seconds?: number;
  /**
   * Режим параллельной разработки (VL-107, /set branch-mode): фазы задач
   * выполняются в git worktree ветки vb/vl-N, backlog — общий в главном репо.
   */
  branch_mode?: boolean;
  /**
   * Компакшн истории LLM-запроса (VL-122, /set compact): false — выключает
   * усечение истории; по умолчанию включён (undefined = вкл).
   */
  compact?: boolean;
  /**
   * Запуск фазы code в той же сессии агента, что и plan (VL-147,
   * /set code-same-session): code продолжает plan-сессию через --resume —
   * экономия входных токенов за счёт кэша большого контекста. По умолчанию
   * выключен (undefined = off, текущее поведение сохраняется).
   */
  code_same_session?: boolean;
  /**
   * VL-302: трейлер `Co-authored-by: vibelog-agent <vb@xw2.ru>` в сообщениях
   * коммитов (framework-коммиты и шаги `git commit` в шаблонах фаз). Ключа
   * нет — включено; выключение только явным `false` (битая настройка не
   * должна молча отключать функцию).
   */
  commit_coauthor?: boolean;
  /**
   * Лимиты веб-чата (VL-269): секция `chat` settings.json. Значения — в
   * секундах/штуках, как их видит пользователь; ключ отсутствует, если
   * пользователь его не задавал (тогда чат берёт дефолт из chat-limits.ts).
   */
  chat?: ChatSectionSettings;
  /**
   * VL-317: сверка цены вендора с каталогом (секция `pricing_guard`).
   * Хранится как есть (сырым объектом): значения валидирует и подставляет
   * дефолты `resolvePricingGuard` из core/pricing-guard.ts — страница
   * настроек не должна дублировать правила валидации.
   */
  pricing_guard?: Record<string, unknown>;
}

/** Лимиты веб-чата в том виде, в котором они лежат в settings.json. */
export interface ChatSectionSettings {
  /** Максимум итераций LLM-цикла на ход (дефолт 8). */
  max_iterations?: number;
  /** Общий бюджет хода, секунды (дефолт 120). */
  max_wall_time?: number;
  /** Максимум авто-продолжений подряд на клиенте (дефолт 3). */
  max_auto_continue?: number;
  /** Таймаут одного вызова модели, секунды (дефолт 90). */
  call_timeout?: number;
}

/** Ключи секции chat — единый список для чтения/записи валидации. */
export const CHAT_SECTION_KEYS = [
  'max_iterations',
  'max_wall_time',
  'max_auto_continue',
  'call_timeout',
] as const;

/**
 * Секция `chat` из сырого settings.json: только положительные целые числа.
 * Мусор (0, отрицательное, строка, дробное) отбрасывается как отсутствующий
 * ключ — чат возьмёт дефолт (VL-269, lesson-117: битая настройка не отключает
 * рабочие дефолты).
 */
function readChatSection(raw: unknown): ChatSectionSettings | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: ChatSectionSettings = {};
  for (const key of CHAT_SECTION_KEYS) {
    const value = readPositiveInt(src[key]);
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Стили кнопок, поддерживаемые Telegram Rich Messages (VL-82).
 * Больше значений нет — API отклонит или покажет дефолтный стиль.
 */
export const VALID_TASK_STYLES = ['danger', 'success', 'primary', 'link'];

/**
 * Дефолтный маппинг «тип задачи → стиль кнопки» (VL-82).
 * В settings.json не записывается — пользователь переопределяет только нужное,
 * дефолты живут в коде (иначе файл засоряется при каждом save).
 */
export const DEFAULT_TASK_TYPE_STYLES: Record<string, string> = {
  bug: 'danger',
  feature: 'success',
  enhancement: 'primary',
  epic: 'primary',
};

/**
 * Извлекает пользовательские стили типов задач из YAML-значения (VL-82).
 *
 * Принимает только объект string→string; нестроки и стили вне
 * VALID_TASK_STYLES отбрасываются — в settings.json не должны жить значения,
 * которые Telegram отклонит.
 */
function extractTaskTypeStyles(raw: unknown): Record<string, string> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [type, style] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof style === 'string' && VALID_TASK_STYLES.includes(style)) out[type] = style;
  }
  return out;
}

/** Путь к файлу настроек бота (общий settings.json, VL-143). */
export function botSettingsPath(cwd: string): string {
  return settingsPath(cwd);
}

/** Читает настройки бота; отсутствующий файл → пустые настройки + дефолты стилей. */
export function loadBotSettings(cwd: string): BotSettings {
  const raw = loadSettings(cwd);
  const chats = Array.isArray(raw.chats) ? raw.chats : [];
  // Валидация при чтении (VL-94): битое значение в settings.json не должно
  // попадать в запуски — неизвестный агент игнорируется (дефолт qwen)
  const defaultAgent =
    raw.default_agent === 'vb' || raw.default_agent === 'qwen' ? raw.default_agent : undefined;
  // Лимиты фаз (VL-104): положительное целое; битое значение игнорируется —
  // агент получит флаг только при валидной настройке
  const maxWallTime = readPositiveInt(raw.max_wall_time);
  const maxRequests = readPositiveInt(raw.max_requests);
  // VL-306: порог loop detection — положительное целое, битое значение
  // игнорируется (агент возьмёт дефолт 3)
  const loopDetectionRepeat = readPositiveInt(raw.loop_detection_repeat);
  // VL-308: сброс лимитов loop detection при resume — только строгое false
  // (явный opt-out); true/мусор → undefined → дефолт «сброс включён»
  const resetLimitsOnResume = raw.reset_limits_on_resume === false ? false : undefined;
  // VL-274: idle-таймаут читается терпимо, но 0 — валидное значение
  // («watchdog выключен»), поэтому нужен отдельный неотрицательный ридер.
  // Битое значение откатывается к дефолту агента (600 с) с предупреждением в
  // logTail — настройка не должна молча отключать watchdog (AC4).
  let idleTimeout = readNonNegativeInt(raw.idle_timeout_seconds);
  if (idleTimeout === undefined && raw.idle_timeout_seconds !== undefined) {
    console.error(
      `[vibelog-settings] idle_timeout_seconds: ожидается неотрицательное целое (0 — выключено), ` +
        `получено ${JSON.stringify(raw.idle_timeout_seconds)} — используется дефолт агента`,
    );
    idleTimeout = undefined;
  }
  // Режим параллельной разработки (VL-107): только строгое true; любое другое
  // значение (false, строка, мусор) → undefined → resolveBranchMode даст false
  const branchMode = raw.branch_mode === true ? true : undefined;
  // Компакшн истории (VL-122): по умолчанию включён — читается только строгое
  // false (/set compact off); true/мусор → undefined → включён
  const compact = raw.compact === false ? false : undefined;
  // Code в сессии Plan (VL-147): только строгое true; любое другое значение
  // (false, строка, мусор) → undefined → resolveCodeSameSession даст false
  const codeSameSession = raw.code_same_session === true ? true : undefined;
  // VL-302: трейлер Co-authored-by — только строгое false выключает
  // (нет ключа/мусор → undefined → resolveCommitCoauthor даст true)
  const commitCoauthor = raw.commit_coauthor === false ? false : undefined;
  // Лимиты веб-чата (VL-269): секция chat, только положительные целые
  const chat = readChatSection(raw.chat);
  // VL-317: секция pricing_guard отдаётся в API/UI как есть — терпимый
  // парсинг с дефолтами живёт в core/pricing-guard.ts (единый источник)
  const pricingGuard =
    raw.pricing_guard !== null &&
    typeof raw.pricing_guard === 'object' &&
    !Array.isArray(raw.pricing_guard)
      ? (raw.pricing_guard as Record<string, unknown>)
      : undefined;
  return {
    chats: chats.map(Number).filter((n) => Number.isFinite(n)),
    ...(defaultAgent ? { default_agent: defaultAgent } : {}),
    ...(maxWallTime !== undefined ? { max_wall_time: maxWallTime } : {}),
    ...(maxRequests !== undefined ? { max_requests: maxRequests } : {}),
    ...(loopDetectionRepeat !== undefined ? { loop_detection_repeat: loopDetectionRepeat } : {}),
    // VL-308: false — явный opt-out (перенос сигнатур, поведение VL-251)
    ...(resetLimitsOnResume !== undefined ? { reset_limits_on_resume: resetLimitsOnResume } : {}),
    // VL-274: 0 пишется явно (watchdog выключен) — undefined ключ не создаёт
    ...(idleTimeout !== undefined ? { idle_timeout_seconds: idleTimeout } : {}),
    ...(branchMode !== undefined ? { branch_mode: branchMode } : {}),
    ...(compact !== undefined ? { compact } : {}),
    ...(codeSameSession !== undefined ? { code_same_session: codeSameSession } : {}),
    ...(commitCoauthor !== undefined ? { commit_coauthor: commitCoauthor } : {}),
    ...(chat !== undefined ? { chat } : {}),
    ...(pricingGuard !== undefined ? { pricing_guard: pricingGuard } : {}),
    // Пользовательские записи перекрывают дефолты; поле всегда объект —
    // handlers не пишет ?? {} (VL-82)
    task_type_styles: { ...DEFAULT_TASK_TYPE_STYLES, ...extractTaskTypeStyles(raw.task_type_styles) },
  };
}

/**
 * Положительное целое из значения настроек (VL-104); иначе undefined.
 * Number(null)/Number('') === 0 — не проходят проверку n > 0.
 */
function readPositiveInt(raw: unknown): number | undefined {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Неотрицательное целое из значения настроек (VL-274); иначе undefined.
 *
 * Отличие от readPositiveInt — допускается `0` (idle-таймаут: 0 = watchdog
 * выключен). null/undefined/'' отсутствующим значением не считаются: `null`
 * дал бы Number(null) === 0 и молча выключил watchdog — отвергаем явно.
 */
function readNonNegativeInt(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * Сохраняет настройки бота (создаёт .vibelog/ при необходимости).
 *
 * Read-modify-write через saveSettingsPatch: env-секция и git_user_name
 * сохраняются (VL-143). Поля со значением undefined попадают в патч явно —
 * saveSettingsPatch удалит их ключи (сброс /set max-wall-time 0 и т.п.).
 */
export function saveBotSettings(cwd: string, settings: BotSettings): void {
  // task_type_styles пишем только валидные пользовательские переопределения
  // (VL-82): дефолты в settings.json не записываем — файл не засоряется
  const userStyles = extractTaskTypeStyles(settings.task_type_styles);
  // Явный патч: BotSettings — интерфейс без index signature,
  // прямое приведение к Record<string, unknown> TS отклоняет
  const patch: Record<string, unknown> = {
    chats: settings.chats,
    default_agent: settings.default_agent,
    max_wall_time: settings.max_wall_time,
    max_requests: settings.max_requests,
    // VL-306: порог loop detection (undefined удаляет ключ — сброс к дефолту 3)
    loop_detection_repeat: settings.loop_detection_repeat,
    // VL-308: false — явный opt-out; undefined удаляет ключ (дефолт — сброс)
    reset_limits_on_resume: settings.reset_limits_on_resume,
    // VL-274: idle-таймаут пишется и при 0 (явное выключение watchdog)
    idle_timeout_seconds: settings.idle_timeout_seconds,
    // branch_mode пишем всегда, когда задан (в т.ч. false — /set branch-mode off
    // должен оставить явный ключ в settings.json, а не терять его)
    branch_mode: settings.branch_mode,
    // compact: false — явный ключ /set compact off (default — включён, ключ не нужен)
    compact: settings.compact,
    // code_same_session пишем всегда, когда задан (в т.ч. false — /set
    // code-same-session off должен оставить явный ключ в settings.json)
    code_same_session: settings.code_same_session,
    // VL-302: трейлер Co-authored-by; undefined удаляет ключ (дефолт — включено)
    commit_coauthor: settings.commit_coauthor,
    // VL-269: секция лимитов веб-чата; undefined удаляет ключ (сброс к дефолту)
    chat: settings.chat,
    // VL-317: секция сверки цен; undefined удаляет ключ (все дефолты)
    pricing_guard: settings.pricing_guard,
    task_type_styles: Object.keys(userStyles).length > 0 ? userStyles : undefined,
  };
  saveSettingsPatch(cwd, patch);
}

/**
 * Разрешает токен бота: env TELEGRAM_BOT_TOKEN → env-секция settings.json.
 *
 * @returns токен или null, если нигде не задан
 */
export function resolveToken(cwd: string): string | null {
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  if (envToken) return envToken;
  return readSettingsEnv(cwd).TELEGRAM_BOT_TOKEN ?? null;
}

/**
 * Разрешает прокси для Telegram API: env TELEGRAM_PROXY → env-секция
 * settings.json.
 *
 * Нужен там, где api.telegram.org заблокирован напрямую (например, системный
 * прокси macOS на 127.0.0.1:7070): Node fetch и grammy системный прокси не
 * читают сами. Формат URL: http://host:port.
 *
 * @returns URL прокси или null, если прокси не задан
 */
export function resolveProxy(cwd: string): string | null {
  const envProxy = process.env.TELEGRAM_PROXY;
  if (envProxy) return envProxy;
  return readSettingsEnv(cwd).TELEGRAM_PROXY ?? null;
}

/**
 * Агент по умолчанию для запусков фаз (VL-94): settings.json → 'qwen'.
 * Используется командами фаз и кнопками действий без суффикса :<agent>.
 */
export function resolveDefaultAgent(cwd: string): AgentName {
  return loadBotSettings(cwd).default_agent ?? 'qwen';
}

/**
 * Лимит wall-time фазы из settings.json (VL-104): секунды; undefined — настройка
 * не задана (оркестратор не передаёт --max-wall-time, агент берёт дефолт).
 */
export function resolveMaxWallTime(cwd: string): number | undefined {
  return loadBotSettings(cwd).max_wall_time;
}

/**
 * Лимит LLM-запросов фазы из settings.json (VL-104): число запросов; undefined —
 * настройка не задана (оркестратор не передаёт --max-requests).
 */
export function resolveMaxRequests(cwd: string): number | undefined {
  return loadBotSettings(cwd).max_requests;
}

/**
 * Порог loop detection из settings.json (VL-306): сколько одинаковых подряд
 * вызовов считать зацикливанием; undefined — настройка не задана (оркестратор
 * не передаёт --loop-detection-repeat, агент берёт дефолт 3).
 */
export function resolveLoopDetectionRepeat(cwd: string): number | undefined {
  return loadBotSettings(cwd).loop_detection_repeat;
}

/**
 * Сброс лимитов loop detection при resume из settings.json (VL-308): `false` —
 * явный opt-out (blocked_signatures переносятся из меты, поведение VL-251);
 * `true`/ключа нет — сброс включён (per-run семантика, как у max-tool-calls).
 * Читается перед каждым запуском фазы — /set не требует перезапуска бота.
 */
export function resolveResetLimitsOnResume(cwd: string): boolean {
  return loadBotSettings(cwd).reset_limits_on_resume !== false;
}

/**
 * Idle-таймаут фазы из settings.json (VL-274): секунды; `0` — watchdog выключен,
 * undefined — настройка не задана (оркестратор не передаёт --idle-timeout, агент
 * берёт дефолт 600 с). Читается перед каждым запуском фазы — /set idle-timeout
 * не требует перезапуска бота.
 */
export function resolveIdleTimeout(cwd: string): number | undefined {
  return loadBotSettings(cwd).idle_timeout_seconds;
}

/**
 * Режим параллельной разработки из settings.json (VL-107): true — фазы задач
 * выполняются в git worktree ветки vb/vl-N; дефолт false (прежнее поведение).
 * Читается перед каждым запуском фазы — включение/выключение не требует
 * перезапуска бота.
 */
export function resolveBranchMode(cwd: string): boolean {
  return loadBotSettings(cwd).branch_mode === true;
}

/**
 * Запуск code в сессии plan из settings.json (VL-147): true — фаза code
 * продолжает plan-сессию агента через --resume (экономия входных токенов);
 * дефолт false (прежнее поведение). Читается перед каждым запуском фазы —
 * /set code-same-session не требует перезапуска бота. Явный флаг команды
 * (--same-session/--no-same-session, sameSession в API) переопределяет.
 */
export function resolveCodeSameSession(cwd: string): boolean {
  return loadBotSettings(cwd).code_same_session === true;
}
