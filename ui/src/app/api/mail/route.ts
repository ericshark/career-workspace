import { NextResponse } from "next/server";
import { z } from "zod";
import { dismissMailReview, readMailSync } from "@/lib/mailSync";
import { attemptView } from "@/lib/checkJournal";
import { errorResponse, parseBody } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { checkAttempts, ...mail } = readMailSync();
    return NextResponse.json({
      ...mail,
      checkAttempts: checkAttempts?.map(attemptView),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request) {
  try {
    const { messageId } = await parseBody(
      req,
      z.object({ messageId: z.string().trim().min(1) }).strict(),
    );
    await dismissMailReview(messageId);
    return NextResponse.json({ dismissed: messageId });
  } catch (e) {
    return errorResponse(e);
  }
}
