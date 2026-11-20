import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseBuildOutput, runBuild } from "@/lib/build";

const fx = (name: string) =>
  fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("parseBuildOutput", () => {
  it("pass", () => {
    const r = parseBuildOutput(fx("build-output.pass.txt"), 0);
    expect(r).toMatchObject({
      ok: true,
      pages: 1,
      fillPct: 97,
      ats: "PASS",
      warnings: [],
      failures: [],
      pdfPath: "resumes/tech/Resume.pdf",
      pngPath: "/TMP/png/tech.png",
    });
    expect(r.raw).toBe(fx("build-output.pass.txt"));
  });

  it("pass with warnings (real run: ATS unusual-symbol warning)", () => {
    const r = parseBuildOutput(fx("build-output.pass-warnings.txt"), 0);
    expect(r.ok).toBe(true);
    expect(r.ats).toBe("PASS (with warnings)");
    expect(r.fillPct).toBe(101);
    expect(r.pages).toBe(1);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^Unusual symbols/);
    expect(r.failures).toEqual([]);
    expect(r.pdfPath).toBe("resumes/tech/Resume.pdf");
  });

  it("two pages", () => {
    const r = parseBuildOutput(fx("build-output.two-pages.txt"), 1);
    expect(r.ok).toBe(false);
    expect(r.pages).toBe(2);
    expect(r.failures).toEqual([expect.stringMatching(/^2 pages; must be/)]);
    expect(r.warnings).toEqual([expect.stringMatching(/^Overfull \\hbox/)]);
    expect(r.pdfPath).toBeNull();
    expect(r.pngPath).toBeNull();
  });

  it("ATS fail", () => {
    const r = parseBuildOutput(fx("build-output.ats-fail.txt"), 1);
    expect(r.ok).toBe(false);
    expect(r.ats).toBe("FAIL");
    expect(r.pages).toBe(1);
    expect(r.fillPct).toBe(96);
    expect(r.failures).toEqual([
      "Email not extracted",
      "ATS check failed. Not copied. Inspect: /tmp/resume-build.AbC123/resume.pdf",
    ]);
    expect(r.pdfPath).toBeNull();
  });

  it("compile error: nothing else parsed, failure recorded", () => {
    const r = parseBuildOutput(fx("build-output.compile-error.txt"), 1);
    expect(r.ok).toBe(false);
    expect(r.pages).toBeNull();
    expect(r.fillPct).toBeNull();
    expect(r.ats).toBeNull();
    expect(r.failures[0]).toMatch(/^compile failed/);
  });

  it("the exit code is authoritative for ok", () => {
    // A clean-looking log with a non-zero exit is still not ok, and vice versa.
    expect(parseBuildOutput(fx("build-output.pass.txt"), 1).ok).toBe(false);
    expect(parseBuildOutput(fx("build-output.ats-fail.txt"), 0).ok).toBe(true);
  });

  it("never throws on garbage or empty output", () => {
    const r = parseBuildOutput("", 2);
    expect(r).toMatchObject({ ok: false, pages: null, ats: null, raw: "" });
    expect(() => parseBuildOutput("\0\n✗\n! \n", 0)).not.toThrow();
  });
});

describe("runBuild (fake script, never the real repo)", () => {
  let root: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "build-root-"));
    fs.mkdirSync(path.join(root, "scripts"));
    // Echoes its args so we can check the argv + cwd; exits with $FAKE_EXIT-like behavior by tex name.
    fs.writeFileSync(
      path.join(root, "scripts/fake.sh"),
      `#!/usr/bin/env bash
echo "── $1"
echo "args: $*"
echo "cwd: $(pwd)"
case "$1" in
  *fail*) echo "✗ 2 pages; must be exactly 1. Not copied." >&2; exit 1 ;;
  *hang*) sleep 30 ;;
esac
echo "✓ 1 page"
echo "✓ wrote resumes/tailored/x/Resume.pdf"
`,
      { mode: 0o755 },
    );
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("passes the expected args in the given root and parses the result", async () => {
    const r = await runBuild("source/tailored/x/resume.tex", "/tmp/png", {
      root,
      command: "scripts/fake.sh",
    });
    expect(r.ok).toBe(true);
    expect(r.pages).toBe(1);
    expect(r.pdfPath).toBe("resumes/tailored/x/Resume.pdf");
    expect(r.raw).toContain(
      "args: source/tailored/x/resume.tex --png /tmp/png --no-text",
    );
    expect(r.raw).toContain(`cwd: ${fs.realpathSync(root)}`);
  });

  it("captures stderr and a non-zero exit", async () => {
    const r = await runBuild("source/tailored/fail/resume.tex", "/tmp/png", {
      root,
      command: "scripts/fake.sh",
    });
    expect(r.ok).toBe(false);
    expect(r.pages).toBe(2);
  });

  it("kills the script on timeout and reports not ok", async () => {
    const r = await runBuild("source/tailored/hang/resume.tex", "/tmp/png", {
      root,
      command: "scripts/fake.sh",
      timeoutMs: 300,
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/timed out/);
  });

  it("reports a missing command as a failed build (no throw)", async () => {
    const r = await runBuild("x.tex", "/tmp/png", {
      root,
      command: "scripts/nope.sh",
    });
    expect(r.ok).toBe(false);
    expect(r.failures.join("\n")).toMatch(/could not start/);
  });
  it("cancels a build and waits for its spawned process tree", async () => {
    const pidFile = path.join(root, "grandchild.pid");
    const script = path.join(root, "scripts", "tree.sh");
    fs.writeFileSync(
      script,
      `#!/usr/bin/env bash
sleep 30 &
echo $! > "${pidFile}"
wait
`,
      { mode: 0o755 },
    );
    const controller = new AbortController();
    const pending = runBuild("x.tex", "/tmp/png", {
      root,
      command: "scripts/tree.sh",
      signal: controller.signal,
    });
    while (!fs.existsSync(pidFile)) await new Promise((r) => setTimeout(r, 5));
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toContain("cancelled");
    // SIGKILL delivery is asynchronous; allow the scheduler to finish terminating descendants.
    // Reparented zombies are inert, but a process that remains runnable must fail this check.
    const status = `/proc/${pid}/stat`;
    await expect
      .poll(
        () => {
          if (process.platform === "darwin") {
            const result = spawnSync("ps", ["-p", String(pid), "-o", "stat="], {
              encoding: "utf8",
            });
            if (result.error) throw result.error;
            return result.status === 1 || result.stdout.trim().startsWith("Z");
          }
          try {
            return fs.readFileSync(status, "utf8").split(" ")[2] === "Z";
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
            throw error;
          }
        },
        { timeout: 1000 },
      )
      .toBe(true);
  });
});
