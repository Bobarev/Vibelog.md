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
import { createLessonFile } from '../../dist/core/lesson.js';

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-write-ack-contract-'));
const backlogDir = join(cwd, 'backlog');

/**
 * Фазовый env агентской сессии на время файла (VL-286): `VIBELOG_CWD` увёл бы
 * `git_commit` (VL-311) в главный репозиторий вместо mkdtemp-каталога.
 * Сохранённые значения возвращаются в afterAll.
 */
const savedPhaseEnv = {};

beforeAll(() => {
  for (const key of ['VIBELOG_CWD', 'VIBELOG_PHASE_TASK_ID', 'VIBELOG_PHASE_NAME', 'VIBELOG_RUN_PHASE', 'VIBELOG_RUN_STARTED_AT']) {
    savedPhaseEnv[key] = process.env[key];
    delete process.env[key];
  }
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
  for (const [key, value] of Object.entries(savedPhaseEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
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
    const l1 = createLessonFile(cwd, { title: 'Урок 1', tags: ['a'] });
    const l2 = createLessonFile(cwd, { title: 'Урок 2', tags: ['b'] });
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
    ]);
    // Явные исключения с причиной: инструменты супервизора/очереди (VL-268)
    // управляют прогоном фаз, а не данными backlog; их ответ — карточка
    // состояния прогона, а не снимок applied/skipped. В контракт VL-306 не
    // входят (вне скоупа задачи), но и молча «пятым случаем» не считаются.
    const outOfScope = new Set([
      'backlog_trigger_phase',
      'backlog_auto_queue',
      'backlog_supervisor',
    ]);
    const missing = listTools()
      .map(t => t.name)
      .filter(name => isWriteOperation(name) && !covered.has(name) && !outOfScope.has(name));
    assert.deepEqual(missing, [], `write-инструменты без JSON-ack в таблице: ${missing.join(', ')}`);
  });
});

/**
 * VL-310: таблица noop-способных write-инструментов.
 *
 * Каждый вход — сценарий «первый вызов применяет, второй с ТЕМИ ЖЕ
 * аргументами обязан ответить noop». Сценарий сам готовит данные и
 * возвращает второй ack — так таблица остаётся данными, а не копипастой.
 */
const NOOP_SCENARIOS = {
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
  document_update: async () => {
    const doc = writeDocument(backlogDir, { title: 'Noop-док контракта', type: 'guide' });
    return JSON.parse(await handleToolCall('document_update', { id: doc.id, type: 'guide' }, cwd));
  },
  reference_update: async () => {
    const ref = writeReference(cwd, { title: 'Noop-ref контракта', type: 'url', url: 'https://example.net', tags: ['a'] });
    await handleToolCall('reference_update', { id: ref.id, tags: ['a'] }, cwd);
    return JSON.parse(await handleToolCall('reference_update', { id: ref.id, tags: ['a'] }, cwd));
  },
  lesson_update: async () => {
    const l = createLessonFile(cwd, { title: 'Noop-урок контракта', tags: ['a'] });
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
};

/**
 * VL-310: write-инструменты, для которых noop НЕПРИМЕНИМ по природе
 * операции. Причина обязательна — «пятый случай» не должен проскочить молча.
 */
const NOOP_NOT_APPLICABLE = {
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
};

describe('VL-310 — инвариант «каждый write-инструмент умеет noop»', () => {
  it('AC2: каждый noop-способный инструмент отвечает {ok:false, noop:true} на повторной идентичной записи', async () => {
    for (const [name, scenario] of Object.entries(NOOP_SCENARIOS)) {
      const ack = await scenario();
      assert.equal(ack.noop, true, `${name}: повтор с теми же аргументами обязан быть noop — ${JSON.stringify(ack).slice(0, 300)}`);
      assert.equal(ack.ok, false, `${name}: noop — ошибка, а не успех (lesson-92/lesson-174)`);
      assert.equal(ack.reason, 'noop', `${name}: reason должен быть 'noop'`);
      assert.match(String(ack.message), /Изменений нет/, `${name}: маркер «Изменений нет» обязателен`);
    }
  });

  it('AC2/AC3: новый write-инструмент без noop-детекции валит тест', () => {
    const missing = listTools()
      .map(t => t.name)
      .filter(name => isWriteOperation(name))
      .filter(name => !(name in NOOP_SCENARIOS)
        && !(name in NOOP_NOT_APPLICABLE)
        // Инструменты прогона фаз/очереди — вне домена данных backlog (VL-268).
        && !['backlog_trigger_phase', 'backlog_auto_queue', 'backlog_supervisor'].includes(name));
    assert.deepEqual(
      missing,
      [],
      `write-инструменты без noop-семантики и без документированного исключения: ${missing.join(', ')}. ` +
        'Добавь сценарий в NOOP_SCENARIOS (если операция идемпотентна по значениям) ' +
        'или строку с причиной в NOOP_NOT_APPLICABLE.',
    );
  });
});
