import { describe, expect, it } from "vitest";
import { scrubbedEnv } from "@/lib/claude/env";

// Test fixtures omit NODE_ENV, which the ProcessEnv type requires.
const penv = (o: Record<string, string | undefined>) => o as NodeJS.ProcessEnv;

describe("scrubbedEnv", () => {
  it("keeps the allowlisted variables", () => {
    const out = scrubbedEnv(
      penv({
        PATH: "/bin",
        HOME: "/home/x",
        USER: "x",
        LOGNAME: "x",
        LANG: "en_US.UTF-8",
        LC_ALL: "C",
        LC_CTYPE: "C",
        TMPDIR: "/tmp",
        TERM: "xterm",
        SHELL: "/bin/bash",
        ANTHROPIC_API_KEY: "fixture",
      }),
    );
    expect(Object.keys(out).sort()).toEqual(
      [
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TMPDIR",
        "TERM",
        "SHELL",
        "ANTHROPIC_API_KEY",
      ].sort(),
    );
  });

  it("keeps only the Claude API key and allowed system variables", () => {
    const out = scrubbedEnv(
      penv({
        PATH: "/bin",
        ANTHROPIC_API_KEY: "k",
        ANTHROPIC_AUTH_TOKEN: "t",
        ANTHROPIC_BASE_URL: "http://x",
        CLAUDE_CODE_ENTRYPOINT: "cli",
        CLAUDE_CODE_SSE_PORT: "1",
        CLAUDECODE: "1",
        NODE_OPTIONS: "--inspect",
        LCX: "not LC_ prefix",
      }),
    );
    expect(out).toEqual({ PATH: "/bin", ANTHROPIC_API_KEY: "k" });
  });

  it("skips undefined values and defaults to process.env", () => {
    expect(scrubbedEnv(penv({ PATH: undefined }))).toEqual({});
    expect(scrubbedEnv().PATH).toBe(process.env.PATH);
    expect(scrubbedEnv().ANTHROPIC_API_KEY).toBe(process.env.ANTHROPIC_API_KEY);
  });
});
