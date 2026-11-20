// Shared route-handler helpers: error → HTTP mapping (docs/05-api.md "Error body") and zod parsing.
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { NotFoundError, ReadOnlyError, ValidationError } from "./applications";
import { ConflictError, LockedError } from "./fileStore";
import { AgentError } from "./claude/agent";
import type { ApiErrorCode } from "./types";

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function fail(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown,
) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

/** Map any thrown error to the documented JSON error body. */
export function errorResponse(e: unknown) {
  if (e instanceof AgentError)
    return fail(
      e.kind === "source-conflict" ? "CONFLICT" : "CLAUDE_UNAVAILABLE",
      e.message,
      e.kind === "source-conflict" ? 409 : 503,
    );
  if (e instanceof ApiError)
    return fail(e.code, e.message, e.status, e.details);
  if (e instanceof ValidationError)
    return fail("VALIDATION", e.message, 400, e.details);
  if (e instanceof ZodError)
    return fail("VALIDATION", "Invalid input", 400, e.issues);
  if (e instanceof NotFoundError)
    return fail("NOT_FOUND", e.message || "Not found", 404);
  if (e instanceof ConflictError) return fail("CONFLICT", e.message, 409);
  if (e instanceof LockedError) return fail("LOCKED", e.message, 423);
  if (e instanceof ReadOnlyError) return fail("LOCKED", e.message, 423);
  console.error(e);
  return fail(
    "INTERNAL",
    e instanceof Error ? e.message : "Internal error",
    500,
  );
}

/** Parse a JSON body with zod; throws ZodError (→ 400) on bad input. */
export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<T> {
  // Cross-site pages can only send "simple" content types without a preflight; requiring JSON
  // makes a blind cross-origin POST fail before it reaches any handler logic.
  if (
    !(req.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("application/json")
  ) {
    throw new ApiError(
      "VALIDATION",
      "Content-Type must be application/json",
      400,
    );
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ApiError("VALIDATION", "Body must be JSON", 400);
  }
  return schema.parse(json);
}

export { localToday } from "./config";
