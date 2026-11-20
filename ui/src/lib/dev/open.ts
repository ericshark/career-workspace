import { execFileSync, spawn } from "node:child_process";

function which(command: string): string | null {
  try {
    return (
      execFileSync("which", [command], { encoding: "utf8" }).trim() || null
    );
  } catch {
    return null;
  }
}

/** VS Code's `code` launcher, when it is on PATH. */
const code = which("code");

export const canOpenInEditor = Boolean(code);

/** Opens a folder in VS Code. The path is always one the repo guard resolved. */
export function openInEditor(folder: string): void {
  if (!code) throw new Error("VS Code (`code`) is not on PATH");
  const child = spawn(/* turbopackIgnore: true */ code, [folder], {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (error) =>
    console.error(`[workshop dev] code failed: ${error.message}`),
  );
  child.unref();
}
