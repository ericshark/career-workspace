import { linkIdentity, readFoundLinks } from "@/lib/foundLinkStore";
import { isFoundLink } from "@/lib/foundLink";
import { classifyFoundLink } from "@/lib/linkClassify";
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, localToday, parseBody } from "@/lib/api";
import { loadRun, recordDecision } from "@/lib/runs";
import { saveUndo } from "@/lib/undo";
import {
  deleteRow,
  readApplications,
  updateRow,
  upsertApplication,
  type RowChanges,
} from "@/lib/applications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withFoundLinks(payload: Awaited<ReturnType<typeof readApplications>>) {
  // Found links are optional decoration: a damaged companion file must not take
  // down the Tracker. Writers still call readFoundLinks() directly and fail loudly,
  // so a corrupt file is never silently overwritten.
  let links: ReturnType<typeof readFoundLinks>;
  try {
    links = readFoundLinks();
  } catch (error) {
    console.error("Ignoring unreadable records/application-links.json", error);
    return payload;
  }
  if (!Object.keys(links).length) return payload;
  return {
    ...payload,
    rows: payload.rows.map((row) => {
      const candidate = row.recordId
        ? `record:${row.recordId}`
        : `row:${row.key}`;
      if (!links[candidate] || !linkIdentity(row, payload.rows)) return row;
      const stored = links[candidate];
      // Links saved before the host check existed are re-labeled on read, so an aggregator page
      // saved as a "posting" shows as the other site it is.
      return isFoundLink(stored)
        ? {
            ...row,
            foundLink: {
              ...stored,
              kind: classifyFoundLink(stored.kind, stored.url, row.source),
            },
          }
        : { ...row, linkLookup: stored };
    }),
  };
}

export async function GET() {
  try {
    return NextResponse.json(withFoundLinks(await readApplications()));
  } catch (e) {
    return errorResponse(e);
  }
}

// Log an application (Submitted → applied, Later → to apply). A submission for a posting that already
// has a `to apply` row updates that row instead of adding one. Validation lives in upsertApplication.
export async function POST(req: Request) {
  try {
    // `runId` (optional) ties the row to its review, so the saved review records the decision.
    const { runId, ...input } = await parseBody(
      req,
      z.object({ runId: z.string().optional() }).passthrough(),
    );
    // Captured before the decision is recorded, so Undo can put the review back as it was.
    const review = runId ? loadRun(runId) : null;
    const previousDecision = runId
      ? (review?.decision ?? "undecided")
      : undefined;
    let undoId: string | undefined;
    const { undo, ...result } = await upsertApplication(
      { ...input, reviewId: runId } as never,
      localToday(),
      (target) => {
        // Journal first: a failed Undo write must not leave a logged row behind a 500 response.
        undoId = saveUndo({
          ...target,
          kind: "review",
          ...(runId ? { runId, previousDecision } : {}),
        });
      },
      review ? { sourceRecordId: review.request.sourceRecordId } : undefined,
    );
    if (runId)
      recordDecision(
        runId,
        (input as { decision?: string }).decision === "submitted"
          ? "applied"
          : "later",
      );
    undoId ??= saveUndo({
      ...undo,
      kind: "review",
      ...(runId ? { runId, previousDecision } : {}),
    });
    return NextResponse.json(
      { ...result, undoId },
      { status: result.action === "inserted" ? 201 : 200 },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

// Field-level validation (status enum, single-line text, dates, scores, ≥1 field) lives in updateRow.
const rowChange = z.object({
  fileHash: z.string().min(1),
  key: z.string().min(1),
  lineIndex: z.number().int().min(0).optional(),
  status: z.unknown().optional(),
  company: z.unknown().optional(),
  role: z.unknown().optional(),
  link: z.unknown().optional(),
  dateEdit: z.unknown().optional(),
  next: z.unknown().optional(),
  source: z.unknown().optional(),
  date: z.unknown().optional(),
  resume: z.unknown().optional(),
  fit: z.unknown().optional(),
  match: z.unknown().optional(),
});

// Change a row's status (with an optional submit date), Next, Source, resume or scores.
export async function PATCH(req: Request) {
  try {
    const { fileHash, key, lineIndex, ...changes } = await parseBody(
      req,
      rowChange,
    );
    return NextResponse.json(
      withFoundLinks(
        await updateRow(
          fileHash,
          key,
          changes as RowChanges,
          localToday(),
          lineIndex,
        ),
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}

// Remove one row (by key + line, against the hash the client last read). Reviews and archives are kept.
export async function DELETE(req: Request) {
  try {
    const { fileHash, key, lineIndex } = await parseBody(
      req,
      z.object({
        fileHash: z.string().min(1),
        key: z.string().min(1),
        lineIndex: z.number().int().min(0),
      }),
    );
    return NextResponse.json(
      withFoundLinks(await deleteRow(fileHash, key, lineIndex)),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
