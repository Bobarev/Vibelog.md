/**
 * Тесты VL-39 — рендер Rich Markdown для Telegram Rich Messages.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  renderTaskRich,
  renderTasksRich,
  renderDocsRich,
  renderDocumentRich,
  renderDiffRich,
  renderCommitsRich,
  renderPhaseResultRich,
  chunkRich,
  RICH_LIMIT,
  nextPhaseForStatus,
  PHASE_EMOJI,
} from '../../dist/bot/rich.js';

const fullTask = {
  id: 'VL-34',
  title: 'Telegram-бот: каркас',
  status: 'Done',
  priority: 'High',
  assignee: ['Pavel'],
  reporter: '',
  created_date: '2026-10-02 11:00',
  updated_date: '2026-10-02 12:00',
  due_date: '2026-10-05',
  labels: ['bot', 'telegram'],
  dependencies: [],
  milestone: '',
  type: '',
  project: '',
  parent_task_id: '',
  ordinal: 0,
  references: [],
  documentation: [],
  modified_files: [],
  description: 'Описание с ```блоком кода``` внутри',
  acceptanceCriteria: [
    { text: 'Каркас работает', checked: true },
    { text: 'Пин-код генерируется', checked: false },
  ],
  definitionOfDone: [{ text: 'Тесты проходят', checked: true }],
  implementationPlan: '1. Создать модули\n2. Подключить grammy',
  implementationNotes: '',
  finalSummary: 'Готово',
  comments: [
    { author: '@agent', created: '2026-10-02 12:00', text: 'Фаза выполнена' },
    { author: 'Pavel', created: '2026-10-02 12:30', text: 'Отлично' },
  ],
};

describe('renderTaskRich (VL-39)', () => {
  it('шапка: заголовок и меты', () => {
    const md = renderTaskRich(fullTask);
    assert.match(md, /^# VL-34 — Telegram-бот: каркас/);
    assert.match(md, /\*\*Статус:\*\* Done/);
    assert.match(md, /\*\*Приоритет:\*\* High/);
    assert.match(md, /\*\*Исполнители:\*\* Pavel/);
    assert.match(md, /\*\*Метки:\*\* bot, telegram/);
    assert.match(md, /\*\*Срок:\*\* 2026-10-05/);
  });

  it('AC/DoD — task list с отметками в details-блоках (VL-78)', () => {
    const md = renderTaskRich(fullTask);
    assert.match(
      md,
      /<details><summary>Acceptance Criteria<\/summary>\n\n- \[x\] Каркас работает\n- \[ \] Пин-код генерируется/
    );
    assert.match(md, /<details><summary>Definition of Done<\/summary>\n\n- \[x\] Тесты проходят/);
  });

  it('секции plan/summary присутствуют, пустые notes опущены (VL-78)', () => {
    const md = renderTaskRich(fullTask);
    assert.match(md, /<details><summary>Implementation Plan<\/summary>\n\n1\. Создать модули/);
    assert.match(md, /<details><summary>Final Summary<\/summary>\n\nГотово/);
    assert.doesNotMatch(md, /Implementation Notes/);
  });

  it('комментарии: автор, дата, разделитель (в details, VL-78)', () => {
    const md = renderTaskRich(fullTask);
    assert.match(md, /<details><summary>Комментарии<\/summary>/);
    assert.match(md, /\*\*@agent\*\* · 2026-10-02 12:00\n\nФаза выполнена/);
    assert.match(md, /\n\n---\n\n\*\*Pavel\*\*/);
  });

  it('описание с ``` экранируется (не ломает GFM)', () => {
    const md = renderTaskRich(fullTask);
    assert.doesNotMatch(md, /```блок/);
    assert.match(md, /` ` `блоком кода` ` `/);
  });

  it('минимальная задача: только шапка', () => {
    const minimal = {
      ...fullTask,
      description: '',
      acceptanceCriteria: [],
      definitionOfDone: [],
      implementationPlan: '',
      finalSummary: '',
      comments: [],
      labels: [],
      assignee: [],
    };
    const md = renderTaskRich(minimal);
    assert.match(md, /^# VL-34/);
    assert.doesNotMatch(md, /## /);
    // секций нет — details тоже нет; comment-кнопка есть (безусловная)
    assert.doesNotMatch(md, /<details/);
    assert.match(md, /data="comment:VL-34"/);
  });
});

describe('Кнопка следующего этапа (VL-72)', () => {
  it('кнопки в центрированном row: next primary + reject danger + comment success (VL-78/144)', () => {
    const md = renderTaskRich({ ...fullTask, status: 'To Do' });
    assert.match(
      md,
      /^# VL-34 — Telegram-бот: каркас\n\n<tg-button-row align="center">\n<tg-button type="callback_data" style="primary" data="next:VL-34">▶ Spec<\/tg-button>\n<tg-button type="callback_data" style="danger" data="reject:VL-34">✖ Reject<\/tg-button>\n<tg-button type="callback_data" style="success" data="comment:VL-34">💬 Комментарий<\/tg-button>\n<\/tg-button-row>/
    );
  });

  // ── VL-144: кнопка Reject ──
  it('Reject-кнопка есть только для To Do', () => {
    for (const status of ['To Do']) {
      const md = renderTaskRich({ ...fullTask, status });
      assert.match(md, /data="reject:VL-34">✖ Reject/, `reject-кнопка для ${status}`);
    }
    for (const status of ['Spec', 'Planned', 'In Progress', 'Review', 'Done', 'Blocked']) {
      const md = renderTaskRich({ ...fullTask, status });
      assert.doesNotMatch(md, /reject:/, `reject-кнопки не должно быть для ${status}`);
    }
  });

  it('nextPhaseForStatus: маппинг статус → фаза', () => {
    assert.deepEqual(nextPhaseForStatus('To Do'), { phase: 'spec', label: 'Spec' });
    assert.deepEqual(nextPhaseForStatus('Spec'), { phase: 'plan', label: 'Plan' });
    assert.deepEqual(nextPhaseForStatus('Planned'), { phase: 'code', label: 'Code' });
    assert.deepEqual(nextPhaseForStatus('In Progress'), { phase: 'code', label: 'Code' });
    assert.deepEqual(nextPhaseForStatus('Review'), { phase: 'close', label: 'Close' });
    assert.equal(nextPhaseForStatus('Done'), null);
    assert.equal(nextPhaseForStatus('Blocked'), null);
    assert.equal(nextPhaseForStatus('QA'), null);
  });

  it('next-кнопки нет для Done/Blocked/неизвестного; comment-кнопка всегда (VL-78)', () => {
    for (const status of ['Done', 'Blocked', 'QA']) {
      const md = renderTaskRich({ ...fullTask, status });
      assert.doesNotMatch(md, /next:/, `next-кнопка не должна быть для ${status}`);
      assert.doesNotMatch(
        md,
        /<tg-button-row align="center">\n<tg-button[^>]*primary/,
        `primary-row без next не должен быть для ${status}`
      );
      assert.match(
        md,
        /<tg-button type="callback_data" style="success" data="comment:VL-34">💬 Комментарий<\/tg-button>/,
        `comment-кнопка обязательна для ${status}`
      );
    }
  });
});

describe('Карточка VL-78 (expand-блоки + кнопки)', () => {
  it('Описание открыта по умолчанию, остальные секции свёрнуты', () => {
    const md = renderTaskRich(fullTask);
    assert.match(md, /<details open><summary>Описание<\/summary>/);
    assert.match(md, /<details><summary>Acceptance Criteria<\/summary>/);
    assert.match(md, /<details><summary>Definition of Done<\/summary>/);
    assert.match(md, /<details><summary>Implementation Plan<\/summary>/);
    assert.match(md, /<details><summary>Final Summary<\/summary>/);
    assert.match(md, /<details><summary>Комментарии<\/summary>/);
  });

  it('шапка с метой — вне details, видна всегда', () => {
    const md = renderTaskRich(fullTask);
    // Меты идут после кнопок, но до первого details — свёрнутые секции не прячут шапку
    const header = md.slice(0, md.indexOf('<details'));
    assert.match(header, /^# VL-34 — Telegram-бот: каркас/);
    assert.match(header, /\*\*Статус:\*\* Done/);
    assert.match(header, /\*\*Срок:\*\* 2026-10-05/);
  });

  it('обе кнопки в одном row: primary + success', () => {
    const md = renderTaskRich({ ...fullTask, status: 'To Do' });
    const row = md.slice(md.indexOf('<tg-button-row'), md.indexOf('</tg-button-row>'));
    assert.match(row, /style="primary" data="next:VL-34"/);
    assert.match(row, /style="success" data="comment:VL-34"/);
  });

  it('PHASE_EMOJI: соответствие фаз → эмодзи и label в кнопке', () => {
    assert.equal(PHASE_EMOJI.spec, '▶');
    assert.equal(PHASE_EMOJI.plan, '📋');
    assert.equal(PHASE_EMOJI.code, '💻');
    assert.equal(PHASE_EMOJI.close, '✅');
    const cases = [
      ['To Do', '▶ Spec'],
      ['Spec', '📋 Plan'],
      ['Planned', '💻 Code'],
      ['In Progress', '💻 Code'],
      ['Review', '✅ Close'],
    ];
    for (const [status, label] of cases) {
      const md = renderTaskRich({ ...fullTask, status });
      assert.ok(md.includes(`>${label}</tg-button>`), `label «${label}» для ${status}`);
    }
  });
});

describe('Сырые rich-теги в контенте (VL-81)', () => {
  // Удаляет fenced-блоки и inline-код — остаётся «сырой» текст сообщения
  const stripCode = (md) => md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

  const taggedTask = (over) => ({
    ...fullTask,
    status: 'Planned',
    priority: '',
    assignee: [],
    labels: [],
    due_date: '',
    description: '',
    acceptanceCriteria: [],
    definitionOfDone: [],
    implementationPlan: '',
    finalSummary: '',
    comments: [],
    ...over,
  });

  it('теги целиком строками → fenced-блок, сырых тегов вне кода нет', () => {
    const md = renderTaskRich(
      taggedTask({
        description:
          '<tg-button type="callback_data" data="next:VL-1">X</tg-button>\n<details><summary>Заголовок</summary>...</details>',
      })
    );
    // Обе теговые строки складываются в один fenced-блок (указание Pavel 21:19)
    assert.match(
      md,
      /```\n<tg-button type="callback_data" data="next:VL-1">X<\/tg-button>\n<details><summary>Заголовок<\/summary>\.\.\.<\/details>\n```/
    );
    const raw = stripCode(md);
    // Сырых тегов контента вне code-разметки не остаётся
    assert.doesNotMatch(raw, /next:VL-1/);
    assert.doesNotMatch(raw, /<details><summary>Заголовок/);
    // Служебный ряд кнопок рендера — единственный
    assert.equal((md.match(/<tg-button-row/g) || []).length, 1);
    // Секция «Описание» не сломана
    assert.match(md, /<details open><summary>Описание<\/summary>/);
  });

  it('тег вперемешку с текстом → inline-бэкитики, текст сохранён', () => {
    const md = renderTaskRich(
      taggedTask({
        description:
          'используй <tg-button type="callback_data" data="next:VL-1">X</tg-button> для кнопки',
      })
    );
    assert.match(
      md,
      /используй `<tg-button type="callback_data" data="next:VL-1">`X`<\/tg-button>` для кнопки/
    );
  });

  it('теги внутри ```-блока контента → настоящий fenced-блок, маркеры поглощены', () => {
    const md = renderTaskRich(
      taggedTask({
        description: '```\n<tg-button type="callback_data" data="next:VL-1">X</tg-button>\n```',
      })
    );
    // fenceSafe гасит ``` в ` ` `, но ` ` ` fenced-блоком в Telegram не является:
    // теги между маркерами остались бы сырыми и сломали карточку (VL-81).
    // Маркеры поглощаются, теговые строки уходят в настоящий fenced-блок
    assert.match(
      md,
      /```\n<tg-button type="callback_data" data="next:VL-1">X<\/tg-button>\n```/
    );
    assert.doesNotMatch(md, /` ` `[\s\S]*?next:VL-1/);
    assert.equal((md.match(/next:VL-1/g) || []).length, 1);
  });

  it('теги уже внутри inline-кода не оборачиваются повторно (VL-81 fix)', () => {
    const md = renderTaskRich(
      taggedTask({
        description:
          'Паттерны: `<details><summary>` и (`` `<tg-button ...>` ``) — примеры кода.',
      })
    );
    // Спаны сохраняются как есть: повторная обёртка ломает пары бэктиков и
    // выталкивает тег из кода наружу — Telegram интерпретирует его как элемент
    assert.match(
      md,
      /Паттерны: `<details><summary>` и \(`` `<tg-button \.\.\.>` ``\) — примеры кода\./
    );
    const raw = stripCode(md);
    // Служебные <details open><summary>Описание</summary> и кнопки шапки —
    // норма; проверяем, что контентные теги-примеры не вывалились из кода
    assert.doesNotMatch(raw, /<details><summary>/);
    assert.doesNotMatch(raw, /<tg-button \.\.\.>/);
  });

  it('смешанная строка: код-спан не тронут, сырой тег оборачивается', () => {
    const md = renderTaskRich(
      taggedTask({
        description:
          'код `<details>` и сырой <tg-button type="callback_data" data="next:VL-1">X</tg-button> рядом',
      })
    );
    assert.match(
      md,
      /код `<details>` и сырой `<tg-button type="callback_data" data="next:VL-1">`X`<\/tg-button>` рядом/
    );
  });

  it('AC/DoD: тег в элементе checklist — в code-разметке', () => {
    const md = renderTaskRich(
      taggedTask({
        acceptanceCriteria: [
          {
            text: 'Кнопка <tg-button type="callback_data" data="next:VL-1">X</tg-button> добавлена',
            checked: false,
          },
        ],
        definitionOfDone: [{ text: 'Проверить <details> в описании', checked: true }],
      })
    );
    assert.match(
      md,
      /- \[ \] Кнопка `<tg-button type="callback_data" data="next:VL-1">`X`<\/tg-button>` добавлена/
    );
    assert.match(md, /- \[x\] Проверить `<details>` в описании/);
  });

  it('служебная разметка карточки не затронута (VL-72/78)', () => {
    const md = renderTaskRich(
      taggedTask({
        description: '<details><summary>Заголовок</summary>...</details>',
        acceptanceCriteria: [{ text: 'Критерий <tg-button>x</tg-button>', checked: false }],
      })
    );
    // Кнопки рендера: next (статус Planned → Code) + comment, один row
    assert.match(md, /data="next:VL-34">💻 Code<\/tg-button>/);
    assert.match(md, /data="comment:VL-34">💬 Комментарий<\/tg-button>/);
    assert.equal((md.match(/<tg-button-row/g) || []).length, 1);
    // Обёртки секций сохраняют служебные details/summary; теги контента — в коде
    const raw = stripCode(md);
    assert.match(raw, /<details><summary>Acceptance Criteria<\/summary>/);
    assert.doesNotMatch(raw, /<details><summary>Заголовок/);
  });
});

describe('renderPhaseResultRich (VL-71)', () => {
  const okRun = {
    running: false,
    phase: 'comment',
    exitCode: 0,
    result: {
      result: 'понг (тест) [скобки]',
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

  it('успех: заголовок, меты, session_id в backticks; скобки без экранирования', () => {
    const md = renderPhaseResultRich(okRun);
    assert.match(md, /^# Фаза comment: завершена \(код 0\)/);
    // VL-98: ответ модели — GFM-цитата (каждая строка с "> ")
    assert.match(md, /^> понг \(тест\) \[скобки\]/m);
    assert.doesNotMatch(md, /\\\(/);
    // VL-98: токены одной строкой + расчёт «входные минус кэш» (10956-10944=12)
    assert.match(md, /\*\*Токены:\*\* входные: 10956 · сгенерированные: 19 · кэш: 10944 · всего: 10975/);
    assert.match(md, /\*\*Входные минус кэш:\*\* 12/);
    // VL-98: время в человекочитаемом формате (42411 мс → 42с)
    assert.match(md, /\*\*Общее время:\*\* 42с \(api: 42с\)/);
    assert.match(md, /\*\*Количество запросов:\*\* 1/);
    // Единый формат вывода сессии '<agent>:<session_id>' (VL-93, жалоба Pavel 2026-10-05)
    assert.match(md, /`qwen:a470c7dd-2ca8-4510-9d81-b184f932af76`/);
    // Без taskId (VL-98): суффикса задачи в заголовке нет
    assert.doesNotMatch(md, /— VL-/);
  });

  it('taskId добавляет суффикс «— VL-N» в оба статуса (VL-98)', () => {
    const ok = renderPhaseResultRich(okRun, 'VL-1');
    assert.match(ok, /^# Фаза comment: завершена \(код 0\) — VL-1$/m);
    // Кейсы ошибок: суффикс есть в обоих статусах
    const codeErr = renderPhaseResultRich({ ...okRun, exitCode: 1 }, 'VL-1');
    assert.match(codeErr, /# Фаза comment: ошибка \(код 1\) — VL-1/);
    const qwenErr = renderPhaseResultRich(
      { ...okRun, result: { ...okRun.result, is_error: true } },
      'VL-1'
    );
    assert.match(qwenErr, /# Фаза comment: ошибка \(код 0\) \(ошибка qwen\) — VL-1/);
  });

  it('фолбэк без result: logTail в тройных backticks', () => {
    const md = renderPhaseResultRich({
      ...okRun,
      result: undefined,
      logTail: 'warn: обрыв\n```\nвнутри лога\n```',
    });
    assert.match(md, /\*\*Данные результата недоступны\*\*/);
    assert.match(md, /```/);
    // тройные backticks внутри logTail экранируются fenceSafe — блок не ломается
    assert.match(md, /` ` `\nвнутри лога/);
    assert.doesNotMatch(md, /```внутри/);
  });

  it('ошибка: ненулевой код и is_error при коде 0', () => {
    const codeErr = renderPhaseResultRich({ ...okRun, exitCode: 1 });
    assert.match(codeErr, /# Фаза comment: ошибка \(код 1\)/);
    const qwenErr = renderPhaseResultRich({
      ...okRun,
      result: { ...okRun.result, is_error: true },
    });
    assert.match(qwenErr, /# Фаза comment: ошибка \(код 0\) \(ошибка qwen\)/);
  });

  it('пустой session_id — строки нет', () => {
    const md = renderPhaseResultRich({
      ...okRun,
      result: { ...okRun.result, session_id: '' },
    });
    assert.doesNotMatch(md, /a470c7dd/);
    assert.match(md, /Количество запросов:\*\* 1/);
  });

  it('result длиннее 1500 символов — обрезка с многоточием', () => {
    const md = renderPhaseResultRich({
      ...okRun,
      result: { ...okRun.result, result: 'а'.repeat(1600) },
    });
    assert.match(md, /а{1500}…/);
  });

  it('единый формат сессии: vb:<id> и qwen:<uuid> (VL-93)', () => {
    const vb = renderPhaseResultRich({ ...okRun, agent: 'vb' });
    assert.match(vb, /`vb:a470c7dd-2ca8-4510-9d81-b184f932af76`/);
    // Жалоба Pavel 2026-10-05: qwen выводится по общему правилу с префиксом
    const qwen = renderPhaseResultRich(okRun);
    assert.match(qwen, /`qwen:a470c7dd-2ca8-4510-9d81-b184f932af76`/);
  });
});
describe('chunkRich (VL-39)', () => {
  it('короткий текст — одна часть', () => {
    assert.deepEqual(chunkRich('короткий'), ['короткий']);
  });

  it('длинный текст — разбивка по границам абзацев', () => {
    const long = 'абзац. '.repeat(10000); // ~70К символов
    const chunks = chunkRich(long, 1000);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= 1000, `часть ${c.length} > 1000`);
  });

  it('лимит по умолчанию — RICH_LIMIT', () => {
    assert.equal(RICH_LIMIT, 32768);
  });
});

