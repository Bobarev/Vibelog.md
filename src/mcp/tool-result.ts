/**
 * Единый контракт ответа write-инструментов MCP (VL-262).
 *
 * Проблема, которую модуль решает: раньше write-инструменты отвечали
 * строкой-текстом («Задача X обновлена: title, type»), состав применённого
 * вычислялся из ПЕРЕДАННЫХ полей, а не из фактически записанных. Агент после
 * отказа подтверждения не мог отличить «применилось всё» от «применилось
 * частично» и не знал, какие поля записались (инцидент VL-254/VL-256:
 * `title`/`type` изменились, `labels`/`priority` — нет).
 *
 * Контракт: JSON со снимком результата —
 *   { ok, message, applied: {field: value}, skipped: [{field, reason}] }
 * `message` СОХРАНЯЕТ прежние русские формулировки («Задача X создана: …»,
 * «Задача X обновлена: …»): на них завязаны существующие проверки в тестах и
 * в промптах фаз — формат ответа меняется, привычные подстроки остаются.
 *
 * Четыре формы ответа:
 *   успех  — { ok: true, message, applied, skipped, idempotentReplay? }
 *   noop   — { ok: false, noop: true, reason: 'noop', message, applied,
 *            skipped: [] } (VL-303/VL-304: переданные значения уже были в
 *            задаче, файл не переписан)
 *   отказ  — { ok: false, denied: true, reason, applied: {}, skipped, … }
 *   ошибка — { ok: false, error }
 *
 * VL-304: noop — ОШИБКА, а не успех (lesson-92). До VL-304 noop отдавался как
 * `{ok:true, noop:true}`, и модель читала первую строку JSON как «принято,
 * продолжай»: текст «не повторяй» лежал в третьем поле и слабыми моделями не
 * взвешивался (сессия agent-1793631554185 — 4 повтора и падение фазы кодом 1).
 * Теперь `ok:false` + `reason:'noop'`, а MCP-сервер отдаёт такой ответ с
 * `isError: true` (см. `isNoopAck`).
 *
 * Отказ подтверждения (веб-чат) кодируется машиночитаемо:
 *   { ok: false, denied: true, reason: 'denied' | 'not_confirmed', … }
 * Различие принципиально для агента: `denied` — пользователь явно отказал
 * (повтор без нового решения бессмыслен), `not_confirmed` — подтверждение
 * не получено (вызов не дошёл до диалога; повтор с тем же idempotencyKey
 * безопасен). До VL-262 оба случая выглядели как произвольный текст в {error}.
 */

/** Поле, переданное в вызове, но не применённое к задаче. */
export interface SkippedField {
  /** Имя переданного поля (как в аргументах вызова). */
  field: string;
  /** Почему не применено — текст для модели. */
  reason: string;
}

/** Причина отказа подтверждения: явный отказ пользователя vs отсутствие подтверждения. */
export type DenyReason = 'denied' | 'not_confirmed';

/**
 * Единый исход вызова инструмента (VL-357, tool outcome protocol v2).
 *
 * До VL-357 ответ инструмента был НАБОРОМ независимых флагов (`ok`, `noop`,
 * `denied`, `read`, `error`, `missing`, `hint`, `retryWith`), которые
 * комбинировались свободно. Отсюда два класса инцидентов одного корня:
 * «применили часть, но ответ выглядит как отказ» (VL-355) и «создали
 * сущность, но ответ выглядит как ошибка» (VL-356). Теперь исход ОДИН и
 * объявляется инструментом, а совместимые флаги (`ok`/`noop`/`denied`/`read`)
 * вычисляются из него при сериализации.
 *
 * - `applied`  — операция выполнена полностью;
 * - `partial`  — запись состоялась, но часть обязательных по смыслу полей не
 *   заполнена (`next.missing`) — не отказ;
 * - `noop`     — запись ничего не изменила (все переданные значения уже были);
 * - `rejected` — операция не выполнена: ошибка валидации либо отказ
 *   подтверждения (`denied`/`reason` проставляются отдельно);
 * - `read`     — чистое чтение внутри инструмента, эффекта не было;
 * - `unknown`  — исход не определён (плоский текст, не-JSON ответ).
 */
