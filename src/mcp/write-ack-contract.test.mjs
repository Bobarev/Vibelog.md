/**
 * Инвариант-тест единого JSON-контракта write-инструментов MCP (VL-306).
 *
 * Проблема, которую тест закрывает: VL-303/VL-304 починили noop-детекцию и
 * защиту `appliedSignatures`, но только для `backlog_update_task` — остальные
 * write-инструменты отвечали плоским текстом, и механизм для них не
 * включался (сессия agent-1793634687751: 10 дословных повторов
 * `lesson_update` → loop detection → fail, код 1).
 *
 * Два уровня защиты:
 * 1. Каждый write-инструмент из AC1 обязан вернуть JSON с полем `ok` —
 *    кейсы ниже вызывают их с реальными аргументами.
 * 2. Инвариант по реестру: если в `listTools()` появится НОВЫЙ write-инструмент
 *    (по классификатору `isWriteOperation`), которого нет ни в покрытом
 *    наборе, ни в явном списке исключений с причиной, тест упадёт —
 *    «пятый случай» не проскочит молча.
 *
 * Фикстуры создаются ядром (createDocument/addReference/createLessonFile), а не
 * MCP-инструментами создания: `document_create`/`reference_add`/`lesson_create`
 * в контракт VL-306 не входят и отвечают текстом.
 *
 * Тестовый каталог — mkdtempSync (VL-241).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { handleToolCall, listTools } from '../../dist/mcp/tools.js';
import { isWriteOperation } from '../../dist/core/tool-classify.js';
import { createTaskFile } from '../../dist/core/store.js';
import { writeDocument } from '../../dist/core/document.js';
import { writeReference } from '../../dist/core/reference.js';
import { createLessonFile, getLesson, lessonToMarkdown } from '../../dist/core/lesson.js';
import { clearPhaseEnv } from '../test-env.mjs';

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-write-ack-contract-'));
const backlogDir = join(cwd, 'backlog');

/**
 * Фазовый env агентской сессии на время файла (VL-286, VL-374): `VIBELOG_CWD`
 * увёл бы `git_commit` (VL-311) в главный репозиторий вместо mkdtemp-каталога,
 * а `VIBELOG_PHASE_NAME`/`VIBELOG_RUN_PHASE` подменили бы фазу в расчёте
 * неполноты (VL-370). Механизм — общий хелпер `clearPhaseEnv()`; возвращённая
 * функция восстановления вызывается в afterAll.
 */
let restorePhaseEnv;

beforeAll(() => {
  restorePhaseEnv = clearPhaseEnv();
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'WriteAck Contract Test',
    task_prefix: 'wa',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    priorities: ['High', 'Medium', 'Low'],
    types: ['bug', 'feature', 'chore'],
    definition_of_done: ['Тесты проходят'],
  }), 'utf-8');
  // VL-311: git_commit проверяется на реальном репозитории (noop-сценарий)
  execFileSync('/usr/bin/git', ['init', '-q'], { cwd });
  execFileSync('/usr/bin/git', ['config', 'user.email', 'test@example.com'], { cwd });
  execFileSync('/usr/bin/git', ['config', 'user.name', 'Test'], { cwd });
});

afterAll(() => {
  restorePhaseEnv();
  rmSync(cwd, { recursive: true, force: true });
});

/** Разбирает ответ инструмента как JSON-ack и проверяет базовую форму. */
function parseAck(out, name) {
  let ack;
  try {
    ack = JSON.parse(out);
  } catch {
    assert.fail(`${name}: ответ не JSON — ${String(out).slice(0, 200)}`);
  }
  assert.equal(typeof ack.ok, 'boolean', `${name}: поле ok должно быть boolean — ${out.slice(0, 200)}`);
  assert.equal(typeof ack.message, 'string', `${name}: поле message обязательно — ${out.slice(0, 200)}`);
  return ack;
}