describe('renderTasksRich (VL-82)', () => {
  const task = (over) => ({
    ...fullTask,
    id: 'VL-1',
    title: 'Заголовок',
    status: 'To Do',
    type: 'bug',
    priority: 'High',
    ...over,
  });

  it('шапка таблицы: HTML <tr>/<th>, все 5 колонок, ID жирный', () => {
    const md = renderTasksRich([task()], {});
    assert.ok(md.includes('<table bordered striped compact>'));
    assert.ok(
      md.includes(
        '<tr><th>ID</th><th>Заголовок</th><th>Статус</th><th>Тип</th><th>Приоритет</th></tr>'
      )
    );
    assert.ok(md.includes('<b>VL-1</b>'));
    // GFM-строки | ... | внутри <table> Telegram показывает сырым текстом —
    // в рендере их быть не должно (fix VL-82)
    assert.ok(!md.includes('| --- |'));
  });

  it('порядок строк — как во входном массиве (фильтрация не в рендере)', () => {
    const md = renderTasksRich([task({ id: 'VL-2', status: 'Done' }), task({ id: 'VL-1' })], {});
    assert.ok(md.indexOf('<b>VL-2</b>') < md.indexOf('<b>VL-1</b>'));
  });

  it('tg-button-row: data="task:VL-N", текст кнопки = номер без префикса (VL-128)', () => {
    const md = renderTasksRich([task(), task({ id: 'VL-7' })], {});
    assert.ok(md.includes('<tg-button-row>'));
    assert.ok(md.includes('<tg-button type="callback_data" data="task:VL-1">1</tg-button>'));
    assert.ok(md.includes('<tg-button type="callback_data" data="task:VL-7">7</tg-button>'));
  });

  it('стили по типу: bug→danger, feature→success, enhancement→primary, epic→primary', () => {
    const styles = { bug: 'danger', feature: 'success', enhancement: 'primary', epic: 'primary' };
    const md = renderTasksRich(
      [
        task({ id: 'VL-1', type: 'bug' }),
        task({ id: 'VL-2', type: 'feature' }),
        task({ id: 'VL-3', type: 'enhancement' }),
        task({ id: 'VL-4', type: 'epic' }),
      ],
      styles
    );
    assert.ok(md.includes('style="danger" data="task:VL-1"'));
    assert.ok(md.includes('style="success" data="task:VL-2"'));
    assert.ok(md.includes('style="primary" data="task:VL-3"'));
    assert.ok(md.includes('style="primary" data="task:VL-4"'));
  });

  it('неизвестный тип и пустой styles → кнопка без атрибута style', () => {
    const mdUnknown = renderTasksRich([task({ type: 'docs' })], { bug: 'danger' });
    assert.ok(mdUnknown.includes('<tg-button type="callback_data" data="task:VL-1">'));
    const mdEmpty = renderTasksRich([task()], {});
    assert.ok(mdEmpty.includes('<tg-button type="callback_data" data="task:VL-1">'));
    assert.ok(!mdEmpty.includes('style='));
  });

  it('спецсимволы HTML экранируются в ячейках — таблица не ломается', () => {
    const md = renderTasksRich([task({ title: 'A < B & C > D' })], {});
    assert.ok(md.includes('A &#60; B &#38; C &#62; D'));
    // `|` в HTML-ячейке безопасен как есть — обратный слэш не добавляется
    const mdPipe = renderTasksRich([task({ title: 'A | B' })], {});
    assert.ok(mdPipe.includes('<td>A | B</td>'));
  });

  it('пустой массив → пустая строка', () => {
    assert.equal(renderTasksRich([], {}), '');
  });

  it('больше 5 кнопок → ряды по ≤5 (TASK_BUTTONS_PER_ROW, VL-128)', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => task({ id: `VL-${i + 1}` }));
    const md = renderTasksRich(tasks, {});
    const rowBlocks = md.split('<tg-button-row>').slice(1);
    assert.equal(rowBlocks.length, 2, '10 кнопок → 2 ряда (5 + 5)');
    for (const block of rowBlocks) {
      const count = (block.match(/<tg-button /g) || []).length;
      assert.ok(count >= 1 && count <= 5, `в ряду ${count} кнопок (допустимо 1-5)`);
    }
    for (let i = 1; i <= 10; i++) {
      assert.ok(md.includes(`data="task:VL-${i}"`), `кнопка VL-${i} на месте`);
    }
  });

  it('ровно 5 кнопок → один ряд (VL-128)', () => {
    const tasks = Array.from({ length: 5 }, (_, i) => task({ id: `VL-${i + 1}` }));
    const md = renderTasksRich(tasks, {});
    assert.equal((md.match(/<tg-button-row>/g) || []).length, 1);
  });

  it('6 кнопок → 2 ряда (5 + 1, VL-128)', () => {
    const tasks = Array.from({ length: 6 }, (_, i) => task({ id: `VL-${i + 1}` }));
    const md = renderTasksRich(tasks, {});
    assert.equal((md.match(/<tg-button-row>/g) || []).length, 2);
  });

  it('VL-91: активная задача — 🔄 + фаза в ячейке ID', () => {
    const md = renderTasksRich([task(), task({ id: 'VL-7' })], {}, { 'VL-1': 'code' });
    assert.ok(md.includes('<td><b>VL-1</b> 🔄 code</td>'));
    assert.ok(md.includes('<td><b>VL-7</b></td>'));
  });

  it('VL-91: неактивная задача / вызов без 3-го аргумента — без 🔄', () => {
    const md = renderTasksRich([task()], {}, {});
    assert.ok(!md.includes('🔄'));
    const mdDefault = renderTasksRich([task()], {});
    assert.ok(!mdDefault.includes('🔄'));
  });

  it('VL-91: фаза с HTML-спецсимволами экранируется cellSafe', () => {
    const md = renderTasksRich([task()], {}, { 'VL-1': 'a<b>&c' });
    assert.ok(md.includes('<td><b>VL-1</b> 🔄 a&#60;b&#62;&#38;c</td>'));
  });
});

