import { seedResumes, removeTestRoot } from "./seedResumes";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildQuickBatchPrompt,
  fixtureQuickBatch,
  jobLink,
  pickSource,
  type QuickUndoRecord,
} from "@/lib/quick";
import type { QuickJob } from "@/lib/types";

const desc = (title: string, extra = "") =>
  `${title}\nBuild and run services for customers every day. ${extra}`.trim();

describe("buildQuickBatchPrompt", () => {
  it("puts each job in its own numbered, titled block separated by a blank line", () => {
    const prompt = buildQuickBatchPrompt([
      {
        link: "https://www.linkedin.com/jobs/view/1",
        description: "Globex — Backend Engineer",
      },
      { description: "Initech — Support Engineer" },
    ]);
    expect(prompt).toContain(
      '<job number="1">\nJob 1\nURL: https://www.linkedin.com/jobs/view/1\nDescription:\nGlobex — Backend Engineer\n</job>\n\n<job number="2">\nJob 2\nURL: none\nDescription:\nInitech — Support Engineer\n</job>',
    );
    expect(prompt).toMatch(/exactly one entry per\s+block/);
    expect(prompt).toContain("untrusted data");
  });
});

describe("jobLink", () => {
  it("prefers the entered URL, then a model link found in the description, then its first posting URL", () => {
    const text = "Apply at https://x.test/jobs/1. Also https://x.test/jobs/2";
    expect(
      jobLink(" https://entered.test/1 ", "https://x.test/jobs/2", text),
    ).toBe("https://entered.test/1");
    expect(jobLink("", "https://x.test/jobs/2", text)).toBe(
      "https://x.test/jobs/2",
    );
    // A made-up model URL is never used; trailing punctuation is dropped.
    expect(jobLink("", "https://made.up/1", text)).toBe(
      "https://x.test/jobs/1",
    );
    expect(jobLink("", "", "no url here")).toBe("");
  });

  it("never uses footer links such as an EEO notice as the posting link", () => {
    const eeo =
      "http://www.acme.com/resources/equal-employment-opportunity-is-the-law";
    const text = `Fullstack Developer at Acme Corp. See ${eeo} for details.`;
    expect(jobLink("", eeo, text)).toBe("");
    expect(jobLink("", "", text)).toBe("");
    // The posting URL still wins when the footer link comes first.
    expect(
      jobLink(
        "",
        "",
        `${text} Apply: https://boards.greenhouse.io/acme/jobs/42`,
      ),
    ).toBe("https://boards.greenhouse.io/acme/jobs/42");
  });
});

describe("pickSource", () => {
  it("prefers the link's board, then the board the text named, then Other", () => {
    expect(pickSource("https://www.linkedin.com/jobs/view/1", "Indeed")).toBe(
      "LinkedIn",
    );
    expect(pickSource("https://boards.greenhouse.io/x/jobs/1", "Indeed")).toBe(
      "Indeed",
    );
    expect(pickSource("", "")).toBe("Other");
  });
});

describe("fixtureQuickBatch", () => {
  it("reads one job per entered card, numbered in order", () => {
    const jobs = fixtureQuickBatch([
      { description: "Globex — Backend Engineer\nPython." },
      {
        description:
          "Initech — Support Engineer\nhttps://www.indeed.com/viewjob?jk=9",
      },
    ]);
    expect(jobs.map((j) => [j.job, j.company])).toEqual([
      [1, "Globex"],
      [2, "Initech"],
    ]);
    expect(jobs[1].link).toBe("https://www.indeed.com/viewjob?jk=9");
  });
});

// Temp CAREER_ROOT with one applied Acme row; modules are imported fresh per test.
let root: string;
let file: string;
async function setup() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "quick-batch-"));
  seedResumes(root);
  file = path.join(root, "records/applications.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(
    path.join(import.meta.dirname, "fixtures", "applications.one-row.md"),
    file,
  );
  process.env.CAREER_ROOT = root;
  vi.resetModules();
  const apps = await import("@/lib/applications");
  fs.writeFileSync(file, apps.migrateV2ToV3(fs.readFileSync(file, "utf8")));
  return {
    quick: await import("@/lib/quick"),
    apps,
    undo: await import("@/lib/undo"),
  };
}
afterEach(() => {
  delete process.env.CAREER_ROOT;
  if (root) removeTestRoot(root);
});

