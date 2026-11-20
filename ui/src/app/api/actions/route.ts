import { NextResponse } from "next/server";
import {
  readActions,
  changeGroupVisibility,
  deleteActionGroup,
  deleteHistoryCategory,
  transitionCompletedActions,
  markActionsSeen,
} from "@/lib/actions";
import { z } from "zod";
import { parseBody, errorResponse } from "@/lib/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(readActions());
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request) {
  try {
    return NextResponse.json(
      await changeGroupVisibility(await parseBody(req, z.unknown())),
    );
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, z.unknown());
    return NextResponse.json(
      await (input &&
      typeof input === "object" &&
      "operation" in input &&
      input.operation === "seen-new"
        ? markActionsSeen(input)
        : transitionCompletedActions(input)),
    );
  } catch (e) {
    return errorResponse(e);
  }
}

// Permanently delete one group's action history (Closed tab).
export async function DELETE(req: Request) {
  try {
    const input = await parseBody(req, z.unknown());
    return NextResponse.json(
      await (input && typeof input === "object" && "category" in input
        ? deleteHistoryCategory(input)
        : deleteActionGroup(input)),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