describe('VL-306 — все write-инструменты отвечают JSON-ack', () => {
  it('AC1: backlog_update_status', async () => {
    const t = createTaskFile(cwd, { title: 'Статус' });
    const ack = parseAck(await handleToolCall('backlog_update_status', { id: t.id, status: 'In Progress' }, cwd), 'backlog_update_status');
    assert.equal(ack.ok, true);
    assert.equal(ack.applied.status, 'In Progress');
  });

  it('AC1: milestone_add / milestone_rename / milestone_archive', async () => {
    const add = parseAck(await handleToolCall('milestone_add', { name: 'M1', description: 'd' }, cwd), 'milestone_add');
    assert.equal(add.ok, true);
    assert.equal(add.applied.name, 'M1');

    const rename = parseAck(await handleToolCall('milestone_rename', { from: 'M1', to: 'M2' }, cwd), 'milestone_rename');
    assert.equal(rename.ok, true);
    assert.equal(rename.applied.to, 'M2');

    const archive = parseAck(await handleToolCall('milestone_archive', { name: 'M2' }, cwd), 'milestone_archive');
    assert.equal(archive.ok, true);
    assert.equal(archive.applied.status, 'archived');
  });

  it('AC1: document_update', async () => {
    const doc = writeDocument(backlogDir, { title: 'Док', content: 'тело' });
    const ack = parseAck(await handleToolCall('document_update', { id: doc.id, title: 'Док 2' }, cwd), 'document_update');
    assert.equal(ack.ok, true);
    assert.equal(ack.applied.title, 'Док 2');
  });

  it('AC1: reference_update', async () => {
    const ref = writeReference(cwd, { title: 'Ref', type: 'url', url: 'https://example.com' });
    const ack = parseAck(await handleToolCall('reference_update', { id: ref.id, tags: ['t1'] }, cwd), 'reference_update');
    assert.equal(ack.ok, true);
    assert.deepEqual(ack.applied.tags, ['t1']);
  });

  it('AC1: lesson_update / lesson_link / lesson_supersede', async () => {
    const l1 = createLessonFile(cwd, { title: 'Урок 1', tags: ['a'], content: '## Проблема\n\nшум\n' });
    const l2 = createLessonFile(cwd, { title: 'Урок 2', tags: ['b'], content: '## Проблема\n\nшум\n' });
    const t = createTaskFile(cwd, { title: 'Задача для связи' });

    const upd = parseAck(await handleToolCall('lesson_update', { id: l1.id, verifiedBy: 'agent' }, cwd), 'lesson_update');
    assert.equal(upd.ok, true);
    assert.equal(upd.applied.verified_by, 'agent');

    const link = parseAck(await handleToolCall('lesson_link', { lessonId: l1.id, taskId: t.id }, cwd), 'lesson_link');
    assert.equal(link.ok, true);
    assert.equal(link.applied.lessonId, l1.id);

    const sup = parseAck(await handleToolCall('lesson_supersede', { oldId: l1.id, newId: l2.id }, cwd), 'lesson_supersede');
    assert.equal(sup.ok, true);
    assert.equal(sup.applied.old_status, 'superseded');
  });

  it('AC5: каждый write-инструмент реестра покрыт таблицей ack-контракта', () => {
    // Покрытые JSON-ack контрактом (VL-262 + VL-306): кейсы выше + уже
    // переведённые ранее инструменты задач.
    const covered = new Set([
      'backlog_create_task',
      'backlog_update_task',
      'backlog_update_status',
      'backlog_add_comment',
      'backlog_update_dependencies',
      'backlog_finish_phase',
      'backlog_manage_ac',
      'backlog_manage_dod',
      'milestone_add',
      'milestone_rename',
      'milestone_archive',
      'milestone_remove',
      'document_create',
      'document_update',
      // VL-399: точечная правка тела документа
      'document_edit',
      'reference_add',
      'reference_update',
      'reference_link',
      'reference_remove',
      'reference_sync',
      'lesson_create',
      'lesson_update',
      'lesson_link',
      'lesson_supersede',
      'lesson_audit',
      'lesson_classify',
      'write_file',
      // VL-311: git_commit отвечает JSON-ack (hash/subject/paths) и noop
      'git_commit',
      // VL-363: upstream_report_bug отвечает JSON-ack (number/url/labels)
      'upstream_report_bug',
      // VL-391: upstream_ack_report отвечает JSON-ack (status/accepted_as/rejected_reason)
      'upstream_ack_report',
      // VL-398: workflow_apply отвечает JSON-ack (applied/noop/error)
      'workflow_apply',
      // VL-412: решения (ADR) — create/update отвечают JSON-ack
      'decision_create',
      'decision_update',
    ]);
    // Явные исключения с причиной: инструменты супервизора/очереди (VL-268)
    // управляют прогоном фаз, а не данными backlog; их ответ — карточка
    // состояния прогона, а не снимок applied/skipped. В контракт VL-306 не
    // входят (вне скоупа задачи), но и молча «пятым случаем» не считаются.
    const outOfScope = new Set([
      'backlog_trigger_phase',
      'backlog_auto_queue',
      'backlog_supervisor',
      // VL-428: отправка в Telegram и ожидание ответа — сетевой вызов;
      // ответ — текст чужого бота, а не снимок applied (JSON-ack не применим)
      'interbot_ask',
    ]);
    const missing = listTools()
      .map(t => t.name)
      .filter(name => isWriteOperation(name) && !covered.has(name) && !outOfScope.has(name));
    assert.deepEqual(missing, [], `write-инструменты без JSON-ack в таблице: ${missing.join(', ')}`);
  });
});

/**
 * VL-351: таблица «каждый write-инструмент отвечает JSON-ack хотя бы в одной
 * ветке».
 *
 * Зачем динамическая проверка поверх статического списка `covered` (AC5
 * VL-306): статический список проверяет только НАЛИЧИЕ имени, поэтому
 * инструмент, вернувшийся к плоскому тексту, тест не валил. Здесь каждый
 * write-инструмент реально вызывается, и ответ обязан быть JSON с полем `ok`.
 *
 * Причина, по которой это критично: цикл агента (`src/agent/loop.ts`)
 * классифицирует исход вызова по JSON-ack. Плоский текст = неизвестный исход,
 * и до VL-351 страховка «не-JSON = применено» превращала чтение
 * (`backlog_manage_dod {action:list}`) в «применённую запись» — повтор получал
 * ложную директиву «уже применён ранее» (сессия agent-1794047067509).
 */
