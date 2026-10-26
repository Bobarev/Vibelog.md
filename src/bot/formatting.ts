/**
 * Форматирование данных для Telegram-ответов бота (VL-34, VL-38).
 *
 * Выход — разметка Telegram MarkdownV2: жирные ID/заголовки/метки,
 * статусы в скобках. Динамический текст из backlog ОБЯЗАН экранироваться
 * (escapeMarkdownV2): заголовки и описания задач могут содержать любые
 * спецсимволы MarkdownV2, и неэкранированные ломают парсинг сообщения.
 *
 * Чистые функции без I/O — юнит-тестируемые.
 */

import type { Task } from '../core/task.js';
import type { DiffFile, GitCommit } from '../core/git.js';
import type { DocumentEntry } from '../core/document.js';
import type { PhaseRun } from '../web/orchestrator.js';

/**
 * Экранирует спецсимволы Telegram MarkdownV2.
 *
 * По спецификации Telegram в обычном тексте обязаны экранироваться:
 * _ * [ ] ( ) ~ ` > # + - = | { } . ! и сам обратный слэш.
 *
 * @param text — произвольный текст (заголовок, описание, статус)
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/**
 * Человекочитаемая длительность из миллисекунд (VL-98).
 *
 * До 1с — «830 мс», до минуты — «20с», иначе — «1м 23с».
 * Заменяет сырой вывод «42411 мс» в отчёте фазы: юзеру проще
 * воспринимать минуты/секунды (жалоба Pavel, VL-98).
 *
 * @param ms — длительность в миллисекундах
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} мс`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}с`;
  return `${Math.floor(ms / 60000)}м ${Math.round((ms % 60000) / 1000)}с`;
}

/**
 * Список задач для /tasks: жирный ID, статус в скобках.
 *
 * @param tasks — задачи для отображения
 * @param active — маппинг taskId → активная фаза агента (VL-91): строка
 *   задачи получает префикс 🔄 и фазу в скобках; пустой — без пометок
 */
export function formatTaskList(tasks: Task[], active: Record<string, string> = {}): string {
  if (tasks.length === 0) return 'Задач нет';
  return tasks
    .map((t) => {
      const base = `*${escapeMarkdownV2(t.id)}* — ${escapeMarkdownV2(t.title)} \\[${escapeMarkdownV2(t.status)}\\]`;
      // VL-91: фазу экранируем escapeMarkdownV2 — Telegram отклоняет сообщение
      // с неэкранированными спецсимволами MarkdownV2 (в т.ч. скобками фазы)
      return active[t.id] !== undefined
        ? `🔄 ${base} \\(${escapeMarkdownV2(active[t.id])}\\)`
        : base;
    })
    .join('\n');
}

/**
 * MarkdownV2-список документов для /docs (VL-89).
 *
 * Паттерн formatTaskList: жирный id, тип в скобках. Пустой список →
 * короткий текст «Документов нет» (rich-таблица не строится).
 *
 * @param entries — документы в порядке вывода
 */
export function formatDocsList(entries: DocumentEntry[]): string {
  if (entries.length === 0) return 'Документов нет';
  return entries
    .map(
      (e) =>
        `*${escapeMarkdownV2(e.document.id)}* — ${escapeMarkdownV2(e.document.title)} \\[${escapeMarkdownV2(e.document.type)}\\]`
    )
    .join('\n');
}

/**
 * MarkdownV2-фолбэк /doc: карточка документа (VL-89).
 *
 * Паттерн formatTaskDetail: жирный заголовок, метки полей, тело через
 * escapeMarkdownV2 с усечением >1500 символов (лимит Telegram 4096 —
 * экранирование удваивает длину, режем с большим запасом).
 *
 * @param entry — документ (метаданные + тело)
 */
export function formatDocumentDetail(entry: DocumentEntry): string {
  const lines = [
    `*${escapeMarkdownV2(entry.document.id)} — ${escapeMarkdownV2(entry.document.title)}*`,
    `*Тип:* ${escapeMarkdownV2(entry.document.type)}`,
    `*Создан:* ${escapeMarkdownV2(entry.document.created_date)}`,
  ];
  if (entry.document.tags.length > 0) {
    lines.push(`*Теги:* ${escapeMarkdownV2(entry.document.tags.join(', '))}`);
  }
  if (entry.body) {
    const body = entry.body.length > 1500 ? entry.body.slice(0, 1500) + '…' : entry.body;
    lines.push('', escapeMarkdownV2(body));
  }
  return lines.join('\n');
}

