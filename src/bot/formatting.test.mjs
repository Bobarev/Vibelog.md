/**
 * Тесты VL-34/VL-38 — форматирование ответов бота (MarkdownV2).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  escapeMarkdownV2,
  formatDuration,
  formatTaskList,
  formatDocsList,
  formatDocumentDetail,
  formatTaskDetail,
  formatPhaseRun,
  formatPhaseResult,
  limitErrorResumeRef,
  splitNumbered,
  formatBoard,
  formatDiffList,
  formatCommitsList,
} from '../../dist/bot/formatting.js';

const task = {
  id: 'VL-1',
  title: 'Тестовая задача',
  status: 'To Do',
  priority: 'High',
  assignee: ['Pavel'],
  reporter: '',
  due_date: '2026-10-05',
  labels: ['backend'],
  description: 'Описание задачи',
  comments: [],
};

describe('formatting (VL-34/VL-38)', () => {
  it('escapeMarkdownV2: все спецсимволы экранированы', () => {
    const raw = '_*[]()~`>#+-=|{}.!\\ text';
    const escaped = escapeMarkdownV2(raw);
    // Каждый спецсимвол предварён обратным слэшем
    assert.equal(escaped, '\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\ text');
  });

  it('escapeMarkdownV2: обычный текст без спецсимволов не меняется', () => {
    assert.equal(escapeMarkdownV2('Обычный текст'), 'Обычный текст');
  });

  it('formatTaskList: жирный ID, статус в скобках', () => {
    const text = formatTaskList([task]);
    assert.match(text, /\*VL\\-1\* — Тестовая задача/);
    assert.match(text, /\\\[To Do\\\]/);
  });

  it('formatTaskList: пустой список', () => {
    assert.match(formatTaskList([]), /Задач нет/);
  });

  it('formatTaskList (VL-91): активная задача — префикс 🔄 и фаза в скобках', () => {
    const text = formatTaskList([task], { 'VL-1': 'plan' });
    assert.match(text, /🔄 \*VL\\-1\*/);
    assert.ok(text.includes('\\(plan\\)'));
  });

  it('formatTaskList (VL-91): дефолт — без 🔄 (регресс)', () => {
    const text = formatTaskList([task]);
    assert.ok(!text.includes('🔄'));
  });

  it('formatTaskList (VL-91): неактивная задача из смешанного списка — без пометки', () => {
    const text = formatTaskList([task, { ...task, id: 'VL-2' }], { 'VL-1': 'plan' });
    const lines = text.split('\n');
    assert.ok(lines[0].includes('🔄'));
    assert.ok(!lines[1].includes('🔄'));
  });

  it('formatTaskDetail: жирный заголовок и метки полей', () => {
    const text = formatTaskDetail(task);
    assert.match(text, /\*VL\\-1 — Тестовая задача\*/);
    assert.match(text, /\*Статус:\* To Do/);
    assert.match(text, /\*Приоритет:\* High/);
    assert.match(text, /\*Исполнители:\* Pavel/);
    assert.match(text, /\*Метки:\* backend/);
    assert.match(text, /\*Срок:\* 2026\\-10\\-05/);
    assert.match(text, /Описание задачи/);
  });

  it('formatTaskDetail: спецсимволы в заголовке экранированы', () => {
    const weird = { ...task, title: 'Фича *x* и [ссылка](http://yandex.ru)' };
    const text = formatTaskDetail(weird);
    assert.match(text, /Фича \\\*x\\\* и \\\[ссылка\\\]\\\(/);
  });

  it('formatBoard: жирные названия колонок', () => {
    const text = formatBoard(['To Do', 'Done'], [task]);
    assert.match(text, /\*To Do:\* 1/);
    assert.match(text, /\*Done:\* 0/);
  });

  it('formatBoard: пустые статусы', () => {
    assert.match(formatBoard([], [task]), /Статусы не настроены/);
  });
});

