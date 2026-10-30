/**
 * Тесты MCP-инструмента project_map (VL-235).
 *
 * Фикстура — mkdtemp (AGENTS.md): фиксированные пути запрещены.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { listTools, handleToolCall } from '../../dist/mcp/tools.js';

let testRoot;

beforeAll(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'vibelog-mcp-map-'));
  mkdirSync(join(testRoot, 'src', 'core'), { recursive: true });
  writeFileSync(
    join(testRoot, 'src', 'core', 'cache.ts'),
    '/**\n * Markdown-кэш.\n */\nexport function htmlToMarkdown(html: string): string {\n  return html;\n}\n',
    'utf8',
  );
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-235 — project_map в MCP', () => {
  it('зарегистрирован в listTools с 4 опциональными аргументами', () => {
    const tool = listTools().find(t => t.name === 'project_map');
    assert.ok(tool, 'project_map должен быть в реестре');
    const props = Object.keys(tool.inputSchema.properties);
    assert.deepEqual(props.sort(), ['dir', 'exports', 'limit', 'query']);
    assert.deepEqual(tool.inputSchema.required, [], 'все аргументы опциональны');
  });

  it('возвращает карту по фикстуре', async () => {
    const out = await handleToolCall('project_map', {}, testRoot);
    assert.match(out, /src\/core\//);
    assert.match(out, /cache\.ts — Markdown-кэш\./);
    assert.match(out, /htmlToMarkdown/);
  });

  it('query находит модуль по имени экспорта (AC6)', async () => {
    const out = await handleToolCall('project_map', { query: 'htmlToMarkdown' }, testRoot);
    assert.match(out, /cache\.ts — Markdown-кэш\./);
    assert.match(out, /\[htmlToMarkdown\]/);
  });

  it('query без совпадений — явный текст', async () => {
    const out = await handleToolCall('project_map', { query: 'нет-такого-модуля' }, testRoot);
    assert.match(out, /Совпадений не найдено/);
  });

  it('невалидные типы аргументов — текст ошибки, не TypeError', async () => {
    const badDir = await handleToolCall('project_map', { dir: 42 }, testRoot);
    assert.match(badDir, /поле "dir" должно быть строкой/);
    const badQuery = await handleToolCall('project_map', { query: {} }, testRoot);
    assert.match(badQuery, /поле "query" должно быть строкой/);
  });

  it('проект без src/ не падает', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'vibelog-mcp-map-empty-'));
    try {
      const out = await handleToolCall('project_map', {}, empty);
      assert.match(out, /не найден или не содержит/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
