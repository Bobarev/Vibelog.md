/**
 * Тесты хранилища ключей идемпотентности (VL-262).
 *
 * Временный каталог — mkdtempSync (VL-241: фиксированные пути запрещены,
 * параллельные прогоны в worktree затирают друг друга).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  idempotencyPath, normalizeIdempotencyKey, withIdempotency,
} from '../../dist/mcp/idempotency.js';

let cwd;
beforeAll(() => { cwd = mkdtempSync(join(tmpdir(), 'vibelog-idem-')); });
afterAll(() => { rmSync(cwd, { recursive: true, force: true }); });

describe('VL-262 — withIdempotency', () => {
  it('без ключа операция выполняется каждый раз', () => {
    let calls = 0;
    const run = () => { calls++; return `result-${calls}`; };
    assert.equal(withIdempotency(cwd, 'tool_a', undefined, run), 'result-1');
    assert.equal(withIdempotency(cwd, 'tool_a', undefined, run), 'result-2');
    assert.equal(calls, 2);
  });

  it('с ключом второй вызов НЕ выполняет операцию и отдаёт тот же результат + idempotentReplay', () => {
    let calls = 0;
    const run = () => { calls++; return JSON.stringify({ ok: true, message: `создана-${calls}`, applied: {} }); };
    const first = withIdempotency(cwd, 'backlog_create_task', 'key-1', run);
    const second = withIdempotency(cwd, 'backlog_create_task', 'key-1', run);
    assert.equal(calls, 1, 'второй вызов не должен звать run');
    const parsedSecond = JSON.parse(second);
    assert.equal(parsedSecond.idempotentReplay, true);
    assert.equal(JSON.parse(first).message, parsedSecond.message, 'тот же результат первого применения');
  });

  it('разные ключи — разные записи и разные эффекты', () => {
    let calls = 0;
    const run = () => { calls++; return JSON.stringify({ ok: true, message: `n${calls}` }); };
    const a = withIdempotency(cwd, 'backlog_create_task', 'key-a', run);
    const b = withIdempotency(cwd, 'backlog_create_task', 'key-b', run);
    assert.equal(calls, 2);
    assert.notEqual(JSON.parse(a).message, JSON.parse(b).message);
  });

  it('тот же ключ у другого инструмента — отдельная запись (ключ = tool:key)', () => {
    let calls = 0;
    const run = () => { calls++; return JSON.stringify({ ok: true, message: `c${calls}` }); };
    withIdempotency(cwd, 'backlog_update_task', 'shared', run);
    withIdempotency(cwd, 'backlog_add_comment', 'shared', run);
    assert.equal(calls, 2);
  });

  it('просроченная запись (TTL) не переиспользуется', () => {
    const path = idempotencyPath(cwd);
    mkdirSync(join(cwd, '.vibelog'), { recursive: true });
    writeFileSync(path, JSON.stringify({
      version: 1,
      entries: {
        'tool_ttl:old': { at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), result: '{"ok":true,"message":"stale"}' },
      },
    }), 'utf-8');
    let calls = 0;
    const out = withIdempotency(cwd, 'tool_ttl', 'old', () => { calls++; return '{"ok":true,"message":"fresh"}'; });
    assert.equal(calls, 1, 'просроченный ключ не должен давать hit');
    assert.equal(JSON.parse(out).message, 'fresh');
  });

  it('битый файл кэша → fail-open: операция выполняется, файл перезаписывается', () => {
    const path = idempotencyPath(cwd);
    mkdirSync(join(cwd, '.vibelog'), { recursive: true });
    writeFileSync(path, '{ это не JSON', 'utf-8');
    let calls = 0;
    const out = withIdempotency(cwd, 'tool_broken', 'k', () => { calls++; return '{"ok":true,"message":"ok"}'; });
    assert.equal(calls, 1);
    assert.equal(JSON.parse(out).message, 'ok');
    // файл восстановлен как валидный JSON
    const restored = JSON.parse(readFileSync(path, 'utf-8'));
    assert.equal(restored.version, 1);
    assert.ok(restored.entries['tool_broken:k']);
  });
});

describe('VL-262 — normalizeIdempotencyKey', () => {
  it('пустое/отсутствующее значение → undefined (кэш не используется)', () => {
    assert.equal(normalizeIdempotencyKey(undefined), undefined);
    assert.equal(normalizeIdempotencyKey(null), undefined);
    assert.equal(normalizeIdempotencyKey(''), undefined);
    assert.equal(normalizeIdempotencyKey('   '), undefined);
  });

  it('не-строка и слишком длинный ключ → понятная ошибка', () => {
    assert.throws(() => normalizeIdempotencyKey(42), /idempotencyKey: ожидается строка/);
    assert.throws(() => normalizeIdempotencyKey('x'.repeat(201)), /до 200 символов/);
  });

  it('нормальный ключ обрезается по краям', () => {
    assert.equal(normalizeIdempotencyKey('  abc  '), 'abc');
  });
});
