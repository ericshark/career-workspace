"use client";
// Answers every /api request in the browser and blocks requests to any other site.
let backend: Promise<typeof import("./backend")> | undefined;

if (typeof window !== "undefined" && !(window as { __demo?: boolean }).__demo) {
  (window as { __demo?: boolean }).__demo = true;
  try {
    // Every visit starts from the sample workspace.
    for (const key of Object.keys(localStorage))
      if (
        (key.startsWith("career-ui.") && key !== "career-ui.theme") ||
        key.startsWith("workshop:")
      )
        localStorage.removeItem(key);
  } catch {
    /* storage may be blocked */
  }
  const native = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.origin !== location.origin)
      throw new TypeError("The demo makes no outside requests.");
    if (!url.pathname.startsWith("/api/")) return native(input, init);
    backend ??= import("./backend");
    return (await backend).handle(req);
  };
}

export function Runtime() {
  return null;
}
