import Link from "next/link";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { headingId } from "@/lib/headings";
import { classifyLink } from "./docsLinks";

/** Plain text of rendered heading children (strings nested inside <strong>, <code>, links…). */
function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node)
    return textOf((node.props as { children?: React.ReactNode }).children);
  return "";
}

// GFM markdown, no raw HTML (react-markdown ignores it by default). `docPath` enables relative-link rewriting.
// h2/h3 get GitHub-style ids so "On this page" and #anchor links can jump to them.
// `externalOnly` is for pasted text with no place in the career docs: relative
// links render as plain text instead of resolving against guide/.
export function Markdown({
  children,
  docPath,
  className = "",
  externalOnly = false,
  hideImages = false,
}: {
  children: string;
  docPath?: string;
  className?: string;
  externalOnly?: boolean;
  hideImages?: boolean;
}) {
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={hideImages ? ["img"] : undefined}
        components={{
          h2({ children: kids }) {
            return <h2 id={headingId(textOf(kids))}>{kids}</h2>;
          },
          h3({ children: kids }) {
            return <h3 id={headingId(textOf(kids))}>{kids}</h3>;
          },
          a({ href, children: kids }) {
            const t = classifyLink(docPath ?? "guide/x.md", href);
            if (t.kind === "doc" && !externalOnly)
              return <Link href={t.href}>{kids}</Link>;
            if (t.kind === "anchor") return <a href={t.href}>{kids}</a>;
            if (t.kind === "external")
              return (
                <a href={t.href} target="_blank" rel="noreferrer noopener">
                  {kids}
                </a>
              );
            return <span>{kids}</span>;
          },
          table({ children: kids }) {
            return (
              <div className="overflow-x-auto">
                <table>{kids}</table>
              </div>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
