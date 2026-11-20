import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveInside } from "@/lib/paths";

describe("resolveInside", () => {
  let root: string;
  let outside: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "paths-root-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "paths-out-"));
    fs.mkdirSync(path.join(root, "profile"));
    fs.writeFileSync(path.join(root, "profile", "career.md"), "x");
    fs.symlinkSync(outside, path.join(root, "escape"));
  });
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("allows files inside the root, including ones that don't exist yet", () => {
    expect(resolveInside(root, "profile/career.md")).toBe(
      path.join(fs.realpathSync(root), "profile", "career.md"),
    );
    expect(
      resolveInside(root, "source/tailored/acme/resume.tex"),
    ).not.toBeNull();
  });

  it("rejects .., absolute paths and NUL bytes", () => {
    expect(resolveInside(root, "../etc/passwd")).toBeNull();
    expect(resolveInside(root, "profile/../../etc/passwd")).toBeNull();
    expect(resolveInside(root, "/etc/passwd")).toBeNull();
    expect(resolveInside(root, "profile/a\0b")).toBeNull();
  });

  it("rejects symlink escapes", () => {
    expect(resolveInside(root, "escape/secret.txt")).toBeNull();
  });
});

it("rejects dangling symlinks instead of treating them as future writable files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dangling-path-"));
  try {
    fs.symlinkSync(
      path.join(os.tmpdir(), "missing-career-target", "new.tex"),
      path.join(dir, "alias.tex"),
    );
    expect(resolveInside(dir, "alias.tex")).toBeNull();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
