/**
 * Тесты VL-399 — точечная правка документов и защита от потери тела.
 *
 * Что закрывает файл:
 * 1. `document_edit` (AC1–AC3): замена по телу документа с семантикой файлового
 *    `edit` — ровно одно совпадение, иначе отказ БЕЗ записи; отчёт `applied`
 *    по смыслу (replaced, размеры тела до/после); idempotencyKey как у прочих
 *    write-инструментов.
 * 2. Guard `document_update` (AC4–AC5): короткий `content`, не сохраняющий
 *    начала текущего текста, отклоняется; `full_replace: true` проходит и
 *    отдаёт `truncated: true` + размеры до/после.
 * 3. Регрессия: обновление title/tags тело не трогает (это и есть сценарий,
 *    в котором раньше пропадал текст — замена шла через content).
 *
 * Инцидент-источник: 2026-11-10 на doc-10 при простановке пометки «устарело»
 * передан короткий content → утрачены §3–§12, ответ инструмента был
 * победным `{ok: true, message: "Документ doc-10 обновлён"}`.
 *
 * Каталог — mkdtempSync (VL-241); фазовый env агентской сессии снимается
 * `clearPhaseEnv()` на уровне файла (VL-374: in-process handleToolCall).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stringifyYaml } from '../../dist/core/yaml.js';
import { handleToolCall } from '../../dist/mcp/tools.js';
import { writeDocument, getDocument } from '../../dist/core/document.js';
import { applyBodyEdit, contentShrinkCheck, DOC_SHRINK_RATIO } from '../../dist/mcp/document-edit.js';

import { clearPhaseEnv } from '../test-env.mjs';

let restorePhaseEnv;

const cwd = mkdtempSync(join(tmpdir(), 'vibelog-doc-edit-'));
const backlogDir = join(cwd, 'backlog');

beforeAll(() => {
  restorePhaseEnv = clearPhaseEnv();
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Doc Edit Test',
    task_prefix: 'de',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
});

afterAll(() => {
  restorePhaseEnv();
  rmSync(cwd, { recursive: true, force: true });
});

/** Тело документа с диска (не через MCP — проверяем именно файл). */
function bodyOf(id) {
  const entry = getDocument(backlogDir, id);
  assert.ok(entry, `документ ${id} должен существовать`);
  return entry.body;
}

/** Разбирает ответ инструмента и требует валидный JSON-ack. */
function ack(out) {
  try {
    return JSON.parse(out);
  } catch {
    assert.fail(`ответ не JSON — ${String(out).slice(0, 300)}`);
  }
}

describe('VL-399 — чистая логика (module document-edit)', () => {
  it('applyBodyEdit: одно вхождение, split/join без подстановок $', () => {
    const one = applyBodyEdit('a\nцель\nb', 'цель', 'НОВОЕ', false);
    assert.deepEqual(one, { ok: true, body: 'a\nНОВОЕ\nb', replaced: 1 });

    // $& / $1 / $$ в new_string вставляются буквально (String.replace их трактует)
    const dollars = applyBodyEdit('цена: X', 'X', '$& $1 $$', false);
    assert.equal(dollars.ok, true);
    assert.equal(dollars.body, 'цена: $& $1 $$');
  });

  it('applyBodyEdit: 0 совпадений и >1 без replace_all — отказы', () => {
    assert.deepEqual(applyBodyEdit('aaa', 'zzz', 'y', false), { ok: false, reason: 'not_found', count: 0 });
    assert.deepEqual(applyBodyEdit('x x', 'x', 'y', false), { ok: false, reason: 'ambiguous', count: 2 });
    assert.deepEqual(applyBodyEdit('x x', 'x', 'y', true), { ok: true, body: 'y y', replaced: 2 });
  });

  it('contentShrinkCheck: короткий текст без начала тела — подозрительно', () => {
    const body = '§1 Введение\n\nОчень длинный текст, который нельзя потерять.\n' + 'строка\n'.repeat(50);
    const check = contentShrinkCheck(body, '# Пометка: устарело');
    assert.equal(check.suspicious, true);
    assert.equal(check.bodyLengthBefore, body.length);
    assert.equal(check.bodyLengthAfter, '# Пометка: устарело'.length);
    assert.ok(check.shrinkPercent > 40);
  });

  it('contentShrinkCheck: текст сохраняет начало тела — не подозрительно', () => {
    const body = '§1 Введение\n\nОчень длинный текст.\n' + 'строка\n'.repeat(50);
    // Первая непустая строка тела («§1 Введение») сохранена — правка осознанная
    const check = contentShrinkCheck(body, '§1 Введение\n\nсокращённый вариант');
    assert.equal(check.suspicious, false, `порог ${DOC_SHRINK_RATIO}`);
  });

  it('contentShrinkCheck: рост и пустое текущее тело — не подозрительно', () => {
    assert.equal(contentShrinkCheck('коротко', 'гораздо более длинный текст, чем было').suspicious, false);
    assert.equal(contentShrinkCheck('', 'любой текст').suspicious, false);
  });
});

