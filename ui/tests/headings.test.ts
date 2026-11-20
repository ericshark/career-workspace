import { describe, expect, it } from "vitest";
import {
  findHeadingId,
  h2Outline,
  headingId,
  headingOutline,
  stripInline,
} from "@/lib/headings";

describe("headings", () => {
  it("makes GitHub-style ids", () => {
    expect(headingId("Resume usage rules")).toBe("resume-usage-rules");
    expect(headingId("P13: Weekly review")).toBe("p13-weekly-review");
  });
  it("strips inline markdown", () => {
    expect(stripInline("**Bold** `code` [link](x.md)")).toBe("Bold code link");
  });
  it("lists h2s outside code fences", () => {
    const md =
      "# Title\n## One\ntext\n```\n## not a heading\n```\n## Two **bold**\n### three";
    expect(h2Outline(md)).toEqual([
      { text: "One", id: "one" },
      { text: "Two bold", id: "two-bold" },
    ]);
  });
  it("outlines h2 and h3 with their depth", () => {
    const md = "## One\n### Sub **x**\n#### deep\n## Two";
    expect(headingOutline(md, [2, 3])).toEqual([
      { text: "One", id: "one", depth: 2 },
      { text: "Sub x", id: "sub-x", depth: 3 },
      { text: "Two", id: "two", depth: 2 },
    ]);
  });
  it("finds a heading by a loose prefix (quotes and punctuation ignored)", () => {
    const md = [
      "## 60-second pitches",
      "### The gap question (Sept 2025 → now)",
      '### "Tell me about yourself"',
      "```",
      "## Defending in code",
      "```",
      "## Defending the numbers",
    ].join("\n");
    expect(findHeadingId(md, "The gap question")).toBe(
      "the-gap-question-sept-2025--now",
    );
    expect(findHeadingId(md, "Tell me about yourself")).toBe(
      "tell-me-about-yourself",
    );
    // The fenced "## Defending in code" is skipped.
    expect(findHeadingId(md, "Defending")).toBe("defending-the-numbers");
    expect(findHeadingId(md, "Nope")).toBeNull();
    expect(findHeadingId(md, "")).toBeNull();
  });
});