describe('formatPhaseRun / formatTaskDetail (VL-43)', () => {
  it('formatPhaseRun: выполняется с PID', () => {
    assert.equal(
      formatPhaseRun({ running: true, phase: 'spec', pid: 123 }),
      '*Фаза spec: выполняется \\(PID 123\\)*'
    );
  });

  it('formatPhaseRun: завершена с кодом 0', () => {
    assert.equal(
      formatPhaseRun({ running: false, phase: 'spec', exitCode: 0 }),
      '*Фаза spec: завершена \\(код 0\\)*'
    );
  });

  it('formatPhaseRun: ошибка с кодом и без кода (null)', () => {
    assert.match(formatPhaseRun({ running: false, phase: 'code', exitCode: 1 }), /ошибка/);
    assert.match(formatPhaseRun({ running: false, phase: 'code', exitCode: 1 }), /код 1/);
    assert.match(formatPhaseRun({ running: false, phase: 'code', exitCode: null }), /ошибка/);
  });

  it('formatPhaseRun: нет запуска или фазы → пустая строка', () => {
    assert.equal(formatPhaseRun(null), '');
    assert.equal(formatPhaseRun(undefined), '');
    assert.equal(formatPhaseRun({ running: false }), '');
  });

  it('formatTaskDetail: строка фазы между статусом и приоритетом', () => {
    const text = formatTaskDetail(task, { running: true, phase: 'spec', pid: 42 });
    const statusIdx = text.indexOf('*Статус:*');
    const phaseIdx = text.indexOf('*Фаза spec: выполняется \\(PID 42\\)*');
    const prioIdx = text.indexOf('*Приоритет:*');
    assert.ok(phaseIdx > statusIdx, 'фаза после статуса');
    assert.ok(phaseIdx < prioIdx, 'фаза до приоритета');
  });

  it('formatTaskDetail: без phaseRun — без строки фазы', () => {
    assert.ok(!formatTaskDetail(task).includes('Фаза'));
    assert.ok(!formatTaskDetail(task, undefined).includes('Фаза'));
  });
});

