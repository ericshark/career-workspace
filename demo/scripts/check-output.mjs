// Fails the build if the deployable files could contain private data or server code.
import fs from "node:fs";
import path from "node:path";

const out = path.resolve(import.meta.dirname, "../out");
const files = fs
  .readdirSync(out, { recursive: true, withFileTypes: true })
  .filter((f) => f.isFile())
  .map((f) => path.join(f.parentPath, f.name));
const problems = [];
const forbidden = [
  [
    /[\w.+-]+@(?:gmail|outlook|yahoo|icloud|hotmail)\.com/i,
    "a personal email address",
  ],
  [/\/home\/[a-z][\w-]*\//i, "a home folder path"],
  [/sk-(?:ant|proj)-[\w-]{10,}/, "an API key"],
  [/gh[pousr]_\w{20,}/, "a GitHub token"],
  [/\b\(?\d{3}\)?[ .-]\d{3}[.-]\d{4}\b/, "a phone number"],
];
for (const file of files) {
  if (!/\.(html|js|css|json|txt|svg|woff2|ico|map)$/.test(file))
    problems.push(`Unexpected file type: ${file}`);
  if (/\.map$/.test(file)) problems.push(`Source map: ${file}`);
  if (/\.woff2$/.test(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const [pattern, label] of forbidden) {
    const hit = pattern.exec(text);
    if (hit)
      problems.push(`${path.relative(out, file)} contains ${label}: ${hit[0]}`);
  }
}
for (const page of [
  "index",
  "tracker",
  "actions",
  "apply",
  "workshop",
  "docs",
  "run-locally",
])
  if (!files.includes(path.join(out, `${page}.html`)))
    problems.push(`Missing page: ${page}`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Checked ${files.length} deployable files: no private data found.`);
