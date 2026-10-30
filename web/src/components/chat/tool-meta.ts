/**
 * Подписи, чипы и форматирование результатов tool-вызовов (VL-264).
 *
 * Чистый модуль без React: его использует и рендер (`tool-call.tsx`,
 * `approval-card.tsx`, `thread.tsx`), и восстановление истории
 * (`web/src/lib/chat-threads.ts`), и тесты — поэтому здесь нет ни
 * компонентов, ни алиасов сборки.
 *
 * Классификация read/write: источник истины — СЕРВЕР (`isWriteOperation` в
 * `src/web/tool-policy.ts`). Клиент узнаёт природу вызова из события:
 * write-вызов приходит как `approval` (part.approval !== undefined) либо как
 * `tool_start{auto:true}` — заранее разрешённый allow-list'ом. Функция
 * `isWriteTool` ниже — ТОЛЬКО fallback для старых jsonl, где такого флага
 * ещё нет (риск R3 плана: списки маркеров обязаны совпадать — это
 * фиксируется тестом `chat-thread-restore.test.mjs`).
 */

/** Маркеры write-операции в имени инструмента (зеркало src/web/tool-policy.ts). */
const WRITE_MARKERS = [
  "create", "update", "add", "remove", "rename", "archive",
  "manage", "finish", "supersede", "link", "sync", "cache",
  "write", "edit", "delete", "set", "put", "run", "spawn",
  "promote", "reject", "complete", "append", "mkdir",
]

/** Маркеры read-операции (проверяются после write — write приоритетнее). */
const READ_MARKERS = [
  "list", "view", "search", "get", "read", "ready", "glob", "grep", "help", "map",
]