export type ToolOutcome = 'applied' | 'partial' | 'noop' | 'rejected' | 'read' | 'unknown';

/** Следующий шаг для модели — единое место (было разбросано по флагам). */
export interface ToolNext {
  /** Готовые аргументы, которые надо добавить/изменить в вызове (VL-353). */
  retryWith?: Record<string, unknown>;
  /** Обязательные по смыслу, но не заполненные поля (VL-319/VL-355). */
  missing?: SkippedField[];
  /** Текстовая подсказка следующего шага. */
  hint?: string;
}

/** Внутреннее описание ack'а: исход + данные, флаги НЕ хранятся. */
export interface ToolAckInput {
  outcome: ToolOutcome;
  message?: string;
  applied?: Record<string, unknown>;
  skipped?: SkippedField[];
  next?: ToolNext;
  /** Текст ошибки (исход `rejected` по причине ошибки валидации). */
  error?: string;
  /** Причина отказа: `noop` | `denied` | `not_confirmed`. */
  reason?: string;
  /** Явный признак отказа подтверждения — вычисляется из `reason` вызывающим. */
  denied?: boolean;
  /** Имя инструмента (в ответе отказа подтверждения). */
  tool?: string;
  /** Ответ восстановлен из кэша идемпотентности. */
  idempotentReplay?: boolean;
  /**
   * VL-359: дополнительные машиночитаемые поля ответа (аддитивно).
   *
   * Нужны guard-ответам веб-чата (`duplicate`/`limit`/`noop_repeat`): они
   * отдают исход через `serializeAck`, но модель и тесты читают и флаг
   * причины. Ключи, уже вычисленные из `outcome` (`ok`/`outcome`/`noop`/
   * `reason`/…), НЕ перезаписываются — `extra` только добавляет.
   */
  extra?: Record<string, unknown>;
}

/**
 * Сериализует ack, ВЫЧИСЛЯЯ совместимые флаги из `outcome`.
 *
 * Флаги не хранятся в объекте (AC1): единственный источник правды — исход.
 * Порядок ключей стабилен, чтобы диффы и разборы сессий читались одинаково.
 * Тексты `message` не меняются (инвариант VL-262) — меняется только форма.
 */
export function serializeAck(ack: ToolAckInput): string {
  const out: Record<string, unknown> = {};
  const ok = ack.outcome === 'applied' || ack.outcome === 'partial' || ack.outcome === 'read';
  out.ok = ok;
  out.outcome = ack.outcome;
  if (ack.outcome === 'noop') {
    out.noop = true;
    out.reason = ack.reason ?? 'noop';
  }
  if (ack.outcome === 'read') out.read = true;
  if (ack.denied === true) out.denied = true;
  if (ack.reason !== undefined && out.reason === undefined) out.reason = ack.reason;
  if (ack.tool !== undefined) out.tool = ack.tool;
  if (ack.error !== undefined) out.error = ack.error;
  if (ack.message !== undefined) out.message = ack.message;
  if (ack.applied !== undefined) out.applied = ack.applied;
  if (ack.skipped !== undefined) out.skipped = ack.skipped;
  const next = ack.next ?? {};
  if (next.missing !== undefined && next.missing.length > 0) out.missing = next.missing;
  if (next.hint !== undefined && next.hint !== '') out.hint = next.hint;
  if (next.retryWith !== undefined && Object.keys(next.retryWith).length > 0) out.retryWith = next.retryWith;
  if (ack.idempotentReplay === true) out.idempotentReplay = true;
  // VL-359: аддитивные поля (guard-ответы веб-чата: duplicate/limit/noop_repeat).
  // Вычисленные из `outcome` ключи не перезаписываются — исход остаётся
  // единственным источником правды.
  if (ack.extra !== undefined) {
    for (const [key, value] of Object.entries(ack.extra)) {
      if (out[key] === undefined) out[key] = value;
    }
  }
  return JSON.stringify(out, null, 2);
}

