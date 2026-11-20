import { expect, it } from "vitest";
import { compareText } from "@/components/workshop/dev/api";

it("describes a branch against another in plain words", () => {
  expect(compareText(null)).toBeNull();
  expect(compareText({ against: "main", ahead: 0, behind: 0 })).toBe(
    "In sync with main",
  );
  expect(compareText({ against: "main", ahead: 2, behind: 0 })).toBe(
    "2 ahead of main",
  );
  expect(compareText({ against: "main", ahead: 2, behind: 1 })).toBe(
    "2 ahead of main, 1 behind main",
  );
  expect(
    compareText({ against: "main", ahead: 0, behind: 3 }, "origin/main"),
  ).toBe("3 behind origin/main");
});
