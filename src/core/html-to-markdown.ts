/**
 * Собственный HTML → Markdown конвертер (VL-232).
 *
 * Заменяет зависимость turndown + turndown-plugin-gfm (добавлена в VL-194):
 * они тянули транзитивный @mixmark-io/domino — полноценный HTML-DOM парсер
 * ради одного вызова htmlToMarkdown. Здесь — свой минимальный парсер:
 * токенайзер (теги/текст/комментарии) → дерево узлов → рендер по правилам,
 * повторяющим CommonMark-правила turndown + GFM-плагин (ref-17):
 *
 *   - мусорные поддеревья (script/style/nav/footer/header/aside/form/button/
 *     iframe/svg/title/head) выбрасываются ещё на этапе токенайзера — вместе
 *     с содержимым и вложенными элементами;
 *   - join() как в turndown: строки соединяются переводом строки, число
 *     которых равно максимуму «хвостовых» и «ведущих» переводов строк
 *     соседних кусков (но не больше двух) — отсюда пустые строки между
 *     блоками и отсутствие пустой строки перед вложенным списком;
 *   - схлопывание whitespace (адаптация collapse-whitespace из turndown):
 *     серии [ \r\n\t]+ → один пробел, ведущий пробел отбрасывается после
 *     блока, но сохраняется после void-элементов — именно поэтому чеклист
 *     даёт «-   [x]  done» (два пробела после маркера);
 *   - экранирование markdown-синтаксиса в тексте (список markdownEscapes);
 *   - HTML-энтити декодируются и в тексте, и в атрибутах, включая
 *     содержимое code/pre — так же поступал прежний парсер: он раскрывал
 *     энтити до применения правил (`<code>a &amp;&amp; b</code>` → `a && b`).
 *
 * Осознанные отклонения от turndown (зафиксированы тестами):
 *   - многострочное содержимое ячейки таблицы: переводы строк заменяются
 *     пробелами (у turndown внутрь ячейки попадал hard-break и GFM-таблица
 *     ломалась), символ `|` экранируется;
 *   - таблица без строки-заголовка (<th>): рендерится простыми строками
 *     ячеек без разделителя (turndown оставлял её исходным HTML);
 *   - colspan/rowspan игнорируются, число ячеек выравнивается по числу
 *     колонок строки-заголовка.
 *
 * Модуль не имеет зависимостей (даже node builtins не нужны) — чистая
 * функция `htmlToMarkdown(html: string): string`.
 */

/** Токен разбора: открывающий/закрывающий тег или текстовый кусок. */
interface OpenToken {
  kind: 'open';
  tag: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
}

interface CloseToken {
  kind: 'close';
  tag: string;
}

interface TextToken {
  kind: 'text';
  text: string;
}

type Token = OpenToken | CloseToken | TextToken;

/** Узел дерева: элемент или текст (после декодирования энтити). */
export interface ElementNode {
  type: 'element';
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
}

interface TextNode {
  type: 'text';
  data: string;
}

type HtmlNode = ElementNode | TextNode;

/** Теги-мусор: выбрасываются вместе с содержимым (по описанию VL-232 + select/noscript). */
const SKIP_TAGS = new Set([
  'script', 'style', 'nav', 'footer', 'header', 'aside', 'form', 'button',
  'iframe', 'svg', 'title', 'head', 'noscript', 'select',
]);

/** Raw-text элементы: их содержимое не разбирается на теги, а поглощается целиком. */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'title', 'textarea', 'noscript', 'xmp']);

/**
 * Void-элементы (нет закрывающего тега). input важен для чеклистов:
 * после него preserveWhitespaceText=истина, из-за чего «[x]  done».
 */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'command', 'embed', 'hr', 'img', 'input',
  'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/** Блочные элементы (список из turndown utilities.isBlock). */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'audio', 'blockquote', 'body', 'canvas',
  'center', 'dd', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hgroup', 'hr', 'html', 'isindex', 'li', 'main', 'menu', 'nav',
  'noframes', 'noscript', 'ol', 'output', 'p', 'pre', 'section', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

