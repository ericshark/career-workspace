import { describe, expect, it } from "vitest";
import { compactJobBrief } from "@/lib/compactJobBrief";
describe("compact brief presentation", () => {
  it("moves labeled facts above the overview and preserves every substantive item", () => {
    const formatted = compactJobBrief(
      "# Acme — Engineer\n\nAcme builds data tools. This role builds APIs.\n\n- Experience: 2+ years\n- Compensation: $100–120k\n- Location/work mode: NYC; hybrid\n\nResponsibilities:\n- Build and operate APIs\n\nQualifications:\n- Required: Python\n- Preferred: React\n\nOther information:\nTravel quarterly.",
    );
    expect(formatted).toContain("**Salary:** $100–120k");
    expect(formatted.indexOf("**Salary:**")).toBeLessThan(
      formatted.indexOf("About the role"),
    );
    for (const text of [
      "Acme builds data tools. This role builds APIs.",
      "2+ years",
      "New York · Hybrid",
      "Build and operate APIs",
      "**Required:** Python",
      "**Preferred:** React",
      "Other information:",
      "Travel quarterly.",
    ])
      expect(formatted).toContain(text);
    expect(formatted).toContain("### What you’ll do");
    expect(formatted).not.toContain("# Acme");
  });
  it("does not fabricate missing company context or sections", () => {
    expect(
      compactJobBrief(
        "# Acme — Engineer\n\nResponsibilities:\n- Maintain services\n- Compensation: Not stated.",
      ),
    ).toBe("### What you’ll do\n- Maintain services");
  });
});
