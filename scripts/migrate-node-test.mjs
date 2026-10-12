/**
 * Автоконвертация тестов с node:test на vitest (VL-133).
 *
 * Запуск: node scripts/migrate-node-test.mjs
 *
 * Механика (по Implementation Plan VL-133):
 * 1. `import { ... } from 'node:test'` → `from 'vitest'` с переименованием
 *    before→beforeAll, after→afterAll (beforeEach/afterEach не трогаются —
 *    имена совпадают в обоих рантаймах).
 * 2. Вызовы `before(`/`after(` в теле → `beforeAll(`/`afterAll(`. Regex с
 *    \b-границей не задевает beforeEach/afterEach (между идентификатором и
 *    "(" там ещё "Each" — границы слова нет).
 * 3. `import { test } from 'node:test'` → vitest (тест no-network.test.mjs).
 * 4. node:assert/strict НЕ меняется — vitest совместим с assert (AC задачи).
 * 5. Особые случаи (t.skip в frontmatter.test.mjs) чинятся отдельным блоком
 *    ниже: контекст vitest — ctx.skip() без аргумента-сообщения.
 *
 * Скрипт идемпотентен: повторный запуск не находит 'node:test' и выходит.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Рекурсивный сбор всех тестовых файлов src/<подкаталог>/*.test.mjs (только node:fs). */
function collectTestFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...collectTestFiles(p));
    else if (name.endsWith('.test.mjs')) out.push(p);
  }
  return out;
}

let changed = 0;
for (const file of collectTestFiles('src')) {
  let src = readFileSync(file, 'utf8');
  const original = src;

  // 1+2. Основная конвертация импорта и вызовов хуков
  src = src.replace(
    /import\s*\{([^}]*)\}\s*from\s*'node:test';?/g,
    (_m, names) => {
      // Внутри списка имён: before→beforeAll, after→afterAll, но не
      // beforeEach/afterEach — их отсекает (?!Each) после \b.
      const converted = names
        .replace(/\bbefore\b(?!Each)/g, 'beforeAll')
        .replace(/\bafter\b(?!Each)/g, 'afterAll');
      return `import {${converted}} from 'vitest';`;
    },
  );
  // Вызовы в теле (import-строку уже конвертировали, \b не заденет имена в других местах)
  src = src.replace(/\bbefore\s*\(/g, 'beforeAll(');
  src = src.replace(/\bafter\s*\(/g, 'afterAll(');

  // 5. frontmatter.test.mjs: t.skip(msg); return → ctx.skip() (vitest-контекст,
  //    сообщение-аргумент у vitest не поддерживается — condition видна по стеку)
  if (file.includes('frontmatter.test.mjs') && src.includes('t.skip(')) {
    src = src.replace(/async \(t\) =>/g, 'async (ctx) =>');
    src = src.replace(/t\.skip\([^)]*\);/g, 'ctx.skip();');
  }

  if (src !== original) {
    writeFileSync(file, src);
    changed++;
    console.log(`конвертирован: ${file}`);
  }
}
console.log(`Готово: изменено файлов — ${changed}`);