/**
 * Частые именованные энтити HTML. Полная таблица HTML5 (≈2000 имён) не нужна:
 * реальные страницы используют ограниченный набор, остальное закрывают
 * числовые ссылки &#NN;/&#xNN;.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', deg: '\u00b0',
  times: '\u00d7', divide: '\u00f7', plusmn: '\u00b1', frac12: '\u00bd',
  hellip: '\u2026', mdash: '\u2014', ndash: '\u2013', minus: '\u2212',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  sbquo: '\u201a', bdquo: '\u201e', laquo: '\u00ab', raquo: '\u00bb',
  lsaquo: '\u2039', rsaquo: '\u203a', bull: '\u2022', middot: '\u00b7',
  dagger: '\u2020', Dagger: '\u2021', sect: '\u00a7', para: '\u00b6',
  euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2', curren: '\u00a4',
  larr: '\u2190', uarr: '\u2191', rarr: '\u2192', darr: '\u2193',
  harr: '\u2194', varr: '\u2195', infin: '\u221e', ne: '\u2260',
  le: '\u2264', ge: '\u2265', asymp: '\u2248', equiv: '\u2261',
  prod: '\u220f', sum: '\u2211', radic: '\u221a', part: '\u2202',
  int: '\u222b', nabla: '\u2207', isin: '\u2208', notin: '\u2209',
  and: '\u2227', or: '\u2228', cap: '\u2229', cup: '\u222a',
  alpha: '\u03b1', beta: '\u03b2', gamma: '\u03b3', delta: '\u03b4',
  epsilon: '\u03b5', zeta: '\u03b6', eta: '\u03b7', theta: '\u03b8',
  iota: '\u03b9', kappa: '\u03ba', lambda: '\u03bb', mu: '\u03bc',
  nu: '\u03bd', xi: '\u03be', pi: '\u03c0', rho: '\u03c1',
  sigma: '\u03c3', tau: '\u03c4', phi: '\u03c6', chi: '\u03c7',
  psi: '\u03c8', omega: '\u03c9', Alpha: '\u0391', Beta: '\u0392',
  Gamma: '\u0393', Delta: '\u0394', Theta: '\u0398', Lambda: '\u039b',
  Xi: '\u039e', Pi: '\u03a0', Sigma: '\u03a3', Phi: '\u03a6',
  Psi: '\u03a8', Omega: '\u03a9', ensp: '\u2002', emsp: '\u2003',
  thinsp: '\u2009', zwnj: '\u200c', zwj: '\u200d', shy: '\u00ad',
  iexcl: '\u00a1', iquest: '\u00bf', micro: '\u00b5', sup1: '\u00b9',
  sup2: '\u00b2', sup3: '\u00b3', frac14: '\u00bc', frac34: '\u00be',
  spades: '\u2660', clubs: '\u2663', hearts: '\u2665', diams: '\u2666',
  oline: '\u203e', permil: '\u2030', prime: '\u2032', Prime: '\u2033',
  loz: '\u25ca', szlig: '\u00df', agrave: '\u00e0', aacute: '\u00e1',
  egrave: '\u00e8', eacute: '\u00e9', ccedil: '\u00e7', uuml: '\u00fc',
  ouml: '\u00f6', auml: '\u00e4', ntilde: '\u00f1', Auml: '\u00c4',
  Ouml: '\u00d6', Uuml: '\u00dc',
};

/**
 * Декодирует HTML-энтити: числовые (&#1071;/&#x42F;) и именованные из таблицы.
 * Неизвестные имена остаются как есть — терять текст нельзя.
 */
function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      // Суррогатные коды недопустимы в JS-строках — оставляем энтити как есть.
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body];
    return named === undefined ? whole : named;
  });
}

