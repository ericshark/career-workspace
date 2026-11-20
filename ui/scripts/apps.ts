import { loadInputSnapshot } from "../src/lib/claude/inputs";
import { hashMasters } from "../src/lib/claude/tailor";
import { defaultResumeLane } from "../src/lib/resumeDefaults";
import { validateCliTailor } from "../src/lib/cliTailorReview";
import { localDate, localToday, laneForResume } from "../src/lib/config";
// Deterministic CLI for manual application workflows (run via scripts/apps.sh). It reuses the UI's
// lib/ code so the skill never parses or edits applications.md by hand and never does score math.
// Commands print human-readable text; add --json for machine-readable output.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import {
  migrateApplicationsFile,
  readApplications,
  updateRow,
  upsertApplication,
} from "../src/lib/applications";
import { buildBrief } from "../src/lib/brief";
import { finishReview } from "../src/lib/claude/score";
import {
  ReviewSchema,
  normalizeReview,
  reviewJsonSchema,
} from "../src/lib/claude/schemas";
import { checkDuplicates } from "../src/lib/dupCheck";
import { ConflictError } from "../src/lib/fileStore";
import { normalizeUrl, jobKeyFromUrl } from "../src/lib/duplicates";
import { computeProgress, mondayToSunday } from "../src/lib/progress";
import { saveReview, summaryLines } from "../src/lib/reviews";
import { loadRun, persistRun, recordDecision, saveRun } from "../src/lib/runs";
import { QuickSchema } from "../src/lib/claude/schemas";
import { logQuick, prepareQuick, savePending } from "../src/lib/quick";
import { isValidSlug } from "../src/lib/slug";
import { STATUSES } from "../src/lib/types";
import { storedStatus } from "../src/lib/status";
import type {
  ApplicationsPayload,
  DuplicateReport,
  ResumeCategory,
  ReviewDecision,
  ScoreRequest,
  Status,
} from "../src/lib/types";

const USAGE = `scripts/apps.sh <command> [options]

  check --link URL [--company C --role R --job-id ID]   duplicate check (exact / possible)
  schema                                                 JSON Schema for the classification
  score --post FILE --analysis FILE [--resume tech|general|datacenter]
        [--link URL --source S --posted YYYY-MM-DD]      verify + compute the review, save a run
  show RUNID                                             the compact review again
  tailor-context QUERY --json                           find saved jobs and linked tailoring inputs
  tailor-match-context RUNID                            validated PDF text, rubric and hashes
  tailor-match-schema                                   JSON schema for a Match assessment
  tailor-match RUNID --analysis FILE                    record a hash-bound Match assessment
  brief RUNID [--slug S]                               tailoring brief JSON for resume construction
  save-review RUNID [--decision applied|later|skip]      re-save a review (every review is saved automatically)
  validate-tailor RUNID --slug S --analysis REPORT       validate CLI-built source/PDF/PNG and report for review
  skip RUNID                                             record "skip" on the review (no row)
  quick --post FILE --analysis FILE --status applied|later [--link L --source S --resume R --date D]
                                                         quick add: no review, row + description kept
  quick-schema                                           JSON Schema for the quick-add extract
  log RUNID --status applied|later [--resume R --date D --source S --link L]
                                                         insert/update the application row
  add --company C --role R --status applied|later --resume R [--fit N --match N --link L --source S --date D]
                                                         log without a review
  mark-applied (--link URL | --key KEY) [--date D]       flip a "to apply" row to applied
  status (--link URL | --key KEY) --to "applied|in progress|no response|rejected|unsuccessful|to apply" [--from STATUS] [--next TEXT]
                                                         change a row's status (and its Next column); a rejection of an
                                                         In progress row is stored as unsuccessful
  today | week                                           submitted-application counts
  migrate                                                one-time table migration to Record ID format
  reclassify-unsuccessful [--apply]                      list (or apply) Rejected rows that were In progress first
  recruiting list | refresh                              read history or reconcile local recruiting state
  recruiting sync | preview | resolve --input FILE       save/preview events or confirm a pending match
  mail list | sync --input FILE                          read discoveries or persist verified mail batches
  mail begin | heartbeat | fail --input FILE             claim, renew or release the recruiting check lease
  mail publish | finish --input FILE                     publish Actions and complete the durable handoff
  mail quick-window --input FILE                         read incremental Quick scan bounds
  opportunities list | save --input FILE                  list or save research reports
  opportunities select --input FILE --mode all|today|since [--kind full|triage]
  actions list | import-next                             read actions or import existing tracker next steps once
  actions preview --input FILE                           project action batches without writes
  actions sync --input FILE                              merge a verified inbox action batch (see actionSyncSchema)
  actions add --application-key KEY --text TEXT [--explanation TEXT]  add a manual task without email
  actions finalize --input FILE                          publish a successful check before mail acknowledgment
  actions deadline --received-at ISO --days N --wording TEXT [--kind requested|expires]
                                                         calculate a relative New York due date (read-only)

Add --json for machine-readable output.`;

