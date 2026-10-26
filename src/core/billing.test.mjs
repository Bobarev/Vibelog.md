/**
 * Тесты billing (VL-198): append-only журнал сессий задач.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendBilling, readBilling, billingPath } from '../core/billing.js';

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

  it('битый JSON → throw (не перезаписываем источник правды молча)', () => {
    const path = billingPath(dir, 'VL-1');
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
