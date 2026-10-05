/**
 * Рендер Rich Markdown для Telegram Rich Messages (VL-39).
 *
 * Используется sendRichMessage (InputRichMessage.markdown) — GFM-синтаксис:
 * # заголовки, **жирный**, task lists, blockquotes. Лимит 32768 символов
 * (вместо 4096 у sendMessage) — разбивка нужна только для гигантских задач.
 *
 * Markdown-файлы задач уже GFM-совместимы — контент вставляется как есть;
 * служебные строки (меты, авторы) собираются здесь. ``` внутри контента
 * экранируются, чтобы не ломать структуру сообщения; сырые rich-теги
 * контента оборачиваются в code-разметку (VL-81).
 *
 * Чистые функции без I/O — юнит-тестируемые.
 */

import type { ChecklistItem, Task } from '../core/task.js';
import type { DiffFile, GitCommit } from '../core/git.js';
import type { DocumentEntry } from '../core/document.js';
import type { PhaseRun } from '../web/orchestrator.js';
import { VALID_TASK_STYLES } from './settings.js';

/** Лимит Rich Message по спецификации Telegram (символов UTF-8). */
export const RICH_LIMIT = 32768;

/**
 * Максимум кнопок в одном <tg-button-row> (VL-82 fix).
 *
 * InputRichBlockButtons (@grammyjs/types rich.d.ts): «List of 1-8 buttons
 * to send». Больше 8 кнопок в ряду → сервер отвечает 400
 * RICH_MESSAGE_BUTTONS_TOO_MANY и rich-сообщение уходит в фолбэк.
 */
export const BUTTONS_PER_ROW = 8;

/**
 * Экранирует последовательности ``` внутри пользовательского контента.
 *
 * Тройные обратные слэши ломают блоки кода GFM — заменяем на безопасную
 * комбинацию (одиночные backticks с пробелом), не меняя читаемость.
 */
