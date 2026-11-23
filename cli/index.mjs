#!/usr/bin/env node
// Guided setup for Career Workspace. Everything it does is printed before it happens, and it sends
// nothing anywhere except the Git clone and the package installs you approve.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";
import { parseArgs, styleText } from "node:util";
import {
  careerProfile,
  cleanPath,
  freePort,
  hasEnv,
  isWorkspace,
  onPath,
  setEnv,
  writePrivate,
} from "./lib.mjs";

const REPO = "https://github.com/ericshark/career-workspace.git";
const HELP = `Set up Career Workspace on this computer.

Usage: create-career-workspace [folder] [options]

  -y, --yes       No questions: clone, install, skip AI and documents
      --no-start  Do not start the app at the end
      --repo URL  Clone from another Git URL or path
  -h, --help      Show this help`;

let options;
try {
  options = parseArgs({
    allowPositionals: true,
    options: {
      yes: { type: "boolean", short: "y" },
      "no-start": { type: "boolean" },
      repo: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (error) {
  console.error(`${error.message}\n\n${HELP}`);
  process.exit(2);
}
const { values, positionals } = options;
if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const bold = (t) => styleText("bold", t);
const dim = (t) => styleText("dim", t);
const ok = (t) => console.log(`${styleText("green", "✓")} ${t}`);
const note = (t) => console.log(`${styleText("yellow", "!")} ${t}`);
let step = 0;
const heading = (t) => console.log(`\n${bold(`${++step}. ${t}`)}`);
class Stop extends Error {}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve, reject) => {
    let muted = false;
    const output = new Writable({
      write(chunk, _encoding, done) {
        if (!muted) process.stdout.write(chunk);
        done();
      },
    });
    const rl = readline.createInterface({
      input: process.stdin,
      output,
      terminal: true,
    });
    let answered = false;
    rl.on("SIGINT", () => rl.close());
    rl.on("close", () => {
      if (!answered)
        reject(new Stop("Setup stopped. Run setup again to continue."));
    });
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = hidden;
  });
}
async function confirm(question, fallback) {
  if (values.yes) return false;
  for (;;) {
    const answer = (
      await ask(`${question} ${dim(fallback ? "(Y/n)" : "(y/N)")} `)
    ).toLowerCase();
    if (!answer) return fallback;
    if (["y", "yes"].includes(answer)) return true;
    if (["n", "no"].includes(answer)) return false;
  }
}
async function choose(question, choices) {
  console.log(question);
  choices.forEach((c, i) =>
    console.log(`  ${i + 1}) ${c.label}${c.hint ? dim(`  ${c.hint}`) : ""}`),
  );
  for (;;) {
    const answer = await ask(
      `Choose 1-${choices.length} ${dim("(Enter for 1)")} `,
    );
    const index = answer ? Number(answer) - 1 : 0;
    if (choices[index]) return choices[index].value;
  }
}
function run(command, args, cwd) {
  console.log(dim(`$ ${command} ${args.join(" ")}`));
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error)
    throw new Stop(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0)
    throw new Stop(
      `${command} failed. Fix the problem above, then run setup again to continue.`,
    );
}

function checkComputer() {
  heading("Check this computer");
  if (process.platform === "win32")
    throw new Stop(
      "On Windows, install Ubuntu in WSL 2 and run setup inside it: https://learn.microsoft.com/windows/wsl/install",
    );
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Stop(
      `Install Node.js 24 or newer (this is ${process.version}): https://nodejs.org`,
    );
  ok(`Node.js ${process.version}`);
  for (const tool of ["git", "bash", "npm"])
    if (!onPath(tool)) throw new Stop(`Install ${tool}, then run setup again.`);
  ok("Git");
}

async function download() {
  heading("Download and install");
  let dir = positionals[0] ? cleanPath(positionals[0]) : "";
  for (;;) {
    if (!dir) {
      const fallback = path.resolve("career-workspace");
      const typed = values.yes
        ? ""
        : await ask(`Folder ${dim(`(Enter for ${fallback})`)} `);
      dir = cleanPath(typed) || fallback;
    }
    if (isWorkspace(dir)) {
      ok(`Continuing with the copy in ${dir}. Your files are kept.`);
      break;
    }
    if (
      !fs.existsSync(dir) ||
      (fs.statSync(dir).isDirectory() && !fs.readdirSync(dir).length)
    ) {
      run("git", ["clone", "--", values.repo ?? REPO, dir]);
      break;
    }
    note(`${dir} already has other files. Choose another folder.`);
    if (values.yes) throw new Stop("Choose an empty folder.");
    dir = "";
  }
  run("bash", ["scripts/setup.sh"], dir);
  ok("App installed with an empty workspace");
  return dir;
}

