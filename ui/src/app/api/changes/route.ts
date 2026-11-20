import fs from "node:fs";
import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { resolveExpected } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Source files whose changes the screens care about. A token is the file's (or directory's) inode,
// mtime and size: every controlled write goes through an atomic rename, so any change differs.
const WATCHED = {
  applications: "records/applications.md",
  links: "records/application-links.json",
  actions: "records/actions.json",
  mail: "records/mail-sync.json",
  recruiting: "records/recruiting.json",
  reviews: "records/reviews",
  runs: "ui/.cache/runs",
  opportunities: "records/opportunities",
  workshop: "ui/.workshop/snapshot.json",
} as const;

function token(rel: string): string {
  try {
    const st = fs.statSync(resolveExpected(rel));
    return `${st.ino}:${st.mtimeMs}:${st.size}`;
  } catch {
    return "-"; // missing (a store not created yet) is a valid, stable state
  }
}

// What the client store polls instead of every endpoint: ten stat calls, about 300 bytes. A screen
// refetches a resource only when a file behind it changed, from this UI or from the CLI.
export function GET() {
  try {
    return NextResponse.json({
      tokens: Object.fromEntries(
        Object.entries(WATCHED).map(([name, rel]) => [name, token(rel)]),
      ),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
