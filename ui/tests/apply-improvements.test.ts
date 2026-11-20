import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { applicationDate, counterpartModel } from "@/lib/config";
import { splitJobPaste } from "@/components/applyHelpers";
const root = vi.hoisted(() => `/tmp/career-preferences-${crypto.randomUUID()}`);
vi.mock("@/lib/paths", () => ({ CAREER_ROOT: root }));
import {
  readPreferences,
  savePreferences,
  preferencesSchema,
} from "@/lib/preferences";
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
it("uses the New York 3 a.m. cutoff across DST and year changes", () => {
  for (const [before, after, previous, next] of [
    [
      "2026-10-27T06:59:59Z",
      "2026-10-27T07:00:00Z",
      "2026-10-26",
      "2026-10-27",
    ],
    [
      "2026-03-08T06:59:59Z",
      "2026-03-08T07:00:00Z",
      "2026-03-07",
      "2026-03-08",
    ],
    [
      "2026-11-01T07:59:59Z",
      "2026-11-01T08:00:00Z",
      "2026-10-31",
      "2026-11-01",
    ],
    [
      "2027-01-01T07:59:59Z",
      "2027-01-01T08:00:00Z",
      "2026-12-31",
      "2027-01-01",
    ],
  ]) {
    expect(applicationDate(new Date(before))).toBe(previous);
    expect(applicationDate(new Date(after))).toBe(next);
  }
});
it("extracts a posting URL and preserves surrounding text and other links", () => {
  const result = splitJobPaste(
    "Company https://example.com Apply https://jobs.lever.co/acme/123. Build APIs",
  );
  expect(result.link).toBe("https://jobs.lever.co/acme/123");
  expect(result.text).toContain("https://example.com");
  expect(result.text).toContain("Build APIs");
  expect(splitJobPaste("linkedin.com/jobs/view/123")).toEqual({
    link: "https://linkedin.com/jobs/view/123",
    text: "",
  });
});
it("persists exact provider/model and per-operation effort with a durable round trip", () => {
  const p = readPreferences();
  expect(p.selections.openai.review).toBe("gpt-6.1-terra");
  p.selections.openai.tailor = "gpt-6.1-sol";
  p.operationEfforts["tailor:gpt-6.1-sol"] = "high";
  p.contextMode = "brief";
  savePreferences(p);
  expect(readPreferences()).toEqual(p);
  expect(counterpartModel("gpt-6.1-terra", "openai")).toBe("gpt-6.1-terra");
  expect(
    preferencesSchema.safeParse({
      ...p,
      efforts: { ...p.efforts, "gpt-6.1-sol": "bogus" },
    }).success,
  ).toBe(false);
});