const ACK_SCENARIOS = {
  backlog_create_task: async () => handleToolCall('backlog_create_task', { title: 'Ack-задача' }, cwd),
  backlog_update_task: async () => {
    const t = createTaskFile(cwd, { title: 'Ack-update' });
    return handleToolCall('backlog_update_task', { id: t.id, type: 'feature' }, cwd);
  },
  backlog_update_status: async () => {
    const t = createTaskFile(cwd, { title: 'Ack-status' });
    return handleToolCall('backlog_update_status', { id: t.id, status: 'In Progress' }, cwd);
  },
  backlog_add_comment: async () => {
    const t = createTaskFile(cwd, { title: 'Ack-comment' });
    return handleToolCall('backlog_add_comment', { id: t.id, comment: 'текст' }, cwd);
  },
  backlog_update_dependencies: async () => {
    const base = createTaskFile(cwd, { title: 'Ack-база' });
    const t = createTaskFile(cwd, { title: 'Ack-зависимая' });
    return handleToolCall('backlog_update_dependencies', { id: t.id, add: [base.id] }, cwd);
  },
  // VL-351: все пять веток action — JSON-ack, включая чтение (read-семантика).
  backlog_manage_ac: async () => {
    const t = createTaskFile(cwd, { title: 'Ack-ac' });
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'add', text: 'A1' }, cwd);
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'check', index: 1 }, cwd);
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'uncheck', index: 1 }, cwd);
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'list' }, cwd);
    return handleToolCall('backlog_manage_ac', { id: t.id, action: 'remove', index: 1 }, cwd);
  },
  backlog_manage_dod: async () => {
    const t = createTaskFile(cwd, { title: 'Ack-dod' });
    await handleToolCall('backlog_manage_dod', { id: t.id, action: 'add', text: ['D1', 'D2'] }, cwd);
    await handleToolCall('backlog_manage_dod', { id: t.id, action: 'check', index: [1, 2] }, cwd);
    await handleToolCall('backlog_manage_dod', { id: t.id, action: 'uncheck', index: 1 }, cwd);
    await handleToolCall('backlog_manage_dod', { id: t.id, action: 'list' }, cwd);
    return handleToolCall('backlog_manage_dod', { id: t.id, action: 'remove', index: 1 }, cwd);
  },
  milestone_add: async () => handleToolCall('milestone_add', { name: 'AckM', description: 'd' }, cwd),
  milestone_rename: async () => {
    await handleToolCall('milestone_add', { name: 'AckM2', description: 'd' }, cwd);
    return handleToolCall('milestone_rename', { from: 'AckM2', to: 'AckM3' }, cwd);
  },
  milestone_archive: async () => {
    await handleToolCall('milestone_add', { name: 'AckM4', description: 'd' }, cwd);
    return handleToolCall('milestone_archive', { name: 'AckM4' }, cwd);
  },
  milestone_remove: async () => {
    await handleToolCall('milestone_add', { name: 'AckM5', description: 'd' }, cwd);
    return handleToolCall('milestone_remove', { name: 'AckM5' }, cwd);
  },
  document_create: async () => handleToolCall('document_create', { title: 'Ack-док', content: 'тело' }, cwd),
  document_update: async () => {
    const doc = writeDocument(backlogDir, { title: 'Ack-док 2', content: 'тело' });
    return handleToolCall('document_update', { id: doc.id, title: 'Ack-док 3' }, cwd);
  },
  // VL-399: точечная правка тела — JSON-ack как у всех write-инструментов
  document_edit: async () => {
    const doc = writeDocument(backlogDir, { title: 'Ack-док edit', content: 'старое тело' });
    return handleToolCall('document_edit', { id: doc.id, old_string: 'старое', new_string: 'новое' }, cwd);
  },
  reference_add: async () => handleToolCall('reference_add', { title: 'Ack-ref', type: 'url', url: 'https://example.org' }, cwd),
  reference_update: async () => {
    const ref = writeReference(cwd, { title: 'Ack-ref 2', type: 'url', url: 'https://example.org/2' });
    return handleToolCall('reference_update', { id: ref.id, tags: ['t'] }, cwd);
  },
  reference_link: async () => {
    const ref = writeReference(cwd, { title: 'Ack-ref 3', type: 'url', url: 'https://example.org/3' });
    const t = createTaskFile(cwd, { title: 'Ack-ref-задача' });
    return handleToolCall('reference_link', { referenceId: ref.id, taskId: t.id }, cwd);
  },
  reference_remove: async () => {
    const ref = writeReference(cwd, { title: 'Ack-ref 4', type: 'url', url: 'https://example.org/4' });
    return handleToolCall('reference_remove', { id: ref.id }, cwd);
  },
  lesson_create: async () => handleToolCall('lesson_create', { title: 'Ack-урок', problem: 'п', solution: 'р' }, cwd),
  lesson_update: async () => {
    const l = createLessonFile(cwd, { title: 'Ack-урок 2', tags: ['a'], content: '## Проблема\n\nx\n' });
    return handleToolCall('lesson_update', { id: l.id, verifiedBy: 'agent' }, cwd);
  },
  lesson_link: async () => {
    const l = createLessonFile(cwd, { title: 'Ack-урок 3', content: '## Проблема\n\nx\n' });
    const t = createTaskFile(cwd, { title: 'Ack-урок-задача' });
    return handleToolCall('lesson_link', { lessonId: l.id, taskId: t.id }, cwd);
  },
  lesson_supersede: async () => {
    const l1 = createLessonFile(cwd, { title: 'Ack-урок 4', content: '## Проблема\n\nx\n' });
    const l2 = createLessonFile(cwd, { title: 'Ack-урок 5', content: '## Проблема\n\nx\n' });
    return handleToolCall('lesson_supersede', { oldId: l1.id, newId: l2.id }, cwd);
  },
  git_commit: async () => {
    writeFileSync(join(cwd, 'ack-contract.txt'), 'ack', 'utf-8');
    return handleToolCall('git_commit', { paths: ['ack-contract.txt'], message: 'chore: ack-контракт' }, cwd);
  },
  // VL-398: конструктор workflow — запись секции workflows в settings.json
  workflow_apply: async () => handleToolCall('workflow_apply', {
    patch: {
      workflows: {
        acktest: {
          initial_status: 'To Do',
          transitions: [
            { status: 'To Do', phase: 'do', produces_status: 'Done' },
            { status: 'Done', phase: null, produces_status: null },
          ],
        },
      },
    },
  }, cwd),
  // VL-412: решения (ADR) — создание и точечная правка
  decision_create: async () => handleToolCall('decision_create', {
    title: 'Ack-решение', context: 'контекст',
  }, cwd),
  decision_update: async () => {
    const created = JSON.parse(await handleToolCall('decision_create', {
      title: 'Ack-решение update', context: 'контекст',
    }, cwd));
    return handleToolCall('decision_update', { id: created.applied.id, status: 'accepted' }, cwd);
  },
};