function readDocument(file) {
  if (!fs.existsSync(file)) throw new Error("No file there.");
  const extension = path.extname(file).toLowerCase();
  if ([".md", ".txt"].includes(extension)) return fs.readFileSync(file, "utf8");
  if (extension === ".pdf") {
    if (!onPath("pdftotext"))
      throw new Error(
        "Reading a PDF needs Poppler (pdftotext). Use a .md or .txt file instead.",
      );
    return execFileSync("pdftotext", ["-layout", file, "-"], {
      encoding: "utf8",
      maxBuffer: 4e6,
    });
  }
  throw new Error("Use a .md, .txt or .pdf file.");
}
/** Replace a starter file; ask first when it already holds the person's own text. */
async function replaceStarter(dir, rel, text) {
  const file = path.join(dir, rel);
  const template = fs.readFileSync(
    path.join(dir, "templates/workspace", rel),
    "utf8",
  );
  const current = fs.readFileSync(file, "utf8");
  if (current !== template) {
    if (
      !(await confirm(
        `${rel} already has your changes. Replace it? A copy is kept.`,
        false,
      ))
    )
      return false;
    fs.copyFileSync(
      file,
      `${file}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`,
      fs.constants.COPYFILE_EXCL,
    );
  }
  fs.writeFileSync(file, text);
  return true;
}
async function documents(dir) {
  heading("Your background and resume (optional)");
  if (values.yes)
    return note(
      "Skipped. Edit profile/career.md and source/tech/resume.tex later.",
    );
  console.log(
    "AI reviews compare jobs with your background. Files stay on this computer until you use an AI feature.",
  );
  console.log(
    dim("Drag a file into this window or type its path. Press Enter to skip."),
  );
  for (;;) {
    const file = cleanPath(
      await ask("Background or resume (.md, .txt, .pdf): "),
    );
    if (!file) break;
    try {
      const text = readDocument(file);
      if (!text.trim()) throw new Error("That file has no readable text.");
      if (
        await replaceStarter(
          dir,
          "profile/career.md",
          careerProfile(text, path.basename(file)),
        )
      )
        ok(
          "Saved to profile/career.md. Open it, check every line, and remove private details.",
        );
      break;
    } catch (error) {
      note(error.message);
    }
  }
  for (;;) {
    const file = cleanPath(
      await ask("LaTeX resume (.tex), only if you have one: "),
    );
    if (!file) break;
    try {
      if (path.extname(file).toLowerCase() !== ".tex")
        throw new Error("Use a .tex file.");
      const text = fs.readFileSync(file, "utf8");
      if (!text.includes("\\begin{document}"))
        throw new Error("That is not a complete LaTeX document.");
      if (await replaceStarter(dir, "source/tech/resume.tex", text))
        ok(
          "Saved to source/tech/resume.tex. Resume checks expect the starter template's structure.",
        );
      break;
    } catch (error) {
      note(error.message);
    }
  }
}

async function saveKey(dir, name, where) {
  const file = path.join(dir, "ui/.env.local");
  let text = fs.existsSync(file)
    ? fs.readFileSync(file, "utf8")
    : fs.readFileSync(path.join(dir, "ui/.env.example"), "utf8");
  if (
    hasEnv(text, name) &&
    !(await confirm(`${name} is already set. Replace it?`, false))
  )
    return;
  console.log(`Create a key at ${where}`);
  for (;;) {
    const key = await ask(`Paste the key ${dim("(hidden; Enter to skip)")} `, {
      hidden: true,
    });
    if (!key) return note(`Skipped. Add ${name} to ui/.env.local later.`);
    try {
      text = setEnv(text, name, key);
      writePrivate(file, text);
      return ok(
        "Key saved to ui/.env.local, readable only by you. It was not checked or sent anywhere.",
      );
    } catch (error) {
      note(error.message);
    }
  }
}
async function connectAi(dir) {
  heading("AI (optional)");
  if (values.yes)
    return (note("Skipped. Connect AI later in Apply → Models."), null);
  const provider = await choose("Which AI do you want to use?", [
    {
      label: "None for now",
      hint: "Tracker, Actions, Workshop and Docs work without AI",
      value: null,
    },
    { label: "OpenAI", value: "openai" },
    { label: "Claude", value: "claude" },
  ]);
  if (!provider) return null;
  const ui = path.join(dir, "ui");
  const configure = (...args) =>
    execFileSync(
      path.join(ui, "node_modules/.bin/tsx"),
      ["scripts/configure.ts", ...args],
      { cwd: ui, encoding: "utf8" },
    ).trim();
  let route = "key";
  if (provider === "openai")
    route = await choose("How do you want to pay for it?", [
      {
        label: "API key",
        hint: "billed to your OpenAI API account",
        value: "key",
      },
      {
        label: "ChatGPT subscription",
        hint: "uses your eligible plan and its limits",
        value: "plan",
      },
    ]);
  else {
    route = await choose("How do you want to pay for it?", [
      {
        label: "API key",
        hint: "billed to your Claude Console account",
        value: "key",
      },
      {
        label: "Claude subscription",
        hint: "see how to use subscriber API credits",
        value: "plan",
      },
    ]);
    if (route === "plan")
      console.log(
        "The app uses a Claude API key. Eligible subscribers can claim API credits, then use a key from that organization:\nhttps://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers",
      );
  }
  const models = JSON.parse(configure("models"))
    .filter((m) => m.provider === provider)
    .sort((a, b) => Number(b.default) - Number(a.default));
  const model =
    models.length === 1
      ? models[0].id
      : await choose(
          "Which model should review jobs and tailor resumes?",
          models.map((m) => ({
            label: m.label,
            hint: m.default ? "recommended" : "",
            value: m.id,
          })),
        );
  ok(configure("set", provider, model));
  if (provider === "openai" && route === "plan") return "chatgpt";
  await (provider === "openai"
    ? saveKey(dir, "OPENAI_API_KEY", "https://platform.openai.com/api-keys")
    : saveKey(
        dir,
        "ANTHROPIC_API_KEY",
        "https://platform.claude.com/settings/keys",
      ));
  return null;
}

