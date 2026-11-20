import { finishChatGpt } from "@/lib/claude/chatgpt-connection";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  let result = "failed";
  try {
    result = (await finishChatGpt(url)) ? "connected" : "permission";
  } catch {}
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/apply?chatgpt=" + result,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