describe('VL-399 — document_edit (AC1–AC3)', () => {
  it('AC1/AC3: замена одного вхождения — applied по смыслу, тело правится точечно', async () => {
    const doc = writeDocument(backlogDir, {
      title: 'Точечная правка', content: '# Заголовок\n\nстарый абзац\n\nхвост остаётся',
    });
    const res = ack(await handleToolCall('document_edit', {
      id: doc.id, old_string: 'старый абзац', new_string: 'новый абзац',
    }, cwd));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.outcome, 'applied');
    assert.equal(res.applied.replaced, 1);
    assert.equal(res.applied.bodyLengthBefore, '# Заголовок\n\nстарый абзац\n\nхвост остаётся'.length);
    assert.equal(res.applied.bodyLengthAfter, '# Заголовок\n\nновый абзац\n\nхвост остаётся'.length);
    assert.equal(bodyOf(doc.id), '# Заголовок\n\nновый абзац\n\nхвост остаётся');
    // Остальное тело не тронуто
    assert.ok(bodyOf(doc.id).includes('хвост остаётся'));
  });

  it('AC1: заголовок и теги после document_edit не меняются', async () => {
    const doc = writeDocument(backlogDir, { title: 'Метаданные целы', type: 'guide', tags: ['a'], content: 'текст' });
    await handleToolCall('document_edit', { id: doc.id, old_string: 'текст', new_string: 'ТЕКСТ' }, cwd);
    const view = JSON.parse(await handleToolCall('document_view', { id: doc.id }, cwd));
    assert.equal(view.title, 'Метаданные целы');
    assert.equal(view.type, 'guide');
    assert.deepEqual(view.tags, ['a']);
    assert.equal(view.content, 'ТЕКСТ');
  });

  it('AC2: 0 совпадений — отказ с подсказкой про git, файл не изменён', async () => {
    const doc = writeDocument(backlogDir, { title: 'Нет совпадения', content: 'исходное тело' });
    const before = readFileSync(getDocument(backlogDir, doc.id).path, 'utf-8');
    const res = ack(await handleToolCall('document_edit', {
      id: doc.id, old_string: 'такого текста нет', new_string: 'что-то',
    }, cwd));
    assert.equal(res.ok, false);
    assert.equal(res.outcome, 'rejected');
    assert.match(res.error ?? '', /не найден/);
    // Текст отказа + hint вместе: «возможно, документ восстановлен из git и текст другой»
    assert.match(`${res.error ?? ''} ${res.hint ?? ''}`, /git/, 'подсказка «возможно, документ восстановлен из git»');
    // Файл байт-в-байт прежний
    assert.equal(readFileSync(getDocument(backlogDir, doc.id).path, 'utf-8'), before);
  });

  it('AC2: >1 совпадения без replace_all — отказ с числом и предложением replace_all', async () => {
    const doc = writeDocument(backlogDir, { title: 'Два совпадения', content: 'маркер раз\nмаркер два' });
    const before = readFileSync(getDocument(backlogDir, doc.id).path, 'utf-8');
    const res = ack(await handleToolCall('document_edit', {
      id: doc.id, old_string: 'маркер', new_string: 'M',
    }, cwd));
    assert.equal(res.ok, false);
    assert.match(res.message + (res.error ?? ''), /2 раз/);
    assert.equal(res.retryWith?.replace_all, true, 'готовая форма исправления в retryWith');
    assert.equal(readFileSync(getDocument(backlogDir, doc.id).path, 'utf-8'), before);
  });

  it('AC1: replace_all заменяет все вхождения', async () => {
    const doc = writeDocument(backlogDir, { title: 'Все вхождения', content: 'маркер раз\nмаркер два' });
    const res = ack(await handleToolCall('document_edit', {
      id: doc.id, old_string: 'маркер', new_string: 'M', replace_all: true,
    }, cwd));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.applied.replaced, 2);
    assert.equal(bodyOf(doc.id), 'M раз\nM два');
  });

  it('AC3: повтор с тем же idempotencyKey не применяет правку второй раз', async () => {
    const doc = writeDocument(backlogDir, { title: 'Идемпотентность', content: 'было' });
    const args = { id: doc.id, old_string: 'было', new_string: 'стало', idempotencyKey: `vl399-${doc.id}` };
    const first = ack(await handleToolCall('document_edit', args, cwd));
    assert.equal(first.ok, true);
    assert.equal(first.idempotentReplay, undefined);
    const second = ack(await handleToolCall('document_edit', args, cwd));
    assert.equal(second.idempotentReplay, true, 'повтор обязан быть помечен как воспроизведение');
    assert.equal(bodyOf(doc.id), 'стало', 'второй раз текст не менялся');
  });

  it('AC3: old_string === new_string — noop, файл не перезаписан', async () => {
    const doc = writeDocument(backlogDir, { title: 'Noop правки', content: 'без изменений' });
    const before = readFileSync(getDocument(backlogDir, doc.id).path, 'utf-8');
    const res = ack(await handleToolCall('document_edit', {
      id: doc.id, old_string: 'без изменений', new_string: 'без изменений',
    }, cwd));
    assert.equal(res.noop, true, JSON.stringify(res));
    assert.equal(res.reason, 'noop');
    assert.equal(readFileSync(getDocument(backlogDir, doc.id).path, 'utf-8'), before);
  });

  it('AC2: пустой old_string — испорченный аргумент, не порча тела', async () => {
    const doc = writeDocument(backlogDir, { title: 'Пустой old', content: 'тело' });
    await assert.rejects(
      handleToolCall('document_edit', { id: doc.id, old_string: '', new_string: 'x' }, cwd),
      /old_string пустой/,
    );
    assert.equal(bodyOf(doc.id), 'тело');
  });
});

