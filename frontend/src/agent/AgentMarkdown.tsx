/**
 * The little bit of markdown the agent actually uses: **bold**, `code`, and
 * "- " bullets. Rendered as React nodes rather than injected HTML, so model
 * output can never become markup.
 */
import { Fragment, type ReactNode } from "react";

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={key} className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[11px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function AgentMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <>
      {lines.map((line, i) => {
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            <span key={i} className="flex gap-1.5">
              <span className="select-none text-muted-foreground">•</span>
              <span>{renderInline(bullet[1], `l${i}`)}</span>
            </span>
          );
        }
        if (!line.trim()) return <span key={i} className="block h-2" />;
        return <span key={i} className="block">{renderInline(line, `l${i}`)}</span>;
      })}
    </>
  );
}
