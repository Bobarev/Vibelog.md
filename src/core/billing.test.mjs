/**
 * Тесты billing (VL-198): append-only журнал сессий задач.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendBilling, readBilling, billingPath, billingRunStart } from '../core/billing.js';

describe('billing (VL-198)', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vib-billing-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const session = (over = {}) => ({
    sessionId: 'agent-1',
    phase: 'plan',
    usage: { input: 100, output: 50, cache: 10, total: 160, requests: 3 },
    ...over,
  });

  it('нет файла → пустой record', () => {
    expect(readBilling(dir, 'vl-198')).toEqual({ taskId: 'VL-198', sessions: [] });
  });

  it('appendBilling создаёт файл (каталог .vibelog/billing) с первой записью', () => {
    appendBilling(dir, 'VL-198', session());
    const path = billingPath(dir, 'VL-198');
    expect(existsSync(path)).toBe(true);
    // путь в gitignored .vibelog/billing/<taskId в верхнем регистре>.json
    expect(path.endsWith(join('.vibelog', 'billing', 'VL-198.json'))).toBe(true);
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    expect(raw.taskId).toBe('VL-198');
    expect(raw.sessions).toHaveLength(1);
    expect(raw.sessions[0].sessionId).toBe('agent-1');
  });

  it('append-only: повторные записи добавляются (включая resume-раны той же сессии)', () => {
    appendBilling(dir, 'vl-198', session());
    appendBilling(dir, 'vl-198', session({ startedAt: '2026-10-27T00:00:00.000Z', durationMs: 5000 }));
    const record = readBilling(dir, 'VL-198');
    expect(record.sessions).toHaveLength(2);
    expect(record.sessions[1].durationMs).toBe(5000);
  });

  it('sessionPhase/fallback сохраняются, старые записи без них читаются (VL-243)', () => {
    // Новые аддитивные поля: фаза рана (phase) + фаза сессии (sessionPhase)
    // и признак fallback-записи оркестратора. Формат Backlog.md не затрагивается.
    appendBilling(dir, 'VL-243', session({ phase: 'code', sessionPhase: 'plan', fallback: true }));
    // запись старого формата (без новых полей) читается как раньше
    appendBilling(dir, 'VL-243', session({ sessionId: 'agent-2', phase: 'spec' }));
    const record = readBilling(dir, 'VL-243');
    expect(record.sessions).toHaveLength(2);
    expect(record.sessions[0]).toMatchObject({
      phase: 'code',
      sessionPhase: 'plan',
      fallback: true,
    });
    expect(record.sessions[1].phase).toBe('spec');
    expect(record.sessions[1].sessionPhase).toBeUndefined();
    expect(record.sessions[1].fallback).toBeUndefined();
  });

  // ── VL-259: startedAt — фактическое начало рана ──

  it('startedAtKind=run сохраняется, resume-записи различимы по startedAt', () => {
    appendBilling(dir, 'VL-259', session({ startedAt: '2026-10-30T03:00:00.000Z', startedAtKind: 'run' }));
    appendBilling(dir, 'VL-259', session({ startedAt: '2026-10-30T04:00:00.000Z', startedAtKind: 'run' }));
    const record = readBilling(dir, 'VL-259');
    expect(record.sessions.map((s) => s.startedAtKind)).toEqual(['run', 'run']);
    expect(new Set(record.sessions.map((s) => s.startedAt)).size).toBe(2);
  });

  it('billingRunStart: достоверный startedAt для новых записей', () => {
    expect(
      billingRunStart({
        sessionId: 'a',
        startedAt: '2026-10-30T03:00:00.000Z',
        startedAtKind: 'run',
        finishedAt: '2026-10-30T03:10:00.000Z',
        durationMs: 600000,
        usage: { input: 0, output: 0, cache: 0, total: 0, requests: 0 },
      })
    ).toBe('2026-10-30T03:00:00.000Z');
  });

  it('billingRunStart: старые записи без startedAtKind → finishedAt − durationMs', () => {
    // Запись формата VL-198…VL-243: startedAt = время создания сессии (у всех
    // resume-ранов одинаковое и ненадёжное), durationMs — фактическая длина рана
    const restored = billingRunStart({
      sessionId: 'a',
      startedAt: '2026-10-30T03:00:00.000Z',
      finishedAt: '2026-10-30T05:00:00.000Z',
      durationMs: 3600000,
      usage: { input: 0, output: 0, cache: 0, total: 0, requests: 0 },
    });
    expect(restored).toBe('2026-10-30T04:00:00.000Z');
  });

  it('billingRunStart: без durationMs → finishedAt, пустая запись → undefined (не падает)', () => {
    expect(
      billingRunStart({
        sessionId: 'a',
        finishedAt: '2026-10-30T05:00:00.000Z',
        usage: { input: 0, output: 0, cache: 0, total: 0, requests: 0 },
      })
    ).toBe('2026-10-30T05:00:00.000Z');
    expect(
      billingRunStart({ sessionId: 'a', usage: { input: 0, output: 0, cache: 0, total: 0, requests: 0 } })
    ).toBeUndefined();
    // битые даты не бросают
    expect(
      billingRunStart({
        sessionId: 'a',
        startedAt: 'не дата',
        finishedAt: 'тоже не дата',
        durationMs: 1000,
        usage: { input: 0, output: 0, cache: 0, total: 0, requests: 0 },
      })
    ).toBe('не дата');
  });

  it('битый JSON → throw (не перезаписываем источник правды молча)', () => {    const path = billingPath(dir, 'VL-1');
    mkdirSync(join(dir, '.vibelog', 'billing'), { recursive: true });
    writeFileSync(path, '{бито', 'utf-8');
    expect(() => appendBilling(dir, 'VL-1', session())).toThrow();
  });

  it('массив вместо объекта → throw с понятным сообщением', () => {
    const path = billingPath(dir, 'VL-2');
    mkdirSync(join(dir, '.vibelog', 'billing'), { recursive: true });
    writeFileSync(path, '[]', 'utf-8');
    expect(() => readBilling(dir, 'VL-2')).toThrow(/ожидается объект/);
  });
});