describe('renderDiffRich (VL-88)', () => {
  const files = [
    { path: 'src/app.ts', status: 'Modified', staged: false, additions: 5, deletions: 2 },
    { path: 'src/index.ts', status: 'Modified', staged: true, additions: 1, deletions: 0 },
    { path: 'new/<script>.md', status: 'Untracked', staged: false, additions: 0, deletions: 0 },
    { path: 'src/new.ts', oldPath: 'src/old.ts', status: 'Renamed', staged: true, additions: 0, deletions: 0 },
  ];

  it('заголовок с веткой и таблица bordered striped compact', () => {
    const md = renderDiffRich(files, 'feature/x');
    assert.ok(md.includes('# 📝 Незакоммиченные изменения — `feature/x`'), 'заголовок с веткой');
    assert.ok(md.includes('<table bordered striped compact>'), 'таблица');
    assert.ok(
      md.includes('<tr><th>Файл</th><th>Статус</th><th>Строки (+/−)</th></tr>'),
      'шапка колонок'
    );
  });

  it('staged — метка (staged), unstaged и untracked — без метки', () => {
    const md = renderDiffRich(files, 'main');
    assert.ok(md.includes('Modified (staged)'), 'staged-метка');
    assert.ok(!md.includes('Untracked (staged)'), 'untracked без метки');
  });

  it('счётчики строк в ячейке +N/−N', () => {
    const md = renderDiffRich(files, 'main');
    assert.ok(md.includes('+5/−2'), 'unstaged-счётчики');
    assert.ok(md.includes('+1/−0'), 'staged-счётчики');
  });

  it('renamed — «new ← old» в ячейке пути', () => {
    const md = renderDiffRich(files, 'main');
    assert.ok(md.includes('src/new.ts ← src/old.ts'), 'renamed-путь');
  });

  it('спецсимволы в пути экранируются через cellSafe', () => {
    const md = renderDiffRich(
      [{ path: 'a<b>&c.md', status: 'Untracked', staged: false, additions: 0, deletions: 0 }],
      'main'
    );
    assert.ok(md.includes('a&#60;b&#62;&#38;c.md'), '< и > и & экранированы');
    assert.ok(!md.includes('a<b>'), 'сырой < отсутствует');
  });

  it('пустой список → пустая строка', () => {
    assert.equal(renderDiffRich([], 'main'), '');
  });
});

