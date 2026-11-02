/**
 * Тесты VL-313 — инварианты клиента панели токенов/стоимости/контекста.
 *
 * В `web/` нет DOM-тестов (vitest гоняет только `src/**`), поэтому проверки
 * здесь — по исходникам компонентов (паттерн VL-283 chat-persona-ui):
 * панель только в непустом треде, приклеена сверху и полупрозрачна, в поповере
 * есть строка стоимости, на мобильном видна модель и скрыта роль, элемент
 * assistant-ui поставлен исходником (без новых npm-зависимостей).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CHAT_DIR = join('web', 'src', 'components', 'chat');
const thread = readFileSync(join(CHAT_DIR, 'thread.tsx'), 'utf8');
const runtime = readFileSync(join(CHAT_DIR, 'chat-runtime.tsx'), 'utf8');
const pickers = readFileSync(join(CHAT_DIR, 'pickers.tsx'), 'utf8');
const usageBar = readFileSync(join(CHAT_DIR, 'usage-bar.tsx'), 'utf8');
const elementPath = join('web', 'src', 'components', 'assistant-ui', 'elements', 'context-display.tsx');
const element = readFileSync(elementPath, 'utf8');
const libUsage = readFileSync(join('web', 'src', 'lib', 'chat-usage.ts'), 'utf8');

describe('VL-313: панель появляется только в непустом треде (AC7)', () => {
  it('UsageBar вставлен в ветку If empty={false}', () => {
    const idx = thread.indexOf('<UsageBar');
    const guard = thread.lastIndexOf('<ThreadPrimitive.If empty={false}>', idx);
    const emptyBranch = thread.lastIndexOf('<ThreadPrimitive.If empty>', idx);
    assert.ok(idx > 0, 'UsageBar используется в ChatThread');
    assert.ok(guard > 0, 'UsageBar внутри ветки непустого треда');
    assert.ok(emptyBranch < guard, 'не в пустом состоянии');
  });

  it('пустой usage (null) не рендерит панель', () => {
    assert.match(usageBar, /if \(!usage\) return null/);
  });
});

describe('VL-313: оформление панели (AC8)', () => {
  it('приклеена сверху, полупрозрачная, с backdrop-blur и нижней границей', () => {
    for (const cls of ['shrink-0', 'border-b', 'bg-background/70', 'backdrop-blur-sm']) {
      assert.ok(usageBar.includes(cls), `класс ${cls}`);
    }
  });

  it('небольшие иконки по типам токенов/рублям/контексту', () => {
    for (const icon of ['ArrowDownToLine', 'ArrowUpFromLine', 'Database', 'Coins']) {
      assert.ok(usageBar.includes(icon), `иконка ${icon}`);
    }
    assert.match(usageBar, /className="size-3"/);
  });

  it('процент/окно рисует элемент Elements (ContextDisplay.Bar)', () => {
    assert.match(usageBar, /ContextDisplay\.Bar/);
    assert.match(usageBar, /modelContextWindow=\{usage\.contextWindow\}/);
    assert.match(usageBar, /resetKey=\{threadId\}/, 'resetKey — threadId (смена треда)');
  });
});

describe('VL-313: данные панели из сервера, без пересчёта (AC3/AC4/AC6)', () => {
  it('токены/рубли/процент берутся из ThreadUsageView как есть', () => {
    assert.match(usageBar, /usage\.cost\.total/);
    assert.match(usageBar, /usage\.peakContext/);
    assert.match(usageBar, /formatRubles\(/);
  });

  it('тип ThreadUsageView в lib содержит percent? и contextWindow? — необязательные', () => {
    assert.match(libUsage, /contextWindow\?: number/);
    assert.match(libUsage, /percent\?: number/);
  });

  it('элемент без окна не рисует процент (AC6)', () => {
    assert.match(element, /percent === null/, 'Ring/Bar различают «окно неизвестно»');
    assert.match(element, /if \(percent === null\) return/, 'нет «0%» при неизвестном окне');
  });
});

describe('VL-313: поповер со строкой стоимости (AC9)', () => {
  it('элемент поддерживает costLabel и рисует «Стоимость»', () => {
    assert.match(element, /costLabel/);
    assert.match(element, /Стоимость/);
  });

  it('панель передаёт стоимость в поповер', () => {
    assert.match(usageBar, /costLabel=\{/);
  });
});

describe('VL-313: мобильная раскладка (AC10)', () => {
  it('модель видна на узком экране (без hidden sm:flex)', () => {
    const modelTrigger = pickers.slice(pickers.indexOf('MODEL_TRIGGER_CLASS'));
    assert.ok(
      !/'hidden sm:flex'\)/.test(modelTrigger.split('\n')[0]),
      'класс модели не скрывает её на мобильном',
    );
    assert.match(pickers, /className=\{MODEL_TRIGGER_CLASS\}/);
  });

  it('роль скрыта на узком экране', () => {
    assert.match(pickers, /"hidden sm:flex"/);
    const personaPick = pickers.slice(pickers.indexOf('export function PersonaPicker('));
    assert.match(personaPick, /hidden sm:flex/, 'PersonaPicker скрыт на мобильном');
    const badge = pickers.slice(pickers.indexOf('export function PersonaBadge('));
    assert.match(badge, /hidden cursor-default sm:flex/, 'PersonaBadge скрыт на мобильном');
  });
});

describe('VL-313: элемент установлен исходником, без новых npm-зависимостей (AC11)', () => {
  it('файлы элемента лежат в проекте', () => {
    assert.ok(existsSync(elementPath));
    assert.ok(existsSync(join('web', 'src', 'components', 'assistant-ui', 'utils', 'context-usage.ts')));
    assert.ok(existsSync(join('web', 'src', 'components', 'assistant-ui', 'utils', 'tokens.ts')));
    assert.ok(existsSync(join('web', 'src', 'components', 'assistant-ui', 'utils', 'context-display-state.ts')));
  });

  it('элемент импортирует только локальные ui-примитивы и утилиты', () => {
    const imports = [...element.matchAll(/from "([^"]+)"/g)].map(m => m[1]);
    for (const spec of imports) {
      assert.ok(
        spec.startsWith('.') || spec.startsWith('@/') || spec === 'react',
        `неожиданный импорт ${spec}`,
      );
    }
  });

  it('в package.json web нет новых зависимостей элемента', () => {
    const pkg = JSON.parse(readFileSync(join('web', 'package.json'), 'utf8'));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const unexpected of ['@assistant-ui/ai-sdk', '@assistant-ui/styles', '@assistant-ui/ui']) {
      assert.ok(!deps.includes(unexpected), `${unexpected} не должен появляться`);
    }
  });
});

describe('VL-313: SSE-событие usage', () => {
  it('клиент знает тип usage и обновляет module-state панели', () => {
    assert.match(runtime, /type: "usage"; usage: ThreadUsageView/);
    assert.match(runtime, /case "usage":/);
    assert.match(runtime, /setActiveUsage\(ev\.usage\)/);
  });

  it('панель восстанавливается из initialUsage (AC2)', () => {
    assert.match(runtime, /initialUsage/);
    assert.match(thread, /initialUsage=\{load\.usage\}/);
    assert.match(thread, /usage: data\.usage \?\? null/);
  });

  it('панель подписывается на изменение расхода (AC1)', () => {
    assert.match(usageBar, /useSyncExternalStore/);
    assert.match(runtime, /export function subscribeActiveUsage/);
  });
});