function fenceSafe(text: string): string {
  return text.replace(/```/g, '` ` `');
}
/** Имена rich-тегов, которые парсер Telegram интерпретирует как элементы (VL-81). */
const RICH_TAG = 'tg-button-row|tg-button|details|summary';

/** Тег rich-разметки (с атрибутами) — версия без /g для безопасного .test. */
const RICH_TAG_RE = new RegExp(`</?(?:${RICH_TAG})[^<>]*>`);

/** Тот же паттерн с флагом /g — для replace по всем вхождениям. */
const RICH_TAG_G_RE = new RegExp(`</?(?:${RICH_TAG})[^<>]*>`, 'g');

/**
 * Внутренняя пара одинаковых rich-тегов с содержимым без вложенных тегов.
 *
 * Нужна для распознавания «строк целиком из тегов»: вырезая пары изнутри
 * наружу, получаем только обычный текст, если он есть (иначе строка
 * считается теговой и уходит в fenced-блок).
 */
const INNER_PAIR_G_RE = new RegExp(`<(${RICH_TAG})[^<>]*>[^<>]*<\\/\\1>`, 'g');

/** Маркер fence-блока в контенте: настоящий ``` или экранированный fenceSafe ` ` `. */
const FENCE_MARKER_RE = /^\s*(?:```|` ` `)\s*$/;

/**
 * Оборачивает сырые rich-теги пользовательского контента в code-разметку (VL-81).
 *
 * Сырые <tg-button>/<details>/<summary> в теле задачи парсер Telegram
 * интерпретирует как настоящие элементы: дублируют кнопки карточки и ломают
 * вложенные <details> секций. Строки целиком из тегов складываются в
 * fenced-блок, теги вперемешку с текстом — в inline-бэкитики. Теги, уже
 * находящиеся внутри inline-кода, не изменяются (richTagInlineSafe).
 *
 * Маркеры бывших ```-блоков (` ` ` после fenceSafe) fenced-блоком в Telegram
 * НЕ являются — их содержимое обрабатывается наравне с обычным: регион целиком
 * из теговых строк уходит в настоящий fenced-блок, а маркеры поглощаются.
 * Иначе сырые теги между маркерами парсер интерпретирует как элементы и
 * ломает карточку (сломанный вывод VL-81 после первой итерации фикса).
 */
function richTagsSafe(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let group: string[] = [];
  // Отложенный маркер fence-блока: выпущен в вывод, только если окружающие
  // его строки не оказались теговыми (тогда маркер поглощается fence-блоком)
  let pendingMarker: string | null = null;

  // Сброс накопленных теговых строк одним fenced-блоком
  const flush = (): void => {
    if (group.length === 0) return;
    out.push('```', ...group, '```');
    group = [];
  };

  for (const line of lines) {
    if (FENCE_MARKER_RE.test(line)) {
      if (group.length > 0) {
        // Закрывающий маркер вокруг теговой группы — поглощаем: группа уже
        // уходит в настоящий fenced-блок
        flush();
        pendingMarker = null;
        continue;
      }
      // Открывающий маркер: откладываем — проглотим, если далее только теги
      if (pendingMarker !== null) out.push(pendingMarker);
      pendingMarker = line;
      continue;
    }
    if (richTagOnlyLine(line)) {
      group.push(line);
      continue;
    }
    // Обычная строка: отложенный маркер оказался вне тегового региона —
    // выпускаем его как текст (экранированный fenceSafe-артефакт)
    if (pendingMarker !== null) {
      out.push(pendingMarker);
      pendingMarker = null;
    }
    flush();
    out.push(richTagInlineSafe(line));
  }
  if (pendingMarker !== null) out.push(pendingMarker);
  flush();
  return out.join('\n');
}

/** Строка целиком из rich-тегов (и их содержимого), без обычного текста. */
function richTagOnlyLine(line: string): boolean {
  if (!RICH_TAG_RE.test(line)) return false;
  // Вырезаем внутренние пары вместе с содержимым (снаружи внутрь), затем
  // одиночные теги; остаток с обычным текстом делает строку «смешанной»
  let s = line;
  let prev: string;
  do {
    prev = s;
    s = s.replace(INNER_PAIR_G_RE, '');
  } while (s !== prev);
  s = s.replace(RICH_TAG_G_RE, '');
  return s.trim().length === 0;
}

/** Сегмент строки: код-спан (не изменять) или обычный текст. */
type CodeSegment = { code: boolean; text: string };

/**
 * Разбивает строку на код-спаны и обычный текст по правилам markdown.
 *
 * Спан — ран из N бэктиков, закрытый следующим раном той же длины; раны
 * другой длины спан не закрывают. Незакрытый ран — литеральный текст.
 * Теги внутри спанов уже в коде — richTagInlineSafe их не трогает: повторная
 * обёртка добавляет бэктики внутрь спана, ломает его пары и выталкивает
 * сырой тег наружу (сломанное форматирование VL-81).
 */
function codeSpans(line: string): CodeSegment[] {
  const segs: CodeSegment[] = [];
  let textStart = 0;
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      i++;
      continue;
    }
    // Текущий ран бэктиков [i, j)
    let j = i;
    while (j < line.length && line[j] === '`') j++;
    const runLen = j - i;
    // Ищем закрывающий ран той же длины после текущего
    let k = j;
    let close = -1;
    while (k < line.length) {
      if (line[k] !== '`') {
        k++;
        continue;
      }
      let m = k;
      while (m < line.length && line[m] === '`') m++;
      if (m - k === runLen) {
        close = m;
        break;
      }
      k = m;
    }
    if (close === -1) {
      // Незакрытый ран — литеральный текст, продолжаем поиск после него
      i = j;
      continue;
    }
    if (i > textStart) segs.push({ code: false, text: line.slice(textStart, i) });
    segs.push({ code: true, text: line.slice(i, close) });
    textStart = close;
    i = close;
  }
  if (textStart < line.length) segs.push({ code: false, text: line.slice(textStart) });
  return segs;
}