describe('formatPhaseResult (VL-63/VL-65)', () => {
  /** Полный успешный run с result — эталон шаблона VL-63. */
  const okRun = {
    running: false,
    phase: 'comment',
    exitCode: 0,
    finishedAt: '2026-10-03T14:30:00.000Z',
    logTail: 'stub qwen',
    result: {
      result: 'понг',
      is_error: false,
      num_turns: 1,
      duration_ms: 42411,
      duration_api_ms: 42369,
      session_id: 'a470c7dd-2ca8-4510-9d81-b184f932af76',
      usage: {
        input_tokens: 10956,
        output_tokens: 19,
        cache_read_input_tokens: 10944,
        total_tokens: 10975,
      },
    },
  };

  it('успех: все поля шаблона на месте, result и session_id в тексте', () => {
    const text = formatPhaseResult(okRun);
    // includes вместо regex — экранированные скобки MarkdownV2 не мешают
    assert.ok(text.includes('*Фаза comment: завершена \\(код 0\\)*'), 'статус');
    // VL-98: ответ модели — в цитате MarkdownV2 (каждая строка с "> ")
    assert.ok(text.includes('> понг'), 'result в цитате');
    // VL-98: токены одной строкой + расчёт «входные минус кэш»
    assert.ok(
      text.includes('*Токены:* входные: 10956 · сгенерированные: 19 · кэш: 10944 · всего: 10975'),
      'токены одной строкой'
    );
    assert.ok(text.includes('*Входные минус кэш:* 12'), 'входные минус кэш');
    // VL-98: время в человекочитаемом формате (42411 мс → 42с)
    assert.ok(text.includes('*Общее время:* 42с \\(api: 42с\\)'), 'время');
    assert.ok(text.includes('*Количество запросов:* 1'), 'num_turns');
    assert.ok(text.includes('a470c7dd-2ca8-4510-9d81-b184f932af76'), 'session_id');
    // Без taskId (VL-98): суффикса задачи в заголовке нет
    assert.ok(!text.includes('VL-'), 'нет суффикса задачи без taskId');
  });

  it('taskId добавляет суффикс «— VL-N» в заголовок (VL-98)', () => {
    const text = formatPhaseResult(okRun, 'VL-98');
    // В MarkdownV2 taskId экранирован: дефис → \-
    assert.ok(text.includes('*Фаза comment: завершена \\(код 0\\)* — VL\\-98'), 'суффикс в заголовке');
    // Ошибка — тоже получает суффикс (обе ветки статуса)
    const errText = formatPhaseResult({ ...okRun, exitCode: 1, result: { ...okRun.result, is_error: true } }, 'VL-98');
    assert.ok(errText.includes('ошибка qwen) — VL\\-98') || errText.includes('VL\\-98'), 'суффикс при ошибке');
  });

  it('спецсимволы в result экранированы', () => {
    const run = { ...okRun, result: { ...okRun.result, result: 'Фича _x_ и (скобки)!' } };
    const text = formatPhaseResult(run);
    assert.ok(text.includes('Фича \\_x\\_ и \\(скобки\\)\\!'), 'escapeMarkdownV2 применён');
  });

  it('длинный result не обрезается — полный текст в цитате (VL-148)', () => {
    const run = { ...okRun, result: { ...okRun.result, result: 'x'.repeat(2000) } };
    const text = formatPhaseResult(run);
    const bodyLine = text.split('\n')[1];
    // VL-148: усечение 1500 отменено — разбивкой занимается sendPhaseResult
    assert.equal(bodyLine.length, 2002); // '> ' + 2000 x (VL-98: цитата)
    assert.ok(bodyLine.startsWith('> '), 'префикс цитаты');
    assert.ok(!text.includes('…'), 'нет многоточия-усечения');
  });

  it('фолбэк: logTail экранирован для MarkdownV2 (VL-63 фикс)', () => {
    // Сырой JSON в хвосте ломал разметку Telegram: сообщение уходило plain
    // с литеральными \( и звёздочками — юзер видел нечитаемый вывод
    const run = {
      running: false,
      phase: 'comment',
      exitCode: 0,
      logTail: '[{"type":"system"}] Warning: running headless --yolo',
    };
    const text = formatPhaseResult(run);
    assert.ok(text.includes('Данные результата недоступны'), 'фолбэк-строка');
    assert.ok(text.includes('\\[\\{'), 'спецсимволы экранированы');
    assert.ok(!text.includes('[{'), 'нет неэкранированного JSON-начала');
  });

  it('фолбэк без result: статус + logTail, без сырого JSON', () => {
    const run = {
      running: false,
      phase: 'code',
      exitCode: null,
      logTail: 'Ошибка запуска: spawn ENOENT',
    };
    const text = formatPhaseResult(run);
    assert.ok(text.includes('ошибка'), 'статус ошибки');
    assert.ok(text.includes('Данные результата недоступны'), 'фолбэк-строка');
    assert.ok(!text.includes('"type":"result"'), 'сырой JSON не показывается');
  });

  it('ошибка с кодом N и is_error', () => {
    const run = {
      ...okRun,
      exitCode: 1,
      result: { ...okRun.result, is_error: true, result: 'упс' },
    };
    const text = formatPhaseResult(run);
    assert.ok(text.includes('ошибка \\(код 1\\)'), 'код ошибки');
    assert.ok(text.includes('ошибка qwen'), 'is_error-метка');
  });

  it('единый формат сессии: vb:<id> для vibelog-agent (VL-93)', () => {
    const text = formatPhaseResult({ ...okRun, agent: 'vb' });
    assert.ok(text.includes('`vb:a470c7dd-2ca8-4510-9d81-b184f932af76`'), 'префикс vb:');
  });

  it('агент не задан (qwen): session_id с префиксом qwen: — единый формат (VL-93)', () => {
    // Жалоба Pavel 2026-10-05: qwen тоже по общему правилу '<agent>:<session_id>'
    const text = formatPhaseResult(okRun);
    assert.ok(text.includes('`qwen:a470c7dd-2ca8-4510-9d81-b184f932af76`'), 'префикс qwen:');
  });
});

