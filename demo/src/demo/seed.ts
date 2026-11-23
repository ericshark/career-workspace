// Writes the fictional workspace into memory, with every date relative to the visitor's today.
import fs from "node:fs";
import prompts from "../../generated/prompts.json";
import { localDate, localToday } from "@/lib/config";
import { rowKey } from "@/lib/applications";
import { formatJobBrief, type JobBrief } from "@/lib/jobBrief";
import { finishReview } from "@/lib/claude/score";
import { postingAge } from "@/lib/scoring/age";
import { makeSlug } from "@/lib/slug";
import { persistRun } from "@/lib/runs";
import { saveQuick } from "@/lib/reviews";
import { APPLICATIONS_HEADER, type ClaudeReviewOutput } from "@/lib/types";
import type { InboxAction } from "@/lib/actionTypes";
import type { RecruitingEvent } from "@/lib/recruitingTypes";
import { newDraft, type Item } from "@/lib/workshop/model";
import { reviewAnswer } from "./examples";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const day = (ago: number) =>
  localDate(new Date(`${localToday()}T12:00:00`), -ago);
const at = (ago: number, hour = 10) => {
  // Never in the future: "today" entries stay a few minutes in the past.
  const when = new Date();
  when.setDate(when.getDate() - ago);
  when.setHours(hour, 15, 0, 0);
  return new Date(
    ago >= 0 ? Math.min(when.getTime(), Date.now() - 300_000) : when.getTime(),
  ).toISOString();
};

