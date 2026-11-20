import fs from "node:fs";
import path from "node:path";
import { ApiError, errorResponse } from "@/lib/api";
import { CAREER_ROOT, resolveInside } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves only resumes/**/Resume.pdf and ui/.cache/png/*.png (docs/05-api.md allowlist).
const ALLOWED: [RegExp, string][] = [
  [/^resumes\/(?:[a-z0-9-]+\/)+Resume\.pdf$/i, "application/pdf"],
  [/^ui\/\.cache\/png\/[A-Za-z0-9_.-]+\.png$/, "image/png"],
];

export async function GET(req: Request) {
  try {
    const p = new URL(req.url).searchParams.get("path") ?? "";
    const rule = ALLOWED.find(([re]) => re.test(p));
    if (!rule) throw new ApiError("VALIDATION", "Path not allowed", 400);
    const real = resolveInside(CAREER_ROOT, p);
    if (!real) throw new ApiError("VALIDATION", "Path not allowed", 400);
    // Re-check the allowlist on the real path so a symlink can't point at another file type or place.
    const rel = path
      .relative(fs.realpathSync(CAREER_ROOT), real)
      .split(path.sep)
      .join("/");
    if (!ALLOWED.some(([re]) => re.test(rel)))
      throw new ApiError("VALIDATION", "Path not allowed", 400);
    if (!fs.existsSync(real))
      throw new ApiError("NOT_FOUND", "File not found", 404);
    return new Response(new Uint8Array(fs.readFileSync(real)), {
      headers: { "Content-Type": rule[1], "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