/** Снимок успешного применения write-вызова. */
export interface WriteAck {
  ok: true;
  /** Человекочитаемая строка (прежние формулировки инструментов сохранены). */
  message: string;
  /** Реально записанные поля: значение — из файла задачи после записи. */
  applied: Record<string, unknown>;
  /** Переданные, но не применённые поля (неизвестное имя, null и т.п.). */
  skipped: SkippedField[];
  /** true — ответ взят из кэша идемпотентности, повторного эффекта не было. */
  idempotentReplay?: true;
  /**
   * VL-355: обязательные по смыслу поля, которые НЕ заполнены в сущности и НЕ
   * переданы в вызове, хотя запись состоялась. Отличается от `skipped`:
   * пропуск не помешал применить остальные поля (на уроке-скелете можно
   * привязать задачу, но тело остаётся пустым).
   */
  missing?: SkippedField[];
  /** VL-355: следующий шаг для модели в успешном ответе (что дописать). */
  hint?: string;
}

/**
 * Снимок write-вызова, который НЕ изменил состояние (VL-303, форма — VL-304).
 *
 * Отдельный интерфейс, а не флаг `WriteAck`: noop — самостоятельная семантика
 * («изменений нет, файл не переписан»), и её нельзя случайно получить из
 * общего пути успеха. `ok: false` — принципиально (lesson-92): нейтральный
 * `ok: true` модель читает как «принято, продолжай» и повторяет вызов до
 * loop detection, хотя все изменения уже применены (инцидент VL-302).
 */
export interface NoopAck {
  ok: false;
  noop: true;
  reason: 'noop';
  /** Текст с перечнем полей и указанием следующего шага. */
  message: string;
  /** Фактическое состояние полей (из задачи, без записи). */
  applied: Record<string, unknown>;
  skipped: [];
  /**
   * VL-319: поля, которые по смыслу обязательны, но НЕ заполнены в сущности
   * и НЕ переданы в вызове. Без этого списка модель видела только «изменений
   * нет» и повторяла вызов дословно (сессия agent-1793712738536: урок с
   * пустым телом, 4 повтора `lesson_update` без `content` → кап → fail).
   */
  missing?: SkippedField[];
  /** VL-319: следующий шаг для модели (что именно поменять в аргументах). */
  hint?: string;
}

/**
 * Формирует ответ успешного write-вызова.
 *
 * @param message — прежняя текстовая формулировка инструмента («… создана: …»)
 * @param applied — фактически записанные поля со значениями из задачи
 * @param skipped — переданные, но не применённые поля
 * @param idempotentReplay — ответ восстановлен по idempotencyKey
 */
export function ackOk(
  message: string,
  applied: Record<string, unknown> = {},
  skipped: SkippedField[] = [],
  idempotentReplay = false,
): string {
  return serializeAck({
    outcome: 'applied',
    message,
    applied,
    skipped,
    ...(idempotentReplay ? { idempotentReplay: true } : {}),
  });
}

/**
 * Формирует ответ успешного write-вызова с незаполненными полями (VL-355).
 *
 * Зачем отдельный хелпер: `ackOk` не умеет сообщать о пропущенном
 * обязательном поле, а `ackErrorDetailed` означает «ничего не применено».
 * Возник случай «применили часть, но урок остался незаполненным»: на
 * уроке-скелете модель привязывала задачу (`linkedTasks`) и получала ОТКАЗ
 * целиком, потому что не было `content` (сессия agent-1794053090709 —
 * 6 дословных повторов `lesson_update` → `MAX_ERROR_REPEATS_PER_RUN` → fail,
 * Close VL-346 в тупике). Теперь остальные поля применяются, а `missing`/
 * `hint` предупреждают о незаполненном теле.
 *
 * @param message — человекочитаемая строка результата
 * @param applied — фактически записанные поля (значения из сущности после записи)
 * @param skipped — переданные, но не применённые поля
 * @param extra — missing/hint (предупреждение, а не блокировка)
 */