/**
 * VL-351: write-инструменты вне таблицы ACK_SCENARIOS — с причиной.
 *
 * Инструменты прогона фаз/очереди (VL-268) управляют прогоном, а не данными
 * backlog: их ответ — карточка состояния, а не снимок applied/skipped.
 * `reference_sync` ходит в сеть (клонирование/скачивание) — в офлайн-тесте
 * сценарий недетерминирован; JSON-ack у него уже есть (VL-262).
 */
const ACK_OUT_OF_SCOPE = {
  backlog_finish_phase: 'сводка фазы — человекочитаемый текст (её читают шаблоны и тесты); повтор отклоняется сервером (already_finished) → toolError, ложного «применено» не возникает',
  backlog_trigger_phase: 'прогон фаз, а не данные backlog (VL-268)',
  backlog_auto_queue: 'очередь прогона, а не данные backlog (VL-268)',
  backlog_supervisor: 'прогон супервизора, а не данные backlog (VL-268)',
  reference_sync: 'ходит в сеть — сценарий недетерминирован в офлайн-тесте',
  upstream_report_bug: 'ходит в сеть (GitVerse Issues) — сценарий недетерминирован в офлайн-тесте; JSON-ack проверяется в gitverse-issues.test.mjs и upstream-tool.test.mjs',
  upstream_ack_report: 'работает поверх git-инбокса (clone/pull/push) — сценарий в офлайн-тесте недетерминирован; JSON-ack проверяется в upstream-tool.test.mjs',
  interbot_ask: 'ходит в Telegram Bot API и ждёт ответ до 55 с — сценарий недетерминирован в офлайн-тесте; текстовая семантика (ответ/таймаут) проверяется в ask.test.mjs',
};

describe('VL-351 — каждый write-инструмент отвечает JSON-ack', () => {
  it('AC1/AC4: все write-инструменты реестра покрыты таблицей ACK_SCENARIOS', () => {
    const missing = listTools()
      .map(t => t.name)
      .filter(name => isWriteOperation(name))
      .filter(name => !(name in ACK_SCENARIOS) && !(name in ACK_OUT_OF_SCOPE));
    assert.deepEqual(
      missing,
      [],
      `write-инструменты без JSON-ack сценария: ${missing.join(', ')}. ` +
        'Добавь вызов в ACK_SCENARIOS (ответ обязан быть JSON с полем ok) ' +
        'или строку с причиной в ACK_OUT_OF_SCOPE.',
    );
  });

  it('AC1/AC4: каждый сценарий возвращает JSON с полем ok', async () => {
    for (const [name, scenario] of Object.entries(ACK_SCENARIOS)) {
      const out = await scenario();
      let ack;
      try {
        ack = JSON.parse(out);
      } catch {
        assert.fail(`${name}: ответ не JSON — ${String(out).slice(0, 200)}`);
      }
      assert.equal(typeof ack.ok, 'boolean', `${name}: поле ok должно быть boolean — ${String(out).slice(0, 200)}`);
    }
  });

  it('AC2: backlog_manage_ac/dod action:list — read-семантика (read:true, не applied)', async () => {
    const t = createTaskFile(cwd, { title: 'Read-семантика' });
    await handleToolCall('backlog_manage_ac', { id: t.id, action: 'add', text: 'R1' }, cwd);
    const ac = JSON.parse(await handleToolCall('backlog_manage_ac', { id: t.id, action: 'list' }, cwd));
    assert.equal(ac.ok, true, 'чтение — успешный ответ');
    assert.equal(ac.read, true, 'признак read обязателен: цикл не считает его применённой записью');
    assert.deepEqual(ac.applied.items, [{ index: 1, checked: false, text: 'R1' }], 'снимок прочитанного');
    assert.match(ac.message, /1\. ○ R1/, 'привычный текст списка сохранён');

    const empty = createTaskFile(cwd, { title: 'Пустой чеклист' });
    // У задачи из конфига есть дефолтный DoD — чистим, чтобы проверить пустой список
    await handleToolCall('backlog_manage_dod', { id: empty.id, action: 'remove', index: 'all' }, cwd);
    const emptyAck = JSON.parse(await handleToolCall('backlog_manage_dod', { id: empty.id, action: 'list' }, cwd));
    assert.equal(emptyAck.read, true);
    assert.equal(emptyAck.message, 'Чеклист пуст.', 'привычная подстрока сохранена');
    assert.deepEqual(emptyAck.applied.items, []);
  });
});

