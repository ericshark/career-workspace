import { factualUnits } from "./resumeEvidence";
import { normalizeQuote } from "./scoring/verify";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolveExpected } from "./paths";

export const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

/** Canonical allowlist shared by submission writes and approval. No arbitrary file references. */
export function readResume(resume: string) {
  if (
    !/^(tech|general|datacenter|hourly|tailored\/[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(
      resume,
    )
  )
    throw new Error("Invalid resume reference");
  if (resume.startsWith("tailored/") && resume.slice(9).length > 60)
    throw new Error("Invalid tailored slug");
  const sourcePath = resolveExpected(`source/${resume}/resume.tex`);
  const pdfPath = resolveExpected(`resumes/${resume}/Resume.pdf`);
  const source = fs.readFileSync(sourcePath),
    pdf = fs.readFileSync(pdfPath);
  return {
    sourcePath,
    pdfPath,
    source,
    pdf,
    hashes: { source: digest(source), pdf: digest(pdf) },
  };
}

/** Validate the selected bytes without rebuilding them. ATS compares source claims with PDF text. */
export function validateResume(resume: string) {
  const artifact = readResume(resume);
  const env = {
    PATH: process.env.PATH,
    LANG: "C.UTF-8",
    NODE_ENV: process.env.NODE_ENV,
  };
  const info = execFileSync("pdfinfo", [artifact.pdfPath], {
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (!/^Pages:\s+1\s*$/m.test(info))
    throw new Error("Selected resume must be one page");
  const ats = execFileSync(
    "python3",
    [
      resolveExpected("scripts/ats_check.py"),
      artifact.sourcePath,
      "--pdf",
      artifact.pdfPath,
    ],
    { env, encoding: "utf8", timeout: 30_000 },
  );
  if (!/^PASS(?: \(with warnings\))?$/m.test(ats))
    throw new Error("Selected resume must PASS ATS");
  // ATS tolerates some missing words. Submission provenance additionally requires every factual
  // unit to occur in the selected PDF, including small metric/skill changes that ATS may only warn about.
  const pdfText = execFileSync(
    "pdftotext",
    ["-layout", artifact.pdfPath, "-"],
    { env, encoding: "utf8", timeout: 30_000 },
  );
  const canonicalText = (s: string) =>
    normalizeQuote(s).toLowerCase().replace(/[∼~]/g, "").replace(/\s/g, "");
  const haystack = canonicalText(pdfText);
  for (const unit of factualUnits(artifact.source.toString("utf8"))) {
    if (!haystack.includes(canonicalText(unit)))
      throw new Error(`Source/PDF content mismatch: ${unit}`);
  }
  // Re-read after external checks: never archive bytes different from those validated.
  const current = readResume(resume);
  if (
    current.hashes.source !== artifact.hashes.source ||
    current.hashes.pdf !== artifact.hashes.pdf
  )
    throw new Error("Resume changed during validation");
  return artifact;
}