export function ackOkDetailed(
  message: string,
  applied: Record<string, unknown> = {},
  skipped: SkippedField[] = [],
  extra: { missing?: SkippedField[]; hint?: string } = {},
): string {
  const missing = extra.missing ?? [];
  // VL-357: незаполненное обязательное по смыслу поле делает исход `partial`,
  // а не `applied` — это и есть «запись состоялась, но не завершена».
  return serializeAck({
    outcome: missing.length > 0 ? 'partial' : 'applied',
    message,
    applied,
    skipped,
    next: { ...(missing.length > 0 ? { missing } : {}), ...(extra.hint ? { hint: extra.hint } : {}) },
  });
}

/**
 * Формирует ответ write-вызова, который НЕ изменил состояние (VL-303/VL-304).
 *
 * `ok: false` + `reason: 'noop'` — возврат к lesson-92: no-op вызов это
 * ошибка, а не успех. MCP-сервер отдаёт такой ответ с `isError: true`
 * (см. `isNoopAck`), поэтому модель видит ошибку в первой строке JSON, а не
 * «принято» — и переходит к следующему шагу вместо повтора.
 *
 * @param message — текст с перечнем полей и указанием следующего шага
 * @param applied — фактическое состояние полей (из задачи, без записи)
 */
export function ackNoop(message: string, applied: Record<string, unknown> = {}): string {
  return ackNoopDetailed(message, applied);
}

/**
 * Формирует ответ ЧТЕНИЯ внутри write-инструмента (VL-351).
 *
 * Зачем отдельная форма: `backlog_manage_ac`/`backlog_manage_dod` классифицируются
 * как write по имени (токен `manage` в `WRITE_MARKERS`), но ветка `action:list`
 * ничего не пишет. Плоский текст в этой ветке цикл агента принимал за
 * «применённую запись» (страховка VL-306), и повтор чтения получал ложную
 * директиву «уже применён ранее» (сессия agent-1794047067509, Close VL-349).
 *
 * `read: true` — машиночитаемый признак «это чтение, эффекта не было»: цикл
 * (`src/agent/loop.ts`) не пополняет такой ответ ни `appliedSignatures`, ни
 * `noopSignatures`, поэтому повтор исполняется заново и отдаёт свежее
 * состояние. Форма совместима с `ackOk` (`ok: true`, `message`, `applied`),
 * поэтому существующие проверки текста и JSON-контракт не ломаются.
 *
 * @param message — прежняя текстовая формулировка инструмента
 * @param applied — прочитанное состояние (снимок, не запись)
 */
export function ackRead(message: string, applied: Record<string, unknown> = {}): string {
  return serializeAck({ outcome: 'read', message, applied, skipped: [] });
}

/**
 * Формирует noop-ответ с перечнем НЕЗАПОЛНЕННЫХ обязательных полей (VL-319).
 *
 * Зачем отдельный хелпер: noop-ответ «изменений нет» не сообщает, ЧЕГО в
 * вызове не хватает. Модель читает `applied` (переданные поля) как «всё
 * применено» и повторяет вызов дословно — сессия agent-1793712738536
 * (Close VL-318) сделала 4 повтора `lesson_update` без `content` на уроке с
 * пустым телом, кап `MAX_NOOP_REPEATS_PER_RUN` уронил ран, авто-resume
 * перезапустил фазу, и цикл повторился. `missing` называет пропуск прямо,
 * `hint` — что именно поменять в аргументах.
 *
 * @param message — текст с перечнем полей и указанием следующего шага
 * @param applied — фактическое состояние полей (из задачи, без записи)
 * @param missing — обязательные по смыслу, но не заполненные поля
 * @param hint — следующий шаг для модели
 */