/**
 * VL-310/VL-413: таблица write-инструментов с неизменяющей записью.
 *
 * Каждый вход — сценарий «первый вызов применяет, второй с ТЕМИ ЖЕ
 * аргументами обязан ответить `applied` + непустым `unchanged`». Сценарий сам
 * готовит данные и возвращает второй ack — так таблица остаётся данными, а не
 * копипастой.
 *
 * VL-413: исход `noop` удалён. Неизменяющая запись — нормальное свойство
 * идемпотентного write-API, а не событие: `ok:false` модель читала как
 * «не удалось» и повторяла вызов до капа (сессии agent-1794322537996,
 * agent-1793637056809).
 */
const UNCHANGED_SCENARIOS = {
  backlog_update_task: async () => {
    const t = createTaskFile(cwd, { title: 'Noop-задача контракта', type: 'bug' });
    await handleToolCall('backlog_update_task', { id: t.id, type: 'feature' }, cwd);
    return JSON.parse(await handleToolCall('backlog_update_task', { id: t.id, type: 'feature' }, cwd));
  },
  backlog_update_status: async () => {
    const t = createTaskFile(cwd, { title: 'Noop-статус контракта' });
    await handleToolCall('backlog_update_status', { id: t.id, status: 'In Progress' }, cwd);
    return JSON.parse(await handleToolCall('backlog_update_status', { id: t.id, status: 'In Progress' }, cwd));
  },
  backlog_update_dependencies: async () => {
    const base = createTaskFile(cwd, { title: 'Noop-база контракта' });
    const t = createTaskFile(cwd, { title: 'Noop-зависимая контракта' });
    await handleToolCall('backlog_update_dependencies', { id: t.id, add: [base.id] }, cwd);
    return JSON.parse(await handleToolCall('backlog_update_dependencies', { id: t.id, add: [base.id] }, cwd));
  },
  // VL-398: повтор того же патча workflow — noop (сравнение содержимого)
  workflow_apply: async () => {
    const patch = {
      workflows: {
        acktest: {
          initial_status: 'To Do',
          transitions: [
            { status: 'To Do', phase: 'do', produces_status: 'Done' },
            { status: 'Done', phase: null, produces_status: null },
          ],
        },
      },
    };
    await handleToolCall('workflow_apply', { patch }, cwd);
    return JSON.parse(await handleToolCall('workflow_apply', { patch }, cwd));
  },
  document_update: async () => {
    const doc = writeDocument(backlogDir, { title: 'Noop-док контракта', type: 'guide' });
    return JSON.parse(await handleToolCall('document_update', { id: doc.id, type: 'guide' }, cwd));
  },
  // VL-399: замена текста на тот же самый — файл не переписывается, это noop
  document_edit: async () => {
    const doc = writeDocument(backlogDir, { title: 'Noop-док правки', content: 'тело документа' });
    return JSON.parse(await handleToolCall('document_edit', {
      id: doc.id, old_string: 'тело документа', new_string: 'тело документа',
    }, cwd));
  },
  reference_update: async () => {
    const ref = writeReference(cwd, { title: 'Noop-ref контракта', type: 'url', url: 'https://example.net', tags: ['a'] });
    await handleToolCall('reference_update', { id: ref.id, tags: ['a'] }, cwd);
    return JSON.parse(await handleToolCall('reference_update', { id: ref.id, tags: ['a'] }, cwd));
  },
  lesson_update: async () => {
    const l = createLessonFile(cwd, { title: 'Noop-урок контракта', tags: ['a'], content: '## Проблема\n\nшум\n' });
    await handleToolCall('lesson_update', { id: l.id, verifiedBy: 'agent' }, cwd);
    return JSON.parse(await handleToolCall('lesson_update', { id: l.id, verifiedBy: 'agent' }, cwd));
  },
  lesson_link: async () => {
    const l = createLessonFile(cwd, { title: 'Noop-связь урока' });
    const t = createTaskFile(cwd, { title: 'Noop-задача урока' });
    await handleToolCall('lesson_link', { lessonId: l.id, taskId: t.id }, cwd);
    return JSON.parse(await handleToolCall('lesson_link', { lessonId: l.id, taskId: t.id }, cwd));
  },
  reference_link: async () => {
    const ref = writeReference(cwd, { title: 'Noop-связь ref', type: 'url', url: 'https://example.com/x' });
    const t = createTaskFile(cwd, { title: 'Noop-задача ref' });
    await handleToolCall('reference_link', { referenceId: ref.id, taskId: t.id }, cwd);
    return JSON.parse(await handleToolCall('reference_link', { referenceId: ref.id, taskId: t.id }, cwd));
  },
  milestone_rename: async () => {
    const add = await handleToolCall('milestone_add', { name: 'Mnoop', description: 'd' }, cwd);
    assert.equal(JSON.parse(add).ok, true);
    return JSON.parse(await handleToolCall('milestone_rename', { from: 'Mnoop', to: 'Mnoop' }, cwd));
  },
  // VL-311: повторный git_commit по тем же (уже закоммиченным) путям — noop.
  git_commit: async () => {
    writeFileSync(join(cwd, 'gitcommit-noop.txt'), 'noop', 'utf-8');
    const first = JSON.parse(await handleToolCall('git_commit', {
      paths: ['gitcommit-noop.txt'], message: 'feat: noop-коммит контракта',
    }, cwd));
    assert.equal(first.ok, true, `первый git_commit обязан примениться — ${JSON.stringify(first)}`);
    return JSON.parse(await handleToolCall('git_commit', {
      paths: ['gitcommit-noop.txt'], message: 'feat: noop-коммит контракта',
    }, cwd));
  },
  // VL-412: повтор той же точечной правки решения — noop (сравнение секций)
  decision_update: async () => {
    const created = JSON.parse(await handleToolCall('decision_create', {
      title: 'Noop-решение контракта', context: 'контекст',
    }, cwd));
    const id = created.applied.id;
    await handleToolCall('decision_update', { id, status: 'accepted' }, cwd);
    return JSON.parse(await handleToolCall('decision_update', { id, status: 'accepted' }, cwd));
  },
};

