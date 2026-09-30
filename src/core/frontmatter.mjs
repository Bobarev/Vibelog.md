/**
 * Парсер и сериализатор frontmatter для задач Vibelog.md / Backlog.md.
 *
 * Формат файла задачи:
 *   ---
 *   id: BACK-123
 *   title: Example task
 *   ...
 *   ---
 *   ## Description
 *   ...тело задачи...
 *
 * Frontmatter — блок YAML между двумя строками `---`.
 * Тело — всё, что идёт после второго `---`.
 */

import { parseYaml, stringifyYaml } from './yaml.mjs';

/**
 * Парсит файл задачи на frontmatter (данные) и тело (markdown).
 *
 * @param {string} content — полное содержимое файла
 * @returns {{ data: Record<string, unknown>, body: string }}
 *   data — распарсенный YAML-фронтматтер (пустой объект, если нет)
 *   body — текст после второго `---` (может быть пустой строкой)
 */
export function parseFrontmatter(content) {
  if (typeof content !== 'string') {
    throw new Error('parseFrontmatter: ожидается строка');
  }

  // Проверяем, что файл начинается с `---` (разделитель frontmatter)
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { data: {}, body: content };
  }

  // Ищем закрывающий `---` после первого.
  // Используем indexOf со смещением, чтобы не путать с content-маркет (--- в markdown).
  const firstSep = trimmed.indexOf('\n');
  if (firstSep === -1) {
    // Одна строка `---` — некорректный формат, возвращаем как есть
    return { data: {}, body: content };
  }

  // Ищем закрывающий `---` — он должен стоять на отдельной строке,
  // начинаяться без отступа (или с минимумом)
  const afterFirst = trimmed.slice(firstSep + 1);
  const closingIndex = findClosingSeparator(afterFirst);

  if (closingIndex === -1) {
    // Не нашли закрывающий `---` — Treat как файл без frontmatter
    return { data: {}, body: content };
  }

  // Извлекаем YAML-блок (без первого `---` и без закрывающего `---`)
  const yamlBlock = afterFirst.slice(0, closingIndex);
  const rest = afterFirst.slice(closingIndex);

  // Пропускаем строку `---` и возможный перевод строки после неё
  const bodyStart = rest.indexOf('\n');
  const body = bodyStart === -1 ? '' : rest.slice(bodyStart + 1);

  // Парсим YAML
  const data = parseYaml(yamlBlock);

  return { data, body };
}

/**
 * Ищет позицию закрывающего `---` в тексте.
 *
 * Закрывающий `---` — это строка, которая начинается с `---`
 * и стоит на собственной строке (не внутри YAML-значений).
 * Мы просто ищем `\n---\n` или `\n---` в конце.
 *
 * @param {string} text — текст после открывающего `---\n`
 * @returns {number} — позиция символа `\n` перед `---`, или -1
 */
function findClosingSeparator(text) {
  // Ищем строку, которая является только `---` (без отступа)
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      // Вычисляем позицию в исходном тексте
      let pos = 0;
      for (let j = 0; j < i; j++) {
        pos += lines[j].length + 1; // +1 для \n
      }
      return pos;
    }
  }
  return -1;
}

/**
 * Сериализует данные и тело обратно в формат файла задачи.
 *
 * @param {Record<string, unknown>} data — объект frontmatter
 * @param {string} body — markdown-тело задачи
 * @returns {string} — полное содержимое файла
 */
export function serializeFrontmatter(data, body) {
  const yamlBlock = stringifyYaml(data);
  return `---\n${yamlBlock}\n---\n${body}`;
}
