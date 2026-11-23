// Serves out/ the way Vercel does (clean URLs and the headers in vercel.json). PORT defaults to 4100.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const demo = path.resolve(import.meta.dirname, "..");
const out = path.join(demo, "out");
const vercel = JSON.parse(
  fs.readFileSync(path.join(demo, "vercel.json"), "utf8"),
);
const redirects = vercel.redirects;
const headers = Object.fromEntries(
  vercel.headers[0].headers.map(({ key, value }) => [key, value]),
);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".mjs": "text/javascript",
};

export function serve(port) {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const redirect = redirects.find((r) => r.source === name);
    if (redirect) {
      res.writeHead(308, { location: redirect.destination });
      return void res.end();
    }
    const base = path.join(out, path.normalize(name));
    const file = [base, `${base}.html`, path.join(base, "index.html")].find(
      (f) => f.startsWith(out) && fs.existsSync(f) && fs.statSync(f).isFile(),
    );
    const target = file ?? path.join(out, "404.html");
    res.writeHead(file ? 200 : 404, {
      ...headers,
      "content-type": types[path.extname(target)] ?? "application/octet-stream",
    });
    fs.createReadStream(target).pipe(res);
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve(server)),
  );
}
if (process.argv[1] === import.meta.filename) {
  const port = Number(process.env.PORT ?? 4100);
  await serve(port);
  console.log(`http://127.0.0.1:${port}`);
}
