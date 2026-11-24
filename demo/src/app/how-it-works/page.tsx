import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRightIcon,
  ClipboardListIcon,
  FolderKanbanIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  ListChecksIcon,
  SendIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "How it works · Career Workspace",
};

const sections = [
  {
    title: "Dashboard",
    href: "/",
    icon: LayoutDashboardIcon,
    description:
      "See application counts, progress toward your goals, recent recruiting updates, and upcoming deadlines. These reflect the jobs and actions in your local workspace.",
  },
  {
    title: "Actions",
    href: "/actions",
    icon: ListChecksIcon,
    description:
      "Keep interviews, assessments, and follow-ups with their due dates and related jobs. Add an action yourself, or run Career Check in your agent to look for recruiting updates in Gmail. Start with Career Check Dry Run to see proposed changes. The checks read Gmail and write accepted updates to your local workspace.",
  },
  {
    title: "Apply",
    href: "/apply",
    icon: SendIcon,
    description:
      "Use the job description and your own career evidence to decide what to do next. In the local app, job analysis and drafting use your connected AI provider.",
    items: [
      [
        "Quick add",
        "Paste descriptions and optional links to log jobs you have already applied to. The app extracts the job details and saves them to Tracker.",
      ],
      [
        "Review",
        "Compare a posting with your career profile and master resume for Fit, Resume Match, gaps, and a resume recommendation. Tailor can build a separate job-specific copy.",
      ],
      [
        "Questions",
        "Draft application answers and cover letters using the job context and supported facts from your career profile or resume.",
      ],
    ],
  },
  {
    title: "Tracker",
    href: "/tracker",
    icon: ClipboardListIcon,
    description:
      "Search, filter, and sort your applications. Change a status or open a job to see its details, review, and timeline.",
  },
  {
    title: "Workshop",
    href: "/workshop",
    icon: FolderKanbanIcon,
    description:
      "Capture ideas, turn them into projects, and keep their tasks, notes, and links together. In the local app, a linked project folder also lets you inspect Git and run its development server.",
  },
  {
    title: "Docs",
    href: "/docs",
    icon: LibraryIcon,
    description:
      "Create Markdown notes or import text files and PDFs. Search by title, edit text notes, and open or download PDFs. The local library stays on your computer.",
  },
];

export default function HowItWorksPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-7 pb-12">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">How it works</h1>
        <p className="text-muted-foreground">
          Follow a job from review to follow-up, then try each screen in the
          demo with fictional data and prepared AI results.
        </p>
        <Button asChild size="sm">
          <Link href="/setup">How to set it up</Link>
        </Button>
      </header>
      <div className="divide-y rounded-lg border bg-card">
        {sections.map(({ title, href, icon: Icon, description, items }) => (
          <section
            key={title}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 p-4 sm:p-5"
          >
            <Icon className="mt-1 size-4 text-muted-foreground" aria-hidden />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">
                <Link
                  href={href}
                  className="inline-flex items-center gap-1.5 hover:underline"
                >
                  {title}
                  <ArrowUpRightIcon
                    className="size-3.5 text-muted-foreground"
                    aria-hidden
                  />
                </Link>
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {description}
              </p>
              {items && (
                <dl className="space-y-2 border-l pl-3 text-sm">
                  {items.map(([name, detail]) => (
                    <div key={name}>
                      <dt className="font-medium">{name}</dt>
                      <dd className="leading-relaxed text-muted-foreground">
                        {detail}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
