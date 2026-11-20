import { fixtureAnalysis } from "@/lib/claude/fixtures";
import { seedResumes, removeTestRoot } from "./seedResumes";
// Smoke test for the /apply CLI (ui/scripts/apps.ts) against a temp CAREER_ROOT. Never touches the
// real records/ files.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ui = path.join(import.meta.dirname, "..");
const tsx = path.join(ui, "node_modules", ".bin", "tsx");
let root: string;

function apps(...args: string[]): string {
  return execFileSync(tsx, [path.join(ui, "scripts", "apps.ts"), ...args], {
    env: { ...process.env, CAREER_ROOT: root },
    encoding: "utf8",
  });
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "apps-cli-"));
  seedResumes(root);
  fs.mkdirSync(path.join(root, "records"), { recursive: true });
  fs.copyFileSync(
    path.join(ui, "tests", "fixtures", "applications.legacy-2026-10-06.md"),
    path.join(root, "records", "applications.md"),
  );
});
afterAll(() => removeTestRoot(root));

describe("scripts/apps.sh (apps.ts)", { timeout: 30_000 }, () => {
  const link = "https://boards.greenhouse.io/globex/jobs/42";

  it("migrates, logs for later, updates on apply, and counts by submit date", () => {
    expect(apps("migrate")).toContain("Migrated");
    expect(apps("migrate")).toContain("Already current");
    expect(apps("check", "--link", link)).toContain("No duplicates.");

    expect(
      apps(
        "add",
        "--company",
        "Globex",
        "--role",
        "Backend Engineer",
        "--resume",
        "tech",
        "--status",
        "later",
        "--fit",
        "82",
        "--match",
        "70",
        "--link",
        link,
      ),
    ).toContain("Added a row");
    expect(apps("check", "--link", link + "?gh_src=x")).toContain(
      "EXACT DUPLICATE: application · to apply",
    );

    expect(
      apps("mark-applied", "--link", link, "--date", "2026-10-06"),
    ).toContain("Marked applied.");
    const table = fs.readFileSync(
      path.join(root, "records", "applications.md"),
      "utf8",
    );
    expect(table).toContain(
      `| 2026-10-06 | Globex | Backend Engineer | tech | tech | 82 | 70 | Other | applied |  | ${link} |`,
    );
    expect(table.match(/Globex/g)).toHaveLength(1); // updated, not duplicated

    const today = JSON.parse(apps("today", "--json"));
    expect(today).toHaveProperty("target", 25);
  });

  it("status: changes the status and writes the Next column", () => {
    expect(
      apps(
        "status",
        "--link",
        link,
        "--to",
        "in progress",
        "--next",
        "OA due 2026-10-24",
      ),
    ).toContain("Status → in progress.");
    expect(
      fs.readFileSync(path.join(root, "records", "applications.md"), "utf8"),
    ).toContain("| in progress | OA due 2026-10-24 |");
  });

  it("prints the classification schema and rejects a bad analysis", () => {
    expect(JSON.parse(apps("schema")).type).toBe("object");
    const bad = path.join(root, "bad.json");
    const post = path.join(root, "post.txt");
    fs.writeFileSync(bad, JSON.stringify({ company: "x" }));
    fs.writeFileSync(post, "x".repeat(300));
    expect(() => apps("score", "--post", post, "--analysis", bad)).toThrow(
      /doesn't match the schema/,
    );
  });

  it("quick: validates the extract, writes the row with blank scores, keeps the post", () => {
    const post = path.join(root, "quick-post.txt");
    const ex = path.join(root, "quick.json");
    fs.writeFileSync(post, "Initech — Support Engineer\nPosted today.");
    fs.writeFileSync(
      ex,
      JSON.stringify({
        company: "Initech",
        role: "Support Engineer",
        location: "Remote",
        workMode: "remote",
        level: "",
        postedText: "Posted today",
        postedDate: "",
        jobId: "",
        suggestedResume: "tech",
      }),
    );
    expect(
      apps(
        "quick",
        "--post",
        post,
        "--analysis",
        ex,
        "--status",
        "later",
        "--link",
        "https://initech.test/jobs/1",
      ),
    ).toContain("Added a row: Initech — Support Engineer (to apply)");
    const table = fs.readFileSync(
      path.join(root, "records", "applications.md"),
      "utf8",
    );
    expect(table).toContain(
      "| Initech | Support Engineer | tech | tech |  |  | Other | to apply |",
    );
    const kept = fs.readdirSync(path.join(root, "records", "reviews"));
    expect(kept).toEqual(
      expect.arrayContaining([
        "initech-support-engineer.json",
        "initech-support-engineer.md",
      ]),
    );
  });
  it("registers and explicitly approves CLI-built tailoring before archiving a submission", () => {
    const post = path.join(root, "tailor-post.txt"),
      analysis = path.join(root, "tailor-analysis.json");
    fs.mkdirSync(path.join(root, "profile"), { recursive: true });
    fs.writeFileSync(path.join(root, "profile/career.md"), "Fixture career");
    fs.writeFileSync(post, "Fixture job description");
    const classification = fixtureAnalysis();
    const { suggestedSlug: _slug, ...withoutSlug } = classification;
    fs.writeFileSync(analysis, JSON.stringify(withoutSlug));
    const result = JSON.parse(
      apps("score", "--post", post, "--analysis", analysis, "--json"),
    );
    const id = result.runId;
    expect(result.suggestedSlug).toBe("fixture-backend-engineer");
    expect(Object.keys(result.meta.sources.hashes)).toContain(
      "profile/career.md",
    );
    apps("brief", id, "--slug", "cli-fixture");
    const tex = path.join(root, "source/tailored/cli-fixture/resume.tex"),
      pdf = path.join(root, "resumes/tailored/cli-fixture/Resume.pdf");
    fs.mkdirSync(path.dirname(tex), { recursive: true });
    fs.mkdirSync(path.dirname(pdf), { recursive: true });
    fs.copyFileSync(path.join(root, "source/tech/resume.tex"), tex);
    fs.copyFileSync(path.join(root, "resumes/tech/Resume.pdf"), pdf);
    const png = path.join(root, "ui/.cache/png/tailored-cli-fixture");
    fs.mkdirSync(path.dirname(png), { recursive: true });
    execFileSync("pdftoppm", ["-r", "20", "-png", "-singlefile", pdf, png]);
    const report = path.join(root, "tailor-report.json");
    fs.writeFileSync(
      report,
      JSON.stringify({
        changes: [],
        requirements: [],
        notes: "Fixture unchanged copy",
      }),
    );
    expect(
      apps(
        "validate-tailor",
        id,
        "--slug",
        "cli-fixture",
        "--analysis",
        report,
      ),
    ).toContain("contentDiff");
    const saved = JSON.parse(
      apps(
        "log",
        id,
        "--status",
        "applied",
        "--resume",
        "tailored/cli-fixture",
        "--json",
      ),
    );
    // The row records which resume was sent; no copy of it is archived.
    expect(
      fs.readFileSync(path.join(root, "records/applications.md"), "utf8"),
    ).toContain("tailored/cli-fixture");
    expect(fs.existsSync(path.join(root, "records/submissions"))).toBe(false);
  });
});
