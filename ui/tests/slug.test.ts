import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isValidSlug, makeSlug, uniqueSlug } from "@/lib/slug";

describe("makeSlug", () => {
  it("cleans company + role into a short ascii slug", () => {
    expect(makeSlug("Acme, Inc.", "Sr. Full-Stack Engineer (NYC)")).toBe(
      "acme-full-stack-engineer",
    );
  });

  it("drops LLC/Jr/parentheticals, accents and symbols", () => {
    expect(makeSlug("Café Ünïcode LLC", "Jr. Software Engineer (Remote)")).toBe(
      "cafe-unicode-software-engineer",
    );
    expect(makeSlug("A&B Labs", "Backend / Platform Engineer")).toBe(
      "a-and-b-labs-backend-platform-engineer",
    );
  });

  it("is ≤ 60 chars, cut on a word boundary, with no edge hyphens", () => {
    const slug = makeSlug(
      "Extraordinarily Long Company Name Technologies",
      "Principal Distributed Systems Reliability Engineer Platform",
    );
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    // A single huge token is hard-cut but still valid.
    expect(makeSlug("x".repeat(100), "").length).toBe(60);
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(makeSlug("", "")).toBe("");
    expect(makeSlug("!!!", "Inc")).toBe("");
  });

  it("always produces a valid slug when non-empty", () => {
    for (const [c, r] of [
      ["O'Reilly", "SWE II"],
      ["日本 Co", "Engineer"],
      ["  Spaces  ", "  Role  "],
    ]) {
      const s = makeSlug(c, r);
      if (s) expect(isValidSlug(s)).toBe(true);
    }
  });
});

describe("isValidSlug", () => {
  it("accepts and rejects per the spec regex and length", () => {
    expect(isValidSlug("acme-swe")).toBe(true);
    expect(isValidSlug("a")).toBe(true);
    expect(isValidSlug("acme-swe-2")).toBe(true);
    expect(isValidSlug("a".repeat(60))).toBe(true);
    expect(isValidSlug("a".repeat(61))).toBe(false);
    for (const bad of [
      "",
      "-acme",
      "acme-",
      "acme--swe",
      "Acme",
      "acme_swe",
      "acme swe",
      "../x",
      "acme/swe",
    ])
      expect(isValidSlug(bad)).toBe(false);
  });
});

describe("uniqueSlug", () => {
  let root: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "slug-root-"));
    for (const d of ["acme-swe", "acme-swe-2", "other"])
      fs.mkdirSync(path.join(root, "source/tailored", d), { recursive: true });
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("returns the slug when free, else the next free -N", () => {
    expect(uniqueSlug("free-one", root)).toBe("free-one");
    expect(uniqueSlug("other", root)).toBe("other-2");
    expect(uniqueSlug("acme-swe", root)).toBe("acme-swe-3");
  });
});
