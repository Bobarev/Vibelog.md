/**
 * Git-политика проекта: корневой `.gitignore` и `.vibelog/.gitignore` (VL-348).
 *
 * Зачем отдельный модуль: `vb init` обязан приводить проект в состояние
 * «секреты не уедут в git» ДО первого коммита. Раньше корневой `.gitignore`
 * не создавался вовсе, и `.env` с токенами попадал в `git add -A` первым же
 * коммитом; политика `.vibelog/` (VL-329) жила только как файл этого
 * репозитория, а `vibelog doctor` умел лишь ругаться на её отсутствие.
 *
 * Два принципа:
 * 1. **Корневой `.gitignore` — мерж, а не перезапись.** Файл может быть чужим
 *    (проект уже жил без Vibelog): дописываем только отсутствующие правила в
 *    блок с маркерами, посторонние строки не трогаем. Повторный прогон
 *    идемпотентен байт-в-байт — иначе `vb init` каждый раз «менял» бы файл.
 * 2. **`.vibelog/.gitignore` — создаётся целиком, если файла нет.**
 *    Существующий не перезаписываем: его могли изменить осознанно, а
 *    расхождение сообщаем предупреждением (решение — за человеком).
 *
 * Пути пишутся в `cwd`, а не в `git rev-parse --show-toplevel`: `init` может
 * запускаться в подкаталоге чужого монорепо, и править чужой корневой
 * `.gitignore` он не имеет права (симметрично `gitignorePathFor` в
 * `experiment-gc.ts`).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Начальный маркер блока Vibelog в корневом `.gitignore`. */
export const GITIGNORE_BLOCK_START = '# >>> vibelog';

/** Конечный маркер блока Vibelog в корневом `.gitignore`. */
export const GITIGNORE_BLOCK_END = '# <<< vibelog';

/**
 * Минимальный корневой `.gitignore` для нового проекта (AC1).
 *
 * Порядок строк фиксирован: он же используется при мерже, поэтому повторный
 * прогон не переставляет правила.
 */
export const ROOT_GITIGNORE_TEMPLATE = `node_modules/
dist/
# Клоны референсных репозиториев
backlog/references/data/
# Markdown-кэш doc/url references
backlog/references/cache/
# Секреты (токены, API-ключи, TELEGRAM_CHAT_IDS) — не коммитить
.env
.DS_Store
*.log
`;

/**
 * Правила, которые дописываются в СУЩЕСТВУЮЩИЙ чужой `.gitignore`.
 *
 * `.DS_Store` и `*.log` сюда не входят: это личные предпочтения, в чужой
 * файл их не навязываем (решение из описания VL-348). Комментарии шаблона
 * тоже не переносятся — в чужом файле они были бы шумом.
 */
export const ROOT_GITIGNORE_MERGE_RULES = [
  'node_modules/',
  'dist/',
  'backlog/references/data/',
  'backlog/references/cache/',
  '.env',
];

/**
 * Политика `.vibelog/` (VL-329): «запрещаем всё, разрешаем явно».
 *
 * Каталог развивается, и новый артефакт по умолчанию остаётся локальным, а не
 * утекает в репозиторий случайно (важнее всего — транскрипты сессий и кэши).
 */
export const VIBELOG_GITIGNORE_TEMPLATE = `# Git-политика .vibelog/
# 1. Всё локальное и восстанавливаемое — игнорируется
*
!*/

# 1a. Рабочие деревья задач — вложенные git-репозитории
worktrees/

# 2. Сам файл политики — в git
!.gitignore

# 3. Конфигурация и учёт: состояние установленных компонентов
!config.json
!installed.lock.json

# 4. Настройки проекта. Секретов здесь нет: токены, API-ключи и
#    TELEGRAM_CHAT_IDS живут только в .env в корне проекта
!settings.json

# 5. Переопределения ролей проекта поверх встроенных (src/web/personas.ts)
!prompts/
!prompts/**

# 6. История трат: append-only источник правды по токенам и таймингам ранов
!billing/
!billing/**
`;

/** Убирает завершающие пустые строки (файл должен кончаться одним `\n`). */
function trimTrailingBlank(text: string): string {
  return text.replace(/\n+$/, '');
}

/**
 * Дописывает отсутствующие правила в текст `.gitignore` (чистая функция).
 *
 * Блок обрамлён маркерами `# >>> vibelog` / `# <<< vibelog`: так повторный
 * прогон находит свой блок и не накапливает дубли, а посторонние строки
 * остаются нетронутыми. Правило, уже присутствующее в файле ВНЕ блока, не
 * дублируется (иначе `.env` появился бы дважды).
 *
 * @param existing — текущее содержимое файла ('' — файла нет)
 * @param desired — правила, которые должны быть в файле
 * @returns новый текст; равен `existing`, если добавлять нечего
 */