/** Оборачивает каждый rich-тег фрагмента в inline-код (VL-81). */
function wrapRichTags(text: string): string {
  return text.replace(RICH_TAG_G_RE, (tag) => {
    // Бэктик внутри атрибутов ломает одинарный inline-код — берём двойной
    const wrap = tag.includes('`') ? '``' : '`';
    return wrap + tag + wrap;
  });
}

/**
 * Оборачивает rich-теги строки в inline-код (VL-81).
 *
 * Теги внутри существующих code-спанов не изменяются — см. codeSpans.
 */
function richTagInlineSafe(line: string): string {
  return codeSpans(line)
    .map((seg) => (seg.code ? seg.text : wrapRichTags(seg.text)))
    .join('');
}


/**
 * Защита контента задачи перед вставкой в rich-разметку (VL-81).
 *
 * Композит: сначала fenceSafe (гасит ``` — richTagsSafe вставляет бэктики,
 * которые не должны попасть под замену), затем richTagsSafe.
 */
function contentSafe(text: string): string {
  return richTagsSafe(fenceSafe(text));
}

/** Нормализует элемент чеклиста: строка → {text, unchecked}. */
function checklistItem(item: ChecklistItem | string): { text: string; checked: boolean } {
  if (typeof item === 'string') return { text: item, checked: false };
  return { text: item.text, checked: item.checked };
}

/** Пустая ли секция (строка/массив без содержимого). */
function filled(value: string | (ChecklistItem | string)[] | undefined): boolean {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  return value.trim().length > 0;
}

/**
 * Блок секции карточки в expand-детали <details> (VL-78).
 *
 * Описание открывается по умолчанию (open=true) — суть задачи видна сразу;
 * остальные секции свёрнуты, шапка с метой остаётся вне details.
 * Поддерживается rich-сообщениями Telegram; фолбэк MarkdownV2 details
 * не содержит (formatTaskDetail не трогаем — по спеке VL-78).
 */
function section(title: string, content: string, open = false): string {
  if (!content.trim()) return '';
  const attr = open ? ' open' : '';
  return `<details${attr}><summary>${title}</summary>\n\n${content.trim()}\n\n</details>\n`;
}

/** Чеклист AC/DoD → task list GFM: - [x] / - [ ]. */
function checklist(items: (ChecklistItem | string)[]): string {
  return items
    .map((raw) => {
      const { text, checked } = checklistItem(raw);
      return `- [${checked ? 'x' : ' '}] ${contentSafe(text)}`;
    })
    .join('\n');
}

/** Следующая фаза workflow для статуса задачи (VL-72). */
export type NextPhase = { phase: 'spec' | 'plan' | 'code' | 'close'; label: string };

/**
 * Маппинг статус → следующая фаза workflow (VL-72).
 *
 * Статусы по умолчанию из config.ts; Done/Blocked/неизвестные → null —
 * фаза не запускается, кнопка в карточке не показывается.
 */
export function nextPhaseForStatus(status: string): NextPhase | null {
  switch (status) {
    case 'To Do':
      return { phase: 'spec', label: 'Spec' };
    case 'Spec':
      return { phase: 'plan', label: 'Plan' };
    case 'Planned':
    case 'In Progress':
      return { phase: 'code', label: 'Code' };
    case 'Review':
      return { phase: 'close', label: 'Close' };
    default:
      return null;
  }
}

/**
 * Эмодзи фазы для label кнопки следующего этапа (VL-78).
 *
 * Карта — ТОЛЬКО для кнопки rich-рендера: nextPhaseForStatus() не меняется,
 * иначе сломаются тексты уведомлений («Фаза Plan запускается…») и тесты.
 */
export const PHASE_EMOJI: Record<NextPhase['phase'], string> = {
  spec: '▶',
  plan: '📋',
  code: '💻',
  close: '✅',
};

/**
 * Собирает полный Rich Markdown карточки задачи.
 *
 * @param task — задача (поля frontmatter + секции тела)
 * @returns GFM-разметка для InputRichMessage.markdown
 */
