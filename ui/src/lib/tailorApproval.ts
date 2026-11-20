// Submission re-checks a tailored artifact: build, evidence against the current career record, and unchanged files.
import fs from "node:fs";
import { tailorValidated } from "./tailorStatus";
import { checkFinalReport } from "./claude/candidate";
import type { VerifiedTailorReport } from "./types";
import { loadRun, persistRun } from "./runs";
import { listReviews, findSaved } from "./reviews";
import { digest, readResume, validateResume } from "./resumeArtifacts";
import { resolveExpected } from "./paths";
import { validateEvidence } from "./resumeEvidence";
import type { ArtifactHashes, TailorResult } from "./types";

export function artifactHashes(slug: string): ArtifactHashes {
  return {
    ...readResume(`tailored/${slug}`).hashes,
    career: digest(fs.readFileSync(resolveExpected("profile/career.md"))),
  };
}
// Career edits don't invalidate a tailored resume: its evidence is re-validated against the current record.
export const sameHashes = (a?: ArtifactHashes, b?: ArtifactHashes) =>
  !!a && !!b && a.source === b.source && a.pdf === b.pdf;

export function reviewTailor(runId: string) {
  const run = loadRun(runId);
  const t = run?.tailor;
  if (!run || !t?.result || !t.report || !t.masterTex)
    throw new Error(
      "Tailored artifact needs a complete validated review before submission",
    );
  const result = t.result;
  if (
    result.slug !== t.slug ||
    result.texPath !== `source/tailored/${t.slug}/resume.tex` ||
    result.pdfPath !== `resumes/tailored/${t.slug}/Resume.pdf`
  )
    throw new Error("Tailoring artifact references do not match the review");
  if (
    !tailorValidated(result) ||
    !result.build.ok ||
    result.build.pages !== 1 ||
    !result.build.ats?.startsWith("PASS") ||
    !result.mastersUnchanged ||
    !result.pngUrl
  )
    throw new Error("Tailoring validation failed");
  const pngPath =
    new URL(result.pngUrl, "http://localhost").searchParams.get("path") ?? "";
  if (!/^ui\/\.cache\/png\/[A-Za-z0-9_.-]+\.png$/.test(pngPath))
    throw new Error("Invalid PNG preview path");
  const png = fs.readFileSync(resolveExpected(pngPath));
  if (
    !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("PNG preview unavailable or invalid");
  const hashes = artifactHashes(t.slug);
  if (!sameHashes(hashes, result.hashes))
    throw new Error(
      "Tailored resume changed after validation; validate it again",
    );
  validateResume(`tailored/${t.slug}`);
  if (result.validationMethod === "controlled") {
    checkFinalReport(
      t.masterTex,
      fs.readFileSync(resolveExpected(result.texPath), "utf8"),
      t.report as VerifiedTailorReport,
      fs.readFileSync(resolveExpected("profile/career.md"), "utf8"),
      run.result,
      hashes.source,
    );
  }
  validateEvidence(
    run.result,
    t.report,
    t.masterTex,
    fs.readFileSync(resolveExpected(result.texPath), "utf8"),
    fs.readFileSync(resolveExpected("profile/career.md"), "utf8"),
  );
  if (!sameHashes(hashes, artifactHashes(t.slug)))
    throw new Error("Artifacts changed during validation");
  return { run, result, hashes };
}

/** Legacy records lacking provenance are refused; locate by saved review when CLI has no run ID. */
export function requireValidatedTailor(
  resume: string,
  reviewId?: string,
): string | undefined {
  if (!resume.startsWith("tailored/")) return reviewId;
  const slug = resume.slice("tailored/".length);
  const ids = [
    ...new Set([
      ...(reviewId ? [reviewId] : []),
      ...listReviews()
        .filter((s) => s.kind === "review")
        .map((s) => s.id),
    ]),
  ];
  for (const id of ids) {
    const record = loadRun(id) ?? findSaved(id)?.record;
    if (!record || !("tailor" in record) || record.tailor?.slug !== slug)
      continue;
    try {
      reviewTailor(id);
      return id;
    } catch {
      /* another saved review may contain a current validated artifact */
    }
  }
  throw new Error("Tailored resume has no current validated review");
}