// ago · company · role · location · status · source · [fit, match]
type Job = [number, string, string, string, string, string, number?, number?];
const JOBS: Job[] = [
  [
    0,
    "Tidewell Health",
    "Software Engineer I",
    "New York, NY (hybrid)",
    "applied",
    "LinkedIn",
  ],
  [
    0,
    "Copperleaf Robotics",
    "Backend Engineer",
    "Pittsburgh, PA (onsite)",
    "applied",
    "Simplify",
    81,
    76,
  ],
  [
    0,
    "Brightfen Energy",
    "Software Engineer, Data",
    "Remote, United States",
    "applied",
    "Built In NYC",
  ],
  [
    1,
    "Kitebridge Logistics",
    "API Engineer",
    "Chicago, IL (hybrid)",
    "applied",
    "Handshake",
    88,
    82,
  ],
  [
    1,
    "Maple & Main Books",
    "Full Stack Engineer",
    "Remote, United States",
    "applied",
    "Wellfound",
  ],
  [
    1,
    "Saltmarsh Maps",
    "Associate Software Engineer",
    "Portland, ME (hybrid)",
    "applied",
    "LinkedIn",
  ],
  [
    1,
    "Fernhollow Credit Union",
    "Software Developer",
    "Albany, NY (onsite)",
    "applied",
    "Indeed",
  ],
  [
    2,
    "Quillworks",
    "Product Engineer",
    "New York, NY (hybrid)",
    "in progress",
    "YC",
    79,
    71,
  ],
  [
    2,
    "Opal Transit",
    "Backend Developer",
    "Philadelphia, PA (hybrid)",
    "applied",
    "Simplify",
  ],
  [
    3,
    "Wrenfield Analytics",
    "Data Platform Engineer",
    "Boston, MA (hybrid)",
    "applied",
    "Jobright",
  ],
  [
    4,
    "Paperlantern Studio",
    "Frontend Engineer",
    "Remote, United States",
    "applied",
    "Wellfound",
  ],
  [
    4,
    "Juniper Street Clinics",
    "Integration Engineer",
    "Hartford, CT (hybrid)",
    "in progress",
    "LinkedIn",
  ],
  [
    5,
    "Northwharf Foods",
    "Software Engineer",
    "Seattle, WA (hybrid)",
    "rejected",
    "Indeed",
  ],
  [
    5,
    "Bellweather Parks",
    "Web Developer",
    "Denver, CO (remote)",
    "applied",
    "Other",
  ],
  [
    6,
    "Stonecup Coffee",
    "Junior Software Engineer",
    "Brooklyn, NY (onsite)",
    "applied",
    "Built In NYC",
  ],
  [
    7,
    "Candlewick Insurance",
    "Software Engineer I",
    "Hartford, CT (hybrid)",
    "applied",
    "Handshake",
  ],
  [
    8,
    "Bluegate Learning",
    "Platform Engineer",
    "Remote, United States",
    "in progress",
    "YC",
    86,
    78,
  ],
  [
    8,
    "Thistle & Pine",
    "Backend Engineer",
    "Austin, TX (hybrid)",
    "rejected",
    "LinkedIn",
  ],
  [
    9,
    "Marrowstone Labs",
    "Software Engineer, Tools",
    "San Diego, CA (hybrid)",
    "applied",
    "Simplify",
  ],
  [
    10,
    "Cedarline Housing",
    "Application Developer",
    "Newark, NJ (onsite)",
    "applied",
    "Indeed",
  ],
  [
    11,
    "Goldfinch Travel",
    "Full Stack Engineer",
    "Miami, FL (remote)",
    "applied",
    "HiringCafe",
  ],
  [
    12,
    "Pebblebrook Media",
    "Software Engineer",
    "Los Angeles, CA (hybrid)",
    "rejected",
    "LinkedIn",
  ],
  [
    13,
    "Rookery Security",
    "Python Developer",
    "Remote, United States",
    "unsuccessful",
    "RippleMatch",
  ],
  [
    14,
    "Windrow Agriculture",
    "Software Engineer I",
    "Des Moines, IA (hybrid)",
    "applied",
    "Handshake",
  ],
  [
    15,
    "Larkspur Payments",
    "API Engineer",
    "New York, NY (hybrid)",
    "applied",
    "Built In NYC",
  ],
  [
    16,
    "Driftwood Games",
    "Tools Engineer",
    "Remote, United States",
    "applied",
    "Other",
  ],
  [
    18,
    "Halcyon Freight",
    "Backend Engineer",
    "Memphis, TN (onsite)",
    "rejected",
    "Simplify",
  ],
  [
    20,
    "Mossgate Libraries",
    "Web Developer",
    "Columbus, OH (hybrid)",
    "applied",
    "Indeed",
  ],
  [
    22,
    "Silverbirch Legal",
    "Software Engineer",
    "Washington, DC (hybrid)",
    "applied",
    "LinkedIn",
  ],
  [
    25,
    "Emberline Fire",
    "Junior Developer",
    "Phoenix, AZ (onsite)",
    "no response",
    "Jobright",
  ],
  [
    29,
    "Foxglove Textiles",
    "Software Developer",
    "Charlotte, NC (hybrid)",
    "no response",
    "HiringCafe",
  ],
  [
    33,
    "Ironquay Shipping",
    "Software Engineer I",
    "Baltimore, MD (onsite)",
    "no response",
    "LinkedIn",
  ],
  [
    0,
    "Meadowlark Weather",
    "Software Engineer, APIs",
    "Boulder, CO (hybrid)",
    "to apply",
    "YC",
    83,
    74,
  ],
  [
    1,
    "Harvest Row Markets",
    "Backend Engineer",
    "Remote, United States",
    "to apply",
    "Simplify",
  ],
];

const CAREER = `# Career profile (fictional)

## Projects

Built a FastAPI service with PostgreSQL schemas and Alembic migrations.
Added OAuth2 login with refresh tokens.
Wrote automated tests with pytest and ran them in continuous integration.

## Skills

Python, TypeScript, React, SQL, and Docker for local development.
`;
const RESUME = String.raw`\begin{document}
\section{Projects}
\resumeItem{Built a FastAPI service backed by PostgreSQL}
\resumeItem{Wrote automated tests with pytest}
\section{Skills}
Python, TypeScript, React, Docker
\end{document}
`;