/**
 * VL-310/VL-413: write-инструменты, для которых неизменяющая запись
 * НЕПРИМЕНИМА по природе операции. Причина обязательна — «пятый случай» не
 * должен проскочить молча.
 */
const UNCHANGED_NOT_APPLICABLE = {
  backlog_create_task: 'создание: повтор создаёт новую сущность, состояние «до» не существует',
  backlog_add_comment: 'дописывание: каждый вызов добавляет запись, тело не хранится как поле',
  backlog_finish_phase: 'фаза: смена статуса + отчёт; повтор отклоняется сервером (already_finished)',
  backlog_manage_ac: 'add/check/uncheck/remove — операции над списком, идемпотентность решает сервер',
  backlog_manage_dod: 'add/check/uncheck/remove — операции над списком, идемпотентность решает сервер',
  milestone_add: 'создание вехи: повтор упадёт «уже существует»',
  milestone_archive: 'удаление/перемещение: повтор упадёт «не найдена»',
  milestone_remove: 'удаление вехи: повтор упадёт «не найдена»',
  document_create: 'создание документа: каждый вызов даёт новый doc-N',
  reference_add: 'создание reference: каждый вызов даёт новый ref-N',
  reference_remove: 'удаление: повтор упадёт «не найден»',
  reference_sync: 'синхронизация: читает внешние источники, ответ — отчёт о скачивании',
  lesson_create: 'создание урока: каждый вызов даёт новый lesson-N',
  lesson_supersede: 'переход статусов: повтор отклоняется ядром (уже superseded)',
  lesson_audit: 'аудит read-only по умолчанию, отчёт, а не снимок состояния',
  lesson_classify: 'LLM-классификация: отчёт по умолчанию, записи только по явному подтверждению',
  write_file: 'запись файла: сравнение содержимого вне домена backlog (отдельный инструмент)',
  upstream_report_bug: 'создание issue во внешней системе: каждый вызов даёт новый номер (дедуп — номер issue, а не сравнение полей)',
  upstream_ack_report: 'ack не идемпотентен по ключу: повторный accept с тем же task_id перезаписывает те же значения (не noop-ответ, а повторная запись того же файла); решение по отчёту — не «поле задачи», сравнение снимков неприменимо',
  interbot_ask: 'каждый вызов отправляет новое сообщение в Telegram-группу и создаёт тикет: состояние «до» не существует, повтор — второе сообщение (дедуп — по тикету/message_id, а не сравнение полей)',
  // VL-412: создание решения — каждый вызов даёт новый decision-N
  decision_create: 'создание решения: каждый вызов даёт новый decision-N (id = max+1), состояние «до» не существует',
};

describe('VL-310/VL-413 — инвариант «неизменяющая запись — успех с unchanged»', () => {
  it('AC2: каждый инструмент отвечает {ok:true, outcome:applied, unchanged:[…]} на повторной идентичной записи', async () => {
    for (const [name, scenario] of Object.entries(UNCHANGED_SCENARIOS)) {
      const ack = await scenario();
      assert.equal(ack.ok, true, `${name}: неизменяющая запись — успех, а не событие — ${JSON.stringify(ack).slice(0, 300)}`);
      assert.equal(ack.outcome, 'applied', `${name}: исход — applied`);
      assert.ok(Array.isArray(ack.unchanged) && ack.unchanged.length > 0,
        `${name}: unchanged перечисляет неизменённые поля — ${JSON.stringify(ack).slice(0, 300)}`);
      assert.ok(!('noop' in ack), `${name}: исхода noop больше нет`);
      assert.ok(!('hint' in ack), `${name}: hint как канал следующего шага удалён`);
      assert.match(String(ack.message), /Изменений нет/, `${name}: маркер «Изменений нет» обязателен`);
    }
  });

  it('AC2/AC3: новый write-инструмент без unchanged-детекции валит тест', () => {
    const missing = listTools()
      .map(t => t.name)
      .filter(name => isWriteOperation(name))
      .filter(name => !(name in UNCHANGED_SCENARIOS)
        && !(name in UNCHANGED_NOT_APPLICABLE)
        // Инструменты прогона фаз/очереди — вне домена данных backlog (VL-268).
        && !['backlog_trigger_phase', 'backlog_auto_queue', 'backlog_supervisor'].includes(name));
    assert.deepEqual(
      missing,
      [],
      `write-инструменты без unchanged-семантики и без документированного исключения: ${missing.join(', ')}. ` +
        'Добавь сценарий в UNCHANGED_SCENARIOS (если операция идемпотентна по значениям) ' +
        'или строку с причиной в UNCHANGED_NOT_APPLICABLE.',
    );
  });
});

/**
 * VL-319: noop-ответ обязан называть НЕЗАПОЛНЕННОЕ обязательное поле.
 *
 * Инвариант введён только для уроков: у остальных сущностей «обязательное по
 * смыслу» поле не определено механически, и требование `missing` сломало бы
 * 8 инструментов. Для урока такое поле есть — тело: пустое тело означает, что
 * урок создан шаблоном без `content` (phase-close.md до VL-319), и модель
 * должна узнать об этом из ответа, а не из повторного чтения.
 */
