---
id: VL-50
title: 'Telegram-бот: парсер команды /plan (parsePlanCommand)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-02 23:45'
updated_date: '2026-10-04 18:42'
due_date: ''
labels: []
dependencies: []
milestone: v1.6
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Добавить в src/bot/commands.ts чистую функцию parsePlanCommand по аналогии с parseStatusCommand (VL-35): аргумент команды /plan — только ID задачи (первое слово, окружающие пробелы снимаются); пустой ввод — {error} с подсказкой синтаксиса. Интерфейс PlanCommand {id: string}. Это основа обработчика /plan (следующая задача).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 parsePlanCommand('VL-49') и parsePlanCommand('  VL-49  ') возвращают {id: 'VL-49'}
- [x] #2 parsePlanCommand('') и parsePlanCommand('   ') возвращают {error} с подсказкой «Синтаксис: /plan VL-<id>»
- [x] #3 Юнит-тесты добавлены в src/bot/commands.test.mjs (describe 'parsePlanCommand'), pnpm test без регрессий
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы для изменения
- src/bot/commands.ts — интерфейс PlanCommand + функция parsePlanCommand
- src/bot/commands.test.mjs — describe('parsePlanCommand (VL-50)')

## commands.ts — конкретные места
1. Интерфейс PlanCommand — вставить ПОСЛЕ блока SpecCommand (строки 31–34, после `}` на строке 34, до комментария `/** Снятие окружающих кавычек. */` на строке 36):
   ```
   /** Результат разбора /plan. */
   export interface PlanCommand {
     id: string;
   }
   ```
2. Функция parsePlanCommand — добавить в КОНЕЦ файла (после parseSpecCommand, строка 146):
   ```
   /**
    * Разбирает /plan: «VL-1» — только ID задачи (первое слово).
    *
    * @param text — аргументы команды (без слова /plan)
    * @returns {id} или {error} с подсказкой
    */
   export function parsePlanCommand(text: string): PlanCommand | { error: string } {
     const hint = 'Синтаксис: /plan VL-<id>';
     const trimmed = text.trim();
     if (!trimmed) return { error: hint };
     // ID — первое слово; хвостовой текст игнорируется (lenient, как в /status)
     const id = trimmed.split(/\s+/)[0];
     if (!id) return { error: hint };
     return { id };
   }
   ```
   Логика: `text.trim()` → пусто → error; иначе `split(/\s+/)[0]` — первое слово. trim() снимает ведущие/хвостовые пробелы, split отбрасывает хвост после ID. Обратите внимание: `parseStatusCommand` (строки 98–114) требует ровно «id status» через indexOf(' '), а /plan — только ID, поэтому используем split, а не indexOf.

## commands.test.mjs — конкретные места
1. Импорт (строки 8–13): добавить `parsePlanCommand` в деструктуризацию:
   ```
   import {
     parseCreateCommand,
     parseStatusCommand,
     parseCommentCommand,
     parseSpecCommand,
     parsePlanCommand,   // ← новое
   } from '../../dist/bot/commands.js';
   ```
2. Новый describe — вставить в КОНЕЦ файла (после строки 90, закрывающая `});` describe parseSpecCommand):
   ```
   describe('parsePlanCommand (VL-50)', () => {
     it('корректный ID → {id}', () => {
       assert.deepEqual(parsePlanCommand('VL-49'), { id: 'VL-49' });
     });

     it('окружающие пробелы снимаются', () => {
       assert.deepEqual(parsePlanCommand('  VL-49  '), { id: 'VL-49' });
     });

     it('хвостовой текст игнорируется (первое слово)', () => {
       assert.deepEqual(parsePlanCommand('VL-49 ещё что-то'), { id: 'VL-49' });
     });

     it('пустая строка и пробелы → error с подсказкой', () => {
       const e1 = parsePlanCommand('');
       const e2 = parsePlanCommand('   ');
       assert.ok('error' in e1);
       assert.ok('error' in e2);
       assert.match(e1.error, /Синтаксис/);
       assert.match(e1.error, /\/plan/);
     });
   });
   ```

## Порядок действий
1. commands.ts: вставить интерфейс PlanCommand (строка ~35)
2. commands.ts: добавить parsePlanCommand в конец (строка ~146)
3. commands.test.mjs: расширить импорт (строка ~13)
4. commands.test.mjs: добавить describe в конец (строка ~90)
5. Сборка + тесты (см. «Как проверить»)
6. Отметить AC через backlog_manage_ac, добавить комментарий, сменить статус на Done
7. Показать git diff и ждать «да» на коммит

## Как проверить
```bash
# Сборка (tsc strict)
pnpm build

# Юнит-тесты парсеров (включая новый describe)
node --test src/bot/commands.test.mjs

# Полный прогон без регрессий
pnpm test

# Проверка, что функция экспортируется
grep -n "parsePlanCommand" src/bot/commands.ts

# Проверка, что describe попал в тесты
grep -n "parsePlanCommand (VL-50)" src/bot/commands.test.mjs
```

Ожидаемый результат: `node --test src/bot/commands.test.mjs` — все тесты `ok` (сейчас 16, станет 20); `pnpm test` — 366/366 (без регрессий).

## Риски
- **Низкий риск.** Функция чистая, side-effect нет.
- Единственный нюанс: `split(/\s+/)[0]` на строке из одних пробелов вернёт `''`, но это уже отсекается `if (!trimmed)` выше.
- Не ломаем сигнатуры соседних парсеров — только добавление в конец файла и в импорт.
- Тестовый файл: `commands.test.mjs` исключён из tsconfig (exclude `src/**/*.test.mjs`), поэтому ошибки типов в тесте не соберутся через tsc — но и не сломают сборку. Проверяем рантаймом через `node --test`.

## Связанные задачи
- VL-49 (если есть) — обработчик /plan, зависит от этой задачи.
- Используемые паттерны: unquote (строка 36), parseStatusCommand (строки 98–114) — как референс для lenient-парсинга.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-03 00:05
---
Фаза 3 (Code) выполнена. parsePlanCommand + интерфейс PlanCommand добавлены в src/bot/commands.ts (trim → первое слово split(/\s+/)[0], пусто → {error: 'Синтаксис: /plan VL-<id>'}). Тесты: +4 кейса в commands.test.mjs (обычный ID, пробелы, хвост игнорируется, пусто → error). Проверки: парсеры 17/17, pnpm test 370/370.
---
<!-- COMMENTS:END -->