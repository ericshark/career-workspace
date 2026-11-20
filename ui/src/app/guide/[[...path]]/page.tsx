import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CopyPath } from "@/components/CopyPath";
import { Markdown } from "@/components/Markdown";
import { ChevronLeftIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { readDoc } from "@/lib/docs";
import { HIDDEN_DOCS } from "@/lib/docsConfig";
import { findHeadingId, h2Outline } from "@/lib/headings";

export const dynamic = "force-dynamic";

// Server component: reads docs through the same allowlisted lib the /api/docs route uses.
// /guide → the "I want…" flow and career document; /guide/<path> → one rendered doc.
export default async function GuidePage({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path } = await params;
  if (!path?.length) redirect("/docs");

  const rel = path.map((s) => decodeURIComponent(s)).join("/");
  if (HIDDEN_DOCS[rel]) redirect(HIDDEN_DOCS[rel]);
  const markdown = await readDoc(rel);
  if (markdown === null) notFound();

  const outline = h2Outline(markdown);
  const crumbs = rel.split("/");
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_14rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <nav
          className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
          aria-label="Breadcrumb"
        >
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="-ml-2 text-primary"
          >
            <Link href="/docs">
              <ChevronLeftIcon data-icon="inline-start" />
              Docs
            </Link>
          </Button>
          {crumbs.slice(0, -1).map((c) => (
            <span key={c} className="flex items-center gap-1">
              <span aria-hidden>/</span>
              {c}
            </span>
          ))}
        </nav>
        <Card>
          <CardContent className="px-6 py-2 sm:px-10 sm:py-6">
            <article>
              <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="font-mono">
                  {rel}
                </Badge>
                <CopyPath path={rel} />
                <span>· read-only, edit in your editor</span>
              </div>
              <Markdown docPath={rel} className="md-reading">
                {markdown}
              </Markdown>
            </article>
          </CardContent>
        </Card>
      </div>

      {outline.length >= 3 ? (
        <aside className="hidden lg:block">
          <div className="sticky top-20 flex flex-col gap-2">
            <div className="px-2 text-sm font-medium text-muted-foreground">
              On this page
            </div>
            <ul className="flex flex-col gap-0.5 text-sm">
              {outline.map((h) => (
                <li key={h.id}>
                  <a
                    href={`#${h.id}`}
                    className="block truncate rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    title={h.text}
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
