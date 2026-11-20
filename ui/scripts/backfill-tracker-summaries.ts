// Explicit one-time migration. No application rows or scoring outputs are changed.
import fs from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
async function main() {
  const { readApplications } = await import("../src/lib/applications");
  const { listReviews, findSaved, saveQuick, saveReview } =
    await import("../src/lib/reviews");
  const { savedRecordForRow } = await import("../src/lib/applicationRecord");
  const { extractQuickBatch } = await import("../src/lib/quick");
  const { formatJobBrief } = await import("../src/lib/jobBrief");
  const { readPreferences } = await import("../src/lib/preferences");
  const { CAREER_ROOT } = await import("../src/lib/paths");
  const { saveRun } = await import("../src/lib/runs");
  const rows = (await readApplications()).rows;
  const records = listReviews();
  const seen = new Set<string>();
  let converted = 0,
    failed = 0,
    unmatched = 0;
  const pending = rows.filter((row) => {
    const match = savedRecordForRow(row, records);
    if (!match) {
      unmatched++;
      return false;
    }
    if (seen.has(match.id)) return false;
    seen.add(match.id);
    const rec = findSaved(match.id)?.record;
    return (
      rec &&
      ("kind" in rec ? rec.postFormat : rec.request.postFormat) !== "brief"
    );
  });
  seen.clear();
  const batchSize = process.argv.includes("--single") ? 1 : 10;
  const extracted = new Map<string, import("../src/lib/types").QuickJob>();
  for (const row of pending) {
    const match = savedRecordForRow(row, records);
    if (!match) {
      unmatched++;
      continue;
    }
    if (seen.has(match.id)) continue;
    seen.add(match.id);
    const saved = findSaved(match.id);
    if (!saved) continue;
    const rec = saved.record;
    const quick = "kind" in rec && rec.kind === "quick";
    if (
      (quick
        ? rec.postFormat
        : (rec as import("../src/lib/runs").RunRecord).request.postFormat) ===
      "brief"
    )
      continue;
    try {
      if (!extracted.has(match.id)) {
        const batch = pending.slice(
          pending.indexOf(row),
          pending.indexOf(row) + batchSize,
        );
        const output = await extractQuickBatch(
          batch.map((item) => ({
            description: findSaved(savedRecordForRow(item, records)!.id)!.record
              .request.jobPost,
            link: item.link || undefined,
          })),
          undefined,
          readPreferences().provider,
        );
        if (
          output.length !== batch.length ||
          new Set(output.map((j) => j.job)).size !== batch.length
        )
          throw new Error("Incomplete batch response");
        for (const item of output) {
          if (item.job < 1 || item.job > batch.length)
            throw new Error("Invalid batch job number");
          extracted.set(
            savedRecordForRow(batch[item.job - 1], records)!.id,
            item,
          );
        }
      }
      const job = extracted.get(match.id)!;
      // Re-read immediately before writing so concurrent saved answers are retained.
      const fresh = JSON.parse(
        fs.readFileSync(
          path.join(CAREER_ROOT, findSaved(match.id)!.summary.jsonPath),
          "utf8",
        ),
      ) as typeof rec;
      fresh.request.jobBrief = job.jobBrief;
      fresh.request.originalJobPost = fresh.request.jobPost;
      fresh.request.jobPost = formatJobBrief(
        row.company,
        row.role,
        job.jobBrief,
      );
      if ("kind" in fresh && fresh.kind === "quick") {
        fresh.postFormat = "brief";
        saveQuick(fresh);
      } else {
        const review = fresh as import("../src/lib/runs").RunRecord;
        review.request.postFormat = "brief";
        saveReview(review);
        saveRun(review);
      }
      converted++;
      console.log(
        JSON.stringify({
          company: row.company,
          role: row.role,
          status: "converted",
        }),
      );
    } catch (error) {
      failed++;
      console.error(
        JSON.stringify({
          company: row.company,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  console.log(JSON.stringify({ converted, failed, unmatched }));
  if (failed) process.exitCode = 1;
}
void main();
