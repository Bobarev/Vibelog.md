/**
 * Markdown-рендер режима просмотра задачи (VL-172).
 *
 * react-markdown + remark-gfm: GFM (чеклисты AC/DoD, таблицы планов,
 * зачёркивание) без raw HTML — JSX-парсер не вставляет разметку из текста
 * задачи (XSS-безопасность, без dangerouslySetInnerHTML).
 *
 * Typography-плагина Tailwind в проекте нет → стили элементов задаются
 * явным components-маппингом (text-sm leading-6 — как в шапке модалки).
 * Классы ссылок/кода — статические: href у ссылок из данных задач.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Общие классы контейнера секции: компактный текст модалки. */
const BODY = 'text-sm leading-6 break-words';

/**
 * Рендерит markdown-текст секции задачи.
 *
 * @param children — md-исходник секции; пусто/пробелы → тихий плейсхолдер
 */
export function MarkdownView({ children }: { children?: string | null }) {
  const text = (children ?? '').trim();
  if (!text) {
    return <p className="text-muted-foreground text-sm">Пусто.</p>;
  }
  return (
    <div className={BODY}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-3 mb-1.5 font-semibold text-base first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-3 mb-1.5 font-semibold text-sm first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-2 mb-1 font-semibold text-sm first:mt-0">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-2 mb-1 font-medium text-sm first:mt-0">{children}</h4>
          ),
          p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-1.5 list-disc space-y-0.5 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 list-decimal space-y-0.5 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-6">{children}</li>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-2"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-1.5 border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          code: ({ children, className: cls }) =>
            // Явный inline-класс только для инлайн-`кода`: блоки внутри pre
            // наследуют стиль от pre (дети pre — всегда блочный контент)
            cls ? (
              <code className={`rounded bg-muted px-1 py-0.5 font-mono text-xs ${cls}`}>
                {children}
              </code>
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                {children}
              </code>
            ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-5">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted/60 px-2 py-1 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1 align-top">{children}</td>
          ),
          hr: () => <hr className="my-3 border-border" />,
          // GFM task-list: чекбоксы AC/DoD — disabled-инпуты (просмотр)
          input: (props) => (
            <input
              type="checkbox"
              disabled
              checked={props.checked}
              className="mr-1.5 accent-primary align-middle"
            />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