export function ackNoopDetailed(
  message: string,
  applied: Record<string, unknown> = {},
  missing: SkippedField[] = [],
  hint?: string,
): string {
  // VL-326: hint есть ВСЕГДА. Без него модель читала noop как «ошибка
  // инструмента» и повторяла вызов дословно (инцидент VL-324: 12 повторов
  // `backlog_update_task` с уже применёнными полями). Универсальный текст
  // называет главное: переданные поля уже такие, нужны ДРУГИЕ поля в этом
  // же вызове. Вызывающий может передать свой, более конкретный hint.
  return serializeAck({
    outcome: 'noop',
    message,
    applied,
    skipped: [],
    next: {
      ...(missing.length > 0 ? { missing } : {}),
      hint: hint ?? NOOP_DEFAULT_HINT,
    },
  });
}

/**
 * Универсальный `hint` noop-ответа (VL-326).
 *
 * Формулировка намеренно не упоминает `backlog_finish_phase`: в веб-чате
 * этого инструмента нет, и прежний текст «Следующий шаг: backlog_finish_phase»
 * уводил модель в тупик. Главный сигнал — «поля уже такие, передай другие».
 */
export const NOOP_DEFAULT_HINT =
  'Переданные поля уже имеют эти значения — файл не переписан. ' +
  'Если нужны другие изменения, передай их в ЭТОМ ЖЕ вызове (например, description, acceptanceCriteria, plan); ' +
  'повтор с теми же аргументами ничего не изменит.';

/**
 * Распознаёт noop-ответ write-инструмента (VL-304).
 *
 * Нужен MCP-серверу: noop — это `isError: true` на транспортной границе, но
 * `handleToolCall` остаётся строковым (его используют веб-чат и десятки
 * тестов), поэтому признак вычисляется из текста ответа.
 *
 * @param text — текст tool-результата
 * @returns true, если ответ — JSON-снимок с `noop: true`
 */
export function isNoopAck(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { outcome?: unknown; noop?: unknown } | null;
    if (parsed === null || typeof parsed !== 'object') return false;
    // VL-357: исход — единственный источник правды; `noop` остаётся
    // вычисляемым флагом для потребителей, читающих ответ по старинке.
    return parsed.outcome === 'noop' || parsed.noop === true;
  } catch {
    return false; // не JSON — не write-ack
  }
}

/**
 * Поля, сравниваемые как множества (порядок не значим) — VL-303/VL-310.
 *
 * Общий набор для Super-сущностей с одинаковыми именами полей: задача
 * (`labels`, `assignee`, …), урок (`tags`, `source_tasks`, …). Сущности со
 * своим набором (документ/веб-страница, reference) передают его явно —
 * см. `DOC_SET_FIELDS`/`REFERENCE_SET_FIELDS` в `tools.ts`.
 */
export const SET_FIELDS = ['labels', 'assignee', 'references', 'lessons', 'modified_files', 'dependencies'];

/**
 * Поле-псевдоним тела документа в объекте сверки (VL-310).
 *
 * У документа (и reference) тело лежит НЕ в метаданных, а отдельным полем
 * `body` записи (`DocumentEntry`/`ReferenceEntry`), тогда как в аргументах
 * вызова оно называется `content`/`description`. Чтобы сверка «всё уже так»
 * работала единым `sameValue`, тело передаётся в объекте-снимке под этим
 * ключом и не может совпасть с реальным именем frontmatter-поля.
 */
export const BODY_FIELD = '__body';