const DOCS: [string, string][] = [
  [
    "Interview checklist",
    `## Before\n\n- Read the job summary and your notes in **Tracker**\n- Pick two projects to talk through\n- Prepare three questions about the team\n\n## After\n\n- Send a short thank-you note the same day\n- Add any next step to **Actions**\n`,
  ],
  [
    "Stories to tell",
    `## A hard bug\n\nA sync job dropped records when two runs overlapped. I reproduced it with a test, added a lock, and documented the fix.\n\n## Working with a user\n\nA librarian showed me the shortcut they wished existed. I shipped it the next week.\n`,
  ],
  [
    "Questions for employers",
    `1. What does a good first three months look like?\n2. How do changes get reviewed and released?\n3. What is the team trying to fix this year?\n`,
  ],
];

function brief(company: string, role: string, location: string): JobBrief {
  return {
    overview: `${role} at ${company}, a fictional employer. Build, test and maintain software with a small product team.`,
    experience: "0 to 3 years",
    responsibilities: [
      "Build and maintain features",
      "Write automated tests",
      "Review changes with the team",
    ],
    qualifications: [
      "Required: Experience with a modern web language",
      "Preferred: SQL and cloud basics",
    ],
    location,
    compensation: "$95,000 to $125,000",
  };
}

export const REVIEW_MODEL = "gpt-6.1-terra"; // the app's default review model
const ROOT = "/workspace";
const write = (path: string, data: unknown) =>
  fs.writeFileSync(
    ROOT + path,
    typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n",
  );

function workshop() {
  const category = { id: uuid(900), name: "Web apps" };
  const tools = { id: uuid(901), name: "Developer tools" };
  let step = 1000;
  const steps = (list: [string, boolean][]) =>
    list.map(([title, done]) => ({ id: uuid(++step), title, done }));
  const item = (
    id: number,
    kind: Item["kind"],
    title: string,
    patch: Partial<Item>,
  ): Item => ({
    ...newDraft(kind, title),
    id: uuid(id),
    kind,
    archived: false,
    pinned: false,
    docs: [],
    ...patch,
  });
  const items = [
    item(910, "project", "Trail Conditions", {
      description:
        "A map where hikers report mud, snow and closures on local trails.",
      categoryId: category.id,
      pinned: true,
      checklist: steps([
        ["Draw the trail map", true],
        ["Add the report form", true],
        ["Show reports by date", false],
        ["Test on a phone", false],
      ]),
      docs: [
        {
          id: uuid(950),
          title: "Spec",
          body: "# Trail Conditions\n\nHikers can see the latest report for each trail and add their own in under a minute.",
        },
      ],
    }),
    item(911, "project", "Log Lantern", {
      description:
        "A command-line tool that groups noisy log lines into readable events.",
      categoryId: tools.id,
      checklist: steps([
        ["Parse three log formats", true],
        ["Group repeated events", false],
        ["Write the README", false],
      ]),
    }),
    item(912, "project", "Seed Swap", {
      description: "A finished exchange board for neighborhood gardeners.",
      categoryId: category.id,
      status: "Built",
      checklist: steps([
        ["Build listings", true],
        ["Add search", true],
        ["Deploy", true],
      ]),
    }),
    item(913, "idea", "Bus Stop Shade", {
      description: "Find which bus stops have shade at a given hour.",
      categoryId: category.id,
      ideaRating: 8,
    }),
    item(914, "idea", "Changelog Reader", {
      description:
        "Summarize what changed between two versions of a dependency.",
      categoryId: tools.id,
      ideaRating: 7,
    }),
    item(915, "idea", "Recipe Scaler", {
      description: "Scale recipes and round to measurements people own.",
      categoryId: category.id,
      ideaRating: 6,
    }),
  ];
  return {
    version: 4,
    categories: [category, tools],
    items,
    orders: {
      idea: [uuid(913), uuid(914), uuid(915)],
      project: [uuid(910), uuid(911), uuid(912)],
      current: [uuid(910)],
      next: [uuid(911), uuid(913)],
    },
  };
}

