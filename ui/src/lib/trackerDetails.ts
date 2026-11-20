import fs from "node:fs";
import { findSaved, listReviews, renderReviewMarkdown } from "./reviews";
import { readApplications } from "./applications";
import { trackerBrief } from "./trackerBrief";
import {
  savedRecordForRow,
  reviewForRecord,
  rowsForReview,
} from "./applicationRecord";
import { readPreferences } from "./preferences";
import { CAREER_ROOT, resolveInside } from "./paths";
import { cleanBriefMarkdown } from "./jobBrief";
import { ApiError } from "./api";
import type { QuickRecord, ResumeCategory } from "./types";
import type { RunRecord } from "./runs";

export async function trackerDetails(id: string) {
  const saved = findSaved(id);
  if (!saved) throw new ApiError("NOT_FOUND", "Saved job not found", 404);
  const records = listReviews();
  const rows = (await readApplications()).rows;
  const direct = rows.filter((r) => {
    const linked = savedRecordForRow(r, records);
    return (
      linked?.id === id ||
      (!!saved.summary.sourceRecordId &&
        linked?.id === saved.summary.sourceRecordId)
    );
  });
  const candidates = direct.length
    ? direct
    : rowsForReview(saved.summary, rows);
  const row = candidates.length === 1 ? candidates[0] : null;
  const fallbackRow = row ?? candidates[0] ?? null;
  const record = saved.record;
  const quick = saved.summary.kind === "quick";
  const q = record as QuickRecord;
  const r = record as RunRecord;
  const format = quick ? q.postFormat : r.request.postFormat;
  const original =
    record.request.originalJobPost ||
    (quick ? q.originalJobPost : undefined) ||
    (format !== "brief" ? record.request.jobPost : undefined);
  const associated = reviewForRecord(saved.summary, records);
  const review = associated
    ? (findSaved(associated.id)?.record as RunRecord)
    : undefined;
  const usedResume =
    fallbackRow?.resume ??
    (quick
      ? q.resume
      : r.tailor?.slug
        ? `tailored/${r.tailor.slug}`
        : r.result.resume);
  const resume: ResumeCategory = ["tech", "general", "datacenter"].includes(
    usedResume,
  )
    ? (usedResume as ResumeCategory)
    : ["tech", "general", "datacenter"].includes(review?.result.resume ?? "")
      ? (review!.result.resume as ResumeCategory)
      : "tech";
  const slug = usedResume.startsWith("tailored/")
    ? usedResume.slice(9)
    : review?.tailor?.slug;
  const pdf = slug ? `resumes/tailored/${slug}/Resume.pdf` : null;
  const resolved = pdf ? resolveInside(CAREER_ROOT, pdf) : null;
  const prefs = readPreferences();
  return {
    displayBrief: trackerBrief(
      record.request.jobBrief,
      format === "brief" ? record.request.jobPost : null,
      quick ? q.extract.location : r.result.location,
      "",
      quick ? q.extract.workMode : r.result.workMode,
    ),
    contentSources: [
      saved.summary,
      ...records.filter(
        (item) => item.kind === "review" && item.sourceRecordId === id,
      ),
    ].map((item) => ({
      id: item.id,
      label: item.kind === "quick" ? "Quick Add" : "Review",
      extras: findSaved(item.id)?.record.extras ?? null,
    })),
    id,
    kind: saved.summary.kind,
    applicationKey: row?.key,
    company: fallbackRow?.company ?? saved.summary.company,
    role: fallbackRow?.role ?? saved.summary.role,
    date: fallbackRow?.date ?? saved.summary.reviewedAt,
    status: fallbackRow?.status ?? saved.summary.decision,
    resume,
    usedResume,
    source:
      fallbackRow?.source ??
      record.request.source ??
      (quick ? undefined : r.result.source) ??
      "Other",
    link: fallbackRow?.link || saved.summary.link,
    summary:
      format === "brief" ? cleanBriefMarkdown(record.request.jobPost) : null,
    original: original ?? null,
    compensation:
      record.request.jobBrief?.compensation ||
      (format === "brief"
        ? cleanBriefMarkdown(record.request.jobPost).match(
            /^- Compensation: (.+)$/m,
          )?.[1]
        : undefined),
    location:
      record.request.jobBrief?.location ||
      (quick ? q.extract.location : r.result.location),
    postedAt: (quick ? q.age : r.result.age).date,
    extras: record.extras ?? null,
    review: review?.result ?? null,
    reviewMarkdown: review
      ? renderReviewMarkdown(review)
          .split("## Job description summary")[0]
          .split("## Original job post")[0]
      : null,
    reviewModel: prefs.selections[prefs.provider].review,
    extrasModel: prefs.selections[prefs.provider].extras,
    tailorModel: prefs.selections[prefs.provider].tailor,
    tailoredPdf: resolved && fs.existsSync(resolved) ? pdf : null,
  };
}
export type TrackerDetails = Awaited<ReturnType<typeof trackerDetails>>;
