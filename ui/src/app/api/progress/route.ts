import { NextResponse } from "next/server";
import { errorResponse, localToday } from "@/lib/api";
import { readApplications } from "@/lib/applications";
import { computeProgress } from "@/lib/progress";
import { mondayToSunday } from "@/lib/progress";

import {
  ageApplicationsOncePerDay,
  maintenanceWarning,
} from "@/lib/maintenance";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Keeps No Response aging current on a server that stays up across midnight.
    await ageApplicationsOncePerDay();
    const today = localToday();
    const apps = await readApplications();
    const week = mondayToSunday(today);
    return NextResponse.json({
      ...computeProgress(apps.rows, today, week, null),
      maintenanceWarning: maintenanceWarning(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
