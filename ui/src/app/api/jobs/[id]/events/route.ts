import { ApiError, errorResponse } from "@/lib/api";
import { getJob, subscribe } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSE: replays buffered events, streams new ones, heartbeat every 15 s so proxies/browsers keep it open.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const job = getJob(id);
    if (!job) throw new ApiError("NOT_FOUND", "Unknown job", 404);
    const enc = new TextEncoder();
    // Browsers resend the last event id they saw when EventSource auto-reconnects. The registry
    // replays its whole buffer, so skip what the client already has (otherwise steps duplicate).
    const lastSeen = Number(req.headers.get("last-event-id") ?? "-1");
    let index = -1;
    let unsub = () => {};
    let beat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream({
      start(controller) {
        const send = (chunk: string) => {
          try {
            controller.enqueue(enc.encode(chunk));
          } catch {
            /* client went away */
          }
        };
        // Start the heartbeat before subscribing: replaying a finished job's terminal event closes the
        // stream synchronously and must be able to clear it.
        beat = setInterval(() => send(": ping\n\n"), 15_000);
        unsub = subscribe(job, (e) => {
          index += 1;
          if (index > lastSeen) {
            send(
              `id: ${index}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`,
            );
          }
          if (e.type === "done" || e.type === "error") {
            clearInterval(beat);
            unsub();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        });
      },
      cancel() {
        clearInterval(beat);
        unsub();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