describe('renderDocsRich (VL-89)', () => {
  const doc = (over) => ({
    document: {
      id: 'doc-1',
      title: 'Гайд',
      type: 'guide',
      created_date: '2026-10-05',
      tags: ['api'],
      ...(over || {}),
    },
    body: 'Содержимое документа',
    path: '/tmp/x.md',
  });

  it('шапка таблицы: колонки ID/Заголовок/Тип/Теги, ID жирный, без GFM | --- |', () => {
    const md = renderDocsRich([doc()]);
    assert.ok(md.includes('<table bordered striped compact>'));
    assert.ok(
      md.includes('<tr><th>ID</th><th>Заголовок</th><th>Тип</th><th>Теги</th></tr>')
    );
    assert.ok(md.includes('<b>doc-1</b>'));
    assert.ok(!md.includes('| --- |'));
  });

  it('кнопки: data="doc:<id>", текст кнопки = ID', () => {
    const md = renderDocsRich([doc(), doc({ id: 'doc-7', title: 'Другой' })]);
    assert.ok(md.includes('<tg-button-row>'));
    assert.ok(md.includes('<tg-button type="callback_data" data="doc:doc-1">doc-1</tg-button>'));
    assert.ok(md.includes('<tg-button type="callback_data" data="doc:doc-7">doc-7</tg-button>'));
  });

  it('10 документов → 2 ряда по ≤8 кнопок; ровно 8 → 1 ряд', () => {
    const many = Array.from({ length: 10 }, (_, i) => doc({ id: 'doc-' + (i + 1) }));
    const md = renderDocsRich(many);
    const rowBlocks = md.split('<tg-button-row>').slice(1);
    assert.equal(rowBlocks.length, 2, '10 кнопок → 2 ряда (8 + 2)');
    for (const block of rowBlocks) {
      const count = (block.match(/<tg-button /g) || []).length;
      assert.ok(count >= 1 && count <= 8, 'в ряду ' + count + ' кнопок (допустимо 1-8)');
    }
    const eight = Array.from({ length: 8 }, (_, i) => doc({ id: 'doc-' + (i + 1) }));
    assert.equal((renderDocsRich(eight).match(/<tg-button-row>/g) || []).length, 1);
  });

  it('спецсимволы HTML экранируются в ячейках — таблица не ломается', () => {
    const md = renderDocsRich([doc({ title: 'A < B & C > D' })]);
    assert.ok(md.includes('A &#60; B &#38; C &#62; D'));
  });

  it('пустой массив → пустая строка', () => {
    assert.equal(renderDocsRich([]), '');
  });
});

