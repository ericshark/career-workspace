// The prompt guide and the review prompt state the score bands in words; code applies them from
// lib/scoring/constants.ts. This test fails when they drift apart.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGE_BANDS, FIT_BANDS, MATCH_BANDS } from "@/lib/scoring/constants";

const read = (file: string) =>
  fs.readFileSync(
    path.join(import.meta.dirname, "../../prompts", file),
    "utf8",
  );
const guide = read("README.md");
const prompt = read("review-job.md");

describe("prompt guide and review prompt match lib/scoring/constants.ts", () => {
  it("verdict bands", () => {
    expect(guide).toContain(
      `${FIT_BANDS.strong}–100 Strong → **Apply** · ${FIT_BANDS.reasonable}–${FIT_BANDS.strong - 1} Reasonable → **Apply** · ${FIT_BANDS.stretch}–${FIT_BANDS.reasonable - 1} Possible fit → **Optional**`,
    );
    expect(guide).toContain(`below ${FIT_BANDS.stretch} Weak → **Skip**`);
    expect(prompt).toContain(`**${FIT_BANDS.strong}–100 Strong:**`);
    expect(prompt).toContain(
      `**${FIT_BANDS.reasonable}–${FIT_BANDS.strong - 1} Reasonable:**`,
    );
    expect(prompt).toContain(
      `**${FIT_BANDS.stretch}–${FIT_BANDS.reasonable - 1} Possible fit:**`,
    );
    expect(prompt).toContain(`**0–${FIT_BANDS.stretch - 1} Weak:**`);
  });

  it("posting age bands", () => {
    expect(guide).toContain(
      `0–${AGE_BANDS.fresh} days Fresh · ${AGE_BANDS.fresh + 1}–${AGE_BANDS.recent} Recent · ${AGE_BANDS.recent + 1}–${AGE_BANDS.older} Older · over ${AGE_BANDS.older} Stale`,
    );
  });

  it("uses the same Match bands as the UI", () => {
    expect(prompt).toContain(`**${MATCH_BANDS.strong}–100 Strong:**`);
    expect(prompt).toContain(
      `**${MATCH_BANDS.moderate}–${MATCH_BANDS.strong - 1} Moderate:**`,
    );
    expect(prompt).toContain(`**0–${MATCH_BANDS.moderate - 1} Weak:**`);
  });
});

it("documents that quotes are informational and the model scores", () => {
  expect(guide).toContain("never change a score");
  expect(prompt).not.toContain("approve-tailor");
});