async function resumeTools() {
  heading("Resume tools (optional)");
  const missing = ["python3", "pdflatex", "pdftotext", "pdftoppm"].filter(
    (t) => !onPath(t),
  );
  if (!missing.length) return ok("Python, TeX and Poppler are ready");
  console.log(
    `Building resume PDFs also needs: ${missing.join(", ")}. Everything else works without them.`,
  );
  const commands = onPath("apt-get")
    ? [
        ["sudo", ["apt-get", "update"]],
        [
          "sudo",
          [
            "apt-get",
            "install",
            "-y",
            "python3",
            "texlive-latex-base",
            "texlive-latex-recommended",
            "lmodern",
            "poppler-utils",
          ],
        ],
      ]
    : process.platform === "darwin" && onPath("brew")
      ? [
          ["brew", ["install", "python", "poppler"]],
          ["brew", ["install", "--cask", "mactex-no-gui"]],
        ]
      : [];
  if (!commands.length)
    return note(
      "Install Python, a TeX distribution and Poppler with your package manager.",
    );
  commands.forEach(([c, a]) => console.log(dim(`  ${c} ${a.join(" ")}`)));
  if (
    !(await confirm(
      "Install them now? This is a large download and may ask for your password.",
      false,
    ))
  )
    return note("Skipped. Run those commands later if you want resume PDFs.");
  try {
    for (const [command, args] of commands) run(command, args);
    ok("Resume tools installed");
  } catch (error) {
    note(error.message);
  }
}

async function finish(dir, pending) {
  heading("Ready");
  console.log(
    `Start:  cd '${dir.replaceAll("'", `'\\''`)}' && ./scripts/ui.sh\nStop:   Ctrl+C\n`,
  );
  console.log(bold("Left for you"));
  const left = [];
  if (pending === "chatgpt")
    left.push(
      "Sign in to ChatGPT: in the app, open Apply → Models → Continue with ChatGPT.",
    );
  left.push(
    "Check profile/career.md and put your resume in source/tech/resume.tex.",
  );
  left.push(
    "Email checks (optional): connect Gmail in Claude under Settings → Connectors, open this folder in Claude Code, and ask for Career Check Dry Run.",
  );
  left.forEach((t) => console.log(`- ${t}`));
  if (
    values["no-start"] ||
    values.yes ||
    !(await confirm("\nStart the app now?", true))
  )
    return;
  const port = await freePort();
  console.log(
    `\nStarting at ${bold(`http://127.0.0.1:${port}`)}. The first start takes a minute.`,
  );
  const app = spawn("bash", ["scripts/ui.sh"], {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, CAREER_PORT: String(port) },
  });
  // Ctrl+C reaches the app too; let it stop cleanly.
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => signal === "SIGTERM" && app.kill(signal));
  process.exitCode = await new Promise((resolve) =>
    app.on("exit", (code) => resolve(code ?? 0)),
  );
}

try {
  if (!values.yes && !process.stdin.isTTY)
    throw new Stop(
      "Run this in a terminal, or add --yes to skip the questions.",
    );
  console.log(
    `${bold("Career Workspace setup")}\nThis downloads the app, installs it, and helps you add your background and AI. Every optional step can be skipped.`,
  );
  checkComputer();
  const dir = await download();
  await documents(dir);
  const pending = await connectAi(dir);
  await resumeTools();
  await finish(dir, pending);
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(`\n${styleText("red", error.message)}`);
  process.exitCode = 1;
}