/** Разбирает строку атрибутов тега в объект (имена в нижнем регистре, значения декодированы). */
function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1].toLowerCase();
    if (name === '' || name === '/') continue;
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/** Экранирует имя тега для подстановки в регулярное выражение. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Токенайзер: комментарии/doctype выбрасываются, raw-text содержимое
 * поглощается, мусорные поддеревья пропускаются целиком.
 */
function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const len = html.length;
  let i = 0;

  const pushText = (text: string): void => {
    if (text) tokens.push({ kind: 'text', text: decodeEntities(text) });
  };

  while (i < len) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      pushText(html.slice(i));
      break;
    }
    if (lt > i) pushText(html.slice(i, lt));

    // Комментарий <!-- ... -->
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    // <!DOCTYPE ...> и <?xml ... ?>
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt + 2);
      i = end === -1 ? len : end + 1;
      continue;
    }

    const closing = html[lt + 1] === '/';
    let k = closing ? lt + 2 : lt + 1;
    while (k < len && /[a-zA-Z0-9:_-]/.test(html[k])) k++;
    const tag = html.slice(closing ? lt + 2 : lt + 1, k).toLowerCase();
    if (tag === '') {
      // Не тег, а случайный '<' в тексте (например, «a < b») — как текст.
      pushText('<');
      i = lt + 1;
      continue;
    }

    // Сканируем атрибуты до '>', учитывая кавычки (внутри может быть '>').
    let p = k;
    let quote: string | null = null;
    while (p < len) {
      const ch = html[p];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      p++;
    }
    const rawAttrs = html.slice(k, p);
    const selfClosing = /\/\s*$/.test(rawAttrs);
    i = p < len ? p + 1 : len;

    if (closing) {
      tokens.push({ kind: 'close', tag });
      continue;
    }

    const attrs = parseAttributes(rawAttrs);

    // Мусорное поддерево: ищем парный закрывающий тег с учётом вложенности.
    if (SKIP_TAGS.has(tag)) {
      const re = new RegExp(`<\\s*(/?)${escapeRegExp(tag)}\\b`, 'gi');
      re.lastIndex = i;
      let depth = 1;
      let m: RegExpExecArray | null;
      let afterClose = -1;
      while ((m = re.exec(html)) !== null) {
        if (m[1] === '/') {
          depth--;
          if (depth === 0) {
            const gt = html.indexOf('>', m.index);
            afterClose = gt === -1 ? len : gt + 1;
            break;
          }
        } else {
          depth++;
        }
      }
      i = afterClose === -1 ? i : afterClose;
      continue;
    }

    tokens.push({ kind: 'open', tag, attrs, selfClosing });

    // Raw-text: содержимое не разбираем (поглощаем до закрывающего тега).
    if (RAW_TEXT_TAGS.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, i);
      if (close === -1) {
        i = len;
      } else {
        const gt = html.indexOf('>', close);
        i = gt === -1 ? len : gt + 1;
      }
      tokens.push({ kind: 'close', tag });
    }
  }

  return tokens;
}

/**
 * Строит дерево из токенов. Незакрытые элементы закрываются по факту
 * (стек): `<p>a<div>b</div>` → p содержит div — как авто-закрытие в HTML.
 */
function buildTree(tokens: Token[]): ElementNode {
  const root: ElementNode = { type: 'element', tag: '#root', attrs: {}, children: [] };
  const stack: ElementNode[] = [root];

  for (const token of tokens) {
    const current = stack[stack.length - 1];
    if (token.kind === 'text') {
      current.children.push({ type: 'text', data: token.text });
      continue;
    }
    if (token.kind === 'open') {
      const el: ElementNode = { type: 'element', tag: token.tag, attrs: token.attrs, children: [] };
      current.children.push(el);
      if (!token.selfClosing && !VOID_TAGS.has(token.tag)) stack.push(el);
      continue;
    }
    // Закрывающий тег: снимаем стек до совпадения, иначе игнорируем.
    for (let idx = stack.length - 1; idx > 0; idx--) {
      if (stack[idx].tag === token.tag) {
        stack.length = idx;
        break;
      }
    }
  }

  return root;
}

