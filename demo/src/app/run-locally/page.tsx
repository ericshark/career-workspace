import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/Markdown";
import { Commands } from "@demo/Commands";
import guide from "../../../generated/guide.json";

export const metadata: Metadata = { title: "Run locally · Career Workspace" };
const REPO = "https://github.com/ericshark/career-workspace";

// Every instruction here comes from README.md at build time (scripts/prepare.mjs).
export default function RunLocallyPage() {
  const sections = [
    ["Add your profile and resume", guide.profile],
    ["Connect AI (optional)", guide.ai],
    ["Log your first application", guide.firstJob],
  ];
  const links = (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm">
        <Link href="/">Back to the demo</Link>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={REPO} target="_blank" rel="noreferrer">
          View on GitHub
        </a>
      </Button>
    </div>
  );
  return (
    <article className="mx-auto max-w-3xl space-y-8 pb-12">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Run locally</h1>
        <p className="text-muted-foreground">
          The full app runs on your computer and starts with an empty workspace.
        </p>
        {links}
      </header>
      <section className="space-y-4" aria-labelledby="install">
        <h2 id="install" className="text-lg font-semibold">
          Install
        </h2>
        <Markdown className="md-reading" externalOnly>
          {guide.prerequisites}
        </Markdown>
        <Commands commands={guide.commands} />
        <Markdown className="md-reading" externalOnly>
          {guide.after}
        </Markdown>
      </section>
      {sections.map(([title, body]) => (
        <section key={title} className="space-y-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Markdown className="md-reading" externalOnly>
            {body}
          </Markdown>
        </section>
      ))}
      <footer className="border-t pt-5">{links}</footer>
    </article>
  );
}
