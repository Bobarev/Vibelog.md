/**
 * Тесты страницы «Персоны» (VL-403, AC1/AC2/AC3/AC5/AC7/AC9).
 *
 * В `web/` нет DOM-тестов (vitest гоняет только `src/**`), поэтому проверки
 * здесь — по исходникам компонентов и роутера: они ловят ровно те регрессии,
 * которые важны для AC (порядок маршрутов, пункт сайдбара, наличие секций
 * промпта и памяти, отсутствие удаления у встроенной роли).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (...parts) => readFileSync(join(...parts), 'utf8');

const hashRoute = read('web', 'src', 'lib', 'use-hash-route.ts');
const sidebar = read('web', 'src', 'components', 'layout', 'app-sidebar.tsx');
const app = read('web', 'src', 'App.tsx');
const listPage = read('web', 'src', 'components', 'personas', 'personas-page.tsx');
const detailPage = read('web', 'src', 'components', 'personas', 'persona-detail.tsx');
const clientApi = read('web', 'src', 'components', 'personas', 'api.ts');

describe('VL-403 AC1: роуты #/personas и #/persona/<id>', () => {
  it('Route union содержит personas и persona', () => {
    assert.match(hashRoute, /\|\s*'personas'/);
    assert.match(hashRoute, /\|\s*'persona'/);
  });

  it('список распознаётся точным совпадением ДО детального префикса', () => {
    const listIdx = hashRoute.indexOf("if (path === 'personas') return 'personas'");
    const detailIdx = hashRoute.indexOf("if (path.startsWith('persona/')) return 'persona'");
    assert.ok(listIdx > 0, 'нет точного маршрута personas');
    assert.ok(detailIdx > 0, 'нет префиксного маршрута persona/');
    assert.ok(listIdx < detailIdx, 'personas должен проверяться ДО persona/ (lesson-22)');
  });

  it('usePersonaId парсит #/persona/<id>', () => {
    assert.match(hashRoute, /export function usePersonaId\(/);
    assert.match(hashRoute, /#\\\/persona\\\/\(\[\^\/\]\+\)/);
  });

  it('пункт «Персоны» в сайдбаре в группе «Настройки»', () => {
    assert.match(sidebar, /id: "personas"/);
    assert.match(sidebar, /title: "Персоны"/);
    assert.match(sidebar, /url: "personas"/);
    // Иконка Users импортирована из lucide (lesson-15: проверять наличие)
    assert.match(sidebar, /Users/);
    // Активность и на детальной странице
    assert.match(sidebar, /activeWhen: \["personas", "persona"\]/);
  });

  it('App рендерит обе страницы по маршруту', () => {
    assert.match(app, /route === "personas" \? \(\s*<PersonasPage \/>/);
    assert.match(app, /route === "persona" \? \(\s*<PersonaDetail id=\{personaId \?\? ""\} \/>/);
  });
});

describe('VL-403 AC2: список ролей', () => {
  it('показывает label, id, описание и размер памяти с предупреждением', () => {
    assert.match(listPage, /p\.label/);
    assert.match(listPage, /p\.id/);
    assert.match(listPage, /p\.description/);
    assert.match(listPage, /p\.memory\.chars/);
    assert.match(listPage, /p\.memory\.truncated/);
    assert.match(listPage, /сверх лимита/);
  });

  it('клик по строке ведёт на детальную страницу', () => {
    assert.match(listPage, /#\/persona\/\$\{encodeURIComponent\(p\.id\)\}/);
  });

  it('ошибки секции chat_personas показываются', () => {
    assert.match(listPage, /data\.errors/);
  });
});

describe('VL-403 AC3/AC7: детальная страница', () => {
  it('секции «Основное», «Промпт роли», «Память»', () => {
    assert.match(detailPage, /Основное/);
    assert.match(detailPage, /Промпт роли/);
    assert.match(detailPage, /Память/);
  });

  it('редактирует label/description/default_status/allow_tools', () => {
    assert.match(detailPage, /setLabel/);
    assert.match(detailPage, /setDescription/);
    assert.match(detailPage, /setDefaultStatus/);
    assert.match(detailPage, /toggleTool/);
  });

  it('память: счётчик N / лимит и блокировка сохранения при превышении', () => {
    assert.match(detailPage, /memoryChars\} \/ \{data\.memory\.limit\}/);
    assert.match(detailPage, /overLimit/);
    assert.match(detailPage, /disabled=\{busy \|\| overLimit\}/);
  });

  it('подпись про git: промпт коммитится, память — нет', () => {
    assert.match(detailPage, /коммитится в git/);
    assert.match(detailPage, /в git НЕ попадает/);
  });
});

describe('VL-403 AC5/AC6: удаление', () => {
  it('кнопка удаления только для проектной роли', () => {
    assert.match(detailPage, /\{!persona\.builtin && \(/);
    assert.match(detailPage, /Удалить/);
  });

  it('подтверждение показывает пути файлов, которые НЕ удаляются', () => {
    assert.match(detailPage, /data\.promptPath/);
    assert.match(detailPage, /data\.memoryPath/);
    assert.match(detailPage, /останутся на диске/);
  });

  it('встроенная роль: пометка про переопределение', () => {
    assert.match(detailPage, /изменения сохраняются как переопределение/);
  });
});

describe('VL-403 AC8: клиентский API', () => {
  it('все четыре операции ходят в /api/personas', () => {
    assert.match(clientApi, /fetch\("\/api\/personas"\)/);
    assert.match(clientApi, /`\/api\/personas\/\$\{encodeURIComponent\(id\)\}`/);
    assert.match(clientApi, /method: "POST"/);
    assert.match(clientApi, /method: "PUT"/);
    assert.match(clientApi, /method: "DELETE"/);
  });
});