/**
 * Сравнивает переданное значение поля с текущим (VL-303, вынесено в VL-310).
 *
 * Нужен для noop-детекта: если все переданные поля уже имеют запрошенные
 * значения, файл не переписывается. Правила сравнения:
 * - массивы-множества (`setFields`) — порядок не значим: модель может
 *   перечислить те же метки в другом порядке, это не изменение;
 * - `acceptanceCriteria` — по текстам в порядке + все текущие пункты
 *   неотмечены (переданный чеклист всегда создаётся неотмеченным, VL-219);
 * - тело сущности (`BODY_FIELD`) — строковое `===`: сравнение двух строк
 *   (даже 100 КБ) движок делает без создания копий и прерывается на первом
 *   различии, поэтому выделенный хэш не нужен (риск «длинного сравнения» в
 *   плане VL-310 снят замером семантики: `===` на строках не копирует тело).
 * - остальное (строки, числа, `parent_task_id`, секции тела) — строгое `===`.
 *   `type` приходит уже нормализованным через `normalizeTaskType`.
 */
export function sameValue(
  field: string,
  next: unknown,
  current: unknown,
  setFields: readonly string[] = SET_FIELDS,
): boolean {
  if (setFields.includes(field)) {
    const a = Array.isArray(next) ? next.map(String) : [];
    const b = Array.isArray(current) ? current.map(String) : [];
    if (a.length !== b.length) return false;
    const setB = new Set(b);
    return a.every(v => setB.has(v));
  }
  if (field === 'acceptanceCriteria') {
    const nextItems = Array.isArray(next) ? next : [];
    const curItems = Array.isArray(current) ? current : [];
    if (nextItems.length !== curItems.length) return false;
    return nextItems.every((item, i) => {
      const nextText = typeof item === 'string' ? item : String((item as { text?: unknown }).text ?? '');
      const cur = curItems[i];
      const curText = typeof cur === 'string' ? cur : String((cur as { text?: unknown }).text ?? '');
      const curChecked = typeof cur === 'string' ? false : Boolean((cur as { checked?: unknown }).checked);
      return nextText === curText && !curChecked;
    });
  }
  if (field === BODY_FIELD) {
    return typeof next === 'string' && typeof current === 'string' && next === current;
  }
  return next === current;
}

/**
 * Проверяет, что ВСЕ переданные значения уже равны текущим (VL-310).
 *
 * Общая точка noop-детекции для write-инструментов (lesson-37: одна
 * реализация вместо копий): инструмент собирает `updates` из аргументов и
 * передаёт снимок текущего состояния сущности (`current`) вместе со своим
 * набором полей-множеств.
 *
 * @param current — текущее состояние полей (для тела — `BODY_FIELD`)
 * @param updates — переданные поля (что модель просит записать)
 * @param setFields — поля, сравниваемые как множества
 * @returns true — запись ничего не изменит (можно отвечать noop)
 */
export function sameFieldsUpToDate(
  current: Record<string, unknown>,
  updates: Record<string, unknown>,
  setFields: readonly string[] = SET_FIELDS,
): boolean {
  return Object.keys(updates).every(key => sameValue(key, updates[key], current[key], setFields));
}

/**
 * Формирует ответ отказа подтверждения.
 *
 * `applied` всегда пуст (отказ = ни одного изменения), `skipped` перечисляет
 * ВСЕ переданные поля — агент видит, что именно НЕ записалось, без повторного
 * чтения задачи.
 *
 * @param reason — 'denied' (пользователь отказал) или 'not_confirmed' (подтверждение не получено)
 * @param extra — имя инструмента и переданные поля (идут в skipped)
 */
