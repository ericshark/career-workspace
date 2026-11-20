const ALLOWED = /^(PATH|HOME|USER|LOGNAME|LANG|LC_.*|TMPDIR|TERM|SHELL)$/;

// Pass only system variables and the explicit Claude API credential.
export function scrubbedEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    if (ALLOWED.test(k) || k === "ANTHROPIC_API_KEY") env[k] = v;
  }
  return env;
}