/**
 * Схлопывает whitespace как turndown: серии [ \r\n\t]+ → один пробел,
 * ведущий пробел после блока отбрасывается, после void-элемента — нет,
 * хвостовой пробел перед блоком/br срезается. Внутрь pre не заходим.
 */
function collapseWhitespace(node: ElementNode, state: { prevText: TextNode | null; keepLeadingWs: boolean }): void {
  for (const child of node.children) {
    if (child.type === 'text') {
      let text = child.data.replace(/[ \r\n\t]+/g, ' ');
      if ((!state.prevText || / $/.test(state.prevText.data)) && !state.keepLeadingWs && text.startsWith(' ')) {
        text = text.slice(1);
      }
      if (text === '') {
        child.data = '';
        continue;
      }
      child.data = text;
      state.prevText = child;
      continue;
    }

    const isPre = child.tag === 'pre';
    if (BLOCK_TAGS.has(child.tag) || child.tag === 'br') {
      if (state.prevText) state.prevText.data = state.prevText.data.replace(/ $/, '');
      state.prevText = null;
      state.keepLeadingWs = false;
    } else if (VOID_TAGS.has(child.tag) || isPre) {
      state.prevText = null;
      state.keepLeadingWs = true;
    } else if (state.prevText) {
      state.keepLeadingWs = false;
    }

    if (!isPre) collapseWhitespace(child, state);
  }
}

/** Убирает ведущие переводы строк. */
function trimLeadingNewlines(text: string): string {
  return text.replace(/^\n*/, '');
}

/** Убирает хвостовые переводы строк (без regexp-match-at-end по всей строке). */
function trimTrailingNewlines(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '\n') end--;
  return text.slice(0, end);
}

/** Убирает переводы строк с обоих концов. */
function trimNewlines(text: string): string {
  return trimTrailingNewlines(trimLeadingNewlines(text));
}

/**
 * Соединяет куски как turndown join(): число переводов строк между ними
 * равно максимуму из хвостовых переводов левого и ведущих правого (не > 2).
 */
function join(output: string, replacement: string): string {
  const left = trimTrailingNewlines(output);
  const right = trimLeadingNewlines(replacement);
  const nls = Math.max(output.length - left.length, replacement.length - right.length);
  const separator = '\n\n'.slice(0, nls);
  return left + separator + right;
}

