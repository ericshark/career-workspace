import { describe, expect, it } from "vitest";
import { DOC_PATH_RE, GUIDE_FLOW, docTitle, isInFlow } from "@/lib/docsConfig";

describe("Guide flow config", () => {
  const items = GUIDE_FLOW.flatMap((g) => g.items);

  it("only points at allowlisted docs", () => {
    for (const i of items) expect(DOC_PATH_RE.test(i.path), i.path).toBe(true);
  });
  it("has unique labels and non-empty groups", () => {
    const labels = items.map((i) => i.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const g of GUIDE_FLOW) expect(g.items.length).toBeGreaterThan(0);
    for (const i of items) expect(i.description.trim(), i.label).not.toBe("");
  });
  it("starts with today and keeps flow files out of Reference", () => {
    expect(
      GUIDE_FLOW.flatMap((g) => g.items).some((i) => i.path === "today.md"),
    ).toBe(false);
    expect(isInFlow("guide/interview.md")).toBe(true);
    expect(isInFlow("guide/idea-workshop.md")).toBe(true);
    expect(isInFlow("profile/career.md")).toBe(false);
  });
  it("titles configured files and falls back to the file name", () => {
    expect(docTitle("guide/interview.md")).toBe("Interview prep");
    expect(docTitle("records/reviews/acme-swe.md")).toBe("acme-swe");
  });
});
