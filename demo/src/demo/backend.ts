// Runs the app's own API routes in the browser against the in-memory workspace.
import { REVIEW_MODEL, seed } from "./seed";
import * as actions from "@/app/api/actions/route";
import * as action from "@/app/api/actions/[id]/route";
import * as applications from "@/app/api/applications/route";
import * as undo from "@/app/api/applications/undo/route";
import * as changes from "@/app/api/changes/route";
import * as library from "@/app/api/library/route";
import * as mail from "@/app/api/mail/route";
import * as opportunities from "@/app/api/opportunities/route";
import * as preferences from "@/app/api/preferences/route";
import * as progress from "@/app/api/progress/route";
import * as quick from "@/app/api/quick/route";
import * as quickControl from "@/app/api/quick/control/route";
import * as quickStatus from "@/app/api/quick/status/route";
import * as recruiting from "@/app/api/recruiting/route";
import * as reviews from "@/app/api/reviews/route";
import * as review from "@/app/api/reviews/[runId]/route";
import * as decision from "@/app/api/reviews/[runId]/decision/route";
import * as view from "@/app/api/reviews/[runId]/view/route";
import * as run from "@/app/api/runs/[runId]/route";
import * as score from "@/app/api/score/route";
import * as scoreCancel from "@/app/api/score/cancel/route";
import * as scoreStatus from "@/app/api/score/status/route";
import * as details from "@/app/api/tracker/details/route";
import * as workshop from "@/app/api/workshop/route";

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => unknown;
const ROUTES: [string, object][] = [
  ["actions", actions],
  ["actions/:id", action],
  ["applications", applications],
  ["applications/undo", undo],
  ["changes", changes],
  ["library", library],
  ["mail", mail],
  ["opportunities", opportunities],
  ["preferences", preferences],
  ["progress", progress],
  ["quick", quick],
  ["quick/control", quickControl],
  ["quick/status", quickStatus],
  ["recruiting", recruiting],
  ["reviews", reviews],
  ["reviews/:runId", review],
  ["reviews/:runId/decision", decision],
  ["reviews/:runId/view", view],
  ["runs/:runId", run],
  ["score", score],
  ["score/cancel", scoreCancel],
  ["score/status", scoreStatus],
  ["tracker/details", details],
  ["workshop", workshop],
];

function match(pattern: string, path: string) {
  const a = pattern.split("/");
  const b = path.split("/");
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(":")) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

const localOnly = () =>
  Response.json(
    {
      error: {
        code: "CLAUDE_UNAVAILABLE",
        message: "Available in the local edition. See How to set it up.",
      },
    },
    { status: 501 },
  );

// No model ran, so a review must never name one beside its scores.
async function label(res: Response): Promise<Response> {
  if (res.status === 204 || !res.headers.get("content-type")?.includes("json"))
    return res;
  const text = (await res.text()).replaceAll(
    `"model":"${REVIEW_MODEL}"`,
    '"model":"Prepared example"',
  );
  return new Response(text, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

seed();

export async function handle(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname
    .replace(/^\/api\//, "")
    .replace(/\/$/, "");
  // Connection status: the demo has no accounts.
  if (path === "health")
    return Response.json({
      provider: "openai",
      connected: false,
      careerRoot: "",
      applicationsReadOnly: false,
    });
  if (path === "ai-connection" && req.method === "GET")
    return Response.json({
      mode: "key",
      openAiKey: false,
      claudeKey: false,
      connected: false,
    });
  // File imports stay local.
  if (req.headers.get("content-type")?.startsWith("multipart/"))
    return localOnly();
  for (const [pattern, module] of ROUTES) {
    const params = match(pattern, path);
    const handler =
      params && (module as Record<string, Handler | undefined>)[req.method];
    if (handler)
      return label(
        (await handler(req, { params: Promise.resolve(params) })) as Response,
      );
  }
  return localOnly();
}
