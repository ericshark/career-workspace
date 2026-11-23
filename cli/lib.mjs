// Pure helpers for the setup command.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import os from "node:os";

/** A path as typed or dragged into a terminal: quotes, escaped spaces and ~ are understood. */
export function cleanPath(raw) {
  let text = raw.trim();
  const quoted = /^(['"])(.*)\1$/.exec(text);
  text = quoted ? quoted[2] : text.replace(/\\(.)/g, "$1");
  if (text === "~" || text.startsWith("~/"))
    text = path.join(os.homedir(), text.slice(1));
  return text ? path.resolve(text) : "";
}

/** Set one variable in .env text, keeping every other line. */
export function setEnv(text, name, value) {
  if (!/^[\x21-\x7e]+$/.test(value) || /["'`\\#$]/.test(value))
    throw new Error("That does not look like an API key.");
  const line = `${name}=${value}`;
  const pattern = new RegExp(
    `^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=.*$`,
    "m",
  );
  if (pattern.test(text)) return text.replace(pattern, () => line);
  return `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
}

export function hasEnv(text, name) {
  return new RegExp(
    `^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*\\S+`,
    "m",
  ).test(text);
}

/** Write a private file without following a link or leaving it readable by others. */
export function writePrivate(file, text) {
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
    throw new Error(`${file} is a link. Edit it yourself.`);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text, { mode: 0o600, flag: "wx" });
  fs.renameSync(temp, file);
}

/** Turn an imported background document into career.md. */
export function careerProfile(text, source) {
  const body = text.replace(/\r\n/g, "\n").trim();
  if (/^# /.test(body)) return `${body}\n`;
  return `# Career profile\n\n<!-- Imported from ${source.replace(/--+>?/g, "-")}. Check every line and remove anything private, such as your phone number. -->\n\n## Experience\n\n${body}\n`;
}

export function isWorkspace(dir) {
  return ["scripts/setup.sh", "scripts/ui.sh", "ui/package.json"].every((f) =>
    fs.existsSync(path.join(dir, f)),
  );
}

export function freePort(start = 3001) {
  return new Promise((resolve, reject) => {
    if (start > 3100)
      return reject(new Error("No free port from 3001 to 3100."));
    const probe = net.createServer();
    probe.once("error", () => resolve(freePort(start + 1)));
    probe.listen(start, "127.0.0.1", () => probe.close(() => resolve(start)));
  });
}

export function onPath(name) {
  return (process.env.PATH ?? "").split(path.delimiter).some((dir) => {
    try {
      fs.accessSync(path.join(dir, name), fs.constants.X_OK);
      return fs.statSync(path.join(dir, name)).isFile();
    } catch {
      return false;
    }
  });
}