/** Экранирование markdown-синтаксиса в тексте (список из turndown utilities). */
function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/^-/g, '\\-')
    .replace(/^\+ /g, '\\+ ')
    .replace(/^(=+)/g, '\\$1')
    .replace(/^(#{1,6}) /g, '\\$1 ')
    .replace(/`/g, '\\`')
    .replace(/^~~~/g, '\\~~~')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/^>/g, '\\>')
    .replace(/_/g, '\\_')
    .replace(/^(\d+)\. /g, '$1\\. ');
}

/** Текст узла и всех потомков без разбора (для pre/code). */
function rawText(node: ElementNode): string {
  let out = '';
  for (const child of node.children) {
    if (child.type === 'text') out += child.data;
    else if (child.tag === 'br') out += '\n';
    else out += rawText(child);
  }
  return out;
}

/** Значение атрибута (нормализация переводов строк внутри значения). */
function cleanAttribute(value: string | undefined): string {
  return value ? value.replace(/(\n+\s*)+/g, '\n') : '';
}

/** Escape назначения ссылки как в turndown: экранируем <>(), пробел → <...>. */
function escapeLinkDestination(destination: string): string {
  const escaped = destination.replace(/([<>()])/g, '\\$1');
  return escaped.includes(' ') ? `<${escaped}>` : escaped;
}

/** Последний ли это элемент-ребёнок (для вложенного списка в li). */
function isLastElementChild(node: ElementNode, parent: ElementNode): boolean {
  const elements = parent.children.filter((c): c is ElementNode => c.type === 'element');
  return elements[elements.length - 1] === node;
}

/** Дети элемента-строки таблицы (th/td). */
function rowCells(row: ElementNode): ElementNode[] {
  return row.children.filter((c): c is ElementNode => c.type === 'element' && (c.tag === 'th' || c.tag === 'td'));
}

/** Все строки таблицы в порядке следования (с раскрытием thead/tbody/tfoot). */
function tableRows(table: ElementNode): ElementNode[] {
  const rows: ElementNode[] = [];
  const collect = (el: ElementNode): void => {
    for (const child of el.children) {
      if (child.type !== 'element') continue;
      if (child.tag === 'tr') rows.push(child);
      else if (child.tag === 'thead' || child.tag === 'tbody' || child.tag === 'tfoot') collect(child);
    }
  };
  collect(table);
  return rows;
}

/** Строка-заголовок? (все ячейки th) — как в gfm-плагине turndown. */
function isHeadingRow(row: ElementNode, table: ElementNode): boolean {
  const cells = rowCells(row);
  if (cells.length === 0) return false;
  if (!cells.every(c => c.tag === 'th')) return false;
  const rows = tableRows(table);
  return rows[0] === row;
}

/** Содержимое ячейки таблицы: переводы строк → пробелы, '|' экранируется. */
function cellContent(cell: ElementNode): string {
  const rendered = renderChildren(cell, false);
  return rendered.replace(/[\r\n]+/g, ' ').replace(/[ \t]+/g, ' ').replace(/\|/g, '\\|').trim();
}

/** Рендер строки таблицы: '| a | b |' (+ строка-разделитель для заголовка). */
function tableRowMarkdown(row: ElementNode, withBorder: boolean): string {
  const cells = rowCells(row);
  const parts = cells.map((cell, idx) => (idx === 0 ? '| ' : ' ') + cellContent(cell) + ' |');
  let line = parts.join('');
  if (withBorder) {
    line += '\n' + cells.map((_, idx) => (idx === 0 ? '| --- ' : ' --- ') + '|').join('');
  }
  return line;
}

/** Рендер таблицы GFM (если есть строка-заголовок) либо простыми строками ячеек. */
function renderTable(table: ElementNode): string {
  const rows = tableRows(table);
  if (rows.length === 0) return '';
  const headingIndex = rows.findIndex(row => isHeadingRow(row, table));
  if (headingIndex === -1) {
    // Нет строки-заголовка — GFM-таблица невозможна; отдаём строки ячеек.
    const lines = rows.map(row => rowCells(row).map(cellContent).join(' | '));
    return '\n\n' + lines.join('\n') + '\n\n';
  }
  const lines: string[] = [];
  if (headingIndex > 0) {
    // Строки до заголовка (редкий случай) идут после разделителя.
    lines.push(tableRowMarkdown(rows[headingIndex], true));
    for (let idx = 0; idx < rows.length; idx++) {
      if (idx !== headingIndex) lines.push(tableRowMarkdown(rows[idx], false));
    }
  } else {
    lines.push(tableRowMarkdown(rows[0], true));
    for (let idx = 1; idx < rows.length; idx++) lines.push(tableRowMarkdown(rows[idx], false));
  }
  return '\n\n' + lines.join('\n') + '\n\n';
}

/** Рендер списка (ul/ol): вложенный список в последнем li идёт без пустой строки. */
function renderList(node: ElementNode, parent: ElementNode | null, inCode: boolean): string {
  const content = renderChildren(node, inCode);
  if (parent && parent.tag === 'li' && isLastElementChild(node, parent)) {
    return '\n' + content;
  }
  return '\n\n' + content + '\n\n';
}

/** Рендер элемента li: маркер, отступ продолжения, чеклист, вложенные блоки. */
function renderListItem(node: ElementNode, parent: ElementNode | null, inCode: boolean): string {
  const isOrdered = parent !== null && parent.tag === 'ol';
  const items = parent === null
    ? [node]
    : parent.children.filter((c): c is ElementNode => c.type === 'element' && c.tag === 'li');
  const index = Math.max(items.indexOf(node), 0);
  let prefix = '-   ';
  if (isOrdered) {
    const start = Number.parseInt(parent?.attrs.start ?? '', 10);
    const number = Number.isFinite(start) && start > 0 ? start + index : index + 1;
    prefix = `${number}.  `;
  }

  let content = renderChildren(node, inCode);
  const isParagraph = /\n$/.test(content);
  content = trimNewlines(content) + (isParagraph ? '\n' : '');
  content = content.replace(/\n/g, '\n' + ' '.repeat(prefix.length));
  const hasNextSibling = parent !== null && !isLastElementChild(node, parent);
  return prefix + content + (hasNextSibling ? '\n' : '');
}

/** Рендер fenced-блока кода: ограждение длиннее самой длинной серии бэктиков внутри. */
function renderCodeFence(code: string, language: string): string {
  let fenceSize = 3;
  const runs = code.match(/^`{3,}/gm) ?? [];
  for (const run of runs) {
    if (run.length >= fenceSize) fenceSize = run.length + 1;
  }
  const fence = '`'.repeat(fenceSize);
  return `${fence}${language}\n${code.replace(/\n$/, '')}\n${fence}`;
}

/** Язык code-блока из class (поддерживаем «language-x» и «lang-x», как в блоках сайтов). */
function codeLanguage(codeChild: ElementNode): string {
  const className = codeChild.attrs.class ?? '';
  const match = className.match(/language-(\S+)/);
  return match ? match[1] : '';
}

/**
 * Рендер pre: fenced-блок с длиной ограждения больше максимальной серии бэктиков.
 *
 * В `<pre>` может лежать несколько `<code>` — так делает, например, nodejs.org
 * (переключатель ESM/CJS: два варианта одного примера в одном pre). renderPre
 * обязан сохранить содержимое всех: прежний turndown выводил первый блок
 * ограждением, а остальные — инлайновым кодом (и терял переводы строк).
 */
function renderPre(node: ElementNode): string {
  const codeChildren = node.children.filter((c): c is ElementNode => c.type === 'element' && c.tag === 'code');
  if (codeChildren.length === 0) {
    // pre без code: содержимое сохраняем как есть, оборачиваем как блок.
    return '\n\n' + rawText(node) + '\n\n';
  }
  const blocks = codeChildren.map(codeChild => renderCodeFence(rawText(codeChild), codeLanguage(codeChild)));
  // Переключатели/тулбары внутри pre (input, div.code-language) не выводим:
  // это UI-обвязка сниппета, а не его содержимое.
  return '\n\n' + blocks.join('\n\n') + '\n\n';
}

/** Рендер inline-code: делимитер удлиняется, если внутри есть бэктики. */
function renderInlineCode(node: ElementNode): string {
  let content = renderChildren(node, true).replace(/\r?\n/g, ' ');
  if (!content) return '';
  const extraSpace = /^`|^ .*?[^ ].* $|`$/.test(content) ? ' ' : '';
  let delimiter = '`';
  const matches: string[] = content.match(/`+/g) ?? [];
  while (matches.includes(delimiter)) delimiter += '`';
  return `${delimiter}${extraSpace}${content}${extraSpace}${delimiter}`;
}

/**
 * Выносит пограничные пробелы inline-элемента за markdown-делимитеры —
 * аналог flankingWhitespace из turndown. Без этого `<strong>Ссылка: </strong>`
 * давало «**Ссылка: **» (пробел внутри звёздочек) вместо «**Ссылка:** ».
 */
function hoistEdges(content: string): { leading: string; body: string; trailing: string } {
  const leading = /^\s/.test(content) ? ' ' : '';
  const trailing = /\s$/.test(content) ? ' ' : '';
  const body = content.trim();
  return { leading: body === '' ? ' ' : leading, body, trailing: body === '' ? '' : trailing };
}

/** Рендер одного узла: возвращает «replacement» в терминах turndown. */
function renderNode(node: HtmlNode, parent: ElementNode | null, inCode: boolean): string {
  if (node.type === 'text') {
    return inCode ? node.data : escapeMarkdown(node.data);
  }

  const tag = node.tag;
  if (SKIP_TAGS.has(tag)) return '';

  switch (tag) {
    case 'pre':
      return renderPre(node);
    case 'table':
      return renderTable(node);
    case 'br':
      return '  \n';
    case 'hr':
      return '\n\n* * *\n\n';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return `\n\n${'#'.repeat(Number(tag[1]))} ${renderChildren(node, inCode)}\n\n`;
    case 'blockquote': {
      const content = trimNewlines(renderChildren(node, inCode)).replace(/^/gm, '> ');
      return '\n\n' + content + '\n\n';
    }
    case 'ul':
    case 'ol':
      return renderList(node, parent, inCode);
    case 'li':
      return renderListItem(node, parent, inCode);
    case 'p':
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'html':
    case 'body':
    case 'headerless-block':
      return '\n\n' + renderChildren(node, inCode) + '\n\n';
    case 'img': {
      const src = escapeLinkDestination(node.attrs.src ?? '');
      if (!src) return '';
      const alt = escapeMarkdown(cleanAttribute(node.attrs.alt));
      const title = cleanAttribute(node.attrs.title);
      return `![${alt}](${src}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    }
    case 'input': {
      if ((node.attrs.type ?? '').toLowerCase() !== 'checkbox') return '';
      if (parent?.tag !== 'li') return '';
      return (node.attrs.checked !== undefined ? '[x]' : '[ ]') + ' ';
    }
    case 'a': {
      const content = renderChildren(node, inCode);
      const href = node.attrs.href;
      if (!href) return content;
      const title = cleanAttribute(node.attrs.title);
      const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
      return `[${content}](${escapeLinkDestination(href)}${titlePart})`;
    }
    case 'strong':
    case 'b':
    case 'em':
    case 'i':
    case 'del':
    case 's':
    case 'strike': {
      const delim = tag === 'strong' || tag === 'b' ? '**' : tag === 'em' || tag === 'i' ? '*' : '~~';
      const { leading, body, trailing } = hoistEdges(renderChildren(node, inCode));
      return body ? `${leading}${delim}${body}${delim}${trailing}` : '';
    }
    case 'code':
      return renderInlineCode(node);
    default: {
      const content = renderChildren(node, inCode);
      // Неизвестный блочный элемент — оборачиваем как блок (defaultReplacement).
      return BLOCK_TAGS.has(tag) ? '\n\n' + content + '\n\n' : content;
    }
  }
}

/** Рендер детей элемента с соединением по правилам turndown join(). */
function renderChildren(parent: ElementNode, inCode: boolean): string {
  let out = '';
  for (const child of parent.children) {
    out = join(out, renderNode(child, parent, inCode));
  }
  return out;
}

/**
 * Конвертирует HTML в markdown.
 *
 * Результат — чистые данные: без I/O, без сети, без внешних зависимостей.
 * Возвращает строку, оканчивающуюся переводом строки (контракт VL-194:
 * вызывающий код — cacheReference — пишет её в файл как есть).
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.includes('<')) {
    // Ни тегов, ни энтити — просто декодируем и отдаём текстом.
    const text = html.trim();
    return text === '' ? '\n' : decodeEntities(text) + '\n';
  }

  const tokens = tokenize(html);
  const root = buildTree(tokens);
  collapseWhitespace(root, { prevText: null, keepLeadingWs: false });
  const output = renderChildren(root, false);
  // Пост-обработка turndown: убрать ведущие/хвостовые переводы строк и пробелы.
  const trimmed = output.replace(/^[\t\r\n]+/, '').replace(/[\t\r\n\s]+$/, '');
  return trimmed.trim() + '\n';
}