describe('renderDocumentRich (VL-89)', () => {
  const entry = {
    document: {
      id: 'doc-1',
      title: 'Гайд',
      type: 'guide',
      created_date: '2026-10-05',
      tags: ['api'],
    },
    body: 'Тело документа',
    path: '/tmp/x.md',
  };

  it('заголовок и метаданные: Тип, Создан, Теги', () => {
    const md = renderDocumentRich(entry);
    assert.match(md, /^# doc-1 — Гайд/);
    assert.match(md, /\*\*Тип:\*\* guide/);
    assert.match(md, /\*\*Создан:\*\* 2026-10-05/);
    assert.match(md, /\*\*Теги:\*\* api/);
  });

  it('тело — в секции Содержимое (открытой)', () => {
    const md = renderDocumentRich(entry);
    assert.ok(md.includes('<details open><summary>Содержимое</summary>'));
    assert.ok(md.includes('Тело документа'));
  });

  it('пустое тело → секции «Содержимое» нет', () => {
    const md = renderDocumentRich({ ...entry, body: '   ' });
    assert.ok(!md.includes('Содержимое'));
  });

  it('сырые rich-теги в теле экранируются (VL-81)', () => {
    const md = renderDocumentRich({
      ...entry,
      body: 'текст <tg-button>сырой</tg-button> и <details>x</details>',
    });
    // contentSafe оборачивает каждый тег в inline-бэкитики — сырой
    // континуальный фрагмент в рендере отсутствует
    assert.ok(!md.includes('<tg-button>сырой</tg-button>'), 'сырой тег не должен пройти');
    assert.ok(!md.includes('<details>x</details>'), 'сырой details не должен пройти');
    assert.ok(md.includes('`<tg-button>`'), 'тег обёрнут в inline-код');
  });
});

describe('renderCommitsRich (VL-90)', () => {
  const commits = [
    { hash: 'abc123', author: 'Pavel', date: '2026-10-05 18:00', subject: 'Добавить фичу' },
    { hash: 'def456', author: 'Алексей', date: '2026-10-04 12:30', subject: 'Исправить баг' },
  ];

  it('заголовок и колонки таблицы: Тема | Дата | Автор | Хеш', () => {
    const md = renderCommitsRich(commits);
    assert.match(md, /# 📜 Последние коммиты/);
    assert.ok(
      md.includes('<tr><th>Тема</th><th>Дата</th><th>Автор</th><th>Хеш</th></tr>'),
      'порядок колонок: Тема | Дата | Автор | Хеш'
    );
    assert.ok(
      md.includes('<tr><td>Добавить фичу</td><td>2026-10-05 18:00</td><td>Pavel</td><td><code>abc123</code></td></tr>'),
      'порядок ячеек: Тема, Дата, Автор, Хеш'
    );
  });

  it('спецсимволы в теме экранируются через cellSafe', () => {
    const md = renderCommitsRich([
      { hash: 'x', author: 'a', date: 'd', subject: 'Текст <b>жирный</b> и <tg-button>сырой</tg-button>' },
    ]);
    assert.ok(!md.includes('<b>жирный</b>'), 'сырой тег не должен пройти');
    assert.ok(md.includes('&#60;'), 'спецсимволы экранированы (&#60; — cellSafe)');
  });

  it('пустой массив → ""', () => {
    assert.equal(renderCommitsRich([]), '');
  });
});
