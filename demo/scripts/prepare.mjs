// Copies the app's real screens and API code from ../ui/src into generated/ (Git-ignored), applies
// the few demo overrides, and extracts the install guide from the public README.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const demo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.dirname(demo);
const out = path.join(demo, "generated");
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(repo, "ui/src"), path.join(out, "ui"), {
  recursive: true,
  // Sign-in, the layout and server start-up code have no place in a static site.
  filter: (src) =>
    !/ui\/src\/(app\/auth|app\/guide|app\/layout\.tsx|proxy\.ts|instrumentation\.ts)/.test(
      src.split(path.sep).join("/"),
    ),
});
fs.cpSync(path.join(demo, "overrides"), path.join(out, "ui"), {
  recursive: true,
});
// The bundler swaps node:crypto for its own polyfill, which lacks randomUUID, so name the shim.
for (const name of fs.readdirSync(path.join(out, "ui"), { recursive: true })) {
  if (!/\.tsx?$/.test(name)) continue;
  const file = path.join(out, "ui", name);
  const text = fs.readFileSync(file, "utf8");
  const next = text.replaceAll('from "node:crypto"', 'from "@shims/crypto"');
  if (next !== text) fs.writeFileSync(file, next);
}
fs.copyFileSync(
  path.join(repo, "ui/src/app/icon.svg"),
  path.join(demo, "src/app/icon.svg"),
);

// Only the public prompt files the API code reads. Never the Git-ignored workspace folders.
const prompts = Object.fromEntries(
  ["quick-add.md", "review-job.md", "tailor-resume.md"].map((name) => [
    `prompts/${name}`,
    fs.readFileSync(path.join(repo, "prompts", name), "utf8"),
  ]),
);
fs.writeFileSync(path.join(out, "prompts.json"), JSON.stringify(prompts));

const readme = fs.readFileSync(path.join(repo, "README.md"), "utf8");
const section = (title) => {
  const match = new RegExp(
    `^## ${title}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`,
    "m",
  ).exec(readme);
  if (!match)
    throw new Error(
      `README.md needs a "## ${title}" section for the How to set it up page`,
    );
  return match[1]
    .trim()
    .replace(/\]\(#/g, "](https://github.com/ericshark/career-workspace#");
};
const quick = section("Quick start");
const fence = /```sh\n([\s\S]*?)```/.exec(quick);
if (!fence) throw new Error("Quick start in README.md needs an sh code block");
const firstJob = /^(2\. [\s\S]*?)(?=^3\. )/m.exec(
  section("Try a job from start to finish"),
);
if (!firstJob)
  throw new Error("README.md needs step 2 (log a job) under Try a job");
fs.writeFileSync(
  path.join(out, "guide.json"),
  JSON.stringify({
    prerequisites: quick.slice(0, fence.index).trim(),
    commands: fence[1].trim().split("\n"),
    after: quick.slice(fence.index + fence[0].length).trim(),
    profile: section("Add your profile and resume"),
    tools: section("Resume tools"),
    gmail: section("Optional Gmail checks"),
    backups: section("Local data and backups"),
    help: section("Troubleshooting"),
    ai: section("Connect AI"),
    firstJob: firstJob[1].replace(/^2\. /, "").replace(/^ {3}/gm, "").trim(),
  }),
);

// The demo must use the same versions as the app it shows.
const read = (p) => JSON.parse(fs.readFileSync(path.join(repo, p), "utf8"));
const ui = read("ui/package.json");
const mine = read("demo/package.json");
for (const group of ["dependencies", "devDependencies"])
  for (const [name, version] of Object.entries(mine[group])) {
    const wanted = ui[group]?.[name];
    if (wanted && wanted !== version)
      throw new Error(
        `demo/package.json has ${name} ${version}; ui uses ${wanted}`,
      );
  }