describe('VL-399 — guard document_update (AC4–AC5)', () => {
  const longBody = '# Раздел 1\n\n' + 'Очень длинный текст, который нельзя потерять.\n'.repeat(20);

  it('AC4: короткий content без начала тела — отказ, файл не изменён', async () => {
    const doc = writeDocument(backlogDir, { title: 'Guard', content: longBody });
    const before = readFileSync(getDocument(backlogDir, doc.id).path, 'utf-8');
    const res = ack(await handleToolCall('document_update', {
      id: doc.id, content: 'Устарело.',
    }, cwd));
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.equal(res.outcome, 'rejected');
    const text = `${res.error ?? ''} ${res.hint ?? ''}`;
    assert.match(text, /ПОЛНАЯ замена/);
    assert.match(text, /document_edit/, 'подсказка указывает на точечную правку');
    assert.match(text, /full_replace/, 'и на явное согласие');
    assert.equal(res.retryWith?.full_replace, true, 'готовое исправление с явным согласием');
    assert.equal(readFileSync(getDocument(backlogDir, doc.id).path, 'utf-8'), before);
  });

  it('AC4/AC5: full_replace: true проходит и показывает потерю объёма', async () => {
    const doc = writeDocument(backlogDir, { title: 'Осознанная замена', content: longBody });
    const res = ack(await handleToolCall('document_update', {
      id: doc.id, content: 'Устарело.', full_replace: true,
    }, cwd));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.applied.bodyLengthBefore, longBody.length);
    assert.equal(res.applied.bodyLengthAfter, 'Устарело.'.length);
    assert.equal(res.applied.truncated, true, 'усечение видно в ответе, а не только в git');
    // full_replace — управляющий флаг, а не поле: в skipped его быть не должно
    assert.deepEqual(res.skipped ?? [], [], 'full_replace не должен попадать в skipped');
    assert.equal(bodyOf(doc.id), 'Устарело.');
  });

  it('AC4: короткий content, сохраняющий начало тела — проходит без full_replace', async () => {
    const doc = writeDocument(backlogDir, { title: 'Осознанное сокращение', content: longBody });
    const res = ack(await handleToolCall('document_update', {
      id: doc.id, content: '# Раздел 1\n\nсокращено осознанно',
    }, cwd));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.applied.truncated, true);
    assert.equal(bodyOf(doc.id), '# Раздел 1\n\nсокращено осознанно');
  });

  it('AC4: пустой content при непустом теле — отказ (молчаливая очистка)', async () => {
    const doc = writeDocument(backlogDir, { title: 'Очистка', content: longBody });
    const res = ack(await handleToolCall('document_update', { id: doc.id, content: '' }, cwd));
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.equal(bodyOf(doc.id), longBody, 'тело сохранено');
  });

  it('AC5: обычное обновление без потери объёма — без маркера truncated', async () => {
    const doc = writeDocument(backlogDir, { title: 'Рост', content: 'коротко' });
    const res = ack(await handleToolCall('document_update', {
      id: doc.id, content: 'коротко, но заметно длиннее прежнего текста',
    }, cwd));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.applied.truncated, false);
    assert.equal(res.applied.bodyLengthBefore, 'коротко'.length);
  });
});

describe('VL-399 — регрессия: метаданные без content тело не трогают', () => {
  it('document_update {id, title} и {id, tags} тело не меняет', async () => {
    const body = '# Документ\n\nтело, которое не должно исчезнуть';
    const doc = writeDocument(backlogDir, { title: 'Метаданные', tags: ['old'], content: body });

    const titleAck = ack(await handleToolCall('document_update', { id: doc.id, title: 'Метаданные 2' }, cwd));
    assert.equal(titleAck.ok, true, JSON.stringify(titleAck));
    assert.equal(bodyOf(doc.id), body);
    // applied не содержит размеров тела: content не переписывался
    assert.equal(titleAck.applied.bodyLengthBefore, undefined);

    const tagsAck = ack(await handleToolCall('document_update', { id: doc.id, tags: ['new'] }, cwd));
    assert.equal(tagsAck.ok, true, JSON.stringify(tagsAck));
    assert.equal(bodyOf(doc.id), body);

    const view = JSON.parse(await handleToolCall('document_view', { id: doc.id }, cwd));
    assert.equal(view.title, 'Метаданные 2');
    assert.deepEqual(view.tags, ['new']);
    assert.equal(view.content, body);
  });
});