/**
 * MarkdownV2-фолбэк /diff: список незакоммиченных файлов (VL-88).
 *
 * Паттерн formatTaskList: жирный путь, статус в скобках, staged — метка
 * « · staged», счётчики +N/−N; ветка — первая строка. Пустой вход не
 * вызывается (обработчик шлёт короткий текст до рендера).
 *
 * @param files — незакоммиченные файлы (getGitStatus)
 * @param branch — имя ветки
 */
export function formatDiffList(files: DiffFile[], branch: string): string {
  const lines = [`*Ветка:* ${escapeMarkdownV2(branch)}`];
  for (const f of files) {
    // renamed: «new ← old» — как в renderDiffRich; пути через escapeMarkdownV2
    const path = f.oldPath ? `${f.path} ← ${f.oldPath}` : f.path;
    const staged = f.staged ? ' · staged' : '';
    lines.push(
      `*${escapeMarkdownV2(path)}* \\[${escapeMarkdownV2(f.status)}${staged}\\] +${f.additions}/−${f.deletions}`
    );
  }
  return lines.join('\n');
}

/**
 * MarkdownV2-фолбэк /commits: список коммитов (VL-90).
 *
 * Паттерн formatDiffList: тема, дата в скобках, автор, жирный хеш.
 * Пустой вход не вызывается (обработчик шлёт короткий текст до рендера).
 *
 * @param commits — коммиты из getGitLog (последние первыми)
 */
export function formatCommitsList(commits: GitCommit[]): string {
  return commits
    .map(
      (c) =>
        `${escapeMarkdownV2(c.subject)} \\(${escapeMarkdownV2(c.date)}\\) — ${escapeMarkdownV2(c.author)} *${escapeMarkdownV2(c.hash)}*`
    )
    .join('\n');
}

/**
 * Строка статуса фазы qwen для задачи (VL-43).
 *
 * @param run — запуск фазы из оркестратора (getRun)
 * @returns MarkdownV2-строка либо '' если данных о запуске нет
 */
export function formatPhaseRun(run: PhaseRun | null | undefined): string {
  if (!run || !run.phase) return '';
  const phase = escapeMarkdownV2(run.phase);
  if (run.running) {
    return `*Фаза ${phase}: выполняется \\(PID ${run.pid ?? '—'}\\)*`;
  }
  if (run.exitCode === 0) {
    return `*Фаза ${phase}: завершена \\(код 0\\)*`;
  }
  return `*Фаза ${phase}: ошибка \\(код ${run.exitCode ?? '—'}\\)*`;
}

/**
 * Информационное сообщение о завершении фазы по шаблону VL-63 (VL-65).
 *
 * Статус + финальный ответ qwen + токены + время + session_id — данные
 * берутся из PhaseRun.result (последняя JSON-строка type=result, VL-64).
 * Сырой JSON-лог в чат не шлётся — цель VL-63 убрать нечитаемый вывод.
 *
 * Фолбэк (result отсутствует: ENOENT, обрыв, битый JSON): статус +
 * «Данные результата недоступны» + logTail обрезан до 800 символов.
 *
 * @param run — завершённый запуск фазы из оркестратора (getRun)
 * @param taskId — идентификатор задачи VL-N (VL-98): добавляет суффикс
 *   « — VL-N» в заголовок статуса; undefined (/prompt, resume) — без суффикса
 */
