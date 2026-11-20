import { NextResponse } from "next/server";
import {
  preferencesSchema,
  readPreferences,
  savePreferences,
} from "@/lib/preferences";
import { errorResponse, parseBody } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(readPreferences());
  } catch (e) {
    return errorResponse(e);
  }
}
export async function PUT(req: Request) {
  try {
    const p = await parseBody(req, preferencesSchema);
    savePreferences(p);
    return NextResponse.json(p);
  } catch (e) {
    return errorResponse(e);
  }
}
