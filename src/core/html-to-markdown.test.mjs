/**
 * Тесты VL-232 — собственный HTML→markdown конвертер (замена turndown).
 *
 * Проверяем обязательный минимум из описания задачи: мусорные теги, h1-h6,
 * p/br, вложенные списки, fenced/inline code, blockquote, ссылки, картинки,
 * GFM-таблицы, strikethrough, чеклисты, HTML-энтити — плюс кейсы рисков:
 * многострочные ячейки таблиц и pre с отступами.
 *
 * Импортируем из dist (@types/node — только текст, сеть не нужна).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { htmlToMarkdown } from '../../dist/core/html-to-markdown.js';
// Ре-экспорт из reference-cache: контракт VL-194 (вызывающий код не меняется).
import { htmlToMarkdown as viaReferenceCache } from '../../dist/core/reference-cache.js';

const SAMPLE_HTML = [
  '<html><head><title>Page Title</title></head><body>',
  '<header>Site nav</header>',
  '<script>var x=1;</script>',
  '<style>.a{color:red}</style>',
  '<h1>Заголовок</h1>',
  '<p>Абзац с <a href="/doc">ссылкой</a> и <img src="/i.png" alt="pic">.</p>',
  '<ul><li>раз</li><li>два</li></ul>',
  '<blockquote>цитата</blockquote>',
  '<pre><code>const a = 1;</code></pre>',
  '<table><tr><th>Имя</th><th>Значение</th></tr><tr><td>a</td><td>1</td></tr></table>',
  '<footer>footer text</footer>',
  '</body></html>',
].join('\n');

describe('VL-232 — htmlToMarkdown: сигнатура и ре-экспорт', () => {
  it('ре-экспорт из reference-cache совпадает с модулем конвертера', () => {
    assert.equal(viaReferenceCache(SAMPLE_HTML), htmlToMarkdown(SAMPLE_HTML));
  });

  it('результат заканчивается переводом строки (контракт VL-194)', () => {
    assert.ok(htmlToMarkdown('<p>x</p>').endsWith('\n'));
  });

  it('пустой вход не падает и даёт пустую строку', () => {
    assert.equal(htmlToMarkdown('').trim(), '');
  });
});

describe('VL-232 — мусорные теги', () => {
  it('удаляет script/style/nav/footer/header/aside/form/button/iframe/svg/title/head с содержимым', () => {
    const html = [
      '<html><head><title>Page Title</title><style>.a{color:red}</style></head><body>',
      '<nav>nav text</nav><footer>footer text</footer><header>header text</header>',
      '<aside>aside text</aside><form>form text</form><button>button text</button>',
      '<iframe src="x">iframe text</iframe><svg><path>svg text</path></svg>',
      '<script>var x = 1;</script>',
      '<div>keep</div>',
      '</body></html>',
    ].join('\n');
    const md = htmlToMarkdown(html);
    for (const junk of ['Page Title', 'color:red', 'nav text', 'footer text', 'header text',
      'aside text', 'form text', 'button text', 'iframe text', 'svg text', 'var x = 1']) {
      assert.ok(!md.includes(junk), `мусор просочился: ${junk} → ${JSON.stringify(md)}`);
    }
    assert.ok(md.includes('keep'), `контент потерян: ${md}`);
  });

  it('удаляет мусор, вложенный в другие элементы (несколько уровней)', () => {
    const md = htmlToMarkdown('<div><div><nav><div>deep junk</div></nav></div><p>text</p></div>');
    assert.ok(!md.includes('deep junk'), `вложенный мусор просочился: ${md}`);
    assert.ok(md.includes('text'));
  });

  it('пустой head/body/div не добавляют лишних пустых строк', () => {
    const md = htmlToMarkdown('<head><meta charset="utf-8"></head><body><p>x</p></body>');
    assert.equal(md, 'x\n');
  });
});

describe('VL-232 — заголовки, абзацы, переносы строк', () => {
  it('h1-h6 → atx-заголовки разного уровня', () => {
    const md = htmlToMarkdown('<h1>1</h1><h2>2</h2><h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6>');
    assert.equal(md, '# 1\n\n## 2\n\n### 3\n\n#### 4\n\n##### 5\n\n###### 6\n');
  });

  it('абзацы разделяются пустой строкой, соседние p не склеиваются', () => {
    const md = htmlToMarkdown('<p>первый</p><p>второй</p>');
    assert.equal(md, 'первый\n\nвторой\n');
  });

  it('br → hard-break (два пробела + перевод строки)', () => {
    assert.equal(htmlToMarkdown('<p>a<br>b</p>'), 'a  \nb\n');
  });

  it('hr → горизонтальная линия', () => {
    assert.equal(htmlToMarkdown('<p>a</p><hr><p>b</p>'), 'a\n\n* * *\n\nb\n');
  });

  it('серии пробелов/переводов строк в тексте схлопываются в один пробел', () => {
    assert.equal(htmlToMarkdown('<p>a\n\n   b\t\tc</p>'), 'a b c\n');
  });
});

describe('VL-232 — списки', () => {
  it('ul → маркеры «- », ol → нумерация', () => {
    assert.equal(htmlToMarkdown('<ul><li>раз</li><li>два</li></ul>'), '-   раз\n-   два\n');
    assert.equal(htmlToMarkdown('<ol><li>раз</li><li>два</li></ol>'), '1.  раз\n2.  два\n');
  });

  it('вложенные ul (два уровня) с отступом вложенного уровня', () => {
    const md = htmlToMarkdown('<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>');
    assert.equal(md, '-   a\n    -   a1\n    -   a2\n-   b\n');
  });

  it('вложенные списки трёх уровней и смешанные ul/ol', () => {
    const md = htmlToMarkdown(
      '<ul><li>1<ol><li>1.1<ul><li>1.1.1</li></ul></li></ol></li></ul>',
    );
    assert.ok(/^- {3}1$/m.test(md), `уровень 1: ${JSON.stringify(md)}`);
    assert.ok(/^\s{4}1\. {2}1\.1$/m.test(md), `уровень 2: ${JSON.stringify(md)}`);
    assert.ok(/^\s{8}- {3}1\.1\.1$/m.test(md), `уровень 3: ${JSON.stringify(md)}`);
  });

  it('li с несколькими <p> не теряет абзацы (поведение как у turndown: пустая строка с отступом)', () => {
    const md = htmlToMarkdown('<ul><li><p>первый</p><p>второй</p></li></ul>');
    // turndown давал то же самое: "-   первый\n    \n    второй\n" — фиксируем паритет.
    assert.equal(md, '-   первый\n    \n    второй\n');
  });

  it('li без текста (только вложенный список) не выводит пустой маркер', () => {
    const md = htmlToMarkdown('<ul><li><ul><li>x</li></ul></li></ul>');
    assert.ok(md.includes('x'));
  });

  it('ol со start нумеруется с указанного числа', () => {
    assert.equal(htmlToMarkdown('<ol start="5"><li>a</li><li>b</li></ol>'), '5.  a\n6.  b\n');
  });
});

describe('VL-232 — код', () => {
  it('pre>code → fenced-блок с языком из class', () => {
    const md = htmlToMarkdown('<pre><code class="language-js">const a = 1;</code></pre>');
    assert.equal(md, '```js\nconst a = 1;\n```\n');
  });

  it('pre с отступами и табами сохраняет их без изменений', () => {
    const md = htmlToMarkdown('<pre><code>line1\n  indented\n\ttabbed</code></pre>');
    assert.equal(md, '```\nline1\n  indented\n\ttabbed\n```\n');
  });

  it('inline code → `` `...` `` (в т.ч. перевод строки внутри схлопывается)', () => {
    assert.equal(htmlToMarkdown('<p>text <code>a = 1</code> end</p>'), 'text `a = 1` end\n');
  });

  it('inline code с бэктиком внутри получает более длинный делимитер', () => {
    const md = htmlToMarkdown('<p><code>a ` b</code></p>');
    assert.ok(md.startsWith('``a'), md);
  });

  it('пустой inline code → пусто', () => {
    assert.equal(htmlToMarkdown('<p>a<code></code>b</p>').trim(), 'ab');
  });

  it('code-блок с ограждением внутри — ограждение удлиняется', () => {
    const md = htmlToMarkdown('<pre><code>x\n```\ny</code></pre>');
    assert.ok(/^`{4}/.test(md), `ограждение должно быть длиннее: ${JSON.stringify(md)}`);
    assert.ok(md.includes('```'), 'содержимое сохранено');
  });

  it('несколько <code> внутри одного pre сохраняются все (кейс nodejs.org)', () => {
    const html = '<pre><code class="language-mjs">import x from "y";</code>'
      + '<code class="language-cjs">const x = require("y");</code></pre>';
    const md = htmlToMarkdown(html);
    assert.ok(md.includes('import x from "y";'), md);
    assert.ok(md.includes('const x = require("y");'), md);
    assert.ok(md.includes('```mjs'), md);
    assert.ok(md.includes('```cjs'), md);
  });
});

describe('VL-232 — blockquote', () => {
  it('blockquote → «> »', () => {
    assert.equal(htmlToMarkdown('<blockquote>цитата</blockquote>'), '> цитата\n');
  });

  it('многоабзацная цитата: каждый абзац с префиксом', () => {
    const md = htmlToMarkdown('<blockquote><p>один</p><p>два</p></blockquote>');
    assert.equal(md, '> один\n> \n> два\n');
  });

  it('вложенная цитата — двойной префикс', () => {
    const md = htmlToMarkdown('<blockquote><p>q1</p><blockquote>q2</blockquote></blockquote>');
    assert.ok(md.includes('> > q2') || md.includes('> q2'), md);
    assert.ok(md.includes('> q1'));
  });
});

describe('VL-232 — ссылки и изображения', () => {
  it('a с href → [text](href)', () => {
    assert.equal(htmlToMarkdown('<p><a href="/doc">текст</a></p>'), '[текст](/doc)\n');
  });

  it('a без href → просто текст', () => {
    assert.equal(htmlToMarkdown('<p><a>текст</a></p>'), 'текст\n');
  });

  it('a с вложенным strong → [**bold**](href)', () => {
    assert.equal(htmlToMarkdown('<p><a href="/b"><strong>bold</strong></a></p>'), '[**bold**](/b)\n');
  });

  it('пробел в href → <...> вокруг назначения', () => {
    const md = htmlToMarkdown('<p><a href="/a b">x</a></p>');
    assert.ok(md.includes('(<', ), md);
    assert.ok(md.includes('/a b') || md.includes('/a\\ b'), md);
  });

  it('img → ![alt](src); без src → ничего; пустой alt допустим', () => {
    assert.equal(htmlToMarkdown('<p><img src="/i.png" alt="pic"></p>'), '![pic](/i.png)\n');
    assert.equal(htmlToMarkdown('<p><img alt="pic"></p>').trim(), '');
    assert.equal(htmlToMarkdown('<p><img src="/i.png"></p>'), '![](/i.png)\n');
  });

  it('пробел перед закрывающим strong не попадает внутрь делимитера', () => {
    const md = htmlToMarkdown('<p><strong>Source Code: </strong><a href="/x">lib/fs.js</a></p>');
    assert.ok(md.includes('**Source Code:**'), md);
    assert.ok(!md.includes('**: **'), md);
  });
});

describe('VL-232 — GFM-таблицы', () => {
  it('шапка th + строки td → | ... | и | --- |', () => {
    const html = '<table><tr><th>Имя</th><th>Значение</th></tr><tr><td>a</td><td>1</td></tr></table>';
    assert.equal(htmlToMarkdown(html), '| Имя | Значение |\n| --- | --- |\n| a | 1 |\n');
  });

  it('thead/tbody раскрываются, шапка берётся из thead', () => {
    const html = '<table><thead><tr><th>A</th><th>B</th></tr></thead>'
      + '<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>';
    assert.equal(htmlToMarkdown(html), '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');
  });

  it('colspan/rowspan игнорируются (ячейка идёт в одну колонку), строки не теряются', () => {
    const html = '<table><tr><th colspan="2">Head</th></tr>'
      + '<tr><td>a</td><td rowspan="2">b</td></tr><tr><td>c</td></tr></table>';
    const md = htmlToMarkdown(html);
    assert.ok(md.includes('| Head |'), md);
    assert.ok(md.includes('| a | b |'), md);
    assert.ok(md.includes('| c |'), md);
  });

  it('многострочная ячейка → пробел (без hard-break, ломающего таблицу)', () => {
    const md = htmlToMarkdown('<table><tr><th>A</th></tr><tr><td>line1<br>line2</td></tr></table>');
    assert.ok(md.includes('| line1 line2 |'), md);
    assert.ok(!md.includes('  \n'), `hard-break внутри ячейки: ${JSON.stringify(md)}`);
  });

  it('неровное число ячеек: строки не падают', () => {
    const html = '<table><tr><th>A</th><th>B</th></tr><tr><td>only</td></tr></table>';
    const md = htmlToMarkdown(html);
    assert.ok(md.includes('| A | B |'), md);
    assert.ok(md.includes('| only |'), md);
  });

  it('символ | в ячейке экранируется', () => {
    const md = htmlToMarkdown('<table><tr><th>A</th></tr><tr><td>a|b</td></tr></table>');
    assert.ok(md.includes('a\\|b'), md);
  });

  it('таблица без th: строки ячеек без разделителя (не теряются)', () => {
    const md = htmlToMarkdown('<table><tr><td>a</td><td>b</td></tr></table>');
    assert.ok(md.includes('a'), md);
    assert.ok(md.includes('b'), md);
  });
});

describe('VL-232 — GFM-дополнения', () => {
  it('strikethrough (del/s/strike) → ~~...~~ (GFM)', () => {
    assert.equal(htmlToMarkdown('<p><del>deleted</del></p>'), '~~deleted~~\n');
    assert.equal(htmlToMarkdown('<p><s>s2</s></p>'), '~~s2~~\n');
    assert.equal(htmlToMarkdown('<p><strike>s3</strike></p>'), '~~s3~~\n');
  });

  it('emphasis/strong → *…* / **…**', () => {
    assert.equal(htmlToMarkdown('<p><em>a</em> и <strong>b</strong></p>'), '*a* и **b**\n');
  });

  it('чеклисты: checked → [x], unchecked → [ ]', () => {
    const html = '<ul><li><input type="checkbox" checked> done</li>'
      + '<li><input type="checkbox"> todo</li></ul>';
    const md = htmlToMarkdown(html);
    assert.ok(md.includes('[x]') && md.includes('done'), md);
    assert.ok(md.includes('[ ]') && md.includes('todo'), md);
  });

  it('чеклист во вложенном пункте сохраняет вложенность', () => {
    const html = '<ul><li><input type="checkbox" checked> done'
      + '<ul><li><input type="checkbox"> deep</li></ul></li></ul>';
    const md = htmlToMarkdown(html);
    assert.ok(md.includes('[x]'), md);
    const lines = md.trim().split('\n');
    assert.ok(lines.length >= 2, md);
    assert.ok(lines[1].startsWith('    '), `вложенный пункт с отступом: ${JSON.stringify(md)}`);
    assert.ok(lines[1].includes('[ ]'), md);
  });

  it('input вне li (не checkbox) не выводится', () => {
    assert.equal(htmlToMarkdown('<p><input type="text"></p>').trim(), '');
    assert.equal(htmlToMarkdown('<div><input type="checkbox"></div>').trim(), '');
  });
});

describe('VL-232 — HTML-энтити', () => {
  it('именованные и числовые энтити в тексте декодируются', () => {
    assert.equal(htmlToMarkdown('<p>a &amp; b &lt;x&gt; &quot;q&quot; &#39;s&#39;</p>'),
      'a & b <x> "q" \'s\'\n');
  });

  it('&nbsp; и &#xNN; декодируются', () => {
    const md = htmlToMarkdown('<p>a&nbsp;b &#x41;</p>');
    assert.ok(md.includes('a\u00a0b'), md);
    assert.ok(md.includes('A'), md);
  });

  it('энтити в атрибутах (href, alt, title) декодируются', () => {
    const md = htmlToMarkdown('<p><a href="/a&amp;b" title="x &quot;y&quot;">t</a></p>');
    assert.ok(md.includes('/a&b') || md.includes('/a\\&b') || md.includes('a&amp;b') === false, md);
    assert.ok(md.includes('t'), md);
  });

  it('энтити внутри code-блока декодируются (паритет с прежним turndown)', () => {
    // В HTML энтити раскрываются парсером до применения правил, поэтому
    // <code>a &amp;&amp; b</code> означает «a && b» — прежний вывод совпадал.
    assert.equal(htmlToMarkdown('<pre><code>if (a &amp;&amp; b) {}</code></pre>'),
      '```\nif (a && b) {}\n```\n');
  });

  it('неизвестная энтити остаётся как есть (текст не теряется)', () => {
    assert.ok(htmlToMarkdown('<p>&nosuchentity; x</p>').includes('&nosuchentity;'));
  });
});

describe('VL-232 — устойчивость к битой разметке', () => {
  it('незакрытые теги не роняют конвертер', () => {
    const md = htmlToMarkdown('<p>a<div>b</div>');
    assert.ok(md.includes('a'), md);
    assert.ok(md.includes('b'), md);
  });

  it('символ < в тексте не считается тегом', () => {
    assert.equal(htmlToMarkdown('<p>a < b</p>'), 'a < b\n');
  });

  it('комментарии и doctype выбрасываются', () => {
    const md = htmlToMarkdown('<!doctype html><!-- комментарий --><p>x</p>');
    assert.equal(md, 'x\n');
  });

  it('markdown-спецсимволы в тексте экранируются', () => {
    const md = htmlToMarkdown('<p>a * b _ c [d] # e</p>');
    assert.ok(md.includes('\\*'), md);
    assert.ok(md.includes('\\_'), md);
    assert.ok(md.includes('\\['), md);
  });

  it('HTML без тегов (просто текст) возвращается как есть', () => {
    assert.equal(htmlToMarkdown('просто текст'), 'просто текст\n');
  });
});

describe('VL-232 — сводный кейс VL-194', () => {
  it('полный SAMPLE_HTML конвертируется целиком', () => {
    const md = htmlToMarkdown(SAMPLE_HTML);
    assert.equal(md, [
      '# Заголовок',
      '',
      'Абзац с [ссылкой](/doc) и ![pic](/i.png).',
      '',
      '-   раз',
      '-   два',
      '',
      '> цитата',
      '',
      '```',
      'const a = 1;',
      '```',
      '',
      '| Имя | Значение |',
      '| --- | --- |',
      '| a | 1 |',
      '',
    ].join('\n'));
  });
});