describe('limitErrorResumeRef (VL-212)', () => {
  /** Базовый run с ошибкой лимита --max-requests. */
  const limitRun = {
    running: false,
    phase: 'code',
    exitCode: 1,
    agent: 'vb',
    result: {
      result: 'Превышен лимит --max-requests (5) — фаза прервана',
      is_error: true,
      num_turns: 5,
      duration_ms: 1000,
      duration_api_ms: 900,
      session_id: 'agent-1',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        total_tokens: 15,
      },
    },
  };

  it('ошибка лимита → ref vb:<session_id>', () => {
    assert.equal(limitErrorResumeRef(limitRun), 'vb:agent-1');
  });

  it('успешная фаза с тем же текстом → null', () => {
    const run = { ...limitRun, result: { ...limitRun.result, is_error: false } };
    assert.equal(limitErrorResumeRef(run), null);
  });

  it('не-limit ошибка → null', () => {
    const run = { ...limitRun, result: { ...limitRun.result, result: 'Ошибка LLM API' } };
    assert.equal(limitErrorResumeRef(run), null);
  });

  it('limit-ошибка без session_id → null', () => {
    const run = { ...limitRun, result: { ...limitRun.result, session_id: undefined } };
    assert.equal(limitErrorResumeRef(run), null);
  });

  it('result отсутствует (logTail-фолбэк) → null', () => {
    assert.equal(limitErrorResumeRef({ running: false, phase: 'code', exitCode: 1 }), null);
  });

  it('agent не задан → дефолт qwen (VL-93)', () => {
    const run = { ...limitRun, agent: undefined };
    assert.equal(limitErrorResumeRef(run), 'qwen:agent-1');
  });
});

describe('formatDuration (VL-98)', () => {
  it('мс до секунды — «N мс»', () => {
    assert.equal(formatDuration(0), '0 мс');
    assert.equal(formatDuration(830), '830 мс');
  });

  it('до минуты — секунды с округлением', () => {
    assert.equal(formatDuration(20000), '20с');
    assert.equal(formatDuration(59999), '60с');
  });

  it('минуты и секунды', () => {
    assert.equal(formatDuration(83000), '1м 23с');
    assert.equal(formatDuration(60000), '1м 0с');
    assert.equal(formatDuration(3600000), '60м 0с');
  });
});

describe('formatDiffList (VL-88)', () => {
  const files = [
    { path: 'src/app.ts', status: 'Modified', staged: false, additions: 5, deletions: 2 },
    { path: 'src/index.ts', status: 'Added', staged: true, additions: 10, deletions: 0 },
    { path: 'src/new.ts', oldPath: 'src/old.ts', status: 'Renamed', staged: true, additions: 0, deletions: 0 },
  ];

  it('ветка первой строкой, пути/статусы/счётчики, staged-метка', () => {
    const text = formatDiffList(files, 'feature/x');
    const lines = text.split('\n');
    assert.equal(lines[0], '*Ветка:* feature/x');
    assert.ok(text.includes('*src/app\\.ts* \\[Modified\\] +5/−2'), 'unstaged-строка');
    assert.ok(text.includes('*src/index\\.ts* \\[Added · staged\\] +10/−0'), 'staged-строка');
    assert.ok(
      text.includes('*src/new\\.ts ← src/old\\.ts* \\[Renamed · staged\\] +0/−0'),
      'renamed-строка'
    );
  });

  it('спецсимволы MarkdownV2 в пути экранированы', () => {
    const text = formatDiffList(
      [{ path: 'a_b (1).md', status: 'Untracked', staged: false, additions: 0, deletions: 0 }],
      'main'
    );
    assert.ok(text.includes('*a\\_b \\(1\\)\\.md*'), 'спецсимволы с backslash');
    assert.ok(!text.includes('*a_b (1).md*'), 'сырой путь не выводится');
  });
});

describe('formatDocsList (VL-89)', () => {
  const entry = {
    document: { id: 'doc-1', title: 'Гайд', type: 'guide', created_date: '2026-10-05', tags: ['api'] },
    body: '',
    path: '/tmp/x.md',
  };

  it('жирный id, заголовок, тип в скобках', () => {
    const text = formatDocsList([entry]);
    assert.ok(text.includes('*doc\\-1* — Гайд \\[guide\\]'), 'id жирный, тип в скобках');
  });

  it('спецсимволы MarkdownV2 экранированы', () => {
    const text = formatDocsList([
      { ...entry, document: { ...entry.document, id: 'doc-2', title: 'A_b (x).md' } },
    ]);
    assert.ok(text.includes('*doc\\-2* — A\\_b \\(x\\)\\.md'), 'заголовок экранирован');
  });

  it('пустой список → «Документов нет»', () => {
    assert.equal(formatDocsList([]), 'Документов нет');
  });
});

