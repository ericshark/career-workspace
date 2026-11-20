import { describe, expect, it, vi } from "vitest";

const runAgent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/claude/agent", async (orig) => ({
  ...(await orig<typeof import("@/lib/claude/agent")>()),
  runAgent,
}));

import { QUICK_MODEL } from "@/lib/quick";

describe("extractQuickBatch", () => {
  it.each(["claude", "openai"] as const)(
    "keeps sparse jobs with %s without inventing work requirements",
    async (provider) => {
      runAgent.mockReset();
      runAgent.mockResolvedValue({
        subtype: "success",
        structuredOutput: {
          jobs: Array.from({ length: 20 }, (_, i) => ({
            job: i + 1,
            company: " ",
            role: "",
            location: "",
            workMode: "unknown",
            level: "",
            postedText: "",
            postedDate: "",
            jobId: "",
            link: "",
            source: "Other",
            jobBrief: {
              overview: "",
              experience: "",
              responsibilities: [],
              qualifications: [],
              location: "",
              compensation: "",
            },
          })),
        },
      });
      const { extractQuickBatch } = await import("@/lib/quick");
      const jobs = await extractQuickBatch(
        Array.from({ length: 20 }, () => ({
          description:
            "Company information only; no job title or work requirements provided.",
        })),
        undefined,
        provider,
      );
      expect(jobs).toHaveLength(20);
      for (const job of jobs)
        expect(job).toMatchObject({
          company: "Unknown",
          role: "Software Engineer",
          jobBrief: {
            overview: "Unknown",
            responsibilities: [],
            qualifications: [],
          },
        });
    },
  );

  it("keeps an inferred role without inventing a brief", async () => {
    runAgent.mockResolvedValue({
      subtype: "success",
      structuredOutput: {
        jobs: [
          {
            company: "Acme",
            role: "Data Engineer",
            location: "",
            workMode: "unknown",
            level: "",
            postedText: "",
            postedDate: "",
            jobId: "",
            job: 1,
            link: "",
            source: "Other",
          },
        ],
      },
    });
    const { extractQuickBatch } = await import("@/lib/quick");
    expect(
      await extractQuickBatch([
        { description: "Acme. Build and maintain batch ingestion pipelines." },
      ]),
    ).toMatchObject([
      {
        company: "Acme",
        role: "Data Engineer",
        jobBrief: {
          overview: "Unknown",
          responsibilities: [],
          qualifications: [],
        },
      },
    ]);
  });

  it("finds several jobs in one tool-free Haiku call", async () => {
    runAgent.mockReset();
    const job = {
      location: "",
      workMode: "unknown",
      level: "",
      postedText: "",
      postedDate: "",
      jobId: "",
      link: "",
      source: "Other",
      jobBrief: {
        overview: "Build software for the engineering organization.",
        experience: "",
        responsibilities: ["Build software"],
        qualifications: [],
        location: "",
        compensation: "",
      },
    };
    runAgent.mockResolvedValue({
      subtype: "success",
      structuredOutput: {
        jobs: [
          { ...job, company: "Acme", role: "Engineer", job: 1 },
          { ...job, company: "Globex", role: "SRE", job: 2 },
        ],
      },
    });
    const { extractQuickBatch } = await import("@/lib/quick");
    const jobs = await extractQuickBatch([
      { description: "Acme is hiring an engineer." },
      { link: "https://globex.test/jobs/1", description: "Globex SRE." },
    ]);
    expect(jobs.map((j) => j.company)).toEqual(["Acme", "Globex"]);
    expect(runAgent).toHaveBeenCalledTimes(1);
    const opts = runAgent.mock.calls[0][0];
    expect(opts.tools).toEqual([]);
    expect(opts.settingSources).toEqual([]);
    expect(opts.model).toBe(QUICK_MODEL);
    expect(opts.prompt).toContain("untrusted data");
    expect(opts.prompt).toContain(
      '<job number="2">\nJob 2\nURL: https://globex.test/jobs/1',
    );
  });

  it("reads the batch with the ChatGPT plan's fast model when selected", async () => {
    runAgent.mockReset();
    runAgent.mockResolvedValue({ subtype: "error_max_turns" });
    const { extractQuickBatch } = await import("@/lib/quick");
    await expect(
      extractQuickBatch([{ description: "Acme" }], undefined, "openai"),
    ).rejects.toThrow(/^OpenAI did not return/);
    expect(runAgent.mock.calls[0][0].model).toBe("gpt-6-luna");
  });

  it("ignores any stray source field and uses the configured Quick Add effort preference", async () => {
    runAgent.mockReset();
    runAgent.mockResolvedValue({
      subtype: "success",
      structuredOutput: {
        jobs: [
          {
            company: "Acme",
            role: "Engineer",
            location: "",
            workMode: "unknown",
            level: "",
            postedText: "",
            postedDate: "",
            jobId: "",
            job: 1,
            link: "",
            source: "Monster",
            jobBrief: {
              overview: "Build software.",
              experience: "",
              responsibilities: [],
              qualifications: [],
              location: "",
              compensation: "",
            },
          },
        ],
      },
    });
    const { extractQuickBatch } = await import("@/lib/quick");
    const jobs = await extractQuickBatch(
      [{ description: "Acme" }],
      undefined,
      "claude",
      "high",
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).not.toHaveProperty("source");
    expect(runAgent.mock.calls[0][0].effort).toBe("high");
    expect(runAgent.mock.calls[0][0].operation).toBe("quick");
  });
});

it.each([undefined, null, ""])(
  "accepts omitted or null metadata (%s) for a sparse paste",
  async (missing) => {
    runAgent.mockReset();
    runAgent.mockResolvedValue({
      subtype: "success",
      structuredOutput: {
        jobs: [
          {
            job: 1,
            company: missing,
            role: missing,
            location: missing,
            link: missing,
            jobBrief: missing === "" ? undefined : missing,
          },
        ],
      },
    });
    const { extractQuickBatch } = await import("@/lib/quick");
    const result = await extractQuickBatch([
      {
        description:
          "Build Python APIs and maintain PostgreSQL services. Experience preferred.",
      },
    ]);
    expect(result).toMatchObject([
      {
        job: 1,
        company: "Unknown",
        role: "Software Engineer",
        location: "",
        link: "",
        workMode: "unknown",
        jobBrief: {
          overview: "Unknown",
          responsibilities: [],
          qualifications: [],
        },
      },
    ]);
  },
);
