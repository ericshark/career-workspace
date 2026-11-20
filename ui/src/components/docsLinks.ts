// Pure helpers for the Guide reader: rewrite relative markdown links to /guide/... routes.

import { DOC_PATH_RE } from "@/lib/docsConfig";

export type LinkTarget =
  | { kind: "doc"; href: string } // another allowlisted doc → in-app route
  | { kind: "external"; href: string }
  | { kind: "anchor"; href: string }
  | { kind: "plain" }; // code files etc. → rendered as plain text

/** Join a relative href onto the directory of `fromPath`, resolving . and ..; null if it escapes the root. */
export function resolveRelative(fromPath: string, rel: string): string | null {
  const parts = fromPath.split("/").slice(0, -1);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

export function classifyLink(
  fromPath: string,
  href: string | undefined,
): LinkTarget {
  if (!href) return { kind: "plain" };
  if (href.startsWith("#")) return { kind: "anchor", href };
  if (/^(https?:|mailto:)/i.test(href)) return { kind: "external", href };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "plain" }; // other schemes (javascript: etc.)
  const [pathPart, hash] = href.split("#");
  let decoded = pathPart;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    /* keep raw */
  }
  // Root-relative ("/guide/x.md") is treated as relative to the career root.
  const resolved = decoded.startsWith("/")
    ? resolveRelative("x", decoded.slice(1))
    : resolveRelative(fromPath, decoded);
  if (!resolved || !DOC_PATH_RE.test(resolved)) return { kind: "plain" };
  return {
    kind: "doc",
    href:
      "/guide/" +
      resolved.split("/").map(encodeURIComponent).join("/") +
      (hash ? `#${hash}` : ""),
  };
}
