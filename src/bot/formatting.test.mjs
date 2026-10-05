/**
 * Тесты VL-34/VL-38 — форматирование ответов бота (MarkdownV2).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeMarkdownV2,
  formatTaskList,
  formatTaskDetail,
  formatPhaseRun,
  formatPhaseResult,
  formatBoard,
  formatDiffList,
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
    assert.ok(text.includes('понг'), 'result');
    assert.ok(text.includes('*Входные токены:* 10956'), 'input_tokens');
    assert.ok(text.includes('*Сгенерированные токены:* 19'), 'output_tokens');
    assert.ok(text.includes('*Кэш-токены:* 10944'), 'cache');
    assert.ok(text.includes('*Всего токенов:* 10975'), 'total');
    assert.ok(text.includes('*Общее время:* 42411 мс \\(api: 42369 мс\\)'), 'время');
    assert.ok(text.includes('*Количество запросов:* 1'), 'num_turns');
    assert.ok(text.includes('a470c7dd-2ca8-4510-9d81-b184f932af76'), 'session_id');
  });

  it('спецсимволы в result экранированы', () => {
    const run = { ...okRun, result: { ...okRun.result, result: 'Фича _x_ и (скобки)!' } };
    const text = formatPhaseResult(run);
    assert.ok(text.includes('Фича \\_x\\_ и \\(скобки\\)\\!'), 'escapeMarkdownV2 применён');
  });

  it('длинный result обрезан до 1500 символов', () => {
    const run = { ...okRun, result: { ...okRun.result, result: 'x'.repeat(2000) } };
    const text = formatPhaseResult(run);
    const bodyLine = text.split('\n')[1];
    // 'x' не экранируется — длина строки = 1500 + '…'
    assert.equal(bodyLine.length, 1501);
    assert.ok(bodyLine.endsWith('…'));
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
