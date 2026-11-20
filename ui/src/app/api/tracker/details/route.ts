import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { trackerDetails } from "@/lib/trackerDetails";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    return NextResponse.json(
      await trackerDetails(new URL(req.url).searchParams.get("id") ?? ""),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
