import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';
import { useState, useCallback } from 'react';

interface ResponseProps {
  children: string;
  className?: string;
}

// Code block with copy button
interface CodeBlockProps {
  language: string;
  value: string;
}

function CodeBlock({ language, value }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [value]);

  // Split code into lines for line numbers
  const lines = value.split('\n');

  return (
    <div className="relative group my-4 rounded-xl overflow-hidden border border-border bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#161b22] border-b border-border">
        <span className="text-xs text-text-secondary font-medium uppercase tracking-wider">{language || 'text'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
        >
          {copied ? (
            <>
              <Check size={14} className="text-accent-green" />
              <span className="text-accent-green font-medium">已复制</span>
            </>
          ) : (
            <>
              <Copy size={14} />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      
      {/* Code with line numbers */}
      <div className="flex text-sm overflow-x-auto">
        {/* Line numbers */}
        <div className="flex-shrink-0 py-4 px-4 text-right bg-[#0d1117] border-r border-border select-none">
          {lines.map((_, i) => (
            <div key={i} className="text-[#484f58] leading-6 text-xs font-mono">
              {i + 1}
            </div>
          ))}
        </div>
        {/* Code content */}
        <div className="flex-1 py-4 px-4 overflow-x-auto">
          <pre className="text-[#e6edf3] leading-6 text-sm font-mono whitespace-pre">
            {value}
          </pre>
        </div>
      </div>
    </div>
  );
}

// Inline code
function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded-md bg-bg-tertiary text-accent-cyan text-sm font-mono">
      {children}
    </code>
  );
}

// Response component with markdown support - optimized for streaming
export function Response({ children, className }: ResponseProps) {
  // Don't render empty content during streaming start
  if (!children && children !== '') {
    return null;
  }

  return (
    <div className={clsx('text-[15px] leading-7 text-text-primary', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Code blocks
          code({ className: codeClassName, children: codeChildren }) {
            const match = /language-(\w+)/.exec(codeClassName || '');
            const language = match ? match[1] : '';
            const value = String(codeChildren).replace(/\n$/, '');

            // Inline code (no language specified, single line, or inline context)
            if (!codeClassName || (!value.includes('\n') && value.length < 50)) {
              return <InlineCode>{codeChildren}</InlineCode>;
            }

            // Code block
            return <CodeBlock language={language} value={value} />;
          },

          // Headings
          h1({ children: h1Children }) {
            return <h1 className="text-2xl font-bold text-text-primary mt-8 mb-4 pb-2 border-b border-border">{h1Children}</h1>;
          },
          h2({ children: h2Children }) {
            return <h2 className="text-xl font-semibold text-text-primary mt-6 mb-3">{h2Children}</h2>;
          },
          h3({ children: h3Children }) {
            return <h3 className="text-lg font-semibold text-text-primary mt-5 mb-2">{h3Children}</h3>;
          },
          h4({ children: h4Children }) {
            return <h4 className="text-base font-semibold text-text-primary mt-4 mb-2">{h4Children}</h4>;
          },

          // Paragraphs
          p({ children: pChildren }) {
            return <p className="mb-4 last:mb-0">{pChildren}</p>;
          },

          // Lists
          ul({ children: ulChildren }) {
            return <ul className="list-disc list-outside mb-4 ml-5 space-y-1.5">{ulChildren}</ul>;
          },
          ol({ children: olChildren }) {
            return <ol className="list-decimal list-outside mb-4 ml-5 space-y-1.5">{olChildren}</ol>;
          },
          li({ children: liChildren }) {
            return <li className="text-text-primary pl-1">{liChildren}</li>;
          },

          // Links
          a({ href, children: aChildren }) {
            return (
              <a 
                href={href} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-accent-cyan hover:underline hover:text-accent-cyan/80 transition-colors"
              >
                {aChildren}
              </a>
            );
          },

          // Blockquotes
          blockquote({ children: bqChildren }) {
            return (
              <blockquote className="border-l-3 border-accent-cyan/50 pl-4 py-2 my-4 bg-bg-tertiary/30 rounded-r-lg text-text-secondary italic">
                {bqChildren}
              </blockquote>
            );
          },

          // Horizontal rule
          hr() {
            return <hr className="border-border my-6" />;
          },

          // Tables
          table({ children: tableChildren }) {
            return (
              <div className="overflow-x-auto my-4 rounded-lg border border-border">
                <table className="w-full border-collapse">
                  {tableChildren}
                </table>
              </div>
            );
          },
          thead({ children: theadChildren }) {
            return <thead className="bg-bg-tertiary">{theadChildren}</thead>;
          },
          th({ children: thChildren }) {
            return (
              <th className="border-b border-border px-4 py-2.5 text-left text-sm font-semibold text-text-primary">
                {thChildren}
              </th>
            );
          },
          td({ children: tdChildren }) {
            return (
              <td className="border-b border-border px-4 py-2.5 text-sm text-text-secondary">
                {tdChildren}
              </td>
            );
          },

          // Strong and emphasis
          strong({ children: strongChildren }) {
            return <strong className="font-semibold text-text-primary">{strongChildren}</strong>;
          },
          em({ children: emChildren }) {
            return <em className="italic text-text-secondary">{emChildren}</em>;
          },

          // Delete/strikethrough
          del({ children: delChildren }) {
            return <del className="line-through text-text-secondary">{delChildren}</del>;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
