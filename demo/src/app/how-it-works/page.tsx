import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowDownIcon,
  ArrowUpRightIcon,
  BotIcon,
  ClipboardListIcon,
  FolderKanbanIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  ListChecksIcon,
  MonitorIcon,
  SendIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "How it works · Career Workspace",
};

const screens = [
  {
    title: "Dashboard",
    href: "/",
    icon: LayoutDashboardIcon,
    items: [
      [
        "Progress",
        "See application counts, goals, and how jobs move through stages.",
      ],
      [
        "Updates & actions",
        "Catch recent recruiting activity and open follow-ups. Upcoming shows interviews and deadlines.",
      ],
    ],
  },
  {
    title: "Actions",
    href: "/actions",
    icon: ListChecksIcon,
    items: [
      [
        "Work to do",
        "Add interviews, assessments, and follow-ups yourself, or bring them in with Career Check.",
      ],
      [
        "Review and resolve",
        "Open the linked job for context, mark a task complete, or dismiss it. Review requests with uncertain job matches before linking them.",
      ],
    ],
  },
  {
    title: "Apply",
    href: "/apply",
    icon: SendIcon,
    usesAI: true,
    items: [
      [
        "Quick add",
        "Paste job descriptions and optional links to log jobs you already applied to. The app extracts the details and saves them to Tracker.",
      ],
      [
        "Review",
        "Compare a posting with your career profile and master resume for Fit, Resume Match, gaps, and a recommendation.",
      ],
      [
        "Questions",
        "Draft application answers and cover letters from the job context and your career evidence.",
      ],
      [
        "Tailor",
        "Build and validate a separate resume for a reviewed role. Use the agent’s Tailor Resume skill if you want to work from chat.",
      ],
    ],
  },
  {
    title: "Tracker",
    href: "/tracker",
    icon: ClipboardListIcon,
    items: [
      [
        "Applications",
        "Search, filter, or change a job’s status. Open it to see its details, saved review, and recruiting timeline.",
      ],
    ],
  },
  {
    title: "Workshop",
    href: "/workshop",
    icon: FolderKanbanIcon,
    items: [
      [
        "Ideas and projects",
        "Turn ideas into projects and keep tasks, notes, and links together.",
      ],
      [
        "Development",
        "Link a local project folder to see Git status and run its development server.",
      ],
    ],
  },
  {
    title: "Docs",
    href: "/docs",
    icon: LibraryIcon,
    items: [
      [
        "Local library",
        "Write Markdown notes or import text and PDFs. Search by title, edit notes, or open and download PDFs.",
      ],
    ],
  },
];

const skills = [
  [
    "Career Workspace Setup",
    "Install and open the local app, or pick up where you left off. Your agent can draft a career profile from your resume and guide you through connections and a launch shortcut.",
    "Run Career Workspace Setup.",
  ],
  [
    "Career Check",
    "Read recruiting Gmail, match messages to applications, and coordinate local status updates and follow-up tasks. Use Career Check Quick for recent activity without changing tracker statuses.",
    "Run Career Check Dry Run.",
  ],
  [
    "Opportunity Check",
    "Start with a recruiter email. The agent checks your application history and public sources, then summarizes the request, employer, compensation clues, and whether it’s worth pursuing.",
    "Run Opportunity Check for the recruiter’s email about this role.",
  ],
  [
    "Tailor Resume",
    "Use a saved job, your career profile, and your master resume to make a separate job-specific PDF. The agent validates the build and shows what changed, along with Resume Match before and after.",
    "Tailor my resume for the saved Backend Engineer job.",
  ],
  [
    "ATS Check",
    "Check whether a resume’s text can be extracted in the expected reading order. The same check runs automatically when you build a resume.",
    "Run ATS Check on my master resume.",
  ],
];

