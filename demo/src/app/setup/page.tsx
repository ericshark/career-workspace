import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Commands, Guide } from "@demo/Commands";
import guide from "../../../generated/guide.json";

export const metadata: Metadata = {
  title: "How to set it up · Career Workspace",
};
const REPO = "https://github.com/ericshark/career-workspace";

// The instructions come from README.md at build time (scripts/prepare.mjs).
const STEPS: [string, React.ReactNode][] = [
  ["1. Check what you need", <Guide key="need" text={guide.need} />],
  [
    "2. Run one command",
    <div key="run" className="space-y-4">
      <Commands commands={guide.commands} />
      <Guide text={guide.after} />
    </div>,
  ],
  ["3. Finish up", <Guide key="finish" text={guide.finish} />],
  ["What setup does", <Guide key="does" text={guide.does} />],
  ["What it uses", <Guide key="uses" text={guide.uses} />],
];

export default function SetupPage() {
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
        <h1 className="text-2xl font-semibold tracking-tight">
          How to set it up
        </h1>
        <p className="text-muted-foreground">
          One command sets up the full app on your computer, with an empty
          workspace. Your data stays there.
        </p>
        {links}
      </header>
      {STEPS.map(([title, body]) => (
        <section key={title} className="space-y-4 border-t pt-6">
          <h2 className="text-lg font-semibold">{title}</h2>
          {body}
        </section>
      ))}
      <footer className="space-y-4 border-t pt-6">
        <p className="text-sm text-muted-foreground">
          Prefer to do it by hand, or stuck? See{" "}
          <a
            className="underline"
            href={`${REPO}#manual-setup`}
            target="_blank"
            rel="noreferrer"
          >
            Manual setup
          </a>{" "}
          and{" "}
          <a
            className="underline"
            href={`${REPO}#troubleshooting`}
            target="_blank"
            rel="noreferrer"
          >
            Troubleshooting
          </a>{" "}
          on GitHub.
        </p>
        {links}
      </footer>
    </article>
  );
}