export function mergeGitignore(existing: string, desired: string[]): string {
  if (existing === '') {
    // Файла нет — пишем правила как есть, без маркеров: это наш файл целиком
    return desired.length === 0 ? '' : `${desired.join('\n')}\n`;
  }

  const lines = existing.split('\n');
  const start = lines.findIndex((l) => l.trim() === GITIGNORE_BLOCK_START);
  let end = -1;
  if (start !== -1) {
    for (let i = start + 1; i < lines.length; i += 1) {
      if (lines[i].trim() === GITIGNORE_BLOCK_END) {
        end = i;
        break;
      }
    }
  }

  // Правило считается присутствующим, если оно есть где угодно в файле
  const present = new Set(lines.map((l) => l.trim()));
  const missing = desired.filter((rule) => !present.has(rule.trim()));
  if (missing.length === 0) return existing;

  if (start === -1) {
    // Блока нет — дописываем в конец отдельным абзацем
    const base = trimTrailingBlank(existing);
    const block = [GITIGNORE_BLOCK_START, ...missing, GITIGNORE_BLOCK_END].join('\n');
    return base === '' ? `${block}\n` : `${base}\n\n${block}\n`;
  }

  // Блок есть — дополняем его на месте (порядок прежних строк сохраняется)
  const cut = end === -1 ? lines.length : end + 1;
  const blockLines = end === -1 ? lines.slice(start + 1) : lines.slice(start + 1, end);
  const head = lines.slice(0, start);
  const tail = end === -1 ? [] : lines.slice(cut);
  const merged = [
    ...head,
    GITIGNORE_BLOCK_START,
    ...blockLines,
    ...missing,
    GITIGNORE_BLOCK_END,
    ...tail,
  ].join('\n');
  return `${trimTrailingBlank(merged)}\n`;
}

/** Пишет файл атомарно: temp + rename в том же каталоге (lesson-169). */
function writeAtomic(path: string, content: string): void {
  const tmp = join(dirname(path), `.${process.pid}.${Date.now()}.gitignore.tmp`);
  try {
    writeFileSync(tmp, content, 'utf-8');
    renameSync(tmp, path);
  } catch (err) {
    try {
      if (existsSync(tmp)) rmSync(tmp, { force: true });
    } catch {
      // Уборка temp-файла не должна заслонять исходную ошибку записи
    }
    throw err;
  }
}

/**
 * Приводит корневой `.gitignore` проекта к минимальному набору правил.
 *
 * @param cwd — директория проекта (файл пишется именно сюда, не в корень
 *   чужого репозитория)
 * @returns `created` — файла не было и он создан целиком; `updated` — в
 *   существующий файл дописаны недостающие правила; `unchanged` — менять
 *   нечего (повторный прогон)
 */
export function writeRootGitignore(cwd: string): 'created' | 'updated' | 'unchanged' {
  const path = join(cwd, '.gitignore');
  if (!existsSync(path)) {
    writeAtomic(path, ROOT_GITIGNORE_TEMPLATE);
    return 'created';
  }
  const current = readFileSync(path, 'utf-8');
  const next = mergeGitignore(current, ROOT_GITIGNORE_MERGE_RULES);
  if (next === current) return 'unchanged';
  writeAtomic(path, next);
  return 'updated';
}

/**
 * Создаёт `.vibelog/.gitignore` с политикой VL-329, если файла нет.
 *
 * Существующий файл не перезаписывается: его могли изменить осознанно.
 * Расхождение с шаблоном сообщает `vibelogGitignoreDiffers` — решение
 * остаётся за человеком.
 *
 * @param cwd — директория проекта
 * @returns `created` — файл создан; `exists` — файл уже был (не тронут)
 */
export function writeVibelogGitignore(cwd: string): 'created' | 'exists' {
  const dir = join(cwd, '.vibelog');
  const path = join(dir, '.gitignore');
  if (existsSync(path)) return 'exists';
  mkdirSync(dir, { recursive: true });
  writeAtomic(path, VIBELOG_GITIGNORE_TEMPLATE);
  return 'created';
}

/**
 * Отличается ли существующий `.vibelog/.gitignore` от шаблона политики.
 *
 * Сравнение по набору значимых строк (без пустых и комментариев): файл
 * проекта может содержать свои пояснения, и это не расхождение политики.
 *
 * @param cwd — директория проекта
 * @returns true — файл есть и в нём не хватает правил шаблона
 */
export function vibelogGitignoreDiffers(cwd: string): boolean {
  const path = join(cwd, '.vibelog', '.gitignore');
  if (!existsSync(path)) return false;
  const significant = (text: string): Set<string> =>
    new Set(
      text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('#')),
    );
  const current = significant(readFileSync(path, 'utf-8'));
  const expected = significant(VIBELOG_GITIGNORE_TEMPLATE);
  for (const rule of expected) {
    if (!current.has(rule)) return true;
  }
  return false;
}
