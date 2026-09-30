import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, stringifyYaml } from './yaml.mjs';

describe('parseYaml', () => {
  it('Пустая строка → пустой объект', () => {
    assert.deepStrictEqual(parseYaml(''), {});
    assert.deepStrictEqual(parseYaml('  \n  '), {});
  });

  it('Простой объект со строками', () => {
    const result = parseYaml('name: Vibelog.md\ntitle: Test');
    assert.equal(result.name, 'Vibelog.md');
    assert.equal(result.title, 'Test');
  });

  it('Числа — целые и с плавающей точкой', () => {
    const result = parseYaml('count: 42\npi: 3.14\nneg: -7');
    assert.equal(result.count, 42);
    assert.equal(result.pi, 3.14);
    assert.equal(result.neg, -7);
  });

  it('Boolean: true/false', () => {
    const result = parseYaml('a: true\nb: false');
    assert.equal(result.a, true);
    assert.equal(result.b, false);
  });

  it('Boolean: yes/no/on/off (YAML-совместимые)', () => {
    const result = parseYaml('a: yes\nb: no\nc: on\nd: off');
    assert.equal(result.a, true);
    assert.equal(result.b, false);
    assert.equal(result.c, true);
    assert.equal(result.d, false);
  });

  it('Null: null и ~', () => {
    const result = parseYaml('a: null\nb: ~');
    assert.equal(result.a, null);
    assert.equal(result.b, null);
  });

  it('Строки в двойных кавычках', () => {
    const result = parseYaml('msg: "Hello World"');
    assert.equal(result.msg, 'Hello World');
  });

  it('Экранирование в двойных кавычках', () => {
    // В JS: 'C:\\\\Users\\\\test' → строка C:\\Users\\test
    // В YAML: "C:\\Users\\test" → парсится как C:\Users\test
    const result = parseYaml('path: "C:\\\\Users\\\\test"');
    assert.equal(result.path, 'C:\\Users\\test');
  });

  it('Строки в одинарных кавычках', () => {
    const result = parseYaml("name: 'Alex Gavrilescu'");
    assert.equal(result.name, 'Alex Gavrilescu');
  });

  it('Экранирование одинарных кавычек', () => {
    const result = parseYaml("text: 'it''s a test'");
    assert.equal(result.text, "it's a test");
  });

  it('Блочный массив через `-`', () => {
    const yaml = `labels:
  - enhancement
  - bug
  - docs`;
    const result = parseYaml(yaml);
    assert.deepStrictEqual(result.labels, ['enhancement', 'bug', 'docs']);
  });

  it('Пустой блочный массив', () => {
    const yaml = `items:
  - first
  - second`;
    const result = parseYaml(yaml);
    assert.deepStrictEqual(result.items, ['first', 'second']);
  });

  it('Inline-массив', () => {
    const result = parseYaml('tags: [a, b, c]');
    assert.deepStrictEqual(result.tags, ['a', 'b', 'c']);
  });

  it('Пустой inline-массив', () => {
    const result = parseYaml('items: []');
    assert.deepStrictEqual(result.items, []);
  });

  it('Вложенный объект (отступ 2 пробела)', () => {
    const yaml = `meta:
  author: test
  version: 1`;
    const result = parseYaml(yaml);
    assert.deepStrictEqual(result.meta, { author: 'test', version: 1 });
  });

  it('Комментарии пропускаются', () => {
    const yaml = `# Это комментарий
name: vibelog
# Ещё комментарий
version: 1`;
    const result = parseYaml(yaml);
    assert.deepStrictEqual(result, { name: 'vibelog', version: 1 });
  });

  it('Пустое значение → null', () => {
    const result = parseYaml('key:');
    assert.equal(result.key, null);
  });
});

describe('stringifyYaml', () => {
  it('Простой объект', () => {
    const result = stringifyYaml({ name: 'test', version: 1 });
    assert.ok(result.includes('name: test'));
    assert.ok(result.includes('version: 1'));
  });

  it('Пустой массив', () => {
    const result = stringifyYaml({ items: [] });
    assert.ok(result.includes('items: []'));
  });

  it('Массив со значениями', () => {
    const result = stringifyYaml({ tags: ['a', 'b'] });
    assert.ok(result.includes('tags:'));
    assert.ok(result.includes('- a'));
    assert.ok(result.includes('- b'));
  });

  it('Boolean', () => {
    const result = stringifyYaml({ flag: true, off: false });
    assert.ok(result.includes('flag: true'));
    assert.ok(result.includes('off: false'));
  });

  it('Null', () => {
    const result = stringifyYaml({ key: null });
    assert.ok(result.includes('key:'));
    // Null значение — пустое после двоеточия
  });

  it('Строка с спецсимволами → в кавычках', () => {
    const result = stringifyYaml({ url: 'https://example.com' });
    assert.ok(result.includes("'https://example.com'"));
  });
});

describe('Round-trip: parse → stringify → parse', () => {
  it('Сохраняет данные после цикла', () => {
    const original = {
      id: 'BACK-100',
      title: 'Add embedded web server',
      status: 'Done',
      assignee: [],
      labels: ['enhancement', 'web'],
      priority: 'medium',
      created_date: '2025-06-22',
    };

    const yaml = stringifyYaml(original);
    const parsed = parseYaml(yaml);

    assert.equal(parsed.id, original.id);
    assert.equal(parsed.title, original.title);
    assert.equal(parsed.status, original.status);
    assert.deepStrictEqual(parsed.assignee, original.assignee);
    assert.deepStrictEqual(parsed.labels, original.labels);
    assert.equal(parsed.priority, original.priority);
    assert.equal(parsed.created_date, original.created_date);
  });
});