export function renderTaskRich(task: Task): string {
  const parts: string[] = [];

  // Шапка: жирный заголовок + строка меты
  parts.push(`# ${task.id} — ${task.title}\n`);

  // VL-72/VL-78: callback-кнопки сразу после заголовка, в центрированном
  // row: primary — следующий этап (label с эмодзи PHASE_EMOJI), success —
  // «Комментарий» (показывается всегда: комментарий уместен к любой задаче,
  // включая Done/Blocked). Формат tg-button-row — по @grammyjs/types
  // rich.d.ts; callback-данные next:<id>/comment:<id> обрабатывает
  // bot.on('callback_query') в handlers.ts.
  const next = nextPhaseForStatus(task.status);
  const buttons: string[] = [];
  if (next) {
    buttons.push(
      `<tg-button type="callback_data" style="primary" data="next:${task.id}">${PHASE_EMOJI[next.phase]} ${next.label}</tg-button>`
    );
  }
  buttons.push(
    `<tg-button type="callback_data" style="success" data="comment:${task.id}">💬 Комментарий</tg-button>`
  );
  parts.push(`<tg-button-row align="center">\n${buttons.join('\n')}\n</tg-button-row>\n`);

  const meta: string[] = [];
  if (task.status) meta.push(`**Статус:** ${task.status}`);
  if (task.priority) meta.push(`**Приоритет:** ${task.priority}`);
  if (task.assignee.length > 0) meta.push(`**Исполнители:** ${task.assignee.join(', ')}`);
  if (task.labels.length > 0) meta.push(`**Метки:** ${task.labels.join(', ')}`);
  if (task.due_date) meta.push(`**Срок:** ${task.due_date}`);
  if (meta.length > 0) parts.push(meta.join('  \n') + '\n');

  if (filled(task.description)) {
    // Описание — единственная секция, открытая по умолчанию (VL-78)
    parts.push(section('Описание', contentSafe(task.description), true));
  }
  if (filled(task.acceptanceCriteria)) {
    parts.push(section('Acceptance Criteria', checklist(task.acceptanceCriteria)));
  }
  if (filled(task.definitionOfDone)) {
    parts.push(section('Definition of Done', checklist(task.definitionOfDone)));
  }
  if (filled(task.implementationPlan)) {
    parts.push(section('Implementation Plan', contentSafe(task.implementationPlan)));
  }
  if (filled(task.implementationNotes)) {
    parts.push(section('Implementation Notes', contentSafe(task.implementationNotes)));
  }
  if (filled(task.finalSummary)) {
    parts.push(section('Final Summary', contentSafe(task.finalSummary)));
  }
  if (task.comments.length > 0) {
    const comments = task.comments
      .map((c) => `**${c.author}** · ${c.created}\n\n${contentSafe(c.text)}`)
      .join('\n\n---\n\n');
    parts.push(section('Комментарии', comments));
  }

  return parts.join('\n').trim();
}

/** Ячейка HTML-таблицы: экранирует `&`, `<`, `>` сущностями, переводы строк → пробел (VL-82). */
function cellSafe(text: string): string {
  // `&` экранируется первым — иначе подстановка &#38; сама превратится в &amp;38;
  return text
    .replace(/&/g, '&#38;')
    .replace(/</g, '&#60;')
    .replace(/>/g, '&#62;')
    .replace(/\r?\n/g, ' ');
}

/**
 * Rich-рендер списка задач: таблица + callback-кнопки (VL-82).
 *
 * Структура: HTML-таблица <table bordered striped compact> с колонками
 * ID/Заголовок/Статус/Тип/Приоритет (ID жирный — <b>) и <tg-button-row> с кнопками
 * task:<id> под таблицей (кнопки дробятся по BUTTONS_PER_ROW=8 на ряд —
 * лимит Telegram, RICH_MESSAGE_BUTTONS_TOO_MANY). Telegram не принимает
 * кнопки внутри ячеек таблицы
 * (rich-таблицы — только inline-форматирование), поэтому колонка «кнопка»
 * реализована отдельным блоком кнопок; связь — по тексту VL-N в первом столбце.
 *
 * Ячейки — HTML (<tr>/<th>/<td>), а НЕ GFM-строки | ... |: по спецификации
 * rich.d.ts <table> парсится как Rich HTML и принимает только HTML-структуру;
 * GFM внутри <table> Telegram показывает сырым текстом (жалоба Pavel
 * 2026-10-04: форматирование таблицы не рендерилось).
 * Фильтр Done и порядок строк — на стороне вызывающего (handlers /tasks):
 * рендер ничего не сортирует и не фильтрует. Пустой список → ''.
 *
 * @param tasks — невыполненные задачи в порядке вывода
 * @param styles — маппинг тип→стиль кнопки (task_type_styles из bot.yml)
 * @param active — маппинг taskId → активная фаза агента (VL-91); пустой — без пометок
 */