export default function HowItWorksPage() {
  return (
    <article className="mx-auto max-w-5xl space-y-10 pb-12">
      <header className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">How it works</h1>
        <p className="max-w-prose text-muted-foreground">
          Track your job search in the local app and run bundled skills from
          Codex or Claude Code. The demo uses fictional data and prepared AI
          results.
        </p>
        <nav
          aria-label="On this page"
          className="flex flex-wrap items-center gap-2"
        >
          <Button asChild size="sm" variant="outline">
            <a href="#in-the-app" className="text-sky-800 dark:text-sky-300">
              <MonitorIcon /> In the app <ArrowDownIcon />
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a
              href="#in-your-agent"
              className="text-violet-800 dark:text-violet-300"
            >
              <BotIcon /> In your agent <ArrowDownIcon />
            </a>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/setup">How to set it up</Link>
          </Button>
        </nav>
      </header>

      <section
        id="in-the-app"
        aria-labelledby="app-heading"
        className="scroll-mt-24 space-y-4"
      >
        <header className="rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/50">
          <h2
            id="app-heading"
            className="flex items-center gap-2 text-lg font-semibold text-sky-800 dark:text-sky-300"
          >
            <MonitorIcon className="size-5" aria-hidden /> In the app
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your AI provider in{" "}
            <strong className="text-foreground">Apply → Models</strong> for AI
            features. Dashboard, Actions, Tracker, Workshop, and Docs are
            available without an AI connection.
          </p>
        </header>
        <div className="grid gap-3 md:grid-cols-2">
          {screens.map(({ title, href, icon: Icon, items, usesAI }) => (
            <section
              key={title}
              className={`min-w-0 space-y-2 rounded-lg border bg-card p-4 ${usesAI ? "md:col-span-2" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="text-base font-semibold">
                  <Link
                    href={href}
                    className="inline-flex items-center gap-2 hover:underline"
                  >
                    <Icon
                      className="size-4 text-sky-700 dark:text-sky-300"
                      aria-hidden
                    />
                    {title}
                    <ArrowUpRightIcon
                      className="size-3.5 text-muted-foreground"
                      aria-hidden
                    />
                  </Link>
                </h3>
                {usesAI && (
                  <span className="rounded-md bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900 dark:bg-sky-950 dark:text-sky-200">
                    Uses your AI connection
                  </span>
                )}
              </div>
              <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-sky-600 dark:marker:text-sky-400">
                {items.map(([label, detail]) => (
                  <li key={label}>
                    <strong className="font-medium text-foreground">
                      {label}.
                    </strong>{" "}
                    {detail}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <section
        id="in-your-agent"
        aria-labelledby="agent-heading"
        className="scroll-mt-24 space-y-4"
      >
        <header className="rounded-lg border border-violet-200 bg-violet-50 p-4 dark:border-violet-900 dark:bg-violet-950/50">
          <h2
            id="agent-heading"
            className="flex items-center gap-2 text-lg font-semibold text-violet-800 dark:text-violet-300"
          >
            <BotIcon className="size-5" aria-hidden /> In your agent
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open the local workspace folder in Codex or Claude Code and ask for
            a skill by name. Skills run in your agent and use its account and
            connections.
          </p>
        </header>

        <section
          aria-labelledby="mail-heading"
          className="space-y-3 rounded-lg border border-violet-200 bg-card p-4 dark:border-violet-900"
        >
          <h3 id="mail-heading" className="font-semibold">
            From recruiting email to an action
          </h3>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground marker:font-semibold marker:text-violet-700 dark:marker:text-violet-300">
            <li>
              Connect Gmail in your agent. See{" "}
              <Link
                href="/setup"
                className="text-foreground underline underline-offset-2"
              >
                setup instructions
              </Link>{" "}
              under <strong className="text-foreground">Set up manually</strong>
              .
            </li>
            <li>
              Ask for{" "}
              <strong className="text-foreground">Career Check Dry Run</strong>{" "}
              to preview application updates and tasks without saving them.
            </li>
            <li>
              Run <strong className="text-foreground">Career Check</strong> to
              save the results locally. Gmail stays read-only in every mode.
            </li>
          </ol>
          <p className="border-l-2 border-violet-300 pl-3 text-sm leading-relaxed text-muted-foreground dark:border-violet-700">
            An interview email can show up as a Dashboard update, create a
            scheduling task in Actions, and add context to the linked
            application’s timeline.
          </p>
        </section>

        <h3 className="font-semibold">Bundled skills</h3>
        <ul className="grid gap-3 md:grid-cols-2">
          {skills.map(([name, detail, example]) => (
            <li
              key={name}
              className="min-w-0 space-y-1 rounded-lg border bg-card p-4"
            >
              <h4 className="font-medium">{name}</h4>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {detail}
              </p>
              <p className="text-sm font-medium text-violet-800 dark:text-violet-300">
                “{example}”
              </p>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