/** Токенизация имени инструмента: lowercase + split по не-буквенно-цифровым. */
function tokenize(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/**
 * Fallback-классификатор write/read для старых jsonl (без флага сервера).
 * Логика дословно повторяет серверный `isWriteOperation` (fail-safe:
 * неизвестное имя → write).
 */
export function isWriteTool(name: string): boolean {
  const tokens = tokenize(name)
  if (tokens.includes("write") || tokens.includes("edit") || tokens.includes("run")) return true
  if (tokens.includes("read") || tokens.includes("grep") || tokens.includes("glob")) return false
  if (tokens.some(t => (WRITE_MARKERS as readonly string[]).includes(t))) return true
  if (tokens.some(t => (READ_MARKERS as readonly string[]).includes(t))) return false
  return true
}

/** Пары (имя → [label, activeLabel]) для подписей тулзов. */
const TOOL_LABELS: Record<string, [string, string]> = {
  // read
  read_file: ["Прочитал файл", "Читаю файл"],
  search_files: ["Нашёл совпадения", "Ищу в файлах"],
  grep_search: ["Нашёл совпадения", "Ищу по regex"],
  glob: ["Нашёл файлы", "Ищу файлы"],
  project_map: ["Карта проекта", "Строю карту проекта"],
  backlog_search: ["Нашёл задачи", "Ищу задачи"],
  backlog_view_task: ["Просмотрел задачу", "Читаю задачу"],
  backlog_list_tasks: ["Список задач", "Загружаю задачи"],
  backlog_ready: ["Готовые задачи", "Проверяю зависимости"],
  document_list: ["Список документов", "Загружаю документы"],
  document_view: ["Просмотрел документ", "Читаю документ"],
  document_search: ["Нашёл документы", "Ищу документы"],
  lesson_list: ["Список уроков", "Загружаю уроки"],
  lesson_view: ["Просмотрел урок", "Читаю урок"],
  lesson_search_lessons: ["Нашёл уроки", "Ищу уроки"],
  reference_view: ["Просмотрел reference", "Читаю reference"],
  reference_list: ["Список references", "Загружаю references"],
  milestone_list: ["Список вех", "Загружаю вехи"],
  // write
  write_file: ["Записал файл", "Записываю файл"],
  backlog_create_task: ["Создал задачу", "Создаю задачу"],
  backlog_update_task: ["Обновил задачу", "Обновляю задачу"],
  backlog_add_comment: ["Добавил комментарий", "Пишу комментарий"],
  backlog_manage_ac: ["Обновил критерии", "Правлю критерии"],
  backlog_manage_dod: ["Обновил DoD", "Правлю DoD"],
  backlog_update_status: ["Сменил статус", "Меняю статус"],
  backlog_update_dependencies: ["Обновил зависимости", "Правлю зависимости"],
  document_create: ["Создал документ", "Создаю документ"],
  document_update: ["Обновил документ", "Обновляю документ"],
  milestone_add: ["Создал веху", "Создаю веху"],
  milestone_rename: ["Переименовал веху", "Переименовываю веху"],
  reference_add: ["Добавил reference", "Добавляю reference"],
}

/** Завершённое действие инструмента (для свёрнутой строки). */
export function toolLabel(name: string): string {
  return TOOL_LABELS[name]?.[0] ?? name
}

/** Действие в процессе (ShimmerLabel). */
export function toolActiveLabel(name: string): string {
  return TOOL_LABELS[name]?.[1] ?? `${name}…`
}

/** Порядок ключей «ключевого аргумента» — по ним строится mono-чип. */
const PRIMARY_ARG_KEYS = ["query", "path", "id", "title", "name", "q", "action", "tool"] as const

/** Обрезка строки с многоточием (по символам, не по байтам). */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/**
 * Ключевой аргумент вызова для чипа в свёрнутой строке:
 * query → path → id → title → name → q (первое непустое, обрезка 60 симв.).
 */
export function primaryArg(args: unknown): string {
  if (typeof args !== "object" || args === null) return ""
  const obj = args as Record<string, unknown>
  for (const key of PRIMARY_ARG_KEYS) {
    const value = obj[key]
    if (typeof value === "string" && value.trim() !== "") return clip(value.trim(), 60)
    if (typeof value === "number") return String(value)
  }
  return ""
}

/** Тело запроса для блока Request (JSON с обрезкой 2000 символов). */
export function formatRequest(args: unknown): string {
  if (args === undefined || args === null) return "—"
  if (typeof args === "string") return clip(args, 2000)
  try {
    return clip(JSON.stringify(args, null, 2), 2000)
  } catch {
    return String(args)
  }
}

/**
 * Человекочитаемый результат для блока Result.
 *
 * Приоритет: текстовый вывод инструмента (строка) → отказ/ошибка
 * (`{error}` или `{ok:false}`) → контракт write-ответов VL-262
 * (`{ok, applied, skipped}`) → JSON с обрезкой.
 */
export function formatResult(result: unknown): string {
  if (result === undefined) return "—"
  if (typeof result === "string") return clip(result, 4000)
  if (typeof result === "object" && result !== null) {
    const obj = result as Record<string, unknown>
    if (typeof obj.error === "string") return clip(obj.error, 3000)
    if (obj.ok === false) {
      const reason = typeof obj.message === "string" ? obj.message : typeof obj.denied === "boolean" && obj.denied ? "Отклонено" : "Не применено"
      return clip(reason, 3000)
    }
    if (obj.ok === true) {
      const applied = Array.isArray(obj.applied) ? obj.applied : []
      const skipped = Array.isArray(obj.skipped) ? obj.skipped : []
      const parts: string[] = []
      if (applied.length > 0) parts.push(`применено: ${applied.map(String).join(", ")}`)
      if (skipped.length > 0) parts.push(`пропущено: ${skipped.map(String).join(", ")}`)
      if (parts.length > 0) return parts.join("; ")
    }
  }
  try {
    return clip(JSON.stringify(result, null, 2), 4000)
  } catch {
    return String(result)
  }
}

/** Пара label/value для блока details approval-карточки. */
export interface ResultDetail {
  label: string
  value: string
}

/**
 * Детали операции для approval-карточки (блок `details` из ref-22):
 * что именно будет записано — по аргументам вызова (результата ещё нет).
 */
export function requestDetails(name: string, args: unknown): ResultDetail[] {
  if (typeof args !== "object" || args === null) return []
  const a = args as Record<string, unknown>
  const out: ResultDetail[] = []
  const push = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim() !== "") out.push({ label, value: clip(value.trim(), 160) })
    else if (typeof value === "number") out.push({ label, value: String(value) })
    else if (Array.isArray(value) && value.length > 0) out.push({ label, value: clip(value.map(String).join(", "), 160) })
  }

  if (name === "write_file") {
    push("path", a.path)
    if (typeof a.content === "string") push("content", `${a.content.length} символов`)
    return out
  }
  if (name === "backlog_create_task") {
    push("title", a.title)
    push("status", a.status)
    push("priority", a.priority)
    return out
  }
  if (name === "backlog_update_task") {
    push("id", a.id)
    const known = ["title", "description", "status", "priority", "milestone", "parentTaskId", "plan", "notes", "finalSummary", "acceptanceCriteria"]
    const fields = known.filter(k => a[k] !== undefined)
    push("fields", fields)
    return out
  }
  if (name === "backlog_manage_ac" || name === "backlog_manage_dod") {
    push("id", a.id)
    push("action", a.action)
    const index = a.index
    if (Array.isArray(index)) push("index", index)
    else if (typeof index === "number" || typeof index === "string") push("index", String(index))
    return out
  }
  if (name === "backlog_add_comment") {
    push("id", a.id)
    if (typeof a.comment === "string") push("comment", a.comment)
    return out
  }
  if (name === "backlog_update_status") {
    push("id", a.id)
    push("status", a.status)
    return out
  }
  // Неизвестный инструмент: показываем ключевые аргументы, чтобы карточка не
  // была пустой (пользователь должен видеть, что подтверждает).
  const primary = primaryArg(args)
  if (primary) push("аргумент", primary)
  return out
}
