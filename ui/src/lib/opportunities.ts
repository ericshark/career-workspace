import fs from "node:fs";
import { z } from "zod";

import { resolveExpected } from "./paths";
import { atomicWrite, sha256, withFileLock } from "./fileStore";
import { localDate } from "./config";
const schema = z
  .object({
    id: z.uuid().optional(),
    opportunityKey: z.string().min(1),
    fingerprint: z.string().min(1),
    company: z.string().min(1),
    role: z.string().min(1),
    applicationKey: z.string().optional(),
    recordId: z.string().optional(),
    actionIds: z.array(z.uuid()).default([]),
    receivedAt: z.iso.datetime({ offset: true }),
    researchedAt: z.iso.datetime({ offset: true }),
    depth: z.enum(["triage", "full"]),
    complete: z.boolean(),
    verdict: z.enum([
      "Prioritize",
      "Give It a Try",
      "Skip",
      "Avoid — Suspected Scam",
    ]),
    markdown: z.string().min(1),
    sources: z.array(z.object({ title: z.string(), url: z.url() })),
  })
  .strict();
export type OpportunityReport = z.infer<typeof schema>;
const directory = () => resolveExpected("records/opportunities");
export function listOpportunities() {
  if (!fs.existsSync(directory())) return [];
  return fs
    .readdirSync(directory())
    .filter((n) => n.endsWith(".json"))
    .map((n) =>
      schema.parse(
        JSON.parse(
          fs.readFileSync(
            resolveExpected(`records/opportunities/${n}`),
            "utf8",
          ),
        ),
      ),
    )
    .sort((a, b) => Date.parse(b.researchedAt) - Date.parse(a.researchedAt));
}
export async function saveOpportunity(input: unknown) {
  const report = schema.parse(input);
  // Identical retry input keeps its ID after a Markdown write failure; a recheck has a new researchedAt.
  const hash = sha256(JSON.stringify(report));
  const id =
    report.id ??
    `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const stem = `records/opportunities/${id}`;
  const file = resolveExpected(`${stem}.json`);
  fs.mkdirSync(directory(), { recursive: true });
  const saved = { ...report, id };
  const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  await withFileLock(
    file,
    sha256(raw),
    (current) => {
      if (
        current &&
        JSON.stringify(schema.parse(JSON.parse(current))) !==
          JSON.stringify(schema.parse(saved))
      )
        throw new Error("Report already exists with different content");
      return JSON.stringify(saved, null, 2) + "\n";
    },
    {
      initialText: "",
      lockPath: resolveExpected(`ui/.cache/opportunity-${id}.lock`),
    },
  );
  atomicWrite(
    resolveExpected(`${stem}.md`),
    `# ${report.company} — ${report.role}\n\n${report.depth} · ${report.researchedAt} · ${report.complete ? "Complete" : "Incomplete"}\n\n${report.markdown}\n\n## Sources\n\n${report.sources.map((s) => `- [${s.title}](${s.url})`).join("\n")}\n`,
  );
  return saved;
}
/** Selection compares fresh evidence with successful history, never with a global time alone. */
export function selectOpportunities(
  input: unknown,
  mode = "all",
  depth: "triage" | "full" = "full",
  now = new Date(),
) {
  const candidates = z
    .array(
      z
        .object({
          opportunityKey: z.string().min(1),
          fingerprint: z.string().min(1),
          receivedAt: z.iso.datetime({ offset: true }),
        })
        .passthrough(),
    )
    .parse(input);
  const reports = listOpportunities();
  return candidates.filter((c) =>
    mode === "today"
      ? localDate(new Date(c.receivedAt)) === localDate(now)
      : mode === "since"
        ? !reports.some(
            (r) =>
              r.opportunityKey === c.opportunityKey &&
              r.fingerprint === c.fingerprint &&
              r.complete &&
              // JSON is written first; a failed Markdown write must remain retryable.
              !!r.id &&
              fs.existsSync(
                resolveExpected(`records/opportunities/${r.id}.md`),
              ) &&
              (depth === "triage" || r.depth === "full"),
          )
        : true,
  );
}

/** Points saved research at an application's new row key after it was edited. */
export function rekeyOpportunities(
  oldKey: string,
  newKey: string,
  recordId: string,
) {
  if (!fs.existsSync(directory())) return;
  for (const name of fs.readdirSync(directory())) {
    if (!name.endsWith(".json")) continue;
    const path = resolveExpected(`records/opportunities/${name}`);
    const report = JSON.parse(fs.readFileSync(path, "utf8")) as {
      applicationKey?: string;
      recordId?: string;
    };
    if (
      report.applicationKey !== oldKey ||
      (report.recordId && report.recordId !== recordId)
    )
      continue;
    report.applicationKey = newKey;
    report.recordId = recordId;
    atomicWrite(path, JSON.stringify(report, null, 2) + "\n");
  }
}
