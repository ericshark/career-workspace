import { z } from "zod";
import { parseBody, errorResponse } from "@/lib/api";
import {
  connectionStatus,
  disconnectChatGpt,
  setOpenAiMode,
  startChatGpt,
} from "@/lib/claude/chatgpt-connection";

export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(connectionStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function POST(request: Request) {
  try {
    const { action } = await parseBody(
      request,
      z.object({ action: z.enum(["connect", "disconnect", "key", "chatgpt"]) }),
    );
    if (action === "connect")
      return Response.json({
        url: await startChatGpt(new URL(request.url).port),
      });
    if (action === "disconnect") await disconnectChatGpt();
    else await setOpenAiMode(action);
    return GET();
  } catch (error) {
    return errorResponse(error);
  }
}
