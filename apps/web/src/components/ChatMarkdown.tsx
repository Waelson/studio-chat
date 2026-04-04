import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Theme = "dark" | "light";

type ChatMarkdownProps = {
  content: string;
  theme: Theme;
};

/**
 * Renderiza o conteúdo do assistente como Markdown (GFM), com estilos alinhados ao tema da app.
 */
export function ChatMarkdown({ content, theme }: ChatMarkdownProps) {
  const isDark = theme === "dark";

  const linkClass = isDark
    ? "font-medium text-violet-400 underline decoration-violet-500/40 underline-offset-2 hover:text-violet-300"
    : "font-medium text-violet-700 underline decoration-violet-400 underline-offset-2 hover:text-violet-800";

  const preClass = isDark
    ? "my-3 overflow-x-auto rounded-lg border border-zinc-700 bg-zinc-950/90 p-3 font-mono text-[0.85em] leading-relaxed text-zinc-200"
    : "my-3 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-100 p-3 font-mono text-[0.85em] leading-relaxed text-zinc-800";

  const inlineCodeClass = isDark
    ? "rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[0.9em] text-violet-200"
    : "rounded bg-zinc-200/80 px-1.5 py-0.5 font-mono text-[0.9em] text-violet-900";

  const components: Components = {
    p: ({ children }) => (
      <p className="mb-3 last:mb-0 [&:first-child]:mt-0">{children}</p>
    ),
    h1: ({ children }) => (
      <h1
        className={
          isDark
            ? "mt-4 mb-2 border-b border-zinc-700 pb-1 text-lg font-semibold text-zinc-100 first:mt-0"
            : "mt-4 mb-2 border-b border-zinc-200 pb-1 text-lg font-semibold text-zinc-900 first:mt-0"
        }
      >
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2
        className={
          isDark
            ? "mt-3 mb-2 text-base font-semibold text-zinc-100 first:mt-0"
            : "mt-3 mb-2 text-base font-semibold text-zinc-900 first:mt-0"
        }
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        className={
          isDark
            ? "mt-3 mb-1.5 text-sm font-semibold text-zinc-200 first:mt-0"
            : "mt-3 mb-1.5 text-sm font-semibold text-zinc-800 first:mt-0"
        }
      >
        {children}
      </h3>
    ),
    ul: ({ children }) => (
      <ul className="my-2 list-disc space-y-1 pl-5 [ul]:list-[circle]">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote
        className={
          isDark
            ? "my-3 border-l-4 border-violet-500/50 pl-3 text-zinc-400 italic"
            : "my-3 border-l-4 border-violet-300 pl-3 text-zinc-600 italic"
        }
      >
        {children}
      </blockquote>
    ),
    a: ({ href, children }) => (
      <a href={href} className={linkClass} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
    hr: () => (
      <hr className={isDark ? "my-4 border-zinc-700" : "my-4 border-zinc-200"} />
    ),
    table: ({ children }) => (
      <div
        className={
          isDark
            ? "my-3 max-w-full overflow-x-auto rounded-lg border border-zinc-600/50"
            : "my-3 max-w-full overflow-x-auto rounded-lg border border-zinc-200"
        }
      >
        <table className="w-full min-w-[240px] border-collapse text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className={isDark ? "bg-zinc-800/80" : "bg-zinc-100"}>{children}</thead>
    ),
    th: ({ children }) => (
      <th
        className={
          isDark
            ? "border border-zinc-700 px-3 py-2 text-left font-semibold text-zinc-200"
            : "border border-zinc-200 px-3 py-2 text-left font-semibold text-zinc-800"
        }
      >
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td
        className={
          isDark
            ? "border border-zinc-700/80 px-3 py-2 text-zinc-300"
            : "border border-zinc-200 px-3 py-2 text-zinc-700"
        }
      >
        {children}
      </td>
    ),
    tr: ({ children }) => <tr>{children}</tr>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    pre: ({ children }) => <pre className={preClass}>{children}</pre>,
    code: ({ className, children, ...props }) => {
      const isBlock = /language-\w+/.test(className ?? "");
      if (isBlock) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
      return (
        <code className={inlineCodeClass} {...props}>
          {children}
        </code>
      );
    },
    strong: ({ children }) => (
      <strong className="font-semibold text-inherit">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    del: ({ children }) => (
      <del className="text-zinc-500 line-through">{children}</del>
    ),
  };

  return (
    <div
      className={
        isDark
          ? "chat-md max-w-full min-w-0 overflow-x-auto text-sm leading-relaxed text-zinc-200 [&_>*:first-child]:mt-0"
          : "chat-md max-w-full min-w-0 overflow-x-auto text-sm leading-relaxed text-zinc-800 [&_>*:first-child]:mt-0"
      }
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
