import { errorResponse } from "@/lib/api";
import { getPdf } from "@/lib/library";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const query = new URL(req.url).searchParams;
    const bytes = await getPdf(query.get("id") ?? "");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": query.has("download")
          ? 'attachment; filename="document.pdf"'
          : "inline",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
