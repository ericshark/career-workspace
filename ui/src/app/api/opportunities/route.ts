import { NextResponse } from "next/server";
import { listOpportunities } from "@/lib/opportunities";
import { errorResponse } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return NextResponse.json(listOpportunities());
  } catch (e) {
    return errorResponse(e);
  }
}
