// Register deterministic review for CLI-built artifacts. Approval stays a separate explicit action.
import fs from "node:fs";
import { TailorReportSchema } from "./claude/schemas";
import {
  findForbiddenTex,
  verifyTailorReport,
  hashMasters,
} from "./claude/tailor";
import { validateResume } from "./resumeArtifacts";
import { artifactHashes } from "./tailorApproval";
import { validateEvidence } from "./resumeEvidence";
import { checkTailoringScope } from "./claude/candidate";
import { loadRun, persistRun } from "./runs";
import { resolveExpected } from "./paths";
import { isValidSlug } from "./slug";
import type { TailorResult } from "./types";

export async function validateCliTailor(
  runId: string,
  slug: string,
  rawReport: unknown,
): Promise<TailorResult> {
  const run = loadRun(runId);
  if (!run || !isValidSlug(slug))
    throw new Error("Unknown run or invalid slug");
  const baseline = run.masterHashes;
  if (!baseline)
    throw new Error(
      "Capture a master baseline with apps.sh brief before CLI tailoring",
    );
  const unchanged = async () => {
    const current = await hashMasters();
    if (
      Object.keys({ ...baseline, ...current }).some(
        (key) => baseline[key] !== current[key],
      )
    )
      throw new Error("Master resume changed since tailoring baseline");
  };
  await unchanged();
  const report = TailorReportSchema.parse(rawReport);
  const artifact = validateResume(`tailored/${slug}`);
  const tailored = artifact.source.toString("utf8");
  if (findForbiddenTex(tailored))
    throw new Error("Forbidden TeX in tailored source");
  const masterTex = fs.readFileSync(
    resolveExpected(`source/${run.result.resume}/resume.tex`),
    "utf8",
  );
  const career = fs.readFileSync(resolveExpected("profile/career.md"), "utf8");
  checkTailoringScope(masterTex, tailored);
  const contentDiff = validateEvidence(
    run.result,
    report,
    masterTex,
    tailored,
    career,
  );
  const verified = verifyTailorReport(run.result, report, tailored, career);
  const pngPath = `ui/.cache/png/tailored-${slug}.png`;
  const png = fs.readFileSync(resolveExpected(pngPath));
  if (
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("Missing or invalid PNG render");
  const hashes = artifactHashes(slug);
  if (
    hashes.source !== artifact.hashes.source ||
    hashes.pdf !== artifact.hashes.pdf
  )
    throw new Error("Artifacts changed during validation");
  const result: TailorResult = {
    validationMethod: "cli",
    slug,
    texPath: `source/tailored/${slug}/resume.tex`,
    pdfPath: `resumes/tailored/${slug}/Resume.pdf`,
    pngUrl: `/api/files?path=${pngPath}`,
    build: {
      ok: true,
      pages: 1,
      ats: "PASS",
      fillPct: null,
      warnings: [],
      failures: [],
      pdfPath: `resumes/tailored/${slug}/Resume.pdf`,
      pngPath,
      raw: "CLI artifacts independently validated; no rebuild.",
    },
    mastersUnchanged: true,
    deniedToolCalls: [],
    changes: verified.changes,
    actualMatch: verified.actualMatch,
    estimate: run.result.estimate,
    evidenceValidation: "passed",
    contentDiff,
    hashes,
    meta: { model: "cli-report", durationMs: 0 },
  };
  await unchanged();
  run.tailor = {
    slug,
    actualMatch: result.actualMatch,
    at: new Date().toISOString(),
    result,
    report,
    masterTex,
  };
  persistRun(run);
  return result;
}
