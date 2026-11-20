import { describe, expect, it } from "vitest";
import { scoreToolDecision } from "@/lib/claude/score";

describe("scoreToolDecision (read-only scoring policy)", () => {
  it("allows the SDK's StructuredOutput tool (otherwise no score can ever be returned)", () => {
    expect(scoreToolDecision("StructuredOutput", { company: "x" }).allow).toBe(
      true,
    );
  });

  it("denies Read both inside and outside the repo", () => {
    expect(
      scoreToolDecision("Read", { file_path: "profile/career.md" }).allow,
    ).toBe(false);
    expect(scoreToolDecision("Read", { file_path: "/etc/passwd" }).allow).toBe(
      false,
    );
  });

  it.each([
    "Glob",
    "Grep",
    "Write",
    "Edit",
    "Bash",
    "WebFetch",
    "Skill",
    "Task",
  ])("denies %s", (tool) => {
    expect(
      scoreToolDecision(tool, {
        file_path: "source/tailored/x/resume.tex",
        command: "ls",
      }).allow,
    ).toBe(false);
  });
});