describe('VL-319 — noop-ответ называет незаполненное обязательное поле', () => {
  it('AC3/VL-379/VL-413: неизменяющая запись lesson_update на пустом теле называет problem в missing', async () => {
    const l = createLessonFile(cwd, { title: 'Урок-пустышка контракта', tags: ['a'] });
    // Обнуляем тело: имитируем урок, созданный шаблоном Close без content
    const entry = getLesson(cwd, l.id);
    writeFileSync(entry.path, lessonToMarkdown(entry.lesson, ''), 'utf-8');
    // VL-369: неполнота — свойство сущности, а не ошибка вызова. Вызов без
    // изменяющих полей на пустом теле — noop + missing, не отказ (4-я строка
    // таблицы исходов). Отказ остался только для испорченного аргумента.
    const err = JSON.parse(await handleToolCall('lesson_update', { id: l.id }, cwd));
    assert.equal(err.outcome, 'applied', `ожидался applied: ${JSON.stringify(err)}`);
    assert.equal(err.ok, true, 'неизменяющая запись — успех (VL-413)');
    assert.equal(err.missing[0].field, 'problem', 'missing называет пропущенное поле');
    // VL-355: вызов с ДРУГИМ полем на пустом теле применяется и предупреждает
    const partial = JSON.parse(await handleToolCall('lesson_update', { id: l.id, verifiedBy: 'agent' }, cwd));
    assert.equal(partial.ok, true, `частичное применение: ${JSON.stringify(partial)}`);
    assert.equal(partial.missing[0].field, 'problem', 'успех тоже называет незаполненное тело');
    assert.equal(partial.retryWith.problem, '<что было не так>', 'готовый образец аргументов');
    // Дополняем тело → повторный вызов даёт noop с missing (тело уже непустое,
    // но проверяем форму ответа: applied — только переданные поля)
    writeFileSync(entry.path, lessonToMarkdown(entry.lesson, '## Проблема\n\nx\n'), 'utf-8');
    const first = JSON.parse(await handleToolCall('lesson_update', { id: l.id, verifiedBy: 'agent' }, cwd));
    assert.equal(first.ok, true, `первый вызов применяет: ${JSON.stringify(first)}`);
    const repeat = JSON.parse(await handleToolCall('lesson_update', { id: l.id, verifiedBy: 'agent' }, cwd));
    assert.equal(repeat.outcome, 'applied', `ожидался applied: ${JSON.stringify(repeat)}`);
    assert.deepEqual(repeat.unchanged, ['verified_by'], 'unchanged — переданное поле уже такое');
    assert.deepEqual(repeat.applied, {}, 'applied пуст — ничего не записано');
  });
});

/**
 * VL-357 AC4: инвариант «валидация необязательного по смыслу поля не блокирует
 * операцию».
 *
 * Класс VL-356: инструмент отвечал ЖЁСТКИМ отказом на отсутствие поля, без
 * которого операция осмысленна (урок без тела). Модель не могла выполнить шаг,
 * повторяла вызов дословно и падала по капу повторов. Правило протокола:
 * отсутствие НЕОБЯЗАТЕЛЬНОГО по смыслу поля — исход `partial` + `next.missing`,
 * сущность создаётся (со скелетом), модель получает следующий шаг.
 *
 * Тест обходит реестр `listTools()`, поэтому новый write-инструмент обязан
 * попасть либо в таблицу сценариев, либо в список исключений с причиной —
 * иначе сборка красная. Это и есть механическая защита от нового рецидива.
 */
const PARTIAL_SCENARIOS = {
  document_create: async () => handleToolCall('document_create', { title: 'Partial-док' }, cwd),
  reference_add: async () =>
    handleToolCall('reference_add', { title: 'Partial-ref', type: 'url', url: 'https://example.org/p' }, cwd),
  // VL-369: неполнота задачи считается ОТ СОСТОЯНИЯ (description пуст), поэтому
  // обновление задачи без описания — partial с missing[0].field === 'description'.
  backlog_update_task: async () => {
    const t = createTaskFile(cwd, { title: 'Partial-задача VL-369' });
    return handleToolCall('backlog_update_task', { id: t.id, priority: 'High' }, cwd);
  },
};

/**
 * write-инструменты, у которых необязательного по смыслу поля нет (или оно
 * не определено механически) — с причиной. Пустой список исключений был бы
 * хуже: «пятый случай» проскочил бы молча.
 */