export function renderTasksRich(
  tasks: Task[],
  styles: Record<string, string>,
  active: Record<string, string> = {}
): string {
  if (tasks.length === 0) return '';
  // HTML-таблица по Rich HTML (rich.d.ts): <th> — шапка, <td> — строки.
  // GFM pipe-строки внутри <table> Telegram не парсит и показывает сырым
  // текстом (fix VL-82): markdown-режим парсит <table> как HTML-элемент,
  // его содержимое обязано быть в структуре <tr>/<td>
  const header =
    '<tr><th>ID</th><th>Заголовок</th><th>Статус</th><th>Тип</th><th>Приоритет</th></tr>';
  const rows = tasks.map((t) => {
    // VL-91: строка задачи с активной фазой агента помечается 🔄 + фаза
    // в ячейке ID; фазу прогоняем через cellSafe (спецсимволы HTML)
    const idCell =
      active[t.id] !== undefined
        ? `<b>${cellSafe(t.id)}</b> 🔄 ${cellSafe(active[t.id])}`
        : `<b>${cellSafe(t.id)}</b>`;
    return `<tr><td>${idCell}</td><td>${cellSafe(t.title)}</td><td>${cellSafe(t.status)}</td><td>${cellSafe(t.type)}</td><td>${cellSafe(t.priority)}</td></tr>`;
  });
  const table = ['<table bordered striped compact>', header, ...rows, '</table>'].join('\n');
  const buttons = tasks.map((t) => {
    const style = styles[t.type];
    // Неизвестный тип или невалидный стиль → атрибут style опускается:
    // Telegram покажет кнопку в дефолтном стиле
    const styleAttr =
      style !== undefined && VALID_TASK_STYLES.includes(style) ? ` style="${style}"` : '';
    return `<tg-button type="callback_data"${styleAttr} data="task:${t.id}">${t.id}</tg-button>`;
  });
  // Telegram принимает максимум 8 кнопок в одном ряду (BUTTONS_PER_ROW):
  // при большем числе сервер отвечает 400 RICH_MESSAGE_BUTTONS_TOO_MANY
  // и весь rich-вывод /tasks уходит в MarkdownV2-фолбэк. Дробим длинный
  // список на несколько рядов; порядок кнопок сохраняется.
  const buttonRows: string[] = [];
  for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
    buttonRows.push(
      `<tg-button-row>\n${buttons.slice(i, i + BUTTONS_PER_ROW).join('\n')}\n</tg-button-row>`
    );
  }
  return `${table}\n\n${buttonRows.join('\n')}`;
}

/**
 * Rich-рендер списка документов: таблица + callback-кнопки (VL-89).
 *
 * Полный аналог renderTasksRich (VL-82): HTML-<table bordered striped compact>
 * с колонками ID/Заголовок/Тип/Теги (ID жирный — <b>) и <tg-button-row>
 * с кнопками doc:<id> под таблицей. Кнопки дробятся по BUTTONS_PER_ROW=8 —
 * лимит Telegram (RICH_MESSAGE_BUTTONS_TOO_MANY). Стили task_type_styles
 * НЕ применяются — документы не имеют типов задач. Пустой список → ''.
 *
 * @param entries — документы в порядке вывода
 */
