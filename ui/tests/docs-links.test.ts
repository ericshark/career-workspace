import { describe, expect, it } from "vitest";
import { classifyLink, resolveRelative } from "../src/components/docsLinks";

describe("resolveRelative", () => {
  it("resolves siblings and parents", () => {
    expect(resolveRelative("today.md", "guide/mindset.md")).toBe(
      "guide/mindset.md",
    );
    expect(resolveRelative("guide/x.md", "../today.md")).toBe("today.md");
    expect(resolveRelative("guide/x.md", "./y.md")).toBe("guide/y.md");
  });
  it("returns null when escaping the root", () => {
    expect(resolveRelative("x.md", "../a.md")).toBeNull();
  });
});

describe("classifyLink", () => {
  it("rewrites relative doc links to /docs routes, keeping the hash", () => {
    expect(classifyLink("today.md", "guide/interview.md#a")).toEqual({
      kind: "doc",
      href: "/guide/guide/interview.md#a",
    });
    expect(classifyLink("guide/p.md", "../profile/career.md")).toEqual({
      kind: "doc",
      href: "/guide/profile/career.md",
    });
    expect(classifyLink("guide/p.md", "../today.md").kind).toBe("plain");
  });
  it("renders code files, non-doc folders and escapes as plain text", () => {
    expect(classifyLink("today.md", "scripts/build.sh").kind).toBe("plain");
    expect(classifyLink("today.md", "source/notes.md").kind).toBe("plain");
    expect(classifyLink("today.md", "CLAUDE.md").kind).toBe("plain");
    expect(classifyLink("guide/x.md", "../../../etc/x.md").kind).toBe("plain");
    expect(classifyLink("today.md", "javascript:alert(1)").kind).toBe("plain");
    expect(classifyLink("today.md", undefined).kind).toBe("plain");
  });
  it("passes through external and anchor links", () => {
    expect(classifyLink("a/b.md", "https://x.com").kind).toBe("external");
    expect(classifyLink("a/b.md", "#top").kind).toBe("anchor");
  });
});
