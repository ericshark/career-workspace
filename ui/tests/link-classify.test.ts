import { expect, it } from "vitest";
import { classifyFoundLink, isJobBoardUrl } from "@/lib/linkClassify";

it("never saves an aggregator page as the employer's posting", () => {
  // An agency case: a Get First Hire page the model called a posting.
  expect(
    classifyFoundLink(
      "posting",
      "https://getfirsthire.com/jobs/abc",
      "LinkedIn",
    ),
  ).toBe("other");
  expect(
    classifyFoundLink("website", "https://www.lensa.com/boost", "Simplify"),
  ).toBe("other");
});

it("labels the posting on the job's own board as the source link", () => {
  expect(
    classifyFoundLink(
      "posting",
      "https://www.linkedin.com/jobs/view/123",
      "LinkedIn",
    ),
  ).toBe("source");
  // The same page for a job that came from another board is just another site.
  expect(
    classifyFoundLink(
      "source",
      "https://www.linkedin.com/jobs/view/123",
      "Indeed",
    ),
  ).toBe("other");
});

it("keeps employer pages and applicant systems as the model proposed", () => {
  for (const [kind, url] of [
    ["posting", "https://boards.greenhouse.io/boost/jobs/1"],
    ["posting", "https://boost.com/careers/marketing-associate"],
    ["careers", "https://boost.com/careers"],
    ["website", "https://boost.com"],
  ] as const)
    expect(classifyFoundLink(kind, url, "LinkedIn")).toBe(kind);
  // A "source" or "other" claim on a non-board page is really the employer's own page.
  expect(
    classifyFoundLink("source", "https://boost.com/jobs/1", "LinkedIn"),
  ).toBe("posting");
});

it("recognizes boards and their subdomains, not lookalike company domains", () => {
  expect(isJobBoardUrl("https://uk.indeed.com/viewjob?jk=1")).toBe(true);
  expect(isJobBoardUrl("https://jobs.lever.co/boost")).toBe(false);
  expect(isJobBoardUrl("https://notindeed.com/careers")).toBe(false);
});