const PARTIAL_EXEMPT = {
  backlog_create_task: 'title — единственное обязательное поле и оно действительно обязательное (задача без заголовка не существует)',
  // VL-379: у урока тело ОБЯЗАТЕЛЬНО по смыслу — problem/solution в required,
  // сервер отказывает до записи (урок-скелет как класс исчез). Это уже не
  // «необязательное поле», поэтому partial-сценария нет.
  lesson_create: 'problem и solution обязательны: урок без тела — ровно тот дефект, который закрывал VL-379; отказ приходит ДО записи файла',
  upstream_report_bug: 'title обязателен: issue без заголовка не существует; body/severity/area/source_task — дополнение к телу, их отсутствие не делает репорт неполным',
  upstream_ack_report: 'report_id и action обязательны: без них решение не определить; task_id/reason условно обязательны (accept/reject) и отказ приходит ДО записи файла',
  backlog_update_status: 'status обязателен: без него операция не имеет смысла',
  backlog_add_comment: 'comment обязателен: пустой комментарий не является записью',
  backlog_update_dependencies: 'add/remove обязательны по смыслу: без них менять нечего',
  backlog_manage_ac: 'операции над списком: аргументы определяют действие, «необязательных по смыслу» полей нет',
  backlog_manage_dod: 'операции над списком: аргументы определяют действие, «необязательных по смыслу» полей нет',
  backlog_finish_phase: 'comment обязателен по контракту фазы (сервер собирает авто-отчёт при отсутствии)',
  milestone_add: 'name обязателен: веха без имени не существует',
  milestone_rename: 'from/to обязательны: переименование без цели невозможно',
  milestone_remove: 'name обязателен',
  milestone_archive: 'name обязателен',
  document_update: 'обновление применяет переданные поля; тело документа отдельным полем необязательно',
  document_edit: 'одноцелевая точечная операция: все аргументы (id/old_string/new_string) обязательны по смыслу — «неполного» применения не существует',
  reference_update: 'обновление применяет переданные поля',
  reference_remove: 'id обязателен',
  reference_link: 'referenceId/taskId обязательны: связь без одной из сторон не существует',
  reference_sync: 'синхронизация не принимает необязательных по смыслу полей (режим — все источники)',
  lesson_view: 'read-ветка',
  lesson_update: 'обновление применяет переданные поля; VL-355 уже отдаёт partial при незаполненном теле',
  lesson_link: 'lessonId/taskId обязательны',
  lesson_supersede: 'oldId/newId обязательны',
  lesson_audit: 'отчёт по умолчанию — read-семантика',
  lesson_classify: 'отчёт по умолчанию — read-семантика',
  write_file: 'локальный файловый инструмент: content обязателен по природе записи',
  git_commit: 'paths/message обязательны: коммит без путей невозможен',
  backlog_trigger_phase: 'прогон фаз: id обязателен',
  backlog_auto_queue: 'очередь: action обязателен',
  backlog_supervisor: 'прогон: action обязателен',
  // VL-398: patch обязателен по смыслу — без него менять нечего; dryRun/
  // syncStatuses — модификаторы поведения, а не «незаполненные поля».
  workflow_apply: 'patch обязателен: без конфигурации применять нечего; dryRun/syncStatuses — модификаторы, а не поля сущности',
  // VL-412: title — единственное обязательное поле решения; ADR-секции
  // дополняются позже через decision_update, их отсутствие не делает решение
  // неполным (решение может быть зафиксировано одним заголовком).
  decision_create: 'title обязателен: решение без заголовка не существует; ADR-секции (context/decision/consequences/alternatives) — дополнение, которое пишется отдельным decision_update',
  decision_update: 'обновление применяет переданные поля; «необязательных по смыслу» полей нет — правка точечная по секциям',
  interbot_ask: 'question обязателен (отказ приходит ДО отправки); channel/kind/to — дефолтные (default_channel, question), их отсутствие не делает вызов неполным',
};

describe('VL-357 — отсутствие необязательного по смыслу поля даёт partial, а не rejected', () => {
  it('AC4: сценарии возвращают outcome=partial с непустым next.missing', async () => {
    for (const [name, scenario] of Object.entries(PARTIAL_SCENARIOS)) {
      const out = await scenario();
      let ack;
      try {
        ack = JSON.parse(out);
      } catch {
        assert.fail(`${name}: ответ не JSON — ${String(out).slice(0, 200)}`);
      }
      assert.equal(
        ack.outcome,
        'partial',
        `${name}: отсутствие необязательного по смыслу поля — partial, а не отказ: ${String(out).slice(0, 300)}`,
      );
      assert.equal(ack.ok, true, `${name}: partial — не ошибка (ok:true, совместимость с ack-потребителями)`);
      assert.ok(Array.isArray(ack.missing) && ack.missing.length > 0, `${name}: next.missing обязателен — ${String(out).slice(0, 300)}`);
      assert.equal(typeof ack.missing[0].field, 'string', `${name}: missing называет поле`);
      // VL-413: канал следующего шага — данные (missing/retryWith/phase), не hint.
      assert.ok(ack.phase !== undefined, `${name}: блок phase обязателен`);
    }
  });

  it('AC4: каждый write-инструмент реестра учтён — partial-сценарий либо документированное исключение', () => {
    const missing = listTools()
      .map(t => t.name)
      .filter(name => isWriteOperation(name))
      .filter(name => !(name in PARTIAL_SCENARIOS) && !(name in PARTIAL_EXEMPT));
    assert.deepEqual(
      missing,
      [],
      `write-инструменты без решения по необязательным полям: ${missing.join(', ')}. ` +
        'Добавь сценарий в PARTIAL_SCENARIOS (ответ обязан быть outcome:partial + missing) ' +
        'или строку с причиной в PARTIAL_EXEMPT.',
    );
  });

  it('AC4/VL-379: lesson_create без problem/solution отклоняется ДО записи (скелет исчез как класс)', async () => {
    const py = await handleToolCall('lesson_create', { title: 'Без тела' }, cwd);
    const ack = JSON.parse(py);
    assert.equal(ack.ok, false, `ожидался отказ: ${py}`);
    assert.deepEqual(ack.missing.map(m => m.field), ['problem', 'solution']);
    assert.match(String(ack.hint), /problem/);
  });
});