export function formatPhaseResult(run: PhaseRun, taskId?: string): string {
  const phase = escapeMarkdownV2(run.phase ?? '—');
  const res = run.result;
  const errFlag = res?.is_error === true;
  // Суффикс задачи в обоих статусах (завершена и ошибка), VL-98:
  // в MarkdownV2 taskId экранируется (дефис → VL\-98)
  const taskSuffix = taskId ? ` — ${escapeMarkdownV2(taskId)}` : '';
  // Статусная строка формируется заново (не formatPhaseRun): шаблон VL-63
  // задаёт свой вид, а is_error при exit 0 — тоже «ошибка qwen»
  const status =
    (run.exitCode === 0 && !errFlag
      ? `*Фаза ${phase}: завершена \\(код 0\\)*`
      : `*Фаза ${phase}: ошибка \\(код ${run.exitCode ?? '—'}\\)` +
        (errFlag ? ' \\(ошибка qwen\\)' : '')) + taskSuffix;
  if (!res) {
    // Фолбэк: данных результата нет — показываем статус и хвост лога.
    // Хвост ОБЯЗАН экранироваться (escapeMarkdownV2): сырой JSON содержит
    // [ ] ( ) - . ! и прочие спецсимволы MarkdownV2 — без экранирования
    // Telegram отклоняет разметку, сообщение уходит plain и юзер видит
    // литеральные звёздочки и слэши (жалоба Pavel, VL-63).
    const tail = (run.logTail ?? '').trim();
    const cut = tail.length > 800 ? tail.slice(0, 800) + '…' : tail;
    return [status, '', 'Данные результата недоступны', escapeMarkdownV2(cut)]
      .filter((l) => l !== '')
      .join('\n');
  }
  // VL-148: усечение 1500 отменено — длинный результат не теряет хвост:
  // разбивкой на нумерованные сообщения «часть i/N» занимается слой
  // отправки (splitNumbered в sendPhaseResult)
  const body = res.result;
  // VL-98: ответ модели — в цитате MarkdownV2 (каждая строка с "> ",
  // спецсимволы экранируются; "> " в начале строки — валидный blockquote,
  // Bot API ≥ 7.0, серверный парсинг). Срез — до префиксации (срез по
  // старому body, затем prefix — логику среза не ломает)
  const quoted = body
    .split('\n')
    .map((l) => '> ' + escapeMarkdownV2(l))
    .join('\n');
  const lines = [
    status,
    quoted,
    '',
    // VL-98: токены одной строкой + расчёт «входные минус кэш»
    // (кэш-токены уже во входных — разница показывает «свежий» вход)
    `*Токены:* входные: ${res.usage.input_tokens} · сгенерированные: ${res.usage.output_tokens} · кэш: ${res.usage.cache_read_input_tokens} · всего: ${res.usage.total_tokens}`,
    `*Входные минус кэш:* ${res.usage.input_tokens - res.usage.cache_read_input_tokens}`,
    '',
    // VL-98: время в человекочитаемом формате (formatDuration) вместо сырых мс
    `*Общее время:* ${formatDuration(res.duration_ms)} \\(api: ${formatDuration(res.duration_api_ms)}\\)`,
    `*Количество запросов:* ${res.num_turns}`,
  ];
  // session_id — только hex/дефис (UUID) и префикс агента, внутри pre-блока
  // экранирование запрещено MarkdownV2 — вставляем как есть; пустой — строку
  // не шлём. VL-93: единый формат '<agent>:<session_id>' для всех агентов
  // (жалоба Pavel 2026-10-05); agent не задан — дефолт qwen
  if (res.session_id) lines.push('', '`' + (run.agent ?? 'qwen') + ':' + res.session_id + '`');
  return lines.join('\n');
}

/** Лимит длины текстового сообщения Telegram (символов UTF-8). */
export const TELEGRAM_TEXT_LIMIT = 4096;

/**
 * Запас длины под нумерованный суффикс «часть 99/99» (VL-148).
 *
 * Суффикс добавляется к КАЖДОЙ части, поэтому бюджет разреза —
 * limit минус резерв: `15` (GFM «_(часть 99/99)_») или `17`
 * (MarkdownV2 «_часть 99\/99_» с обязательным экранированием `/`)
 * с запасом на многозначные номера.
 */
export const PART_SUFFIX_RESERVE = 32;

/**
 * Разбивает длинный текст на части с нумерацией (VL-148).
 *
 * Общий помощник разбивки для команд бота: длинный результат /analyze
 * (и других шаблонов sendPhaseResult) уходит несколькими последовательными
 * сообщениями «часть i/N» вместо обрезанного одного; короткий текст
 * (≤ limit) возвращается одним элементом без суффикса — без изменений.
 *
 * Разрез — только по границам строк (`\n`): внутристрочный разрез может
 * разорвать escape-последовательность MarkdownV2 (`\x`) и Telegram
 * ответит 400 «can't parse entities». Единственный случай жёсткого
 * разреза — аномально длинная строка сама больше бюджета (приемлемо
 * для строк без MarkdownV2-спецсимволов; таких в отчётах фаз нет).
 *
 * @param text — готовый к отправке текст (уже экранированный вызывающим)
 * @param limit — максимальная длина части вместе с суффиксом
 * @param fmtSuffix — суффикс нумерации (вызывающий выбирает разметку:
 *   GFM italic для rich, экранированный MarkdownV2 для текстового фолбэка)
 */
