import { describe, expect, it } from "vitest";
import { statusColumn } from "@/lib/status";

describe("statusColumn", () => {
  it("keeps the supported statuses as is", () => {
    for (const s of [
      "to apply",
      "applied",
      "in progress",
      "no response",
      "rejected",
    ])
      expect(statusColumn(s)).toEqual({ column: s, legacy: null });
  });
  it("maps legacy values onto the status columns", () => {
    for (const s of ["replied", "screen", "interview", "offer"])
      expect(statusColumn(s)).toEqual({ column: "in progress", legacy: s });
    expect(statusColumn("ghosted")).toEqual({
      column: "no response",
      legacy: "ghosted",
    });
  });
  it("tolerates case and spaces from hand edits", () => {
    expect(statusColumn(" Applied ").column).toBe("applied");
  });
  it("puts unknown values in applied, flagged", () => {
    expect(statusColumn("waiting")).toEqual({
      column: "applied",
      legacy: "waiting",
    });
    expect(statusColumn("")).toEqual({ column: "applied", legacy: "" });
  });
});
