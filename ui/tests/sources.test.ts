import { describe, expect, it } from "vitest";
import { sourceColor, sourceFromLink, SOURCE_COLOR } from "@/lib/sources";

describe("sourceFromLink", () => {
  it.each([
    [
      "https://csicuny.joinhandshake.com/job-search/11615090?query=x",
      "Handshake",
    ],
    ["https://www.linkedin.com/jobs/view/4012345678/", "LinkedIn"],
    ["indeed.com/viewjob?jk=abc", "Indeed"],
    ["https://simplify.jobs/p/abc-123/backend-engineer", "Simplify"],
    ["https://jobright.ai/jobs/info/abc123", "Jobright"],
    ["https://app.ripplematch.com/v2/public/job/abc", "RippleMatch"],
    ["https://wellfound.com/jobs/3012345-backend", "Wellfound"],
    ["https://www.workatastartup.com/jobs/123", "YC"],
    ["https://www.builtinnyc.com/job/backend/123", "Built In NYC"],
    ["https://hiring.cafe/viewjob/abc", "HiringCafe"],
    ["hiring.cafe/viewjob/abc", "HiringCafe"],
    ["https://www.hiring.cafe/viewjob/abc", "HiringCafe"],
    ["https://nothiring.cafe/viewjob/abc", null],
    ["https://hiring.cafe.example.com/viewjob/abc", null],
    // Boards no longer in the list: no source from the link.
    ["https://www.levels.fyi/jobs?jobId=1", null],
    ["https://news.ycombinator.com/item?id=1", null],
    // ATS pages are reached from many boards: no guess.
    ["https://job-boards.greenhouse.io/acme/jobs/1", null],
    ["https://notlinkedin.com/jobs/1", null],
    ["", null],
    ["not a url at all", null],
  ])("%s → %s", (link, source) => {
    expect(sourceFromLink(link)).toBe(source);
  });
});

describe("HiringCafe source color", () => {
  it.each(["HiringCafe", "hiringcafe", " Hiring Cafe "])(
    "uses pink for %s, including legacy names",
    (source) => {
      expect(sourceColor(source)).toBe(SOURCE_COLOR.HiringCafe);
      expect(sourceColor(source)).toBe("#ef5fa7");
    },
  );
});

describe("source colors are distinguishable", () => {
  it("gives every listed source its own color", () => {
    const colors = Object.values(SOURCE_COLOR);
    expect(new Set(colors).size).toBe(colors.length);
  });
});

describe("YC source color", () => {
  it.each(["YC", "yc", "YC Work at a Startup"])(
    "uses orange for %s, including the former name",
    (source) => {
      expect(sourceColor(source)).toBe(SOURCE_COLOR.YC);
    },
  );
});