function die(msg: string): never {
  console.error(`apps: ${msg}`);
  process.exit(1);
}

function readFileArg(p: string | undefined, what: string): string {
  if (!p) die(`--${what} FILE is required`);
  try {
    return fs.readFileSync(path.resolve(p), "utf8");
  } catch {
    die(`cannot read ${what} file: ${p}`);
  }
}

function printDuplicates(d: DuplicateReport): void {
  if (!d.exact.length && !d.possible.length) {
    console.log("No duplicates.");
    return;
  }
  for (const [label, list] of [
    ["EXACT DUPLICATE", d.exact],
    ["Possible duplicate / repost", d.possible],
  ] as const)
    for (const m of list)
      console.log(
        `${label}: ${m.kind} · ${m.status} · ${m.date} · ${m.company} — ${m.role}` +
          ` · ${m.reason}${m.similarity ? ` (${Math.round(m.similarity * 100)}%)` : ""}` +
          `${m.link ? ` · ${m.link}` : ""}${m.reviewPath ? ` · ${m.reviewPath}` : ""}` +
          `${m.key ? ` · key ${m.key}` : ""}`,
      );
}

const scoreArg = (v: string | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100) die(`bad score: ${v}`);
  return n;
};

/** Read-modify-write with one retry on a stale hash (another writer got in between). */
async function withFreshHash<T>(
  fn: (hash: string, apps: ApplicationsPayload) => Promise<T>,
): Promise<T> {
  for (let i = 0; ; i++) {
    const apps = await readApplications();
    if (apps.readOnly) die(apps.readOnly.reason);
    try {
      return await fn(apps.fileHash, apps);
    } catch (e) {
      if (i === 0 && e instanceof ConflictError) continue;
      throw e;
    }
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { values: o, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      "application-key": { type: "string" },
      text: { type: "string" },
      explanation: { type: "string" },
      "source-record-id": { type: "string" },
      link: { type: "string" },
      company: { type: "string" },
      role: { type: "string" },
      "job-id": { type: "string" },
      post: { type: "string" },
      analysis: { type: "string" },
      input: { type: "string" },
      lease: { type: "string" },
      resume: { type: "string" },
      source: { type: "string" },
      posted: { type: "string" },
      slug: { type: "string" },
      mode: { type: "string" },
      decision: { type: "string" },
      status: { type: "string" },
      date: { type: "string" },
      key: { type: "string" },
      to: { type: "string" },
      from: { type: "string" },
      next: { type: "string" },
      fit: { type: "string" },
      match: { type: "string" },
      lane: { type: "string" },
      json: { type: "boolean" },
      apply: { type: "boolean" },
      "received-at": { type: "string" },
      days: { type: "string" },
      wording: { type: "string" },
      kind: { type: "string" },
    },
  });
  const json = !!o.json;
  const out = (human: () => void, data: unknown) =>
    json ? console.log(JSON.stringify(data, null, 2)) : human();
  const today = cmd === "score" ? localDate() : localToday();

  switch (cmd) {
    case "tailor-context": {
      const { listReviews, findSaved } = await import("../src/lib/reviews");
      const { reviewForRecord, rowsForReview } =
        await import("../src/lib/applicationRecord");
      const query = (positionals.join(" ") || "").toLowerCase();
      const records = listReviews();
      const matches = records.filter(
        (r) =>
          r.id.toLowerCase() === query ||
          r.link.toLowerCase() === query ||
          `${r.company} ${r.role}`.toLowerCase().includes(query),
      );
      const candidates = matches.filter(
        (r) =>
          !r.sourceRecordId ||
          !matches.some((other) => other.id === r.sourceRecordId),
      );
      if (candidates.length !== 1)
        return console.log(JSON.stringify({ matches: candidates }, null, 2));
      const saved = findSaved(candidates[0].id)!;
      const review = reviewForRecord(saved.summary, records);
      const rows = (await readApplications()).rows;
      const reviewRecord = review
        ? (findSaved(review.id)?.record as import("../src/lib/runs").RunRecord)
        : null;
      let reviewReusable = false;
      try {
        (await import("../src/lib/claude/inputs")).assertSourcesCurrent(
          reviewRecord?.result.meta.sources,
        );
        reviewReusable = true;
      } catch {}
      return console.log(
        JSON.stringify(
          {
            saved,
            review: reviewRecord,
            reviewReusable,
            applications: rowsForReview({ ...saved.summary }, rows),
          },
          null,
          2,
        ),
      );
    }
    case "tailor-match-schema":
      return console.log(
        JSON.stringify(
          (await import("zod")).z.toJSONSchema(
            (await import("../src/lib/tailorMatch")).TailorMatchSchema,
            { target: "draft-7" },
          ),
          null,
          2,
        ),
      );
    case "tailor-match-context": {
      const { run, ...context } = (
        await import("../src/lib/tailorMatch")
      ).tailorMatchContext(positionals[0]);
      return console.log(JSON.stringify(context, null, 2));
    }
    case "tailor-match": {
      const result = (await import("../src/lib/tailorMatch")).recordTailorMatch(
        positionals[0],
        JSON.parse(readFileArg(o.analysis, "analysis")),
        "chat-session",
      );
      return console.log(JSON.stringify(result, null, 2));
    }
    case "recruiting": {
      const service = await import("../src/lib/recruiting");
      const op = positionals[0] ?? "list";
      let result;
      if (op === "sync" || op === "refresh") {
        const { guardMailCheck } = await import("../src/lib/mailSync");
        await guardMailCheck(o.lease, ["inbox", "actions", "quick"]);
      }
      if (op === "list") result = service.readRecruiting();
      else if (op === "refresh") result = await service.recruitingView();
      else if (op === "sync")
        result = await service.syncRecruiting(
          JSON.parse(readFileArg(o.input, "input")),
        );
      else if (op === "resolve")
        result = await service.resolveRecruiting(
          JSON.parse(readFileArg(o.input, "input")),
        );
      else if (op === "preview")
        result = await service.previewRecruiting(
          JSON.parse(readFileArg(o.input, "input")),
        );
      else die("recruiting expects list, refresh, sync, resolve or preview");
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case "mail": {
      const {
        readMailSync,
        syncMail,
        quickMailWindow,
        beginMailCheck,
        heartbeatMailCheck,
        failMailCheck,
        publishMailCheck,
        finishMailCheck,
      } = await import("../src/lib/mailSync");
      const operation = positionals[0] ?? "list";
      if (operation === "list")
        return console.log(JSON.stringify(readMailSync(), null, 2));
      const commands = {
        sync: syncMail,
        "quick-window": quickMailWindow,
        begin: beginMailCheck,
        heartbeat: heartbeatMailCheck,
        fail: failMailCheck,
        publish: publishMailCheck,
        finish: finishMailCheck,
      };
      if (!Object.hasOwn(commands, operation))
        die(
          "mail expects list, sync, quick-window, begin, heartbeat, fail, publish or finish",
        );
      const input: unknown = JSON.parse(readFileArg(o.input, "input"));
      return console.log(
        JSON.stringify(
          await commands[operation as keyof typeof commands](input),
          null,
          2,
        ),
      );
    }
    case "opportunities": {
      const { listOpportunities, saveOpportunity, selectOpportunities } =
        await import("../src/lib/opportunities");
      console.log(
        JSON.stringify(
          positionals[0] === "select"
            ? selectOpportunities(
                JSON.parse(readFileArg(o.input, "input")),
                o.mode,
                o.kind === "triage" ? "triage" : "full",
              )
            : positionals[0] === "save"
              ? await saveOpportunity(JSON.parse(readFileArg(o.input, "input")))
              : listOpportunities(),
          null,
          2,
        ),
      );
      return;
    }

    case "actions": {
      const {
        readActions,
        importNextActions,
        syncActions,
        relativeActionDeadline,
      } = await import("../src/lib/actions");
      const operation = positionals[0] ?? "list";
      if (operation === "add") {
        const { createManualAction } = await import("../src/lib/actions");
        if (!o["application-key"] || !o.text)
          die("actions add needs --application-key and --text");
        console.log(
          JSON.stringify(
            await createManualAction({
              fileHash: readActions().fileHash,
              applicationKey: o["application-key"],
              text: o.text,
              ...(o.explanation ? { explanation: o.explanation } : {}),
            }),
            null,
            2,
          ),
        );
        return;
      }
      if (operation === "preview") {
        const { previewActions } = await import("../src/lib/actions");
        console.log(
          JSON.stringify(
            previewActions(JSON.parse(readFileArg(o.input, "input"))),
            null,
            2,
          ),
        );
        return;
      }
      if (operation === "finalize") {
        const { guardMailCheck } = await import("../src/lib/mailSync");
        await guardMailCheck(undefined, []);
        const { finalizeActionsCheck } = await import("../src/lib/actions");
        console.log(
          JSON.stringify(
            await finalizeActionsCheck(
              JSON.parse(readFileArg(o.input, "input")),
            ),
            null,
            2,
          ),
        );
        return;
      }
      if (operation === "deadline") {
        if (
          !o["received-at"] ||
          !o.days ||
          !o.wording ||
          (o.kind && !["requested", "expires"].includes(o.kind))
        )
          die(
            "actions deadline needs --received-at ISO --days N --wording TEXT [--kind requested|expires]",
          );
        return console.log(
          JSON.stringify(
            relativeActionDeadline(
              o["received-at"],
              Number(o.days),
              o.wording,
              (o.kind ?? "requested") as "requested" | "expires",
            ),
            null,
            2,
          ),
        );
      }
      const { guardMailCheck } = await import("../src/lib/mailSync");
      let result;
      if (operation === "list") result = readActions();
      else if (operation === "import-next") {
        await guardMailCheck(o.lease, ["actions"]);
        result = await importNextActions();
      } else if (operation === "sync") {
        const input = JSON.parse(readFileArg(o.input, "input"));
        await guardMailCheck(
          o.lease,
          input?.scope === "quick" ? ["quick"] : ["actions"],
        );
        result = await syncActions(input);
      } else
        die("actions expects list, import-next, sync, finalize or deadline");
      return console.log(JSON.stringify(result, null, 2));
    }
    case "check": {
      const d = checkDuplicates({
        link: o.link,
        company: o.company,
        role: o.role,
        jobId: o["job-id"],
      });
      return out(() => {
        if (o.link)
          console.log(
            `link: ${normalizeUrl(o.link)}${jobKeyFromUrl(o.link) ? ` (${jobKeyFromUrl(o.link)})` : ""}`,
          );
        printDuplicates(d);
      }, d);
    }

    case "schema":
      return console.log(JSON.stringify(reviewJsonSchema(), null, 2));

    case "score": {
      const jobPost = readFileArg(o.post, "post");
      const raw = readFileArg(o.analysis, "analysis");
      const resume = (o.resume ?? "tech") as ResumeCategory;
      if (!["tech", "general", "datacenter"].includes(resume))
        die("--resume must be tech, general or datacenter");
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        die("analysis is not valid JSON");
      }
      const parsed = ReviewSchema.safeParse(
        parsedJson && typeof parsedJson === "object"
          ? { suggestedSlug: "", ...parsedJson }
          : parsedJson,
      );
      if (!parsed.success)
        die(
          "analysis doesn't match the schema:\n" +
            parsed.error.issues
              .slice(0, 10)
              .map((i) => `  ${i.path.join(".")}: ${i.message}`)
              .join("\n"),
        );
      const request: ScoreRequest = {
        jobPost,
        resume,
        ...(o["source-record-id"]
          ? { sourceRecordId: o["source-record-id"] }
          : {}),
        ...(o.link ? { link: o.link } : {}),
        ...(o.source ? { source: o.source } : {}),
      };
      if (request.sourceRecordId) {
        const saved = (await import("../src/lib/reviews")).findSaved(
          request.sourceRecordId,
        );
        if (!saved) die("Unknown source record ID");
        request.jobBrief = saved.record.request.jobBrief;
        request.originalJobPost =
          saved.record.request.originalJobPost || jobPost;
      }
      const snapshot = loadInputSnapshot(resume);
      normalizeReview(parsed.data);
      const result = finishReview(
        structuredClone(parsed.data),
        request,
        today,
        {
          model: "claude-code-session",
          durationMs: 0,
          sources: snapshot.sources,
        },
        randomUUID(),
        snapshot,
      );
      if (o.posted) {
        const { postingAge } = await import("../src/lib/scoring/age");
        result.age = postingAge(
          parsed.data.postedText,
          parsed.data.postedDate,
          jobPost,
          today,
          o.posted,
        );
      }
      // Every review is kept: the working run + records/reviews/<slug>.{json,md}.
      persistRun({
        version: 2,
        viewedAt: null,
        masterHashes: await hashMasters(),
        request,
        analysis: parsed.data,
        result,
        savedAt: new Date().toISOString(),
      });
      return out(() => {
        console.log(`${result.company} — ${result.role}`);
        for (const l of summaryLines(result)) console.log(l);
        console.log(`Why the recommendation: ${result.recommendation.reason}`);
        if (result.blockers.confirmed.length)
          console.log(
            "Hard blockers: " +
              result.blockers.confirmed
                .map((b) => `${b.type} (“${b.quote}”)`)
                .join("; "),
          );
        if (result.gaps.length)
          console.log("Gaps (don't claim): " + result.gaps.join("; "));
        if (result.warnings.length)
          console.log("Warnings:\n  " + result.warnings.join("\n  "));
        printDuplicates(result.duplicates);
        console.log(`runId: ${result.runId}`);
      }, result);
    }

    case "show": {
      const run = loadRun(positionals[0] ?? "") ?? die("unknown runId");
      return out(() => {
        console.log(`${run.result.company} — ${run.result.role}`);
        for (const l of summaryLines(run.result)) console.log(l);
      }, run.result);
    }

    case "brief": {
      const run = loadRun(positionals[0] ?? "") ?? die("unknown runId");
      const slug = o.slug ?? run.result.suggestedSlug;
      if (!isValidSlug(slug)) die(`invalid slug: ${slug}`);
      if (o.mode && !["light", "full"].includes(o.mode))
        die("--mode must be light or full");
      if (o.mode)
        console.error(
          "Tailoring now uses one dynamic scope; the legacy --mode option is ignored.",
        );
      run.masterHashes = await hashMasters();
      persistRun(run);
      return console.log(JSON.stringify(buildBrief(run, slug), null, 2));
    }

    case "save-review": {
      const run = loadRun(positionals[0] ?? "") ?? die("unknown runId");
      const d = o.decision as ReviewDecision | undefined;
      if (d && !["applied", "later", "skip", "undecided"].includes(d))
        die("--decision must be applied, later or skip");
      if (d) recordDecision(run.result.runId, d);
      const saved = saveReview(loadRun(run.result.runId) ?? run, d);
      return out(() => console.log(`saved: ${saved.mdPath}`), saved);
    }

    case "validate-tailor": {
      const id = positionals[0] ?? die("runId required");
      if (!o.slug) die("--slug is required");
      const reviewed = await validateCliTailor(
        id,
        o.slug,
        JSON.parse(readFileArg(o.analysis, "analysis")),
      );
      return out(
        () =>
          console.log(
            JSON.stringify(
              {
                contentDiff: reviewed.contentDiff,
                evidence: reviewed.changes,
                hashes: reviewed.hashes,
                source: reviewed.texPath,
                pdf: reviewed.pdfPath,
                png: reviewed.pngUrl,
              },
              null,
              2,
            ),
          ),
        reviewed,
      );
    }

    case "log":
    case "add": {
      const status = o.status;
      if (status !== "applied" && status !== "later")
        die("--status must be applied or later");
      let row;
      if (cmd === "log") {
        const run = loadRun(positionals[0] ?? "") ?? die("unknown runId");
        const r = run.result;
        const resume = o.resume ?? r.resume;
        // Match belongs to the resume actually sent: the reviewed master, or the tailored one's
        // recomputed Match when it was tailored in this run; otherwise unknown.
        const match =
          resume === r.resume
            ? r.match.total
            : run.tailor && resume === `tailored/${run.tailor.slug}`
              ? run.tailor.actualMatch
              : null;
        row = {
          company: r.company,
          role: r.role,
          lane: (o.lane ?? laneForResume(resume, r.resume)) as
            "tech" | "bridge",
          resume,
          fit: r.fit.total,
          match,
          source: o.source ?? run.request.source ?? "Other",
          link: o.link ?? r.link ?? "",
        };
      } else {
        if (!o.company || !o.role || !o.resume)
          die("add needs --company, --role and --resume");
        row = {
          company: o.company,
          role: o.role,
          lane: (o.lane ?? defaultResumeLane(o.resume)) as "tech" | "bridge",
          resume: o.resume,
          fit: scoreArg(o.fit),
          match: scoreArg(o.match),
          source: o.source ?? "Other",
          link: o.link ?? "",
        };
      }
      const res = await withFreshHash((fileHash) =>
        upsertApplication(
          {
            fileHash,
            ...(cmd === "log" ? { reviewId: positionals[0] } : {}),
            decision: status === "applied" ? "submitted" : "later",
            ...(o.date ? { date: o.date } : {}),
            row,
          },
          today,
        ),
      );
      if (cmd === "log")
        recordDecision(
          positionals[0]!,
          status === "applied" ? "applied" : "later",
        );
      return out(
        () =>
          console.log(
            `${res.action === "updated" ? "Updated the saved-for-later row" : "Added a row"}: ${row.company} — ${row.role} (${status === "applied" ? "applied" : "to apply"})`,
          ),
        { action: res.action, rowKey: res.rowKey },
      );
    }

    case "mark-applied": {
      let key = o.key;
      if (!key) {
        if (!o.link) die("mark-applied needs --link or --key");
        const d = checkDuplicates({ link: o.link });
        const hits = d.exact.filter(
          (m) => m.kind === "application" && m.status === "to apply",
        );
        if (hits.length !== 1)
          die(
            hits.length
              ? "more than one saved-for-later row matches; use --key"
              : "no saved-for-later row matches that link",
          );
        key = hits[0].key!;
      }
      await withFreshHash((fileHash) =>
        updateRow(
          fileHash,
          key!,
          { status: "applied", ...(o.date ? { date: o.date } : {}) },
          today,
        ),
      );
      return out(() => console.log("Marked applied."), { key });
    }

    case "status": {
      if (o.lease) {
        const { guardMailCheck } = await import("../src/lib/mailSync");
        // Inbox owns status sync; Actions may close same-role duplicate rows. Quick never writes status.
        await guardMailCheck(o.lease, ["inbox", "actions"]);
      }
      const to = o.to as Status;
      if (!(STATUSES as readonly string[]).includes(to ?? ""))
        die(`--to must be one of: ${STATUSES.join(", ")}`);
      if (
        o.from !== undefined &&
        !(STATUSES as readonly string[]).includes(o.from)
      )
        die(`--from must be one of: ${STATUSES.join(", ")}`);
      let key = o.key;
      if (!key) {
        if (!o.link) die("status needs --link or --key");
        const hits = checkDuplicates({ link: o.link }).exact.filter(
          (m) => m.kind === "application",
        );
        if (hits.length !== 1)
          die(
            hits.length
              ? "more than one row matches that link; use --key (see: check --link)"
              : "no application row matches that link",
          );
        key = hits[0].key!;
      }
      let stored: string = to;
      await withFreshHash(async (fileHash, apps) => {
        stored = storedStatus(
          apps.rows.find((row) => row.key === key)?.status ?? "",
          to,
        );
        if (o.from !== undefined) {
          const hits = apps.rows.filter((row) => row.key === key);
          if (hits.length !== 1)
            throw new ConflictError(
              "Expected one application for guarded status update",
            );
          // A lost response can safely replay an already-applied status-only change.
          if (
            storedStatus(hits[0].status, to) === hits[0].status &&
            o.next === undefined &&
            o.date === undefined
          )
            return apps;
          if (hits[0].status !== o.from)
            throw new ConflictError(
              "Application status changed; re-read before updating",
            );
        }
        return updateRow(
          fileHash,
          key!,
          {
            status: to,
            ...(o.date ? { date: o.date } : {}),
            ...(o.next !== undefined ? { next: o.next } : {}),
          },
          today,
        );
      });
      return out(() => console.log(`Status → ${stored}.`), {
        key,
        status: stored,
      });
    }

    case "skip": {
      if (!recordDecision(positionals[0] ?? "", "skip")) die("unknown runId");
      return out(() => console.log("Skipped (recorded on the review)."), {
        skipped: true,
      });
    }

    case "quick": {
      // Quick add without a review: Claude Code extracts the fields itself (QuickSchema JSON), this
      // validates them, writes the row (Fit/Match blank) and keeps the full description.
      const jobPost = readFileArg(o.post, "post");
      const raw = readFileArg(o.analysis, "analysis");
      const status = o.status;
      if (status !== "applied" && status !== "later")
        die("--status must be applied or later");
      let j: unknown;
      try {
        j = JSON.parse(raw);
      } catch {
        die("extract is not valid JSON");
      }
      const parsed = QuickSchema.safeParse(j);
      if (!parsed.success)
        die(
          "extract doesn't match the quick schema:\n" +
            parsed.error.issues
              .slice(0, 10)
              .map((i) => `  ${i.path.join(".")}: ${i.message}`)
              .join("\n"),
        );
      const request = {
        jobPost,
        ...(o.link ? { link: o.link } : {}),
        ...(o.source ? { source: o.source } : {}),
      };
      const result = prepareQuick(parsed.data, request, today);
      savePending({ request, result, today });
      const resume = o.resume ?? parsed.data.suggestedResume;
      const { upsert, mdPath } = await logQuick(
        result.quickId,
        {
          decision: status === "applied" ? "submitted" : "later",
          company: parsed.data.company,
          role: parsed.data.role,
          resume,
          lane: (o.lane ?? defaultResumeLane(resume)) as "tech" | "bridge",
          source: o.source ?? "Other",
          ...(o.link ? { link: o.link } : {}),
          ...(o.date ? { date: o.date } : {}),
        },
        today,
      );
      return out(
        () => {
          printDuplicates(result.duplicates);
          console.log(
            `${upsert.action === "updated" ? "Updated the saved-for-later row" : "Added a row"}: ${parsed.data.company} — ${parsed.data.role} (${status === "applied" ? "applied" : "to apply"}) · kept: ${mdPath}`,
          );
        },
        { action: upsert.action, mdPath },
      );
    }

    case "quick-schema":
      return console.log(
        JSON.stringify(
          (await import("../src/lib/claude/schemas")).quickJsonSchema(),
          null,
          2,
        ),
      );

    case "today":
    case "week": {
      const apps = await readApplications();
      const p = computeProgress(apps.rows, today, mondayToSunday(today));
      return out(
        () => {
          if (cmd === "today")
            console.log(
              `Today (${p.today.date}): ${p.today.tech}/${p.today.target} tech applications` +
                (p.today.bridge ? ` · ${p.today.bridge} bridge` : "") +
                ` · ${p.queued} saved for later`,
            );
          else
            console.log(
              `Week ${p.week.from} → ${p.week.to}: ${p.week.tech}/${p.week.target} tech` +
                (p.week.bridge ? ` · ${p.week.bridge} bridge` : "") +
                ` · active weekdays ${p.streak.activeDaysThisWeek}`,
            );
        },
        cmd === "today" ? p.today : p.week,
      );
    }

    case "reclassify-unsuccessful": {
      // One-time backfill: rows stored as Rejected whose rejection arrived while the application was
      // In progress (saved on the recruiting event as wasInProgress) become Unsuccessful.
      // Dry run unless --apply is given, so the list can be reviewed first.
      const { readRecruiting } = await import("../src/lib/recruiting");
      const { applicationFor } = await import("../src/lib/recruitingTypes");
      const rows = (await readApplications()).rows;
      const keys = new Set<string>();
      for (const event of readRecruiting().events) {
        if (event.kind !== "rejected" || !event.wasInProgress) continue;
        const row = applicationFor(event, rows);
        if (row && row.status === "rejected") keys.add(row.key);
      }
      const targets = rows.filter((row) => keys.has(row.key));
      if (o.apply) {
        for (const target of targets) {
          const { fileHash } = await readApplications();
          await updateRow(
            fileHash,
            target.key,
            { status: "unsuccessful" },
            today,
          );
        }
      }
      return out(
        () => {
          console.log(
            `${targets.length} Rejected application(s) were In progress first:`,
          );
          for (const t of targets)
            console.log(`- ${t.company} — ${t.role} (${t.source || "?"})`);
          console.log(
            o.apply
              ? "Updated to Unsuccessful."
              : "Dry run. Re-run with --apply to update them.",
          );
        },
        {
          applied: !!o.apply,
          applications: targets.map((t) => ({
            key: t.key,
            company: t.company,
            role: t.role,
          })),
        },
      );
    }

    case "migrate": {
      const changed = await migrateApplicationsFile();
      return out(
        () =>
          console.log(
            changed
              ? "Migrated records/applications.md to the Record ID table (check: git diff)."
              : "Already current; nothing to do.",
          ),
        { changed },
      );
    }

    default:
      console.log(USAGE);
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
