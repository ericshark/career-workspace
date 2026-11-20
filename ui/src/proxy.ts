// Blocks DNS-rebinding and cross-site requests against the local server (binding to 127.0.0.1 alone
// doesn't: a malicious page can still make the browser call http://127.0.0.1:<port>).
//  - Host must be localhost / 127.0.0.1 / [::1] (a rebound attacker hostname is rejected).
//  - For anything that changes state, a browser-sent Origin must match the Host (same origin).
//    Non-browser clients (curl, tests) send no Origin and are allowed.
import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  if (!LOCAL_HOSTS.has(hostname)) {
    return new NextResponse("Forbidden host", { status: 403 });
  }
  const safe = req.method === "GET" || req.method === "HEAD";
  const origin = req.headers.get("origin");
  if (!safe && origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      /* malformed Origin: rejected below */
    }
    if (originHost !== host.toLowerCase()) {
      return new NextResponse("Forbidden origin", { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/:path*" };