export function renderDocsRich(entries: DocumentEntry[]): string {
  if (entries.length === 0) return '';
  // HTML-таблица по Rich HTML (rich.d.ts) — паттерн renderTasksRich (VL-82)
  const header = '<tr><th>ID</th><th>Заголовок</th><th>Тип</th><th>Теги</th></tr>';
  const rows = entries.map(
    (e) =>
      `<tr><td><b>${cellSafe(e.document.id)}</b></td><td>${cellSafe(e.document.title)}</td><td>${cellSafe(e.document.type)}</td><td>${cellSafe(e.document.tags.join(', '))}</td></tr>`
  );
  const table = ['<table bordered striped compact>', header, ...rows, '</table>'].join('\n');
  const buttons = entries.map(
    (e) =>
      `<tg-button type="callback_data" data="doc:${e.document.id}">${e.document.id}</tg-button>`
  );
  // Дробление по BUTTONS_PER_ROW — лимит Telegram (паттерн renderTasksRich)
  const buttonRows: string[] = [];
  for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
    buttonRows.push(
      `<tg-button-row>\n${buttons.slice(i, i + BUTTONS_PER_ROW).join('\n')}\n</tg-button-row>`
    );
  }
  return `${table}\n\n${buttonRows.join('\n')}`;
}

/**
 * Rich-рендер карточки документа: метаданные + тело (VL-89).
 *
 * Аналог renderTaskRich без кнопок фаз (у документа нет workflow).
 * Тело — через contentSafe (защита VL-81 от сырых rich-тегов) в секции
 * «Содержимое», открытой по умолчанию; пустое тело — секция не выводится.
 * Пустые меты опускаются (паттерн renderTaskRich).
 *
 * @param entry — документ (метаданные + тело)
 */
export function renderDocumentRich(entry: DocumentEntry): string {
  const parts: string[] = [];
  parts.push(`# ${entry.document.id} — ${entry.document.title}\n`);
  const meta: string[] = [];
  if (entry.document.type) meta.push(`**Тип:** ${entry.document.type}`);
  if (entry.document.created_date) meta.push(`**Создан:** ${entry.document.created_date}`);
  if (entry.document.tags.length > 0) meta.push(`**Теги:** ${entry.document.tags.join(', ')}`);
  if (meta.length > 0) parts.push(meta.join('  \n') + '\n');
  if (entry.body.trim()) {
    parts.push(section('Содержимое', contentSafe(entry.body), true));
  }
  return parts.join('\n').trim();
}

/**
 * Rich-рендер git-статуса для команды /diff (VL-88).
 *
 * HTML-таблица <table bordered striped compact> (паттерн renderTasksRich):
 * колонки «Файл | Статус | Строки (+/−)». Staged — метка « (staged)»,
 * не сливается с unstaged; renamed — «new ← old» (оба через cellSafe).
 * Возврат без кнопок — у git-файлов нет callback-действий. Пустой вход → ''.
 *
 * @param files — незакоммиченные файлы (getGitStatus)
 * @param branch — имя ветки для заголовка
 */
export function renderDiffRich(files: DiffFile[], branch: string): string {
  if (files.length === 0) return '';
  const header = '<tr><th>Файл</th><th>Статус</th><th>Строки (+/−)</th></tr>';
  const rows = files.map((f) => {
    // renamed: «new ← old» — оба пути через cellSafe, ячейка не ломается
    const path = f.oldPath ? `${cellSafe(f.path)} ← ${cellSafe(f.oldPath)}` : cellSafe(f.path);
    const status = cellSafe(f.status) + (f.staged ? ' (staged)' : '');
    return `<tr><td><b>${path}</b></td><td>${status}</td><td>+${f.additions}/−${f.deletions}</td></tr>`;
  });
  const table = ['<table bordered striped compact>', header, ...rows, '</table>'].join('\n');
  return `# 📝 Незакоммиченные изменения — \`${branch}\`\n\n${table}`;
}

/**
 * Rich-рендер таблицы коммитов для команды /commits (VL-90).
 *
 * Паттерн renderDiffRich (VL-88): HTML-<table bordered striped compact>,
 * колонки «Тема | Дата | Автор | Хеш»; все поля через cellSafe (защита
 * от сырых HTML-тегов в темах/именах). Возврат без кнопок — git-коммиты
 * не имеют callback-действий. Пустой вход → ''.
 *
 * @param commits — коммиты из getGitLog (последние первыми)
 */