describe('formatDocumentDetail (VL-89)', () => {
  const entry = {
    document: { id: 'doc-1', title: 'Гайд', type: 'guide', created_date: '2026-10-05', tags: ['api'] },
    body: 'Тело документа',
    path: '/tmp/x.md',
  };

  it('метаданные: заголовок, тип, дата, теги', () => {
    const text = formatDocumentDetail(entry);
    assert.match(text, /\*doc\\-1 — Гайд\*/);
    assert.match(text, /\*Тип:\* guide/);
    assert.match(text, /\*Создан:\* 2026\\-10\\-05/);
    assert.match(text, /\*Теги:\* api/);
  });

  it('без тегов строка Теги не выводится', () => {
    const text = formatDocumentDetail({
      ...entry,
      document: { ...entry.document, tags: [] },
    });
    assert.ok(!text.includes('*Теги:*'));
  });

  it('тело экранировано и добавлено после меты', () => {
    const text = formatDocumentDetail({ ...entry, body: 'Текст _подчёркнутый_' });
    assert.match(text, /Текст \\_подчёркнутый\\_/);
  });

  it('длинное тело усекается до 1500 символов с многоточием', () => {
    const text = formatDocumentDetail({ ...entry, body: 'а'.repeat(1600) });
    assert.match(text, /а{1500}…/);
  });
});

describe('formatCommitsList (VL-90)', () => {
  const commits = [
    { hash: 'abc123', author: 'Pavel', date: '2026-10-05 18:00', subject: 'Добавить фичу' },
    { hash: 'def456', author: 'Алексей', date: '2026-10-04', subject: 'Тема _с подчёркиванием_' },
  ];

  it('формат строки: subject (date) — author *hash*', () => {
    const text = formatCommitsList(commits);
    assert.match(text, /Добавить фичу \\\(2026\\-10\\-05 18:00\\\) — Pavel \*abc123\*/);
  });

  it('спецсимволы экранированы escapeMarkdownV2', () => {
    const text = formatCommitsList(commits);
    assert.ok(text.includes('\\(2026\\-10\\-04\\)'), 'дата в экранированных скобках');
    assert.ok(text.includes('Тема \\_с подчёркиванием\\_'), 'underscore экранирован');
  });

  it('строки соединяются через \n', () => {
    const text = formatCommitsList(commits);
    assert.equal(text.split('\n').length, 2);
  });
});

describe('splitNumbered (VL-148)', () => {
  // Суффикс как в sendPhaseResult (MarkdownV2-вариант)
  const fmt = (i, n) => `\n\n_часть ${i}/${n}_`;
  const stripSuffix = (p) => p.replace(/\n\n_часть \d+\/\d+_$/, '');

  it('короткий текст — одна часть без суффикса', () => {
    assert.deepEqual(splitNumbered('привет', 100, fmt), ['привет']);
  });

  it('длинный текст: части ≤ limit, нумерация 1..N, содержимое не теряется', () => {
    const text = Array.from({ length: 400 }, (_, i) => `строка ${i}`).join('\n');
    const parts = splitNumbered(text, 300, fmt);
    assert.ok(parts.length > 1, 'больше одной части');
    for (const [idx, p] of parts.entries()) {
      assert.ok(p.length <= 300, `часть ${idx + 1} длиной ${p.length} ≤ 300`);
      assert.ok(
        p.endsWith(`_часть ${idx + 1}/${parts.length}_`),
        `суффикс «часть ${idx + 1}/${parts.length}» на месте`
      );
    }
    // Склейка тел частей (без суффиксов) восстанавливает оригинал
    const joined = parts.map(stripSuffix).join('\n');
    assert.equal(joined, text);
  });

  it('разрез только по границам строк — тело части кратно строкам', () => {
    // Строки по 40 символов через \n → модуль 41
    const text = Array.from({ length: 100 }, () => 'y'.repeat(40)).join('\n');
    const parts = splitNumbered(text, 200, fmt);
    assert.ok(parts.length > 1);
    for (const p of parts) {
      const body = stripSuffix(p);
      assert.equal((body.length + 1) % 41, 0, 'тело части состоит из целых строк');
    }
  });

  it('сверхдлинная строка — жёсткий разрез без потери символов', () => {
    const text = 'z'.repeat(500);
    const parts = splitNumbered(text, 200, fmt);
    assert.ok(parts.length > 1);
    for (const p of parts) assert.ok(p.length <= 200, 'часть в лимите');
    assert.equal(parts.map(stripSuffix).join(''), text, 'символы не потеряны');
  });
});
