import { describe, expect, it } from "vitest";
import {
  findDuplicates,
  jobKeyFromUrl,
  normalizeCompany,
  normalizeUrl,
  pendingRowFor,
  titleSimilarity,
} from "@/lib/duplicates";
import type { ApplicationRow, SavedReviewSummary } from "@/lib/types";

describe("normalizeUrl", () => {
  it("drops scheme, www, tracking params, fragment and trailing slash", () => {
    expect(
      normalizeUrl("https://www.Example.com/jobs/42/?utm_source=x&ref=y#apply"),
    ).toBe("example.com/jobs/42");
  });
  it("keeps job-id params", () => {
    expect(
      normalizeUrl("https://acme.com/careers?gh_jid=123&utm_medium=li"),
    ).toBe("acme.com/careers?gh_jid=123");
  });
  it("accepts a bare host and rejects junk", () => {
    expect(normalizeUrl("linkedin.com/jobs/view/1")).toBe(
      "linkedin.com/jobs/view/1",
    );
    expect(normalizeUrl("")).toBe("");
    expect(normalizeUrl("http://")).toBe("");
  });
});

describe("jobKeyFromUrl", () => {
  it.each([
    [
      "https://job-boards.greenhouse.io/opploans/jobs/8011770003",
      "greenhouse:8011770003",
    ],
    ["https://boards.greenhouse.io/acme/jobs/123?gh_src=x", "greenhouse:123"],
    ["https://acme.com/careers/open?gh_jid=555", "greenhouse:555"],
    [
      "https://jobs.lever.co/acme/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b/apply",
      "lever:0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b",
    ],
    [
      "https://jobs.ashbyhq.com/acme/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b",
      "ashby:0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b",
    ],
    [
      "https://www.linkedin.com/jobs/view/4012345678/?trk=x",
      "linkedin:4012345678",
    ],
    [
      "https://www.linkedin.com/jobs/view/software-engineer-at-acme-4012345678",
      "linkedin:4012345678",
    ],
    [
      "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678",
      "linkedin:4012345678",
    ],
    ["https://www.indeed.com/viewjob?jk=ABC123&from=x", "indeed:abc123"],
    [
      "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/NYC/Software-Engineer_R-12345",
      "workday:acme.wd5.myworkdayjobs.com:R-12345",
    ],
    [
      "https://wellfound.com/jobs/3012345-backend-engineer",
      "wellfound:3012345",
    ],
    [
      "https://csicuny.joinhandshake.com/job-search/11615090?query=software+engineer&page=1",
      "handshake:11615090",
    ],
    [
      "https://app.joinhandshake.com/stu/jobs/11615090/search?ref=x",
      "handshake:11615090",
    ],
    ["https://joinhandshake.com/jobs/11615090", "handshake:11615090"],
    ["https://example.com/careers/backend", null],
  ])("%s → %s", (url, key) => {
    expect(jobKeyFromUrl(url)).toBe(key);
  });
});

describe("company + title similarity", () => {
  it("normalizes company suffixes and punctuation", () => {
    expect(normalizeCompany("Brightpath, Inc.")).toBe("brightpath");
    expect(normalizeCompany("Acme Technologies LLC")).toBe("acme");
  });
  it("treats I/1, SWE/software engineer and Backend/Back-End alike", () => {
    expect(
      titleSimilarity("Software Engineer I (Back-End)", "SWE 1, Backend"),
    ).toBe(1);
    expect(titleSimilarity("Backend Engineer", "Data Analyst")).toBe(0);
  });
});

let n = 0;
const row = (o: Partial<ApplicationRow>): ApplicationRow => {
  n++;
  return {
    date: "2026-10-01",
    company: "Brightpath",
    role: "Software Engineer I (Back-End)",
    lane: "tech",
    resume: "tech",
    fit: "61",
    match: "",
    source: "Other",
    status: "applied",
    next: "",
    link: "https://job-boards.greenhouse.io/opploans/jobs/8011770003",
    key: `k${n}`,
    lineIndex: n,
    ...o,
  };
};

describe("findDuplicates", () => {
  const rows = [
    row({}),
    row({
      company: "Acme",
      role: "Backend Engineer",
      status: "to apply",
      link: "https://jobs.lever.co/acme/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b",
    }),
    row({
      company: "Acme",
      role: "Data Analyst",
      status: "rejected",
      link: "",
    }),
  ];
  const reviews: SavedReviewSummary[] = [
    {
      kind: "review",
      id: "run-globex-1",
      slug: "globex-swe",
      jsonPath: "records/reviews/globex-swe.json",
      mdPath: "records/reviews/globex-swe.md",
      company: "Globex",
      role: "Software Engineer",
      link: "",
      jobId: "REQ-77",
      reviewedAt: "2026-10-02",
      savedAt: "2026-10-02T10:00:00Z",
      decision: "skip",
      fit: 40,
      match: 50,
    },
  ];

  it("exact: same posting with different tracking params, carrying status and date", () => {
    const d = findDuplicates(
      {
        link: "https://job-boards.greenhouse.io/opploans/jobs/8011770003?gh_src=li",
      },
      rows,
    );
    expect(d.exact).toHaveLength(1);
    expect(d.exact[0]).toMatchObject({
      kind: "application",
      status: "applied",
      date: "2026-10-01",
      reason: "url", // gh_src is tracking noise, so the normalized URLs are equal
    });
  });

  it("possible: same company + similar title on a different posting (a repost)", () => {
    const d = findDuplicates(
      {
        link: "https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555",
        company: "Acme Inc.",
        role: "Back-End Engineer",
      },
      rows,
    );
    expect(d.exact).toEqual([]);
    expect(d.possible.map((m) => [m.role, m.status])).toEqual([
      ["Backend Engineer", "to apply"],
    ]);
  });

  it("a job id stated in the post matches a saved review for the same company", () => {
    const d = findDuplicates(
      { jobId: "req-77", company: "Globex", role: "Platform Engineer" },
      rows,
      reviews,
    );
    expect(d.exact).toMatchObject([
      {
        kind: "review",
        reason: "job-id",
        status: "skip",
        reviewPath: "records/reviews/globex-swe.md",
      },
    ]);
  });

  it("no link and no company → nothing", () => {
    expect(findDuplicates({}, rows)).toEqual({ exact: [], possible: [] });
  });

  it("pendingRowFor finds only a `to apply` row for the exact posting", () => {
    expect(
      pendingRowFor(
        {
          link: "https://jobs.lever.co/acme/0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b/apply",
        },
        rows,
      )?.company,
    ).toBe("Acme");
    expect(
      pendingRowFor(
        { link: "https://job-boards.greenhouse.io/opploans/jobs/8011770003" },
        rows,
      ),
    ).toBeNull(); // already applied
  });
});

describe("Workday tenant identity", () => {
  it("does not collide across employers but matches alternate URLs within one tenant", () => {
    const a =
      "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/NY/Engineer_R12345";
    const b =
      "https://globex.wd5.myworkdayjobs.com/en-US/Careers/job/NY/Engineer_R12345";
    const alternate =
      "https://acme.wd5.myworkdayjobs.com/Careers/job/NY/New-Title_R12345?source=linkedin";
    expect(jobKeyFromUrl(a)).not.toBe(jobKeyFromUrl(b));
    expect(jobKeyFromUrl(a)).toBe(jobKeyFromUrl(alternate));
  });
});