export function renderCommitsRich(commits: GitCommit[]): string {
  if (commits.length === 0) return '';
  const header = '<tr><th>Тема</th><th>Дата</th><th>Автор</th><th>Хеш</th></tr>';
  const rows = commits.map(
    (c) =>
      `<tr><td>${cellSafe(c.subject)}</td><td>${cellSafe(c.date)}</td><td>${cellSafe(c.author)}</td><td><code>${cellSafe(c.hash)}</code></td></tr>`
  );
  const table = ['<table bordered striped compact>', header, ...rows, '</table>'].join('\n');
  return `# 📜 Последние коммиты\n\n${table}`;
}

/**
 * Rich-рендер информационного сообщения о завершении фазы (VL-71).
 *
 * GFM без MarkdownV2-экранирования: # заголовок, **жирный**, session_id
 * в одинарных backticks; фолбэк-logTail — в тройных backticks (fenceSafe).
 * Шаблон VL-63/65 сохранён: статус, результат, токены, время, session_id.
 * MarkdownV2-версия (formatPhaseResult) остаётся фолбэком для старых
 * Telegram-клиентов — паттерн sendTaskView → formatTaskDetail.
 *
 * @param run — завершённый запуск фазы из оркестратора (getRun)
 */
export function renderPhaseResultRich(run: PhaseRun): string {
  const res = run.result;
  const errFlag = res?.is_error === true;
  const status =
    run.exitCode === 0 && !errFlag
      ? `# Фаза ${run.phase ?? '—'}: завершена (код 0)`
      : `# Фаза ${run.phase ?? '—'}: ошибка (код ${run.exitCode ?? '—'})` +
        (errFlag ? ' (ошибка qwen)' : '');
  if (!res) {
    // Фолбэк без данных результата: хвост лога в блоке кода — экранирование
    // не нужно (GFM), fenceSafe гасит вложенные тройные backticks
    const tail = (run.logTail ?? '').trim();
    const cut = tail.length > 800 ? tail.slice(0, 800) + '…' : tail;
    return [status, '', '**Данные результата недоступны**', '```', fenceSafe(cut), '```'].join('\n');
  }
  const body =
    res.result.length > 1500 ? res.result.slice(0, 1500) + '…' : res.result;
  const lines = [
    status,
    '',
    body,
    '',
    `**Входные токены:** ${res.usage.input_tokens}`,
    `**Сгенерированные токены:** ${res.usage.output_tokens}`,
    `**Кэш-токены:** ${res.usage.cache_read_input_tokens}`,
    `**Всего токенов:** ${res.usage.total_tokens}`,
    '',
    `**Общее время:** ${res.duration_ms} мс (api: ${res.duration_api_ms} мс)`,
    `**Количество запросов:** ${res.num_turns}`,
  ];
  // VL-93: единый формат вывода сессии '<agent>:<session_id>' для ВСЕХ агентов
  // (жалоба Pavel 2026-10-05: qwen тоже с префиксом — qwen:<uuid>); agent
  // не задан у старых запусков — дефолт qwen; префикс только буквы/двоеточие
  if (res.session_id) lines.push('', '`' + (run.agent ?? 'qwen') + ':' + res.session_id + '`');
  return lines.join('\n');
}

/**
 * Разбивает длинный текст на части не больше limit по границам абзацев.
 *
 * На практике не задействуется (лимит 32768 — запас для гигантских задач),
 * но защищает от отказа API при экстремальных данных.
 *
 * @param text — Rich Markdown целиком
 * @param limit — максимальная длина части (по умолчанию RICH_LIMIT)
 */
export function chunkRich(text: string, limit: number = RICH_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    // Ищем границу абзаца/секции в пределах лимита
    const slice = rest.slice(0, limit);
    const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'));
    const cut = breakAt > limit * 0.5 ? breakAt : limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
