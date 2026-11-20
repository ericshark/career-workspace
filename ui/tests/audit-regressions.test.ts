import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixtureScore, FIXTURE_POST } from "@/lib/claude/fixtures";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "career-audit-"));
  fs.mkdirSync(path.join(root, "records"));
  vi.stubEnv("CAREER_ROOT", root);
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function review() {
  const { result, analysis } = fixtureScore("2026-10-01");
  return {
    version: 2 as const,
    request: { jobPost: FIXTURE_POST, resume: "tech" as const },
    result,
    analysis,
    savedAt: "2026-10-01T12:00:00Z",
  };
}
it("does not overwrite an unreadable canonical review at a colliding slug", async () => {
  const { saveReview } = await import("@/lib/reviews");
  const rec = review();
  const dir = path.join(root, "records/reviews");
  fs.mkdirSync(dir);
  const file = path.join(dir, `${rec.result.suggestedSlug}.json`);
  fs.writeFileSync(file, "{damaged record");
  expect(() => saveReview(rec)).toThrow(/unreadable/i);
  expect(fs.readFileSync(file, "utf8")).toBe("{damaged record");
});
it("preserves a quick record's filename when a previous slug collision disappears", async () => {
  const { saveReview, saveQuick, listReviews } = await import("@/lib/reviews");
  const rec = review();
  const first = saveReview(rec);
  const quick = {
    version: 2 as const,
    kind: "quick" as const,
    id: "quick-audit-record",
    slug: first.slug,
    request: { jobPost: FIXTURE_POST },
    extract: {
      company: "Fixture Co",
      role: "Engineer",
      location: "NYC",
      workMode: "hybrid" as const,
      level: "",
      postedDate: "",
      postedText: "",
      jobId: "",
      suggestedResume: "tech" as const,
    },
    age: rec.result.age,
    resume: "tech",
    reviewedAt: rec.savedAt,
    savedAt: rec.savedAt,
    decision: "applied" as const,
  };
  const saved = saveQuick(quick);
  fs.unlinkSync(path.join(root, first.jsonPath));
  fs.unlinkSync(path.join(root, first.mdPath));
  expect(saveQuick(quick).slug).toBe(saved.slug);
  expect(listReviews().filter((r) => r.id === quick.id)).toHaveLength(1);
});
it("keeps legacy employer activity after a record ID is attached and uses the newest evidence", async () => {
  const { APPLICATIONS_HEADER } = await import("@/lib/types");
  fs.writeFileSync(
    path.join(root, "records/applications.md"),
    `${APPLICATIONS_HEADER}\n|${Array(12).fill("---").join("|")}|\n| 2026-10-01 | Example | Engineer | tech | tech | | | Other | applied | | | |\n`,
  );
  const apps = await import("@/lib/applications");
  const row = (await apps.readApplications()).rows[0];
  const { syncMail } = await import("@/lib/mailSync");
  await syncMail({
    mode: "inbox",
    complete: false,
    startedAt: "2026-11-02T12:00:00Z",
    interactions: {
      [row.key]: "2026-11-01T12:00:00Z",
      "attached-record": "2026-10-02T12:00:00Z",
    },
  });
  await apps.attachRecordId(
    (await apps.readApplications()).fileHash,
    row.key,
    "attached-record",
  );
  const { ageApplications } = await import("@/lib/maintenance");
  await ageApplications(new Date("2026-11-02T12:00:00Z"));
  expect((await apps.readApplications()).rows[0].status).toBe("applied");
});
it("orders report instants chronologically across timezone offsets", async () => {
  const { saveOpportunity, listOpportunities } =
    await import("@/lib/opportunities");
  const base = {
    opportunityKey: "job",
    fingerprint: "v1",
    company: "Example",
    role: "Engineer",
    receivedAt: "2026-11-01T12:00:00Z",
    depth: "full",
    complete: true,
    verdict: "Prioritize",
    markdown: "Proceed",
    sources: [],
  };
  await saveOpportunity({ ...base, researchedAt: "2026-11-02T14:00:00Z" });
  const latest = await saveOpportunity({
    ...base,
    researchedAt: "2026-11-02T10:00:00-05:00",
  });
  expect(listOpportunities()[0].id).toBe(latest.id);
});
it("keeps reports with missing rendered Markdown eligible for repair", async () => {
  const { saveOpportunity, selectOpportunities } =
    await import("@/lib/opportunities");
  const input = {
    opportunityKey: "job",
    fingerprint: "v1",
    company: "Example",
    role: "Engineer",
    receivedAt: "2026-11-01T12:00:00Z",
    researchedAt: "2026-11-02T12:00:00Z",
    depth: "full",
    complete: true,
    verdict: "Prioritize",
    markdown: "Proceed",
    sources: [],
  };
  const saved = await saveOpportunity(input);
  fs.unlinkSync(path.join(root, `records/opportunities/${saved.id}.md`));
  expect(selectOpportunities([input], "since")).toHaveLength(1);
  await saveOpportunity(input);
  expect(selectOpportunities([input], "since")).toHaveLength(0);
});