export function splitNumbered(
  text: string,
  limit: number,
  fmtSuffix: (i: number, n: number) => string
): string[] {
  if (text.length <= limit) return [text];
  // Бюджет тела части: суффикс добавляется после разреза
  const budget = Math.max(1, limit - PART_SUFFIX_RESERVE);
  const chunks: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    const candidate = cur === '' ? line : cur + '\n' + line;
    if (candidate.length <= budget) {
      cur = candidate;
      continue;
    }
    // Текущая часть заполнена — фиксируем и начинаем новую со строки
    if (cur !== '') {
      chunks.push(cur);
      cur = '';
    }
    if (line.length <= budget) {
      cur = line;
    } else {
      // Аномально длинная строка (> бюджета): жёсткий разрез кусками budget
      for (let pos = 0; pos < line.length; pos += budget) {
        const piece = line.slice(pos, pos + budget);
        if (pos + budget < line.length) chunks.push(piece);
        else cur = piece;
      }
    }
  }
  if (cur !== '') chunks.push(cur);
  const n = chunks.length;
  return chunks.map((c, idx) => c + fmtSuffix(idx + 1, n));
}

/**
 * Детали задачи для /task: жирный заголовок, метки полей, описание.
 *
 * @param task — задача
 * @param phaseRun — запуск фазы qwen (VL-43); строка вставляется после статуса
 */
export function formatTaskDetail(task: Task, phaseRun?: PhaseRun): string {
  const lines = [
    `*${escapeMarkdownV2(task.id)} — ${escapeMarkdownV2(task.title)}*`,
    `*Статус:* ${escapeMarkdownV2(task.status)}`,
    `*Приоритет:* ${escapeMarkdownV2(task.priority || '—')}`,
  ];
  // VL-43: строка статуса фазы qwen — сразу после статуса задачи
  const phaseLine = formatPhaseRun(phaseRun);
  if (phaseLine) lines.splice(2, 0, phaseLine);
  if (task.assignee.length > 0) {
    lines.push(`*Исполнители:* ${escapeMarkdownV2(task.assignee.join(', '))}`);
  }
  if (task.labels.length > 0) {
    lines.push(`*Метки:* ${escapeMarkdownV2(task.labels.join(', '))}`);
  }
  if (task.due_date) {
    lines.push(`*Срок:* ${escapeMarkdownV2(task.due_date)}`);
  }
  // Секция «Токены» (VL-198): агрегат token_usage, только при непустых данных
  const tu = task.token_usage;
  if (tu && (tu.total > 0 || tu.input > 0 || tu.requests > 0)) {
    const head =
      `*Токены:* input=${tu.input} output=${tu.output} cache=${tu.cache} ` +
      `total=${tu.total} запросов: ${tu.requests}` +
      (tu.duration_ms ? ` duration=${Math.round(tu.duration_ms / 1000)}с` : '');
    lines.push(escapeMarkdownV2(head));
    const phases = Object.entries(tu.by_phase ?? {});
    if (phases.length > 0) {
      const phaseLine = phases
        .map(([p, v]) => `${p}: in=${v.input} out=${v.output} cache=${v.cache} req=${v.requests}`)
        .join('; ');
      lines.push(escapeMarkdownV2(`По фазам: ${phaseLine}`));
    }
  }
  if (task.description) {
    // Ограничение: Telegram-сообщение — до 4096 символов
    const desc =
      task.description.length > 1500 ? task.description.slice(0, 1500) + '…' : task.description;
    lines.push('', escapeMarkdownV2(desc));
  }
  return lines.join('\n');
}

/**
 * Сводка доски для /board: жирные названия колонок + количество.
 *
 * @param statuses — статусы колонок из конфига
 * @param tasks — все задачи
 */
export function formatBoard(statuses: string[], tasks: Task[]): string {
  if (statuses.length === 0) return 'Статусы не настроены в конфиге';
  return statuses
    .map((s) => `*${escapeMarkdownV2(s)}:* ${tasks.filter((t) => t.status === s).length}`)
    .join('\n');
}