const job = (o: Partial<QuickJob>): QuickJob => ({
  company: "Globex",
  role: "Backend Engineer",
  location: "NYC",
  workMode: "hybrid",
  level: "",
  postedText: "",
  postedDate: "",
  jobId: "",
  job: 1,
  link: "",
  source: "Other",
  jobBrief: {
    overview: "Build and maintain backend software for the engineering team.",
    experience: "",
    responsibilities: ["Build backend services"],
    qualifications: ["Software engineering experience"],
    location: "NYC",
    compensation: "",
  },
  ...o,
});
const today = "2026-10-13";

describe("quickAddBatch", () => {
  it("logs every job as applied with the tech resume; Undo removes them all", async () => {
    const { quick, apps, undo } = await setup();
    const before = fs.readFileSync(file, "utf8");
    const records: QuickUndoRecord[] = [];
    const out = await quick.quickAddBatch(
      [
        job({ job: 1, source: "Indeed" }),
        job({
          job: 2,
          company: "Initech",
          role: "Support Engineer",
          source: "Indeed",
        }),
      ],
      {
        jobs: [
          {
            link: "https://www.linkedin.com/jobs/view/123",
            description: desc("Globex — Backend Engineer"),
          },
          { description: desc("Initech — Support Engineer", "Via Indeed.") },
        ],
      },
      today,
      (r) => {
        records.push(r);
        return undo.saveUndo(r);
      },
    );
    expect(out.error).toBeUndefined();
    expect(out.skipped).toEqual([]);
    expect(out.remaining).toEqual([]);
    expect(
      out.added.map((a) => [a.job, a.company, a.source, a.action]),
    ).toEqual([
      [1, "Globex", "Other", "inserted"],
      [2, "Initech", "Other", "inserted"],
    ]);
    const { rows } = await apps.readApplications();
    const globex = rows.find((r) => r.company === "Globex")!;
    const initech = rows.find((r) => r.company === "Initech")!;
    expect(globex).toMatchObject({
      status: "applied",
      date: today,
      resume: "tech",
      lane: "tech",
      fit: "",
      match: "",
      link: "https://www.linkedin.com/jobs/view/123",
    });
    expect(initech.link).toBe("");
    // Each quick record keeps only its own compact brief.
    const saved = JSON.parse(
      fs.readFileSync(
        path.join(root, "records/reviews", `${records[1].quickSlug}.json`),
        "utf8",
      ),
    );
    expect(saved.request.jobPost).toContain("# Initech — Support Engineer");
    expect(saved.request.jobPost).not.toContain("Via Indeed.");
    expect(saved.postFormat).toBe("brief");
    const rendered = fs.readFileSync(
      path.join(root, "records/reviews", `${records[1].quickSlug}.md`),
      "utf8",
    );
    expect(rendered).toContain("Job description summary");
    expect(rendered).not.toContain("Via Indeed.");

    const done = await undo.undoMany(out.added.map((a) => a.undoId));
    expect(done).toEqual({ undone: 2, failed: 0 });
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("the entered URL beats a URL in the description; else the description's URL is used", async () => {
    const { quick, apps, undo } = await setup();
    const out = await quick.quickAddBatch(
      [
        job({ job: 1, link: "https://www.linkedin.com/jobs/view/999" }),
        job({ job: 2, company: "Initech", role: "Support Engineer" }),
      ],
      {
        jobs: [
          {
            link: "https://jobright.ai/jobs/info/222",
            description: desc(
              "Globex — Backend Engineer",
              "https://www.linkedin.com/jobs/view/999",
            ),
          },
          {
            description: desc(
              "Initech — Support Engineer",
              "Apply: https://app.ripplematch.com/v2/public/job/333",
            ),
          },
        ],
      },
      today,
      undo.saveUndo,
    );
    expect(out.added.map((a) => [a.company, a.source])).toEqual([
      ["Globex", "Other"],
      ["Initech", "Other"],
    ]);
    const { rows } = await apps.readApplications();
    expect(rows.find((r) => r.company === "Globex")?.link).toBe(
      "https://jobright.ai/jobs/info/222",
    );
    expect(rows.find((r) => r.company === "Initech")?.link).toBe(
      "https://app.ripplematch.com/v2/public/job/333",
    );
  });

  it("a job Claude didn't return stays in the list; the others are still logged", async () => {
    const { quick, undo } = await setup();
    const out = await quick.quickAddBatch(
      [
        job({ job: 1 }),
        job({ job: 3, company: "Hooli", role: "Platform Engineer" }),
        job({ job: 3, company: "Ignored", role: "Duplicate number" }),
      ],
      {
        jobs: [
          { description: desc("Globex — Backend Engineer") },
          { description: desc("Initech — Support Engineer") },
          { description: desc("Hooli — Platform Engineer") },
        ],
      },
      today,
      undo.saveUndo,
    );
    expect(out.added.map((a) => [a.job, a.company])).toEqual([
      [1, "Globex"],
      [3, "Hooli"],
    ]);
    expect(out.skipped).toEqual([
      expect.objectContaining({
        job: 2,
        reason: expect.stringMatching(/still in your list/),
      }),
    ]);
    expect(out.remaining).toEqual([2]);
  });

  it("a source picked for the batch overrides every job's detected source", async () => {
    const { quick, apps, undo } = await setup();
    const out = await quick.quickAddBatch(
      [
        job({ job: 1, source: "Indeed" }),
        job({ job: 2, company: "Initech", role: "Support Engineer" }),
      ],
      {
        jobs: [
          {
            link: "https://boards.greenhouse.io/globex/jobs/1",
            description: desc("Globex — Backend Engineer"),
          },
          {
            link: "https://www.linkedin.com/jobs/view/2",
            description: desc("Initech — Support Engineer"),
          },
        ],
        source: "Simplify",
      },
      today,
      undo.saveUndo,
    );
    expect(out.added.map((a) => a.source)).toEqual(["Simplify", "Simplify"]);
    const { rows } = await apps.readApplications();
    expect(rows.filter((r) => r.source === "Simplify")).toHaveLength(2);
  });

  it("logs every pasted job and warns about already-applied jobs and repeats", async () => {
    const { quick, undo } = await setup();
    const out = await quick.quickAddBatch(
      [
        job({ job: 1, company: "Acme", role: "Software Engineer" }), // same title as the applied row
        job({ job: 2, company: "Acme Corp" }), // same link as the applied row
        job({ job: 3 }),
        job({ job: 4, role: "Backend  engineer" }), // repeat of job 3
      ],
      {
        jobs: [
          { description: desc("Acme — Software Engineer") },
          {
            link: "https://acme.test/jobs/1",
            description: desc("Acme Corp — Backend Engineer"),
          },
          { description: desc("Globex — Backend Engineer") },
          { description: desc("Globex — Backend engineer") },
        ],
      },
      today,
      undo.saveUndo,
    );
    expect(out.added.map((a) => a.job)).toEqual([1, 2, 3, 4]);
    expect(out.skipped).toEqual([]);
    expect(out.added[0].duplicates?.possible.length).toBeGreaterThan(0);
    expect(out.added[1].duplicates?.exact.length).toBeGreaterThan(0);
    expect(out.added[3].duplicates?.possible.length).toBeGreaterThan(0);
    expect(out.remaining).toEqual([]);
  });

  it("jobs whose post names no company are never skipped on title alone", async () => {
    const { quick, undo } = await setup();
    const unnamed = (n: number, company: string) =>
      job({ job: n, company, role: "Software Engineer" });
    const first = await quick.quickAddBatch(
      [unnamed(1, "Unknown"), unnamed(2, "Unknown")],
      {
        jobs: [
          { description: desc("Stealth startup — Software Engineer") },
          { description: desc("Series-D fintech — Software Engineer") },
        ],
      },
      today,
      undo.saveUndo,
    );
    expect(first.added.map((a) => a.job)).toEqual([1, 2]);
    // A later unnamed job with the same title (older placeholder wording too) is still added.
    const later = await quick.quickAddBatch(
      [unnamed(1, "Not stated in post")],
      { jobs: [{ description: desc("Hedge fund — Software Engineer") }] },
      today,
      undo.saveUndo,
    );
    expect(later.added.map((a) => a.job)).toEqual([1]);
    expect(quick.isUnknownCompany("Unknown")).toBe(true);
    expect(quick.isUnknownCompany("Not named in post (fintech)")).toBe(true);
    expect(quick.isUnknownCompany("Unknown Worlds")).toBe(false);
  });

  it("logs missing titles as Software Engineer without merging cards at the same company", async () => {
    const { quick, apps, undo } = await setup();
    const first = await quick.quickAddBatch(
      [job({ job: 1, role: "Unknown" }), job({ job: 2, role: " " })],
      {
        jobs: [
          { description: desc("First incomplete post") },
          { description: desc("Second incomplete post") },
        ],
      },
      today,
      undo.saveUndo,
    );
    expect(first.added).toHaveLength(2);
    expect(first.added.map((a) => a.role)).toEqual([
      "Software Engineer",
      "Software Engineer",
    ]);
    const later = await quick.quickAddBatch(
      [job({ role: "Not stated in post" })],
      { jobs: [{ description: desc("Third incomplete post") }] },
      today,
      undo.saveUndo,
    );
    expect(later.added).toHaveLength(1);
    const rows = (await apps.readApplications()).rows.filter(
      (row) => row.company === "Globex",
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.role === "Software Engineer")).toBe(true);
  });

  it("flags jobs whose post did not name the company or role, judged before the default title applies", async () => {
    const { quick, undo } = await setup();
    const out = await quick.quickAddBatch(
      [
        job({ job: 1, company: "Unknown", role: "Platform Engineer" }),
        job({ job: 2, company: "Initech", role: "Unknown" }),
        job({ job: 3, company: "Not stated in post", role: " " }),
        job({ job: 4, company: "Hooli", role: "Data Engineer" }),
      ],
      {
        jobs: [
          { description: desc("Unnamed company post") },
          { description: desc("Untitled role post") },
          { description: desc("Nothing named post") },
          { description: desc("Complete post") },
        ],
      },
      today,
      undo.saveUndo,
    );
    expect(out.added.map((a) => a.missing)).toEqual([
      ["company"],
      ["role"],
      ["company", "role"],
      undefined,
    ]);
    // The default title is still what gets saved for the missing role.
    expect(out.added[1].role).toBe("Software Engineer");
  });

  it.each(["Backend Engineer", "Unknown"])(
    "updates a linked saved-for-later row with role %s",
    async (savedRole) => {
      const { quick, apps, undo } = await setup();
      const link = "https://boards.greenhouse.io/globex/jobs/77";
      await apps.upsertApplication(
        {
          fileHash: (await apps.readApplications()).fileHash,
          decision: "later",
          row: {
            company: "Globex",
            role: savedRole,
            lane: "tech",
            resume: "tech",
            fit: null,
            match: null,
            source: "Other",
            link,
          },
        },
        "2026-10-10",
      );
      const out = await quick.quickAddBatch(
        [job({})],
        {
          jobs: [
            {
              link: "boards.greenhouse.io/globex/jobs/77",
              description: desc("Globex — Backend Engineer"),
            },
          ],
        },
        today,
        undo.saveUndo,
      );
      expect(out.added[0].action).toBe("updated");
      const rows = (await apps.readApplications()).rows.filter(
        (r) => r.company === "Globex",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        status: "applied",
        role: "Backend Engineer",
        date: today,
        link,
      });
    },
  );
});
