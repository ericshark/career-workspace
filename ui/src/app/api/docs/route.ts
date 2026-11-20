import { NextResponse } from "next/server";
import { ApiError, errorResponse } from "@/lib/api";
import { docsTree, readDoc } from "@/lib/docs";
import { DOC_PATH_RE } from "@/lib/docsConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No ?path → the tree; with ?path=profile/career.md → { path, markdown }.
export async function GET(req: Request) {
  try {
    const p = new URL(req.url).searchParams.get("path");
    if (!p) return NextResponse.json(await docsTree());
    const markdown = await readDoc(p);
    if (markdown === null) {
      // Disallowed paths are a client error; allowed-but-missing is a 404.
      const allowed = DOC_PATH_RE.test(p) && !p.split("/").includes("..");
      throw new ApiError(
        allowed ? "NOT_FOUND" : "VALIDATION",
        allowed ? "Doc not found" : "Path not allowed",
        allowed ? 404 : 400,
      );
    }
    return NextResponse.json({ path: p, markdown });
  } catch (e) {
    return errorResponse(e);
  }
}