export function seed() {
  for (const dir of [
    "/records/reviews",
    "/records/opportunities",
    "/profile",
    "/prompts",
    "/ui/.cache/runs",
    "/ui/.workshop",
    "/source/tech",
    "/source/general",
    "/source/datacenter",
    "/.documents",
  ])
    fs.mkdirSync(ROOT + dir, { recursive: true });
  for (const [path, text] of Object.entries(prompts)) write(`/${path}`, text);
  write("/profile/career.md", CAREER);
  for (const resume of ["tech", "general", "datacenter"])
    write(`/source/${resume}/resume.tex`, RESUME);

  const rows = JOBS.map(
    ([ago, company, role, location, status, source, fit, match], i) => {
      const id = uuid(i + 1);
      const link = `https://example.com/jobs/${makeSlug(company, role)}`;
      return {
        id,
        ago,
        date: day(ago),
        company,
        role,
        location,
        status,
        source,
        fit,
        match,
        link,
        key: rowKey({ date: day(ago), company, role, link }),
      };
    },
  );
  const cells = rows.map(
    (r) =>
      `| ${[r.date, r.company, r.role, "tech", "tech", r.fit ?? "", r.match ?? "", r.source, r.status, "", r.link, r.id].join(" | ")} |`,
  );
  write(
    "/records/applications.md",
    `# Applications\n\n${APPLICATIONS_HEADER}\n|${"---|".repeat(12)}\n${cells.join("\n")}\n`,
  );

  for (const r of rows) {
    const decision =
      r.status === "to apply" ? ("later" as const) : ("applied" as const);
    if (r.fit && r.match) {
      const { jobBrief, ...answer } = reviewAnswer(
        r.company,
        r.role,
        r.location,
        r.fit,
        r.match,
      );
      const analysis: ClaudeReviewOutput = {
        ...answer,
        suggestedSlug: makeSlug(r.company, r.role),
      };
      const post = `${formatJobBrief(r.company, r.role, jobBrief)}\n\nKeywords: ${answer.keywords.join(", ")}`;
      const request = {
        jobPost: post,
        jobBrief,
        postFormat: "brief" as const,
        originalJobPost: post,
        resume: "tech" as const,
        link: r.link,
        source: r.source,
      };
      const result = finishReview(
        structuredClone(analysis),
        request,
        r.date,
        { model: REVIEW_MODEL, durationMs: 1000, metrics: {} },
        r.id,
      );
      result.source = r.source;
      result.duplicates = { exact: [], possible: [] };
      persistRun({
        version: 2,
        viewedAt: at(r.ago, 11),
        request,
        analysis,
        result,
        savedAt: at(r.ago, 11),
        decision,
      });
    } else {
      const jobBrief = brief(r.company, r.role, r.location);
      const post = formatJobBrief(r.company, r.role, jobBrief);
      saveQuick({
        version: 2,
        kind: "quick",
        id: r.id,
        savedAt: at(r.ago, 11),
        reviewedAt: r.date,
        request: { jobPost: post, jobBrief, link: r.link, source: r.source },
        postFormat: "brief",
        extract: {
          company: r.company,
          role: r.role,
          location: r.location,
          workMode: /remote/i.test(r.location) ? "remote" : "hybrid",
          level: "entry",
          postedText: "",
          postedDate: "",
          jobId: "",
          suggestedResume: "tech",
        },
        age: postingAge("", "", post, r.date, null),
        decision,
        resume: "tech",
        slug: makeSlug(r.company, r.role),
      });
    }
  }

  const row = (company: string) => rows.find((r) => r.company === company)!;
  let n = 500;
  const action = (
    company: string,
    received: number,
    text: string,
    patch: Partial<InboxAction>,
  ): InboxAction => {
    const r = row(company);
    const id = uuid(++n);
    return {
      id,
      externalKeys: [`demo:${id}`],
      revision: 1,
      text,
      company: r.company,
      role: r.role,
      application: { rowKey: r.key, recordId: r.id },
      applicationConfirmed: true,
      state: "open",
      createdAt: at(received, 9),
      updatedAt: at(received, 9),
      ...patch,
    };
  };
  const due = (inDays: number, wording: string) => ({
    kind: "requested" as const,
    date: day(-inDays),
    wording,
  });
  const actions = [
    action("Quillworks", 1, "Complete the take-home exercise", {
      category: "assessment",
      requestKind: "submission",
      deadline: due(2, "Submit within three days"),
      explanation: "Build a small reading-list API. About two hours.",
      effort: "About 2 hours",
      priority: "high",
    }),
    action("Juniper Street Clinics", 0, "Choose a time for a phone screen", {
      category: "schedule",
      requestKind: "scheduling",
      responseExpected: true,
      deadline: due(1, "Reply by tomorrow"),
      explanation: "The recruiter offered three times this week.",
      priority: "high",
    }),
    action("Bluegate Learning", 2, "Send two references", {
      category: "reply",
      requestKind: "administrative",
      responseExpected: true,
      deadline: due(5, "By the end of the week"),
      priority: "medium",
    }),
    action("Kitebridge Logistics", 0, "Verify your candidate account", {
      category: "verify",
      requestKind: "administrative",
      priority: "low",
    }),
    action("Rookery Security", 9, "Complete the coding assessment", {
      category: "assessment",
      state: "completed",
      completedAt: at(7, 16),
      updatedAt: at(7, 16),
    }),
  ];
  write("/records/actions.json", {
    version: 1,
    importedNext: true,
    lastCheck: {
      runId: "demo-check",
      startedAt: at(0, 7),
      completedAt: at(0, 8),
      changes: [],
    },
    dismissed: [],
    actions,
  });

  const event = (
    company: string,
    kind: RecruitingEvent["kind"],
    ago: number,
    title: string,
    patch: Partial<RecruitingEvent> = {},
  ): RecruitingEvent => ({
    id: `demo-event-${++n}`,
    applicationKey: row(company).key,
    recordId: row(company).id,
    kind,
    at: at(ago, 9),
    title,
    description: "",
    notify: true,
    seen: false,
    discoveredAt: at(ago, 10),
    ...patch,
  });
  write("/records/recruiting.json", {
    version: 1,
    startedAt: at(40),
    events: [
      event("Quillworks", "requested", 1, "Take-home exercise requested", {
        taskId: actions[0].id,
      }),
      event(
        "Juniper Street Clinics",
        "requested",
        0,
        "Phone screen requested",
        { taskId: actions[1].id },
      ),
      event(
        "Bluegate Learning",
        "interview",
        1,
        "Technical interview scheduled",
        {
          description: "45 minutes with two engineers.",
          scheduledAt: at(-3, 14),
          scheduledEndAt: at(-3, 15),
          appointment: { id: "demo-interview", sequence: 0 },
        },
      ),
      event("Northwharf Foods", "rejected", 1, "Application closed"),
      event(
        "Rookery Security",
        "rejected",
        3,
        "Not moving forward after the assessment",
        { wasInProgress: true, seen: true, notify: false },
      ),
    ],
    workflows: [],
    pending: [],
  });
  write("/records/mail-sync.json", {
    version: 1,
    lastCareerCheck: {
      runId: "demo-check",
      startedAt: at(0, 7),
      completedAt: at(0, 8),
      summary: { newActions: 2, newUpdates: 2, newRejections: 1 },
    },
    discoveries: [],
    interactions: {},
  });
  write("/ui/.workshop/snapshot.json", workshop());
  DOCS.forEach(([title, content], i) => {
    const id = uuid(700 + i);
    fs.mkdirSync(`${ROOT}/.documents/${id}`);
    write(`/.documents/${id}/doc.json`, {
      id,
      title,
      kind: "note",
      content,
      updatedAt: at(i + 1),
    });
  });
}
