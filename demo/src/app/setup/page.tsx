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
const STEPS: { id: string; title: string; body: React.ReactNode }[] = [
  {
    id: "install",
    title: "Install what you need",
    body: <Guide text={guide.prerequisites} />,
  },
  {
    id: "run",
    title: "Download, set up and run",
    body: (
      <>
        <Commands commands={guide.commands} />
        <Guide text={guide.after} />
      </>
    ),
  },
  {
    id: "profile",
    title: "Add your profile and resume",
    body: <Guide text={guide.profile} />,
  },
  {
    id: "resume-tools",
    title: "Install resume tools (optional)",
    body: <Guide text={guide.tools} />,
  },
  {
    id: "ai",
    title: "Connect your AI (optional)",
    body: <Guide text={guide.ai} />,
  },
  {
    id: "email",
    title: "Connect your email (optional)",
    body: <Guide text={guide.gmail} />,
  },
  {
    id: "first-application",
    title: "Log your first application",
    body: <Guide text={guide.firstJob} />,
  },
  {
    id: "backups",
    title: "Know where your data lives",
    body: <Guide text={guide.backups} />,
  },
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
          The full app runs on your computer and starts with an empty workspace.
          Steps 1 and 2 are enough to use Tracker, Actions, Workshop and Docs.
        </p>
        {links}
      </header>
      <nav aria-label="Setup steps" className="rounded-xl border bg-card p-4">
        <ol className="grid list-inside list-decimal gap-1.5 text-sm sm:grid-cols-2">
          {STEPS.map((step) => (
            <li key={step.id}>
              <a href={`#${step.id}`} className="hover:underline">
                {step.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {STEPS.map((step, i) => (
        <section
          key={step.id}
          id={step.id}
          className="scroll-mt-16 space-y-4 border-t pt-6"
        >
          <h2 className="text-lg font-semibold">
            {i + 1}. {step.title}
          </h2>
          {step.body}
        </section>
      ))}
      <section className="space-y-4 border-t pt-6">
        <h2 className="text-lg font-semibold">If something goes wrong</h2>
        <Guide text={guide.help} />
      </section>
      <footer className="border-t pt-5">{links}</footer>
    </article>
  );
}