export function ackDenied(
  reason: DenyReason,
  extra: { tool?: string; fields?: string[]; message?: string } = {},
): string {
  const fields = extra.fields ?? [];
  const denied = reason === 'denied';
  // Кастомный текст отказа (например, reason из UI) приоритетнее дефолтного,
  // но семантика в reason/hint сохраняется — контракт машиночитаем.
  const message = extra.message?.trim()
    ? extra.message.trim()
    : denied
      ? 'Пользователь отклонил операцию — изменения НЕ применены.'
      : 'Подтверждение не получено (вызов не дошёл до диалога) — изменения НЕ применены.';
  // hint — следующий шаг для модели: разная семантика отказа требует разных действий
  const hint = denied
    ? 'Повтор без нового решения пользователя бессмыслен: спроси, что именно изменить.'
    : 'Это не отказ пользователя: вызов можно безопасно повторить с тем же idempotencyKey.';
  return serializeAck({
    outcome: 'rejected',
    denied: true,
    reason,
    tool: extra.tool,
    message,
    applied: {},
    skipped: fields.map(field => ({ field, reason: 'не применено: нет подтверждения' })),
    next: { hint },
  });
}

/**
 * Формирует ответ-ошибку в том же JSON-контракте.
 *
 * Единая форма для ошибок инструментов в веб-чате: модель видит `ok:false`
 * и текст, а не произвольную строку/сырое исключение.
 *
 * @param message — текст ошибки
 */
export function ackError(message: string): string {
  return serializeAck({ outcome: 'rejected', error: message });
}

/**
 * Формирует ответ-ошибку с перечнем незаполненных полей (VL-319).
 *
 * Зачем: ошибка «тело урока пустое» должна не только назвать проблему, но и
 * дать машиночитаемый список пропусков (`missing`) и следующий шаг (`hint`) —
 * иначе модель видит текст и повторяет вызов дословно. `applied` перечисляет
 * переданные поля, чтобы модель не приняла их за записанные.
 *
 * @param message — текст ошибки
 * @param extra — missing/hint/applied/retryWith (все опциональны)
 */
export function ackErrorDetailed(
  message: string,
  extra: {
    missing?: SkippedField[];
    hint?: string;
    applied?: Record<string, unknown>;
    /**
     * VL-353: машиночитаемый набор аргументов, которые надо добавить/изменить
     * в вызове, чтобы он прошёл. Директива loop detection подставляет его в
     * ГОТОВЫЙ вызов (`git_commit {…, "allowForeign": true}`) — описательное
     * «исправь аргументы» слабая модель не выполняет (инцидент
     * agent-1794050949211: 6 дословных повторов `git_commit` без
     * `allowForeign` → кап повторов → fail).
     */
    retryWith?: Record<string, unknown>;
  } = {},
): string {
  const missing = extra.missing ?? [];
  // VL-357: единый исход — отказ с машинoчитаемым продолжением в next.
  return serializeAck({
    outcome: 'rejected',
    error: message,
    applied: extra.applied && Object.keys(extra.applied).length > 0 ? extra.applied : {},
    next: {
      ...(missing.length > 0 ? { missing } : {}),
      ...(extra.hint ? { hint: extra.hint } : {}),
      // VL-353: аддитивное поле — только когда инструмент знает точное
      // исправление. Пустой объект не отдаём: «retryWith: {}» модель прочтёт
      // как «повтори как есть».
      ...(extra.retryWith && Object.keys(extra.retryWith).length > 0 ? { retryWith: extra.retryWith } : {}),
    },
  });
}

/**
 * Считает переданные ключи, которых нет в списке известных полей инструмента.
 *
 * Раньше такие ключи молча игнорировались — агент считал поле записанным
 * (источник «частичности» без единого отказа). Теперь они попадают в skipped.
 *
 * @param args — аргументы вызова
 * @param known — имена поддерживаемых полей (включая служебные вроде id/idempotencyKey)
 */
export function unknownFields(args: Record<string, unknown>, known: readonly string[]): SkippedField[] {
  const result: SkippedField[] = [];
  for (const key of Object.keys(args)) {
    if (!known.includes(key)) {
      result.push({ field: key, reason: 'неизвестное поле инструмента: не записано' });
    }
  }
  return result;
}
