/**
 * Мини-рендерер Markdown → HTML для Vibelog.md.
 *
 * Поддерживает базовый Markdown:
 * - Заголовки (h1-h6)
 * - Параграфы
 * - Списки (unordered, ordered)
 * - Чеклисты (`- [ ]`, `- [x]`)
 * - Код: inline (`code`) и блоки (```...```)
 * - Ссылки
 * - Жирный, курсив
 * - Горизонтальные линии
 *
 * Не поддерживает: таблицы, вложенные списки, картинки.
 * Достаточно для отображения тела задач Backlog.md.
 */

/**
 * Рендерит Markdown-текст в HTML.
 *
 * @param markdown — текст в формате Markdown
 */
export function renderMarkdown(markdown: string): string {
  if (!markdown) return '';

  const lines = markdown.split('\n');
  const html: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Блоки кода: ```lang ... ```
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        html.push(`<pre><code class="language-${codeLang}">${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        codeLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();

    // Пустые строки — разделители параграфов
    if (trimmed === '') {
      continue;
    }

    // Заголовки: # ... ######
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Горизонтальная линия: --- или *** или ___
    if (/^[-*_]{3,}$/.test(trimmed)) {
      html.push('<hr>');
      continue;
    }

    // Чеклисты: - [ ] text или - [x] text
    const checkMatch = trimmed.match(/^[-*]\s+\[([ x])\]\s+(.*)/);
    if (checkMatch) {
      const checked = checkMatch[1] === 'x' ? ' checked' : '';
      html.push(`<li class="checklist"><input type="checkbox"${checked} disabled> ${renderInline(checkMatch[2])}</li>`);
      continue;
    }

    // Ненумерованные списки: - text или * text
    const ulMatch = trimmed.match(/^[-*]\s+(.*)/);
    if (ulMatch) {
      html.push(`<li>${renderInline(ulMatch[1])}</li>`);
      continue;
    }

    // Нумерованные списки: 1. text
    const olMatch = trimmed.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      html.push(`<li>${renderInline(olMatch[1])}</li>`);
      continue;
    }

    // Обычный текст — параграф
    html.push(`<p>${renderInline(trimmed)}</p>`);
  }

  // Если остались незакрытые строки кода
  if (inCodeBlock && codeLines.length > 0) {
    html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }

  return html.join('\n');
}

/**
 * Обрабатывает inline-элементы Markdown.
 *
 * Поддерживает:
 * - **жирный**
 * - *курсив*
 * - `код`
 * - [ссылка](url)
 */
function renderInline(text: string): string {
  let result = text;

  // Ссылки: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Inline-код: `code`
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Жирный: **text** или __text__
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Курсив: *text* или _text_
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
  result = result.replace(/_(.+?)_/g, '<em>$1</em>');

  return result;
}

/**
 * Экранирует HTML-спецсимволы.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
