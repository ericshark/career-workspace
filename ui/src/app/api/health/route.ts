import { readApplications } from "@/lib/applications";
import { readPreferences } from "@/lib/preferences";
import { CAREER_ROOT } from "@/lib/paths";
import { connectionStatus } from "@/lib/claude/chatgpt-connection";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const { readOnly } = await readApplications();
    const { provider } = readPreferences();
    const connection = connectionStatus();
    const connected =
      provider === "claude"
        ? connection.claudeKey
        : connection.mode === "chatgpt"
          ? connection.connected
          : connection.openAiKey;
    return Response.json({
      provider,
      connected,
      careerRoot: CAREER_ROOT,
      applicationsReadOnly: readOnly,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
